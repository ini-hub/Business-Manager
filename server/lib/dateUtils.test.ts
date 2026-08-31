import { describe, it, expect } from "vitest";
import {
  dayOfWeekForLocalDate,
  parseTimeOfDay,
  storeLocalDate,
  storeLocalMinutesOfDay,
} from "./dateUtils";

describe("dayOfWeekForLocalDate", () => {
  it("reads the date string as a bare calendar date, not a server-local instant", () => {
    // 2026-08-30 is a Sunday. Parsed in a zone west of UTC, `new Date(s + "T00:00:00")`
    // would land on the Saturday and shift every roster by a day.
    expect(dayOfWeekForLocalDate("2026-08-30")).toBe(0);
    expect(dayOfWeekForLocalDate("2026-08-31")).toBe(1);
    expect(dayOfWeekForLocalDate("2026-09-05")).toBe(6);
  });

  it("is stable regardless of the process timezone", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Honolulu"; // UTC-10
      const honolulu = dayOfWeekForLocalDate("2026-08-30");
      process.env.TZ = "Pacific/Kiritimati"; // UTC+14
      const kiritimati = dayOfWeekForLocalDate("2026-08-30");
      expect(honolulu).toBe(0);
      expect(kiritimati).toBe(0);
    } finally {
      process.env.TZ = original;
    }
  });
});

describe("storeLocalDate", () => {
  it("resolves the local calendar day an instant falls on", () => {
    // 23:30 UTC is already the next day in Lagos (UTC+1).
    const instant = new Date("2026-08-30T23:30:00Z");
    expect(storeLocalDate(instant, "Africa/Lagos")).toBe("2026-08-31");
    expect(storeLocalDate(instant, "UTC")).toBe("2026-08-30");
    expect(storeLocalDate(instant, "America/New_York")).toBe("2026-08-30");
  });
});

describe("storeLocalMinutesOfDay", () => {
  it("returns minutes since local midnight", () => {
    const instant = new Date("2026-08-30T08:15:00Z");
    expect(storeLocalMinutesOfDay(instant, "UTC")).toBe(8 * 60 + 15);
    expect(storeLocalMinutesOfDay(instant, "Africa/Lagos")).toBe(9 * 60 + 15);
  });
});

describe("parseTimeOfDay", () => {
  it("parses a well-formed HH:MM", () => {
    expect(parseTimeOfDay("09:00")).toBe(540);
    expect(parseTimeOfDay("00:00")).toBe(0);
    expect(parseTimeOfDay("23:59")).toBe(1439);
    expect(parseTimeOfDay(" 08:30 ")).toBe(510);
  });

  it("rejects anything malformed rather than guessing", () => {
    // A bad opening time would silently make every staff member permanently late.
    expect(parseTimeOfDay("24:00")).toBeNull();
    expect(parseTimeOfDay("9:00")).toBeNull();
    expect(parseTimeOfDay("09:60")).toBeNull();
    expect(parseTimeOfDay("")).toBeNull();
    expect(parseTimeOfDay(null)).toBeNull();
    expect(parseTimeOfDay(undefined)).toBeNull();
  });
});
