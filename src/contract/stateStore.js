import fs from "node:fs";
import path from "node:path";

const DEFAULT_STATE_FILE = "./state/xvault-state.json";

export function loadStateFromFs(stateFile = DEFAULT_STATE_FILE) {
  if (!fs.existsSync(stateFile)) {
    return { vaults: {} };
  }
  const raw = fs.readFileSync(stateFile, "utf8");
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === "object" ? parsed : { vaults: {} };
}

export function saveStateToFs(stateFile = DEFAULT_STATE_FILE, snapshot) {
  const dir = path.dirname(stateFile);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(stateFile, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

