import { Link } from "wouter";
import { ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { BookingCalendarView } from "@/components/booking-calendar/BookingCalendarView";
import { useStore } from "@/lib/store-context";

export default function BookingCalendarPage() {
  const { currentStore } = useStore();

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader title="Booking Calendar" description="Bookings by day, month and year" compact />
        <StoreRequiredAlert title="Store Required for Booking Calendar" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        title="Booking calendar"
        description={`Appointments and advance orders by day, week, month and year for ${currentStore.name}`}
        compact
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild data-testid="button-back-to-bookings">
              <Link href="/bookings" aria-label="Back to bookings">
                <ArrowLeft className="h-4 w-4 lg:mr-2" />
                <span className="hidden lg:inline">Bookings</span>
              </Link>
            </Button>
            <Button asChild data-testid="button-new-booking">
              <Link href="/bookings/new">
                <Plus className="h-4 w-4 lg:mr-2" />
                <span className="hidden lg:inline">New booking</span>
                <span className="lg:hidden">Book</span>
              </Link>
            </Button>
          </div>
        }
      />
      <BookingCalendarView />
    </div>
  );
}
