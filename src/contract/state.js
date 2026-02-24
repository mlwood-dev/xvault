import crypto from "node:crypto";
import { fail } from "./errors.js";

export class VaultState {
  constructor(initial = {}) {
    this.vaults = initial.vaults ?? {};
  }

  createVault({
    owner,
    salt,
    metadata = {},
    createdAt,
    manifestTokenId,
    type = "individual",
    authorized = [],
    pendingInvites = []
  }) {
    const vaultId = buildVaultId(owner, salt);
    if (this.vaults[vaultId]) fail("Vault already exists.", "VAULT_ALREADY_EXISTS");

    const dedupAuthorized = [...new Set([owner, ...authorized])];
    this.vaults[vaultId] = {
      id: vaultId,
      type,
      owner,
      createdAt,
      salt,
      metadata,
      manifestTokenId,
      // FUTURE: TEAM MODE - permission list for delegated vault access.
      // client and on-ledger policy controls should evolve this field.
      authorized: dedupAuthorized,
      pendingInvites,
      entries: []
    };
    return this.vaults[vaultId];
  }

  addEntry({ vaultId, actor, owner, cid, entryMetadata, createdAt, tokenId, wrappedKeys = [] }) {
    const vault = this.requireVault(vaultId);
    const principal = actor ?? owner;
    this.assertWriteAccess(vault, principal);
    const entry = {
      tokenId,
      cid,
      metadata: {
        service: entryMetadata.service,
        username: entryMetadata.username ?? null,
        notes: entryMetadata.notes ?? null
      },
      // FUTURE: TEAM MODE - client computes hybrid wrapping and sends ciphertext only.
      wrappedKeys,
      createdAt
    };
    vault.entries.push(entry);
    return entry;
  }

  getEntry({ vaultId, actor, owner, entryIndex, tokenId }) {
    const vault = this.requireVault(vaultId);
    const principal = actor ?? owner;
    this.assertReadAccess(vault, principal);

    let entry = null;
    if (typeof entryIndex === "number") {
      entry = vault.entries[entryIndex] ?? null;
    } else if (tokenId) {
      entry = vault.entries.find((item) => item.tokenId === tokenId) ?? null;
    }

    if (!entry) fail("Entry not found.", "ENTRY_NOT_FOUND");
    return entry;
  }

  getMyVaults(owner, since = null) {
    return Object.values(this.vaults)
      .filter((vault) => vault.owner === owner)
      .filter((vault) => (since === null ? true : compareCreatedAt(vault.createdAt, since) > 0))
      .map((vault) => ({
        vaultId: vault.id,
        type: vault.type,
        createdAt: vault.createdAt,
        entryCount: vault.entries.length,
        authorizedCount: vault.type === "team" ? vault.authorized.length : 1,
        pendingInviteCount: vault.type === "team" ? vault.pendingInvites.length : 0,
        manifestTokenId: vault.manifestTokenId,
        lastActivity: vault.entries.length ? vault.entries[vault.entries.length - 1].createdAt : null
      }))
      .sort((a, b) => compareCreatedAt(b.createdAt, a.createdAt));
  }

  requireVault(vaultId) {
    const vault = this.vaults[vaultId];
    if (!vault) fail("Vault not found.", "VAULT_NOT_FOUND");
    return vault;
  }

  getVaultMetadata({ vaultId, owner }) {
    const vault = this.requireVault(vaultId);
    if (vault.owner !== owner) fail("Only vault owner can read metadata.", "UNAUTHORIZED");
    return vault.metadata ?? {};
  }

  setPasswordBackup({ vaultId, owner, passwordBackup, updatedAt }) {
    const vault = this.requireVault(vaultId);
    if (vault.owner !== owner) fail("Only vault owner can update metadata.", "UNAUTHORIZED");
    vault.metadata = { ...(vault.metadata ?? {}), passwordBackup };
    if (!vault.metadata.vaultId) vault.metadata.vaultId = vault.id;
    if (updatedAt !== undefined) vault.metadata.lastUpdated = updatedAt;
    return vault.metadata;
  }

  clearPasswordBackup({ vaultId, owner, updatedAt }) {
    const vault = this.requireVault(vaultId);
    if (vault.owner !== owner) fail("Only vault owner can update metadata.", "UNAUTHORIZED");
    if (!vault.metadata) vault.metadata = {};
    delete vault.metadata.passwordBackup;
    if (!vault.metadata.vaultId) vault.metadata.vaultId = vault.id;
    if (updatedAt !== undefined) vault.metadata.lastUpdated = updatedAt;
    return vault.metadata;
  }

  snapshot() {
    return JSON.parse(JSON.stringify({ vaults: this.vaults }));
  }

