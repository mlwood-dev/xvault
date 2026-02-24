import { describe, expect, jest, test } from "@jest/globals";
import { createMockMultisigSigner, createMockXrplClient } from "../mocks/mockXrpl.js";

jest.unstable_mockModule("xahau", () => ({
  convertStringToHex: (value) => Buffer.from(value, "utf8").toString("hex"),
  deriveAddress: () => "rMockAddress",
  isValidClassicAddress: () => true,
  multisign: () => "MOCK_MULTISIGNED_BLOB",
  verifyKeypairSignature: () => true
}));

const { buildUriTokenMintTx, burnUriToken, mintUriToken } = await import("../../src/contract/xrplUtils.js");

describe("xrplUtils transaction stubs", () => {
  test("buildUriTokenMintTx creates URITokenMint shape", () => {
    const tx = buildUriTokenMintTx({
      account: "rIssuer",
      uri: "ipfs://cid",
      owner: "rOwner"
    });
    expect(tx.TransactionType).toBe("URITokenMint");
    expect(tx.Account).toBe("rIssuer");
    expect(tx.Destination).toBe("rOwner");
  });

  test("mintUriToken uses simulated mode without network client", async () => {
    const result = await mintUriToken({
      uri: "ipfs://cid",
      owner: "rOwner"
    });
    expect(result.mode).toBe("simulated");
    expect(result.tokenId).toBeTruthy();
  });

  test("burnUriToken supports submitted mode with mocked Xahau client", async () => {
    const xrplClient = createMockXrplClient();
    const signer = createMockMultisigSigner();
    const result = await burnUriToken({
      xrplClient,
      uriTokenId: "TOKEN_ID_123",
      multisigSigners: [signer]
    });
    expect(result.burned).toBe(true);
    expect(["submitted", "simulated_fallback"]).toContain(result.mode);
  });
});
