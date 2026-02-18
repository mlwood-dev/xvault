import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xvault-contract-test-"));

vi.mock("../src/contract/xrplUtils.js", async () => {
  const actual = await vi.importActual("../src/contract/xrplUtils.js");
  return {
    ...actual,
    validateClassicAddress: () => {},
    validateHexSalt: () => {},
    verifySignedPayload: () => {}
  };
});

describe("Phase 2 contract handlers", () => {
  let stateFile;
  const owner = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";

  beforeEach(() => {
    stateFile = path.join(tempRoot, `state-${Date.now()}-${Math.random()}.json`);
    process.env.XVAULT_STATE_FILE = stateFile;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.XVAULT_STATE_FILE;
  });

  test("createVault + addEntry + getMyVaults flow", async () => {
    const { handleOperation } = await import("../src/contract/index.js");

    const createdResp = await handleOperation(
      {
        type: "createVault",
        payload: {
          type: "individual",
          owner,
          salt: "aabbccddeeff0011",
          metadata: { label: "default" },
          signerPublicKey: "EDPUBKEY",
          signature: "SIG"
        }
      },
      {},
      { roundKey: "1" }
    );
    const created = createdResp.data;

    const addedResp = await handleOperation(
      {
        type: "addEntry",
        payload: {
          vaultId: created.vaultId,
          owner,
          encryptedBlob: Buffer.from("ciphertext").toString("base64"),
          cid: "bafybeigdyrztf4f6xsl54n4xq4m5gxezm5q4za2ojx6x7lf5y3w4f4xhqy",
          entryMetadata: { service: "github", username: "mike" },
          signerPublicKey: "EDPUBKEY",
          signature: "SIG"
        }
      },
      {},
      { roundKey: "1" }
    );
    const added = addedResp.data;

    const fetchedResp = await handleOperation({
      type: "getEntry",
      payload: {
        vaultId: created.vaultId,
        owner,
        tokenId: added.tokenId,
        signerPublicKey: "EDPUBKEY",
        signature: "SIG"
      }
    });
    const fetched = fetchedResp.data;

    const mineResp = await handleOperation({
      type: "getMyVaults",
      payload: { owner }
    });
    const mine = mineResp.data;

    expect(created.manifestTokenId).toBeTruthy();
    expect(added.tokenId).toBeTruthy();
    expect(added.cid).toBe("bafybeigdyrztf4f6xsl54n4xq4m5gxezm5q4za2ojx6x7lf5y3w4f4xhqy");
    expect(fetched.cid).toBe(added.cid);
    expect(fetched.gatewayUrl).toContain("/ipfs/");
    expect(mine[0].entryCount).toBe(1);
    expect(mine[0].manifestTokenId).toBeTruthy();
    expect(mine[0].lastActivity).toBe("1");
  });

  test("enforces max 5 mutating ops per round per owner", async () => {
    const { handleOperation } = await import("../src/contract/index.js");

    for (let i = 0; i < 5; i += 1) {
      await handleOperation(
        {
          type: "createVault",
          payload: {
            type: "individual",
            owner,
            salt: `aabbccddeeff00${i}${i}`,
            signerPublicKey: "EDPUBKEY",
            signature: "SIG"
          }
        },
        {},
        { roundKey: "55" }
      );
    }

    await expect(
      handleOperation(
        {
          type: "createVault",
          payload: {
            type: "individual",
            owner,
            salt: "ffeeddccbbaa0011",
            signerPublicKey: "EDPUBKEY",
            signature: "SIG"
          }
        },
        {},
        { roundKey: "55" }
      )
    ).rejects.toThrow("Rate limit exceeded");
  });

  test("rejects invalid CID format", async () => {
    const { handleOperation } = await import("../src/contract/index.js");
    const createdResp = await handleOperation(
      {
        type: "createVault",
        payload: {
          type: "individual",
          owner,
          salt: "aabbccddeeff0022",
          signerPublicKey: "EDPUBKEY",
          signature: "SIG"
        }
      },
      {},
      { roundKey: "70" }
    );
    const created = createdResp.data;

    await expect(
      handleOperation(
        {
          type: "addEntry",
          payload: {
            vaultId: created.vaultId,
            owner,
            encryptedBlob: Buffer.from("ciphertext").toString("base64"),
            cid: "not-a-cid",
            entryMetadata: { service: "github" },
            signerPublicKey: "EDPUBKEY",
            signature: "SIG"
          }
        },
        {},
        { roundKey: "70" }
      )
    ).rejects.toThrow("Invalid IPFS CID format.");
  });

  test("getMyVaults supports since filter and desc sorting", async () => {
    const { handleOperation } = await import("../src/contract/index.js");
    const vaultA = await handleOperation(
      {
        type: "createVault",
        payload: {
          type: "individual",
          owner,
          salt: "aabbccddeeff0033",
          signerPublicKey: "EDPUBKEY",
          signature: "SIG"
        }
      },
      {},
      { roundKey: "10" }
    );
    const vaultB = await handleOperation(
      {
        type: "createVault",
        payload: {
          type: "individual",
          owner,
          salt: "aabbccddeeff0044",
          signerPublicKey: "EDPUBKEY",
          signature: "SIG"
        }
      },
      {},
      { roundKey: "20" }
    );

    expect(vaultA.data.vaultId).toBeTruthy();
    expect(vaultB.data.vaultId).toBeTruthy();

    const listed = await handleOperation({
      type: "getMyVaults",
      payload: { owner, since: "15" }
    });

    expect(listed.data.length).toBe(1);
    expect(listed.data[0].createdAt).toBe("20");
  });

  test("team skeleton handlers are disabled by default", async () => {
    const { handleOperation } = await import("../src/contract/index.js");

    await expect(
      handleOperation(
        {
          type: "createTeamVault",
          payload: {
            type: "team",
            owner,
            salt: "aabbccddeeff0055",
            initialAuthorized: [],
            signerPublicKey: "EDPUBKEY",
            signature: "SIG"
          }
        },
        {},
        { roundKey: "90" }
      )
    ).rejects.toThrow("Team vaults are not enabled in this deployment.");
  });
});
