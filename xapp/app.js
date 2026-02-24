const VALID_XAPP_STYLES = new Set(["light", "dark", "moonlight", "royal"]);
const params = new URLSearchParams(window.location.search);

const ui = {
  themeLabel: document.getElementById("theme-label"),
  connectionPill: document.getElementById("connection-pill"),
  connectForm: document.getElementById("connect-form"),
  connectButton: document.getElementById("connect-button"),
  serviceUrl: document.getElementById("service-url"),
  connectHint: document.getElementById("connect-hint"),
  sessionAccount: document.getElementById("session-account"),
  sessionNetwork: document.getElementById("session-network"),
  sessionState: document.getElementById("session-state"),
  createVaultForm: document.getElementById("create-vault-form"),
  createVaultButton: document.getElementById("create-vault-button"),
  vaultType: document.getElementById("vault-type"),
  vaultEmpty: document.getElementById("vault-empty"),
  vaultList: document.getElementById("vault-list"),
  toast: document.getElementById("toast")
};

const state = {
  xApp: null,
  ott: null,
  theme: resolveTheme(),
  serviceClient: null,
  session: null,
  vaults: [],
  busy: false
};

class XVaultServiceClient {
  constructor(baseUrl, fetchImpl = globalThis.fetch) {
    if (typeof fetchImpl !== "function") {
      throw new Error("Browser fetch API is required to call XVault service.");
    }
    this.fetchImpl = fetchImpl;
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.jwt = null;
  }

  setBaseUrl(baseUrl) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  async connectXamanSession(ott, context = {}) {
    if (!ott || typeof ott !== "string") {
      throw new Error("Missing xApp OTT token from Xaman environment.");
    }
    const payload = await this.request("POST", "/session/xaman", {
      ott,
      xAppToken: ott,
      xAppStyle: context.xAppStyle,
      userAgent: context.userAgent
    });
    const data = unwrapData(payload);
    const jwt = data?.jwt || payload?.jwt;
    if (typeof jwt === "string" && jwt.length > 0) {
      this.jwt = jwt;
    }
    return data;
  }

  async listVaults() {
    const payload = await this.request("GET", "/vaults");
    const data = unwrapData(payload);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.vaults)) return data.vaults;
    if (Array.isArray(payload?.vaults)) return payload.vaults;
    return [];
  }

  async createVault(type) {
    return this.request("POST", "/vaults", { type });
  }

  async addEntry(vaultId, entry) {
    return this.request("POST", `/vaults/${encodeURIComponent(vaultId)}/entries`, entry);
  }

  async revokeVault(vaultId) {
    return this.request("POST", `/vaults/${encodeURIComponent(vaultId)}/revoke`, {});
  }

  async request(method, path, body) {
    if (!this.baseUrl) {
      throw new Error("Service URL is not configured.");
    }

    const headers = { "Content-Type": "application/json" };
    if (this.jwt) {
      headers.Authorization = `Bearer ${this.jwt}`;
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    const payload = await parseJson(response);
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || payload?.message || `${method} ${path} failed (${response.status}).`);
    }
    return payload;
  }
}

boot().catch((error) => {
  setSessionState(`Failed to initialize: ${error.message}`);
  showToast(error.message);
});

async function boot() {
  state.serviceClient = new XVaultServiceClient(resolveServiceBaseUrl());
  state.ott = resolveOttToken();

  ui.themeLabel.textContent = `Theme: ${state.theme.toUpperCase()}`;
  ui.serviceUrl.value = state.serviceClient.baseUrl || "";

  if (typeof window.xAppSdk === "function") {
    initializeXAppBridge();
  } else {
    ui.connectHint.textContent =
      "xApp SDK not detected. Open this client inside Xaman to auto-connect with OTT.";
  }

  ui.connectForm.addEventListener("submit", handleConnect);
  ui.createVaultForm.addEventListener("submit", handleCreateVault);

  updateGatedSections();
  renderSession();
  renderVaults();

  if (state.ott && state.serviceClient.baseUrl) {
    await connectToService();
  }
}

function initializeXAppBridge() {
  state.xApp = new window.xAppSdk();
  const environment = safeGetEnvironment();
  if (environment?.ott && !state.ott) {
    state.ott = environment.ott;
  }

  state.xApp.on("payload", (event) => {
    if (event?.reason === "SIGNED") {
      showToast("Transaction signed in Xaman. Refreshing vault data.");
      refreshVaults().catch((error) => showToast(error.message));
    }
    if (event?.reason === "DECLINED") {
      showToast("Sign request was declined.");
    }
  });

  state.xApp.on("networkswitch", (event) => {
    const network = event?.network || "Unknown";
    ui.sessionNetwork.textContent = network;
  });

  Promise.resolve(state.xApp.ready()).catch(() => {});

  const mode = state.ott ? "OTT detected from Xaman context." : "xApp SDK detected, waiting for OTT token.";
  ui.connectHint.textContent = `${mode} Connect to XVault service to start managing vaults.`;
}

