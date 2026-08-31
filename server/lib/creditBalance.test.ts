import { describe, it, expect } from "vitest";
import { reconstructBalance, canRestoreWriteOff } from "./creditBalance";

/**
 * Undoing a write-off rests entirely on these two functions: one says what the
 * debt was worth, the other says whether reinstating it is still safe.
 */

describe("reconstructBalance", () => {
  it("returns the full debt when nothing was ever paid", () => {
    expect(reconstructBalance({ amountOwed: 8_500, amountPaidUpfront: 0 }, 0))
      .toEqual({ balance: 8_500, status: "owing" });
  });

  it("nets off repayments and reports the debt as part-paid", () => {
    expect(reconstructBalance({ amountOwed: 8_500, amountPaidUpfront: 0 }, 5_000))
      .toEqual({ balance: 3_500, status: "partial" });
  });

  it("treats an upfront payment as part-payment even with no repayments", () => {
    expect(reconstructBalance({ amountOwed: 8_500, amountPaidUpfront: 1_000 }, 0))
      .toEqual({ balance: 7_500, status: "partial" });
  });

  it("settles a debt that was fully repaid", () => {
    expect(reconstructBalance({ amountOwed: 8_500, amountPaidUpfront: 500 }, 8_000))
      .toEqual({ balance: 0, status: "settled" });
  });

  // Over-repayment must not resurrect a debt as a negative balance.
  it("never returns a negative balance", () => {
    expect(reconstructBalance({ amountOwed: 1_000, amountPaidUpfront: 0 }, 1_500))
      .toEqual({ balance: 0, status: "settled" });
  });

  it("keeps arithmetic on the numeric(12,2) grid", () => {
    expect(reconstructBalance({ amountOwed: 1_000.10, amountPaidUpfront: 0 }, 333.33).balance)
      .toBe(666.77);
  });
});

describe("canRestoreWriteOff", () => {
  const tz = "Africa/Lagos";
  const now = new Date("2026-08-30T10:00:00Z");
  const thisMonth = new Date("2026-08-02T09:00:00Z");
  const lastMonth = new Date("2026-07-28T09:00:00Z");

  it("allows an in-month write-off with no payroll link", () => {
    expect(canRestoreWriteOff({ status: "written_off", updatedAt: thisMonth }, { now, timezone: tz }))
      .toEqual({ allowed: true });
  });

  it("allows an in-month write-off whose payroll period is still open", () => {
    const r = canRestoreWriteOff(
      { status: "written_off", updatedAt: thisMonth },
      { now, timezone: tz, linkedPeriodStatus: "approved" },
    );
    expect(r.allowed).toBe(true);
  });

  // The whole reason for the window: bad debt is dated by updatedAt, so this
  // restore would remove an expense from a month already reported on.
  it("refuses a write-off from an earlier month", () => {
    const r = canRestoreWriteOff({ status: "written_off", updatedAt: lastMonth }, { now, timezone: tz });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/earlier month/);
  });

  it("refuses once the payroll period that waived it has been paid", () => {
    const r = canRestoreWriteOff(
      { status: "written_off", updatedAt: thisMonth },
      { now, timezone: tz, linkedPeriodStatus: "paid" },
    );
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/paid and locked/);
  });

  it("refuses an entry that is not written off at all", () => {
    const r = canRestoreWriteOff({ status: "owing", updatedAt: thisMonth }, { now, timezone: tz });
    expect(r.allowed).toBe(false);
  });

  // Month boundaries are store-local: 31 Aug 23:30 UTC is already 1 Sep in Lagos.
  it("judges the month in the store's timezone, not UTC", () => {
    const r = canRestoreWriteOff(
      { status: "written_off", updatedAt: new Date("2026-08-31T23:30:00Z") },
      { now: new Date("2026-09-01T08:00:00Z"), timezone: tz },
    );
    expect(r.allowed).toBe(true);
  });
});
