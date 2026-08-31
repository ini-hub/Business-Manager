import { describe, it, expect } from "vitest";
import { detectSharedDevice, detectRapidSuccession, type PunchLike } from "./collusion";

const punch = (id: string, staffId: string, deviceId: string | null, iso: string): PunchLike => ({
  id, staffId, deviceId, effectiveAt: new Date(`2026-08-31T${iso}Z`),
});

describe("detectSharedDevice", () => {
  it("flags one device that clocked in several people", () => {
    const groups = detectSharedDevice([
      punch("p1", "ada", "dev-1", "08:55:00"),
      punch("p2", "chidi", "dev-1", "08:56:00"),
      punch("p3", "bola", "dev-1", "08:57:00"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].deviceId).toBe("dev-1");
    expect(groups[0].staffIds.sort()).toEqual(["ada", "bola", "chidi"]);
    expect(groups[0].punchIds).toHaveLength(3);
  });

  it("does not flag one person punching twice from their own phone", () => {
    // Clock-in and clock-out on the same device is the normal case.
    expect(detectSharedDevice([
      punch("p1", "ada", "dev-1", "08:55:00"),
      punch("p2", "ada", "dev-1", "18:00:00"),
    ])).toEqual([]);
  });

  it("does not flag a salon where everyone used their own phone", () => {
    expect(detectSharedDevice([
      punch("p1", "ada", "dev-1", "08:55:00"),
      punch("p2", "chidi", "dev-2", "08:56:00"),
    ])).toEqual([]);
  });

  it("ignores punches with no device id rather than grouping them together", () => {
    // A manager proxy punch has no device; two of them are not a shared device.
    expect(detectSharedDevice([
      punch("p1", "ada", null, "08:55:00"),
      punch("p2", "chidi", null, "08:56:00"),
    ])).toEqual([]);
  });

  it("reports each offending device separately", () => {
    const groups = detectSharedDevice([
      punch("p1", "ada", "dev-1", "08:55:00"),
      punch("p2", "chidi", "dev-1", "08:56:00"),
      punch("p3", "bola", "dev-2", "09:01:00"),
      punch("p4", "emeka", "dev-2", "09:02:00"),
    ]);
    expect(groups.map(g => g.deviceId).sort()).toEqual(["dev-1", "dev-2"]);
  });
});

describe("detectRapidSuccession", () => {
  it("flags several staff punched from one device inside the window", () => {
    const groups = detectRapidSuccession([
      punch("p1", "ada", "dev-1", "08:55:00"),
      punch("p2", "chidi", "dev-1", "08:56:30"),
      punch("p3", "bola", "dev-1", "08:57:10"),
    ], 5);
    expect(groups).toHaveLength(1);
    expect(groups[0].staffIds.sort()).toEqual(["ada", "bola", "chidi"]);
  });

  it("does not flag a device honestly shared across the day", () => {
    // Someone borrowed a colleague's phone in the morning and again at closing.
    expect(detectRapidSuccession([
      punch("p1", "ada", "dev-1", "08:55:00"),
      punch("p2", "chidi", "dev-1", "14:30:00"),
    ], 5)).toEqual([]);
  });

  it("only reports the punches inside the burst, not the whole day", () => {
    const groups = detectRapidSuccession([
      punch("p1", "ada", "dev-1", "08:00:00"),
      punch("p2", "chidi", "dev-1", "12:00:00"),
      punch("p3", "bola", "dev-1", "12:01:00"),
    ], 5);
    expect(groups).toHaveLength(1);
    expect(groups[0].punchIds.sort()).toEqual(["p2", "p3"]);
  });

  it("does not flag one person's own repeated punches", () => {
    expect(detectRapidSuccession([
      punch("p1", "ada", "dev-1", "08:55:00"),
      punch("p2", "ada", "dev-1", "08:56:00"),
    ], 5)).toEqual([]);
  });

  it("handles punches arriving out of order", () => {
    const groups = detectRapidSuccession([
      punch("p2", "chidi", "dev-1", "08:56:00"),
      punch("p1", "ada", "dev-1", "08:55:00"),
    ], 5);
    expect(groups).toHaveLength(1);
  });

  it("returns nothing for an empty log", () => {
    expect(detectRapidSuccession([], 5)).toEqual([]);
    expect(detectSharedDevice([])).toEqual([]);
  });
});
