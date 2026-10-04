import { describe, it, expect } from "vitest";
import {
  EMPTY_CREDIT_FILTERS,
  buildCreditFilterChips,
  clearCreditFilterChip,
  countActiveCreditFilters,
  creditMatchesFilters,
  creditMatchesSearch,
  sortCredits,
} from "./credit-filters";

const now = new Date("2026-10-01T00:00:00Z");
const e = (customerName: string, outstandingBalance: number, dueDate: string | null, status = "owing") =>
  ({ customerName, outstandingBalance, dueDate, status, customerMobile: "0801", receiptNumber: "R1", description: "rice" });
const rows = [
  e("Ada", 5000, "2026-09-20T00:00:00Z", "overdue"),
  e("Bola", 20000, "2026-10-04T00:00:00Z"),
  e("Chi", 800, "2026-12-01T00:00:00Z"),
  e("Dayo", 300, null),
];
const names = (f: Parameters<typeof creditMatchesFilters>[1]) => rows.filter((r) => creditMatchesFilters(r, f, now)).map((r) => r.customerName);

describe("credit filters", () => {
  it("matches all when empty", () => expect(names(EMPTY_CREDIT_FILTERS)).toHaveLength(4));
  it("filters by due bucket", () => {
    expect(names({ ...EMPTY_CREDIT_FILTERS, due: "overdue" })).toEqual(["Ada"]);
    expect(names({ ...EMPTY_CREDIT_FILTERS, due: "week" })).toEqual(["Bola"]);
    expect(names({ ...EMPTY_CREDIT_FILTERS, due: "later" })).toEqual(["Chi"]);
    expect(names({ ...EMPTY_CREDIT_FILTERS, due: "none" })).toEqual(["Dayo"]);
  });
  it("filters by balance range and customer", () => {
    expect(names({ ...EMPTY_CREDIT_FILTERS, balanceMin: 1000, balanceMax: 10000 })).toEqual(["Ada"]);
    expect(names({ ...EMPTY_CREDIT_FILTERS, customers: ["Chi", "Dayo"] })).toEqual(["Chi", "Dayo"]);
  });
  it("filters by stage, with open covering owing, partial and overdue", () => {
    const mixed = [e("A", 1, null, "owing"), e("B", 1, null, "partial"), e("C", 1, null, "overdue"), e("D", 0, null, "settled"), e("E", 1, null, "written_off")];
    const n = (stage: "open" | "settled" | "written_off") => mixed.filter((r) => creditMatchesFilters(r, { ...EMPTY_CREDIT_FILTERS, stage }, now)).length;
    expect([n("open"), n("settled"), n("written_off")]).toEqual([3, 1, 1]);
  });
  it("searches", () => {
    expect(rows.filter((r) => creditMatchesSearch(r, "bol")).length).toBe(1);
    expect(rows.filter((r) => creditMatchesSearch(r, "RICE")).length).toBe(4);
  });
  it("counts, builds and clears chips", () => {
    const f = { ...EMPTY_CREDIT_FILTERS, due: "overdue" as const, balanceMin: 1000 };
    expect(countActiveCreditFilters(f)).toBe(2);
    expect(buildCreditFilterChips(f, "₦").map((c) => c.label)).toEqual(["Overdue", "Balance ₦1,000 or more"]);
    expect(clearCreditFilterChip(f, "balance").balanceMin).toBeNull();
  });
  it("sorts, due-less entries last", () => {
    expect(sortCredits(rows, { key: "dueSoonest" }).map((r) => r.customerName)).toEqual(["Ada", "Bola", "Chi", "Dayo"]);
    expect(sortCredits(rows, { key: "balanceHigh" })[0].customerName).toBe("Bola");
    expect(sortCredits(rows, { key: "balanceLow" })[0].customerName).toBe("Dayo");
  });
});
