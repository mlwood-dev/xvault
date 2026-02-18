# XVault Deployment and Cluster Testing Guide

This runbook refines deployment for an Evernode-hosted HotPocket cluster, with Xahau testnet as the default target network. Mainnet use is possible, but should only be attempted after security review and audit.

## Scope

This guide covers:

- provisioning a 3-5 node Evernode cluster
- deploying the existing XVault contract bundle
- secure environment/configuration setup
- structured cluster testing from local to distributed testnet
- verification of contract, URI token, IPFS, and recovery skeleton behavior

This guide does not introduce new code features or speculative operations stacks.

## Prerequisites

## Software

- Node.js `>=20`
- npm
- `xrpl.js` tooling for validation scripts and wallet checks
- Evernode tooling:
  - `evdevkit` (local and dev workflows)
  - Evernode CLI (cluster lease and deployment operations)

## Accounts and Network Access

- Evernode account funded with EVR (for host leasing and operations)
- Xahau testnet wallet(s):
  - contract/operator identity
  - client test actors (owner, member, invitee)
- QuickNode IPFS account:
  - API key
  - API base URL (if non-default)
  - gateway URL

## Sensitive Data Handling

- Do not place wallet seeds or private keys in source-controlled files.
- Use environment variables and/or secure host secret stores.
- Treat `QUICKNODE_IPFS_API_KEY` as a secret with write privileges.

## Build and Package Contract

From repository root:

```bash
npm install
npm test
npm run test:jest
```

Prepare deployment bundle in your standard HotPocket package format, ensuring:

- `src/contract` and required runtime files are included
- lockfile integrity is preserved
- deployment artifact hash is recorded for release traceability

## Cluster Provisioning (Evernode)

Use official Evernode CLI workflow for your environment.

Recommended sizing:

- dev/test cluster: 3 nodes
- production-like validation: 5 nodes

High-level flow:

1. Authenticate and select network (Xahau testnet first).
2. Lease required host instances.
3. Create cluster and bind leased hosts.
4. Upload/attach XVault HotPocket contract bundle.
5. Start cluster and wait for healthy status.

Example command pattern (adapt to your installed CLI version):

```bash
# Illustrative only; use your Evernode CLI command syntax.
evernode --network testnet cluster create --nodes 3 --name xvault-test
evernode --network testnet cluster deploy --name xvault-test --bundle ./dist/xvault-contract.zip
evernode --network testnet cluster start --name xvault-test
evernode --network testnet cluster status --name xvault-test
```

## Contract Configuration

Set contract environment values on each host/cluster config:

| Variable | Recommended Value | Purpose |
|---|---|---|
| `XVAULT_STATE_FILE` | host persistent path | deterministic state persistence |
| `ENABLE_TEAM_MODE` | `true` | enables team lifecycle handlers |
| `ENABLE_MUTABLE_URITOKENS` | `false` unless explicitly testing mutable path | manifest update behavior |
| `XVAULT_DEV_XRPL_FALLBACK` | `false` in production-like tests | fail hard on XRPL submission errors |
| `QUICKNODE_GATEWAY` | your QuickNode gateway | fetch URL composition |

Client/SDK runtime environment:

| Variable | Purpose |
|---|---|
| `HOTPOCKET_WS_URL` | cluster WebSocket endpoint |
| `XRPL_WS_URL` | Xahau testnet WebSocket endpoint |
| `XRPL_SEED` | client signing wallet seed (secure secret) |
| `XVAULT_MASTER_PASSWORD` | local test password input |
| `QUICKNODE_IPFS_API_KEY` | QuickNode REST auth |
| `QUICKNODE_IPFS_API_BASE` | optional QuickNode API base override |
| `QUICKNODE_GATEWAY` | IPFS fetch gateway |
| `XVAULT_VAULT_SALTS` | recovery/root key test mapping |

## Secure Deployment Best Practices

- Use multi-signature issuer/signers for URI token mint/burn paths where possible.
- Rotate operational keys after initial deployment and access bootstrap.
- Restrict cluster WS endpoint ingress to known client networks/IPs.
- Keep `XVAULT_DEV_XRPL_FALLBACK=false` when validating production-like behavior.
- Enable team mode intentionally (`ENABLE_TEAM_MODE=true`) and verify access rules before exposure.
- Maintain a revocation runbook including CID unpin steps.

## Post-Deployment Verification

## 1) Cluster health

```bash
# Illustrative
evernode --network testnet cluster status --name xvault-test
```

Confirm:

- all nodes online
- contract active
- no startup crash loops

## 2) WebSocket request sanity

Use `wscat`, `curl`-compatible WS tooling, or SDK.

```bash
wscat -c ws://<cluster-endpoint>
```

Submit a signed `createVault` payload and confirm:

- `ok: true`
- `data.vaultId` present
- deterministic response shape on repeated node checks

## 3) Ledger and storage sanity

