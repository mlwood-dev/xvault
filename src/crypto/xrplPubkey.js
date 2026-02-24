import { isValidClassicAddress } from "xahau";

/**
 * Resolve a Xahau/XRPL account public key from ledger account_info.
 * Returns null if account exists but has no signing pubkey set.
 *
 * @param {string} address
 * @param {import("xahau").Client} xrplClient
 * @returns {Promise<string|null>}
 */
export async function getPublicKeyFromAddress(address, xrplClient) {
  if (!isValidClassicAddress(address)) {
    const error = new Error("Invalid classic address.");
    error.code = "INVALID_ADDRESS";
    throw error;
  }
  if (!xrplClient || typeof xrplClient.request !== "function") {
    const error = new Error("Client with request() is required.");
    error.code = "INVALID_CLIENT";
    throw error;
  }

  const response = await xrplClient.request({
    command: "account_info",
    account: address,
    ledger_index: "validated"
  });

  const pubKey = response?.result?.account_data?.SigningPubKey ?? null;
  if (!pubKey || /^0+$/.test(pubKey)) return null;
  return pubKey;
}

