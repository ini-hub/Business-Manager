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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

import { useStore } from "@/lib/store-context";
import type { Staff } from "@shared/schema";
import { StaffPresenter, EntityDisplay } from "@/components/oop-ui/EntityDisplayPresenter";
import { cn } from "@/lib/utils";
import { BookingFormValues } from "./types";

interface StepScheduleProps {
  form: UseFormReturn<BookingFormValues>;
  onBack: () => void;
  onNext: () => void;
}

export function StepSchedule({ form, onBack, onNext }: StepScheduleProps) {
  const { currentStore } = useStore();
  const [staffOpen, setStaffOpen] = useState(false);

  const watchType = form.watch("type");

  const { data: staff = [] } = useQuery<Staff[]>({
    queryKey: ["/api/staff", currentStore?.id],
    enabled: !!currentStore?.id,
  });

  const handleNext = async () => {
    const fieldsToValidate: (keyof BookingFormValues)[] = ["scheduledAt", "reminderPreference"];
    if (watchType === "appointment") fieldsToValidate.push("time" as any);
    const valid = await form.trigger(fieldsToValidate);
    if (valid) onNext();
  };

  return (
    <div className="space-y-6">
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
                <FormLabel>Reminder Preference</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger id="booking-reminder-select">
                      <SelectValue placeholder="Select reminder preference" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                    <SelectItem value="both">Both</SelectItem>
                    <SelectItem value="none">None</SelectItem>
                  </SelectContent>
                </Select>
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

      <div className="flex justify-between gap-3">
        <Button type="button" variant="outline" onClick={onBack} id="booking-back-step-3">
          ← Back
        </Button>
        <Button type="button" onClick={handleNext} id="booking-next-step-3" className="min-w-[140px]">
          Next: Payment →
        </Button>
      </div>
    </div>
  );
}
