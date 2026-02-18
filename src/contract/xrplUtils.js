import crypto from "node:crypto";
import {
  deriveAddress,
  isValidClassicAddress,
  multisign,
  verifyKeypairSignature,
  convertStringToHex
} from "xrpl";
import { fail } from "./errors.js";

export const URITOKEN_BURNABLE_FLAG = 0x00000001;
export const DEFAULT_URI_ISSUER = "rMsiGfHZDxtj9Y4SSn6Fp5f8n3pHZ3GXXQ";

export function validateClassicAddress(address) {
  if (typeof address !== "string" || address.length < 25 || address.length > 40) {
    fail("Invalid Xahau classic address.", "INVALID_ADDRESS");
  }
  if (!isValidClassicAddress(address)) {
    fail("Invalid Xahau classic address.", "INVALID_ADDRESS");
  }
}

export function validateHexSalt(salt) {
  if (
    typeof salt !== "string" ||
    salt.length < 16 ||
    salt.length > 256 ||
    !/^[0-9a-fA-F]+$/.test(salt) ||
    salt.length % 2 !== 0
  ) {
    fail("Salt must be an even-length hex string between 16 and 256 chars.", "INVALID_SALT");
  }
}

export function assertBase64(input, fieldName) {
  if (typeof input !== "string" || input.length === 0 || input.length > 1024 * 1024) {
    fail(`${fieldName} must be a non-empty base64 string within size limit.`, "INVALID_INPUT");
  }
  const roundTrip = Buffer.from(input, "base64").toString("base64");
  if (roundTrip.replace(/=+$/, "") !== input.replace(/=+$/, "")) {
    fail(`${fieldName} is not valid base64.`, "INVALID_INPUT");
  }
}

export function canonicalizeSignedPayload(payload) {
  return stableStringify(payload);
}

export function hashForSigning(payload) {
  return crypto.createHash("sha256").update(canonicalizeSignedPayload(payload)).digest("hex");
}

export function verifySignedPayload({
  payload,
  signature,
  signerPublicKey,
  expectedAddress
}) {
  if (!signature || !signerPublicKey) {
    fail("Missing signerPublicKey or signature.", "INVALID_SIGNATURE");
  }
  if (typeof signature !== "string" || signature.length < 16 || !/^[0-9A-Fa-f]+$/.test(signature)) {
    fail("Malformed signature format.", "INVALID_SIGNATURE");
  }
  if (
    typeof signerPublicKey !== "string" ||
    signerPublicKey.length < 16 ||
    signerPublicKey.length > 80 ||
    !/^[A-Za-z0-9]+$/.test(signerPublicKey)
  ) {
    fail("Malformed signerPublicKey format.", "INVALID_SIGNATURE");
  }
  const derived = deriveAddress(signerPublicKey);
  if (derived !== expectedAddress) {
    fail("Signer public key does not match expected Xahau address.", "INVALID_SIGNATURE");
  }
  const signingHash = hashForSigning(payload);
  const ok = verifyKeypairSignature(signingHash, signature, signerPublicKey);
  if (!ok) fail("Invalid Xahau signature.", "INVALID_SIGNATURE");
}

export function deriveSignerAddress(signerPublicKey) {
  if (
    typeof signerPublicKey !== "string" ||
    signerPublicKey.length < 16 ||
    signerPublicKey.length > 80 ||
    !/^[A-Za-z0-9]+$/.test(signerPublicKey)
  ) {
    fail("Malformed signerPublicKey format.", "INVALID_SIGNATURE");
  }
  return deriveAddress(signerPublicKey);
}

export function buildUriTokenMintTx({
  account = DEFAULT_URI_ISSUER,
  uri,
  owner = undefined,
  flags = URITOKEN_BURNABLE_FLAG
}) {
  if (!uri) fail("URI is required for URITokenMint.", "INVALID_INPUT");
  const tx = {
    TransactionType: "URITokenMint",
    Account: account,
    URI: convertStringToHex(uri),
    Flags: flags
  };
  if (owner) tx.Destination = owner;
  return tx;
}

export function buildUriTokenBurnTx({ account = DEFAULT_URI_ISSUER, uriTokenId }) {
  if (!uriTokenId) fail("uriTokenId is required for URITokenBurn.", "INVALID_INPUT");
  return {
    TransactionType: "URITokenBurn",
    Account: account,
    URITokenID: uriTokenId
  };
}

export async function mintUriToken({
  xrplClient,
  uri,
  owner,
  issuer = DEFAULT_URI_ISSUER,
  multisigSigners = [],
  devMode = false
}) {
  const tx = buildUriTokenMintTx({ account: issuer, uri, owner });

  if (!xrplClient || multisigSigners.length === 0) {
    const simulatedTokenId = crypto
      .createHash("sha256")
      .update(`${issuer}:${owner ?? ""}:${uri}`)
      .digest("hex")
      .slice(0, 64);
    return {
      tokenId: simulatedTokenId,
      mode: "simulated",
      tx
    };
  }

  try {
    const prepared = await xrplClient.autofill(tx);
    const signedParts = multisigSigners.map((wallet) => wallet.sign(prepared, true).tx_blob);
    const multiSignedBlob = multisign(signedParts);
    const submitResult = await xrplClient.submitAndWait(multiSignedBlob);

    return {
      tokenId: submitResult?.result?.meta?.uritoken_id ?? null,
      mode: "submitted",
      txHash: submitResult?.result?.hash ?? null,
      tx: prepared
    };
  } catch (error) {
    if (devMode) {
      const simulatedTokenId = crypto
        .createHash("sha256")
        .update(`${issuer}:${owner ?? ""}:${uri}:fallback`)
        .digest("hex")
        .slice(0, 64);
      return {
        tokenId: simulatedTokenId,
        mode: "simulated_fallback",
        tx
      };
    }
    fail(`XRPL submission failed: ${error.message}`, "XRPL_SUBMISSION_FAILED");
  }
}

export async function burnUriToken({
  xrplClient,
  uriTokenId,
  issuer = DEFAULT_URI_ISSUER,
  multisigSigners = [],
  devMode = false
}) {
  const tx = buildUriTokenBurnTx({ account: issuer, uriTokenId });

  if (!xrplClient || multisigSigners.length === 0) {
    return {
      burned: true,
      mode: "simulated",
      tx
    };
  }

  try {
    const prepared = await xrplClient.autofill(tx);
    const signedParts = multisigSigners.map((wallet) => wallet.sign(prepared, true).tx_blob);
    const multiSignedBlob = multisign(signedParts);
    const submitResult = await xrplClient.submitAndWait(multiSignedBlob);
    return {
      burned: true,
      mode: "submitted",
      txHash: submitResult?.result?.hash ?? null,
      tx: prepared
    };
  } catch (error) {
    if (devMode) {
      return {
        burned: true,
        mode: "simulated_fallback",
        tx
      };
    }
    fail(`XRPL burn failed: ${error.message}`, "XRPL_SUBMISSION_FAILED");
  }
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

