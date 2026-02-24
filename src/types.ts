// SPDX-License-Identifier: MIT

export interface VaultKeyMaterial {
  vaultId: string;
  masterKey: Uint8Array;
  method: "xaman" | "password";
}

export interface PasswordBackupEnvelope {
  version: number;
  vaultId: string;
  salt: string;
  nonce: string;
  authTag: string;
  ciphertext: string;
}
