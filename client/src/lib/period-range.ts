import { addDays, differenceInCalendarDays, endOfMonth, format, parseISO, startOfMonth, startOfYear, subMonths } from "date-fns";

export type PayPeriodRef = { id: string; startDate: string; endDate: string; periodType?: string };

export type PeriodRange = { from: string; to: string; label: string };

export const PRESET_KEYS = ["current", "month", "last-month", "3m", "year", "custom"] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];

/** A preset key, or "period:<payroll period id>" for one specific pay period. */
export type RangeKey = PresetKey | `period:${string}`;

/** Longest span a custom range may cover, so one request can't ask for years of days. */
export const MAX_RANGE_DAYS = 366;

const ymd = (d: Date) => format(d, "yyyy-MM-dd");
const short = (iso: string) => format(parseISO(iso), "d MMM yyyy");

export function formatPeriodDates(startDate: string, endDate: string) {
  return `${format(parseISO(startDate), "d MMM")} – ${short(endDate)}`;
}

/**
 * Turns the filter's selection into concrete dates. `current` is the open pay
 * period when there is one and the calendar month otherwise, so the default view
 * is never empty just because the manager hasn't started a period yet.
 */
export function resolveRange(
  key: string,
  custom: { from?: string | null; to?: string | null },
  periods: PayPeriodRef[],
  currentPeriod: PayPeriodRef | null | undefined,
  today: Date = new Date(),
): PeriodRange {
  if (key.startsWith("period:")) {
    const p = periods.find((x) => x.id === key.slice("period:".length));
    if (p) return { from: p.startDate, to: p.endDate, label: formatPeriodDates(p.startDate, p.endDate) };
  }
  switch (key) {
    case "month":
      return { from: ymd(startOfMonth(today)), to: ymd(endOfMonth(today)), label: format(today, "MMMM yyyy") };
    case "last-month": {
      const m = subMonths(today, 1);
      return { from: ymd(startOfMonth(m)), to: ymd(endOfMonth(m)), label: format(m, "MMMM yyyy") };
    }
    case "3m":
      return { from: ymd(startOfMonth(subMonths(today, 2))), to: ymd(endOfMonth(today)), label: "Last 3 months" };
    case "year":
      return { from: ymd(startOfYear(today)), to: ymd(today), label: format(today, "yyyy") };
    case "custom": {
      if (custom.from && custom.to && custom.from <= custom.to) {
        const capped = differenceInCalendarDays(parseISO(custom.to), parseISO(custom.from)) > MAX_RANGE_DAYS
          ? ymd(addDays(parseISO(custom.from), MAX_RANGE_DAYS))
          : custom.to;
        return { from: custom.from, to: capped, label: formatPeriodDates(custom.from, capped) };
      }
      break;
    }
  }
  if (key === "current" && currentPeriod) {
    return { from: currentPeriod.startDate, to: currentPeriod.endDate, label: formatPeriodDates(currentPeriod.startDate, currentPeriod.endDate) };
  }
  return resolveRange("month", {}, periods, null, today);
}

/** True when the item's own dates overlap the range (both ends inclusive). */
export function overlapsRange(item: { startDate: string; endDate: string }, range: { from: string; to: string }) {
  return item.startDate <= range.to && item.endDate >= range.from;
}
