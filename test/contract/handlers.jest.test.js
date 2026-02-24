import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { Wallet } from "xahau";
import keypairs from "ripple-keypairs";
import { createIsolatedStateFile } from "../mocks/mockHotPocketState.js";
import { hashForSigning } from "../../src/contract/xrplUtils.js";

async function loadContract() {
  const stateFile = createIsolatedStateFile();
  process.env.XVAULT_STATE_FILE = stateFile;
  process.env.ENABLE_TEAM_MODE = "true";
  jest.resetModules();
  return import("../../src/contract/index.js");
}

function signPayload(payload, wallet) {
  const digest = hashForSigning(payload);
  return keypairs.sign(digest, wallet.privateKey);
}

describe("Contract handlers integration behavior", () => {
  afterEach(() => {
    delete process.env.XVAULT_STATE_FILE;
    delete process.env.ENABLE_TEAM_MODE;
  });

  test("createVault and addEntry persist state and return cid/token", async () => {
    const { handleOperation } = await loadContract();
    const owner = Wallet.generate();
    const createPayload = {
      type: "individual",
      owner: owner.classicAddress,
      salt: "aabbccddeeff0011",
      metadata: {}
    };

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

    const addPayload = {
      vaultId: created.data.vaultId,
      owner: owner.classicAddress,
      encryptedBlob: Buffer.from("ciphertext").toString("base64"),
      cid: "bafybeigdyrztf4f6xsl54n4xq4m5gxezm5q4za2ojx6x7lf5y3w4f4xhqy",
      entryMetadata: { service: "github" }
    };
    const addSigPayload = {
      vaultId: created.data.vaultId,
      actor: owner.classicAddress,
      encryptedBlob: addPayload.encryptedBlob,
      cid: addPayload.cid,
      entryMetadata: addPayload.entryMetadata,
      wrappedKeys: []
    };
    const added = await handleOperation(
      {
        type: "addEntry",
        payload: {
          ...addPayload,
          signerPublicKey: owner.publicKey,
          signature: signPayload(addSigPayload, owner)
        }
      },
      {},
      { roundKey: "2" }
    );

    expect(created.ok).toBe(true);
    expect(added.data.cid).toBeTruthy();
    expect(added.data.tokenId).toBeTruthy();
  });

  test("team invite accept remove flow enforces access", async () => {
    const { handleOperation } = await loadContract();
    const owner = Wallet.generate();
    const member = Wallet.generate();
    const teamPayload = {
      type: "team",
      owner: owner.classicAddress,
      salt: "1122334455667788",
      metadata: {},
      initialAuthorized: []
    };

    const team = await handleOperation(
      {
        type: "createTeamVault",
        payload: {
          ...teamPayload,
          signerPublicKey: owner.publicKey,
          signature: signPayload(teamPayload, owner)
        }
      },
      {},
      { roundKey: "10" }
    );

    const invitePayload = {
      vaultId: team.data.vaultId,
      invitee: member.classicAddress,
      action: "inviteToVault"
    };
    const invited = await handleOperation(
      {
        type: "inviteToVault",
        payload: {
          ...invitePayload,
          signerPublicKey: owner.publicKey,
          signature: signPayload(invitePayload, owner)
        }
      },
      {},
      { roundKey: "11" }
    );
    expect(invited.data.pendingInviteCount).toBe(1);

    const acceptPayload = {
      vaultId: team.data.vaultId,
      action: "acceptInvite"
    };
    const accepted = await handleOperation(
      {
        type: "acceptInvite",
        payload: {
          vaultId: team.data.vaultId,
          signerPublicKey: member.publicKey,
          signature: signPayload(acceptPayload, member)
        }
      },
      {},
      { roundKey: "12" }
    );
    expect(accepted.data.authorizedCount).toBe(2);

    const removePayload = {
      vaultId: team.data.vaultId,
      memberToRemove: member.classicAddress,
      action: "removeMember"
    };
    await handleOperation(
      {
        type: "removeMember",
        payload: {
          ...removePayload,
          signerPublicKey: owner.publicKey,
          signature: signPayload(removePayload, owner)
        }
      },
      {},
      { roundKey: "13" }
    );

    const memberReadPayload = {
      vaultId: team.data.vaultId,
      actor: member.classicAddress,
      entryIndex: 0,
      tokenId: null
    };
    await expect(
      handleOperation({
        type: "getEntry",
        payload: {
          ...memberReadPayload,
          signerPublicKey: member.publicKey,
          signature: signPayload(memberReadPayload, member)
        }
      })
    ).rejects.toThrow("Caller is not authorized.");
  });
});
