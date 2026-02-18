# Security Policy

## Supported Scope

Security reports are accepted for implemented runtime components:

- HotPocket contract handlers and deterministic state logic (`src/contract/**`)
- Client-side cryptography and key handling (`src/crypto/**`, `src/recovery/**`)
- IPFS integration and CID handling (`src/ipfs/**`)
- SDK request signing/orchestration (`src/sdk/**`)

## Responsible Disclosure

Please report vulnerabilities privately before public disclosure.

Preferred channels:

1. GitHub private vulnerability reporting (Security Advisory), if enabled.
2. Maintainer security contact channel.

Please include:

- clear issue description and impact
- reproduction steps
- affected version/commit hash
- affected files/paths
- proof-of-concept details where safe

Please avoid public issue disclosure until a fix or mitigation is ready.

## Disclosure Expectations

- Acknowledgement target: within 5 business days
- Initial triage target: within 10 business days
- Fix timeline: severity and release readiness dependent

## High-Value Targets

- Signature verification bypasses
- Authorization bypasses in team/member flows
- Client-side key/secret leakage paths
- CID/path injection or malformed payload handling gaps
- Recovery share handling or root key derivation weaknesses

## Operational Security Notes

Vault revocation in contract state is irreversible and burns associated URI Tokens, but it does not automatically delete encrypted blobs from IPFS.

After revocation, clients/operators should:

1. Clear local vault caches.
2. Unpin associated CIDs from QuickNode/IPFS.
3. Remove stale references to revoked blobs.

## Safe Harbor

Good-faith security research is welcome. Please avoid:

- privacy violations
- destructive tests on production infrastructure
- intentional service disruption

Coordinate testing scope with maintainers when uncertain.