async function handleConnect(event) {
  event.preventDefault();
  await connectToService();
}

async function connectToService() {
  const baseUrl = normalizeBaseUrl(ui.serviceUrl.value);
  if (!baseUrl) {
    showToast("Enter a valid XVault service URL.");
    return;
  }

  const ott = resolveOttToken();
  if (!ott) {
    showToast("No OTT token found. Launch this client as a Xaman xApp.");
    setSessionState("Missing OTT token");
    return;
  }

  state.serviceClient.setBaseUrl(baseUrl);
  state.ott = ott;

  await withButtonBusy(ui.connectButton, "Connecting...", async () => {
    setSessionState("Connecting");
    const session = await state.serviceClient.connectXamanSession(ott, {
      xAppStyle: state.theme,
      userAgent: navigator.userAgent
    });
    state.session = session;
    renderSession();
    updateGatedSections();
    setSessionState("Connected");
    showToast("Connected to XVault service.");
    await refreshVaults();
  });
}

async function handleCreateVault(event) {
  event.preventDefault();
  if (!state.session) {
    showToast("Connect to XVault service first.");
    return;
  }
  const type = String(ui.vaultType.value || "individual");
  if (type !== "individual" && type !== "team") {
    showToast("Invalid vault type.");
    return;
  }

  await withButtonBusy(ui.createVaultButton, "Creating...", async () => {
    const payload = await state.serviceClient.createVault(type);
    const data = unwrapData(payload);
    await maybeOpenSignRequest(data);
    showToast(`Vault created (${type}).`);
    await refreshVaults();
  });
}

async function refreshVaults() {
  if (!state.session) return;
  setSessionState("Loading vaults");
  state.vaults = normalizeVaults(await state.serviceClient.listVaults());
  renderVaults();
  setSessionState("Connected");
}

function renderSession() {
  const account = resolveSessionAccount();
  const network = resolveSessionNetwork();

  ui.sessionAccount.textContent = account ? shortenAccount(account) : "Not connected";
  ui.sessionNetwork.textContent = network || "Unknown";

  if (state.session) {
    ui.connectionPill.textContent = "Connected";
    ui.connectionPill.classList.remove("status-offline");
    ui.connectionPill.classList.add("status-online");
  } else {
    ui.connectionPill.textContent = "Disconnected";
    ui.connectionPill.classList.remove("status-online");
    ui.connectionPill.classList.add("status-offline");
  }
}

function renderVaults() {
  ui.vaultList.innerHTML = "";
  ui.vaultEmpty.style.display = state.vaults.length > 0 ? "none" : "block";

  for (const vault of state.vaults) {
    const item = document.createElement("li");
    item.className = "vault-item";

    const title = document.createElement("h3");
    title.textContent = vault.vaultId;
    item.appendChild(title);

    const meta = document.createElement("p");
    meta.className = "vault-meta";
    meta.textContent = buildVaultMeta(vault);
    item.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "vault-actions";

    const addForm = document.createElement("form");
    addForm.className = "stack";
    addForm.innerHTML = `
      <label>Service</label>
      <input name="service" required autocomplete="off" placeholder="github" />
      <label>Username</label>
      <input name="username" autocomplete="off" placeholder="alice" />
      <label>Password</label>
      <input name="password" type="password" autocomplete="new-password" placeholder="password" />
      <label>Notes</label>
      <textarea name="notes" placeholder="Optional notes"></textarea>
      <button type="submit">Add entry</button>
    `;

    addForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.session) {
        showToast("Connect to XVault service first.");
        return;
      }

      const submitButton = addForm.querySelector("button[type='submit']");
      await withButtonBusy(submitButton, "Adding...", async () => {
        const formData = new FormData(addForm);
        const entry = {
          service: String(formData.get("service") || "").trim(),
          username: String(formData.get("username") || "").trim() || undefined,
          password: String(formData.get("password") || "").trim() || undefined,
          notes: String(formData.get("notes") || "").trim() || undefined
        };

        if (!entry.service) {
          throw new Error("Service name is required.");
        }

        const payload = await state.serviceClient.addEntry(vault.vaultId, entry);
        await maybeOpenSignRequest(unwrapData(payload));
        addForm.reset();
        showToast(`Entry added to ${vault.vaultId}.`);
        await refreshVaults();
      });
    });

    const revokeButton = document.createElement("button");
    revokeButton.type = "button";
    revokeButton.className = "button-danger";
    revokeButton.textContent = "Revoke vault";
    revokeButton.addEventListener("click", async () => {
      if (!state.session) {
        showToast("Connect to XVault service first.");
        return;
      }
      const confirmed = window.confirm(
        `Revoke vault ${vault.vaultId}? This operation is intended to be permanent.`
      );
      if (!confirmed) return;

      await withButtonBusy(revokeButton, "Revoking...", async () => {
        const payload = await state.serviceClient.revokeVault(vault.vaultId);
        await maybeOpenSignRequest(unwrapData(payload));
        showToast(`Vault revoked: ${vault.vaultId}`);
        await refreshVaults();
      });
    });

    actions.appendChild(addForm);
    actions.appendChild(revokeButton);
    item.appendChild(actions);
    ui.vaultList.appendChild(item);
  }
}

