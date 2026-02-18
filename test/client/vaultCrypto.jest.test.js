import { webcrypto } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import { describe, expect, test } from "@jest/globals";
import {
  constantTimeEqual,
  deriveRootKey,
  encryptEntry,
  prepareEntryPayload,
  wrapKeyForUser
} from "../../src/crypto/vaultCrypto.js";

describe("vaultCrypto client module", () => {
  test("deriveRootKey is deterministic for same password+salt", async () => {
    const saltHex = "aabbccddeeff00112233445566778899";
    const a = await deriveRootKey("pass-1", saltHex);
    const b = await deriveRootKey("pass-1", saltHex);
    expect(constantTimeEqual(a, b)).toBe(true);
    expect(a.length).toBe(32);
  });

  test("encryptEntry can be decrypted with same key", async () => {
    const rootKey = new Uint8Array(32).fill(7);
    const data = { service: "gmail", username: "alice", secret: "top-secret" };
    const encrypted = await encryptEntry(data, rootKey);

    const key = await webcrypto.subtle.importKey("raw", rootKey, "AES-GCM", false, ["decrypt"]);
    const aad = new TextEncoder().encode("xvault:entry:v1");
    const ciphertext = Buffer.from(encrypted.ciphertext, "base64");
    const tag = Buffer.from(encrypted.tag, "base64");
    const merged = new Uint8Array([...ciphertext, ...tag]);
    const plaintext = await webcrypto.subtle.decrypt(
      { name: "AES-GCM", iv: Buffer.from(encrypted.iv, "base64"), additionalData: aad, tagLength: 128 },
      key,
      merged
    );
    const parsed = JSON.parse(Buffer.from(plaintext).toString("utf8"));
    expect(parsed.secret).toBe("top-secret");
  });

  test("wrapKeyForUser produces decryptable wrapped key envelope", async () => {
    const recipientPriv = secp256k1.utils.randomPrivateKey();
    const recipientPub = secp256k1.getPublicKey(recipientPriv, true);
    const recipientPubHex = Buffer.from(recipientPub).toString("hex");

    const entryKey = new Uint8Array(32).fill(9);
    const wrapped = await wrapKeyForUser(entryKey, recipientPubHex);
    const envelope = JSON.parse(Buffer.from(wrapped, "base64").toString("utf8"));

    const ephPub = Buffer.from(envelope.ephPubKey, "hex");
    const shared = secp256k1.getSharedSecret(recipientPriv, ephPub, true);
    const hkdfKeyMaterial = await webcrypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveBits"]);
    const derivedBits = await webcrypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: Buffer.from(envelope.salt, "base64"),
        info: new TextEncoder().encode("xvault:wrap-key:v1")
      },
      hkdfKeyMaterial,
      256
    );
    const kek = new Uint8Array(derivedBits);
    const aesKey = await webcrypto.subtle.importKey("raw", kek, "AES-GCM", false, ["decrypt"]);
    const decrypted = await webcrypto.subtle.decrypt(
      { name: "AES-GCM", iv: Buffer.from(envelope.iv, "base64"), tagLength: 128 },
      aesKey,
      Buffer.from(envelope.wrappedKey, "base64")
    );

    expect(constantTimeEqual(new Uint8Array(decrypted), entryKey)).toBe(true);
  });

  test("prepareEntryPayload supports individual and team formats", async () => {
    const rootKey = new Uint8Array(32).fill(3);
    const data = { service: "notion", username: "bob", notes: "shared" };

    const individual = await prepareEntryPayload("individual", data, rootKey);
    expect(individual.wrappedKeys).toBeUndefined();

    const recipientPriv = secp256k1.utils.randomPrivateKey();
    const recipientPub = secp256k1.getPublicKey(recipientPriv, true);
    const team = await prepareEntryPayload("team", data, rootKey, [
      {
        address: "rExampleMember",
        pubKey: Buffer.from(recipientPub).toString("hex")
      }
    ]);
    expect(Array.isArray(team.wrappedKeys)).toBe(true);
    expect(team.wrappedKeys.length).toBe(1);
  });
});
