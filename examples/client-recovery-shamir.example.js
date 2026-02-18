import { deriveRootKey, encryptEntry } from "../src/crypto/vaultCrypto.js";
import {
  combineShares,
  deriveRecoveryRoot,
  generateRecoveryShares,
  prepareRecoveryMetadata
} from "../src/recovery/shamirRecovery.js";

/**
 * Example: Shamir recovery skeleton flow.
 *
 * 1) User enables recovery at vault creation time.
 * 2) Client generates recovery secret and 3 shares with threshold 2.
 * 3) Client stores only non-sensitive recovery metadata in manifest blob.
 * 4) Later recovery: collect any 2 shares, reconstruct secret, derive recovery root.
 * 5) Use recovery root with vault salt to decrypt entries.
 *
 * FUTURE: UI can render shares as QR/copy strings; distribution remains user-managed.
 */
export async function runShamirRecoveryExample() {
  const vaultSaltHex = "aabbccddeeff00112233445566778899";
  const recoverySecret = crypto.getRandomValues(new Uint8Array(32));

  const shares = await generateRecoveryShares(recoverySecret, 3, 2);
  const recoveryMetadata = prepareRecoveryMetadata({
    total: 3,
    threshold: 2,
    shareHashes: [] // optional: hash shares client-side before storing metadata
  });

  console.log("Distribute shares securely:", shares);
  console.log("Attach metadata to manifest blob:", recoveryMetadata);

  // Recovery time: user provides threshold number of shares.
  const recoveredSecret = await combineShares([shares[0].share, shares[1].share]);
  if (!(recoveredSecret instanceof Uint8Array)) {
    throw new Error("Expected binary recovery secret.");
  }
  const recoveryRoot = await deriveRecoveryRoot(recoveredSecret, vaultSaltHex);

  // Optional compatibility check against current deriveRootKey flow:
  // If app policy maps recovery root to vault root derivation, this can be used
  // in place of master-password derived root for decrypting entry payloads.
  const baselineRoot = await deriveRootKey("user-master-password", vaultSaltHex);
  console.log("Recovery root derived length:", recoveryRoot.length);
  console.log("Baseline root derived length:", baselineRoot.length);

  const encrypted = await encryptEntry(
    { service: "example", secret: "recoverable-entry" },
    recoveryRoot
  );
  console.log("Encrypted with recovery root:", encrypted);

  recoverySecret.fill(0);
  recoveredSecret.fill(0);
  recoveryRoot.fill(0);
  baselineRoot.fill(0);
}
