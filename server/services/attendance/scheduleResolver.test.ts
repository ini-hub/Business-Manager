import { describe, it, expect } from "vitest";
import { buildScheduleResolver, exceptionKey } from "./scheduleResolver";

// 2026-08-30 Sun, 08-31 Mon, 09-01 Tue, 09-02 Wed, 09-05 Sat
const SUN = "2026-08-30";
const MON = "2026-08-31";
const TUE = "2026-09-01";
const SAT = "2026-09-05";

const build = (opts: Partial<Parameters<typeof buildScheduleResolver>[0]> = {}) =>
  buildScheduleResolver({
    defaultWeeklyOffDays: [0],
    schedulesByStaff: new Map(),
    exceptionsByStaffDate: new Map(),
    ...opts,
  });

describe("buildScheduleResolver", () => {
  it("falls back to the store default when a staff member has no roster", () => {
    const isOff = build();
    expect(isOff("ada", SUN)).toBe(true);
    expect(isOff("ada", MON)).toBe(false);
  });

  it("reproduces the old hardcoded Sunday rule with the default settings value", () => {
    // settings.default_weekly_off_days defaults to '[0]' precisely so that
    // turning this on changes nothing for an existing store.
    const isOff = build({ defaultWeeklyOffDays: [0] });
    expect(isOff("ada", SUN)).toBe(true);
    expect([MON, TUE, SAT].every((d) => isOff("ada", d) === false)).toBe(true);
  });

  it("prefers a staff member's own weekly pattern over the store default", () => {
    const isOff = build({ schedulesByStaff: new Map([["ada", [2, 0]]]) });
    expect(isOff("ada", TUE)).toBe(true);
    expect(isOff("ada", SUN)).toBe(true);
    expect(isOff("ada", MON)).toBe(false);
    // A colleague without a roster still gets the store default.
    expect(isOff("chidi", TUE)).toBe(false);
    expect(isOff("chidi", SUN)).toBe(true);
  });

  it("treats an empty personal roster as working every day, not as missing", () => {
    const isOff = build({ schedulesByStaff: new Map([["ada", []]]) });
    expect(isOff("ada", SUN)).toBe(false);
  });

  it("lets a per-date exception override the weekly pattern in both directions", () => {
    const isOff = build({
      schedulesByStaff: new Map([["ada", [2]]]),
      exceptionsByStaffDate: new Map([
        [exceptionKey("ada", TUE), "working"],   // covering a colleague
        [exceptionKey("ada", MON), "off"],       // swapped for it
      ]),
    });
    expect(isOff("ada", TUE)).toBe(false);
    expect(isOff("ada", MON)).toBe(true);
  });

  it("applies an exception even where there is no roster at all", () => {
    const isOff = build({
      exceptionsByStaffDate: new Map([[exceptionKey("ada", SUN), "working"]]),
    });
    expect(isOff("ada", SUN)).toBe(false);
  });

  it("scopes exceptions to the right staff member and date", () => {
    const isOff = build({
      exceptionsByStaffDate: new Map([[exceptionKey("ada", MON), "off"]]),
    });
    expect(isOff("ada", MON)).toBe(true);
    expect(isOff("chidi", MON)).toBe(false);
    expect(isOff("ada", TUE)).toBe(false);
  });

  it("discards malformed weekday values rather than trusting stored jsonb", () => {
    const isOff = build({ defaultWeeklyOffDays: [0, 9, -1, 3.7, NaN] as number[] });
    expect(isOff("ada", SUN)).toBe(true);
    expect(isOff("ada", MON)).toBe(false);
  });

  it("treats a null or non-array pattern as no off-days", () => {
    expect(build({ defaultWeeklyOffDays: null })("ada", SUN)).toBe(false);
    expect(build({ defaultWeeklyOffDays: undefined })("ada", SUN)).toBe(false);
  });
});
