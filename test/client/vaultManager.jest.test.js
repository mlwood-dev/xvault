import { describe, expect, jest, test } from "@jest/globals";
import { Wallet } from "xahau";
import { revokeVault } from "../../src/client/vaultManager.js";

describe("vaultManager revoke flow", () => {
  test("submits revokeVault and clears local cache", async () => {
    const wallet = Wallet.generate();
    const xrplClient = { isConnected: () => true };
    const clearVaultCache = jest.fn();
    const submitContractRequest = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        data: [
          {
            vaultId: "vault-12345678",
            type: "team"
          }
        ]
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          success: true,
          burnedTokens: 3
        }
      });

    const result = await revokeVault("vault-12345678", xrplClient, wallet, {
      submitContractRequest,
      clearVaultCache
    });

    expect(result.success).toBe(true);
    expect(result.burnedTokens).toBe(3);
    expect(clearVaultCache).toHaveBeenCalledWith("vault-12345678");
    expect(submitContractRequest).toHaveBeenCalledTimes(2);
    expect(submitContractRequest.mock.calls[1][0].payload.confirm).toBe(true);
  });

  test("fails when vault is not in owner summaries", async () => {
    const wallet = Wallet.generate();
    const submitContractRequest = jest.fn().mockResolvedValueOnce({
      ok: true,
      data: []
    });

    await expect(
      revokeVault("vault-does-not-exist", { isConnected: () => false }, wallet, {
        submitContractRequest
      })
    ).rejects.toThrow("Vault not found in owner summaries.");
  });
});
