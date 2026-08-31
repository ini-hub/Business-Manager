import { describe, it, expect } from "vitest";
import { classifyDay, transportForDay, type DayPayRates } from "./dayTyping";

const base = { isAssignedToService: false, scheduledOff: false };

describe("classifyDay", () => {
  it("treats a staff member who worked a service as active, whatever the day was marked", () => {
    // Working outranks everything — including an explicit absence mark.
    expect(classifyDay({ ...base, isAssignedToService: true })).toBe("active");
    expect(classifyDay({ ...base, isAssignedToService: true, attendanceStatus: "absent" })).toBe("active");
    expect(classifyDay({ ...base, isAssignedToService: true, scheduledOff: true })).toBe("active");
  });

  it("maps each marked status to its category", () => {
    expect(classifyDay({ ...base, attendanceStatus: "present" })).toBe("passive");
    expect(classifyDay({ ...base, attendanceStatus: "leave" })).toBe("leave");
    expect(classifyDay({ ...base, attendanceStatus: "holiday" })).toBe("holiday");
    expect(classifyDay({ ...base, attendanceStatus: "off_day" })).toBe("off");
    expect(classifyDay({ ...base, attendanceStatus: "absent" })).toBe("absent");
  });

  it("lets an explicit mark override the roster", () => {
    // Someone rostered off who was marked present is present, not off.
    expect(classifyDay({ ...base, attendanceStatus: "present", scheduledOff: true })).toBe("passive");
    expect(classifyDay({ ...base, attendanceStatus: "absent", scheduledOff: true })).toBe("absent");
  });

  it("falls through to the roster only when the day is unmarked", () => {
    expect(classifyDay({ ...base, scheduledOff: true })).toBe("off");
    expect(classifyDay({ ...base, scheduledOff: false })).toBe("absent");
    expect(classifyDay({ ...base, attendanceStatus: null, scheduledOff: true })).toBe("off");
    expect(classifyDay({ ...base, attendanceStatus: undefined, scheduledOff: false })).toBe("absent");
  });

  it("treats an unrecognised status as unmarked rather than throwing", () => {
    expect(classifyDay({ ...base, attendanceStatus: "sabbatical", scheduledOff: true })).toBe("off");
  });
});

const rates: DayPayRates = {
  activeDayRate: 1000,
  passiveDayRate: 500,
  leaveDayRate: 400,
  holidayDayRate: 300,
  offDayRate: 200,
  payLeaveDays: false,
  payHolidayDays: false,
  payOffDays: false,
};

describe("transportForDay", () => {
  it("pays the active and passive rates", () => {
    expect(transportForDay("active", rates)).toEqual({ transport: 1000, dayType: "Active" });
    expect(transportForDay("passive", rates)).toEqual({ transport: 500, dayType: "Passive" });
  });

  it("pays nothing for an absent day", () => {
    expect(transportForDay("absent", rates)).toEqual({ transport: 0, dayType: "Absent" });
  });

  it("pays leave, holiday and off days only when the store opts in", () => {
    expect(transportForDay("leave", rates)).toEqual({ transport: 0, dayType: "Absent" });
    expect(transportForDay("holiday", rates)).toEqual({ transport: 0, dayType: "Absent" });
    expect(transportForDay("off", rates)).toEqual({ transport: 0, dayType: "Absent" });

    const paid = { ...rates, payLeaveDays: true, payHolidayDays: true, payOffDays: true };
    expect(transportForDay("leave", paid)).toEqual({ transport: 400, dayType: "Passive" });
    expect(transportForDay("holiday", paid)).toEqual({ transport: 300, dayType: "Passive" });
    expect(transportForDay("off", paid)).toEqual({ transport: 200, dayType: "Passive" });
  });
});
