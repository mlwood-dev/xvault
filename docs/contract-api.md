# XVault Contract API

This document describes the currently implemented HotPocket contract handlers in `src/contract/index.js`, including request payloads, validation expectations, response shape, and common error codes.

## Response Envelope

Successful responses:

```json
{
  "ok": true,
  "operation": "handlerName",
  "data": {}
}
```

Error responses:

```json
{
  "ok": false,
  "error": "Human-readable message",
  "code": "ERROR_CODE",
  "errorId": "hash-prefix"
}
```

## Authentication and Validation Model

- Mutating and sensitive read handlers require:
  - `signerPublicKey`
  - `signature`
  - canonical payload validation
  - signer address match against expected actor/owner
- Address fields are validated as Xahau classic addresses.
- CID fields are validated (v0/v1 format support via regex checks).
- `encryptedBlob` and wrapped keys are validated as base64.
- Per-round rate limit for mutating handlers: max 5 operations per address per round.

## Handlers

## `createVault`

Creates an individual vault.

### Input example

```json
{
  "type": "createVault",
  "payload": {
    "type": "individual",
    "owner": "rXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    "salt": "aabbccddeeff0011",
    "metadata": {},
    "signerPublicKey": "02ABCDEF...",
    "signature": "3045..."
  }
}
```

### Key validations

- `type` must resolve to `"individual"` (or routes to team handler if `"team"`).
- `owner` valid classic address.
- `salt` even-length hex string, 16-256 chars.
- Signature must verify against payload fields.

### Output data

```json
{
  "vaultId": "sha256(owner:salt)",
  "owner": "r...",
  "createdAt": "round-key",
  "manifestTokenId": "token-id",
  "mintMode": "simulated|submitted|simulated_fallback"
}
```

## `createTeamVault`

Creates a team vault (requires `ENABLE_TEAM_MODE=true`).

### Input example

```json
{
  "type": "createTeamVault",
  "payload": {
    "type": "team",
    "owner": "rXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    "salt": "1122334455667788",
    "metadata": {},
    "initialAuthorized": ["rYYYY..."],
    "signerPublicKey": "02ABCDEF...",
    "signature": "3045..."
  }
}
```

### Key validations

- Team mode enabled.
- `initialAuthorized` array size/address validation.
- Signature bound to type/owner/salt/metadata/initialAuthorized.

### Output data

```json
{
  "vaultId": "sha256(owner:salt)",
  "owner": "r...",
  "type": "team",
  "createdAt": "round-key",
  "manifestTokenId": "token-id",
  "authorizedCount": 1,
  "mintMode": "simulated|submitted|simulated_fallback"
}
```

## `inviteToVault`

Owner invites an address to a team vault.

### Input example

```json
{
  "type": "inviteToVault",
  "payload": {
    "vaultId": "vault-id",
    "invitee": "rINVITEE...",
    "signerPublicKey": "02OWNER...",
    "signature": "3045..."
  }
}
```

### Key validations

- Team mode enabled, vault type is team.
- Only owner can invite.
- Signature payload uses `{ vaultId, invitee, action: "inviteToVault" }`.

### Output data

```json
{
  "success": true,
  "pendingInviteCount": 1,
  "invitee": "rINVITEE..."
}
```

## `acceptInvite`

Invitee accepts pending invitation for team vault.

### Input example

```json
{
  "type": "acceptInvite",
  "payload": {
    "vaultId": "vault-id",
    "signerPublicKey": "02INVITEE...",
    "signature": "3045..."
  }
}
```

### Key validations

- Team mode enabled, vault type is team.
- Signature payload uses `{ vaultId, action: "acceptInvite" }`.
- Signer address must match pending invite entry.

### Output data

```json
{
  "success": true,
  "authorizedCount": 2,
  "invitedBy": "rOWNER..."
}
```

## `removeMember`

Owner removes a member from team vault authorization.

### Input example

```json
{
  "type": "removeMember",
  "payload": {
    "vaultId": "vault-id",
    "memberToRemove": "rMEMBER...",
    "signerPublicKey": "02OWNER...",
    "signature": "3045..."
  }
}
```

### Key validations

- Team mode enabled.
- Only owner can remove.
- Owner cannot remove themselves.
- Signature payload uses `{ vaultId, memberToRemove, action: "removeMember" }`.

### Output data

```json
{
  "success": true,
  "authorizedCount": 1
}
```

## `revokeInvite`

Owner revokes pending invite for team vault.

### Input example

