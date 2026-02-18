# XVault Usage Examples

All examples use the current SDK prototype (`src/sdk/xvaultClient.js`) and represent implemented flows only.

## Shared Setup

```js
import { Client, Wallet } from "xrpl";
import { deriveRootKey } from "../src/crypto/vaultCrypto.js";
import { createXVaultClient } from "../src/sdk/xvaultClient.js";

const xrplClient = new Client("wss://xahau-testnet.example");
await xrplClient.connect();

const wallet = Wallet.fromSeed("s████████████████████████████");
const vaultSaltCache = new Map();

const sdk = createXVaultClient({
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
    if (!salt) throw new Error("Missing vault salt.");
    return deriveRootKey("user-master-password", salt);
  },
  getVaultSalt: async (vaultId) => {
    const salt = vaultSaltCache.get(vaultId);
    if (!salt) throw new Error("Missing vault salt.");
    return salt;
  }
});
```

## Individual Vault Flow

Create -> add entry -> retrieve -> revoke.

```js
const created = await sdk.createVault({ type: "individual" });

// Persist/create salt mapping in your app state at vault creation time.
vaultSaltCache.set(created.vaultId, "00112233445566778899aabbccddeeff");

const added = await sdk.addEntry(created.vaultId, {
  service: "github",
  username: "alice",
  password: "strong-password",
  notes: "personal account"
});

const fetched = await sdk.getEntry(created.vaultId, 0);
console.log("CID:", fetched.cid);
console.log("Gateway URL:", fetched.gatewayUrl);
console.log("Metadata:", fetched.metadata);

await sdk.revokeVault(created.vaultId);
```

## Team Vault Flow

Create -> invite -> accept -> add shared entry -> remove member -> revoke.

```js
const team = await sdk.createVault({
  type: "team",
  initialAuthorized: []
});
vaultSaltCache.set(team.vaultId, "11223344556677889900aabbccddeeff");

await sdk.inviteToVault(team.vaultId, "rInviteeClassicAddress...");

// Run as invitee wallet/session:
// await inviteeSdk.acceptInvite(team.vaultId);

// Owner/member SDK must provide team authorized list callback:
// getTeamAuthorizedAddresses(vaultId) => ["rOwner...", "rInvitee..."]

const shared = await sdk.addEntry(team.vaultId, {
  service: "notion",
  username: "team-user",
  password: "team-shared-password",
  notes: "wrapped for authorized members"
});
console.log(shared);

await sdk.removeMember(team.vaultId, "rInviteeClassicAddress...");
await sdk.revokeVault(team.vaultId);
```

## Recovery Flow (Shamir Skeleton)

Enable recovery -> get shares -> recover root key.

```js
const created = await sdk.createVault({
  type: "individual",
  recoveryThreshold: 2,
  recoveryTotal: 3
});
vaultSaltCache.set(created.vaultId, "aabbccddeeff00112233445566778899");

const recovery = await sdk.enableRecovery(created.vaultId, 2, 3);
console.log("Share count:", recovery.shares.length);
console.log("Recovery metadata CID:", recovery.recoveryMetadataCid ?? "not-uploaded");

// User provides threshold shares later
const ok = await sdk.recoverVault([recovery.shares[0], recovery.shares[1]], created.vaultId);
console.log("Recovered:", ok);
```

## CLI Examples

```bash
xvault create-vault --type individual
xvault add-entry --vault <vault-id> --service github --username alice --password 'secret'
xvault list
xvault recovery-generate --vault <vault-id> --threshold 2 --total 3
xvault revoke --vault <vault-id>
```

## Cleanup

```js
await sdk.close();
if (xrplClient.isConnected()) await xrplClient.disconnect();
```

