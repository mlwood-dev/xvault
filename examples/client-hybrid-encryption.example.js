import { Client } from "xrpl";
import { deriveRootKey, prepareEntryPayload } from "../src/crypto/vaultCrypto.js";
import { getPublicKeyFromAddress } from "../src/crypto/xrplPubkey.js";

/**
 * Example: team-vault add entry flow (client-side only crypto).
 *
 * 1) Derive root key from user password + vault salt.
 * 2) Fetch each authorized member public key from Xahau.
 * 3) prepareEntryPayload() encrypts entry with a per-entry key and wraps that key
 *    for every authorized public key (wrappedKeys[]).
 * 4) Upload encryptedBlob to QuickNode IPFS REST.
 * 5) Submit contract addEntry request with cid + wrappedKeys metadata.
 *
 * CLIENT RESPONSIBILITY:
 * - On member add/remove/revoke: re-encrypt affected entries and regenerate wrappedKeys.
 * - Contract never decrypts or rewrites encrypted content.
 */
export async function runTeamFlowExample() {
  const client = new Client("wss://xahau-testnet.example");
  await client.connect();

  const vaultSaltHex = "aabbccddeeff00112233445566778899";
  const masterPassword = "user-supplied-password";
  const rootKey = await deriveRootKey(masterPassword, vaultSaltHex);

  const authorizedAddresses = [
    "rExampleMemberClassicAddress1",
    "rExampleMemberClassicAddress2"
  ];

  const authorizedPubKeys = [];
  for (const address of authorizedAddresses) {
    const pubKey = await getPublicKeyFromAddress(address, client);
    if (!pubKey) continue;
    authorizedPubKeys.push({ address, pubKey });
  }

  const entryData = {
    service: "internal-admin",
    username: "alice",
    notes: "MFA required",
    secret: "never leaves client plaintext"
  };

  const prepared = await prepareEntryPayload("team", entryData, rootKey, authorizedPubKeys);

  // Upload prepared.encryptedBlob to QuickNode IPFS:
  // POST https://api.quicknode.com/ipfs/rest/pinning/upload-object
  // header: x-api-key: <QUICKNODE_IPFS_API_KEY>
  // body: file/blob containing prepared.encryptedBlob
  // Assume upload result -> cid
  const cid = "bafybeigdyrztf4f6xsl54n4xq4m5gxezm5q4za2ojx6x7lf5y3w4f4xhqy";

  const addEntryPayload = {
    vaultId: "team-vault-id",
    actor: "rExampleMemberClassicAddress1",
    encryptedBlob: prepared.encryptedBlob,
    entryMetadata: prepared.entryMetadata,
    cid,
    wrappedKeys: prepared.wrappedKeys
  };

  console.log("Submit to contract addEntry:", addEntryPayload);

  rootKey.fill(0);
  await client.disconnect();
}
