import { describe, expect, test } from "vitest";
import { decryptPayload, encryptPayload } from "../src/client/crypto.js";

describe("crypto module", () => {
  test("encrypts and decrypts payload", async () => {
    const secret = "apiKey=super-secret-value";
    const passphrase = "correct horse battery staple";

    const encrypted = await encryptPayload(secret, passphrase, {
      timeCost: 2,
      memoryCost: 32768
    });
    const decrypted = await decryptPayload(encrypted, passphrase, {
      timeCost: 2,
      memoryCost: 32768
    });

    expect(decrypted).toBe(secret);
  });

  test("detects tampering through GCM tag", async () => {
    const encrypted = await encryptPayload("xvault-secret", "passphrase-1", {
      timeCost: 2,
      memoryCost: 32768
    });

    const tampered = { ...encrypted, ciphertext: encrypted.ciphertext.slice(0, -2) + "AA" };

    await expect(
      decryptPayload(tampered, "passphrase-1", {
        timeCost: 2,
        memoryCost: 32768
      })
    ).rejects.toThrow();
  });
});
