import { describe, it, expect } from "vitest";
import { previousLocalDate } from "./AttendanceDayCloseService";

describe("previousLocalDate", () => {
  it("steps back one day", () => {
    expect(previousLocalDate("2026-08-31")).toBe("2026-08-30");
  });

  it("crosses a month boundary", () => {
    expect(previousLocalDate("2026-09-01")).toBe("2026-08-31");
    expect(previousLocalDate("2026-03-01")).toBe("2026-02-28");
  });

  it("crosses a year boundary", () => {
    expect(previousLocalDate("2026-01-01")).toBe("2025-12-31");
  });

  it("handles a leap day", () => {
    expect(previousLocalDate("2028-03-01")).toBe("2028-02-29");
  });

  it("is unaffected by the process timezone", () => {
    // Bare calendar arithmetic, done in UTC — a server west of UTC must not make
    // the sweep skip or repeat a day.
    const original = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Honolulu";
      expect(previousLocalDate("2026-08-31")).toBe("2026-08-30");
      process.env.TZ = "Pacific/Kiritimati";
      expect(previousLocalDate("2026-08-31")).toBe("2026-08-30");
    } finally {
      process.env.TZ = original;
    }
  });
});
