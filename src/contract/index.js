// SPDX-License-Identifier: MIT
import crypto from "node:crypto";
import fs from "node:fs";
import { VaultState, buildVaultId } from "./state.js";
import { loadStateFromFs, saveStateToFs } from "./stateStore.js";
import { assertValidCid, buildGatewayFetchUrl } from "./cidUtils.js";
import { getGatewayBaseUrl, isMutableUriTokensEnabled, isTeamModeEnabled } from "./config.js";
import { ContractError, fail, toErrorResponse } from "./errors.js";
import {
  DEFAULT_URI_ISSUER,
  assertBase64,
  burnUriToken,
  deriveSignerAddress,
  mintUriToken,
  validateClassicAddress,
  validateHexSalt,
  verifySignedPayload
} from "./xrplUtils.js";

const OPS_PER_ROUND_LIMIT = 5;
const DEFAULT_STATE_FILE = process.env.XVAULT_STATE_FILE ?? "./state/xvault-state.json";
const QUICKNODE_GATEWAY = getGatewayBaseUrl();
const ENABLE_XRPL_DEV_FALLBACK = process.env.XVAULT_DEV_XRPL_FALLBACK !== "false";
const ENABLE_TEAM_MODE = isTeamModeEnabled();
const ENABLE_MUTABLE_URITOKENS = isMutableUriTokensEnabled();

const state = new VaultState(loadStateFromFs(DEFAULT_STATE_FILE));
let limiter = { roundKey: null, perAddress: new Map() };

export async function handleOperation(op, deps = {}, runtimeContext = {}) {
  if (!op || typeof op !== "object") fail("Operation payload is required.", "INVALID_INPUT");
  const type = op.type;
  const payload = op.payload ?? {};
  const roundKey = resolveRoundKey(runtimeContext, op);

  switch (type) {
    case "createVault":
      return success(type, await createVaultHandler(payload, deps, roundKey));
    case "createTeamVault":
      return success(type, await createTeamVaultHandler(payload, deps, roundKey));
    case "inviteToVault":
      return success(type, await inviteToVaultHandler(payload, roundKey));
    case "acceptInvite":
      return success(type, await acceptInviteHandler(payload, roundKey));
    case "removeMember":
      return success(type, await removeMemberHandler(payload, roundKey));
    case "revokeInvite":
      return success(type, await revokeInviteHandler(payload, roundKey));
    case "updateVaultManifest":
      return success(type, await updateVaultManifestHandler(payload, deps, roundKey));
    case "listVaultURITokens":
      return success(type, await listVaultURITokensHandler(payload));
    case "revokeVault":
      return success(type, await revokeVaultHandler(payload, deps, roundKey));
    case "getPendingInvites":
      return success(type, await getPendingInvitesHandler(payload));
    case "addEntry":
      return success(type, await addEntryHandler(payload, deps, roundKey));
    case "getMyVaults":
      return success(type, getMyVaultsHandler(payload));
    case "getEntry":
      return success(type, getEntryHandler(payload));
    case "stateDigest":
      return success(type, { digest: state.digest() });
    case "addPasswordBackup":
      return success(type, await addPasswordBackupHandler(payload, roundKey));
    case "removePasswordBackup":
      return success(type, await removePasswordBackupHandler(payload, roundKey));
    case "getVaultMetadata":
      return success(type, getVaultMetadataHandler(payload));
    default:
      fail(`Unknown operation type: ${type}`, "UNKNOWN_OPERATION");
  }
}

