import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { jest } from "@jest/globals";

export function createIsolatedStateFile() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xvault-jest-"));
  return path.join(tempRoot, "state.json");
}

export async function importContractWithIsolatedState(stateFilePath) {
  process.env.XVAULT_STATE_FILE = stateFilePath;
  jest.resetModules();
  return import("../../src/contract/index.js");
}
