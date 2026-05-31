import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Form } from "@/components/ui/form";
import { PageHeader } from "@/components/page-header";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { ConsolidatedFallbackAlert } from "@/components/oop-ui/ConsolidatedFallbackAlert";
import { Loader2 } from "lucide-react";

import { useStore } from "@/lib/store-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

import { WizardProgress } from "./wizard-progress";
import { StepCustomer } from "./step-customer";
import { StepItems } from "./step-items";
import { StepSchedule } from "./step-schedule";
import { StepSummary } from "./step-summary";
import { bookingFormSchema, BookingFormValues, WizardStep } from "./types";

export default function BookingFormPage() {
  const { id } = useParams();
  const isEditing = !!id;
  const [, setLocation] = useLocation();
  const { currentStore } = useStore();
  const { toast } = useToast();

  const [currentStep, setCurrentStep] = useState<WizardStep>("customer");
  const [completedSteps, setCompletedSteps] = useState<Set<WizardStep>>(new Set());

  const form = useForm<BookingFormValues>({
    resolver: zodResolver(bookingFormSchema),
    defaultValues: {
      type: "appointment",
      depositAmount: 0,
      depositPaymentMethod: "cash",
      reminderPreference: "whatsapp",
      bookingItems: [{ inventoryId: "", quantity: 1, unitPrice: 0 }],
      notes: "",
      subtotal: 0,
      discountAmount: 0,
      discountPercent: 0,
      totalPrice: 0,
    },
  });

  // Load existing booking data when editing
  const { data: existingBooking, isLoading: isLoadingBooking } = useQuery<any>({
    queryKey: ["/api/bookings", id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/bookings/${id}`);
      if (!res.ok) throw new Error("Booking not found");
      return res.json();
    },
    enabled: isEditing,
  });

  // Pre-populate form once existing booking data arrives
  useEffect(() => {
    if (!existingBooking) return;
    const scheduledDate = new Date(existingBooking.scheduledAt);
    form.reset({
      type: existingBooking.type,
      customerId: existingBooking.customerId,
      scheduledAt: scheduledDate,
      time: `${String(scheduledDate.getHours()).padStart(2, "0")}:${String(scheduledDate.getMinutes()).padStart(2, "0")}`,
      expectedReadyAt: existingBooking.expectedReadyAt ? new Date(existingBooking.expectedReadyAt) : undefined,
      leadStaffId: existingBooking.leadStaffId ?? "unassigned",
      depositAmount: Number(existingBooking.depositAmount ?? 0),
      depositPaymentMethod: existingBooking.depositPaymentMethod ?? "cash",
      subtotal: Number(existingBooking.subtotal ?? 0),
      discountAmount: Number(existingBooking.discountAmount ?? 0),
      discountPercent: Number(existingBooking.discountPercent ?? 0),
      discountReason: existingBooking.discountReason ?? "",
      discountApprovedBy: existingBooking.discountApprovedBy ?? "",
      totalPrice: Number(existingBooking.totalPrice ?? 0),
      reminderPreference: existingBooking.reminderPreference ?? "whatsapp",
      notes: existingBooking.notes ?? "",
      bookingItems: (existingBooking.items ?? []).map((item: any) => ({
        inventoryId: item.inventoryId,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
      })),
    });
    // Mark all previous steps complete so the user can navigate freely
    setCompletedSteps(new Set<WizardStep>(["customer", "items", "schedule"]));
    setCurrentStep("customer");
  }, [existingBooking, form]);

  const mutation = useMutation({
    mutationFn: async (values: BookingFormValues) => {
      let scheduledAt: Date = values.scheduledAt;
      if (values.type === "appointment" && values.time) {
        const [hours, minutes] = values.time.split(":");
        scheduledAt = new Date(scheduledAt);
        scheduledAt.setHours(parseInt(hours, 10), parseInt(minutes, 10));
      }

      const bookingItemsPayload = values.bookingItems.map((item) => ({
        inventoryId: item.inventoryId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.quantity * item.unitPrice,
      }));

      const payload = {
        ...(isEditing ? {} : { storeId: currentStore?.id }),
        customerId: values.customerId,
        type: values.type,
        scheduledAt: scheduledAt.toISOString(),
        expectedReadyAt: values.type === "order" && values.expectedReadyAt
          ? values.expectedReadyAt.toISOString()
          : undefined,
        leadStaffId: values.leadStaffId === "unassigned" ? undefined : values.leadStaffId,
        depositAmount: values.depositAmount,
        depositPaymentMethod: values.depositPaymentMethod,
        subtotal: values.subtotal,
        discountAmount: values.discountAmount,
        discountPercent: values.discountPercent,
        discountReason: values.discountReason,
        discountApprovedBy: values.discountApprovedBy,
        totalPrice: values.totalPrice,
        reminderPreference: values.reminderPreference,
        notes: values.notes,
        bookingItems: bookingItemsPayload,
      };

      const res = isEditing
        ? await apiRequest("PATCH", `/api/bookings/${id}`, payload)
        : await apiRequest("POST", "/api/bookings", { ...payload, storeId: currentStore?.id });

      if (!res.ok) {
        const error = await res.json();
        const msg = error.error?.message ?? error.error ?? (isEditing ? "Failed to update booking" : "Failed to create booking");
        throw new Error(typeof msg === "string" ? msg : "Operation failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bookings"] });
      toast({
        title: isEditing ? "Booking Updated" : "Booking Created",
        description: isEditing ? "Your changes have been saved." : "The booking has been successfully created.",
      });
      setLocation(isEditing ? `/bookings/${id}` : "/bookings");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const markComplete = (step: WizardStep) => {
    setCompletedSteps((prev) => { const next = new Set(prev); next.add(step); return next; });
  };

  const goNext = (from: WizardStep, to: WizardStep) => {
    markComplete(from);
    setCurrentStep(to);
  };

  const goBack = (to: WizardStep) => {
    setCurrentStep(to);
  };

  const onSubmit = (values: BookingFormValues) => {
    mutation.mutate(values);
  };

  if (isEditing && isLoadingBooking) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={isEditing ? "Edit Booking" : "New Booking"}
          description="Schedule an appointment or product pre-order"
        />
        <StoreRequiredAlert title="Store Required for Bookings" />
      </div>
    );
  }

  if (currentStore.id === "all") {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <PageHeader
          title={isEditing ? "Edit Booking" : "New Booking"}
          description="Schedule an appointment or product pre-order"
        />
        <ConsolidatedFallbackAlert pageTitle="Appointment & Order Bookings" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader
        title={isEditing ? "Edit Booking" : "New Booking"}
        description="Schedule an appointment or product pre-order"
      />

      <WizardProgress
        currentStep={currentStep}
        completedSteps={completedSteps}
        onStepClick={(step) => {
          if (completedSteps.has(step) || step === currentStep) setCurrentStep(step);
        }}
      />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          {currentStep === "customer" && (
            <StepCustomer
              form={form}
              onNext={() => goNext("customer", "items")}
            />
          )}
          {currentStep === "items" && (
            <StepItems
              form={form}
              onBack={() => goBack("customer")}
              onNext={() => goNext("items", "schedule")}
            />
          )}
          {currentStep === "schedule" && (
            <StepSchedule
              form={form}
              onBack={() => goBack("items")}
              onNext={() => goNext("schedule", "summary")}
            />
          )}
          {currentStep === "summary" && (
            <StepSummary
              form={form}
              onBack={() => goBack("schedule")}
              isSubmitting={mutation.isPending}
            />
          )}
        </form>
      </Form>
    </div>
  );
}
