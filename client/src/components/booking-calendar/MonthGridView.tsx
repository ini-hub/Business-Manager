import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  format,
  parseISO,
} from "date-fns";
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
}

interface MonthGridViewProps {
  anchorDate: Date;
  bookings: CalendarBooking[];
  currency: string;
  onDayClick: (day: Date) => void;
  onBookingClick: (id: string) => void;
}

export function MonthGridView({ anchorDate, bookings, currency, onDayClick, onBookingClick }: MonthGridViewProps) {
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(anchorDate)),
    end: endOfWeek(endOfMonth(anchorDate)),
  });

  return (
    <div className="grid grid-cols-7 gap-px bg-muted rounded-xl overflow-hidden border border-border">
      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
        <div key={day} className="bg-muted/50 p-2 text-center text-sm font-medium text-muted-foreground">
          {day}
        </div>
      ))}
      {days.map((day, i) => {
        const dayBookings = bookings.filter((b) => isSameDay(parseISO(b.scheduledAt), day));
        const dayRevenue = dayBookings.reduce((sum, b) => sum + Number(b.totalPrice ?? 0), 0);
        return (
          <div
            key={i}
            onClick={() => onDayClick(day)}
            className={`min-h-[100px] bg-background p-2 transition-colors cursor-pointer hover:bg-muted/30 ${!isSameMonth(day, anchorDate) ? "opacity-50 bg-muted/20" : ""} ${isToday(day) ? "ring-2 ring-primary ring-inset" : ""}`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className={`text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full ${isToday(day) ? "bg-primary text-primary-foreground" : ""}`}>
                {format(day, "d")}
              </span>
              {dayBookings.length > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 h-5">{dayBookings.length}</Badge>
              )}
            </div>
            <div className="space-y-1">
              {dayBookings.slice(0, 3).map((booking) => (
                <div
                  key={booking.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onBookingClick(booking.id);
                  }}
                  className={`text-[10px] p-1 rounded truncate cursor-pointer hover:opacity-80 transition-opacity ${getStatusColor(booking.status)}`}
                  title={`${booking.customer?.name} - ${booking.bookingRef}`}
                >
                  {format(parseISO(booking.scheduledAt), "HH:mm")} • {booking.customer?.name || booking.bookingRef}
                </div>
              ))}
              {dayBookings.length > 3 && (
                <div className="text-[10px] text-muted-foreground text-center font-medium">
                  +{dayBookings.length - 3} more
                </div>
              )}
              {dayRevenue > 0 && (
                <div className="text-[10px] font-mono font-medium text-muted-foreground text-right pt-0.5">
                  {formatCurrency(dayRevenue, currency)}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
