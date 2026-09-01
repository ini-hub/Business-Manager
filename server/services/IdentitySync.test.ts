import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../storage", () => ({
  storage: {
    updateUser: vi.fn(),
    getAllStaffByUserId: vi.fn(),
    updateStaff: vi.fn(),
  },
}));

import { syncStaffNameToLinkedUser, syncUserIdentityToLinkedStaff } from "./IdentitySync";
import { storage } from "../storage";

const S = storage as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("syncStaffNameToLinkedUser", () => {
  it("mirrors the staff name onto the linked user", async () => {
    await syncStaffNameToLinkedUser("staff-1", "user-1", "Folakemi");
    expect(S.updateUser).toHaveBeenCalledWith("user-1", { name: "Folakemi" });
  });

  it("does nothing when the staff row has no linked user", async () => {
    await syncStaffNameToLinkedUser("staff-1", null, "Folakemi");
    expect(S.updateUser).not.toHaveBeenCalled();
  });

  it("swallows a failed mirror write rather than throwing", async () => {
    S.updateUser.mockRejectedValue(new Error("db down"));
    await expect(syncStaffNameToLinkedUser("staff-1", "user-1", "Folakemi")).resolves.toBeUndefined();
  });
});

describe("syncUserIdentityToLinkedStaff", () => {
  it("mirrors name/email onto every staff row linked to the user", async () => {
    S.getAllStaffByUserId.mockResolvedValue([{ id: "staff-1" }, { id: "staff-2" }]);
    await syncUserIdentityToLinkedStaff("user-1", { name: "Folakemi", email: "folakemi@example.com" });
    expect(S.updateStaff).toHaveBeenCalledWith("staff-1", { name: "Folakemi", email: "folakemi@example.com" });
    expect(S.updateStaff).toHaveBeenCalledWith("staff-2", { name: "Folakemi", email: "folakemi@example.com" });
  });

  it("does nothing when neither field is provided", async () => {
    await syncUserIdentityToLinkedStaff("user-1", {});
    expect(S.getAllStaffByUserId).not.toHaveBeenCalled();
  });

  it("does nothing when the user has no linked staff rows", async () => {
    S.getAllStaffByUserId.mockResolvedValue([]);
    await syncUserIdentityToLinkedStaff("user-1", { name: "Folakemi" });
    expect(S.updateStaff).not.toHaveBeenCalled();
  });

  it("keeps mirroring to remaining rows when one row's write fails (e.g. a unique-email collision)", async () => {
    S.getAllStaffByUserId.mockResolvedValue([{ id: "staff-1" }, { id: "staff-2" }]);
    S.updateStaff.mockImplementation((id: string) => {
      if (id === "staff-1") return Promise.reject(new Error("staff_email_unique violation"));
      return Promise.resolve({});
    });
    await expect(syncUserIdentityToLinkedStaff("user-1", { email: "x@example.com" })).resolves.toBeUndefined();
    expect(S.updateStaff).toHaveBeenCalledWith("staff-1", { email: "x@example.com" });
    expect(S.updateStaff).toHaveBeenCalledWith("staff-2", { email: "x@example.com" });
  });

  it("swallows a failed staff lookup rather than throwing", async () => {
    S.getAllStaffByUserId.mockRejectedValue(new Error("db down"));
    await expect(syncUserIdentityToLinkedStaff("user-1", { name: "Folakemi" })).resolves.toBeUndefined();
    expect(S.updateStaff).not.toHaveBeenCalled();
  });
});
