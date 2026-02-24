# XVault Audit Preparation Stub

This document is the pre-audit workspace for external security review of XVault.

## 1) Code Freeze

- Target freeze date: `TBD`
- Freeze commit hash: `TBD`
- Release candidate tag: `TBD`
- Change policy during audit: critical fixes only, with explicit changelog.

## 2) Scope Definition

## In Scope

- Contract runtime:
  - `src/contract/index.js`
  - `src/contract/state.js`
  - `src/contract/xrplUtils.js`
  - `src/contract/errors.js`
  - `src/contract/config.js`
- Client crypto and recovery:
  - `src/crypto/vaultCrypto.js`
  - `src/recovery/shamirRecovery.js`
- Storage integration:
  - `src/ipfs/quicknodeIpfs.js`
- SDK/transport:
  - `src/sdk/xvaultClient.js`
  - `src/sdk/wsTransport.js`

## Out of Scope

- Example scripts under `examples/`
- Non-runtime docs and templates
- Third-party service internals (QuickNode, Xahau validators, Evernode infra internals)

## 3) Documentation Package for Auditor

- `README.md` (architecture and operational framing)
- `docs/contract-api.md`
- `docs/sdk-api.md`
- `docs/security-model.md`
- `docs/deployment.md`
- `CHECKLIST.md` (release and security gates)

## 4) Test and Verification Artifacts

- Unit/integration status:
  - `npm test`
  - `npm run test:jest`
- Coverage report snapshot (attach output artifact)
- Cluster validation evidence from deployment checklist scenarios

## 5) Dependency Audit

- Run `npm audit` and record findings/remediation decisions.
- Manual high-risk dependency review:
  - `xahau`
  - `argon2`
  - `argon2-browser`
  - `@noble/curves`
  - `secrets.js-grempe`
  - `ripple-keypairs`

## 6) Pre-Audit Self-Review Checklist

- [ ] Signature verification and signer-address binding
- [ ] Access-control checks for individual and team flows
- [ ] Deterministic state transition invariants (HotPocket consensus safety)
- [ ] Rate-limit path validation
- [ ] URI token mint/burn fallback behavior and failure handling
- [ ] CID/base64 validation and malformed input rejection
- [ ] Recovery flow guarantees:
  - [ ] shares generated/combined client-side only
  - [ ] no contract-side secret handling
- [ ] Reentrancy assessment: N/A in current HotPocket request model (documented)

## 7) Candidate Auditors

Recommended firms/teams with blockchain security experience:

- OpenZeppelin
- Trail of Bits
- Consensys Diligence
- XRPL/Xahau-specialized independent assessors

## 8) Open Questions for Auditor

- Are signature canonicalization and payload binding rules complete across all handlers?
- Are there consensus divergence risks in state mutation ordering or rate-limit logic?
- Are URI token integration assumptions safe under partial XRPL failures?
- Are client-side crypto boundaries sufficiently enforced by interfaces and docs?