async function createVaultHandler(payload, deps, roundKey) {
  const vaultType = payload.type ?? "individual";
  if (vaultType === "team") {
    return createTeamVaultHandler(payload, deps, roundKey);
  }
  if (vaultType !== "individual") {
    fail("Unsupported vault type.", "UNSUPPORTED_VAULT_TYPE");
  }
  const rawMetadata = payload.metadata ?? {};
  assertObject(rawMetadata, "metadata");
  validateClassicAddress(payload.owner);
  validateHexSalt(payload.salt);
  const vaultId = buildVaultId(payload.owner, payload.salt);
  if (rawMetadata.passwordBackup) {
    validatePasswordBackupEnvelope(rawMetadata.passwordBackup, vaultId);
  }
  verifySignedPayload({
    payload: {
      type: vaultType,
      owner: payload.owner,
      salt: payload.salt,
      metadata: rawMetadata
    },
    signature: payload.signature,
    signerPublicKey: payload.signerPublicKey,
    expectedAddress: payload.owner
  });
  enforceRateLimit(payload.owner, roundKey);

  const metadata = normalizeVaultMetadata(rawMetadata, vaultId, roundKey);
  const manifestMint = await mintUriToken({
    xrplClient: deps.xrplClient,
    multisigSigners: deps.multisigSigners ?? [],
    issuer: deps.uriIssuer ?? DEFAULT_URI_ISSUER,
    uri: "ipfs://placeholder-for-now",
    devMode: ENABLE_XRPL_DEV_FALLBACK
  });
  // FUTURE: TEAM MODE - delegation could use URIToken ownership transfer
  // from creator to a managed vault authority account.

  const vault = state.createVault({
    owner: payload.owner,
    salt: payload.salt,
    metadata,
    createdAt: roundKey,
    manifestTokenId: manifestMint.tokenId
  });
  persistState();
  auditLog("createVault", { owner: payload.owner, vaultId: vault.id, success: true });

  return {
    vaultId: vault.id,
    owner: vault.owner,
    createdAt: vault.createdAt,
    manifestTokenId: vault.manifestTokenId,
    mintMode: manifestMint.mode
  };
}

async function createTeamVaultHandler(payload, deps, roundKey) {
  ensureTeamModeEnabled();
  const rawMetadata = payload.metadata ?? {};
  assertObject(rawMetadata, "metadata");
  validateClassicAddress(payload.owner);
  validateHexSalt(payload.salt);
  validateAddressArray(payload.initialAuthorized ?? [], "initialAuthorized");
  const vaultId = buildVaultId(payload.owner, payload.salt);
  if (rawMetadata.passwordBackup) {
    validatePasswordBackupEnvelope(rawMetadata.passwordBackup, vaultId);
  }
  verifySignedPayload({
    payload: {
      type: "team",
      owner: payload.owner,
      salt: payload.salt,
      metadata: rawMetadata,
      initialAuthorized: payload.initialAuthorized ?? []
    },
    signature: payload.signature,
    signerPublicKey: payload.signerPublicKey,
    expectedAddress: payload.owner
  });
  enforceRateLimit(payload.owner, roundKey);

  const manifestMint = await mintUriToken({
    xrplClient: deps.xrplClient,
    multisigSigners: deps.multisigSigners ?? [],
    issuer: deps.uriIssuer ?? DEFAULT_URI_ISSUER,
    uri: "ipfs://placeholder-for-now",
    devMode: ENABLE_XRPL_DEV_FALLBACK
  });
  // FUTURE: TEAM MODE - mint team policy token or integrate Xahau Hooks.
  // FUTURE: on membership change -> client re-uploads policy blob and calls
  // updateManifestUri when mutable URI support is available.

  const metadata = normalizeVaultMetadata(rawMetadata, vaultId, roundKey);
  const vault = state.createVault({
    owner: payload.owner,
    salt: payload.salt,
    metadata,
    createdAt: roundKey,
    manifestTokenId: manifestMint.tokenId,
    type: "team",
    authorized: payload.initialAuthorized ?? [],
    pendingInvites: []
  });
  persistState();
  auditLog("createTeamVault", { owner: payload.owner, vaultId: vault.id, success: true });

  return {
    vaultId: vault.id,
    owner: vault.owner,
    type: vault.type,
    createdAt: vault.createdAt,
    manifestTokenId: vault.manifestTokenId,
    authorizedCount: vault.authorized.length,
    mintMode: manifestMint.mode
  };
}

async function inviteToVaultHandler(payload, roundKey) {
  ensureTeamModeEnabled();
  assertString(payload.vaultId, "vaultId", 8, 128);
  assertString(payload.invitee, "invitee", 25, 40);
  validateClassicAddress(payload.invitee);

  const vault = state.requireVault(payload.vaultId);
  if (vault.type !== "team") fail("Invites are supported only for team vaults.", "INVALID_VAULT_TYPE");
  const inviter = vault.owner;

  verifySignedPayload({
    payload: {
      vaultId: payload.vaultId,
      invitee: payload.invitee,
      action: "inviteToVault"
    },
    signature: payload.signature,
    signerPublicKey: payload.signerPublicKey,
    expectedAddress: inviter
  });
  enforceRateLimit(inviter, roundKey);

  const invite = state.addPendingInvite({
    vaultId: payload.vaultId,
    invitedBy: inviter,
    address: payload.invitee,
    invitedAt: roundKey
  });
  persistState();
  auditLog("invite_sent", { vaultId: payload.vaultId, invitee: payload.invitee, invitedBy: inviter, success: true });

  return {
    success: true,
    pendingInviteCount: vault.pendingInvites.length,
    invitee: invite.address
  };
}

