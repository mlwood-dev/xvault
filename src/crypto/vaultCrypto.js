// SPDX-License-Identifier: MIT
import { webcrypto as nodeWebCrypto, randomBytes as nodeRandomBytes } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import { x25519, edwardsToMontgomeryPub } from "@noble/curves/ed25519";

const ARGON2_PARAMS = {
  memory: 65536,
  iterations: 3,
  parallelism: 1,
  hashLength: 32
};

const HEX_REGEX = /^[0-9a-fA-F]+$/;
const XRPL_ED25519_PUBKEY_REGEX = /^ED[0-9A-Fa-f]{64}$/;
const XRPL_SECP256K1_PUBKEY_REGEX = /^(02|03)[0-9A-Fa-f]{64}$/;

/**
 * Derive a 32-byte root key from user master password and vault salt.
 * Uses Argon2id in browser (argon2-browser) and Node fallback (argon2 package).
 *
 * @param {string} masterPassword
 * @param {string} saltHex
 * @returns {Promise<Uint8Array>}
 */
export async function deriveRootKey(masterPassword, saltHex) {
  assertNonEmptyString(masterPassword, "masterPassword");
  assertHex(saltHex, "saltHex");
  const salt = hexToBytes(saltHex);

  if (isBrowser()) {
    const argon2Browser = await import("argon2-browser");
    const result = await argon2Browser.hash({
      pass: masterPassword,
      salt,
      time: ARGON2_PARAMS.iterations,
      mem: ARGON2_PARAMS.memory,
      parallelism: ARGON2_PARAMS.parallelism,
      hashLen: ARGON2_PARAMS.hashLength,
      type: argon2Browser.ArgonType.Argon2id
    });
    return new Uint8Array(result.hash);
  }

  const argon2Node = await import("argon2");
  const raw = await argon2Node.hash(masterPassword, {
    type: argon2Node.argon2id,
    raw: true,
    hashLength: ARGON2_PARAMS.hashLength,
    salt,
    timeCost: ARGON2_PARAMS.iterations,
    memoryCost: ARGON2_PARAMS.memory,
    parallelism: ARGON2_PARAMS.parallelism
  });
  return new Uint8Array(raw);
}

/**
 * Encrypt entry data with AES-256-GCM and return transport-safe fields.
 *
 * @param {object} data
 * @param {Uint8Array} rootKey
 * @returns {Promise<{ciphertext: string, iv: string, tag: string}>}
 */
export async function encryptEntry(data, rootKey) {
  assertObject(data, "data");
  assertBytes(rootKey, 32, "rootKey");

  const cryptoApi = getCryptoApi();
  const iv = randomBytes(12);
  const aad = encodeUtf8("xvault:entry:v1");
  const plaintext = encodeUtf8(JSON.stringify(data));
  const cryptoKey = await cryptoApi.subtle.importKey("raw", rootKey, "AES-GCM", false, ["encrypt"]);
  const encrypted = new Uint8Array(
    await cryptoApi.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
      cryptoKey,
      plaintext
    )
  );

  const tag = encrypted.slice(encrypted.length - 16);
  const ciphertext = encrypted.slice(0, encrypted.length - 16);
  zeroize(plaintext);

  return {
    ciphertext: bytesToBase64(ciphertext),
    iv: bytesToBase64(iv),
    tag: bytesToBase64(tag)
  };
}

/**
 * Generate a random per-entry symmetric key.
 *
 * @returns {Promise<Uint8Array>}
 */
export async function generateEntryKey() {
  return randomBytes(32);
}

/**
 * Wrap an entry key for a specific recipient public key.
 * - secp256k1 recipient: ECDH over secp256k1
 * - ed25519 recipient (XRPL "ED..."): converted to x25519 for ECDH
 * Then HKDF-SHA256 derives wrapping key, AES-256-GCM encrypts entryKey.
 *
 * @param {Uint8Array} entryKey
 * @param {string} recipientPubKeyHex
 * @returns {Promise<string>} base64-encoded envelope JSON
 */
