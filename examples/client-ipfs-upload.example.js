import { createIpfsClient } from "../src/ipfs/quicknodeIpfs.js";
import { deriveRootKey, prepareEntryPayload } from "../src/crypto/vaultCrypto.js";

/**
 * Example: encrypt -> upload (QuickNode) -> submit addEntry.
 * This snippet is intentionally client-only and does not perform contract I/O.
 */
export async function runIpfsUploadFlowExample() {
  const rootKey = await deriveRootKey("user-password", "aabbccddeeff00112233445566778899");

  const prepared = await prepareEntryPayload(
    "team",
    {
      service: "notion",
      username: "alice",
      notes: "prod workspace",
      secret: "sensitive entry body"
    },
    rootKey,
    [
      {
        address: "rExampleMemberClassicAddress1",
        pubKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
      }
    ]
  );

  const ipfs = createIpfsClient({
    apiKey: process.env.QUICKNODE_IPFS_API_KEY,
    apiBase: process.env.QUICKNODE_IPFS_API_BASE,
    gateway: process.env.QUICKNODE_GATEWAY
  });

  const upload = await ipfs.uploadBlob(prepared.encryptedBlob, {
    filename: "xvault-entry.json",
    contentType: "application/json"
  });

  const addEntryPayload = {
    ...prepared,
    cid: upload.cid
  };

  const gatewayUrl = ipfs.getGatewayUrl(upload.cid);
  console.log("Submit this to contract addEntry:", addEntryPayload);
  console.log("Encrypted blob fetch URL:", gatewayUrl);

  rootKey.fill(0);
}
