import { describe, it, expect } from "vitest";
import { quoteConversionError } from "./quoteConversion";

const NOW = new Date("2026-10-09T12:00:00Z");
const q = (over: Partial<{ storeId: string; status: string; validUntil: Date | null }> = {}) =>
  ({ storeId: "s1", status: "accepted", validUntil: null, ...over });

describe("quoteConversionError", () => {
  it("allows an accepted, in-date quote", () => {
    expect(quoteConversionError(q(), "s1", "sale", NOW)).toBeNull();
    expect(quoteConversionError(q({ validUntil: new Date("2026-10-10") }), "s1", "booking", NOW)).toBeNull();
  });

  it("rejects a missing quote or one from another store", () => {
    expect(quoteConversionError(undefined, "s1", "sale", NOW)).toMatch(/Invalid quote/);
    expect(quoteConversionError(q({ storeId: "other" }), "s1", "sale", NOW)).toMatch(/Invalid quote/);
  });

  it("rejects converted, declined and not-yet-accepted quotes", () => {
    expect(quoteConversionError(q({ status: "converted" }), "s1", "sale", NOW)).toMatch(/already been converted to a sale/);
    expect(quoteConversionError(q({ status: "converted" }), "s1", "booking", NOW)).toMatch(/to a booking/);
    expect(quoteConversionError(q({ status: "declined" }), "s1", "sale", NOW)).toMatch(/declined/);
    expect(quoteConversionError(q({ status: "draft" }), "s1", "sale", NOW)).toMatch(/accepted/);
    expect(quoteConversionError(q({ status: "sent" }), "s1", "sale", NOW)).toMatch(/accepted/);
  });

  it("rejects an expired quote", () => {
    expect(quoteConversionError(q({ validUntil: new Date("2026-10-01") }), "s1", "sale", NOW)).toMatch(/expired/);
  });
});
