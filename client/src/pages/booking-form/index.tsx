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
import { BookingSidebar } from "./booking-sidebar";
import { StepCustomer } from "./step-customer";
import { StepItems } from "./step-items";
import { StepSchedule } from "./step-schedule";
import { StepSummary } from "./step-summary";
import { bookingFormSchema, BookingFormValues, STEP_FIELDS, WizardStep, WIZARD_STEPS } from "./types";

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
        if (!isEditing && scheduledAt.getTime() < Date.now()) {
          throw new Error("The appointment time is in the past. Please choose a later time.");
        }
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

  const stepIndex = WIZARD_STEPS.findIndex((s) => s.id === currentStep);
  const nextStepId = WIZARD_STEPS[stepIndex + 1]?.id;
  const prevStepId = stepIndex > 0 ? WIZARD_STEPS[stepIndex - 1].id : undefined;

  const handleSidebarNext = async () => {
    const fields = STEP_FIELDS[currentStep];
    const valid = fields.length === 0 || (await form.trigger(fields));
    if (valid && nextStepId) goNext(currentStep, nextStepId);
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
          compact
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
          compact
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
        compact
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
          {currentStep === "summary" ? (
            <StepSummary
              form={form}
              onBack={() => goBack("schedule")}
              isSubmitting={mutation.isPending}
            />
          ) : (
            <div className="flex flex-col lg:flex-row gap-6 items-start">
              <div className="flex-grow min-w-0 flex flex-col gap-5">
                {currentStep === "customer" && <StepCustomer form={form} />}
                {currentStep === "items" && <StepItems form={form} />}
                {currentStep === "schedule" && <StepSchedule form={form} excludeBookingId={id} />}
              </div>
              <BookingSidebar
                form={form}
                nextLabel={
                  currentStep === "customer"
                    ? "Continue to items"
                    : currentStep === "items"
                    ? "Continue to schedule"
                    : "Continue to payment"
                }
                onNext={handleSidebarNext}
                onBack={prevStepId ? () => goBack(prevStepId) : undefined}
                backLabel={prevStepId ? `Back to ${WIZARD_STEPS.find((s) => s.id === prevStepId)?.label.toLowerCase()}` : undefined}
              />
            </div>
          )}
        </form>
      </Form>
    </div>
  );
}
