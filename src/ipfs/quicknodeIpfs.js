import crypto from "node:crypto";

const DEFAULT_API_BASE = "https://api.quicknode.com/ipfs/rest";
const CID_V0_REGEX = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
const CID_V1_BASE32_REGEX = /^b[a-z2-7]{20,}$/;
const CID_V1_BASE36_REGEX = /^k[0-9a-z]{20,}$/;
const BASE64_LIKE_REGEX = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Create QuickNode IPFS REST client.
 *
 * SECURITY: The API key grants pinning rights. Treat as secret and never log it.
 *
 * @param {{
 *   apiKey?: string,
 *   apiBase?: string,
 *   gateway?: string,
 *   fetchImpl?: typeof fetch
 * }} [config]
 * @returns {{
 *   uploadBlob: (data: Buffer | Blob | string, options?: { filename?: string, contentType?: string }) => Promise<{ cid: string, size?: number }>,
 *   unpinCid: (cid: string) => Promise<boolean>,
 *   getGatewayUrl: (cid: string, gatewayBase?: string) => string
 * }}
 */
export function createIpfsClient(config = {}) {
  const apiKey = config.apiKey ?? process.env.QUICKNODE_IPFS_API_KEY;
  const apiBase = trimTrailingSlash(config.apiBase ?? process.env.QUICKNODE_IPFS_API_BASE ?? DEFAULT_API_BASE);
  const gateway = trimTrailingSlash(config.gateway ?? process.env.QUICKNODE_GATEWAY ?? "");
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;

  if (!fetchImpl) {
    throw createIpfsError("FETCH_UNAVAILABLE", "No fetch implementation available in this runtime.");
  }
  if (!apiKey) {
    throw createIpfsError("MISSING_API_KEY", "QUICKNODE_IPFS_API_KEY is required.");
  }

  /**
   * Upload encrypted blob/object to QuickNode IPFS pinning.
   *
   * @param {Buffer | Blob | string} data
   * @param {{ filename?: string, contentType?: string }} [options]
   * @returns {Promise<{ cid: string, size?: number }>}
   */
  async function uploadBlob(data, options = {}) {
    const filename = options.filename ?? `${safeUuid()}.json`;
    const contentType = options.contentType ?? "application/octet-stream";
    const bodyBlob = normalizeToBlob(data, contentType);

    const form = new FormData();
    form.append("Body", bodyBlob, filename);
    form.append("Key", filename);
    form.append("ContentType", contentType);

    const response = await fetchImpl(`${apiBase}/v1/s3/put-object`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey
      },
      body: form
    });

    const parsed = await parseResponseBody(response);
    if (!response.ok) {
      throw mapHttpError(response.status, parsed);
    }

    const cid = extractCid(parsed, response.headers);
    assertValidCid(cid);

    const size = extractSize(parsed, bodyBlob.size);
    return { cid, size };
  }

  /**
   * Unpin a CID from QuickNode pinning service.
   * Returns false if endpoint/method is unsupported in current deployment.
   *
   * @param {string} cid
   * @returns {Promise<boolean>}
   */
  async function unpinCid(cid) {
    assertValidCid(cid);
    const response = await fetchImpl(`${apiBase}/pinning/pinned-objects/${cid}`, {
      method: "DELETE",
      headers: {
        "x-api-key": apiKey
      }
    });

    if (response.status === 404 || response.status === 405 || response.status === 501) {
      console.warn("QuickNode unpin endpoint unavailable or CID not present.");
      return false;
    }

    const parsed = await parseResponseBody(response);
    if (!response.ok) {
      throw mapHttpError(response.status, parsed);
    }
    return true;
  }

  /**
   * Build gateway URL for CID retrieval.
   *
   * @param {string} cid
   * @param {string} [gatewayBase]
   * @returns {string}
   */
  function getGatewayUrl(cid, gatewayBase = gateway) {
    assertValidCid(cid);
    if (!gatewayBase) {
      throw createIpfsError("MISSING_GATEWAY", "No gateway base configured.");
    }
    return `${trimTrailingSlash(gatewayBase)}/ipfs/${cid}`;
  }

  return {
    uploadBlob,
    unpinCid,
    getGatewayUrl
  };
}

function normalizeToBlob(data, contentType) {
  if (data instanceof Blob) return data;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
    return new Blob([data], { type: contentType });
  }
  if (data instanceof Uint8Array) {
    return new Blob([data], { type: contentType });
  }
  if (typeof data === "string") {
    const decoded = decodePossibleBase64String(data);
    return new Blob([decoded], { type: contentType });
  }
  throw createIpfsError("INVALID_INPUT", "uploadBlob data must be Buffer, Blob, Uint8Array, or string.");
}

function decodePossibleBase64String(value) {
  const trimmed = value.trim();
  if (isLikelyBase64(trimmed)) {
    try {
      return Buffer.from(trimmed, "base64");
    } catch {
      return Buffer.from(value, "utf8");
    }
  }
  return Buffer.from(value, "utf8");
}

function isLikelyBase64(value) {
  return value.length > 0 && value.length % 4 === 0 && BASE64_LIKE_REGEX.test(value);
}

function trimTrailingSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function safeUuid() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createIpfsError(code, message, meta = {}) {
  const error = new Error(message);
  error.code = code;
  error.meta = meta;
  return error;
}

async function parseResponseBody(response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  try {
    const text = await response.text();
    return text ? { message: text } : null;
  } catch {
    return null;
  }
}

function mapHttpError(status, parsedBody) {
  const message = parsedBody?.message ?? parsedBody?.error ?? `QuickNode IPFS request failed with status ${status}.`;
  if (status === 401 || status === 403) {
    return createIpfsError("AUTH_ERROR", message, { status });
  }
  if (status === 429) {
    return createIpfsError("RATE_LIMIT", message, { status });
  }
  if (status >= 500) {
    return createIpfsError("SERVER_ERROR", message, { status });
  }
  return createIpfsError("IPFS_REQUEST_FAILED", message, { status });
}

function extractCid(parsedBody, headers) {
  const candidates = [
    parsedBody?.cid,
    parsedBody?.Cid,
    parsedBody?.data?.cid,
    parsedBody?.data?.Cid,
    parsedBody?.pin?.cid,
    parsedBody?.result?.cid,
    parseCidFromUri(parsedBody?.uri),
    parseCidFromUri(parsedBody?.gatewayUrl),
    headers.get("x-ipfs-cid")
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (isLikelyCid(candidate)) return candidate;
  }
  throw createIpfsError("CID_MISSING", "QuickNode response did not include a valid CID.");
}

function parseCidFromUri(value) {
  if (!value || typeof value !== "string") return null;
  const match = value.match(/\/ipfs\/([^/?#]+)/);
  return match?.[1] ?? null;
}

function extractSize(parsedBody, fallbackSize) {
  const value = parsedBody?.size ?? parsedBody?.Size ?? parsedBody?.data?.size ?? fallbackSize;
  return typeof value === "number" ? value : undefined;
}

function assertValidCid(cid) {
  if (!isLikelyCid(cid)) {
    throw createIpfsError("INVALID_CID", "Invalid CID format.");
  }
}

function isLikelyCid(cid) {
  if (typeof cid !== "string") return false;
  return CID_V0_REGEX.test(cid) || CID_V1_BASE32_REGEX.test(cid) || CID_V1_BASE36_REGEX.test(cid);
}

