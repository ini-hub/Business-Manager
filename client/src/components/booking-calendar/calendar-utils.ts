import { parseISO, isSameDay } from "date-fns";

export interface CalendarBooking {
  id: string;
  bookingRef: string;
  scheduledAt: string;
  status: string;
  type?: string;
  totalPrice: number | string;
  leadStaffId?: string | null;
  customer?: { name?: string };
  storeName?: string;
}

/** Order dates are stored date-only (local midnight), so 00:00 means "no start time". */
export function hasStartTime(scheduledAt: string): boolean {
  const d = parseISO(scheduledAt);
  return d.getHours() !== 0 || d.getMinutes() !== 0;
}

export function bookingsOnDay(bookings: CalendarBooking[], day: Date): CalendarBooking[] {
  return bookings.filter((b) => isSameDay(parseISO(b.scheduledAt), day));
}

const INACTIVE = ["cancelled", "no_show", "completed"];

/** Upcoming = still to happen: scheduled in the future and not closed out. */
export function isUpcoming(b: CalendarBooking, now = new Date()): boolean {
  if (INACTIVE.includes(b.status)) return false;
  const d = parseISO(b.scheduledAt);
  return hasStartTime(b.scheduledAt) ? d.getTime() >= now.getTime() : d >= new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export interface CalendarFilterState {
  staff: string[];
  stages: ("upcoming" | "completed" | "cancelled")[];
  noTimeOnly: boolean;
}

export const EMPTY_CALENDAR_FILTERS: CalendarFilterState = { staff: [], stages: [], noTimeOnly: false };

function stageOf(status: string): "upcoming" | "completed" | "cancelled" {
  if (status === "completed") return "completed";
  if (status === "cancelled" || status === "no_show") return "cancelled";
  return "upcoming";
}

export function calendarMatchesFilters(b: CalendarBooking, f: CalendarFilterState): boolean {
  if (f.staff.length > 0 && !(b.leadStaffId && f.staff.includes(b.leadStaffId))) return false;
  if (f.stages.length > 0 && !f.stages.includes(stageOf(b.status))) return false;
  if (f.noTimeOnly && hasStartTime(b.scheduledAt)) return false;
  return true;
}

export function countActiveCalendarFilters(f: CalendarFilterState): number {
  return (f.staff.length > 0 ? 1 : 0) + (f.stages.length > 0 ? 1 : 0) + (f.noTimeOnly ? 1 : 0);
}
