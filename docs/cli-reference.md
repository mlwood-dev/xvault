---
title: CLI Reference
---

# XVault CLI Reference

## Environment

The CLI reads configuration from environment variables:

- ``````XVAULT_HOTPocket_WS_URL`: HotPocket contract WebSocket URL
- `XVAULT_XAHAU_WS_URL`: Xahau WebSocket URL
- `XVAULT_XRPL_WS_URL`: Deprecated fallback for Xahau WebSocket URL
- `XVAULT_WALLET_SEED`: Wallet seed (used for create-vault signing)
- `XVAULT_XAMAN_API_KEY`: Xaman API key
- `XVAULT_XAMAN_API_SECRET`: Xaman API secret (if required by SDK)`````

## Commands

### create-vault

Create a new vault and optionally add a password backup.

```
xvault create-vault --type individual --name "Personal"
xvault create-vault --type team --name "Ops Vault"
xvault create-vault --with-backup
```

Options:

- `--type <individual|team>`: Vault type (default: `individual`)
- `--name <name>`: Human-readable name stored in metadata
- `--with-backup`: Prompt for a backup password
- `--backup-password <password>`: Provide backup password (not recommended on CLI history)

### add-backup-password

Add a password backup to an existing vault.

```
xvault add-backup-password --vault-id <vaultId>
```

Options:

- `--vault-id <vaultId>`: Vault ID (required)
- `--password <password>`: Provide backup password (not recommended on CLI history)

### remove-backup-password

Remove a password backup from a vault.

```
xvault remove-backup-password --vault-id <vaultId>
```

Options:

- `--vault-id <vaultId>`: Vault ID (required)
- `--yes`: Skip confirmation prompt

## Notes

- Xaman sign-in is required for backup operations and master key derivation.
- Backup passwords are never sent to the contract; only encrypted metadata is stored.
- Avoid using `--password` and `--backup-password` in shared shells or logs.
