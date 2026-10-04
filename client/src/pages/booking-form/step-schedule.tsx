import { useState } from "react";
import { UseFormReturn } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarIcon, Clock, Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

import { useStore } from "@/lib/store-context";
import type { Staff } from "@shared/schema";
import { StaffPresenter, EntityDisplay } from "@/components/oop-ui/EntityDisplayPresenter";
import { cn } from "@/lib/utils";
import { BookingFormValues } from "./types";
import { SegmentedControl } from "./segmented-control";
import { fetchAllStaff } from "@/lib/staff-api";

interface StepScheduleProps {
  form: UseFormReturn<BookingFormValues>;
  excludeBookingId?: string;
}

const ACTIVE_STATUSES = ["pending", "confirmed", "in_progress"];

function UpcomingStaffBookings({ storeId, staffId, excludeBookingId }: { storeId: string; staffId: string; excludeBookingId?: string }) {
  const { data, isLoading } = useQuery<{ data: any[] }>({
    queryKey: ["/api/bookings", storeId, "staff-upcoming", staffId],
    queryFn: async () => {
      const params = new URLSearchParams({
        storeId,
        staffId,
        status: ACTIVE_STATUSES.join(","),
        startDate: format(new Date(), "yyyy-MM-dd"),
        limit: "100",
      });
      const res = await fetch(`/api/bookings?${params}`);
      if (!res.ok) throw new Error("Failed to fetch staff bookings");
      return res.json();
    },
  });

  const now = Date.now();
  const upcoming = (data?.data ?? [])
    .filter((b) => b.id !== excludeBookingId && new Date(b.scheduledAt).getTime() >= now)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  return (
    <div className="rounded-md border bg-muted/30 p-3 text-sm" id="staff-upcoming-bookings">
      <div className="mb-2 font-medium">Upcoming bookings for this staff ({upcoming.length})</div>
      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : upcoming.length === 0 ? (
        <p className="text-muted-foreground">No upcoming bookings. This staff member is free.</p>
      ) : (
        <ul className="max-h-48 space-y-2 overflow-y-auto">
          {upcoming.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-2">
              <span>{format(new Date(b.scheduledAt), "EEE, d MMM · h:mm a")}</span>
              <span className="truncate text-muted-foreground">
                {b.customer?.name ?? b.bookingRef} · {b.bookingRef}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function StepSchedule({ form, excludeBookingId }: StepScheduleProps) {
  const { currentStore } = useStore();
  const [staffOpen, setStaffOpen] = useState(false);

  const watchType = form.watch("type");

  const { data: staff = [] } = useQuery<Staff[]>({
    queryKey: ["/api/staff", currentStore?.id],
    queryFn: () => fetchAllStaff(currentStore!.id),
    enabled: !!currentStore?.id,
  });

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5 text-primary" />
            Schedule
          </CardTitle>
          <CardDescription>
            {watchType === "appointment"
              ? "Set the appointment date, time, and assigned staff member."
              : "Set the order date and expected ready/delivery date."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* Date picker */}
            <FormField
              control={form.control}
              name="scheduledAt"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>
                    {watchType === "appointment" ? "Appointment Date" : "Order Date"}
                  </FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          id="booking-date-btn"
                          className={cn(
                            "w-full pl-3 text-left font-normal",
                            !field.value && "text-muted-foreground"
                          )}
                        >
                          {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value}
                        onSelect={field.onChange}
                        disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Time or delivery date */}
            {watchType === "appointment" ? (
              <FormField
                control={form.control}
                name="time"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" /> Time
                    </FormLabel>
                    <FormControl>
                      <Input type="time" id="booking-time-input" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <FormField
                control={form.control}
                name="expectedReadyAt"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Expected Ready / Delivery Date</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            id="booking-delivery-date-btn"
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </div>

          {/* Staff Assignment (appointments only) */}
          {watchType === "appointment" && (
            <FormField
              control={form.control}
              name="leadStaffId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Assigned Staff <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                  <Popover open={staffOpen} onOpenChange={setStaffOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        id="booking-staff-btn"
                        className={cn(
                          "w-full justify-between font-normal",
                          !field.value && "text-muted-foreground"
                        )}
                      >
                        {field.value && field.value !== "unassigned"
                          ? staff.find((s) => s.id === field.value)?.name
                          : "Select staff member..."}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[300px] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search staff..." />
                        <CommandList>
                          <CommandEmpty>No staff member found.</CommandEmpty>
                          <CommandGroup>
                            <CommandItem
                              value="unassigned"
                              onSelect={() => { field.onChange("unassigned"); setStaffOpen(false); }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  field.value === "unassigned" || !field.value ? "opacity-100" : "opacity-0"
                                )}
                              />
                              <span>Unassigned</span>
                            </CommandItem>
                            {staff.filter((s) => !s.isArchived).map((s) => {
                              const presenter = new StaffPresenter(s);
                              return (
                                <CommandItem
                                  key={s.id}
                                  value={`${s.name} ${s.staffNumber}`}
                                  onSelect={() => { field.onChange(s.id); setStaffOpen(false); }}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      field.value === s.id ? "opacity-100" : "opacity-0"
                                    )}
                                  />
                                  <EntityDisplay presenter={presenter} />
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                  {field.value && field.value !== "unassigned" && currentStore?.id && currentStore.id !== "all" && (
                    <UpcomingStaffBookings
                      storeId={currentStore.id}
                      staffId={field.value}
                      excludeBookingId={excludeBookingId}
                    />
                  )}
                </FormItem>
              )}
            />
          )}

          {/* Reminder preference */}
          <FormField
            control={form.control}
            name="reminderPreference"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Send reminder by</FormLabel>
                <FormControl>
                  <SegmentedControl
                    id="booking-reminder-select"
                    aria-label="Send reminder by"
                    value={field.value}
                    onChange={field.onChange}
                    options={[
                      { value: "whatsapp", label: "WhatsApp" },
                      { value: "sms", label: "SMS" },
                      { value: "both", label: "Both" },
                      { value: "none", label: "None" },
                    ]}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Notes */}
          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Notes / Special Requests <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="E.g., special styling requirements, allergies, customer preferences..."
                    className="resize-none h-24"
                    id="booking-notes-input"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </CardContent>
      </Card>
    </div>
  );
}
