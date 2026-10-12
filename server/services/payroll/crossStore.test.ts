import { describe, it, expect } from "vitest";
import { MissingRateError } from "@shared/exchange-rates";
import { mergeAttendance, buildConverter, payrollStoreIds, conversionNote } from "./crossStore";

const rec = (storeId: string, staffId: string, date: string, status: string) => ({ storeId, staffId, date, status });

describe("mergeAttendance", () => {
  it("counts present at any store as present", () => {
    const m = mergeAttendance([rec("A", "x", "2026-06-01", "absent"), rec("B", "x", "2026-06-01", "present")], "A");
    expect(m.get("x|2026-06-01")?.status).toBe("present");
  });
  it("prefers leave over holiday over off day over absent", () => {
    const pick = (a: string, b: string) =>
      mergeAttendance([rec("A", "x", "d", a), rec("B", "x", "d", b)], "A").get("x|d")?.status;
    expect(pick("absent", "off_day")).toBe("off_day");
    expect(pick("off_day", "holiday")).toBe("holiday");
    expect(pick("holiday", "leave")).toBe("leave");
  });
  it("does not depend on record order, and keeps the home store's record on a tie", () => {
    const a = rec("A", "x", "d", "present");
    const b = rec("B", "x", "d", "present");
    expect(mergeAttendance([a, b], "A").get("x|d")?.storeId).toBe("A");
    expect(mergeAttendance([b, a], "A").get("x|d")?.storeId).toBe("A");
  });
  it("keeps people and days separate", () => {
    const m = mergeAttendance([rec("A", "x", "d1", "present"), rec("B", "y", "d1", "absent"), rec("B", "x", "d2", "off_day")], "A");
    expect(m.size).toBe(3);
  });
});

describe("buildConverter", () => {
  const stores = new Map([["A", "NGN"], ["B", "GHS"]]);
  const rates = [
    { fromCurrency: "GHS", toCurrency: "NGN", rate: 100, effectiveFrom: "2026-01-01" },
    { fromCurrency: "GHS", toCurrency: "NGN", rate: 110, effectiveFrom: "2026-06-01" },
  ];

  it("leaves same-currency amounts untouched and records nothing", () => {
    const c = buildConverter({ payrollCurrency: "NGN", storeCurrency: stores, rates });
    expect(c.convert("A", "2026-06-10", 5_000)).toBe(5_000);
    expect(c.used()).toEqual([]);
  });

  it("converts at the rate in force on the sale date", () => {
    const c = buildConverter({ payrollCurrency: "NGN", storeCurrency: stores, rates });
    expect(c.convert("B", "2026-05-31", 10)).toBe(1_000);
    expect(c.convert("B", "2026-06-01", 10)).toBe(1_100);
    expect(c.used().map((n) => n.rate)).toEqual([100, 110]);
  });

  it("stops with MissingRateError rather than guessing", () => {
    const c = buildConverter({ payrollCurrency: "NGN", storeCurrency: stores, rates: [] });
    expect(() => c.convert("B", "2026-06-10", 10)).toThrow(MissingRateError);
  });

  it("reports whether any store is in another currency", () => {
    expect(buildConverter({ payrollCurrency: "NGN", storeCurrency: stores, rates }).crossCurrency).toBe(true);
    expect(buildConverter({ payrollCurrency: "NGN", storeCurrency: new Map([["A", "NGN"]]), rates }).crossCurrency).toBe(false);
  });
});

describe("helpers", () => {
  it("scopes payroll to the home store plus assigned stores, once each", () => {
    expect(payrollStoreIds("A", ["B", "A", "B", "C"])).toEqual(["A", "B", "C"]);
  });
  it("writes a plain-language conversion note", () => {
    expect(conversionNote([])).toBeNull();
    expect(conversionNote([{ from: "GHS", to: "NGN", rate: 110, effectiveFrom: "2026-06-01" }]))
      .toBe("Sales at stores in another currency were converted to NGN: 1 GHS = 110 NGN (rate from 2026-06-01).");
  });
});
