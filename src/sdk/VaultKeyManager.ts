// SPDX-License-Identifier: MIT
import argon2 from "argon2";
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { deriveAddress } from "xahau";
import type { Client } from "xahau";
import type { PasswordBackupEnvelope, VaultKeyMaterial } from "../types.js";

type UnlockMethod = "xaman" | "password";

type HotPocketClientLike = {
  submit?: (operation: { type: string; payload: object }) => Promise<any>;
  submitContractRequest?: (operation: { type: string; payload: object }) => Promise<any>;
  send?: (operation: { type: string; payload: object }) => Promise<any>;
};

type XamanSignInResponse = {
  signature?: string;
  signatureHex?: string;
  signedMessage?: string;
  publicKey?: string;
  public_key?: string;
  pubkey?: string;
  account?: string;
  address?: string;
  response?: {
    signature?: string;
    pubkey?: string;
    publicKey?: string;
    account?: string;
    address?: string;
  };
};

type XamanClientLike = {
  signIn?: (input: string | { challenge: string; statement?: string; purpose?: string }) => Promise<XamanSignInResponse>;
};

type XamanIdentity = {
  account: string;
  publicKey: string;
};

const MASTER_KEY_CHALLENGE_PREFIX = "xVault-master-key-v1:";
const MASTER_KEY_INFO = "xvault:master-key:v1";
const PASSWORD_BACKUP_VERSION = 1;
const ARGON2ID_PARAMS = {
  type: "argon2id",
  memoryCost: 131072,
  timeCost: 4,
  parallelism: 4,
  hashLength: 32,
  version: 0x13
} as const;

/**
 * VaultKeyManager derives and unwraps per-vault master keys.
 *
 * SECURITY:
 * - Contract never receives plaintext keys or passwords.
 * - Xaman sign-in is used to derive a stable master key via HKDF.
 * - Password backup is optional, client-managed, and stored only as ciphertext metadata.
 */
export class VaultKeyManager {
  private readonly xahauClient: Client;
  private readonly xaman: XamanClientLike;
  private readonly hotPocketClient: HotPocketClientLike;
  private cachedIdentity: XamanIdentity | null = null;

  /**
   * @param xahauClient Xahau client (XRPL-compatible, used for shared SDK context).
   * @param xaman Xaman SDK instance (must support signIn()).
   * @param hotPocketClient HotPocket transport or client used to submit ops.
   */
  constructor(xahauClient: Client, xaman: XamanClientLike, hotPocketClient: HotPocketClientLike) {
    if (!xahauClient) throw new Error("xahauClient is required.");
    if (!xaman || typeof xaman.signIn !== "function") {
      throw new Error("xaman with signIn() is required.");
    }
    if (!hotPocketClient) throw new Error("hotPocketClient is required.");
    this.xahauClient = xahauClient;
    this.xaman = xaman;
    this.hotPocketClient = hotPocketClient;
  }

  /**
   * Unlock a vault master key using Xaman or password backup.
   *
   * @param vaultId
   * @param opts method defaults to "xaman"
   * @returns VaultKeyMaterial containing 32-byte masterKey
   */
  async unlock(
    vaultId: string,
    opts?: { method?: UnlockMethod; password?: string }
  ): Promise<VaultKeyMaterial> {
    assertNonEmptyString(vaultId, "vaultId");
    const method = opts?.method ?? "xaman";
    if (method === "password") {
      if (!opts?.password) {
        throw new Error("password is required for password unlock.");
      }
      return this.unlockWithPasswordBackup(vaultId, opts.password);
    }
    return this.unlockWithXaman(vaultId);
  }

  /**
   * Derive a stable 32-byte master key using Xaman SignIn signature + HKDF.
   *
   * SECURITY: the challenge is fixed and vault-scoped.
   */
  async unlockWithXaman(vaultId: string): Promise<VaultKeyMaterial> {
    assertNonEmptyString(vaultId, "vaultId");
    const challenge = `${MASTER_KEY_CHALLENGE_PREFIX}${vaultId}`;
    const signed = await this.requestXamanSignature(challenge, `Unlock XVault master key ${vaultId}`);
    const signatureBytes = decodeSignatureBytes(signed.signature);
    const masterKey = hkdfSync(
      "sha256",
      signatureBytes,
      Buffer.from(vaultId, "utf8"),
      Buffer.from(MASTER_KEY_INFO, "utf8"),
      32
    );
    return {
      vaultId,
      masterKey: new Uint8Array(masterKey),
      method: "xaman"
    };
  }

