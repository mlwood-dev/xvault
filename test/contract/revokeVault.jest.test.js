import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { Wallet } from "xahau";
import keypairs from "ripple-keypairs";
import { createIsolatedStateFile } from "../mocks/mockHotPocketState.js";
import { hashForSigning } from "../../src/contract/xrplUtils.js";

async function loadContract(teamMode = true) {
  process.env.XVAULT_STATE_FILE = createIsolatedStateFile();
  process.env.ENABLE_TEAM_MODE = teamMode ? "true" : "false";
  jest.resetModules();
  return import("../../src/contract/index.js");
}

function signPayload(payload, wallet) {
  return keypairs.sign(hashForSigning(payload), wallet.privateKey);
}

describe("revokeVault contract flow", () => {
  afterEach(() => {
    delete process.env.XVAULT_STATE_FILE;
    delete process.env.ENABLE_TEAM_MODE;
  });

  test("revokes individual vault and removes it from owner list", async () => {
    const { handleOperation } = await loadContract(false);
    const owner = Wallet.generate();

    const createPayload = { type: "individual", owner: owner.classicAddress, salt: "aabbccddeeff0011", metadata: {} };
    const created = await handleOperation(
      {
        type: "createVault",
        payload: {
          ...createPayload,
          signerPublicKey: owner.publicKey,
          signature: signPayload(createPayload, owner)
        }
      },
      {},
      { roundKey: "1" }
    );

    const revokeSigPayload = { vaultId: created.data.vaultId, confirm: false, action: "revokeVault" };
    const revoked = await handleOperation(
      {
        type: "revokeVault",
        payload: {
          vaultId: created.data.vaultId,
          confirm: false,
          signerPublicKey: owner.publicKey,
          signature: signPayload(revokeSigPayload, owner)
        }
      },
      {},
      { roundKey: "2" }
    );

    expect(revoked.data.success).toBe(true);
    expect(revoked.data.burnedTokens).toBe(1);

    const mine = await handleOperation({
      type: "getMyVaults",
      payload: { owner: owner.classicAddress }
    });
    expect(mine.data.length).toBe(0);
  });

  test("team vault revocation requires confirm=true", async () => {
    const { handleOperation } = await loadContract(true);
    const owner = Wallet.generate();

    const createPayload = {
      type: "team",
      owner: owner.classicAddress,
      salt: "1122334455667788",
      metadata: {},
      initialAuthorized: []
    };
    const created = await handleOperation(
      {
        type: "createTeamVault",
        payload: {
          ...createPayload,
          signerPublicKey: owner.publicKey,
          signature: signPayload(createPayload, owner)
        }
      },
      {},
      { roundKey: "10" }
    );

    await expect(
      handleOperation(
        {
          type: "revokeVault",
          payload: {
            vaultId: created.data.vaultId,
            confirm: false,
            signerPublicKey: owner.publicKey,
            signature: signPayload({ vaultId: created.data.vaultId, confirm: false, action: "revokeVault" }, owner)
          }
        },
        {},
        { roundKey: "11" }
      )
    ).rejects.toThrow("Team vault revocation requires confirm=true.");
  });

  test("non-existent vault and unauthorized signer fail", async () => {
    const { handleOperation } = await loadContract(true);
    const owner = Wallet.generate();
    const attacker = Wallet.generate();

    await expect(
      handleOperation(
        {
          type: "revokeVault",
          payload: {
            vaultId: "deadbeefdeadbeef",
            confirm: false,
            signerPublicKey: owner.publicKey,
            signature: signPayload({ vaultId: "deadbeefdeadbeef", confirm: false, action: "revokeVault" }, owner)
          }
        },
        {},
        { roundKey: "20" }
      )
    ).rejects.toThrow("Vault not found.");

    const createPayload = {
      type: "team",
      owner: owner.classicAddress,
      salt: "9988776655443322",
      metadata: {},
      initialAuthorized: []
    };
    const created = await handleOperation(
      {
        type: "createTeamVault",
        payload: {
          ...createPayload,
          signerPublicKey: owner.publicKey,
          signature: signPayload(createPayload, owner)
        }
      },
      {},
      { roundKey: "21" }
    );

    await expect(
      handleOperation(
        {
          type: "revokeVault",
          payload: {
            vaultId: created.data.vaultId,
            confirm: true,
            signerPublicKey: attacker.publicKey,
            signature: signPayload({ vaultId: created.data.vaultId, confirm: true, action: "revokeVault" }, attacker)
          }
        },
        {},
        { roundKey: "22" }
      )
    ).rejects.toThrow("Signer public key does not match expected Xahau address.");
  });
});
