// SPDX-License-Identifier: MIT
import keypairs from "ripple-keypairs";
import { createIpfsClient } from "../ipfs/quicknodeIpfs.js";
import { getPublicKeyFromAddress } from "../crypto/xrplPubkey.js";
import { prepareEntryPayload, zeroize } from "../crypto/vaultCrypto.js";
import {
  combineShares,
  deriveRecoveryRoot,
  generateRecoveryShares,
  prepareRecoveryMetadata
} from "../recovery/shamirRecovery.js";
import { createHotPocketTransport } from "./wsTransport.js";

const RECOVERY_SECRET_LENGTH = 32;
const DEFAULT_RECOVERY_PREFIX = "xvault:recovery";

/**
 * @typedef {object} VaultSummary
 * @property {string} vaultId
 * @property {string} owner
 * @property {"individual" | "team"} [type]
 * @property {string} [manifestTokenId]
 */

/**
 * @typedef {object} EntryPayload
 * @property {string} service
 * @property {string} [username]
 * @property {string} [password]
 * @property {string} [notes]
 */

/**
 * @typedef {object} RecoveryShare
 * @property {string} shareId
 * @property {string} share
 */

/**
 * @typedef {object} XVaultClientConfig
 * @property {string} hotpocketWsUrl
 * @property {import("xahau").Client} xrplClient - Xahau client
 * @property {import("xahau").Wallet} wallet
 * @property {{ apiKey?: string, apiBase?: string, gateway: string, fetchImpl?: typeof fetch }} quicknodeConfig
 * @property {boolean} [enableTeamMode]
 * @property {(ctx: { vaultId: string, type: "individual" | "team" }) => Promise<Uint8Array>} [rootKeyProvider]
 * @property {(vaultId: string) => Promise<string[]>} [getTeamAuthorizedAddresses]
 * @property {(vaultId: string) => Promise<string>} [getVaultSalt]
 * @property {number} [wsTimeoutMs]
 * @property {(url: string) => any} [wsFactory]
 * @property {(operation: { type: string, payload: object }) => Promise<any>} [submitContractRequest]
 */

/**
 * Create a thin reusable client SDK for XVault operations.
 *
 * SECURITY: this SDK never sends plaintext entries, recovery shares, or
 * recovered secrets to contract nodes.
 */
