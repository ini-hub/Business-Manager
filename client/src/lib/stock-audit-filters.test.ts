import { describe, it, expect } from "vitest";
import {
  EMPTY_AUDIT_FILTERS,
  auditMatchesFilters,
  auditMatchesSearch,
  buildAuditFilterChips,
  clearAuditFilterChip,
  countActiveAuditFilters,
  sortAudits,
} from "./stock-audit-filters";

const now = new Date("2026-10-10T00:00:00Z");
const audits = [
  { id: "aaaa1111-x", status: "draft", createdAt: "2026-10-08T00:00:00Z", notes: "Back shelf", conductorName: "Ada" },
  { id: "bbbb2222-x", status: "approved", createdAt: "2026-09-01T00:00:00Z", notes: null, conductorName: "Bayo" },
  { id: "cccc3333-x", status: "approved", createdAt: "2026-06-01T00:00:00Z", notes: "Quarterly", conductorName: "Ada" },
];
const ids = (f: Parameters<typeof auditMatchesFilters>[1]) =>
  audits.filter((a) => auditMatchesFilters(a, f, now)).map((a) => a.id.slice(0, 4));

describe("stock audit filters", () => {
  it("empty filters match all", () => {
    expect(ids(EMPTY_AUDIT_FILTERS)).toEqual(["aaaa", "bbbb", "cccc"]);
  });
  it("filters by status, conductor and date", () => {
    expect(ids({ ...EMPTY_AUDIT_FILTERS, status: "draft" })).toEqual(["aaaa"]);
    expect(ids({ ...EMPTY_AUDIT_FILTERS, conductedBy: ["Ada"] })).toEqual(["aaaa", "cccc"]);
    expect(ids({ ...EMPTY_AUDIT_FILTERS, date: "30d" })).toEqual(["aaaa"]);
    expect(ids({ ...EMPTY_AUDIT_FILTERS, date: "90d" })).toEqual(["aaaa", "bbbb"]);
  });
  it("searches id, conductor and notes", () => {
    expect(audits.filter((a) => auditMatchesSearch(a, "bbbb")).length).toBe(1);
    expect(audits.filter((a) => auditMatchesSearch(a, "ada")).length).toBe(2);
    expect(audits.filter((a) => auditMatchesSearch(a, "quarter")).length).toBe(1);
    expect(audits.filter((a) => auditMatchesSearch(a, "  ")).length).toBe(3);
  });
  it("counts, builds and clears chips", () => {
    const f = { ...EMPTY_AUDIT_FILTERS, status: "draft" as const, conductedBy: ["Ada"] };
    expect(countActiveAuditFilters(f)).toBe(2);
    expect(buildAuditFilterChips(f).map((c) => c.key)).toEqual(["status", "conductedBy"]);
    expect(clearAuditFilterChip(f, "conductedBy").conductedBy).toEqual([]);
  });
  it("sorts", () => {
    expect(sortAudits(audits, null)).toBe(audits);
    expect(sortAudits(audits, { key: "oldest" }).map((a) => a.id.slice(0, 4))).toEqual(["cccc", "bbbb", "aaaa"]);
    expect(sortAudits(audits, { key: "pending" })[0].id.slice(0, 4)).toBe("aaaa");
  });
});
