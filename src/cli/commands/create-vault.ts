// SPDX-License-Identifier: MIT
import { Command } from "commander";
import type { Client } from "xahau";
import { VaultKeyManager } from "../../sdk/VaultKeyManager.js";
import {
  buildVaultSalt,
  confirmWeakPassword,
  createHotPocketClient,
  createXamanClient,
  createXrplClient,
  loadCliEnvConfig,
  loadWalletFromSeed,
  promptPassword,
  signPayload
} from "../utils.js";

type CreateVaultOptions = {
  type?: "individual" | "team";
  name?: string;
  backupPassword?: string;
  withBackup?: boolean;
};

export function registerCreateVaultCommand(program: Command) {
  program
    .command("create-vault")
    .description("Create a new XVault (individual or team).")
    .option("--type <type>", "Vault type: individual or team", "individual")
    .option("--name <name>", "Human-readable vault name")
    .option("--backup-password <password>", "Set backup password (not recommended on CLI history)")
    .option("--with-backup", "Prompt to set a backup password")
    .action(async (options: CreateVaultOptions) => {
      const config = loadCliEnvConfig();
      const wallet = loadWalletFromSeed(config.walletSeed);
      const transport = createHotPocketClient(config.hotpocketWsUrl);
      let xrplClient: Client | null = null;

      try {
        const type = options.type === "team" ? "team" : "individual";
        const metadata: Record<string, any> = {};
        if (options.name) metadata.name = options.name;

        const salt = buildVaultSalt();
        const payload = {
          type,
          owner: wallet.classicAddress,
          salt,
          metadata,
          ...(type === "team" ? { initialAuthorized: [] } : {})
        };
        const signature = signPayload(payload, wallet);
        const response = await transport.submit({
          type: type === "team" ? "createTeamVault" : "createVault",
          payload: {
            ...payload,
            signerPublicKey: wallet.publicKey,
            signature
          }
        });
        if (!response?.ok) {
          throw new Error(response?.error ?? "createVault failed.");
        }
        const vaultId = response.data?.vaultId;
        console.info(`Vault created: ${vaultId}`);

        let password: string | null = null;
        if (options.backupPassword) {
          console.warn("Warning: --backup-password is visible in shell history.");
          password = options.backupPassword;
        } else if (options.withBackup) {
          password = await promptPassword("Backup password");
        }

        if (password) {
          await confirmWeakPassword(password);
          xrplClient = await createXrplClient(config.xahauWsUrl);
          const xaman = await createXamanClient(config.xamanApiKey, config.xamanApiSecret);
          const keyManager = new VaultKeyManager(xrplClient, xaman, transport);
          await keyManager.addPasswordBackup(vaultId, password);
          console.info("Password backup added.");
        }
      } finally {
        if (xrplClient) {
          if (typeof xrplClient.disconnect === "function") {
            await xrplClient.disconnect();
          }
        }
        if (transport?.close) {
          await transport.close();
        }
      }
    });
}