  /**
   * Unlock with password backup stored in contract metadata.
   *
   * SECURITY: Argon2id derives the AES-256-GCM key, vaultId is AAD.
   */
  async unlockWithPasswordBackup(vaultId: string, password: string): Promise<VaultKeyMaterial> {
    assertNonEmptyString(vaultId, "vaultId");
    assertNonEmptyString(password, "password");
    const metadata = await this.fetchVaultMetadata(vaultId);
    const backup = extractPasswordBackup(metadata, vaultId);
    const key = await derivePasswordKey(password, backup.salt);
    try {
      const masterKey = decryptBackup(backup, key, vaultId);
      return {
        vaultId,
        masterKey,
        method: "password"
      };
    } finally {
      zeroize(key);
    }
  }

  /**
   * Add an encrypted password backup to contract metadata.
   *
   * SECURITY: Xaman unlock first, password backup encrypts master key locally.
   */
  async addPasswordBackup(vaultId: string, password: string): Promise<void> {
    assertNonEmptyString(vaultId, "vaultId");
    assertNonEmptyString(password, "password");

    const unlocked = await this.unlockWithXaman(vaultId);
    try {
      const envelope = await encryptBackup(unlocked.masterKey, password, vaultId);
      const identity = await this.ensureIdentity();
      const signPayload = {
        vaultId,
        actor: identity.account,
        action: "addPasswordBackup",
        passwordBackup: envelope
      };
      const signature = await this.signContractPayload(signPayload, "Add password backup");
      const response = await this.submitContractRequest({
        type: "addPasswordBackup",
        payload: {
          ...signPayload,
          signerPublicKey: signature.publicKey,
          signature: signature.signature
        }
      });
      assertOkResponse(response, "addPasswordBackup");
    } finally {
      zeroize(unlocked.masterKey);
    }
  }

  /**
   * Remove password backup metadata from the vault.
   */
  async removePasswordBackup(vaultId: string): Promise<void> {
    assertNonEmptyString(vaultId, "vaultId");
    const identity = await this.ensureIdentity();
    const signPayload = {
      vaultId,
      actor: identity.account,
      action: "removePasswordBackup"
    };
    const signature = await this.signContractPayload(signPayload, "Remove password backup");
    const response = await this.submitContractRequest({
      type: "removePasswordBackup",
      payload: {
        ...signPayload,
        signerPublicKey: signature.publicKey,
        signature: signature.signature
      }
    });
    assertOkResponse(response, "removePasswordBackup");
  }

  private async fetchVaultMetadata(vaultId: string): Promise<Record<string, any>> {
    const identity = await this.ensureIdentity();
    const signPayload = {
      vaultId,
      actor: identity.account,
      action: "getVaultMetadata"
    };
    const signature = await this.signContractPayload(signPayload, "Get vault metadata");
    const response = await this.submitContractRequest({
      type: "getVaultMetadata",
      payload: {
        ...signPayload,
        signerPublicKey: signature.publicKey,
        signature: signature.signature
      }
    });
    assertOkResponse(response, "getVaultMetadata");
    return response.data?.metadata ?? {};
  }

  private async ensureIdentity(): Promise<XamanIdentity> {
    if (this.cachedIdentity) return this.cachedIdentity;
    if (typeof this.xahauClient.isConnected === "function") {
      this.xahauClient.isConnected();
    }
    const result = await this.requestXamanSignature("xvault-identity", "Authorize XVault operations");
    this.cachedIdentity = { account: result.account, publicKey: result.publicKey };
    return this.cachedIdentity;
  }

  private async requestXamanSignature(
    challenge: string,
    purpose: string
  ): Promise<{ signature: string; publicKey: string; account: string }> {
    let result: XamanSignInResponse | undefined;
    try {
      result = await this.xaman.signIn?.({ challenge, statement: purpose, purpose });
    } catch {
      result = await this.xaman.signIn?.(challenge);
    }
    if (!result) {
      throw new Error("Xaman signIn did not return a response.");
    }
    const signature =
      result.signature ??
      result.signatureHex ??
      result.signedMessage ??
      result.response?.signature ??
      "";
    const publicKey =
      result.publicKey ??
      result.public_key ??
      result.pubkey ??
      result.response?.publicKey ??
      result.response?.pubkey ??
      "";
    if (!signature || !publicKey) {
      throw new Error("Xaman signIn response missing signature or public key.");
    }
    const account = result.account ?? result.address ?? result.response?.account ?? result.response?.address ?? "";
    const derivedAccount = account || deriveAddress(publicKey);
    this.cachedIdentity = { account: derivedAccount, publicKey };
    return { signature, publicKey, account: derivedAccount };
  }

  private async signContractPayload(payload: Record<string, any>, purpose: string) {
    const digest = hashForSigning(payload);
    const signed = await this.requestXamanSignature(digest, purpose);
    if (payload.actor && signed.account !== payload.actor) {
      throw new Error("Xaman account does not match payload actor.");
    }
    return { signature: signed.signature, publicKey: signed.publicKey, account: signed.account };
  }