async function acceptInviteHandler(payload, roundKey) {
  ensureTeamModeEnabled();
  assertString(payload.vaultId, "vaultId", 8, 128);
  const signerAddress = deriveSignerAddress(payload.signerPublicKey);
  validateClassicAddress(signerAddress);

  verifySignedPayload({
    payload: {
      vaultId: payload.vaultId,
      action: "acceptInvite"
    },
    signature: payload.signature,
    signerPublicKey: payload.signerPublicKey,
    expectedAddress: signerAddress
  });
  enforceRateLimit(signerAddress, roundKey);

  const vault = state.requireVault(payload.vaultId);
  if (vault.type !== "team") fail("Invites are supported only for team vaults.", "INVALID_VAULT_TYPE");

  const invite = state.acceptPendingInvite({
    vaultId: payload.vaultId,
    address: signerAddress
  });
  persistState();
  auditLog("invite_accepted", { vaultId: payload.vaultId, invitee: signerAddress, acceptedAt: roundKey, success: true });

  return {
    success: true,
    authorizedCount: vault.authorized.length,
    invitedBy: invite.invitedBy
  };
}

async function getPendingInvitesHandler(payload) {
  ensureTeamModeEnabled();
  assertString(payload.vaultId, "vaultId", 8, 128);
  const vault = state.requireVault(payload.vaultId);
  if (vault.type !== "team") fail("Pending invites are supported only for team vaults.", "INVALID_VAULT_TYPE");

  verifySignedPayload({
    payload: {
      vaultId: payload.vaultId,
      action: "getPendingInvites"
    },
    signature: payload.signature,
    signerPublicKey: payload.signerPublicKey,
    expectedAddress: vault.owner
  });

  return {
    vaultId: payload.vaultId,
    pendingInvites: vault.pendingInvites.map((invite) => ({
      address: invite.address,
      invitedBy: invite.invitedBy,
      invitedAt: invite.invitedAt
    }))
  };
}

async function removeMemberHandler(payload, roundKey) {
  ensureTeamModeEnabled();
  assertString(payload.vaultId, "vaultId", 8, 128);
  assertString(payload.memberToRemove, "memberToRemove", 25, 40);
  validateClassicAddress(payload.memberToRemove);

  const vault = state.requireVault(payload.vaultId);
  if (vault.type !== "team") fail("Member removal is supported only for team vaults.", "INVALID_VAULT_TYPE");
  const owner = vault.owner;

  verifySignedPayload({
    payload: {
      vaultId: payload.vaultId,
      memberToRemove: payload.memberToRemove,
      action: "removeMember"
    },
    signature: payload.signature,
    signerPublicKey: payload.signerPublicKey,
    expectedAddress: owner
  });
  enforceRateLimit(owner, roundKey);

  state.removeAuthorizedMember({
    vaultId: payload.vaultId,
    owner,
    memberToRemove: payload.memberToRemove
  });
  persistState();
  auditLog("member_removed", { vaultId: payload.vaultId, removed: payload.memberToRemove, by: owner, success: true });

  return {
    success: true,
    authorizedCount: vault.authorized.length
  };
}

async function revokeInviteHandler(payload, roundKey) {
  ensureTeamModeEnabled();
  assertString(payload.vaultId, "vaultId", 8, 128);
  assertString(payload.pendingAddress, "pendingAddress", 25, 40);
  validateClassicAddress(payload.pendingAddress);

  const vault = state.requireVault(payload.vaultId);
  if (vault.type !== "team") fail("Invites are supported only for team vaults.", "INVALID_VAULT_TYPE");
  const owner = vault.owner;

  verifySignedPayload({
    payload: {
      vaultId: payload.vaultId,
      pendingAddress: payload.pendingAddress,
      action: "revokeInvite"
    },
    signature: payload.signature,
    signerPublicKey: payload.signerPublicKey,
    expectedAddress: owner
  });
  enforceRateLimit(owner, roundKey);

  state.revokePendingInvite({
    vaultId: payload.vaultId,
    owner,
    pendingAddress: payload.pendingAddress
  });
  persistState();
  auditLog("invite_revoked", { vaultId: payload.vaultId, pendingAddress: payload.pendingAddress, by: owner, success: true });

  return {
    success: true,
    pendingInviteCount: vault.pendingInvites.length
  };
}