export async function wrapKeyForUser(entryKey, recipientPubKeyHex) {
  assertBytes(entryKey, 32, "entryKey");
  assertNonEmptyString(recipientPubKeyHex, "recipientPubKeyHex");

  const envelope = await buildWrappedEnvelope(entryKey, recipientPubKeyHex);
  return bytesToBase64(encodeUtf8(JSON.stringify(envelope)));
}

/**
 * Prepare payload for contract addEntry input.
 * Individual vault: encrypt with rootKey, no wrappedKeys.
 * Team vault: generate entryKey, encrypt entry with entryKey, wrap per recipient.
 *
 * @param {"individual"|"team"} vaultType
 * @param {object} data
 * @param {Uint8Array} rootKey
 * @param {{address: string, pubKey: string}[]} [authorizedPubKeys]
 * @param {string} [cid]
 * @returns {Promise<{
 *   encryptedBlob: string,
 *   entryMetadata: {service: string, username?: string, notes?: string},
 *   cid: string,
 *   wrappedKeys?: {address: string, encryptedKey: string}[]
 * }>}
 */
export async function prepareEntryPayload(
  vaultType,
  data,
  rootKey,
  authorizedPubKeys = [],
  cid = ""
) {
  if (vaultType !== "individual" && vaultType !== "team") {
    throw createCryptoError("INVALID_VAULT_TYPE", "vaultType must be 'individual' or 'team'.");
  }
  assertObject(data, "data");
  assertBytes(rootKey, 32, "rootKey");

  const entryMetadata = extractEntryMetadata(data);
  if (!entryMetadata.service) {
    throw createCryptoError("INVALID_INPUT", "data.service is required for entryMetadata.");
  }

  let encryptionKey = rootKey;
  let wrappedKeys;

  if (vaultType === "team") {
    if (!Array.isArray(authorizedPubKeys) || authorizedPubKeys.length === 0) {
      throw createCryptoError("INVALID_INPUT", "authorizedPubKeys is required for team vault payload.");
    }
    const entryKey = await generateEntryKey();
    encryptionKey = entryKey;

    wrappedKeys = [];
    for (const item of authorizedPubKeys) {
      assertObject(item, "authorizedPubKeys[]");
      assertNonEmptyString(item.address, "authorizedPubKeys[].address");
      assertNonEmptyString(item.pubKey, "authorizedPubKeys[].pubKey");
      const encryptedKey = await wrapKeyForUser(entryKey, item.pubKey);
      wrappedKeys.push({ address: item.address, encryptedKey });
    }
    zeroize(entryKey);
  }

  const encrypted = await encryptEntry(data, encryptionKey);
  const encryptedBlobEnvelope = {
    v: 1,
    alg: "AES-256-GCM",
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    tag: encrypted.tag
  };

  const payload = {
    encryptedBlob: bytesToBase64(encodeUtf8(JSON.stringify(encryptedBlobEnvelope))),
    entryMetadata,
    cid
  };
  if (wrappedKeys && wrappedKeys.length > 0) {
    payload.wrappedKeys = wrappedKeys;
  }
  return payload;
}

/**
 * Overwrite sensitive byte arrays in-place.
 *
 * @param {Uint8Array} bytes
 */
export function zeroize(bytes) {
  if (bytes instanceof Uint8Array) bytes.fill(0);
}

/**
 * Constant-time byte equality check.
 *
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @returns {boolean}
 */
