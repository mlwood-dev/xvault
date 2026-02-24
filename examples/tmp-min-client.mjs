import keypairs from "ripple-keypairs";
import { Wallet } from "xahau";
import HotPocket from "hotpocket-js-client";
import { hashForSigning } from "../src/contract/xrplUtils.js";

const WS_URL = process.env.HOTPOCKET_WS_URL ?? "wss://127.0.0.1:8090";
const wallet = Wallet.generate();
const CONNECT_TIMEOUT_MS = 12000;
const RESPONSE_TIMEOUT_MS = 15000;
const isLocalTlsTarget = WS_URL.startsWith("wss://127.0.0.1") || WS_URL.startsWith("wss://localhost");
const DEFAULT_TLS_ALLOW =
  process.env.HOTPOCKET_ALLOW_SELF_SIGNED === "true" ||
  (process.env.HOTPOCKET_ALLOW_SELF_SIGNED !== "false" && isLocalTlsTarget);

function log(stage, details = {}) {
  const ts = new Date().toISOString();
  console.log(`[tmp-min-client][${ts}][${stage}]`, details);
}

function withTimeout(promise, timeoutMs, timeoutLabel) {
  let timer = null;
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${timeoutLabel} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    })
  ]);
}

function signPayload(payload) {
  const digest = hashForSigning(payload);
  return keypairs.sign(digest, wallet.privateKey);
}

function parseContractResponse(raw) {
  if (raw && typeof raw === "object" && !Buffer.isBuffer(raw)) return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return { ok: false, code: "INVALID_RESPONSE", error: `Non-JSON response: ${raw}` };
    }
  }
  if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
    const text = Buffer.from(raw).toString("utf8");
    try {
      return JSON.parse(text);
    } catch {
      return { ok: false, code: "INVALID_RESPONSE", error: `Non-JSON buffer response: ${text}` };
    }
  }
  return { ok: false, code: "INVALID_RESPONSE", error: `Unsupported response type: ${typeof raw}` };
}

function createOutputWaiter(client, opType) {
  return withTimeout(
    new Promise((resolve) => {
      const handler = (result) => {
        client.clear(HotPocket.events.contractOutput);
        const outputs = Array.isArray(result?.outputs) ? result.outputs : [];
        const first = outputs[0];
        log("hp:contractOutput", {
          opType,
          ledgerSeqNo: result?.ledgerSeqNo,
          outputCount: outputs.length
        });
        resolve(parseContractResponse(first));
      };
      client.on(HotPocket.events.contractOutput, handler);
    }),
    RESPONSE_TIMEOUT_MS,
    `HotPocket contract output for ${opType}`
  );
}

async function submit(client, op) {
  log("submit:start", { opType: op?.type, wsUrl: WS_URL });
  const outputPromise = createOutputWaiter(client, op.type);
  const input = await client.submitContractInput(JSON.stringify(op));
  log("hp:inputSubmitted", { opType: op?.type, hash: input?.hash ?? null });
  const submission = await withTimeout(input.submissionStatus, RESPONSE_TIMEOUT_MS, `Input submission for ${op.type}`);
  log("hp:submissionStatus", { opType: op?.type, submission });
  if (!submission || submission.status !== "accepted") {
    throw new Error(`Input ${op.type} not accepted: ${JSON.stringify(submission)}`);
  }
  let response;
  try {
    response = await outputPromise;
  } catch (error) {
    throw new Error(
      `Input ${op.type} was accepted at ledger ${submission.ledgerSeqNo}, but no contract output was received. ` +
        `This usually means the deployed contract is not emitting responses for user inputs. ` +
        `Original error: ${error.message}`
    );
  }
  log("submit:done", { opType: op?.type, ok: response?.ok, code: response?.code ?? null });
  return response;
}

const createPayload = {
  type: "individual",
  owner: wallet.classicAddress,
  salt: "aabbccddeeff0011",
  metadata: {}
};

process.on("unhandledRejection", (reason) => {
  log("process:unhandledRejection", {
    reason: reason instanceof Error ? reason.stack : String(reason)
  });
});

process.on("uncaughtException", (error) => {
  log("process:uncaughtException", { error: error?.stack ?? String(error) });
});

async function main() {
  log("main:start", {
    wsUrl: WS_URL,
    wallet: wallet.classicAddress,
    tlsAllowSelfSigned: DEFAULT_TLS_ALLOW
  });
  HotPocket.setLogLevel(1);
  if (DEFAULT_TLS_ALLOW) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  const hpKeys = await HotPocket.generateKeys();
  const client = await HotPocket.createClient([WS_URL], hpKeys, {
    protocol: HotPocket.protocols.json,
    requiredConnectionCount: 1,
    connectionTimeoutMs: CONNECT_TIMEOUT_MS
  });
  client.on(HotPocket.events.connectionChange, (server, action) => {
    log("hp:connectionChange", { server, action });
  });
  client.on(HotPocket.events.disconnect, () => {
    log("hp:disconnect", {});
  });

  const connected = await client.connect();
  if (!connected) {
    throw new Error("HotPocket connection failed. Check HOTPOCKET_WS_URL and TLS settings.");
  }
  log("hp:connected", { wsUrl: WS_URL });

  const createOp = {
    type: "createVault",
    payload: {
      ...createPayload,
      signerPublicKey: wallet.publicKey,
      signature: signPayload(createPayload)
    }
  };
  const created = await submit(client, createOp);
  console.log("createVault =>", created);

  if (!created.ok) {
    log("main:abort", { reason: "createVault failed", responseCode: created.code ?? null });
    await client.close();
    process.exit(1);
  }

  const vaultId = created.data.vaultId;
  const list = await submit(client, {
    type: "getMyVaults",
    payload: { owner: wallet.classicAddress }
  });
  console.log("getMyVaults =>", list);

  const revokeSigPayload = { vaultId, confirm: false, action: "revokeVault" };
  const revoked = await submit(client, {
    type: "revokeVault",
    payload: {
      vaultId,
      confirm: false,
      signerPublicKey: wallet.publicKey,
      signature: signPayload(revokeSigPayload)
    }
  });
  console.log("revokeVault =>", revoked);
  await client.close();
  log("main:done", { vaultId });
}

await main();