```json
{
  "type": "revokeInvite",
  "payload": {
    "vaultId": "vault-id",
    "pendingAddress": "rPENDING...",
    "signerPublicKey": "02OWNER...",
    "signature": "3045..."
  }
}
```

### Key validations

- Team mode enabled.
- Only owner can revoke pending invites.
- Signature payload uses `{ vaultId, pendingAddress, action: "revokeInvite" }`.

### Output data

```json
{
  "success": true,
  "pendingInviteCount": 0
}
```

## `getPendingInvites`

Owner lists pending invites for a team vault.

### Input example

```json
{
  "type": "getPendingInvites",
  "payload": {
    "vaultId": "vault-id",
    "signerPublicKey": "02OWNER...",
    "signature": "3045..."
  }
}
```

### Key validations

- Team mode enabled, team vault required.
- Signature payload uses `{ vaultId, action: "getPendingInvites" }`.
- Expected signer is owner.

### Output data

```json
{
  "vaultId": "vault-id",
  "pendingInvites": [
    { "address": "r...", "invitedBy": "r...", "invitedAt": "11" }
  ]
}
```

## `addEntry`

Adds encrypted entry metadata and CID reference.

### Input example

```json
{
  "type": "addEntry",
  "payload": {
    "vaultId": "vault-id",
    "actor": "rACTOR...",
    "encryptedBlob": "base64...",
    "cid": "bafy...",
    "entryMetadata": {
      "service": "github",
      "username": "alice",
      "notes": "optional"
    },
    "wrappedKeys": [
      { "address": "rMEMBER...", "encryptedKey": "base64..." }
    ],
    "signerPublicKey": "02...",
    "signature": "3045..."
  }
}
```

### Key validations

- Actor defaults to `owner` if absent for backward compatibility.
- `encryptedBlob` base64 + size checks.
- CID format checks.
- `entryMetadata.service` required.
- `wrappedKeys` array item schema/size checks.
- Signature payload includes wrapped keys.
- Authorization: owner for individual, authorized member for team.

### Output data

```json
{
  "vaultId": "vault-id",
  "tokenId": "entry-uri-token-id",
  "cid": "bafy...",
  "createdAt": "round-key",
  "metadata": {
    "service": "github",
    "username": "alice",
    "notes": null
  },
  "mintMode": "simulated|submitted|simulated_fallback"
}
```

## `getEntry`

Reads entry metadata by index or token id.

### Input example (by index)

```json
{
  "type": "getEntry",
  "payload": {
    "vaultId": "vault-id",
    "actor": "rACTOR...",
    "entryIndex": 0,
    "signerPublicKey": "02...",
    "signature": "3045..."
  }
}
```

### Input example (by tokenId)

```json
{
  "type": "getEntry",
  "payload": {
    "vaultId": "vault-id",
    "actor": "rACTOR...",
    "tokenId": "token-id",
    "signerPublicKey": "02...",
    "signature": "3045..."
  }
}
```

### Key validations

- Requires either `entryIndex` or `tokenId`.
- Signature payload canonicalizes missing selector as `null`.
- Read authorization enforced by vault type.

### Output data

```json
{
  "cid": "bafy...",
  "metadata": {
    "service": "github",
    "username": "alice",
    "notes": null
  },
  "gatewayUrl": "https://<gateway>/ipfs/bafy..."
}
```

## `getMyVaults`

Lists vault summaries for owner.

### Input example

```json
{
  "type": "getMyVaults",
  "payload": {
    "owner": "rOWNER...",
    "since": "optional-round-marker"
  }
}
```

### Key validations

- Address validation.
- Optional `since` for filtered list.

### Output data

```json
[
  {
    "vaultId": "vault-id",
    "type": "team",
    "createdAt": "10",
    "entryCount": 1,
    "authorizedCount": 2,
    "pendingInviteCount": 0,
    "manifestTokenId": "token-id",
    "lastActivity": "13"
  }
]
```

## `updateVaultManifest`

Team-only manifest URI rotation workflow.

### Input example

```json
{
  "type": "updateVaultManifest",
  "payload": {
    "vaultId": "vault-id",
    "newUri": "ipfs://bafy...",
    "newBlobHex": null,
    "signerPublicKey": "02OWNER...",
    "signature": "3045..."
  }
}
```

### Key validations

- Team mode enabled and team vault required.
- Requires `newUri` or `newBlobHex`.
- Owner signature payload includes action and both optional fields as nullable values.

### Output data

```json
{
  "success": true,
  "mode": "mutable_stub|burn_remint",
  "manifestTokenId": "token-id",
  "burnMode": "simulated|submitted|simulated_fallback",
  "mintMode": "simulated|submitted|simulated_fallback"
}
```

