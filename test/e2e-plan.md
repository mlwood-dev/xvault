# XVault Basic E2E Plan

This plan covers manual/scripted validation for individual and team flows using a local HotPocket-compatible environment and mocked external services where practical.

## Environment

1. Start local Evernode/HotPocket-like cluster in dev mode (evdevkit or equivalent).
2. Prepare test wallets:
   - `wallet_owner`
   - `wallet_member`
3. Configure:
   - `ENABLE_TEAM_MODE=true`
   - `QUICKNODE_GATEWAY=<dedicated-ipfs-gateway>`
4. Use mocked/non-production QuickNode IPFS API key in local env.

## Flow 1: Individual Vault

1. Create individual vault via signed `createVault`.
2. Client encrypts entry payload (local module).
3. Upload encrypted blob to QuickNode IPFS, capture CID.
4. Submit `addEntry` with CID and metadata.
5. Retrieve via `getEntry`, fetch blob from gateway, decrypt client-side.
6. Assert:
   - Contract never returns plaintext.
   - CID and metadata are consistent.

## Flow 2: Team Vault Membership

1. Owner creates team vault via `createTeamVault`.
2. Owner invites member with `inviteToVault`.
3. Member accepts via `acceptInvite`.
4. Owner verifies pending list (`getPendingInvites`) is cleared.
5. Member adds shared entry.
6. Member retrieves shared entry.
7. Owner removes member with `removeMember`.
8. Member attempts `getEntry` and is rejected.
9. Assert:
   - Authorization changes are immediate.
   - Audit logs include invite/accept/remove events.

## Flow 3: Manifest Update Fallback

1. Trigger membership change in team vault.
2. Client re-encrypts and re-uploads policy blob.
3. Owner calls `updateVaultManifest`.
4. With `ENABLE_MUTABLE_URITOKENS=false`, verify burn/remint fallback behavior and new manifest token ID.

## Suggested tooling

- Node scripts using `xrpl.js` for signing and contract calls.
- `curl`/Postman for contract request simulation.
- Xaman wallet for manual signature checks.
