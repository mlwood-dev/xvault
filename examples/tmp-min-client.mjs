import keypairs from "ripple-keypairs";
import { Wallet } from "xrpl";
import { hashForSigning } from "./src/contract/xrplUtils.js";

const WS_URL = process.env.HOTPOCKET_WS_URL ?? "ws://127.0.0.1:8081";
const wallet = Wallet.generate();

function signPayload(payload) {
  const digest = hashForSigning(payload);
  return keypairs.sign(digest, wallet.privateKey);
}

async function submit(op) {
  const ws = new WebSocket(WS_URL);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  const response = await new Promise((resolve, reject) => {
    ws.addEventListener(
      "message",
      (evt) => {
        try {
          resolve(JSON.parse(typeof evt.data === "string" ? evt.data : String(evt.data)));
        } catch (e) {
          reject(e);
        }
      },
      { once: true }
    );
    ws.send(JSON.stringify(op));
  });

  ws.close();
  return response;
}

const createPayload = {
  type: "individual",
  owner: wallet.classicAddress,
  salt: "aabbccddeeff0011",
  metadata: {}
};

const created = await submit({
  type: "createVault",
  payload: {
    ...createPayload,
    signerPublicKey: wallet.publicKey,
    signature: signPayload(createPayload)
  }
});
console.log("createVault =>", created);

if (!created.ok) process.exit(1);
const vaultId = created.data.vaultId;

const list = await submit({
  type: "getMyVaults",
  payload: { owner: wallet.classicAddress }
});
console.log("getMyVaults =>", list);

const revokeSigPayload = { vaultId, confirm: false, action: "revokeVault" };
const revoked = await submit({
  type: "revokeVault",
  payload: {
    vaultId,
    confirm: false,
    signerPublicKey: wallet.publicKey,
    signature: signPayload(revokeSigPayload)
  }
});
console.log("revokeVault =>", revoked);