  private async submitContractRequest(operation: { type: string; payload: object }) {
    if (this.hotPocketClient.submitContractRequest) {
      return this.hotPocketClient.submitContractRequest(operation);
    }
    if (this.hotPocketClient.submit) {
      return this.hotPocketClient.submit(operation);
    }
    if (this.hotPocketClient.send) {
      return this.hotPocketClient.send(operation);
    }
    throw new Error("hotPocketClient does not support submitContractRequest/submit/send.");
  }
}

function extractPasswordBackup(metadata: Record<string, any>, vaultId: string): PasswordBackupEnvelope {
  const backup = metadata?.passwordBackup ?? metadata?.backup ?? null;
  if (!backup || typeof backup !== "object") {
    throw new Error("No password backup metadata found for this vault.");
  }
  const envelope = backup as PasswordBackupEnvelope;
  if (envelope.version !== PASSWORD_BACKUP_VERSION) {
    throw new Error(`Unsupported password backup version: ${envelope.version}`);
  }
  if (envelope.vaultId !== vaultId) {
    throw new Error("Password backup vaultId mismatch.");
  }
  assertBase64(envelope.salt, "passwordBackup.salt");
  assertBase64(envelope.nonce, "passwordBackup.nonce");
  assertBase64(envelope.authTag, "passwordBackup.authTag");
  assertBase64(envelope.ciphertext, "passwordBackup.ciphertext");
  return envelope;
}

async function derivePasswordKey(password: string, saltB64: string): Promise<Uint8Array> {
  const salt = Buffer.from(saltB64, "base64");
  const raw = await argon2.hash(password, {
    type: argon2.argon2id,
    raw: true,
    hashLength: ARGON2ID_PARAMS.hashLength,
    salt,
    timeCost: ARGON2ID_PARAMS.timeCost,
    memoryCost: ARGON2ID_PARAMS.memoryCost,
    parallelism: ARGON2ID_PARAMS.parallelism,
    version: ARGON2ID_PARAMS.version
  });
  return new Uint8Array(raw);
}

async function encryptBackup(masterKey: Uint8Array, password: string, vaultId: string): Promise<PasswordBackupEnvelope> {
  assertBytes(masterKey, 32, "masterKey");
  assertNonEmptyString(password, "password");
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const key = await derivePasswordKey(password, Buffer.from(salt).toString("base64"));
  try {
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(vaultId, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(masterKey)), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      version: PASSWORD_BACKUP_VERSION,
      vaultId,
      salt: Buffer.from(salt).toString("base64"),
      nonce: Buffer.from(nonce).toString("base64"),
      authTag: Buffer.from(authTag).toString("base64"),
      ciphertext: ciphertext.toString("base64")
    };
  } finally {
    zeroize(key);
  }
}

function decryptBackup(backup: PasswordBackupEnvelope, key: Uint8Array, vaultId: string): Uint8Array {
  const nonce = Buffer.from(backup.nonce, "base64");
  const ciphertext = Buffer.from(backup.ciphertext, "base64");
  const authTag = Buffer.from(backup.authTag, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(Buffer.from(vaultId, "utf8"));
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (plaintext.length !== 32) {
    throw new Error("Invalid master key length after decrypt.");
  }
  return new Uint8Array(plaintext);
}

function decodeSignatureBytes(signature: string): Buffer {
  if (isHex(signature)) return Buffer.from(signature, "hex");
  return Buffer.from(signature, "base64");
}

function hashForSigning(payload: Record<string, any>): string {
  const stable = stableStringify(payload);
  return sha256Hex(stable);
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableStringify(value: any): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertOkResponse(response: any, op: string) {
  if (!response?.ok) {
    const message = response?.error ?? `${op} failed.`;
    const error = new Error(message);
    (error as any).code = response?.code ?? "CONTRACT_ERROR";
    throw error;
  }
}

function assertNonEmptyString(value: string, field: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
}

function assertBytes(value: Uint8Array, length: number, field: string) {
  if (!(value instanceof Uint8Array) || value.length !== length) {
    throw new Error(`${field} must be Uint8Array(${length}).`);
  }
}

function assertBase64(value: string, field: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty base64 string.`);
  }
  const roundTrip = Buffer.from(value, "base64").toString("base64");
  if (roundTrip.replace(/=+$/, "") !== value.replace(/=+$/, "")) {
    throw new Error(`${field} is not valid base64.`);
  }
}

function isHex(value: string): boolean {
  return /^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0;
}

function zeroize(bytes: Uint8Array) {
  if (bytes instanceof Uint8Array) bytes.fill(0);
}