export function createXVaultClient(config) {
  assertConfig(config);
  const submitTransport = config.submitContractRequest
    ? null
    : createHotPocketTransport({
        url: config.hotpocketWsUrl,
        timeoutMs: config.wsTimeoutMs,
        wsFactory: config.wsFactory
      });
  const submitContractRequest = config.submitContractRequest ?? ((op) => submitTransport.submit(op));
  const ipfs = createIpfsClient({
    apiKey: config.quicknodeConfig.apiKey,
    apiBase: config.quicknodeConfig.apiBase,
    gateway: config.quicknodeConfig.gateway,
    fetchImpl: config.quicknodeConfig.fetchImpl
  });

  /** @type {Map<string, { type: "individual" | "team", saltHex?: string, recoverySecretHashB64?: string, recoveryMetadataCid?: string }>} */
  const vaultContext = new Map();
  /** @type {Map<string, Uint8Array>} */
  const rootKeyCache = new Map();

  async function createVault(options) {
    const type = options?.type ?? "individual";
    if (type !== "individual" && type !== "team") {
      throw createSdkError("INVALID_INPUT", "options.type must be 'individual' or 'team'.");
    }
    if (type === "team" && config.enableTeamMode === false) {
      throw createSdkError("TEAM_MODE_DISABLED", "Team mode is disabled in client config.");
    }

    const saltHex = bytesToHex(randomBytes(16));
    const initialAuthorized = type === "team" ? options?.initialAuthorized ?? [] : [];

    let metadata = {};
    if (options?.recoveryThreshold && options?.recoveryTotal) {
      const recovery = await generateRecoverySetup(options.recoveryThreshold, options.recoveryTotal, ipfs, type);
      metadata = {
        recovery: {
          enabled: true,
          threshold: options.recoveryThreshold,
          total: options.recoveryTotal,
          secretHash: recovery.recoverySecretHashB64,
          recoveryMetadataCid: recovery.recoveryMetadataCid ?? null
        }
      };
    }

    const signPayload = {
      type,
      owner: config.wallet.classicAddress,
      salt: saltHex,
      metadata,
      ...(type === "team" ? { initialAuthorized } : {})
    };

    const signed = await withSignature(signPayload, config.wallet.privateKey);
    const opType = type === "team" ? "createTeamVault" : "createVault";
    const response = await submitContractRequest({
      type: opType,
      payload: {
        ...signPayload,
        signerPublicKey: config.wallet.publicKey,
        signature: signed
      }
    });
    assertOkResponse(response, opType);

    const data = response.data ?? {};
    vaultContext.set(data.vaultId, { type, saltHex });
    return {
      vaultId: data.vaultId,
      manifestTokenId: data.manifestTokenId
    };
  }

  async function addEntry(vaultId, entryData) {
    assertNonEmptyString(vaultId, "vaultId");
    assertEntryPayload(entryData);

    const context = await resolveVaultContext(vaultId);
    const rootKey = await resolveRootKey(vaultId, context);
    let authorizedPubKeys = [];
    if (context.type === "team") {
      const addresses = await resolveTeamAddresses(vaultId);
      authorizedPubKeys = await resolvePublicKeys(addresses, config.xrplClient);
      if (authorizedPubKeys.length === 0) {
        throw createSdkError("MISSING_TEAM_KEYS", "No team member public keys resolved for wrapped keys.");
      }
    }

    const prepared = await prepareEntryPayload(context.type, entryData, rootKey, authorizedPubKeys);
    const upload = await ipfs.uploadBlob(prepared.encryptedBlob, {
      filename: `xvault-entry-${vaultId}.json`,
      contentType: "application/json"
    });

    const signPayload = {
      vaultId,
      actor: config.wallet.classicAddress,
      encryptedBlob: prepared.encryptedBlob,
      cid: upload.cid,
      entryMetadata: prepared.entryMetadata,
      wrappedKeys: prepared.wrappedKeys ?? []
    };

    const signature = await withSignature(signPayload, config.wallet.privateKey);
    const response = await submitContractRequest({
      type: "addEntry",
      payload: {
        ...signPayload,
        signerPublicKey: config.wallet.publicKey,
        signature
      }
    });
    assertOkResponse(response, "addEntry");

    return {
      tokenId: response.data?.tokenId,
      cid: response.data?.cid ?? upload.cid
    };
  }

  async function getEntry(vaultId, entryIndexOrTokenId) {
    assertNonEmptyString(vaultId, "vaultId");
    const isToken = typeof entryIndexOrTokenId === "string";
    const signPayload = {
      vaultId,
      actor: config.wallet.classicAddress,
      entryIndex: isToken ? null : entryIndexOrTokenId,
      tokenId: isToken ? entryIndexOrTokenId : null
    };

    const signature = await withSignature(signPayload, config.wallet.privateKey);
    const response = await submitContractRequest({
      type: "getEntry",
      payload: {
        vaultId,
        actor: config.wallet.classicAddress,
        ...(isToken ? { tokenId: entryIndexOrTokenId } : { entryIndex: entryIndexOrTokenId }),
        signerPublicKey: config.wallet.publicKey,
        signature
      }
    });
    assertOkResponse(response, "getEntry");

    return {
      cid: response.data?.cid,
      gatewayUrl: response.data?.gatewayUrl ?? ipfs.getGatewayUrl(response.data?.cid),
      metadata: response.data?.metadata ?? {}
    };
  }

  async function listVaults() {
    const response = await submitContractRequest({
      type: "getMyVaults",
      payload: { owner: config.wallet.classicAddress }
    });
    assertOkResponse(response, "getMyVaults");
    const summaries = Array.isArray(response.data) ? response.data : [];
    for (const item of summaries) {
      if (!item?.vaultId) continue;
      const existing = vaultContext.get(item.vaultId) ?? {};
      vaultContext.set(item.vaultId, {
        type: item.type === "team" ? "team" : existing.type ?? "individual",
        saltHex: existing.saltHex,
        recoverySecretHashB64: existing.recoverySecretHashB64,
        recoveryMetadataCid: existing.recoveryMetadataCid
      });
    }
    return summaries;
  }

  async function inviteToVault(vaultId, inviteeAddress) {
    assertNonEmptyString(vaultId, "vaultId");
    assertNonEmptyString(inviteeAddress, "inviteeAddress");
    const signPayload = {
      vaultId,
      invitee: inviteeAddress,
      action: "inviteToVault"
    };
    const signature = await withSignature(signPayload, config.wallet.privateKey);
    const response = await submitContractRequest({
      type: "inviteToVault",
      payload: {
        ...signPayload,
        signerPublicKey: config.wallet.publicKey,
        signature
      }
    });
    assertOkResponse(response, "inviteToVault");
  }

  async function acceptInvite(vaultId) {
    assertNonEmptyString(vaultId, "vaultId");
    const signPayload = {
      vaultId,
      action: "acceptInvite"
    };
    const signature = await withSignature(signPayload, config.wallet.privateKey);
    const response = await submitContractRequest({
      type: "acceptInvite",
      payload: {
        vaultId,
        signerPublicKey: config.wallet.publicKey,
        signature
      }
    });
    assertOkResponse(response, "acceptInvite");
  }

  async function removeMember(vaultId, memberAddress) {
    assertNonEmptyString(vaultId, "vaultId");
    assertNonEmptyString(memberAddress, "memberAddress");
    const signPayload = {
      vaultId,
      memberToRemove: memberAddress,
      action: "removeMember"
    };
    const signature = await withSignature(signPayload, config.wallet.privateKey);
    const response = await submitContractRequest({
      type: "removeMember",
      payload: {
        ...signPayload,
        signerPublicKey: config.wallet.publicKey,
        signature
      }
    });
    assertOkResponse(response, "removeMember");
  }

  async function revokeVault(vaultId) {
    assertNonEmptyString(vaultId, "vaultId");
    const summariesResponse = await submitContractRequest({
      type: "getMyVaults",
      payload: { owner: config.wallet.classicAddress }
    });
    assertOkResponse(summariesResponse, "getMyVaults");
    const summaries = Array.isArray(summariesResponse.data) ? summariesResponse.data : [];
    const summary = summaries.find((item) => item.vaultId === vaultId);
    if (!summary) {
      throw createSdkError("VAULT_NOT_FOUND", "Vault not found in owner summaries.");
    }

    const signPayload = {
      vaultId,
      confirm: summary.type === "team",
      action: "revokeVault"
    };
    const signature = await withSignature(signPayload, config.wallet.privateKey);
    const response = await submitContractRequest({
      type: "revokeVault",
      payload: {
        vaultId,
        confirm: summary.type === "team",
        signerPublicKey: config.wallet.publicKey,
        signature
      }
    });
    assertOkResponse(response, "revokeVault");

    vaultContext.delete(vaultId);
    const cachedRoot = rootKeyCache.get(vaultId);
    if (cachedRoot) zeroize(cachedRoot);
    rootKeyCache.delete(vaultId);
  }

  async function enableRecovery(vaultId, threshold, total) {
    assertNonEmptyString(vaultId, "vaultId");
    assertPositiveInt(threshold, "threshold");
    assertPositiveInt(total, "total");
    if (threshold > total) {
      throw createSdkError("INVALID_THRESHOLD", "threshold cannot exceed total.");
    }

    const setup = await generateRecoverySetup(threshold, total, ipfs);
    const existing = vaultContext.get(vaultId) ?? { type: "individual" };
    vaultContext.set(vaultId, {
      ...existing,
      recoverySecretHashB64: setup.recoverySecretHashB64,
      recoveryMetadataCid: setup.recoveryMetadataCid
    });

    return {
      shares: setup.shares.map((item) => item.share),
      recoveryMetadataCid: setup.recoveryMetadataCid
    };
  }

  async function recoverVault(shares, vaultId) {
    assertNonEmptyString(vaultId, "vaultId");
    if (!Array.isArray(shares) || shares.length === 0) {
      throw createSdkError("INVALID_INPUT", "shares must be a non-empty array.");
    }

    const context = await resolveVaultContext(vaultId);
    const saltHex = await resolveVaultSalt(vaultId, context);
    const combined = await combineShares(shares);
    const combinedBytes = typeof combined === "string" ? utf8Encode(combined) : combined;
    const root = await deriveRecoveryRoot(combinedBytes, saltHex);

    if (context.recoverySecretHashB64) {
      const hash = await sha256Base64(combinedBytes);
      if (hash !== context.recoverySecretHashB64) {
        zeroize(root);
        zeroize(combinedBytes);
        return false;
      }
    }

    const existing = rootKeyCache.get(vaultId);
    if (existing) zeroize(existing);
    rootKeyCache.set(vaultId, root);
    zeroize(combinedBytes);
    return true;
  }

  async function close() {
    for (const key of rootKeyCache.values()) {
      zeroize(key);
    }
    rootKeyCache.clear();
    if (submitTransport) {
      await submitTransport.close();
    }
  }

  return {
    createVault,
    addEntry,
    getEntry,
    listVaults,
    inviteToVault,
    acceptInvite,
    removeMember,
    revokeVault,
    enableRecovery,
    recoverVault,
    close
  };

  async function resolveVaultSalt(vaultId, context) {
    if (context.saltHex) return context.saltHex;
    if (typeof config.getVaultSalt === "function") {
      const salt = await config.getVaultSalt(vaultId);
      assertHex(salt, "vaultSalt");
      context.saltHex = salt;
      vaultContext.set(vaultId, context);
      return salt;
    }
    throw createSdkError(
      "MISSING_VAULT_SALT",
      "Vault salt unavailable. Provide create-time salt cache or config.getVaultSalt(vaultId)."
    );
  }

  async function resolveRootKey(vaultId, context) {
    const cached = rootKeyCache.get(vaultId);
    if (cached) return cached;
    if (typeof config.rootKeyProvider === "function") {
      const resolved = await config.rootKeyProvider({ vaultId, type: context.type });
      if (!(resolved instanceof Uint8Array) || resolved.length !== 32) {
        throw createSdkError("INVALID_ROOT_KEY", "rootKeyProvider must resolve Uint8Array(32).");
      }
      rootKeyCache.set(vaultId, resolved);
      return resolved;
    }
    throw createSdkError(
      "MISSING_ROOT_KEY",
      "No root key available. Use recoverVault(...) first or provide config.rootKeyProvider."
    );
  }

  async function resolveTeamAddresses(vaultId) {
    if (typeof config.getTeamAuthorizedAddresses !== "function") {
      throw createSdkError(
        "MISSING_TEAM_ADDRESS_PROVIDER",
        "Team vault addEntry requires config.getTeamAuthorizedAddresses(vaultId)."
      );
    }
    const addresses = await config.getTeamAuthorizedAddresses(vaultId);
    if (!Array.isArray(addresses) || addresses.length === 0) {
      throw createSdkError("INVALID_TEAM_ADDRESS_PROVIDER", "Authorized team addresses are required.");
    }
    return addresses;
  }

  async function resolveVaultContext(vaultId) {
    const existing = vaultContext.get(vaultId);
    if (existing) return existing;
    const list = await listVaults();
    const summary = list.find((item) => item.vaultId === vaultId);
    if (!summary) {
      throw createSdkError("VAULT_NOT_FOUND", `Vault not found: ${vaultId}`);
    }
    const context = {
      type: summary.type === "team" ? "team" : "individual",
      saltHex: undefined,
      recoverySecretHashB64: undefined,
      recoveryMetadataCid: undefined
    };
    vaultContext.set(vaultId, context);
    return context;
  }
}

