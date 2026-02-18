import { webcrypto as nodeWebCrypto } from "node:crypto";
import secrets from "secrets.js-grempe";

const RECOVERY_VERSION = "xvault-recovery-v1";
const STRING_PREFIX = "str:";
const BYTES_PREFIX = "bin:";
const HEX_REGEX = /^[0-9a-fA-F]+$/;

/**
 * Generate Shamir Secret Sharing recovery shares from a secret.
 *
 * SECURITY: shares are sensitive and should be distributed over secure
 * offline/encrypted channels. A single share must not be enough to recover.
 *
 * @param {Uint8Array | string} secret
 * @param {number} totalShares
 * @param {number} threshold
 * @returns {Promise<{shareId: string, share: string}[]>}
 */
export async function generateRecoveryShares(secret, totalShares, threshold) {
  assertPositiveInt(totalShares, "totalShares");
  assertPositiveInt(threshold, "threshold");
  if (threshold > totalShares) {
    throw createRecoveryError("INVALID_THRESHOLD", "threshold cannot exceed totalShares.");
  }
  if (totalShares < 2) {
    throw createRecoveryError("INVALID_TOTAL_SHARES", "totalShares must be at least 2.");
  }

  const packed = packSecret(secret);
  const packedHex = bytesToHex(encodeUtf8(packed));
  const hexShares = secrets.share(packedHex, totalShares, threshold);

  return hexShares.map((shareHex) => ({
    shareId: randomId(),
    share: bytesToBase64(hexToBytes(shareHex))
  }));
}

/**
 * Combine recovery shares and reconstruct original secret.
 *
 * @param {string[]} shares
 * @returns {Promise<Uint8Array | string>}
 */
export async function combineShares(shares) {
  if (!Array.isArray(shares) || shares.length === 0) {
    throw createRecoveryError("INVALID_INPUT", "shares must be a non-empty array.");
  }

  const hexShares = shares.map((base64Share) => {
    assertNonEmptyString(base64Share, "share");
    return bytesToHex(base64ToBytes(base64Share));
  });

  const packedHex = secrets.combine(hexShares);
  const packed = decodeUtf8(hexToBytes(packedHex));

  if (packed.startsWith(STRING_PREFIX)) {
    return decodeUtf8(base64ToBytes(packed.slice(STRING_PREFIX.length)));
  }
  if (packed.startsWith(BYTES_PREFIX)) {
    return base64ToBytes(packed.slice(BYTES_PREFIX.length));
  }
  throw createRecoveryError("INVALID_RECOVERY_PAYLOAD", "Recovered payload has invalid prefix.");
}

/**
 * Derive a root key from recovery secret + vault salt.
 * Uses HKDF-SHA256 to produce 32-byte key material.
 *
 * @param {Uint8Array} secret
 * @param {string} vaultSaltHex
 * @returns {Promise<Uint8Array>}
 */
export async function deriveRecoveryRoot(secret, vaultSaltHex) {
  if (!(secret instanceof Uint8Array) || secret.length < 16) {
    throw createRecoveryError("INVALID_SECRET", "secret must be Uint8Array with length >= 16.");
  }
  assertHex(vaultSaltHex, "vaultSaltHex");

  const cryptoApi = getCryptoApi();
  const keyMaterial = await cryptoApi.subtle.importKey("raw", secret, "HKDF", false, ["deriveBits"]);
  const derivedBits = await cryptoApi.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: hexToBytes(vaultSaltHex),
      info: encodeUtf8(`${RECOVERY_VERSION}:root`)
    },
    keyMaterial,
    256
  );
  return new Uint8Array(derivedBits);
}

/**
 * Build non-sensitive recovery metadata for client manifest blob storage.
 *
 * @param {{ total: number, threshold: number, shareHashes?: string[] }} sharesInfo
 * @returns {{ version: string, scheme: string, total: number, threshold: number, shareHashes: string[] }}
 */
export function prepareRecoveryMetadata(sharesInfo) {
  if (!sharesInfo || typeof sharesInfo !== "object") {
    throw createRecoveryError("INVALID_INPUT", "sharesInfo must be an object.");
  }
  assertPositiveInt(sharesInfo.total, "sharesInfo.total");
  assertPositiveInt(sharesInfo.threshold, "sharesInfo.threshold");
  if (sharesInfo.threshold > sharesInfo.total) {
    throw createRecoveryError("INVALID_THRESHOLD", "threshold cannot exceed total.");
  }
  const shareHashes = sharesInfo.shareHashes ?? [];
  if (!Array.isArray(shareHashes)) {
    throw createRecoveryError("INVALID_INPUT", "shareHashes must be an array.");
  }

  return {
    version: RECOVERY_VERSION,
    scheme: "shamir",
    total: sharesInfo.total,
    threshold: sharesInfo.threshold,
    shareHashes
  };
}

function packSecret(secret) {
  if (typeof secret === "string") {
    assertNonEmptyString(secret, "secret");
    return `${STRING_PREFIX}${bytesToBase64(encodeUtf8(secret))}`;
  }
  if (secret instanceof Uint8Array) {
    if (secret.length < 16) {
      throw createRecoveryError("INVALID_SECRET", "binary secret must be at least 16 bytes.");
    }
    return `${BYTES_PREFIX}${bytesToBase64(secret)}`;
  }
  throw createRecoveryError("INVALID_SECRET", "secret must be Uint8Array or string.");
}

function getCryptoApi() {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.subtle) return globalThis.crypto;
  if (nodeWebCrypto?.subtle) return nodeWebCrypto;
  throw createRecoveryError("CRYPTO_UNAVAILABLE", "Web Crypto API is unavailable.");
}

function randomId() {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  if (nodeWebCrypto?.randomUUID) return nodeWebCrypto.randomUUID();
  return `share-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function assertPositiveInt(value, field) {
  if (!Number.isInteger(value) || value <= 0) {
    throw createRecoveryError("INVALID_INPUT", `${field} must be a positive integer.`);
  }
}

function assertNonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw createRecoveryError("INVALID_INPUT", `${field} must be a non-empty string.`);
  }
}

function assertHex(value, field) {
  assertNonEmptyString(value, field);
  if (!HEX_REGEX.test(value) || value.length % 2 !== 0) {
    throw createRecoveryError("INVALID_INPUT", `${field} must be an even-length hex string.`);
  }
}

function createRecoveryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function encodeUtf8(value) {
  return new TextEncoder().encode(value);
}

function decodeUtf8(value) {
  return new TextDecoder().decode(value);
}

function bytesToHex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

function hexToBytes(hex) {
  return new Uint8Array(Buffer.from(hex, "hex"));
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(value) {
  return new Uint8Array(Buffer.from(value, "base64"));
}

