import { UseFormReturn } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Loader2 } from "lucide-react";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store-context";
import type { Customer } from "@shared/schema";
import { BookingFormValues } from "./types";

interface BookingSidebarProps {
  form: UseFormReturn<BookingFormValues>;
  nextLabel: string;
  onNext: () => void;
  onBack?: () => void;
  backLabel?: string;
  isSubmitting?: boolean;
}

export function BookingSidebar({ form, nextLabel, onNext, onBack, backLabel, isSubmitting }: BookingSidebarProps) {
  const { currentStore } = useStore();
  const values = form.watch();

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers", currentStore?.id],
    enabled: !!currentStore?.id,
  });
  const selectedCustomer = customers.find((c) => c.id === values.customerId);

  const subtotal = (values.bookingItems || []).reduce(
    (acc, item) => acc + Number(item.quantity || 0) * Number(item.unitPrice || 0),
    0
  );
  const itemCount = (values.bookingItems || []).filter((i) => i.inventoryId).length;

  const whenLabel = values.scheduledAt
    ? `${format(values.scheduledAt, "EEE d MMM")}${values.type === "appointment" && values.time ? ` · ${values.time}` : ""}`
    : "Next step";

  return (
    <aside
      aria-label="Booking summary"
      className="w-full lg:w-[340px] flex-shrink-0 rounded-xl border bg-card p-5 flex flex-col gap-4 lg:sticky lg:top-6 h-fit"
    >
      <h2 className="text-base font-bold">Booking summary</h2>
      <dl className="flex flex-col gap-3 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Type</dt>
          <dd className="font-semibold text-right">
            {values.type === "order" ? "Product pre-order" : "Service appointment"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Customer</dt>
          <dd className="font-semibold text-right truncate max-w-[180px]">
            {selectedCustomer?.name ?? "Not selected"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Items</dt>
          <dd className={itemCount ? "font-semibold" : "text-muted-foreground"}>
            {itemCount ? `${itemCount} item${itemCount === 1 ? "" : "s"}` : "Next step"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Date &amp; time</dt>
          <dd className={values.scheduledAt ? "font-semibold text-right" : "text-muted-foreground"}>{whenLabel}</dd>
        </div>
      </dl>

      {subtotal > 0 && (
        <div className="border-t border-dashed pt-4 flex items-baseline justify-between">
          <span className="text-sm font-semibold">Subtotal</span>
          <span className="text-2xl font-bold tabular-nums tracking-tight">
            ₦{subtotal.toLocaleString()}
          </span>
        </div>
      )}

      <Button type="button" onClick={onNext} disabled={isSubmitting} className="h-12 text-base font-bold gap-2">
        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {nextLabel}
        {!isSubmitting && <ArrowRight className="h-4 w-4" />}
      </Button>
      {onBack && (
        <Button type="button" variant="outline" onClick={onBack} disabled={isSubmitting} className="h-11">
          {backLabel ?? "Back"}
        </Button>
      )}
    </aside>
  );
}
