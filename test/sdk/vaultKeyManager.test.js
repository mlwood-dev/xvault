import { describe, expect, test } from "vitest";
import keypairs from "ripple-keypairs";
import { Wallet } from "xahau";
import { VaultKeyManager } from "../../src/sdk/VaultKeyManager.ts";

function createXamanMock(wallet) {
  return {
    signIn: async (input) => {
      const challenge = typeof input === "string" ? input : input.challenge;
      const messageHex = isHex(challenge) ? challenge : Buffer.from(challenge, "utf8").toString("hex");
      const signature = keypairs.sign(messageHex, wallet.privateKey);
      return {
        signature,
        publicKey: wallet.publicKey,
        account: wallet.classicAddress
      };
    }
  };
}

function createHotPocketMock() {
  const metadataByVault = new Map();
  return {
    submit: async (operation) => {
      if (operation.type === "addPasswordBackup") {
        metadataByVault.set(operation.payload.vaultId, { passwordBackup: operation.payload.passwordBackup });
        return { ok: true, data: {} };
      }
      if (operation.type === "removePasswordBackup") {
        metadataByVault.delete(operation.payload.vaultId);
        return { ok: true, data: {} };
      }
      if (operation.type === "getVaultMetadata") {
        return {
          ok: true,
          data: { metadata: metadataByVault.get(operation.payload.vaultId) ?? {} }
        };
      }
      return { ok: false, error: "unsupported" };
    }
  };
}

function isHex(value) {
  return /^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0;
}

describe("VaultKeyManager", () => {
  test("adds and unlocks password backup", async () => {
    const wallet = Wallet.generate();
    const xaman = createXamanMock(wallet);
    const hotpocket = createHotPocketMock();
    const xahauClient = { isConnected: () => true };
    const manager = new VaultKeyManager(xahauClient, xaman, hotpocket);

    const vaultId = "vault-test-001";
    const password = "Correct Horse Battery Staple 123!";

    const xamanUnlock = await manager.unlockWithXaman(vaultId);
    await manager.addPasswordBackup(vaultId, password);
    const passwordUnlock = await manager.unlockWithPasswordBackup(vaultId, password);

    expect(Buffer.from(passwordUnlock.masterKey).equals(Buffer.from(xamanUnlock.masterKey))).toBe(true);
  });

  test("removes password backup metadata", async () => {
    const wallet = Wallet.generate();
    const xaman = createXamanMock(wallet);
    const hotpocket = createHotPocketMock();
    const xahauClient = { isConnected: () => true };
    const manager = new VaultKeyManager(xahauClient, xaman, hotpocket);

    const vaultId = "vault-test-002";
    const password = "Another Strong Passphrase 456!";

    await manager.addPasswordBackup(vaultId, password);
    await manager.removePasswordBackup(vaultId);

    await expect(manager.unlockWithPasswordBackup(vaultId, password)).rejects.toThrow(
      "No password backup metadata found"
    );
  });
});