async function updateVaultManifestHandler(payload, deps, roundKey) {
  ensureTeamModeEnabled();
  assertString(payload.vaultId, "vaultId", 8, 128);
  if (!payload.newUri && !payload.newBlobHex) {
    fail("Either newUri or newBlobHex is required.", "INVALID_INPUT");
  }
  if (payload.newUri !== undefined) {
    assertString(payload.newUri, "newUri", 8, 512);
  }
  if (payload.newBlobHex !== undefined) {
    assertString(payload.newBlobHex, "newBlobHex", 2, 4096);
    if (!/^[0-9a-fA-F]+$/.test(payload.newBlobHex)) {
      fail("newBlobHex must be a hex string.", "INVALID_INPUT");
    }
  }

  const vault = state.requireVault(payload.vaultId);
  if (vault.type !== "team") fail("Manifest updates are supported only for team vaults.", "INVALID_VAULT_TYPE");
  const owner = vault.owner;

  verifySignedPayload({
    payload: {
      vaultId: payload.vaultId,
      newUri: payload.newUri ?? null,
      newBlobHex: payload.newBlobHex ?? null,
      action: "updateVaultManifest"
    },
    signature: payload.signature,
    signerPublicKey: payload.signerPublicKey,
    expectedAddress: owner
  });
  enforceRateLimit(owner, roundKey);

  // CLIENT RESPONSIBILITY: on membership change (invite accepted/member removed),
  // client must re-encrypt affected entry data, recompute wrappedKeys for active
  // members, upload updated blobs to IPFS, then update vault manifest policy URI.
  // FUTURE: when DynamicURITokens/URITokenModify is available and enabled,
  // submit URITokenModify with URITokenID=vault.manifestTokenId and URI/Blob.
  if (ENABLE_MUTABLE_URITOKENS) {
    persistState();
    auditLog("manifest_updated", { vaultId: payload.vaultId, by: owner, mode: "mutable_stub", success: true });
    return {
      success: true,
      mode: "mutable_stub",
      manifestTokenId: vault.manifestTokenId
    };
  }

  // Fallback (current network reality): burn + re-mint manifest token.
  // This can incur extra XRPL fees and produces a new token ID.
  const burned = await burnUriToken({
    xrplClient: deps.xrplClient,
    multisigSigners: deps.multisigSigners ?? [],
    issuer: deps.uriIssuer ?? DEFAULT_URI_ISSUER,
    uriTokenId: vault.manifestTokenId,
    devMode: ENABLE_XRPL_DEV_FALLBACK
  });
  const oldManifestTokenId = vault.manifestTokenId;
  const nextUri = payload.newUri ?? "ipfs://placeholder-for-now";
  const reminted = await mintUriToken({
    xrplClient: deps.xrplClient,
    multisigSigners: deps.multisigSigners ?? [],
    issuer: deps.uriIssuer ?? DEFAULT_URI_ISSUER,
    uri: nextUri,
    devMode: ENABLE_XRPL_DEV_FALLBACK
  });
  vault.manifestTokenId = reminted.tokenId;
  persistState();
  auditLog("manifest_rotated", {
    vaultId: payload.vaultId,
    by: owner,
    oldManifestTokenId,
    newManifestTokenId: reminted.tokenId,
    success: true
  });

  return {
    success: true,
    mode: "burn_remint",
    manifestTokenId: vault.manifestTokenId,
    burnMode: burned.mode,
    mintMode: reminted.mode
  };
}

async function listVaultURITokensHandler(payload) {
  assertString(payload.vaultId, "vaultId", 8, 128);
  const vault = state.requireVault(payload.vaultId);
  const owner = vault.owner;

  verifySignedPayload({
    payload: {
      vaultId: payload.vaultId,
      action: "listVaultURITokens"
    },
    signature: payload.signature,
    signerPublicKey: payload.signerPublicKey,
    expectedAddress: owner
  });

  return {
    vaultId: payload.vaultId,
    tokenIds: state.listVaultURITokens({ vaultId: payload.vaultId, owner })
  };
}

