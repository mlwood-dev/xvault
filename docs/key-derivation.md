---
title: Key Derivation
---

# Key Derivation and Backup

This document describes how XVault derives per-vault master keys and how optional password backup is produced and stored.

## Xaman Master Key Derivation

XVault derives a stable 32-byte master key from a Xaman SignIn signature and HKDF.

- Challenge: `xVault-master-key-v1:${vaultId}`
- HKDF: SHA-256, salt = `vaultId`, info = `xvault:master-key:v1`, length = 32 bytes

```mermaid
flowchart LR
  U[User] --> X[Xaman SignIn]
  X --> S[Signature bytes]
  S --> HKDF[HKDF-SHA256]
  V[vaultId] --> HKDF
  HKDF --> MK[masterKey (32 bytes)]
```

## Password Backup Flow

Password backup encrypts the master key locally and stores only ciphertext metadata on the contract.

- KDF: Argon2id
- AES-256-GCM with `vaultId` as AAD
- Stored metadata fields: `version`, `vaultId`, `salt`, `nonce`, `authTag`, `ciphertext`

```mermaid
flowchart LR
  P[Password] --> KDF[Argon2id]
  KDF --> KEK[Key-encryption key]
  MK[masterKey (32 bytes)] --> GCM[AES-256-GCM]
  KEK --> GCM
  V[vaultId as AAD] --> GCM
  GCM --> ENVELOPE[Password backup envelope]
  ENVELOPE --> META[Contract metadata]
```

### Argon2id Parameters

```json
{
  "type": "argon2id",
  "memoryCost": 131072,
  "timeCost": 4,
  "parallelism": 4,
  "hashLength": 32,
  "version": 19
}
```

`version` value `19` corresponds to `0x13`.
