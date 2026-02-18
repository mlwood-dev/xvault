/**
 * Client-side flow example (encryption/upload/decryption only happens client-side):
 *
 * 1) Encrypt credential payload locally (Argon2id + AES-256-GCM).
 * 2) Upload encrypted blob to QuickNode IPFS REST:
 *      POST https://api.quicknode.com/ipfs/rest/pinning/upload-object
 *      Header: x-api-key: <QUICKNODE_IPFS_API_KEY>
 *    Receive { cid } from response.
 * 3) Submit signed addEntry request to XVault contract with:
 *      { vaultId, owner, encryptedBlob, cid, entryMetadata, signerPublicKey, signature }
 * 4) Later, fetch retrieval metadata via signed getEntry request:
 *      { vaultId, owner, entryIndex|tokenId, signerPublicKey, signature }
 *    Receive { cid, metadata, gatewayUrl } from contract.
 * 5) Optional listing call for dashboards:
 *      { type: "getMyVaults", payload: { owner, since? } }
 *    Receive non-sensitive vault summaries sorted by newest.
 * 6) Fetch encrypted blob from gateway URL:
 *      GET ${QUICKNODE_GATEWAY}/ipfs/${cid}
 * 7) Decrypt blob locally on client using the user passphrase/material.
 *
 * Error shape from contract:
 * - Success: { ok: true, operation, data }
 * - Failure: { ok: false, error, code, errorId }
 *
 * Contract constraints:
 * - Contract never uploads to IPFS.
 * - Contract never decrypts.
 * - Contract handles CID references + URI Token minting + ownership authorization only.
 */

export {};

