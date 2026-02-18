import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { Wallet } from "xrpl";
import keypairs from "ripple-keypairs";
import { createIsolatedStateFile } from "../mocks/mockHotPocketState.js";
import { prepareEntryPayload } from "../../src/crypto/vaultCrypto.js";
import { hashForSigning } from "../../src/contract/xrplUtils.js";

async function loadContractWithMockedSignatures(teamMode = false) {
  process.env.XVAULT_STATE_FILE = createIsolatedStateFile();
  process.env.ENABLE_TEAM_MODE = teamMode ? "true" : "false";
  jest.resetModules();
  return import("../../src/contract/index.js");
}

function signPayload(payload, wallet) {
  const digest = hashForSigning(payload);
  return keypairs.sign(digest, wallet.privateKey);
}

describe("Integration flows (in-memory simulation)", () => {
  afterEach(() => {
    delete process.env.XVAULT_STATE_FILE;
    delete process.env.ENABLE_TEAM_MODE;
  });

  test("individual lifecycle: create -> add -> retrieve -> decrypt", async () => {
    const { handleOperation } = await loadContractWithMockedSignatures(false);
    const owner = Wallet.generate();
    const rootKey = new Uint8Array(32).fill(1);
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

    const prepared = await prepareEntryPayload(
      "individual",
      { service: "github", username: "alice", secret: "token123" },
      rootKey,
      [],
      "bafybeigdyrztf4f6xsl54n4xq4m5gxezm5q4za2ojx6x7lf5y3w4f4xhqy"
    );

    await handleOperation(
      {
        type: "addEntry",
        payload: {
          vaultId: created.data.vaultId,
          owner: owner.classicAddress,
          encryptedBlob: prepared.encryptedBlob,
          entryMetadata: prepared.entryMetadata,
          cid: prepared.cid,
          signerPublicKey: owner.publicKey,
          signature: signPayload(
            {
              vaultId: created.data.vaultId,
              actor: owner.classicAddress,
              encryptedBlob: prepared.encryptedBlob,
              cid: prepared.cid,
              entryMetadata: prepared.entryMetadata,
              wrappedKeys: []
            },
            owner
          )
        }
      },
      {},
      { roundKey: "2" }
    );

    const fetched = await handleOperation({
      type: "getEntry",
      payload: {
        vaultId: created.data.vaultId,
        owner: owner.classicAddress,
        entryIndex: 0,
        signerPublicKey: owner.publicKey,
        signature: signPayload(
          {
            vaultId: created.data.vaultId,
            actor: owner.classicAddress,
            entryIndex: 0,
            tokenId: null
          },
          owner
        )
      }
    });
    expect(fetched.data.cid).toBe(prepared.cid);

    const envelope = JSON.parse(Buffer.from(prepared.encryptedBlob, "base64").toString("utf8"));
    const key = await webcrypto.subtle.importKey("raw", rootKey, "AES-GCM", false, ["decrypt"]);
    const plain = await webcrypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: Buffer.from(envelope.iv, "base64"),
        additionalData: new TextEncoder().encode("xvault:entry:v1"),
        tagLength: 128
      },
      key,
      new Uint8Array([...Buffer.from(envelope.ciphertext, "base64"), ...Buffer.from(envelope.tag, "base64")])
    );
    const decrypted = JSON.parse(Buffer.from(plain).toString("utf8"));
    expect(decrypted.secret).toBe("token123");
  });

  test("team lifecycle: invite -> accept -> add -> remove -> deny", async () => {
    const { handleOperation } = await loadContractWithMockedSignatures(true);
    const owner = Wallet.generate();
    const member = Wallet.generate();
    const rootKey = new Uint8Array(32).fill(2);
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

    await handleOperation(
      {
        type: "inviteToVault",
        payload: {
          vaultId: team.data.vaultId,
          invitee: member.classicAddress,
          signerPublicKey: owner.publicKey,
          signature: signPayload(
            { vaultId: team.data.vaultId, invitee: member.classicAddress, action: "inviteToVault" },
            owner
          )
        }
      },
      {},
      { roundKey: "11" }
    );

    await handleOperation(
      {
        type: "acceptInvite",
        payload: {
          vaultId: team.data.vaultId,
          signerPublicKey: member.publicKey,
          signature: signPayload({ vaultId: team.data.vaultId, action: "acceptInvite" }, member)
        }
      },
      {},
      { roundKey: "12" }
    );

    const prepared = await prepareEntryPayload(
      "team",
      { service: "slack", username: "member", secret: "shared-secret" },
      rootKey,
      [{ address: member.classicAddress, pubKey: member.publicKey }],
      "bafybeigdyrztf4f6xsl54n4xq4m5gxezm5q4za2ojx6x7lf5y3w4f4xhqy"
    );

    await handleOperation(
      {
        type: "addEntry",
        payload: {
          vaultId: team.data.vaultId,
          actor: member.classicAddress,
          encryptedBlob: prepared.encryptedBlob,
          entryMetadata: prepared.entryMetadata,
          cid: prepared.cid,
          wrappedKeys: prepared.wrappedKeys,
          signerPublicKey: member.publicKey,
          signature: signPayload(
            {
              vaultId: team.data.vaultId,
              actor: member.classicAddress,
              encryptedBlob: prepared.encryptedBlob,
              cid: prepared.cid,
              entryMetadata: prepared.entryMetadata,
              wrappedKeys: prepared.wrappedKeys
            },
            member
          )
        }
      },
      {},
      { roundKey: "13" }
    );

    const memberRead = await handleOperation({
      type: "getEntry",
      payload: {
        vaultId: team.data.vaultId,
        actor: member.classicAddress,
        entryIndex: 0,
        signerPublicKey: member.publicKey,
        signature: signPayload(
          {
            vaultId: team.data.vaultId,
            actor: member.classicAddress,
            entryIndex: 0,
            tokenId: null
          },
          member
        )
      }
    });
    expect(memberRead.data.cid).toBe(prepared.cid);

    await handleOperation(
      {
        type: "removeMember",
        payload: {
          vaultId: team.data.vaultId,
          memberToRemove: member.classicAddress,
          signerPublicKey: owner.publicKey,
          signature: signPayload(
            {
              vaultId: team.data.vaultId,
              memberToRemove: member.classicAddress,
              action: "removeMember"
            },
            owner
          )
        }
      },
      {},
      { roundKey: "14" }
    );

    await expect(
      handleOperation({
        type: "getEntry",
        payload: {
          vaultId: team.data.vaultId,
          actor: member.classicAddress,
          entryIndex: 0,
          signerPublicKey: member.publicKey,
          signature: signPayload(
            {
              vaultId: team.data.vaultId,
              actor: member.classicAddress,
              entryIndex: 0,
              tokenId: null
            },
            member
          )
        }
      })
    ).rejects.toThrow("Caller is not authorized.");
  });
});
