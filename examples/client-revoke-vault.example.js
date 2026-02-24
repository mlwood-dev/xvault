import WebSocket from "ws";
import { Client, Wallet } from "xahau";
import { createWsSubmitter, revokeVault } from "../src/client/vaultManager.js";

/**
 * Example: owner-driven vault revocation flow.
 * - Queries vault summaries.
 * - Submits revokeVault with confirm=true for team vaults.
 * - Clears local cache on success.
 */
export async function runRevokeVaultExample() {
  const xrplClient = new Client("wss://xahau-testnet.example");
  await xrplClient.connect();

  const wallet = Wallet.fromSeed("s████████████████████████████");
  const ws = new WebSocket("ws://localhost:8080");
  await new Promise((resolve) => ws.once("open", resolve));

  const submitContractRequest = createWsSubmitter(ws);
  const result = await revokeVault("vault-id-to-revoke", xrplClient, wallet, {
    submitContractRequest,
    clearVaultCache: async (vaultId) => {
      // CLIENT RESPONSIBILITY: remove local encrypted cache/indexed data for vault.
      console.info(`Cleared local cache for ${vaultId}`);
    }
  });

  console.log("Revocation result", result);
  // CLIENT RESPONSIBILITY: unpin CIDs in QuickNode dashboard/API if storage reclaim is desired.

  ws.close();
  await xrplClient.disconnect();
}