  digest() {
    const stable = stableStringify(this.snapshot());
    return crypto.createHash("sha256").update(stable).digest("hex");
  }

  addPendingInvite({ vaultId, invitedBy, address, invitedAt }) {
    const vault = this.requireVault(vaultId);
    if (vault.type !== "team") fail("Invites are supported only for team vaults.", "INVALID_VAULT_TYPE");
    if (vault.owner !== invitedBy) fail("Only vault owner can invite users.", "UNAUTHORIZED");

    const alreadyAuthorized = vault.authorized.includes(address);
    if (alreadyAuthorized) fail("Address is already authorized.", "INVITE_ALREADY_ACCEPTED");

    const existing = vault.pendingInvites.find((invite) => invite.address === address);
    if (existing) fail("Pending invite already exists for this address.", "INVITE_ALREADY_EXISTS");

    vault.pendingInvites.push({
      address,
      invitedBy,
      invitedAt
    });
    return vault.pendingInvites[vault.pendingInvites.length - 1];
  }

  acceptPendingInvite({ vaultId, address }) {
    const vault = this.requireVault(vaultId);
    if (vault.type !== "team") fail("Invites are supported only for team vaults.", "INVALID_VAULT_TYPE");

    const inviteIndex = vault.pendingInvites.findIndex((invite) => invite.address === address);
    if (inviteIndex < 0) fail("Pending invite not found.", "INVITE_NOT_FOUND");

    const invite = vault.pendingInvites[inviteIndex];
    vault.pendingInvites.splice(inviteIndex, 1);
    if (!vault.authorized.includes(address)) {
      vault.authorized.push(address);
    }
    return invite;
  }

  revokePendingInvite({ vaultId, owner, pendingAddress }) {
    const vault = this.requireVault(vaultId);
    if (vault.type !== "team") fail("Invites are supported only for team vaults.", "INVALID_VAULT_TYPE");
    if (vault.owner !== owner) fail("Only vault owner can revoke invites.", "UNAUTHORIZED");

    const inviteIndex = vault.pendingInvites.findIndex((invite) => invite.address === pendingAddress);
    if (inviteIndex < 0) fail("Pending invite not found.", "INVITE_NOT_FOUND");
    const invite = vault.pendingInvites[inviteIndex];
    vault.pendingInvites.splice(inviteIndex, 1);
    return invite;
  }

  removeAuthorizedMember({ vaultId, owner, memberToRemove }) {
    const vault = this.requireVault(vaultId);
    if (vault.type !== "team") fail("Member removal is supported only for team vaults.", "INVALID_VAULT_TYPE");
    if (vault.owner !== owner) fail("Only vault owner can remove members.", "UNAUTHORIZED");
    if (memberToRemove === owner) fail("Owner cannot remove themselves.", "INVALID_OPERATION");

    const idx = vault.authorized.indexOf(memberToRemove);
    if (idx < 0) fail("Member not found in authorized list.", "MEMBER_NOT_FOUND");
    vault.authorized.splice(idx, 1);
    return vault;
  }

  listVaultURITokens({ vaultId, owner }) {
    const vault = this.requireVault(vaultId);
    if (vault.owner !== owner) fail("Only vault owner can list vault URI tokens.", "UNAUTHORIZED");
    const tokens = [];
    if (vault.manifestTokenId) tokens.push(vault.manifestTokenId);
    for (const entry of vault.entries) {
      if (entry.tokenId) tokens.push(entry.tokenId);
    }
    return tokens;
  }

  deleteVault({ vaultId, owner }) {
    const vault = this.requireVault(vaultId);
    if (vault.owner !== owner) fail("Only vault owner can revoke vault.", "UNAUTHORIZED");
    delete this.vaults[vaultId];
  }

  assertReadAccess(vault, actor) {
    if (vault.type === "team") {
      if (!vault.authorized.includes(actor)) fail("Caller is not authorized.", "UNAUTHORIZED");
      return;
    }
    if (vault.owner !== actor) fail("Only vault owner can read entries.", "UNAUTHORIZED");
  }

  assertWriteAccess(vault, actor) {
    if (vault.type === "team") {
      if (!vault.authorized.includes(actor)) fail("Caller is not authorized.", "UNAUTHORIZED");
      return;
    }
    if (vault.owner !== actor) fail("Only vault owner can add entries.", "UNAUTHORIZED");
  }
}

export function buildVaultId(owner, salt) {
  return crypto.createHash("sha256").update(`${owner}:${salt}`).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function compareCreatedAt(left, right) {
  const leftNum = Number(left);
  const rightNum = Number(right);
  if (Number.isFinite(leftNum) && Number.isFinite(rightNum)) {
    return leftNum - rightNum;
  }
  return String(left).localeCompare(String(right));
}

