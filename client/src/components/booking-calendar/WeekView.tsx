import { eachDayOfInterval, startOfWeek, endOfWeek, format, isSameDay, isToday } from "date-fns";
import { cn } from "@/lib/utils";
import { BookingPill } from "./BookingPill";
import { bookingsOnDay, type CalendarBooking } from "./calendar-utils";

interface WeekViewProps {
  anchorDate: Date;
  bookings: CalendarBooking[];
  onDayClick: (day: Date) => void;
}

export function WeekView({ anchorDate, bookings, onDayClick }: WeekViewProps) {
  const days = eachDayOfInterval({ start: startOfWeek(anchorDate), end: endOfWeek(anchorDate) });
  return (
    <div className="grid gap-2 lg:grid-cols-7">
      {days.map((day) => {
        const list = bookingsOnDay(bookings, day);
        const selected = isSameDay(day, anchorDate);
        return (
          <button
            key={day.toISOString()}
            type="button"
            onClick={() => onDayClick(day)}
            data-testid={`calendar-week-day-${format(day, "yyyy-MM-dd")}`}
            className={cn(
              "flex min-h-[4rem] flex-col gap-2 rounded-2xl border bg-card p-3 text-left transition-colors hover:bg-muted/40 lg:min-h-[14rem]",
              selected ? "border-primary ring-1 ring-primary" : "border-border",
            )}
          >
            <div className="flex items-center justify-between lg:flex-col lg:items-start lg:gap-0">
              <span className="text-xs font-semibold text-muted-foreground">{format(day, "EEE")}</span>
              <span className={cn("flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold", isToday(day) && "bg-primary text-primary-foreground")}>
                {format(day, "d")}
              </span>
            </div>
            {list.map((b) => <BookingPill key={b.id} booking={b} />)}
          </button>
        );
      })}
    </div>
  );
}
