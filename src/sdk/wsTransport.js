const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Lightweight request/response transport for HotPocket-style WS contracts.
 * Requests are serialized to keep response ordering deterministic.
 *
 * @param {{
 *   url: string,
 *   timeoutMs?: number,
 *   wsFactory?: (url: string) => any
 * }} config
 * @returns {{
 *   submit: (operation: {type: string, payload: object}) => Promise<any>,
 *   close: () => Promise<void>
 * }}
 */
export function createHotPocketTransport(config) {
  if (!config || typeof config !== "object") {
    throw createTransportError("INVALID_INPUT", "config is required.");
  }
  if (typeof config.url !== "string" || config.url.trim().length === 0) {
    throw createTransportError("INVALID_INPUT", "config.url is required.");
  }

  const timeoutMs = Number.isInteger(config.timeoutMs) ? config.timeoutMs : DEFAULT_TIMEOUT_MS;
  const wsFactory = config.wsFactory ?? defaultWsFactory;

  let ws = null;
  let queue = Promise.resolve();

  async function submit(operation) {
    if (!operation || typeof operation !== "object") {
      throw createTransportError("INVALID_INPUT", "operation must be an object.");
    }
    if (typeof operation.type !== "string" || operation.type.trim().length === 0) {
      throw createTransportError("INVALID_INPUT", "operation.type is required.");
    }

    queue = queue.then(() => submitSingle(operation));
    return queue;
  }

  async function submitSingle(operation) {
    const socket = await getOrConnectSocket();
    return waitForOneResponse(socket, operation, timeoutMs);
  }

  async function getOrConnectSocket() {
    if (ws && isSocketOpen(ws)) return ws;
    ws = wsFactory(config.url);
    await waitForOpen(ws, timeoutMs);
    return ws;
  }

  async function close() {
    if (!ws) return;
    await closeSocket(ws);
    ws = null;
  }

  return { submit, close };
}

function defaultWsFactory(url) {
  if (typeof globalThis.WebSocket !== "function") {
    throw createTransportError("WS_UNAVAILABLE", "No WebSocket implementation found. Provide wsFactory.");
  }
  return new globalThis.WebSocket(url);
}

function waitForOpen(ws, timeoutMs) {
  if (isSocketOpen(ws)) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(createTransportError("WS_TIMEOUT", "WebSocket open timed out."));
    }, timeoutMs);

    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(createTransportError("WS_CONNECT_ERROR", error?.message ?? "WebSocket connection failed."));
    };

    function cleanup() {
      clearTimeout(timeout);
      detach(ws, "open", onOpen);
      detach(ws, "error", onError);
    }

    attach(ws, "open", onOpen);
    attach(ws, "error", onError);
  });
}

function waitForOneResponse(ws, operation, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(createTransportError("WS_TIMEOUT", `Timed out waiting for response to ${operation.type}.`));
    }, timeoutMs);

    const onMessage = (eventOrRaw) => {
      cleanup();
      try {
        const raw = extractRawPayload(eventOrRaw);
        const parsed = typeof raw === "string" ? JSON.parse(raw) : JSON.parse(String(raw));
        resolve(parsed);
      } catch (error) {
        reject(createTransportError("INVALID_RESPONSE", `Failed to parse WS response: ${error.message}`));
      }
    };

    const onError = (error) => {
      cleanup();
      reject(createTransportError("WS_ERROR", error?.message ?? "WebSocket request failed."));
    };

    function cleanup() {
      clearTimeout(timeout);
      detach(ws, "message", onMessage);
      detach(ws, "error", onError);
    }

    attach(ws, "message", onMessage);
    attach(ws, "error", onError);
    ws.send(JSON.stringify(operation));
  });
}

function closeSocket(ws) {
  return new Promise((resolve) => {
    if (!ws) return resolve();
    if (typeof ws.close === "function") ws.close();
    if (typeof ws.once === "function") {
      ws.once("close", () => resolve());
      return;
    }
    if (typeof ws.addEventListener === "function") {
      const onClose = () => {
        ws.removeEventListener("close", onClose);
        resolve();
      };
      ws.addEventListener("close", onClose);
      return;
    }
    resolve();
  });
}

function extractRawPayload(eventOrRaw) {
  if (eventOrRaw && typeof eventOrRaw === "object" && "data" in eventOrRaw) {
    return eventOrRaw.data;
  }
  return eventOrRaw;
}

function isSocketOpen(ws) {
  const openState = typeof ws.OPEN === "number" ? ws.OPEN : 1;
  return ws.readyState === openState;
}

function attach(ws, event, handler) {
  if (typeof ws.addEventListener === "function") {
    ws.addEventListener(event, handler);
    return;
  }
  if (typeof ws.on === "function") {
    ws.on(event, handler);
    return;
  }
  throw createTransportError("WS_UNSUPPORTED", "WebSocket implementation lacks addEventListener/on.");
}

function detach(ws, event, handler) {
  if (typeof ws.removeEventListener === "function") {
    ws.removeEventListener(event, handler);
    return;
  }
  if (typeof ws.off === "function") {
    ws.off(event, handler);
    return;
  }
  if (typeof ws.removeListener === "function") {
    ws.removeListener(event, handler);
  }
}

function createTransportError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