async function generateRecoverySetup(threshold, total, ipfs, prefix = DEFAULT_RECOVERY_PREFIX) {
  const recoverySecret = randomBytes(RECOVERY_SECRET_LENGTH);
  const shares = await generateRecoveryShares(recoverySecret, total, threshold);
  const recoverySecretHashB64 = await sha256Base64(recoverySecret);
  const metadata = prepareRecoveryMetadata({
    total,
    threshold,
    shareHashes: [recoverySecretHashB64]
  });

  let recoveryMetadataCid;
  try {
    const upload = await ipfs.uploadBlob(JSON.stringify({ prefix, ...metadata }), {
      filename: "xvault-recovery-metadata.json",
      contentType: "application/json"
    });
    recoveryMetadataCid = upload.cid;
  } catch {
    recoveryMetadataCid = undefined;
  }

  zeroize(recoverySecret);
  return {
    shares,
    recoverySecretHashB64,
    recoveryMetadataCid
  };
}

async function resolvePublicKeys(addresses, xrplClient) {
  const results = [];
  for (const address of addresses) {
    if (typeof address !== "string" || address.length === 0) continue;
    const pubKey = await getPublicKeyFromAddress(address, xrplClient);
    if (!pubKey) continue;
    results.push({ address, pubKey });
  }
  return results;
}

