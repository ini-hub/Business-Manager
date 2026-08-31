/**
 * Single source of truth for "what kind of day was this for this staff member?".
 *
 * PayrollService classified days in two places — the payroll calculation loop and the
 * per-staff drill-down — with copy-pasted logic that had already drifted apart. Both now
 * call `classifyDay`, so the payslip and the daily breakdown cannot disagree.
 */

export type DayClassification =
  | "active"
  | "passive"
  | "leave"
  | "holiday"
  | "off"
  | "absent";

export type ClassifyDayInput = {
  /** Staff was lead or assistant on at least one service checkout that day. */
  isAssignedToService: boolean;
  /** Marked attendance status, if a record exists for the day. */
  attendanceStatus?: string | null;
  /**
   * Whether the staff member was rostered off. Replaces the hardcoded "Sunday is an
   * off-day" rule that used to live inline in both loops.
   */
  scheduledOff: boolean;
};

/**
 * Working a service outranks everything: a staff member who took bookings is active
 * regardless of what the day was marked as. Below that, an explicit mark wins over the
 * roster, and only an unmarked day falls through to the schedule.
 */
export function classifyDay(input: ClassifyDayInput): DayClassification {
  if (input.isAssignedToService) return "active";

  switch (input.attendanceStatus) {
    case "present":
      return "passive";
    case "leave":
      return "leave";
    case "holiday":
      return "holiday";
    case "off_day":
      return "off";
    case "absent":
      return "absent";
    default:
      return input.scheduledOff ? "off" : "absent";
  }
}

export type DayPayRates = {
  activeDayRate: number;
  passiveDayRate: number;
  leaveDayRate: number;
  holidayDayRate: number;
  offDayRate: number;
  payLeaveDays: boolean;
  payHolidayDays: boolean;
  payOffDays: boolean;
};

/**
 * Transport payable for a classified day, and how the drill-down should label it.
 *
 * Leave/holiday/off collapse to "Passive" or "Absent" in `DailySummaryLine` because that
 * type predates those statuses; the classification is carried separately so callers that
 * want the real category still have it.
 */
export function transportForDay(
  classification: DayClassification,
  rates: DayPayRates,
): { transport: number; dayType: "Active" | "Passive" | "Absent" } {
  switch (classification) {
    case "active":
      return { transport: rates.activeDayRate, dayType: "Active" };
    case "passive":
      return { transport: rates.passiveDayRate, dayType: "Passive" };
    case "leave":
      return rates.payLeaveDays
        ? { transport: rates.leaveDayRate, dayType: "Passive" }
        : { transport: 0, dayType: "Absent" };
    case "holiday":
      return rates.payHolidayDays
        ? { transport: rates.holidayDayRate, dayType: "Passive" }
        : { transport: 0, dayType: "Absent" };
    case "off":
      return rates.payOffDays
        ? { transport: rates.offDayRate, dayType: "Passive" }
        : { transport: 0, dayType: "Absent" };
    case "absent":
      return { transport: 0, dayType: "Absent" };
  }
}
