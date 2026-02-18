import { fail } from "./errors.js";

const CIDV0_REGEX = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
const CIDV1_BASE32_REGEX = /^b[a-z2-7]{20,}$/;
const CIDV1_BASE36_REGEX = /^k[0-9a-z]{20,}$/;

export function isLikelyIpfsCid(cid) {
  if (typeof cid !== "string") return false;
  const trimmed = cid.trim();
  if (trimmed.length < 10 || trimmed.length > 120) return false;
  return CIDV0_REGEX.test(trimmed) || CIDV1_BASE32_REGEX.test(trimmed) || CIDV1_BASE36_REGEX.test(trimmed);
}

export function assertValidCid(cid) {
  if (!isLikelyIpfsCid(cid)) {
    fail("Invalid IPFS CID format.", "INVALID_CID");
  }
}

export function buildGatewayFetchUrl(gatewayBaseUrl, cid) {
  return `${gatewayBaseUrl}/ipfs/${cid}`;
}

