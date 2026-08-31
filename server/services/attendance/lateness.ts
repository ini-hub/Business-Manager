import { parseTimeOfDay, storeLocalDate, storeLocalMinutesOfDay } from "../../lib/dateUtils";

/**
 * Was this arrival late, and by how much?
 *
 * Everything is measured in the store's own timezone. A salon in Lagos opening at
 * 09:00 means 09:00 in Lagos, whatever the server thinks the time is.
 */

export type LatenessVerdict = {
  localDate: string;
  isLate: boolean;
  lateMinutes: number;
  /** Minutes past midnight the staff member was expected, grace included. */
  expectedMinuteOfDay: number | null;
};

export function evaluateLateness(input: {
  effectiveAt: Date;
  timezone: string;
  openingTime: string | null | undefined;
  graceMinutes?: number | null;
}): LatenessVerdict {
  const localDate = storeLocalDate(input.effectiveAt, input.timezone);
  const opening = parseTimeOfDay(input.openingTime);

  // No usable opening time means nothing can be late. Failing open is deliberate:
  // a malformed setting must not silently charge every staff member every day.
  if (opening === null) {
    return { localDate, isLate: false, lateMinutes: 0, expectedMinuteOfDay: null };
  }

  const grace = Math.max(0, Math.round(Number(input.graceMinutes ?? 0)) || 0);
  const deadline = opening + grace;
  const arrived = storeLocalMinutesOfDay(input.effectiveAt, input.timezone);

  if (arrived <= deadline) {
    return { localDate, isLate: false, lateMinutes: 0, expectedMinuteOfDay: deadline };
  }

  // Reported against the opening time, not the end of grace: "40 minutes late"
  // should mean 40 minutes after the salon opened, which is what staff will count.
  return {
    localDate,
    isLate: true,
    lateMinutes: arrived - opening,
    expectedMinuteOfDay: deadline,
  };
}
