import type { Client, Wallet } from "xahau";

export interface VaultSummary {
  vaultId: string;
  owner: string;
  type?: "individual" | "team";
  manifestTokenId?: string;
}

export interface EntryPayload {
  service: string;
  username?: string;
  password?: string;
  notes?: string;
}

export interface RecoveryShare {
  shareId: string;
  share: string;
}

export interface XVaultClientConfig {
  hotpocketWsUrl: string;
  xrplClient: Client; // Xahau client
  wallet: Wallet;
  quicknodeConfig: {
    apiKey?: string;
    apiBase?: string;
    gateway: string;
    fetchImpl?: typeof fetch;
  };
  enableTeamMode?: boolean;
  rootKeyProvider?: (ctx: { vaultId: string; type: "individual" | "team" }) => Promise<Uint8Array>;
  getTeamAuthorizedAddresses?: (vaultId: string) => Promise<string[]>;
  getVaultSalt?: (vaultId: string) => Promise<string>;
  wsTimeoutMs?: number;
  wsFactory?: (url: string) => any;
  submitContractRequest?: (operation: { type: string; payload: object }) => Promise<any>;
}

export interface XVaultClient {
  createVault(options: {
    type: "individual" | "team";
    initialAuthorized?: string[];
    recoveryThreshold?: number;
    recoveryTotal?: number;
  }): Promise<{ vaultId: string; manifestTokenId: string }>;
  addEntry(vaultId: string, entryData: EntryPayload): Promise<{ tokenId: string; cid: string }>;
  getEntry(vaultId: string, entryIndexOrTokenId: string | number): Promise<{ cid: string; gatewayUrl: string; metadata: object }>;
  listVaults(): Promise<VaultSummary[]>;
  inviteToVault(vaultId: string, inviteeAddress: string): Promise<void>;
  acceptInvite(vaultId: string): Promise<void>;
  removeMember(vaultId: string, memberAddress: string): Promise<void>;
  revokeVault(vaultId: string): Promise<void>;
  enableRecovery(vaultId: string, threshold: number, total: number): Promise<{ shares: string[]; recoveryMetadataCid?: string }>;
  recoverVault(shares: string[], vaultId: string): Promise<boolean>;
  close(): Promise<void>;
}

export function createXVaultClient(config: XVaultClientConfig): XVaultClient;

