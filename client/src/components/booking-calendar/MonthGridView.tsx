import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, isToday, format } from "date-fns";
import { formatCurrencyCompact } from "@/lib/currency-utils";
import { cn } from "@/lib/utils";
import { BookingPill } from "./BookingPill";
import { bookingsOnDay, isUpcoming, type CalendarBooking } from "./calendar-utils";

interface MonthGridViewProps {
  anchorDate: Date;
  bookings: CalendarBooking[];
  currency: string;
  onDayClick: (day: Date) => void;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

export function MonthGridView({ anchorDate, bookings, currency, onDayClick }: MonthGridViewProps) {
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(anchorDate)),
    end: endOfWeek(endOfMonth(anchorDate)),
  });

  return (
    <>
    <div className="hidden overflow-hidden rounded-2xl border border-border bg-card lg:block">
      <div className="grid grid-cols-7 border-b border-border bg-muted/50">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="px-3 py-2 text-xs font-semibold text-muted-foreground">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const dayBookings = bookingsOnDay(bookings, day);
          const inMonth = isSameMonth(day, anchorDate);
          const selected = isSameDay(day, anchorDate);
          const revenue = dayBookings.reduce((sum, b) => sum + Number(b.totalPrice ?? 0), 0);
          return (
            <div
              key={day.toISOString()}
              role="button"
              tabIndex={0}
              onClick={() => onDayClick(day)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onDayClick(day)}
              data-testid={`calendar-cell-${format(day, "yyyy-MM-dd")}`}
              className={cn(
                "min-h-[7rem] cursor-pointer space-y-1 border-b border-r border-border p-2 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                !inMonth && "bg-muted/30 text-muted-foreground/60",
                selected && "bg-primary/5 ring-2 ring-inset ring-primary",
              )}
            >
              <div className="flex items-center justify-between">
                <span className={cn("flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold", isToday(day) && "bg-primary text-primary-foreground")}>
                  {format(day, "d")}
                </span>
                {revenue > 0 && <span className="text-[11px] font-medium tabular-nums text-muted-foreground">{formatCurrencyCompact(revenue, currency)}</span>}
              </div>
              {dayBookings.slice(0, 2).map((b) => <BookingPill key={b.id} booking={b} />)}
              {dayBookings.length > 2 && <p className="px-1 text-[11px] font-medium text-muted-foreground">+{dayBookings.length - 2} more</p>}
            </div>
          );
        })}
      </div>
    </div>
    <div className="rounded-2xl border border-border bg-card p-3 lg:hidden">
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map((d, i) => (
          <div key={i} className="py-1 text-center text-xs font-semibold text-muted-foreground">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {days.map((day) => {
          const dayBookings = bookingsOnDay(bookings, day);
          const inMonth = isSameMonth(day, anchorDate);
          const selected = isSameDay(day, anchorDate);
          const today = isToday(day);
          const upcoming = dayBookings.some((b) => isUpcoming(b));
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onDayClick(day)}
              aria-label={`${format(day, "EEEE d MMMM")}, ${dayBookings.length} booking${dayBookings.length === 1 ? "" : "s"}`}
              aria-pressed={selected}
              data-testid={`calendar-day-${format(day, "yyyy-MM-dd")}`}
              className="flex flex-col items-center gap-0.5 py-0.5 focus-visible:outline-none group"
            >
              <span
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-full text-sm font-medium transition-colors",
                  !inMonth && "text-muted-foreground/40",
                  inMonth && dayBookings.length > 0 && !selected && "font-bold",
                  today && !selected && "border-2 border-primary text-foreground",
                  selected && "bg-primary text-primary-foreground font-bold",
                  !selected && "group-hover:bg-muted group-focus-visible:ring-2 group-focus-visible:ring-ring",
                )}
              >
                {format(day, "d")}
              </span>
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  dayBookings.length === 0 ? "bg-transparent" : upcoming ? "bg-primary" : "bg-muted-foreground/50",
                )}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary" />Upcoming</span>
        <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />Past</span>
        <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border-2 border-primary" />Today</span>
      </div>
    </div>
    </>
  );
}
