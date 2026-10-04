import { describe, it, expect } from "vitest";
import {
  EMPTY_STAFF_FILTERS,
  accountStatusOf,
  buildStaffFilterChips,
  clearStaffFilterChip,
  countActiveStaffFilters,
  sortStaff,
  staffMatchesFilters,
} from "./staff-filters";

const rows = [
  { name: "Bola", role: "manager", storeName: "Lekki", inviteStatus: "active", contractStatus: "signed", createdAt: "2026-01-01" },
  { name: "Ada", role: "staff", storeName: "Ikeja", inviteStatus: "pending", contractStatus: "pending", createdAt: "2026-03-01" },
  { name: "Chi", role: "staff", storeName: "Lekki", inviteStatus: undefined, contractStatus: "pending", createdAt: "2026-02-01" },
];

describe("staff filters", () => {
  it("empty filters match everything", () => {
    expect(rows.every((r) => staffMatchesFilters(r, EMPTY_STAFF_FILTERS))).toBe(true);
    expect(countActiveStaffFilters(EMPTY_STAFF_FILTERS)).toBe(0);
  });

  it("collapses invite states", () => {
    expect(accountStatusOf({ inviteStatus: "active" })).toBe("active");
    expect(accountStatusOf({ inviteStatus: "partial" })).toBe("invited");
    expect(accountStatusOf({})).toBe("not-invited");
  });

  it("combines role, branch, account and contract with AND", () => {
    const f = { ...EMPTY_STAFF_FILTERS, roles: ["staff"], branches: ["Lekki"], contract: "pending" as const };
    expect(rows.filter((r) => staffMatchesFilters(r, f)).map((r) => r.name)).toEqual(["Chi"]);
    expect(countActiveStaffFilters(f)).toBe(3);
  });

  it("builds and clears chips", () => {
    const f = { ...EMPTY_STAFF_FILTERS, roles: ["manager"], account: "invited" as const };
    expect(buildStaffFilterChips(f).map((c) => c.label)).toEqual(["Manager", "Invite pending"]);
    expect(clearStaffFilterChip(f, "roles").roles).toEqual([]);
  });

  it("sorts by name, role and newest", () => {
    expect(sortStaff(rows, { key: "name", direction: "asc" }).map((r) => r.name)).toEqual(["Ada", "Bola", "Chi"]);
    expect(sortStaff(rows, { key: "role", direction: "asc" }).map((r) => r.name)).toEqual(["Bola", "Ada", "Chi"]);
    expect(sortStaff(rows, { key: "dateAdded", direction: "desc" }).map((r) => r.name)).toEqual(["Ada", "Chi", "Bola"]);
    expect(sortStaff(rows, null)).toBe(rows);
  });
});