async function revokeVaultHandler(payload, deps, roundKey) {
  assertString(payload.vaultId, "vaultId", 8, 128);
  const vault = state.requireVault(payload.vaultId);
  const owner = vault.owner;

  verifySignedPayload({
    payload: {
      vaultId: payload.vaultId,
      confirm: payload.confirm === true,
      action: "revokeVault"
    },
    signature: payload.signature,
    signerPublicKey: payload.signerPublicKey,
    expectedAddress: owner
  });
  enforceRateLimit(owner, roundKey);

  if (vault.type === "team" && payload.confirm !== true) {
    fail("Team vault revocation requires confirm=true.", "CONFIRMATION_REQUIRED");
  }

  const tokenIds = state.listVaultURITokens({ vaultId: payload.vaultId, owner });
  let burnedTokens = 0;
  for (const tokenId of tokenIds) {
    await burnUriToken({
      xrplClient: deps.xrplClient,
      multisigSigners: deps.multisigSigners ?? [],
      issuer: deps.uriIssuer ?? DEFAULT_URI_ISSUER,
      uriTokenId: tokenId,
      devMode: ENABLE_XRPL_DEV_FALLBACK
    });
    burnedTokens += 1;
  }

  // CLIENT RESPONSIBILITY: after vault revocation, clear local cache and
  // unpin associated CIDs from QuickNode if storage reclamation is desired.
  const entryCount = vault.entries.length;
  state.deleteVault({ vaultId: payload.vaultId, owner });
  persistState();
  auditLog("vault_revoked", {
    vaultId: payload.vaultId,
    owner,
    type: vault.type,
    entryCount,
    burnedTokens,
    success: true
  });

  return {
    success: true,
    burnedTokens
  };
}

async function addEntryHandler(payload, deps, roundKey) {
  assertString(payload.vaultId, "vaultId", 8, 128);
  const actor = payload.actor ?? payload.owner;
  assertString(actor, "actor", 25, 40);
  validateClassicAddress(actor);
  assertBase64(payload.encryptedBlob, "encryptedBlob");
  if (typeof payload.cid !== "string") fail("cid must be a string.", "INVALID_INPUT");
  assertValidCid(payload.cid);
  assertObject(payload.entryMetadata, "entryMetadata");
  assertString(payload.entryMetadata.service, "entryMetadata.service", 1, 128);
  if (payload.entryMetadata.username !== undefined) {
    assertString(payload.entryMetadata.username, "entryMetadata.username", 1, 256);
  }
  if (payload.entryMetadata.notes !== undefined) {
    assertString(payload.entryMetadata.notes, "entryMetadata.notes", 1, 4096);
  }
  validateWrappedKeys(payload.wrappedKeys ?? []);

  const vault = state.requireVault(payload.vaultId);
  // CLIENT RESPONSIBILITY: when team membership changes, client must re-encrypt
  // and re-upload entry blobs as needed for the new authorized set.
  // CLIENT RESPONSIBILITY: client computes wrappedKeys using recipients' Xahau
  // public keys; contract only stores ciphertext references.

  verifySignedPayload({
    payload: {
      vaultId: payload.vaultId,
      actor,
      encryptedBlob: payload.encryptedBlob,
      cid: payload.cid,
      entryMetadata: payload.entryMetadata,
      wrappedKeys: payload.wrappedKeys ?? []
    },
    signature: payload.signature,
    signerPublicKey: payload.signerPublicKey,
    expectedAddress: actor
  });
  enforceRateLimit(actor, roundKey);

  const entryMint = await mintUriToken({
    xrplClient: deps.xrplClient,
    multisigSigners: deps.multisigSigners ?? [],
    issuer: deps.uriIssuer ?? DEFAULT_URI_ISSUER,
    uri: `ipfs://${payload.cid}`,
    owner: vault.owner,
    devMode: ENABLE_XRPL_DEV_FALLBACK
  });
  // FUTURE: TEAM MODE - entry-level wrapped key references can be attached
  // in metadata as client-produced wrappedKeys arrays.

  const entry = state.addEntry({
    vaultId: payload.vaultId,
    actor,
    cid: payload.cid,
    entryMetadata: payload.entryMetadata,
    wrappedKeys: payload.wrappedKeys ?? [],
    createdAt: roundKey,
    tokenId: entryMint.tokenId
  });
  persistState();
  auditLog("addEntry", { owner: actor, vaultId: payload.vaultId, success: true });

  return {
    vaultId: payload.vaultId,
    tokenId: entry.tokenId,
    cid: entry.cid,
    createdAt: entry.createdAt,
    metadata: entry.metadata,
    mintMode: entryMint.mode
  };
}

