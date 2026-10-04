import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { hasStartTime, isUpcoming, type CalendarBooking } from "./calendar-utils";

export function BookingPill({ booking }: { booking: CalendarBooking }) {
  const timed = hasStartTime(booking.scheduledAt);
  const name = booking.customer?.name || booking.bookingRef;
  return (
    <div
      title={`${timed ? format(parseISO(booking.scheduledAt), "h:mm a") : "No time"} · ${name}`}
      className={cn(
        "truncate rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
        !timed
          ? "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-400"
          : isUpcoming(booking)
            ? "border-primary/30 bg-primary/10 text-primary"
            : "border-border bg-muted text-muted-foreground",
      )}
    >
      {timed ? format(parseISO(booking.scheduledAt), "H:mm") : "No time"} · {name}
    </div>
  );
}
