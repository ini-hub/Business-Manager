import { Link } from "wouter";
import { AddButton } from "@/components/add-button";
import { ArrowLeft } from "lucide-react";
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
            <AddButton label="New Booking" gate="booking_management" href="/bookings/new" data-testid="button-new-booking" />
          </div>
        }
      />
      <BookingCalendarView />
    </div>
  );
}
