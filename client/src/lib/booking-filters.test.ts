import { describe, it, expect } from "vitest";
import {
  EMPTY_BOOKING_FILTERS,
  bookingMatchesFilters,
  bookingMatchesSearch,
  bookingStageOf,
  buildBookingFilterChips,
  clearBookingFilterChip,
  countActiveBookingFilters,
  sortBookings,
} from "./booking-filters";

const now = new Date(2026, 9, 15, 12, 0); // 15 Oct 2026, local
const b = (customerName: string, status: string, scheduledAt: Date, o: Record<string, unknown> = {}) =>
  ({ customerName, status, scheduledAt, staffLabel: "Ada", typeLabel: "Service", bookingRef: `BK-${customerName}`, ...o });
const rows = [
  b("Zed", "confirmed", new Date(2026, 9, 15, 9, 0)),
  b("Amy", "pending", new Date(2026, 9, 18, 9, 0), { staffLabel: "Bola", typeLabel: "Product" }),
  b("Kim", "completed", new Date(2026, 9, 10, 9, 0)),
  b("Lee", "no_show", new Date(2026, 8, 1, 9, 0)),
];
const names = (f: Parameters<typeof bookingMatchesFilters>[1]) => rows.filter((r) => bookingMatchesFilters(r, f, now)).map((r) => r.customerName);

describe("booking filters", () => {
  it("maps statuses to stages", () => {
    expect(["pending", "confirmed", "rescheduled"].map(bookingStageOf)).toEqual(["upcoming", "upcoming", "upcoming"]);
    expect(["cancelled", "no_show"].map(bookingStageOf)).toEqual(["cancelled", "cancelled"]);
    expect(bookingStageOf("completed")).toBe("completed");
  });
  it("filters by stage, staff and type", () => {
    expect(names({ ...EMPTY_BOOKING_FILTERS, stage: "upcoming" })).toEqual(["Zed", "Amy"]);
    expect(names({ ...EMPTY_BOOKING_FILTERS, stage: "cancelled" })).toEqual(["Lee"]);
    expect(names({ ...EMPTY_BOOKING_FILTERS, staff: ["Bola"] })).toEqual(["Amy"]);
    expect(names({ ...EMPTY_BOOKING_FILTERS, types: ["Product"] })).toEqual(["Amy"]);
  });
  it("filters by date window", () => {
    expect(names({ ...EMPTY_BOOKING_FILTERS, date: "today" })).toEqual(["Zed"]);
    expect(names({ ...EMPTY_BOOKING_FILTERS, date: "next7" })).toEqual(["Zed", "Amy"]);
    expect(names({ ...EMPTY_BOOKING_FILTERS, date: "past7" })).toEqual(["Zed", "Kim"]);
    expect(names({ ...EMPTY_BOOKING_FILTERS, date: "month" })).toEqual(["Zed", "Amy", "Kim"]);
  });
  it("searches ref and customer", () => {
    expect(rows.filter((r) => bookingMatchesSearch(r, "bk-amy")).length).toBe(1);
  });
  it("counts, builds and clears chips", () => {
    const f = { ...EMPTY_BOOKING_FILTERS, stage: "completed" as const, staff: ["Ada"] };
    expect(countActiveBookingFilters(f)).toBe(2);
    expect(buildBookingFilterChips(f).map((c) => c.label)).toEqual(["Completed", "Ada"]);
    expect(clearBookingFilterChip(f, "staff").staff).toEqual([]);
  });
  it("sorts", () => {
    expect(sortBookings(rows, { key: "soonest" })[0].customerName).toBe("Lee");
    expect(sortBookings(rows, { key: "latest" })[0].customerName).toBe("Amy");
    expect(sortBookings(rows, { key: "customer" })[0].customerName).toBe("Amy");
  });
});