function resolveTheme() {
  const raw = (params.get("xAppStyle") || "dark").toLowerCase();
  return VALID_XAPP_STYLES.has(raw) ? raw : "light";
}

function resolveServiceBaseUrl() {
  const fromQuery = params.get("serviceUrl") || params.get("service") || params.get("xVaultService");
  if (fromQuery) return normalizeBaseUrl(fromQuery);

  if (window.location.protocol === "http:" || window.location.protocol === "https:") {
    return normalizeBaseUrl(`${window.location.origin}/v1`);
  }
  return "";
}

function resolveOttToken() {
  const fromQuery =
    params.get("xAppToken") || params.get("xapptoken") || params.get("ott") || params.get("token");
  if (fromQuery) return fromQuery;

  const fromEnv = safeGetEnvironment()?.ott;
  if (fromEnv) return fromEnv;

  return null;
}

function safeGetEnvironment() {
  if (!state.xApp || typeof state.xApp.getEnvironment !== "function") {
    return null;
  }
  try {
    return state.xApp.getEnvironment();
  } catch {
    return null;
  }
}

function resolveSessionAccount() {
  return (
    state.session?.account ||
    state.session?.address ||
    state.session?.user?.account ||
    state.session?.user?.address ||
    ""
  );
}

function resolveSessionNetwork() {
  return state.session?.network || state.session?.networkId || state.session?.ledger || "";
}

function setSessionState(value) {
  ui.sessionState.textContent = value;
}

function updateGatedSections() {
  const disabled = state.session ? "false" : "true";
  document.querySelectorAll("[data-gated='true']").forEach((element) => {
    element.setAttribute("data-disabled", disabled);
  });
}

function showToast(message) {
  ui.toast.textContent = String(message || "");
  ui.toast.setAttribute("data-visible", "true");
  window.clearTimeout(showToast.timeoutHandle);
  showToast.timeoutHandle = window.setTimeout(() => {
    ui.toast.setAttribute("data-visible", "false");
  }, 4500);
}
showToast.timeoutHandle = null;

async function withButtonBusy(button, label, handler) {
  if (!button || state.busy) return;
  const previousText = button.textContent;
  const previousSessionState = ui.sessionState.textContent;
  state.busy = true;
  button.disabled = true;
  button.textContent = label;
  try {
    await handler();
  } catch (error) {
    setSessionState(previousSessionState);
    showToast(error.message || "Unexpected error.");
  } finally {
    button.disabled = false;
    button.textContent = previousText;
    state.busy = false;
  }
}

async function maybeOpenSignRequest(payload) {
  const uuid = payload?.signRequestUuid || payload?.payloadUuid || payload?.uuid;
  if (!uuid) return;
  if (!state.xApp || typeof state.xApp.openSignRequest !== "function") return;
  try {
    await Promise.resolve(state.xApp.openSignRequest({ uuid }));
  } catch (error) {
    showToast(`Created request ${uuid}, but failed to open it in Xaman: ${error.message}`);
  }
}

function unwrapData(payload) {
  if (payload && typeof payload === "object" && "data" in payload) {
    return payload.data;
  }
  return payload;
}

function normalizeVaults(vaults) {
  return vaults
    .map((vault) => ({
      vaultId: String(vault?.vaultId || vault?.id || "").trim(),
      type: vault?.type === "team" ? "team" : "individual",
      manifestTokenId: vault?.manifestTokenId || vault?.tokenId || "",
      entryCount: Number(vault?.entryCount || vault?.entriesCount || vault?.entries || 0),
      updatedAt: vault?.updatedAt || vault?.updated_at || ""
    }))
    .filter((vault) => vault.vaultId.length > 0);
}

function buildVaultMeta(vault) {
  const parts = [`Type: ${vault.type}`, `Entries: ${Number.isFinite(vault.entryCount) ? vault.entryCount : 0}`];
  if (vault.manifestTokenId) {
    parts.push(`Token: ${vault.manifestTokenId}`);
  }
  if (vault.updatedAt) {
    parts.push(`Updated: ${vault.updatedAt}`);
  }
  return parts.join(" | ");
}

function normalizeBaseUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  return normalized.replace(/\/+$/, "");
}

function shortenAccount(account) {
  if (typeof account !== "string" || account.length < 12) return account;
  return `${account.slice(0, 8)}...${account.slice(-6)}`;
}

async function parseJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}
