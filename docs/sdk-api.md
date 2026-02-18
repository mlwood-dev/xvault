# XVault SDK API

This guide documents the thin client SDK implemented in `src/sdk/xvaultClient.js`.

## Module Entry

```js
import { createXVaultClient } from "../src/sdk/xvaultClient.js";
```

Also exported via `src/sdk/index.js`.

## `createXVaultClient(config)`

Creates an SDK instance that orchestrates contract requests, client-side crypto, IPFS upload, and optional recovery flow operations.

### Configuration

| Field | Type | Required | Description |
|---|---|---:|---|
| `hotpocketWsUrl` | `string` | yes | WebSocket endpoint for contract operations |
| `xrplClient` | `xrpl.Client` | yes | XRPL client used for account/public-key lookups and parity in flows |
| `wallet` | `xrpl.Wallet` | yes | Caller wallet used for signatures (`classicAddress/publicKey/privateKey`) |
| `quicknodeConfig` | `object` | yes | QuickNode IPFS config |
| `quicknodeConfig.apiKey` | `string` | no | API key override (fallback to env in IPFS module) |
| `quicknodeConfig.apiBase` | `string` | no | QuickNode base URL override |
| `quicknodeConfig.gateway` | `string` | yes | Gateway base used for fetch URLs |
| `quicknodeConfig.fetchImpl` | `function` | no | Custom fetch implementation |
| `enableTeamMode` | `boolean` | no | Client-side guard for team operations |
| `rootKeyProvider` | `({vaultId,type}) => Promise<Uint8Array>` | no | Provides `Uint8Array(32)` root key for encryption |
| `getTeamAuthorizedAddresses` | `(vaultId) => Promise<string[]>` | no | Required for team `addEntry` wrapping |
| `getVaultSalt` | `(vaultId) => Promise<string>` | no | Used by `recoverVault` when salt is not cached |
| `wsTimeoutMs` | `number` | no | WS request timeout override |
| `wsFactory` | `(url) => WebSocketLike` | no | Injects runtime-specific WebSocket constructor |
| `submitContractRequest` | `(op) => Promise<any>` | no | Overrides internal WS transport |

### Example

```js
import { Client, Wallet } from "xrpl";
import { createXVaultClient } from "../src/sdk/xvaultClient.js";

const xrplClient = new Client("wss://xahau-testnet.example");
await xrplClient.connect();

const wallet = Wallet.fromSeed("s████████████████████████████");
const client = createXVaultClient({
  hotpocketWsUrl: "ws://localhost:8081",
  xrplClient,
  wallet,
  quicknodeConfig: {
    apiKey: process.env.QUICKNODE_IPFS_API_KEY,
    apiBase: process.env.QUICKNODE_IPFS_API_BASE,
    gateway: process.env.QUICKNODE_GATEWAY
  }
});
```

## Public Methods

## `createVault(options)`

Creates a new vault (individual or team).

### Parameters

```ts
{
  type: "individual" | "team",
  initialAuthorized?: string[],
  recoveryThreshold?: number,
  recoveryTotal?: number
}
```

### Returns

```ts
Promise<{ vaultId: string; manifestTokenId: string }>
```

### Notes

- Recovery setup is optional and client-side.
- Team creation is blocked if `enableTeamMode` is explicitly `false`.

## `addEntry(vaultId, entryData)`

Encrypts entry data client-side, uploads encrypted blob to IPFS, submits `addEntry` with CID.

### Parameters

```ts
vaultId: string
entryData: {
  service: string
  username?: string
  password?: string
  notes?: string
}
```

### Returns

```ts
Promise<{ tokenId: string; cid: string }>
```

### Notes

- Individual vaults use root key directly.
- Team vaults require `getTeamAuthorizedAddresses()` and XRPL public key lookups for wrapping.

## `getEntry(vaultId, entryIndexOrTokenId)`

Retrieves entry metadata and CID references from contract.

### Returns

```ts
Promise<{ cid: string; gatewayUrl: string; metadata: object }>
```

## `listVaults()`

Lists owner vault summaries from contract.

### Returns

```ts
Promise<VaultSummary[]>
```

## `inviteToVault(vaultId, inviteeAddress)`

Owner sends team invite.

### Returns

```ts
Promise<void>
```

## `acceptInvite(vaultId)`

Invitee accepts team invite for vault.

### Returns

```ts
Promise<void>
```

## `removeMember(vaultId, memberAddress)`

Owner removes team member.

### Returns

```ts
Promise<void>
```

## `revokeVault(vaultId)`

Revokes vault by listing owner vaults, selecting vault type, and signing revoke request.

### Returns

```ts
Promise<void>
```

## `enableRecovery(vaultId, threshold, total)`

Generates Shamir shares client-side and (best-effort) uploads non-sensitive recovery metadata.

### Returns

```ts
Promise<{ shares: string[]; recoveryMetadataCid?: string }>
```

### Notes

- Returned `shares` are sensitive; distribute and store out-of-band.
- SDK does not persist shares locally.

## `recoverVault(shares, vaultId)`

Combines shares, derives recovery root key, and verifies hash when available.

### Returns

```ts
Promise<boolean>
```

- `true`: root key derived and cached in memory for that vault.
- `false`: derived secret failed metadata hash consistency check.

## `close()`

Zeroizes cached root keys and closes WS transport.

### Returns

```ts
Promise<void>
```

## Integration Notes

- Authentication/session management is intentionally out of scope.
- Caller is responsible for wallet lifecycle and secure seed handling.
- Contract currently does not expose a dedicated vault-salt query, so recovery requires local salt retention or `getVaultSalt(vaultId)` integration.
- SDK methods return contract/IPFS metadata, not decrypted plaintext.

## WebSocket Transport Helper

`src/sdk/wsTransport.js` exposes `createHotPocketTransport({ url, timeoutMs?, wsFactory? })`:

- Serializes requests to avoid response-order ambiguity.
- Supports browser and Node WS-compatible implementations.
- Returns:
  - `submit(operation)` for request/response contract operations.
  - `close()` for cleanup.

