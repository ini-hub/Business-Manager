import { dayOfWeekForLocalDate } from "../../lib/dateUtils";

/**
 * Resolves whether a staff member was rostered off on a given date.
 *
 * Replaces the "Sundays are off-days" rule that PayrollService used to carry
 * inline, in two separate copies. Precedence, most specific first:
 *
 *   1. a per-date exception  — a swapped or covered day
 *   2. the staff member's own weekly pattern
 *   3. the store's default weekly pattern
 *
 * A staff member with a schedule row and an empty pattern works every day; that
 * is a deliberate roster, not a missing one, so it does not fall back to the
 * store default. Only the absence of a row does.
 */

export type ScheduleExceptionKindLike = "off" | "working";

export type ScheduleResolver = (staffId: string, dateStr: string) => boolean;

export function buildScheduleResolver(input: {
  defaultWeeklyOffDays: number[] | null | undefined;
  /** staffId → that staff member's own weekly off-days. */
  schedulesByStaff: Map<string, number[]>;
  /** `${staffId}|${date}` → exception kind. */
  exceptionsByStaffDate: Map<string, ScheduleExceptionKindLike>;
}): ScheduleResolver {
  const storeDefault = normalise(input.defaultWeeklyOffDays);

  return (staffId: string, dateStr: string): boolean => {
    const exception = input.exceptionsByStaffDate.get(exceptionKey(staffId, dateStr));
    if (exception) return exception === "off";

    const own = input.schedulesByStaff.get(staffId);
    const pattern = own !== undefined ? normalise(own) : storeDefault;

    return pattern.includes(dayOfWeekForLocalDate(dateStr));
  };
}

export function exceptionKey(staffId: string, dateStr: string): string {
  return `${staffId}|${dateStr}`;
}

/** Weekday numbers only, 0–6, deduplicated. Anything else is discarded. */
function normalise(days: number[] | null | undefined): number[] {
  if (!Array.isArray(days)) return [];
  return Array.from(
    new Set(
      days
        .map((d) => Math.round(Number(d)))
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
    ),
  );
}
