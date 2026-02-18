# XVault Security Model

This document defines the security assumptions, guarantees, and operator responsibilities for the current XVault implementation.

## Threat Model

XVault assumes:

- Contract nodes, transport, and storage providers are untrusted for confidentiality.
- Client devices are trusted to perform cryptographic operations correctly while uncompromised.
- Attackers may observe contract state, ledger events, and IPFS CIDs.
- Attackers may attempt forged contract requests, unauthorized membership changes, and malformed payload submissions.

Out of scope for current implementation:

- Client endpoint malware compromise.
- Full key escrow or account recovery service infrastructure.
- Automatic deletion/erasure guarantees on decentralized storage networks.

## Encryption and Data Invariants

Core invariants:

1. Plaintext secret material is encrypted client-side before contract submission.
2. Contract stores only metadata, CIDs, wrapped keys, and authorization state.
3. Contract never decrypts entries and never receives master passwords or root keys.
4. Recovery shares and secrets are generated/combined client-side only.

Entry confidentiality:

- Root key derivation: Argon2id (`vaultCrypto.deriveRootKey`) for password-based root material.
- Entry encryption: AES-256-GCM with authenticated data context (`xvault:entry:v1`).
- Team flow: per-entry key wrapping for each authorized recipient public key.

## Signature and Authorization Controls

- Mutating operations require signature verification against canonical payload hash.
- Signer public key must derive to expected actor/owner address.
- Team operations enforce owner/member roles via `authorized` and `pendingInvites`.
- Contract applies mutating rate limits (max 5 per actor per round).

## Key Management

## Individual Vaults

- User supplies master password.
- Client derives root key with Argon2id and encrypts entry payload.

## Team Vaults

- Entry data encrypted once.
- Entry key wrapped per authorized member public key (hybrid envelope in `wrappedKeys`).
- Membership changes require client-side re-encryption/key-rotation workflow for strict forward secrecy.

## Recovery Skeleton (Shamir)

- `generateRecoveryShares` splits recovery secret into threshold shares.
- `combineShares` reconstructs secret only when threshold is met.
- `deriveRecoveryRoot` derives 32-byte root key material from recovered secret + vault salt.
- Only non-sensitive recovery metadata should be persisted (threshold/total/hash indicators).

## Trust Assumptions and Compromise Impact

## Compromised Contract Node

- Cannot decrypt entry plaintext without client keys/secrets.
- Can observe metadata patterns, CIDs, membership events, and request timing.
- Can reject/withhold service; cannot forge valid signed requests without keys.

## Compromised Storage Provider

- Can serve or withhold ciphertext blobs.
- Cannot decrypt ciphertext without client-held keys.
- May retain data after logical revocation unless explicitly unpinned/garbage-collected.

## Compromised Client Device

- High impact: attacker may access local secrets, shares, session keys, wallet seed, or decrypted plaintext.
- Recommended mitigations: OS hardening, hardware security modules, full disk encryption, secure backup discipline.

## Recovery Share Distribution Warnings

- Shares are sensitive artifacts and must be distributed over secure channels.
- Do not store all shares in one location/account.
- Prefer offline/physical split or independently encrypted channels.
- Use threshold settings that tolerate one-share loss and prevent one-share compromise (`2-of-3`, `3-of-5` patterns).
- Test recovery procedure in a controlled environment before relying on it for production data.

## Operational Security Responsibilities

- Rotate wallet secrets and application credentials on compromise indicators.
- Keep QuickNode API key private and never expose in frontend bundles.
- Unpin revoked/obsolete CIDs when storage minimization is required.
- Monitor logs and error codes for signature failures and authorization anomalies.

