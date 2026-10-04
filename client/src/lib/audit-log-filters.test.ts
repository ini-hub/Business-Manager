import { describe, it, expect } from "vitest";
import {
  EMPTY_AUDIT_LOG_FILTERS as EMPTY,
  auditMatchesFilters,
  auditMatchesSearch,
  auditKind,
  countActiveAuditLogFilters,
  buildAuditLogFilterChips,
  clearAuditLogFilterChip,
  sortAuditLogs,
} from "./audit-log-filters";

const l = (action: string, o: Record<string, unknown> = {}) =>
  ({ action, resource: "expense", status: "success", userName: "Ada", timestamp: "2026-10-01T10:00:00Z", ...o });
const rows = [
  l("EXPENSE_CREATE"),
  l("CHECKOUT", { resource: "checkout", userName: null, userEmail: "bayo@x.com", timestamp: "2026-10-03T10:00:00Z" }),
  l("LOGIN", { resource: "auth", status: "failed", timestamp: "2026-10-02T10:00:00Z" }),
];
const actions = (f: typeof EMPTY) => rows.filter((r) => auditMatchesFilters(r, f)).map((r) => r.action);

describe("audit log filters", () => {
  it("filters by group, resource, user and status", () => {
    expect(actions({ ...EMPTY, groups: ["Expenses"] })).toEqual(["EXPENSE_CREATE"]);
    expect(actions({ ...EMPTY, resources: ["auth"] })).toEqual(["LOGIN"]);
    expect(actions({ ...EMPTY, users: ["bayo@x.com"] })).toEqual(["CHECKOUT"]);
    expect(actions({ ...EMPTY, status: "failed" })).toEqual(["LOGIN"]);
    expect(actions({ ...EMPTY, status: "success" })).toEqual(["EXPENSE_CREATE", "CHECKOUT"]);
  });
  it("searches", () => {
    expect(rows.filter((r) => auditMatchesSearch(r, "BAYO")).length).toBe(1);
  });
  it("classifies actions", () => {
    expect(auditKind("VENDOR_DELETE")).toBe("removed");
    expect(auditKind("EXPENSE_CREATE")).toBe("created");
    expect(auditKind("SETTINGS_UPDATE")).toBe("changed");
    expect(auditKind("LOGIN")).toBe("other");
  });
  it("counts, builds and clears chips including date", () => {
    const f = { ...EMPTY, status: "failed" as const, dateFrom: "2026-10-01", dateTo: "2026-10-01" };
    expect(countActiveAuditLogFilters(f)).toBe(2);
    expect(buildAuditLogFilterChips(f).map((c) => c.key)).toEqual(["status", "dateRange"]);
    expect(clearAuditLogFilterChip(f, "dateRange").dateFrom).toBeNull();
  });
  it("sorts", () => {
    expect(sortAuditLogs(rows, { key: "newest" })[0].action).toBe("CHECKOUT");
    expect(sortAuditLogs(rows, { key: "oldest" })[0].action).toBe("EXPENSE_CREATE");
    expect(sortAuditLogs(rows, { key: "action" })[0].action).toBe("CHECKOUT");
  });
});
