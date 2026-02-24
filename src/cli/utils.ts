// SPDX-License-Identifier: MIT
import { createHash, randomBytes } from "node:crypto";
import inquirer from "inquirer";
import keypairs from "ripple-keypairs";
import zxcvbn from "zxcvbn";
import { Client, Wallet } from "xahau";
import { createHotPocketTransport } from "../sdk/wsTransport.js";

export type CliEnvConfig = {
  hotpocketWsUrl: string;
  xahauWsUrl: string;
  walletSeed?: string;
  xamanApiKey?: string;
  xamanApiSecret?: string;
};

export type HotPocketTransport = ReturnType<typeof createHotPocketTransport>;

export function loadCliEnvConfig(overrides: Partial<CliEnvConfig> = {}): CliEnvConfig {
  const hotpocketWsUrl =
    overrides.hotpocketWsUrl ?? process.env.XVAULT_HOTPOCKET_WS_URL ?? process.env.HOTPOCKET_WS_URL ?? "";
  const xahauWsUrl =
    overrides.xahauWsUrl ??
    process.env.XVAULT_XAHAU_WS_URL ??
    process.env.XVAULT_XRPL_WS_URL ??
    process.env.XRPL_WS_URL ??
    "";
  const walletSeed = overrides.walletSeed ?? process.env.XVAULT_WALLET_SEED ?? "";
  const xamanApiKey = overrides.xamanApiKey ?? process.env.XVAULT_XAMAN_API_KEY ?? "";
  const xamanApiSecret = overrides.xamanApiSecret ?? process.env.XVAULT_XAMAN_API_SECRET ?? "";
  if (!hotpocketWsUrl) {
    throw new Error("XVAULT_HOTPOCKET_WS_URL (or HOTPOCKET_WS_URL) is required.");
  }
  return {
    hotpocketWsUrl,
    xahauWsUrl,
    walletSeed: walletSeed || undefined,
    xamanApiKey: xamanApiKey || undefined,
    xamanApiSecret: xamanApiSecret || undefined
  };
}

export async function createXrplClient(wsUrl: string): Promise<Client> {
  if (!wsUrl) {
    throw new Error("XVAULT_XAHAU_WS_URL (or XVAULT_XRPL_WS_URL / XRPL_WS_URL) is required.");
  }
  const client = new Client(wsUrl);
  await client.connect();
  return client;
}

export function createHotPocketClient(wsUrl: string): HotPocketTransport {
  return createHotPocketTransport({ url: wsUrl });
}

export async function createXamanClient(apiKey?: string, apiSecret?: string): Promise<any> {
  if (!apiKey) {
    throw new Error("XVAULT_XAMAN_API_KEY is required.");
  }
  const mod: any = await import("xumm");
  const Candidate = mod?.Xaman ?? mod?.default ?? mod?.Xumm ?? mod?.XummSdk;
  if (!Candidate) {
    throw new Error("Failed to resolve Xaman SDK constructor.");
  }
  return apiSecret ? new Candidate(apiKey, apiSecret) : new Candidate(apiKey);
}

export function loadWalletFromSeed(seed?: string): Wallet {
  if (!seed) {
    throw new Error("XVAULT_WALLET_SEED is required for wallet-based signing.");
  }
  return Wallet.fromSeed(seed);
}

export function signPayload(payload: Record<string, any>, wallet: Wallet): string {
  const digest = hashForSigning(payload);
  return keypairs.sign(digest, wallet.privateKey);
}

export function hashForSigning(payload: Record<string, any>): string {
  return createHash("sha256").update(stableStringify(payload), "utf8").digest("hex");
}

export function stableStringify(value: any): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function buildVaultSalt(): string {
  return randomBytes(16).toString("hex");
}

export function buildVaultId(owner: string, salt: string): string {
  return createHash("sha256").update(`${owner}:${salt}`, "utf8").digest("hex");
}

export async function promptPassword(label: string): Promise<string> {
  const { password } = await inquirer.prompt([
    {
      type: "password",
      name: "password",
      message: label,
      mask: "*",
      validate: (value: string) => (value && value.trim().length > 0 ? true : "Password is required.")
    }
  ]);
  const { confirm } = await inquirer.prompt([
    {
      type: "password",
      name: "confirm",
      message: "Confirm password",
      mask: "*",
      validate: (value: string) => (value && value.trim().length > 0 ? true : "Password confirmation is required.")
    }
  ]);
  if (password !== confirm) {
    throw new Error("Passwords do not match.");
  }
  return password;
}

export async function confirmWeakPassword(password: string): Promise<void> {
  const strength = zxcvbn(password);
  if (strength.score >= 3) return;
  const warning = strength.feedback?.warning ? `Warning: ${strength.feedback.warning}` : "Warning: password is weak.";
  console.warn(warning);
  if (strength.feedback?.suggestions?.length) {
    console.warn(`Suggestions: ${strength.feedback.suggestions.join(" ")}`);
  }
  const { proceed } = await inquirer.prompt([
    {
      type: "confirm",
      name: "proceed",
      message: "Proceed with a weak password?",
      default: false
    }
  ]);
  if (!proceed) {
    throw new Error("Aborted due to weak password.");
  }
}

export async function confirmAction(message: string): Promise<boolean> {
  const { proceed } = await inquirer.prompt([
    {
      type: "confirm",
      name: "proceed",
      message,
      default: false
    }
  ]);
  return Boolean(proceed);
}