function getEntryHandler(payload) {
  assertString(payload.vaultId, "vaultId", 8, 128);
  const hasIndex = payload.entryIndex !== undefined && payload.entryIndex !== null;
  const hasTokenId = typeof payload.tokenId === "string" && payload.tokenId.length > 0;
  if (!hasIndex && !hasTokenId) {
    fail("Either entryIndex or tokenId is required.", "INVALID_INPUT");
  }
  if (hasIndex && !Number.isInteger(payload.entryIndex)) {
    fail("entryIndex must be an integer.", "INVALID_INPUT");
  }
  const actor = payload.actor ?? payload.owner;
  assertString(actor, "actor", 25, 40);
  validateClassicAddress(actor);

  verifySignedPayload({
    payload: {
      vaultId: payload.vaultId,
      actor,
      entryIndex: hasIndex ? payload.entryIndex : null,
      tokenId: hasTokenId ? payload.tokenId : null
    },
    signature: payload.signature,
    signerPublicKey: payload.signerPublicKey,
    expectedAddress: actor
  });

  const entry = state.getEntry({
    vaultId: payload.vaultId,
    actor,
    entryIndex: hasIndex ? payload.entryIndex : undefined,
    tokenId: hasTokenId ? payload.tokenId : undefined
  });
  auditLog("getEntry", {
    owner: actor,
    vaultId: payload.vaultId,
    by: hasIndex ? "index" : "tokenId",
    success: true
  });

  return {
    cid: entry.cid,
    metadata: entry.metadata,
    gatewayUrl: buildGatewayFetchUrl(QUICKNODE_GATEWAY, entry.cid)
  };
}

function getMyVaultsHandler(payload) {
  assertString(payload.owner, "owner", 25, 40);
  validateClassicAddress(payload.owner);
  const since = payload.since === undefined || payload.since === null ? null : String(payload.since);
  if (since !== null) assertString(since, "since", 1, 64);
  return state.getMyVaults(payload.owner, since);
}

async function addPasswordBackupHandler(payload, roundKey) {
  assertString(payload.vaultId, "vaultId", 8, 128);
  assertObject(payload.passwordBackup, "passwordBackup");
  assertString(payload.actor, "actor", 25, 40);
  validateClassicAddress(payload.actor);
  validatePasswordBackupEnvelope(payload.passwordBackup, payload.vaultId);

  const vault = state.requireVault(payload.vaultId);
  const owner = vault.owner;
  if (payload.actor !== owner) fail("Only vault owner can set password backup.", "UNAUTHORIZED");

  verifySignedPayload({
    payload: {
      vaultId: payload.vaultId,
      actor: payload.actor,
      action: "addPasswordBackup",
      passwordBackup: payload.passwordBackup
    },
    signature: payload.signature,
    signerPublicKey: payload.signerPublicKey,
    expectedAddress: owner
  });
  enforceRateLimit(owner, roundKey);

  state.setPasswordBackup({
    vaultId: payload.vaultId,
    owner,
    passwordBackup: payload.passwordBackup,
    updatedAt: roundKey
  });
  persistState();
  auditLog("password_backup_added", { vaultId: payload.vaultId, owner, success: true });

  return {
    success: true
  };
}

async function removePasswordBackupHandler(payload, roundKey) {
  assertString(payload.vaultId, "vaultId", 8, 128);
  assertString(payload.actor, "actor", 25, 40);
  validateClassicAddress(payload.actor);

  const vault = state.requireVault(payload.vaultId);
  const owner = vault.owner;
  if (payload.actor !== owner) fail("Only vault owner can remove password backup.", "UNAUTHORIZED");

  verifySignedPayload({
    payload: {
      vaultId: payload.vaultId,
      actor: payload.actor,
      action: "removePasswordBackup"
    },
    signature: payload.signature,
    signerPublicKey: payload.signerPublicKey,
    expectedAddress: owner
  });
  enforceRateLimit(owner, roundKey);

  state.clearPasswordBackup({ vaultId: payload.vaultId, owner, updatedAt: roundKey });
  persistState();
  auditLog("password_backup_removed", { vaultId: payload.vaultId, owner, success: true });

  return {
    success: true
  };
}

