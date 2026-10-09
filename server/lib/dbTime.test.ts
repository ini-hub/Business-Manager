import { describe, it, expect } from "vitest";
import { parseDbTimestamp } from "./dbTime";

describe("parseDbTimestamp", () => {
  it("reads a zone-less database timestamp as UTC, whatever the server's zone", () => {
    expect(parseDbTimestamp("2026-10-08 15:02:50.628").toISOString()).toBe("2026-10-08T15:02:50.628Z");
    expect(parseDbTimestamp("2026-10-08T15:02:50").toISOString()).toBe("2026-10-08T15:02:50.000Z");
  });
  it("leaves values that already carry a zone, or are Dates, alone", () => {
    expect(parseDbTimestamp("2026-10-08T15:02:50.000Z").toISOString()).toBe("2026-10-08T15:02:50.000Z");
    expect(parseDbTimestamp("2026-10-08 15:02:50+01:00").toISOString()).toBe("2026-10-08T14:02:50.000Z");
    const d = new Date("2026-01-01T00:00:00Z");
    expect(parseDbTimestamp(d)).toBe(d);
  });
});
