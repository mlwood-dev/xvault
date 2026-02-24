// SPDX-License-Identifier: MIT
import { Command } from "commander";
import { registerAddBackupPasswordCommand } from "./commands/add-backup-password.js";
import { registerCreateVaultCommand } from "./commands/create-vault.js";
import { registerRemoveBackupPasswordCommand } from "./commands/remove-backup-password.js";

export async function runCli(argv = process.argv) {
  const program = new Command();
  program.name("xvault").description("XVault CLI").version("0.1.0");

  registerCreateVaultCommand(program);
  registerAddBackupPasswordCommand(program);
  registerRemoveBackupPasswordCommand(program);

  await program.parseAsync(argv);
}

runCli().catch((error) => {
  console.error(error?.message ?? String(error));
  process.exitCode = 1;
});