function getVaultMetadataHandler(payload) {
  assertString(payload.vaultId, "vaultId", 8, 128);
  assertString(payload.actor, "actor", 25, 40);
  validateClassicAddress(payload.actor);

  const vault = state.requireVault(payload.vaultId);
  const owner = vault.owner;
  if (payload.actor !== owner) fail("Only vault owner can read metadata.", "UNAUTHORIZED");

  verifySignedPayload({
    payload: {
      vaultId: payload.vaultId,
      actor: payload.actor,
      action: "getVaultMetadata"
    },
    signature: payload.signature,
    signerPublicKey: payload.signerPublicKey,
    expectedAddress: owner
  });

  return {
    vaultId: payload.vaultId,
    metadata: vault.metadata ?? {}
  };
}

function ensureTeamModeEnabled() {
  if (!ENABLE_TEAM_MODE) {
    fail("Team vaults are not enabled in this deployment.", "TEAM_MODE_DISABLED");
  }
}

function normalizeVaultMetadata(metadata, vaultId, roundKey) {
  const normalized = { ...(metadata ?? {}) };
  if (normalized.vaultId && normalized.vaultId !== vaultId) {
    fail("metadata.vaultId does not match computed vaultId.", "INVALID_METADATA");
  }
  normalized.vaultId = vaultId;
  if (normalized.blobVersion === undefined) normalized.blobVersion = 1;
  normalized.lastUpdated = roundKey;
  return normalized;
}

function persistState() {
  saveStateToFs(DEFAULT_STATE_FILE, state.snapshot());
}

function resolveRoundKey(runtimeContext, op) {
  if (runtimeContext.roundKey) return `${runtimeContext.roundKey}`;
  if (runtimeContext.lclSeqNo !== undefined) return `${runtimeContext.lclSeqNo}`;
  if (op.round !== undefined) return `${op.round}`;
  if (op.roundKey !== undefined) return `${op.roundKey}`;
  return "round-unknown";
}

function enforceRateLimit(owner, roundKey) {
  if (!owner) fail("owner is required for mutating operations.", "INVALID_INPUT");
  if (limiter.roundKey !== roundKey) {
    limiter = { roundKey, perAddress: new Map() };
  }
  const count = limiter.perAddress.get(owner) ?? 0;
  if (count >= OPS_PER_ROUND_LIMIT) {
    fail("Rate limit exceeded: max 5 mutating operations per round.", "RATE_LIMIT_EXCEEDED");
  }
  limiter.perAddress.set(owner, count + 1);
}

function auditLog(event, fields) {
  console.info(
    JSON.stringify({
      at: new Date().toISOString(),
      event,
      ...fields
    })
  );
}

export async function runContract({ requests, respond, runtimeContext = {}, deps = {} }) {
  for await (const req of requests) {
    try {
      const result = await handleOperation(req, deps, runtimeContext);
      await respond(result);
    } catch (error) {
      const safeError = error instanceof ContractError ? error : new ContractError(error.message, "UNEXPECTED_ERROR");
      auditLog("request_error", {
        type: req?.type ?? "unknown",
        success: false,
        code: safeError.code,
        message: safeError.message
      });
      const errorId = crypto.createHash("sha256").update(`${safeError.code}:${safeError.message}`).digest("hex").slice(0, 12);
      await respond({ ...toErrorResponse(safeError), errorId });
    }
  }
}

function success(operation, data) {
  return { ok: true, operation, data };
}

function assertString(value, fieldName, minLen = 1, maxLen = 512) {
  if (typeof value !== "string") fail(`${fieldName} must be a string.`, "INVALID_INPUT");
  const trimmed = value.trim();
  if (trimmed.length < minLen || trimmed.length > maxLen) {
    fail(`${fieldName} length must be between ${minLen} and ${maxLen}.`, "INVALID_INPUT");
  }
}

function assertObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${fieldName} must be an object.`, "INVALID_INPUT");
  }
}

function validateAddressArray(values, fieldName) {
  if (!Array.isArray(values)) fail(`${fieldName} must be an array.`, "INVALID_INPUT");
  if (values.length > 50) fail(`${fieldName} exceeds maximum size.`, "INVALID_INPUT");
  for (const address of values) {
    assertString(address, `${fieldName}[]`, 25, 40);
    validateClassicAddress(address);
  }
}

function validateWrappedKeys(wrappedKeys) {
  if (!Array.isArray(wrappedKeys)) fail("wrappedKeys must be an array.", "INVALID_INPUT");
  if (wrappedKeys.length > 200) fail("wrappedKeys exceeds maximum size.", "INVALID_INPUT");
  for (const item of wrappedKeys) {
    assertObject(item, "wrappedKeys[]");
    assertString(item.address, "wrappedKeys[].address", 25, 40);
    validateClassicAddress(item.address);
    assertBase64(item.encryptedKey, "wrappedKeys[].encryptedKey");
  }
}

function validatePasswordBackupEnvelope(passwordBackup, vaultId) {
  assertObject(passwordBackup, "passwordBackup");
  if (!Number.isInteger(passwordBackup.version) || passwordBackup.version !== 1) {
    fail("passwordBackup.version must be 1.", "INVALID_INPUT");
  }
  assertString(passwordBackup.vaultId, "passwordBackup.vaultId", 8, 128);
  if (passwordBackup.vaultId !== vaultId) {
    fail("passwordBackup.vaultId mismatch.", "INVALID_INPUT");
  }
  assertBase64(passwordBackup.salt, "passwordBackup.salt");
  assertBase64(passwordBackup.nonce, "passwordBackup.nonce");
  assertBase64(passwordBackup.authTag, "passwordBackup.authTag");
  assertBase64(passwordBackup.ciphertext, "passwordBackup.ciphertext");
}

async function bootstrapHotPocketRuntime() {
  // Gate bootstrap to real HotPocket runtime only; avoids side effects in tests/tools.
  if (process.stdin.isTTY) return;
  if (!fs.existsSync("../patch.cfg")) return;

  const hpargs = await readContractArgs();

  const queue = await collectUserRequests(hpargs);
  let cursor = 0;
  await runContract({
    requests: (async function* iter() {
      for (const item of queue) {
        if (item.request && typeof item.request === "object") {
          yield item.request;
        }
      }
    })(),
    respond: async (payload) => {
      const target = queue[cursor];
      cursor += 1;
      if (!target) return;
      await sendUserOutput(target.outFd, payload);
    },
    runtimeContext: {
      lclSeqNo: hpargs?.lcl_seq_no,
      lclHash: hpargs?.lcl_hash,
      roundKey: hpargs?.lcl_seq_no
    },
    deps: {}
  });
}

bootstrapHotPocketRuntime().catch((error) => {
  auditLog("bootstrap_error", { success: false, message: error?.message ?? String(error) });
});

async function readContractArgs() {
  const argsJson = await new Promise((resolve, reject) => {
    fs.readFile(process.stdin.fd, "utf8", (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });
  return JSON.parse(argsJson);
}

async function collectUserRequests(hpargs) {
  const queue = [];
  const users = hpargs?.users && typeof hpargs.users === "object" ? hpargs.users : {};
  const inputFd = hpargs?.user_in_fd;
  for (const [publicKey, records] of Object.entries(users)) {
    if (!Array.isArray(records) || records.length < 1) continue;
    const outFd = records[0];
    for (const input of records.slice(1)) {
      if (!Array.isArray(input) || input.length < 2) continue;
      const [offset, size] = input;
      const raw = await readInputChunk(inputFd, offset, size);
      let request = null;
      try {
        request = JSON.parse(raw.toString("utf8"));
      } catch {
        request = null;
      }
      queue.push({ publicKey, outFd, request });
    }
  }

  return queue;
}

async function readInputChunk(fd, offset, size) {
  const buffer = Buffer.alloc(size);
  await new Promise((resolve, reject) => {
    fs.read(fd, buffer, 0, size, offset, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  return buffer;
}

async function sendUserOutput(outFd, payload) {
  const message = Buffer.from(JSON.stringify(payload));
  const header = Buffer.alloc(4);
  header.writeUInt32BE(message.byteLength);
  await new Promise((resolve, reject) => {
    fs.writev(outFd, [header, message], (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

