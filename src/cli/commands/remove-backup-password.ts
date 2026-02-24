// SPDX-License-Identifier: MIT
import { Command } from "commander";
import type { Client } from "xahau";
import { VaultKeyManager } from "../../sdk/VaultKeyManager.js";
import {
  confirmAction,
  createHotPocketClient,
  createXamanClient,
  createXrplClient,
  loadCliEnvConfig
} from "../utils.js";

type RemoveBackupOptions = {
  vaultId?: string;
  yes?: boolean;
};

export function registerRemoveBackupPasswordCommand(program: Command) {
  program
    .command("remove-backup-password")
    .description("Remove password backup metadata from a vault.")
    .requiredOption("--vault-id <vaultId>", "Vault ID")
    .option("--yes", "Skip confirmation prompt")
    .action(async (options: RemoveBackupOptions) => {
      const config = loadCliEnvConfig();
      const transport = createHotPocketClient(config.hotpocketWsUrl);
      let xrplClient: Client | null = null;
      try {
        const vaultId = options.vaultId ?? "";
        if (!vaultId) throw new Error("vaultId is required.");
        if (!options.yes) {
          const confirmed = await confirmAction("Remove password backup for this vault?");
          if (!confirmed) {
            console.info("Aborted.");
            return;
          }
        }
        xrplClient = await createXrplClient(config.xahauWsUrl);
        const xaman = await createXamanClient(config.xamanApiKey, config.xamanApiSecret);
        const keyManager = new VaultKeyManager(xrplClient, xaman, transport);
        await keyManager.removePasswordBackup(vaultId);
        console.info("Password backup removed.");
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
