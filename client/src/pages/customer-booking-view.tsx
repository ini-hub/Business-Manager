import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CalendarCheck, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FullScreenLoader, Spinner } from "@/components/ui/loader";

type BookingView = {
  booking: {
    bookingRef: string;
    status: string;
    scheduledAt: string;
    totalPrice: number;
    depositAmount: number;
    notes: string | null;
  };
  storeName: string;
  items: { quantity: number; unitPrice: number; totalPrice: number }[];
};

/**
 * Public, session-less page reached via the magic link sent at the end of a
 * WhatsApp booking conversation (server/routes/customer-booking.routes.ts).
 * Scoped to exactly one booking by an unguessable token in the URL.
 */
export default function CustomerBookingView() {
  const { token } = useParams<{ token: string }>();
  const [cancelled, setCancelled] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<BookingView>({
    queryKey: [`/api/my-booking/${token}`],
    queryFn: async () => {
      const res = await fetch(`/api/my-booking/${token}`);
      if (!res.ok) throw new Error((await res.json()).error || "Failed to load booking");
      return res.json();
    },
  });

  const cancelBooking = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/my-booking/${token}/cancel`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to cancel booking");
      return res.json();
    },
    onSuccess: () => {
      setCancelled(true);
      refetch();
    },
  });

  if (isLoading) {
    return <FullScreenLoader label="Loading your booking" />;
  }

  if (isError || !data) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-2">
            <XCircle className="h-10 w-10 text-destructive mx-auto" />
            <p className="font-semibold">This link has expired or is invalid.</p>
            <p className="text-sm text-muted-foreground">Message the store on WhatsApp to book again or check your booking.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { booking, storeName, items } = data;
  const scheduled = new Date(booking.scheduledAt);
  const canCancel = !["completed", "cancelled", "no_show"].includes(booking.status);

  return (
    <div className="flex items-center justify-center min-h-screen p-4 bg-muted/30">
      <Card className="max-w-md w-full">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CalendarCheck className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">{storeName}</CardTitle>
          </div>
          <CardDescription>Booking {booking.bookingRef}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Status</span>
            <Badge variant={booking.status === "cancelled" ? "destructive" : "default"} className="capitalize">{booking.status.replace("_", " ")}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">When</span>
            <span className="text-sm font-medium">{scheduled.toLocaleString("en-NG", { weekday: "long", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="text-sm font-medium">₦{Number(booking.totalPrice).toLocaleString()}</span>
          </div>
          {items.length > 0 && (
            <div className="border-t pt-3 space-y-1">
              {items.map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span>Qty {item.quantity}</span>
                  <span>₦{Number(item.totalPrice).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}

          {canCancel && !cancelled && (
            <Button
              variant="outline"
              className="w-full text-destructive hover:text-destructive"
              onClick={() => cancelBooking.mutate()}
              disabled={cancelBooking.isPending}
            >
              {cancelBooking.isPending && <Spinner className="mr-2 h-5 w-5 animate-spin" />}
              Cancel Booking
            </Button>
          )}
          {cancelled && <p className="text-sm text-center text-muted-foreground">Booking cancelled.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
