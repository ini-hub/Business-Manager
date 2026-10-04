import { format, parseISO } from "date-fns";
import { Link } from "wouter";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getStatusColor } from "@/lib/booking-status";
import { formatCurrency } from "@/lib/currency-utils";
import { cn } from "@/lib/utils";
import { hasStartTime, isUpcoming, type CalendarBooking } from "./calendar-utils";

interface DayAgendaViewProps {
  day: Date;
  bookings: CalendarBooking[];
  currency: string;
  staffNames: Record<string, string>;
  onBookingClick: (id: string) => void;
}

export function DayAgendaView({ day, bookings, currency, staffNames, onBookingClick }: DayAgendaViewProps) {
  const sorted = [...bookings].sort((a, b) => {
    const at = hasStartTime(a.scheduledAt), bt = hasStartTime(b.scheduledAt);
    if (at !== bt) return at ? 1 : -1;
    return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
  });

  return (
    <section className="space-y-2 lg:rounded-2xl lg:border lg:border-border lg:bg-card lg:p-4" aria-label="Day bookings">
      <div className="flex items-baseline justify-between px-1">
        <h3 className="text-base font-semibold">{format(day, "EEEE d MMMM")}</h3>
        <span className="text-sm text-muted-foreground">
          {sorted.length} booking{sorted.length === 1 ? "" : "s"}
          {sorted.length > 0 && ` · ${formatCurrency(sorted.reduce((t, b) => t + Number(b.totalPrice ?? 0), 0), currency)}`}
        </span>
      </div>

      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed py-10 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <CalendarDays className="h-5 w-5" />
          </div>
          <p className="text-sm text-muted-foreground">No bookings on this day.</p>
        </div>
      ) : (
        sorted.map((b) => {
          const timed = hasStartTime(b.scheduledAt);
          const staff = (b.leadStaffId && staffNames[b.leadStaffId]) || "Unassigned";
          const type = b.type ? b.type.charAt(0).toUpperCase() + b.type.slice(1) : "";
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onBookingClick(b.id)}
              data-testid={`calendar-booking-${b.id}`}
              className="flex w-full items-stretch gap-3 rounded-2xl border border-border bg-card p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="w-16 shrink-0">
                <p className={cn("text-sm font-bold leading-tight", timed ? "text-foreground" : "text-amber-700 dark:text-amber-400")}>
                  {timed ? format(parseISO(b.scheduledAt), "h:mm a") : "No time"}
                </p>
              </div>
              <div className={cn("w-0.5 shrink-0 rounded-full", isUpcoming(b) ? "bg-primary" : "bg-muted-foreground/40")} />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold">{b.customer?.name || b.bookingRef}</p>
                  <span className="shrink-0 text-sm font-bold tabular-nums">{formatCurrency(Number(b.totalPrice ?? 0), currency)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs text-muted-foreground">
                    {[type, staff, b.storeName].filter(Boolean).join(" · ")}
                  </p>
                  <Badge variant="secondary" className={cn("shrink-0 capitalize", getStatusColor(b.status))}>
                    {b.status.replace("_", " ")}
                  </Badge>
                </div>
                {!timed && (
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Saved without a start time. Tap to set one.</p>
                )}
              </div>
            </button>
          );
        })
      )}
      <Button variant="outline" asChild className="h-11 w-full rounded-xl font-semibold" data-testid="button-book-this-day">
        <Link href={`/bookings/new?date=${format(day, "yyyy-MM-dd")}`}>Book this day</Link>
      </Button>
      <div className="hidden items-center gap-4 border-t border-border pt-3 text-xs text-muted-foreground lg:flex">
        <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm border border-primary/30 bg-primary/10" />Upcoming</span>
        <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm border border-border bg-muted" />Past</span>
        <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm border border-amber-300 bg-amber-100" />No start time</span>
      </div>
    </section>
  );
}