export function constantTimeEqual(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function buildWrappedEnvelope(entryKey, recipientPubKeyHex) {
  const { curve, recipientPub, ephPriv, ephPub, sharedSecret } = deriveSharedSecret(recipientPubKeyHex);
  const cryptoApi = getCryptoApi();
  const salt = randomBytes(16);
  const kek = await deriveHkdfKey(sharedSecret, salt, encodeUtf8("xvault:wrap-key:v1"), 32);
  const iv = randomBytes(12);
  const key = await cryptoApi.subtle.importKey("raw", kek, "AES-GCM", false, ["encrypt"]);
  const encrypted = new Uint8Array(
    await cryptoApi.subtle.encrypt({ name: "AES-GCM", iv, tagLength: 128 }, key, entryKey)
  );

  zeroize(sharedSecret);
  zeroize(kek);
  zeroize(ephPriv);

  return {
    v: 1,
    curve,
    recipientPubKey: recipientPub,
    ephPubKey: bytesToHex(ephPub),
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    wrappedKey: bytesToBase64(encrypted)
  };
}

function deriveSharedSecret(recipientPubKeyHex) {
  if (XRPL_ED25519_PUBKEY_REGEX.test(recipientPubKeyHex)) {
    const edPub = hexToBytes(recipientPubKeyHex.slice(2));
    const xPub = edwardsToMontgomeryPub(edPub);
    const ephPriv = randomBytes(32);
    const ephPub = x25519.getPublicKey(ephPriv);
    const sharedSecret = x25519.getSharedSecret(ephPriv, xPub);
    return {
      curve: "x25519(ed25519-recipient)",
      recipientPub: recipientPubKeyHex,
      ephPriv,
      ephPub,
      sharedSecret: new Uint8Array(sharedSecret)
    };
  }

  if (XRPL_SECP256K1_PUBKEY_REGEX.test(recipientPubKeyHex)) {
    const recipientPub = hexToBytes(recipientPubKeyHex);
    const ephPriv = secp256k1.utils.randomPrivateKey();
    const ephPub = secp256k1.getPublicKey(ephPriv, true);
    const shared = secp256k1.getSharedSecret(ephPriv, recipientPub, true);
    return {
      curve: "secp256k1",
      recipientPub: recipientPubKeyHex,
      ephPriv: new Uint8Array(ephPriv),
      ephPub: new Uint8Array(ephPub),
      sharedSecret: new Uint8Array(shared)
    };
  }

  throw createCryptoError(
    "UNSUPPORTED_PUBKEY",
    "recipientPubKeyHex must be XRPL ED-prefixed Ed25519 or compressed secp256k1 public key."
  );
}

async function deriveHkdfKey(ikm, salt, info, outLen) {
  const cryptoApi = getCryptoApi();
  const keyMaterial = await cryptoApi.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const derivedBits = await cryptoApi.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    keyMaterial,
    outLen * 8
  );
  return new Uint8Array(derivedBits);
}

function extractEntryMetadata(data) {
  return {
    service: data.service,
    username: data.username,
    notes: data.notes
  };
}

function randomBytes(length) {
  const cryptoApi = getCryptoApi();
  if (typeof cryptoApi.getRandomValues === "function") {
    return cryptoApi.getRandomValues(new Uint8Array(length));
  }
  return new Uint8Array(nodeRandomBytes(length));
}

function getCryptoApi() {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.subtle) return globalThis.crypto;
  if (nodeWebCrypto?.subtle) return nodeWebCrypto;
  throw createCryptoError("CRYPTO_UNAVAILABLE", "Web Crypto API is unavailable.");
}

function isBrowser() {
  return typeof window !== "undefined" && typeof window.document !== "undefined";
}

function assertObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw createCryptoError("INVALID_INPUT", `${name} must be an object.`);
  }
}

function assertBytes(value, expectedLength, name) {
  if (!(value instanceof Uint8Array) || value.length !== expectedLength) {
    throw createCryptoError("INVALID_INPUT", `${name} must be Uint8Array(${expectedLength}).`);
  }
}

function assertHex(value, name) {
  assertNonEmptyString(value, name);
  if (!HEX_REGEX.test(value) || value.length % 2 !== 0) {
    throw createCryptoError("INVALID_INPUT", `${name} must be an even-length hex string.`);
  }
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw createCryptoError("INVALID_INPUT", `${name} must be a non-empty string.`);
  }
}

function createCryptoError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function encodeUtf8(value) {
  return new TextEncoder().encode(value);
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

