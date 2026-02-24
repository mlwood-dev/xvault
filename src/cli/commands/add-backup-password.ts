// SPDX-License-Identifier: MIT
import { Command } from "commander";
import type { Client } from "xahau";
import { VaultKeyManager } from "../../sdk/VaultKeyManager.js";
import {
  confirmWeakPassword,
  createHotPocketClient,
  createXamanClient,
  createXrplClient,
  loadCliEnvConfig,
  promptPassword
} from "../utils.js";

type AddBackupOptions = {
  vaultId?: string;
  password?: string;
};

export function registerAddBackupPasswordCommand(program: Command) {
  program
    .command("add-backup-password")
    .description("Add a password backup to an existing vault.")
    .requiredOption("--vault-id <vaultId>", "Vault ID")
    .option("--password <password>", "Backup password (not recommended on CLI history)")
    .action(async (options: AddBackupOptions) => {
      const config = loadCliEnvConfig();
      const transport = createHotPocketClient(config.hotpocketWsUrl);
      let xrplClient: Client | null = null;
      try {
        const vaultId = options.vaultId ?? "";
        if (!vaultId) throw new Error("vaultId is required.");

        let password = options.password ?? null;
        if (options.password) {
          console.warn("Warning: --password is visible in shell history.");
        }
        if (!password) {
          password = await promptPassword("Backup password");
        }
        await confirmWeakPassword(password);

        xrplClient = await createXrplClient(config.xahauWsUrl);
        const xaman = await createXamanClient(config.xamanApiKey, config.xamanApiSecret);
        const keyManager = new VaultKeyManager(xrplClient, xaman, transport);
        await keyManager.addPasswordBackup(vaultId, password);
        console.info("Password backup added.");
      } finally {
        if (xrplClient && typeof xrplClient.disconnect === "function") {
          await xrplClient.disconnect();
        }
        if (transport?.close) {
          await transport.close();
        }
      }
    });
}
