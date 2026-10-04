/**
 * Pure filter/sort logic for the Bookings list's Filters + Sort bottom sheets.
 * Framework-free so it can be unit tested without mounting the page.
 */

export type BookingStage = "upcoming" | "completed" | "cancelled";
export type BookingDateFilter = "today" | "next7" | "past7" | "month";

export interface BookingFilterState {
  stage: BookingStage | null;
  date: BookingDateFilter | null;
  staff: string[];
  types: string[];
}

export const EMPTY_BOOKING_FILTERS: BookingFilterState = { stage: null, date: null, staff: [], types: [] };

export type BookingSortKey = "soonest" | "latest" | "customer";
export interface BookingSortState {
  key: BookingSortKey;
}

export interface FilterableBooking {
  bookingRef?: string | null;
  customerName: string;
  notes?: string | null;
  status: string;
  scheduledAt: string | Date;
  staffLabel?: string;
  typeLabel?: string;
}

export const STAGE_LABELS: Record<BookingStage, string> = {
  upcoming: "Upcoming",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const DATE_LABELS: Record<BookingDateFilter, string> = {
  today: "Today",
  next7: "Next 7 days",
  past7: "Past 7 days",
  month: "This month",
};

/** Upcoming is anything still to happen; Cancelled also holds no-shows. */
export function bookingStageOf(status: string): BookingStage {
  if (status === "completed") return "completed";
  if (status === "cancelled" || status === "no_show") return "cancelled";
  return "upcoming";
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function inWindow(when: Date, window: BookingDateFilter, now: Date): boolean {
  const today = startOfDay(now).getTime();
  const day = 86_400_000;
  const t = when.getTime();
  switch (window) {
    case "today": return t >= today && t < today + day;
    case "next7": return t >= today && t < today + 7 * day;
    case "past7": return t >= today - 7 * day && t < today + day;
    case "month": return when.getFullYear() === now.getFullYear() && when.getMonth() === now.getMonth();
  }
}

export function bookingMatchesFilters<T extends FilterableBooking>(b: T, f: BookingFilterState, now = new Date()): boolean {
  if (f.stage && bookingStageOf(b.status) !== f.stage) return false;
  if (f.date && !inWindow(new Date(b.scheduledAt), f.date, now)) return false;
  if (f.staff.length > 0 && !f.staff.includes(b.staffLabel ?? "Unassigned")) return false;
  if (f.types.length > 0 && !f.types.includes(b.typeLabel ?? "")) return false;
  return true;
}

export function bookingMatchesSearch(b: FilterableBooking, term: string): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  return (
    (b.bookingRef ?? "").toLowerCase().includes(q) ||
    b.customerName.toLowerCase().includes(q) ||
    (b.notes ?? "").toLowerCase().includes(q)
  );
}

export function countActiveBookingFilters(f: BookingFilterState): number {
  return (f.stage ? 1 : 0) + (f.date ? 1 : 0) + (f.staff.length > 0 ? 1 : 0) + (f.types.length > 0 ? 1 : 0);
}

export interface BookingFilterChip {
  key: keyof BookingFilterState;
  label: string;
}

export function buildBookingFilterChips(f: BookingFilterState): BookingFilterChip[] {
  const chips: BookingFilterChip[] = [];
  if (f.stage) chips.push({ key: "stage", label: STAGE_LABELS[f.stage] });
  if (f.date) chips.push({ key: "date", label: DATE_LABELS[f.date] });
  if (f.staff.length > 0) chips.push({ key: "staff", label: f.staff.join(", ") });
  if (f.types.length > 0) chips.push({ key: "types", label: f.types.join(", ") });
  return chips;
}

export function clearBookingFilterChip(f: BookingFilterState, key: BookingFilterChip["key"]): BookingFilterState {
  return { ...f, [key]: EMPTY_BOOKING_FILTERS[key] };
}

export function bookingSortLabel(sort: BookingSortState | null): string {
  if (!sort) return "Sort";
  return { soonest: "Sort: Soonest", latest: "Sort: Latest first", customer: "Sort: Customer" }[sort.key];
}

export function sortBookings<T extends FilterableBooking>(rows: T[], sort: BookingSortState | null): T[] {
  if (!sort) return rows;
  const time = (b: T) => new Date(b.scheduledAt).getTime();
  return [...rows].sort((a, b) => {
    switch (sort.key) {
      case "soonest": return time(a) - time(b);
      case "latest": return time(b) - time(a);
      case "customer": return a.customerName.localeCompare(b.customerName);
    }
  });
}
