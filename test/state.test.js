import { describe, expect, test } from "vitest";
import { VaultState, buildVaultId } from "../src/contract/state.js";

describe("VaultState", () => {
  test("creates individual vault and appends entry", () => {
    const state = new VaultState();
    const vault = state.createVault({
      owner: "rOwner",
      salt: "a1b2c3d4e5f60708",
      createdAt: "1001",
      metadata: { label: "personal" },
      manifestTokenId: "token-manifest-1"
    });

    expect(vault.id).toBe(buildVaultId("rOwner", "a1b2c3d4e5f60708"));

    const entry = state.addEntry({
      vaultId: vault.id,
      owner: "rOwner",
      cid: "bafkreicid",
      entryMetadata: { service: "github", username: "mike" },
      createdAt: "1002",
      tokenId: "token-entry-1"
    });

    expect(entry.tokenId).toBe("token-entry-1");
    expect(state.getMyVaults("rOwner")[0].entryCount).toBe(1);
  });

  test("produces deterministic digest for equal state", () => {
    const makeState = () => {
      const s = new VaultState();
      const vault = s.createVault({
        owner: "rOwner",
        salt: "1122334455667788",
        metadata: {},
        createdAt: "2001",
        manifestTokenId: "manifest-token"
      });
      s.addEntry({
        vaultId: vault.id,
        owner: "rOwner",
        cid: "bafkrei123",
        entryMetadata: { service: "mail" },
        createdAt: "2002",
        tokenId: "entry-token"
      });
      return s;
    };

    const a = makeState();
    const b = makeState();
    expect(a.digest()).toBe(b.digest());
  });
});
