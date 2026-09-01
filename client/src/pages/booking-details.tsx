import { useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { 
  ArrowLeft, 
  Calendar, 
  Clock, 
  CreditCard, 
  Edit, 
  FileText, 
  MessageSquare, 
  ShoppingBag, 
  User, 
  UserCog, 
  CheckCircle2, 
  XCircle,
  AlertCircle,
  ArrowRightLeft
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { BaseCard } from "@/components/oop-ui/BaseCard";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageContainer } from "@/components/oop-ui/PageContainer";

import { apiRequest, queryClient } from "@/lib/queryClient";
import { useReturnTo } from "@/lib/return-to";
import { EntityLink } from "@/components/oop-ui/EntityDisplayPresenter";
import { buildSlug } from "@/lib/slug";
import { useToast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const safeFormat = (dateValue: any, formatStr: string) => {
  if (!dateValue) return "N/A";
  try {
    const d = new Date(dateValue);
    if (isNaN(d.getTime())) return "Invalid date";
    return format(d, formatStr);
  } catch (e) {
    return "Invalid date";
  }
};

export default function BookingDetailsPage() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { backHref } = useReturnTo("/bookings");
  const { toast } = useToast();
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [completeAlertOpen, setCompleteAlertOpen] = useState(false);

  const { data: booking, isLoading, error } = useQuery<any>({
    queryKey: ["/api/bookings", id],
    queryFn: async () => {
      const res = await fetch(`/api/bookings/${id}`);
      if (!res.ok) throw new Error("Failed to fetch booking details");
      return res.json();
    },
    enabled: !!id,
  });

  const statusMutation = useMutation({
    mutationFn: async (status: string) => {
      const res = await apiRequest("PATCH", `/api/bookings/${id}/status`, { status });
      if (!res.ok) throw new Error("Failed to update status");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bookings", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
      toast({ title: "Status Updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  const rescheduleMutation = useMutation({
    mutationFn: async () => {
      if (!newDate || !rescheduleReason) throw new Error("Date and Reason are required");
      
      let timeToUse = newTime;
      if (!timeToUse && booking?.scheduledAt) {
        const originalDate = new Date(booking.scheduledAt);
        const hours = String(originalDate.getHours()).padStart(2, '0');
        const minutes = String(originalDate.getMinutes()).padStart(2, '0');
        timeToUse = `${hours}:${minutes}`;
      }
      
      if (!timeToUse) {
        timeToUse = "09:00"; // fallback if somehow no time is found
      }

      // Safe ISO date creation in local time
      const dateParts = newDate.split("-");
      const timeParts = timeToUse.split(":");
      const year = parseInt(dateParts[0], 10);
      const month = parseInt(dateParts[1], 10) - 1; // 0-indexed
      const day = parseInt(dateParts[2], 10);
      const hour = parseInt(timeParts[0], 10);
      const minute = parseInt(timeParts[1], 10);
      
      const localDate = new Date(year, month, day, hour, minute);
      
      if (isNaN(localDate.getTime())) {
        throw new Error("Invalid date or time value");
      }

      const scheduledAt = localDate.toISOString();
      const res = await apiRequest("PATCH", `/api/bookings/${id}/reschedule`, { 
        scheduledAt, 
        reason: rescheduleReason 
      });
      if (!res.ok) throw new Error("Failed to reschedule");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bookings", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
      toast({ title: "Booking Rescheduled" });
      setRescheduleOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  });

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground animate-pulse">Loading booking details...</div>;
  }

  if (error || !booking) {
    return (
      <div className="p-8 flex flex-col items-center justify-center text-center">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-2xl font-bold mb-2">Booking Not Found</h2>
        <p className="text-muted-foreground mb-6">The booking you're looking for doesn't exist or you don't have access.</p>
        <Button onClick={() => setLocation(backHref)}>Back to Bookings</Button>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending": return "bg-yellow-500/20 text-yellow-700";
      case "confirmed": return "bg-blue-500/20 text-blue-700";
      case "in_progress": return "bg-purple-500/20 text-purple-700";
      case "completed": return "bg-green-500/20 text-green-700";
      case "cancelled": return "bg-red-500/20 text-red-700";
      case "no_show": return "bg-orange-500/20 text-orange-700";
      case "rescheduled": return "bg-indigo-500/20 text-indigo-700";
      default: return "bg-gray-500/20 text-gray-700";
    }
  };

  const handleStatusChange = (status: string) => {
    if (status === "completed") {
      setCompleteAlertOpen(true);
      return;
    }
    statusMutation.mutate(status);
  };

  const handleReschedule = () => {
    rescheduleMutation.mutate();
  };

  const proceedToComplete = () => {
    setCompleteAlertOpen(false);
    setLocation(`/sales/new?bookingId=${booking.id}`);
  };

  const isReadOnly = booking?.status === "completed";

  const headerActions = (
    <div className="flex items-center gap-2">
      <Button variant="outline" asChild disabled={isReadOnly}>
        <Link href={isReadOnly ? "#" : `/bookings/${booking.id}/edit`}>
          <Edit className="mr-2 h-4 w-4" />
          Edit
        </Link>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button disabled={isReadOnly}>Update Status</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>Change Status To</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => handleStatusChange("confirmed")} disabled={booking.status === "confirmed"}>
            <CheckCircle2 className="mr-2 h-4 w-4 text-blue-500" /> Confirmed
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleStatusChange("in_progress")} disabled={booking.status === "in_progress"}>
            <Clock className="mr-2 h-4 w-4 text-purple-500" /> In Progress
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleStatusChange("completed")} disabled={booking.status === "completed"}>
            <CheckCircle2 className="mr-2 h-4 w-4 text-green-500" /> Completed
          </DropdownMenuItem>
          
          <DropdownMenuSeparator />
          
          <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
            <DialogTrigger asChild>
              <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                <ArrowRightLeft className="mr-2 h-4 w-4 text-indigo-500" /> Reschedule
              </DropdownMenuItem>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Reschedule Booking</DialogTitle>
                <DialogDescription>
                  Move this booking to a new date and time.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>New Date</Label>
                    <Input 
                      type="date" 
                      value={newDate} 
                      onChange={(e) => setNewDate(e.target.value)} 
                      min={new Date().toISOString().split("T")[0]}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>New Time</Label>
                    <Input 
                      type="time" 
                      value={newTime} 
                      onChange={(e) => setNewTime(e.target.value)} 
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Reason for Rescheduling</Label>
                  <Select value={rescheduleReason} onValueChange={setRescheduleReason}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a reason" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Customer Request">Customer Request</SelectItem>
                      <SelectItem value="Staff Scheduling Conflict">Staff Scheduling Conflict</SelectItem>
                      <SelectItem value="Weather / Emergency">Weather / Emergency</SelectItem>
                      <SelectItem value="Operational Delay">Operational Delay</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setRescheduleOpen(false)}>Cancel</Button>
                <Button onClick={handleReschedule} disabled={rescheduleMutation.isPending}>
                  Confirm Reschedule
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <DropdownMenuSeparator />
          
          <DropdownMenuItem onClick={() => handleStatusChange("no_show")} disabled={booking.status === "no_show"}>
            <AlertCircle className="mr-2 h-4 w-4 text-orange-500" /> No-Show
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleStatusChange("cancelled")} disabled={booking.status === "cancelled"} className="text-destructive">
            <XCircle className="mr-2 h-4 w-4" /> Cancel
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <PageContainer 
      title={`Booking Details #${booking.bookingRef}`}
      description={`${booking.type.charAt(0).toUpperCase() + booking.type.slice(1)} • Created ${safeFormat(booking.createdAt, "MMM d, yyyy")} • Status: ${booking.status.replace("_", " ").toUpperCase()}`}
      actions={headerActions}
    >
      <AlertDialog open={completeAlertOpen} onOpenChange={setCompleteAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark Booking as Completed?</AlertDialogTitle>
            <AlertDialogDescription>
              This process cannot be reversed. Proceeding will navigate you to the Point of Sale to convert this booking into a final sale and record the payment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setCompleteAlertOpen(false)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={proceedToComplete}>Proceed to Checkout</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left Column (Main Info) */}
        <div className="md:col-span-2 space-y-6">
          <BaseCard>
            <CardHeader>
              <CardTitle>Schedule Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                  <Calendar className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Scheduled Date</p>
                  <p className="font-semibold text-lg">{safeFormat(booking.scheduledAt, "EEEE, MMMM d, yyyy")}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                  <Clock className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Time</p>
                  <p className="font-semibold text-lg">{safeFormat(booking.scheduledAt, "h:mm a")}</p>
                </div>
              </div>
              
              {booking.expectedReadyAt && (
                <div className="flex items-center gap-4 pt-4 border-t">
                  <div className="h-12 w-12 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-600">
                    <ShoppingBag className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Expected Ready Date (Order)</p>
                    <p className="font-semibold text-lg">{safeFormat(booking.expectedReadyAt, "EEEE, MMMM d, yyyy")}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </BaseCard>

          <BaseCard>
            <CardHeader>
              <CardTitle>Items & Services</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <div className="min-w-[600px] md:min-w-0">
                  <div className="grid grid-cols-12 gap-4 p-4 border-b bg-muted/30 font-medium text-sm text-muted-foreground">
                    <div className="col-span-6">Item</div>
                    <div className="col-span-2 text-center">Qty</div>
                    <div className="col-span-2 text-right">Price</div>
                    <div className="col-span-2 text-right">Total</div>
                  </div>
                  <div className="divide-y">
                    {booking.items?.map((item: any) => (
                      <div key={item.id} className="grid grid-cols-12 gap-4 p-4 items-center">
                        <div className="col-span-6">
                          {item.inventory?.id ? (
                            <EntityLink href={`/inventory/${buildSlug(item.inventory.name, item.inventory.id)}`}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <p className="font-medium truncate">{item.inventory.name}</p>
                                </TooltipTrigger>
                                <TooltipContent>{item.inventory.name}</TooltipContent>
                              </Tooltip>
                            </EntityLink>
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <p className="font-medium truncate">{item.inventory?.name || "Unknown Item"}</p>
                              </TooltipTrigger>
                              <TooltipContent>{item.inventory?.name || "Unknown Item"}</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                        <div className="col-span-2 text-center">{item.quantity}</div>
                        <div className="col-span-2 text-right">₦{item.unitPrice?.toLocaleString()}</div>
                        <div className="col-span-2 text-right font-semibold">₦{item.totalPrice?.toLocaleString()}</div>
                      </div>
                    ))}
                  </div>
                  <div className="p-4 bg-muted/10 space-y-2 border-t text-sm">
                    <div className="flex justify-between items-center text-muted-foreground">
                      <p>Subtotal:</p>
                      <p>₦{(booking.subtotal || booking.items?.reduce((acc: number, item: any) => acc + item.totalPrice, 0)).toLocaleString()}</p>
                    </div>
                    {booking.discountAmount > 0 && (
                      <div className="flex justify-between items-center text-green-600">
                        <p>Discount {booking.discountPercent > 0 ? `(${booking.discountPercent}%)` : ""}:</p>
                        <p>-₦{booking.discountAmount.toLocaleString()}</p>
                      </div>
                    )}
                    <div className="flex justify-between items-center pt-2 border-t">
                      <p className="font-medium">Total Price:</p>
                      <p className="text-xl font-bold">
                        ₦{(booking.totalPrice || booking.items?.reduce((acc: number, item: any) => acc + item.totalPrice, 0)).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </BaseCard>

          {booking.rescheduleHistory && booking.rescheduleHistory.length > 0 && (
            <BaseCard>
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Clock className="h-4 w-4" /> Reschedule History
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-muted before:to-transparent">
                  {booking.rescheduleHistory.map((history: any, i: number) => (
                    <div key={i} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                      <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white bg-muted text-muted-foreground shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2">
                        <ArrowRightLeft className="h-4 w-4" />
                      </div>
                      <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded border bg-card shadow">
                        <div className="flex items-center justify-between mb-1">
                          <div className="font-medium text-sm text-primary">Moved to {safeFormat(history.newDate, "MMM d, yyyy")}</div>
                          <time className="text-xs text-muted-foreground">{safeFormat(history.timestamp, "MMM d")}</time>
                        </div>
                        <div className="text-xs text-muted-foreground">Reason: {history.reason}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </BaseCard>
          )}
        </div>

        {/* Right Column (Sidebar) */}
        <div className="space-y-6">
          <BaseCard>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                <User className="h-4 w-4" /> Customer Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3 mb-4">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                  {booking.customer?.name?.charAt(0) || "C"}
                </div>
                <div>
                  <p className="font-semibold">{booking.customer?.name || "Unknown Customer"}</p>
                  <p className="text-sm text-muted-foreground">{booking.customer?.mobileNumber}</p>
                </div>
              </div>
              <Button variant="outline" className="w-full" asChild>
                <EntityLink href={`/customers/${booking.customerId}`}>View Profile</EntityLink>
              </Button>
            </CardContent>
          </BaseCard>

          <BaseCard>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                <UserCog className="h-4 w-4" /> Assigned Staff
              </CardTitle>
            </CardHeader>
            <CardContent>
              {booking.leadStaff ? (
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center font-bold">
                    {booking.leadStaff.name?.charAt(0)}
                  </div>
                  <div>
                    {booking.leadStaff.id ? (
                      <EntityLink href={`/staffs/${booking.leadStaff.id}/edit`} className="font-medium">
                        {booking.leadStaff.name}
                      </EntityLink>
                    ) : (
                      <p className="font-medium">{booking.leadStaff.name}</p>
                    )}
                    <p className="text-xs text-muted-foreground capitalize">{booking.leadStaff.role}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">No staff assigned</p>
              )}
            </CardContent>
          </BaseCard>

          <BaseCard>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                <CreditCard className="h-4 w-4" /> Payment Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Deposit Paid</span>
                <span className="font-semibold text-green-600">₦{booking.depositAmount?.toLocaleString() || 0}</span>
              </div>
              {booking.depositAmount > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Payment Method</span>
                  <Badge variant="outline" className="capitalize">{booking.depositPaymentMethod}</Badge>
                </div>
              )}
            </CardContent>
          </BaseCard>

          <BaseCard>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                <MessageSquare className="h-4 w-4" /> Reminders & Notes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Reminder Preference</p>
                <Badge variant="secondary" className="capitalize">{booking.reminderPreference}</Badge>
              </div>
              <Separator />
              <div>
                <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                  <FileText className="h-3 w-3" /> Booking Notes
                </p>
                <p className="text-sm mt-1 whitespace-pre-wrap">
                  {booking.notes || <span className="italic text-muted-foreground">No notes provided.</span>}
                </p>
              </div>
            </CardContent>
          </BaseCard>
        </div>
      </div>
    </PageContainer>
  );
}
