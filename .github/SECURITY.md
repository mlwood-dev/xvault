# Security Policy

Thank you for helping keep XVault secure.

## Supported Versions

Security fixes are prioritized for the latest default branch and the latest tagged pre-release.

## Reporting a Vulnerability

Please do not disclose security issues publicly before maintainers have reviewed them.

Preferred reporting channels:

1. GitHub private vulnerability reporting (Security Advisory), if enabled.
2. Maintainer security contact (documented in repository profile/contact metadata).

Include:

- clear description and impact
- reproduction steps
- proof-of-concept (if safe to share)
- affected files/paths and environment assumptions

## Response Targets

- Initial acknowledgement: within 5 business days
- Triage decision: within 10 business days
- Fix and disclosure timeline: severity-based

## Scope Highlights

High-priority areas:

- signature verification and authorization paths in `src/contract`
- client-side cryptography boundaries in `src/crypto` and `src/recovery`
- IPFS upload/unpin and CID handling in `src/ipfs`
- SDK request signing/orchestration in `src/sdk`

## Disclosure Expectations

- Avoid public issues for unpatched vulnerabilities.
- Coordinate disclosure timing with maintainers after a patch or mitigation is available.
