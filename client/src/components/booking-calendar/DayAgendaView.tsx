import { format, parseISO } from "date-fns";
import { CalendarDays } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getStatusColor } from "@/lib/booking-status";
import { formatCurrency } from "@/lib/currency-utils";

interface CalendarBooking {
  id: string;
  bookingRef: string;
  scheduledAt: string;
  status: string;
  totalPrice: number | string;
  customer?: { name?: string };
  storeName?: string;
}

interface DayAgendaViewProps {
  bookings: CalendarBooking[];
  currency: string;
  onBookingClick: (id: string) => void;
}

export function DayAgendaView({ bookings, currency, onBookingClick }: DayAgendaViewProps) {
  if (bookings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
        <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
          <CalendarDays className="h-6 w-6" />
        </div>
        <p className="text-sm font-medium">No bookings scheduled for this day.</p>
      </div>
    );
  }

  const sorted = [...bookings].sort(
    (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
  );

  return (
    <div className="space-y-2">
      {sorted.map((booking) => (
        <div
          key={booking.id}
          onClick={() => onBookingClick(booking.id)}
          className="flex items-center justify-between gap-3 rounded-lg border border-border/50 p-3 cursor-pointer hover:bg-muted/40 transition-colors"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-sm font-mono font-medium text-muted-foreground w-16 shrink-0">
              {format(parseISO(booking.scheduledAt), "h:mm a")}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{booking.customer?.name || booking.bookingRef}</p>
              <p className="text-xs text-muted-foreground truncate">
                {booking.bookingRef}
                {booking.storeName ? ` • ${booking.storeName}` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-sm font-mono">{formatCurrency(Number(booking.totalPrice ?? 0), currency)}</span>
            <Badge variant="secondary" className={`capitalize font-medium ${getStatusColor(booking.status)}`}>
              {booking.status.replace("_", " ")}
            </Badge>
          </div>
        </div>
      ))}
    </div>
  );
}
