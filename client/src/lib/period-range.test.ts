import { describe, it, expect } from "vitest";
import { overlapsRange, resolveRange, type PayPeriodRef } from "./period-range";

const today = new Date(2026, 9, 3); // 3 Oct 2026
const current: PayPeriodRef = { id: "c", startDate: "2026-09-28", endDate: "2026-10-04" };
const past: PayPeriodRef = { id: "p1", startDate: "2026-09-21", endDate: "2026-09-27" };

describe("resolveRange", () => {
  it("uses the open pay period for 'current'", () => {
    expect(resolveRange("current", {}, [], current, today)).toMatchObject({ from: "2026-09-28", to: "2026-10-04" });
  });

  it("falls back to the calendar month when no pay period is open", () => {
    expect(resolveRange("current", {}, [], null, today)).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("resolves a specific pay period by id", () => {
    expect(resolveRange("period:p1", {}, [past], current, today)).toMatchObject({ from: "2026-09-21", to: "2026-09-27" });
  });

  it("resolves calendar presets", () => {
    expect(resolveRange("last-month", {}, [], null, today)).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(resolveRange("3m", {}, [], null, today)).toMatchObject({ from: "2026-08-01", to: "2026-10-31" });
    expect(resolveRange("year", {}, [], null, today)).toMatchObject({ from: "2026-01-01", to: "2026-10-03" });
  });

  it("uses a valid custom range and ignores an inverted one", () => {
    expect(resolveRange("custom", { from: "2026-08-01", to: "2026-08-10" }, [], null, today)).toMatchObject({ from: "2026-08-01", to: "2026-08-10" });
    expect(resolveRange("custom", { from: "2026-08-10", to: "2026-08-01" }, [], null, today)).toMatchObject({ from: "2026-10-01" });
  });

  it("caps a custom range at a year", () => {
    const r = resolveRange("custom", { from: "2020-01-01", to: "2026-01-01" }, [], null, today);
    expect(r.from).toBe("2020-01-01");
    expect(r.to).toBe("2021-01-01");
  });
});

describe("overlapsRange", () => {
  it("includes periods that straddle either edge", () => {
    const range = { from: "2026-09-25", to: "2026-09-30" };
    expect(overlapsRange(past, range)).toBe(true);
    expect(overlapsRange(current, range)).toBe(true);
    expect(overlapsRange({ startDate: "2026-09-01", endDate: "2026-09-10" }, range)).toBe(false);
  });
});
