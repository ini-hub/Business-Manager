import { describe, it, expect } from "vitest";
import {
  normaliseCurrency, roundRate, validateRateInput, pickRate, convertAmount, MissingRateError, type RateRow,
} from "./exchange-rates";

const rows: RateRow[] = [
  { fromCurrency: "GHS", toCurrency: "NGN", rate: 100, effectiveFrom: "2026-01-01" },
  { fromCurrency: "GHS", toCurrency: "NGN", rate: 110, effectiveFrom: "2026-06-01" },
  { fromCurrency: "NGN", toCurrency: "GHS", rate: 0.01, effectiveFrom: "2026-01-01" },
];

describe("pickRate", () => {
  it("uses the latest rate on or before the date", () => {
    expect(pickRate(rows, "GHS", "NGN", "2026-05-31")?.rate).toBe(100);
    expect(pickRate(rows, "GHS", "NGN", "2026-06-01")?.rate).toBe(110);
    expect(pickRate(rows, "GHS", "NGN", "2026-12-31")?.rate).toBe(110);
  });
  it("returns null before the first rate, and for a pair that was never set", () => {
    expect(pickRate(rows, "GHS", "NGN", "2025-12-31")).toBeNull();
    expect(pickRate(rows, "USD", "NGN", "2026-06-01")).toBeNull();
  });
  it("never derives one direction from the other", () => {
    expect(pickRate([rows[0]], "NGN", "GHS", "2026-06-01")).toBeNull();
  });
  it("converts a currency into itself at 1", () => {
    expect(pickRate([], "NGN", "NGN", "2026-06-01")?.rate).toBe(1);
  });
  it("does not depend on row order", () => {
    expect(pickRate([...rows].reverse(), "GHS", "NGN", "2026-07-01")?.rate).toBe(110);
  });
});

describe("convertAmount", () => {
  it("rounds half away from zero to two places", () => {
    expect(convertAmount(10, 1.005)).toBe(10.05);
    expect(convertAmount(1, 0.125)).toBe(0.13);
    expect(convertAmount(-1, 0.125)).toBe(-0.13);
    expect(convertAmount(2500, 0.00066)).toBe(1.65);
  });
  it("is exact for whole results", () => {
    expect(convertAmount(250, 110)).toBe(27_500);
    expect(convertAmount(0, 110)).toBe(0);
  });
});

describe("validateRateInput", () => {
  const ok = { from: "ghs", to: "NGN", rate: 110, effectiveFrom: "2026-06-01" };
  it("accepts a well-formed rate", () => expect(validateRateInput(ok)).toBeNull());
  it("rejects bad input", () => {
    expect(validateRateInput({ ...ok, to: "GHS" })).toMatch(/different/);
    expect(validateRateInput({ ...ok, from: "NG" })).toMatch(/currencies/);
    expect(validateRateInput({ ...ok, rate: 0 })).toMatch(/greater than zero/);
    expect(validateRateInput({ ...ok, rate: -3 })).toMatch(/greater than zero/);
    expect(validateRateInput({ ...ok, rate: NaN })).toMatch(/greater than zero/);
    expect(validateRateInput({ ...ok, rate: "110" })).toMatch(/greater than zero/);
    expect(validateRateInput({ ...ok, rate: 1e-12 })).toMatch(/too small/);
    expect(validateRateInput({ ...ok, rate: 1e9 })).toMatch(/too large/);
    expect(validateRateInput({ ...ok, effectiveFrom: "2026-02-30" })).toMatch(/not valid/);
    expect(validateRateInput({ ...ok, effectiveFrom: "June" })).toMatch(/date/);
  });
});

describe("helpers", () => {
  it("normalises currency codes", () => {
    expect(normaliseCurrency(" ngn ")).toBe("NGN");
    expect(normaliseCurrency("NAIRA")).toBeNull();
    expect(normaliseCurrency(5)).toBeNull();
  });
  it("rounds rates to eight places", () => {
    expect(roundRate(1 / 1500)).toBe(0.00066667);
  });
  it("MissingRateError names the pair, the date and what to do", () => {
    const e = new MissingRateError("GHS", "NGN", "2026-06-30");
    expect(e.message).toContain("GHS to NGN");
    expect(e.message).toContain("2026-06-30");
    expect(e.message).toContain("Exchange rates");
  });
});
