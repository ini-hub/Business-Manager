import { describe, it, expect } from "vitest";
import { resolvePunchTime } from "./punchTime";

const T = (iso: string) => new Date(iso);

describe("resolvePunchTime", () => {
  it("ignores the device clock on an online punch", () => {
    // The whole attack: post 08:55 at half past eleven and be on time.
    const result = resolvePunchTime({
      clientCapturedAt: T("2026-08-31T08:55:00Z"),
      serverReceivedAt: T("2026-08-31T11:30:00Z"),
      queued: false,
      maxAgeMinutes: 720,
    });
    expect(result.timeSource).toBe("server");
    expect(result.effectiveAt.toISOString()).toBe("2026-08-31T11:30:00.000Z");
    expect(result.clockSkewSeconds).toBe(9300);
    expect(result.divergenceFlagged).toBe(false);
  });

  it("uses the server clock when the device offered nothing", () => {
    const result = resolvePunchTime({
      serverReceivedAt: T("2026-08-31T09:00:00Z"),
      queued: true,
      maxAgeMinutes: 720,
    });
    expect(result.timeSource).toBe("server");
    expect(result.clockSkewSeconds).toBeNull();
    expect(result.divergenceFlagged).toBe(false);
  });

  it("honours a queued punch that is within the accepted window", () => {
    const result = resolvePunchTime({
      clientCapturedAt: T("2026-08-31T08:58:00Z"),
      serverReceivedAt: T("2026-08-31T12:00:00Z"),
      queued: true,
      maxAgeMinutes: 720,
    });
    expect(result.timeSource).toBe("client");
    expect(result.effectiveAt.toISOString()).toBe("2026-08-31T08:58:00.000Z");
    expect(result.divergenceFlagged).toBe(false);
  });

  it("refuses and flags a queued punch older than the store allows", () => {
    const result = resolvePunchTime({
      clientCapturedAt: T("2026-08-30T20:00:00Z"),  // 13 hours earlier
      serverReceivedAt: T("2026-08-31T09:00:00Z"),
      queued: true,
      maxAgeMinutes: 720,                            // 12 hours
    });
    expect(result.timeSource).toBe("server");
    expect(result.divergenceFlagged).toBe(true);
  });

  it("refuses and flags a future-dated device clock", () => {
    const result = resolvePunchTime({
      clientCapturedAt: T("2026-08-31T10:00:00Z"),
      serverReceivedAt: T("2026-08-31T09:00:00Z"),
      queued: true,
      maxAgeMinutes: 720,
    });
    expect(result.timeSource).toBe("server");
    expect(result.effectiveAt.toISOString()).toBe("2026-08-31T09:00:00.000Z");
    expect(result.clockSkewSeconds).toBe(-3600);
    expect(result.divergenceFlagged).toBe(true);
  });

  it("falls back to the server clock when the store accepts no offline age", () => {
    const result = resolvePunchTime({
      clientCapturedAt: T("2026-08-31T08:58:00Z"),
      serverReceivedAt: T("2026-08-31T09:00:00Z"),
      queued: true,
      maxAgeMinutes: 0,
    });
    expect(result.timeSource).toBe("server");
    expect(result.divergenceFlagged).toBe(true);
  });

  it("always records both clocks, whichever one it used", () => {
    const result = resolvePunchTime({
      clientCapturedAt: T("2026-08-31T08:59:30Z"),
      serverReceivedAt: T("2026-08-31T09:00:00Z"),
      queued: true,
      maxAgeMinutes: 720,
    });
    expect(result.clockSkewSeconds).toBe(30);
  });
});