## `listVaultURITokens`

Owner lists manifest + entry URI token IDs for vault.

### Input example

```json
{
  "type": "listVaultURITokens",
  "payload": {
    "vaultId": "vault-id",
    "signerPublicKey": "02OWNER...",
    "signature": "3045..."
  }
}
```

### Output data

```json
{
  "vaultId": "vault-id",
  "tokenIds": ["manifestTokenId", "entryTokenId1", "entryTokenId2"]
}
```

## `revokeVault`

Burns associated URI tokens and deletes vault state.

### Input example

```json
{
  "type": "revokeVault",
  "payload": {
    "vaultId": "vault-id",
    "confirm": true,
    "signerPublicKey": "02OWNER...",
    "signature": "3045..."
  }
}
```

### Key validations

- Team vault requires `confirm=true`.
- Signature payload includes `{ vaultId, confirm, action: "revokeVault" }`.
- Only owner may revoke.

### Output data

```json
{
  "success": true,
  "burnedTokens": 3
}
```

## `stateDigest`

Returns SHA-256 digest of deterministic snapshot.

### Input example

```json
{
  "type": "stateDigest",
  "payload": {}
}
```

### Output data

```json
{
  "digest": "sha256..."
}
```

## State Structure Overview

Top-level state (`VaultState.snapshot()`):

```json
{
  "vaults": {
    "<vaultId>": {
      "id": "vault-id",
      "type": "individual|team",
      "owner": "r...",
      "createdAt": "round-key",
      "salt": "hex",
      "metadata": {},
      "manifestTokenId": "token-id",
      "authorized": ["r..."],
      "pendingInvites": [
        { "address": "r...", "invitedBy": "r...", "invitedAt": "11" }
      ],
      "entries": [
        {
          "tokenId": "entry-token-id",
          "cid": "bafy...",
          "metadata": {
            "service": "github",
            "username": "alice",
            "notes": null
          },
          "wrappedKeys": [
            { "address": "r...", "encryptedKey": "base64..." }
          ],
          "createdAt": "13"
        }
      ]
    }
  }
}
```

## Error Codes

Common codes used by contract and helpers:

| Code | Meaning |
|---|---|
| `INVALID_INPUT` | Field type/range/schema invalid |
| `INVALID_ADDRESS` | Address is malformed or fails XRPL validation |
| `INVALID_SALT` | Salt hex format/length invalid |
| `INVALID_SIGNATURE` | Missing/malformed/invalid signature or signer mismatch |
| `UNKNOWN_OPERATION` | Unsupported `op.type` |
| `VAULT_NOT_FOUND` | Vault ID not present |
| `VAULT_ALREADY_EXISTS` | Vault ID collision for owner/salt pair |
| `ENTRY_NOT_FOUND` | Entry selector not found |
| `UNAUTHORIZED` | Actor is not permitted |
| `TEAM_MODE_DISABLED` | Team-only operation while disabled |
| `INVALID_VAULT_TYPE` | Handler requires specific vault type |
| `INVITE_ALREADY_EXISTS` | Pending invite already exists |
| `INVITE_ALREADY_ACCEPTED` | Invitee already authorized |
| `INVITE_NOT_FOUND` | Pending invite not found |
| `MEMBER_NOT_FOUND` | Member missing from team authorization |
| `INVALID_OPERATION` | Illegal operation (for example owner self-removal) |
| `CONFIRMATION_REQUIRED` | Team revoke missing `confirm=true` |
| `RATE_LIMIT_EXCEEDED` | Exceeded max mutating operations per round |
| `XRPL_SUBMISSION_FAILED` | XRPL transaction submission failed in non-dev mode |
| `UNEXPECTED_ERROR` | Unclassified runtime error |

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `XVAULT_STATE_FILE` | Contract JSON state file path | `./state/xvault-state.json` |
| `QUICKNODE_GATEWAY` | Gateway base for returned `gatewayUrl` | falls back to `QUICKNODE_IPFS_GATEWAY`, then internal default |
| `QUICKNODE_IPFS_GATEWAY` | Alternate gateway variable | used if `QUICKNODE_GATEWAY` absent |
| `ENABLE_TEAM_MODE` | Enables team handlers | `false` |
| `ENABLE_MUTABLE_URITOKENS` | Enables mutable URI token update stub path | `false` |
| `XVAULT_DEV_XRPL_FALLBACK` | Allow simulated XRPL fallback on submit errors | `true` unless explicitly `"false"` |

