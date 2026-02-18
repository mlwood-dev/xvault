import crypto from "node:crypto";
import argon2 from "argon2";

const ALG = "aes-256-gcm";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const SALT_BYTES = 16;

export async function deriveKey(passphrase, salt, options = {}) {
  const {
    timeCost = 3,
    memoryCost = 65536,
    parallelism = 1
  } = options;

  return argon2.hash(passphrase, {
    type: argon2.argon2id,
    raw: true,
    hashLength: KEY_BYTES,
    salt,
    timeCost,
    memoryCost,
    parallelism
  });
}

export async function encryptPayload(plaintext, passphrase, kdfOptions = {}) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const key = await deriveKey(passphrase, salt, kdfOptions);
  const cipher = crypto.createCipheriv(ALG, key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    alg: ALG,
    kdf: "argon2id",
    salt: salt.toString("base64"),
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: tag.toString("base64")
  };
}

export async function decryptPayload(payload, passphrase, kdfOptions = {}) {
  const salt = Buffer.from(payload.salt, "base64");
  const nonce = Buffer.from(payload.nonce, "base64");
  const ciphertext = Buffer.from(payload.ciphertext, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const key = await deriveKey(passphrase, salt, kdfOptions);

  const decipher = crypto.createDecipheriv(ALG, key, nonce);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

