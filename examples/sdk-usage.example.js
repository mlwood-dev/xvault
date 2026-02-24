import { Client, Wallet } from "xahau";
import { deriveRootKey } from "../src/crypto/vaultCrypto.js";
import { createXVaultClient } from "../src/sdk/xvaultClient.js";

/**
 * Example SDK flow:
 * create client -> create vault -> add entry -> list vaults -> revoke vault.
 */
export async function runSdkUsageExample() {
  const xrplClient = new Client("wss://xahau-testnet.example");
  await xrplClient.connect();

  const wallet = Wallet.fromSeed("s████████████████████████████");
  const vaultSaltCache = new Map();
  const rootKeyCache = new Map();

  const client = createXVaultClient({
    hotpocketWsUrl: "ws://localhost:8081",
    xrplClient,
    wallet,
    quicknodeConfig: {
      apiKey: process.env.QUICKNODE_IPFS_API_KEY,
      apiBase: process.env.QUICKNODE_IPFS_API_BASE,
      gateway: process.env.QUICKNODE_GATEWAY
    },
    rootKeyProvider: async ({ vaultId }) => {
      const salt = vaultSaltCache.get(vaultId);
      if (!salt) throw new Error("Missing local salt cache for vault.");
      const root = await deriveRootKey("example-master-password", salt);
      rootKeyCache.set(vaultId, root);
      return root;
    },
    getVaultSalt: async (vaultId) => {
      const salt = vaultSaltCache.get(vaultId);
      if (!salt) throw new Error("Missing local salt for recovery flow.");
      return salt;
    }
  });

  try {
    const created = await client.createVault({ type: "individual" });
    console.log("Vault created:", created);

    // SDK does not fetch salt from contract; cache at create-time in app state.
    // For this minimal example, use a placeholder 16-byte salt.
    vaultSaltCache.set(created.vaultId, "00112233445566778899aabbccddeeff");

    const added = await client.addEntry(created.vaultId, {
      service: "github",
      username: "alice",
      password: "example-password"
    });
    console.log("Entry added:", added);

    const vaults = await client.listVaults();
    console.log("Vault summaries:", vaults);

    await client.revokeVault(created.vaultId);
    console.log("Vault revoked:", created.vaultId);
  } finally {
    await client.close();
    if (xrplClient.isConnected()) {
      await xrplClient.disconnect();
    }
    for (const key of rootKeyCache.values()) {
      key.fill(0);
    }
  }
}