- Confirm URI token mint/burn behavior using `xrpl.js` account/token queries.
- Confirm CID is retrievable from configured QuickNode gateway.

## Cluster Testing Procedures

Run testing in phases:

1. local single-node simulation
2. Evernode multi-node testnet cluster
3. production-like rehearsal (5 nodes, fallback disabled, realistic secrets process)

## Phase A: Local Simulation

1. Run all tests:
   - `npm test`
   - `npm run test:jest`
2. Execute manual SDK/CLI smoke flow against local WS endpoint.
3. Validate expected errors for malformed signatures and unauthorized actions.

## Phase B: Evernode Multi-Node Testnet

Deploy to 3-5 nodes, then execute scenarios below.

### Scenario 1: Individual vault lifecycle

Flow:

1. `createVault`
2. `addEntry` x3
3. `getMyVaults`
4. `getEntry` (index and tokenId)
5. `revokeVault`

Verify:

- consistent entry counts
- valid CIDs and gateway URLs
- post-revoke vault missing from owner list
- expected URI token burns visible from ledger query

### Scenario 2: Team vault lifecycle

Flow:

1. create team vault with 2 authorized users
2. invite third member
3. third member accepts invite
4. add shared entry with wrapped keys
5. remove one member
6. removed member attempts read (must fail)
7. owner revokes vault

Verify:

- `authorizedCount` transitions are correct
- `pendingInviteCount` transitions are correct
- unauthorized read rejection after removal

### Scenario 3: Recovery skeleton

Flow:

1. create vault with recovery metadata intent
2. generate `3-of-5` shares client-side (`enableRecovery`)
3. combine threshold shares and derive recovery root client-side
4. confirm `recoverVault` returns success

Verify:

- no recovery shares transmitted to contract
- only non-sensitive recovery metadata CID/hash indicators are persisted

### Scenario 4: Revocation and token burn verification

Flow:

1. create + add entries
2. revoke vault
3. query ledger for burn activity and token state

Verify:

- vault removed from contract state
- burn operations reported
- IPFS content still present until unpin (expected behavior)

### Scenario 5: Fault tolerance

Flow:

1. with active cluster, stop/kill one node
2. continue submitting signed operations
3. restore node and re-check state consistency

Verify:

- cluster continues processing within quorum
- no divergent state digest across active nodes

## Tools for Testing

- SDK/CLI for functional flows
- `wscat` for raw WS payload checks
- `xrpl.js` scripts for ledger/token verification
- Jest/Vitest for repeatable assertion baseline

## Expected Failure Modes and Mitigations

| Failure Mode | Typical Error | Mitigation |
|---|---|---|
| Signature mismatch | `INVALID_SIGNATURE` | Rebuild canonical payload, ensure signer key/address match |
| Unauthorized actor | `UNAUTHORIZED` | Validate owner/member role and invite acceptance sequence |
| Rate limit exceeded | `RATE_LIMIT_EXCEEDED` | Spread mutating ops across rounds; batch less aggressively |
| Team mode disabled | `TEAM_MODE_DISABLED` | Set `ENABLE_TEAM_MODE=true` and redeploy |
| XRPL submission failure | `XRPL_SUBMISSION_FAILED` | Validate endpoint, signer setup, network fees, retry policy |
| CID validation failure | `INVALID_CID` / `INVALID_INPUT` | Confirm IPFS upload success and CID format before submit |

## Checklist

Use this table during rollout and test sign-off.

| Scenario | Expected Outcome | Verification Method | Status |
|---|---|---|---|
| Cluster boots (3-5 nodes) | All nodes healthy and contract active | Evernode CLI status command | Pending |
| Individual lifecycle | Create/add/list/get/revoke succeeds | SDK flow + WS response checks | Pending |
| Team lifecycle | Invite/accept/add/remove/deny works correctly | SDK flow + unauthorized read check | Pending |
| Recovery skeleton | 3-of-5 shares combine and recover root client-side | SDK `enableRecovery` + `recoverVault` | Pending |
| Revocation + burns | Vault removed and burn operations visible | Contract response + `xrpl.js` ledger query | Pending |
| IPFS integration | CIDs resolve via gateway; unpin process documented | Gateway fetch + QuickNode API check | Pending |
| Fault tolerance | One node down, quorum continues | Controlled node stop + continued writes | Pending |
| Signature enforcement | Forged signature rejected | Raw WS negative test | Pending |
| Rate limiting | Excess per-round writes rejected | Automated/WS burst test | Pending |

## Security Reminders

- Use Xahau testnet first; do not deploy to mainnet until audit and operational review are complete.
- Never expose wallet seeds, private keys, or QuickNode write keys in client bundles.
- Restrict WS endpoint access and rotate deployment credentials after provisioning.
- Treat recovery shares as high-sensitivity secrets and distribute out-of-band.
- Revocation does not delete pinned IPFS blobs; execute unpin process explicitly.

