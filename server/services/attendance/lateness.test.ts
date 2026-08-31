import { describe, it, expect } from "vitest";
import { evaluateLateness } from "./lateness";

const lagos = (iso: string) => new Date(iso);

describe("evaluateLateness", () => {
  it("resolves the boundary second by second", () => {
    const at = (t: string) => evaluateLateness({
      effectiveAt: lagos(`2026-08-31T${t}Z`),
      timezone: "UTC",
      openingTime: "09:00",
      graceMinutes: 0,
    });
    expect(at("08:59:59").isLate).toBe(false);
    expect(at("09:00:00").isLate).toBe(false);
    expect(at("09:00:59").isLate).toBe(false); // still within the opening minute
    expect(at("09:01:00").isLate).toBe(true);
  });

  it("honours the grace period", () => {
    const verdict = evaluateLateness({
      effectiveAt: lagos("2026-08-31T09:10:00Z"),
      timezone: "UTC",
      openingTime: "09:00",
      graceMinutes: 15,
    });
    expect(verdict.isLate).toBe(false);

    const late = evaluateLateness({
      effectiveAt: lagos("2026-08-31T09:20:00Z"),
      timezone: "UTC",
      openingTime: "09:00",
      graceMinutes: 15,
    });
    expect(late.isLate).toBe(true);
    // Counted from the opening time, not the end of grace — that is what staff count.
    expect(late.lateMinutes).toBe(20);
  });

  it("measures against the store's clock, not the server's", () => {
    // 08:30 UTC is 09:30 in Lagos: on time in London, half an hour late in Lagos.
    const instant = lagos("2026-08-31T08:30:00Z");
    expect(evaluateLateness({ effectiveAt: instant, timezone: "UTC", openingTime: "09:00", graceMinutes: 0 }).isLate).toBe(false);

    const inLagos = evaluateLateness({ effectiveAt: instant, timezone: "Africa/Lagos", openingTime: "09:00", graceMinutes: 0 });
    expect(inLagos.isLate).toBe(true);
    expect(inLagos.lateMinutes).toBe(30);
  });

  it("attributes a punch to the store-local day", () => {
    // 23:40 UTC is already tomorrow in Lagos.
    const verdict = evaluateLateness({
      effectiveAt: lagos("2026-08-30T23:40:00Z"),
      timezone: "Africa/Lagos",
      openingTime: "09:00",
      graceMinutes: 0,
    });
    expect(verdict.localDate).toBe("2026-08-31");
  });

  it("handles a timezone that crosses a DST boundary", () => {
    // 2026-03-08 is spring-forward in New York; 09:30 local is 13:30 UTC (EDT).
    const verdict = evaluateLateness({
      effectiveAt: lagos("2026-03-08T13:30:00Z"),
      timezone: "America/New_York",
      openingTime: "09:00",
      graceMinutes: 0,
    });
    expect(verdict.localDate).toBe("2026-03-08");
    expect(verdict.isLate).toBe(true);
    expect(verdict.lateMinutes).toBe(30);
  });

  it("treats nobody as late when the opening time is missing or malformed", () => {
    // Failing open is deliberate: a bad setting must not charge the whole salon.
    for (const openingTime of [null, undefined, "", "9am", "25:00"]) {
      const verdict = evaluateLateness({
        effectiveAt: lagos("2026-08-31T18:00:00Z"),
        timezone: "UTC",
        openingTime,
        graceMinutes: 0,
      });
      expect(verdict.isLate).toBe(false);
      expect(verdict.expectedMinuteOfDay).toBeNull();
    }
  });

  it("ignores a negative or unusable grace value", () => {
    const verdict = evaluateLateness({
      effectiveAt: lagos("2026-08-31T09:05:00Z"),
      timezone: "UTC",
      openingTime: "09:00",
      graceMinutes: -30,
    });
    expect(verdict.isLate).toBe(true);
    expect(verdict.lateMinutes).toBe(5);
  });
});
