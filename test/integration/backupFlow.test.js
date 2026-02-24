import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import keypairs from "ripple-keypairs";
import { Wallet } from "xahau";
import { VaultKeyManager } from "../../src/sdk/VaultKeyManager.ts";
import { hashForSigning } from "../../src/contract/xrplUtils.js";

async function loadContract() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xvault-vitest-"));
  const stateFile = path.join(tempRoot, "state.json");
  process.env.XVAULT_STATE_FILE = stateFile;
  vi.resetModules();
  return import("../../src/contract/index.js");
}

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

function isHex(value) {
  return /^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0;
}

describe("integration: create -> add backup -> unlock", () => {
  afterEach(() => {
    delete process.env.XVAULT_STATE_FILE;
  });

  test("round-trip master key via password backup", async () => {
    const { handleOperation } = await loadContract();
    const owner = Wallet.generate();
    const roundCounter = { value: 1 };
    const hotpocket = {
      submit: async (operation) =>
        handleOperation(operation, {}, { roundKey: String(roundCounter.value++) })
    };

    const createPayload = {
      type: "individual",
      owner: owner.classicAddress,
      salt: "aabbccddeeff0011",
      metadata: {}
    };
    const createSignature = keypairs.sign(hashForSigning(createPayload), owner.privateKey);
    const created = await hotpocket.submit({
      type: "createVault",
      payload: {
        ...createPayload,
        signerPublicKey: owner.publicKey,
        signature: createSignature
      }
    });
    expect(created.ok).toBe(true);

    const vaultId = created.data.vaultId;
    const xaman = createXamanMock(owner);
    const xahauClient = { isConnected: () => true };
    const manager = new VaultKeyManager(xahauClient, xaman, hotpocket);

    const password = "Integration Strong Passphrase 789!";
    const masterFromXaman = await manager.unlockWithXaman(vaultId);
    await manager.addPasswordBackup(vaultId, password);
    const masterFromPassword = await manager.unlockWithPasswordBackup(vaultId, password);

    expect(Buffer.from(masterFromPassword.masterKey).equals(Buffer.from(masterFromXaman.masterKey))).toBe(true);
  });
});
