import { describe, expect, test } from "@jest/globals";
import { VaultState } from "../../src/contract/state.js";

describe("VaultState schema and mutations", () => {
  test("creates individual vault with defaults", () => {
    const state = new VaultState();
    const vault = state.createVault({
      owner: "rOwner",
      salt: "aabbccddeeff0011",
      createdAt: "1",
      manifestTokenId: "manifest-1"
    });

    expect(vault.type).toBe("individual");
    expect(vault.authorized).toEqual(["rOwner"]);
    expect(vault.pendingInvites).toEqual([]);
  });

  test("creates team vault and tracks authorized members", () => {
    const state = new VaultState();
    const vault = state.createVault({
      owner: "rOwner",
      salt: "1122334455667788",
      type: "team",
      authorized: ["rAlice", "rOwner"],
      createdAt: "2",
      manifestTokenId: "manifest-2"
    });

    expect(vault.type).toBe("team");
    expect(vault.authorized).toEqual(expect.arrayContaining(["rOwner", "rAlice"]));
    expect(vault.authorized.length).toBe(2);
  });

  test("invite accept and remove member mutate team authorization", () => {
    const state = new VaultState();
    const vault = state.createVault({
      owner: "rOwner",
      salt: "ffeeddccbbaa0011",
      type: "team",
      createdAt: "10",
      manifestTokenId: "manifest-3"
    });

    state.addPendingInvite({
      vaultId: vault.id,
      invitedBy: "rOwner",
      address: "rInvitee",
      invitedAt: "11"
    });
    expect(vault.pendingInvites.length).toBe(1);

    state.acceptPendingInvite({ vaultId: vault.id, address: "rInvitee" });
    expect(vault.pendingInvites.length).toBe(0);
    expect(vault.authorized).toContain("rInvitee");

    state.removeAuthorizedMember({
      vaultId: vault.id,
      owner: "rOwner",
      memberToRemove: "rInvitee"
    });
    expect(vault.authorized).not.toContain("rInvitee");
  });
});