async function withSignature(payload, privateKey) {
  const digest = await sha256Hex(stableStringify(payload));
  return keypairs.sign(digest, privateKey);
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256Hex(value) {
  const bytes = utf8Encode(value);
  const digest = await getCryptoApi().subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

async function sha256Base64(value) {
  const digest = await getCryptoApi().subtle.digest("SHA-256", value);
  return bytesToBase64(new Uint8Array(digest));
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  getCryptoApi().getRandomValues(bytes);
  return bytes;
}

function getCryptoApi() {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.subtle) {
    return globalThis.crypto;
  }
  throw createSdkError("CRYPTO_UNAVAILABLE", "Web Crypto API is unavailable in this runtime.");
}

function utf8Encode(value) {
  return new TextEncoder().encode(value);
}

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function assertConfig(config) {
  if (!config || typeof config !== "object") {
    throw createSdkError("INVALID_INPUT", "createXVaultClient config is required.");
  }
  assertNonEmptyString(config.hotpocketWsUrl, "config.hotpocketWsUrl");
  if (!config.xrplClient || typeof config.xrplClient.request !== "function") {
    throw createSdkError("INVALID_INPUT", "config.xrplClient with request() is required.");
  }
  if (!config.wallet?.classicAddress || !config.wallet?.privateKey || !config.wallet?.publicKey) {
    throw createSdkError("INVALID_INPUT", "config.wallet with classicAddress/publicKey/privateKey is required.");
  }
  if (!config.quicknodeConfig || typeof config.quicknodeConfig !== "object") {
    throw createSdkError("INVALID_INPUT", "config.quicknodeConfig is required.");
  }
  assertNonEmptyString(config.quicknodeConfig.gateway, "config.quicknodeConfig.gateway");
}

function assertOkResponse(response, operation) {
  if (!response?.ok) {
    throw createSdkError(
      response?.code ?? "CONTRACT_ERROR",
      response?.error ?? `${operation} failed.`
    );
  }
}

function assertNonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw createSdkError("INVALID_INPUT", `${field} must be a non-empty string.`);
  }
}

function assertPositiveInt(value, field) {
  if (!Number.isInteger(value) || value <= 0) {
    throw createSdkError("INVALID_INPUT", `${field} must be a positive integer.`);
  }
}

function assertHex(value, field) {
  if (typeof value !== "string" || !/^[0-9a-fA-F]+$/.test(value) || value.length % 2 !== 0) {
    throw createSdkError("INVALID_INPUT", `${field} must be an even-length hex string.`);
  }
}

function assertEntryPayload(entryData) {
  if (!entryData || typeof entryData !== "object") {
    throw createSdkError("INVALID_INPUT", "entryData must be an object.");
  }
  assertNonEmptyString(entryData.service, "entryData.service");
}

function createSdkError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

