import { describe, it, expect } from "vitest";
import { businessCurrency, findCurrencyConflict, type StoreCurrencyRow } from "./storeCurrency";

const s = (id: string, currency: string, isMain = false, isActive = true): StoreCurrencyRow => ({ id, currency, isMain, isActive });

describe("findCurrencyConflict", () => {
  it("allows any currency for the first store", () => {
    expect(findCurrencyConflict([], "GHS")).toBeNull();
  });
  it("allows a store that matches the existing currency", () => {
    expect(findCurrencyConflict([s("a", "NGN", true)], "NGN")).toBeNull();
  });
  it("reports the existing currency on a mismatch", () => {
    expect(findCurrencyConflict([s("a", "NGN", true)], "GHS")).toBe("NGN");
  });
  it("ignores archived stores", () => {
    expect(findCurrencyConflict([s("a", "NGN", true, false)], "GHS")).toBeNull();
  });
  it("excludes the store being edited", () => {
    expect(findCurrencyConflict([s("a", "NGN", true)], "GHS", "a")).toBeNull();
  });
  it("lets a mixed business converge on a currency another store uses", () => {
    const stores = [s("a", "NGN", true), s("b", "GHS"), s("c", "USD")];
    expect(findCurrencyConflict(stores, "NGN", "c")).toBeNull();
    expect(findCurrencyConflict(stores, "KES", "c")).toBe("NGN");
  });
});

describe("businessCurrency", () => {
  it("prefers the main store", () => {
    expect(businessCurrency([s("a", "GHS"), s("b", "NGN", true)])).toBe("NGN");
  });
});
