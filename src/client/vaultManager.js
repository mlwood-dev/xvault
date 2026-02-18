import crypto from "node:crypto";
import keypairs from "ripple-keypairs";

/**
 * Revoke (burn) a vault as owner through contract operation.
 *
 * @param {string} vaultId
 * @param {import("xrpl").Client} xrplClient - kept for integration parity/logging.
 * @param {import("xrpl").Wallet} wallet
 * @param {{
 *   submitContractRequest: (op: {type: string, payload: object}) => Promise<any>,
 *   clearVaultCache?: (vaultId: string) => Promise<void> | void
 * }} options
 * @returns {Promise<{success: boolean, burnedTokens: number}>}
 */
export async function revokeVault(vaultId, xrplClient, wallet, options) {
  if (typeof vaultId !== "string" || vaultId.length < 8) {
    throw createClientError("INVALID_INPUT", "vaultId is required.");
  }
  if (!wallet?.classicAddress || !wallet?.privateKey || !wallet?.publicKey) {
    throw createClientError("INVALID_INPUT", "wallet with classicAddress/publicKey/privateKey is required.");
  }
  if (!options?.submitContractRequest || typeof options.submitContractRequest !== "function") {
    throw createClientError("INVALID_INPUT", "submitContractRequest function is required.");
  }

  const summariesResp = await options.submitContractRequest({
    type: "getMyVaults",
    payload: { owner: wallet.classicAddress }
  });
  if (!summariesResp?.ok) {
    throw createClientError("CONTRACT_ERROR", summariesResp?.error ?? "Failed to load vault summaries.");
  }
  const summaries = summariesResp.data ?? [];
  const summary = summaries.find((item) => item.vaultId === vaultId);
  if (!summary) {
    throw createClientError("VAULT_NOT_FOUND", "Vault not found in owner summaries.");
  }

  const confirm = summary.type === "team";
  const signPayload = {
    vaultId,
    confirm,
    action: "revokeVault"
  };

  const signature = signCanonicalPayload(signPayload, wallet.privateKey);
  const revokeResp = await options.submitContractRequest({
    type: "revokeVault",
    payload: {
      vaultId,
      confirm,
      signerPublicKey: wallet.publicKey,
      signature
    }
  });
  if (!revokeResp?.ok) {
    throw createClientError(revokeResp?.code ?? "CONTRACT_ERROR", revokeResp?.error ?? "Vault revocation failed.");
  }

  if (options.clearVaultCache) {
    await options.clearVaultCache(vaultId);
  }

  // CLIENT RESPONSIBILITY: revocation does not remove IPFS content automatically.
  // Unpin associated CIDs via QuickNode API/dashboard to reduce storage costs.
  console.info("Vault revoked; associated IPFS blobs remain pinned until garbage-collected or manually unpinned.");
  if (xrplClient && typeof xrplClient.isConnected === "function") {
    console.info(`XRPL client connected: ${xrplClient.isConnected()}`);
  }

  return {
    success: true,
    burnedTokens: revokeResp.data?.burnedTokens ?? 0
  };
}

/**
 * Build a WebSocket submission helper around a connected contract client.
 *
 * @param {{send: (message: string) => void, once: (event: string, cb: (data: any) => void) => void}} ws
 * @returns {(op: {type: string, payload: object}) => Promise<any>}
 */
export function createWsSubmitter(ws) {
  if (!ws?.send || !ws?.once) {
    throw createClientError("INVALID_INPUT", "ws with send() and once() is required.");
  }
  return function submitContractRequest(op) {
    return new Promise((resolve, reject) => {
      ws.once("message", (raw) => {
        try {
          const parsed = typeof raw === "string" ? JSON.parse(raw) : JSON.parse(String(raw));
          resolve(parsed);
        } catch (error) {
          reject(createClientError("INVALID_RESPONSE", `Failed to parse WS response: ${error.message}`));
        }
      });
      ws.send(JSON.stringify(op));
    });
  };
}

function signCanonicalPayload(payload, privateKey) {
  const digest = hashForSigning(payload);
  return keypairs.sign(digest, privateKey);
}

function hashForSigning(payload) {
  return crypto.createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function createClientError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

