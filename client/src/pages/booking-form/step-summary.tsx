import { useState, useEffect } from "react";
import { UseFormReturn } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { CheckCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

import { useStore } from "@/lib/store-context";
import type { Customer, Staff, Inventory } from "@shared/schema";
import { BookingFormValues } from "./types";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "./segmented-control";
import { fetchAllStaff } from "@/lib/staff-api";
import { Spinner } from "@/components/ui/loader";

interface StepSummaryProps {
  form: UseFormReturn<BookingFormValues>;
  onBack: () => void;
  isSubmitting: boolean;
}

export function StepSummary({ form, onBack, isSubmitting }: StepSummaryProps) {
  const { currentStore } = useStore();

  const [applyDiscount, setApplyDiscount] = useState(false);
  const [discountType, setDiscountType] = useState<"amount" | "percent">("amount");
  const [discountAmount, setDiscountAmount] = useState(0);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [discountReason, setDiscountReason] = useState("");

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers", currentStore?.id],
    enabled: !!currentStore?.id,
  });
  const { data: staff = [] } = useQuery<Staff[]>({
    queryKey: ["/api/staff", currentStore?.id],
    queryFn: () => fetchAllStaff(currentStore!.id),
    enabled: !!currentStore?.id,
  });
  const { data: inventory = [] } = useQuery<Inventory[]>({
    queryKey: ["/api/inventory", currentStore?.id],
    enabled: !!currentStore?.id,
  });

  const values = form.watch();
  const subtotal = (values.bookingItems || []).reduce(
    (acc, item) => acc + Number(item.quantity) * Number(item.unitPrice),
    0
  );
  const discountAmt = applyDiscount ? Math.min(discountAmount, subtotal) : 0;
  const finalTotal = Math.max(0, subtotal - discountAmt);
  const depositAmount = Math.min(Number(values.depositAmount) || 0, finalTotal);
  const outstanding = Math.max(0, finalTotal - depositAmount);
  const paidInFull = outstanding === 0 && finalTotal > 0;

  useEffect(() => {
    if (applyDiscount && discountType === "percent") {
      setDiscountAmount(Math.round((subtotal * Math.min(discountPercent, 100)) / 100));
    }
  }, [subtotal, discountPercent, discountType, applyDiscount]);

  // Sync discount + totals into form before submit
  useEffect(() => {
    form.setValue("discountAmount", discountAmt);
    form.setValue("discountPercent", applyDiscount && discountType === "percent" ? discountPercent : 0);
    form.setValue("discountReason", applyDiscount ? discountReason : "");
    form.setValue("totalPrice", finalTotal);
    form.setValue("subtotal", subtotal);
  }, [discountAmt, applyDiscount, discountType, discountPercent, discountReason, finalTotal, subtotal]);

  const handleDiscountToggle = (checked: boolean) => {
    setApplyDiscount(checked);
    if (!checked) {
      setDiscountAmount(0);
      setDiscountPercent(0);
      setDiscountReason("");
    }
  };

  const selectedCustomer = customers.find((c) => c.id === values.customerId);
  const selectedStaff = staff.find((s) => s.id === values.leadStaffId);
  const typeLabel = values.type === "appointment" ? "Service appointment" : "Product pre-order";

  const quickDeposits = [
    { label: "None", val: 0 },
    { label: "Half", val: Math.round(finalTotal / 2) },
    { label: "Full", val: finalTotal },
  ];

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start">
      {/* Review booking */}
      <section aria-labelledby="rev-h" className="flex-grow min-w-0 rounded-xl border bg-card flex flex-col">
        <div className="px-6 pt-5 pb-4 border-b">
          <h2 id="rev-h" className="text-lg font-bold">Review booking</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Check the details with the customer before you confirm.</p>
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-5 px-6 py-5 border-b">
          <div className="flex flex-col gap-2">
            <dt className="flex justify-between text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Customer <button type="button" onClick={onBack} className="normal-case font-normal text-primary hover:underline">Edit</button>
            </dt>
            <dd className="flex items-center gap-3">
              <span className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0">
                {selectedCustomer?.name?.charAt(0).toUpperCase() ?? "?"}
              </span>
              <span className="flex flex-col">
                <span className="text-sm font-bold">{selectedCustomer?.name ?? "—"}</span>
                <span className="text-xs text-muted-foreground">
                  {selectedCustomer?.customerNumber}
                  {selectedCustomer?.mobileNumber ? ` · ${selectedCustomer.mobileNumber}` : ""}
                </span>
              </span>
            </dd>
          </div>
          <div className="flex flex-col gap-2">
            <dt className="flex justify-between text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Type <button type="button" onClick={onBack} className="normal-case font-normal text-primary hover:underline">Edit</button>
            </dt>
            <dd><Badge variant="secondary">{typeLabel}</Badge></dd>
          </div>
          <div className="flex flex-col gap-2">
            <dt className="flex justify-between text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {values.type === "appointment" ? "Date & time" : "Order date"} <button type="button" onClick={onBack} className="normal-case font-normal text-primary hover:underline">Edit</button>
            </dt>
            <dd className="text-sm font-bold">
              {values.scheduledAt ? format(values.scheduledAt, "PPP") : "—"}
              {values.type === "appointment" && values.time ? ` at ${values.time}` : ""}
            </dd>
          </div>
          {values.type === "appointment" && (
            <div className="flex flex-col gap-2">
              <dt className="flex justify-between text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Staff & reminder <button type="button" onClick={onBack} className="normal-case font-normal text-primary hover:underline">Edit</button>
              </dt>
              <dd className="text-sm font-bold">
                {selectedStaff?.name ?? "Unassigned"}{" "}
                <span className="font-medium text-muted-foreground">
                  · {values.reminderPreference === "none" ? "No reminder" : `${values.reminderPreference} reminder`}
                </span>
              </dd>
            </div>
          )}
        </dl>

        <div className="flex items-center justify-between px-6 pt-4 pb-2">
          <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Items &amp; services</span>
          <button type="button" onClick={onBack} className="text-xs font-semibold text-primary hover:underline">Edit</button>
        </div>
        <div className="flex flex-col px-6 pb-4">
          {(values.bookingItems || []).map((item, i) => {
            const inv = inventory.find((x) => x.id === item.inventoryId);
            return (
              <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-4 py-4 items-center border-t">
                <span className="text-sm font-semibold truncate">{inv?.name ?? "Item"}</span>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {item.quantity} × ₦{Number(item.unitPrice).toLocaleString()}
                </span>
                <span className="text-sm font-bold text-right tabular-nums">
                  ₦{(Number(item.quantity) * Number(item.unitPrice)).toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Payment */}
      <aside aria-labelledby="pay-h" className="w-full lg:w-[400px] flex-shrink-0 rounded-xl border bg-card p-5 flex flex-col gap-4">
        <h2 id="pay-h" className="text-lg font-bold">Payment</h2>

        <div className="flex flex-col gap-3 pb-4 border-b">
          <div className="flex items-center justify-between gap-3">
            <span className="flex flex-col">
              <Label htmlFor="booking-discount-toggle" className="text-sm font-semibold">Apply discount</Label>
              <span className="text-xs text-muted-foreground">Reduce the booking total</span>
            </span>
            <Switch id="booking-discount-toggle" checked={applyDiscount} onCheckedChange={handleDiscountToggle} />
          </div>

          {applyDiscount && (
            <div className="flex gap-2 animate-in fade-in duration-200">
              <SegmentedControl
                aria-label="Discount type"
                value={discountType}
                onChange={(v) => setDiscountType(v)}
                options={[
                  { value: "amount", label: "₦", ariaLabel: "Naira amount" },
                  { value: "percent", label: "%", ariaLabel: "Percentage" },
                ]}
              />
              <Input
                aria-label="Discount value"
                inputMode="numeric"
                value={discountType === "percent" ? discountPercent || "" : discountAmount || ""}
                placeholder="0"
                className="h-11 tabular-nums"
                onChange={(e) => {
                  const val = parseFloat(e.target.value.replace(/[^0-9]/g, "")) || 0;
                  if (discountType === "percent") setDiscountPercent(val);
                  else setDiscountAmount(val);
                }}
              />
            </div>
          )}
        </div>

        <dl className="flex flex-col gap-3">
          <div className="flex justify-between text-sm">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="tabular-nums">₦{subtotal.toLocaleString()}</dd>
          </div>
          {discountAmt > 0 && (
            <div className="flex justify-between text-sm">
              <dt className="text-muted-foreground">Discount</dt>
              <dd className="text-emerald-600 tabular-nums">−₦{discountAmt.toLocaleString()}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between pt-3 border-t border-dashed">
            <dt className="text-sm font-bold">Total</dt>
            <dd className="text-2xl font-bold tracking-tight tabular-nums">₦{finalTotal.toLocaleString()}</dd>
          </div>
        </dl>

        {applyDiscount && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="discount-reason" className="text-xs text-muted-foreground">Reason for discount</Label>
            <Select value={discountReason} onValueChange={setDiscountReason}>
              <SelectTrigger id="discount-reason" className="h-10">
                <SelectValue placeholder="Select reason" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="loyalty">Customer loyalty</SelectItem>
                <SelectItem value="promo">Promotional event</SelectItem>
                <SelectItem value="apology">Service apology</SelectItem>
                <SelectItem value="staff_perk">Staff / family perk</SelectItem>
                <SelectItem value="custom">Custom (requires approval)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <FormField
          control={form.control}
          name="depositAmount"
          render={({ field }) => (
            <FormItem className="flex flex-col gap-2">
              <Label htmlFor="booking-deposit-amount" className="text-sm font-semibold">Deposit paid now</Label>
              <div className="flex items-center h-12 border rounded-lg px-3 gap-2">
                <span className="text-sm text-muted-foreground">₦</span>
                <FormControl>
                  <input
                    id="booking-deposit-amount"
                    inputMode="numeric"
                    className="border-0 flex-grow min-w-0 text-base font-semibold outline-none bg-transparent tabular-nums"
                    value={field.value === 0 ? "0" : field.value ?? ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      let clean = val.replace(/[^0-9]/g, "");
                      if (/^0\d+/.test(clean)) clean = clean.replace(/^0+/, "");
                      field.onChange(clean === "" ? 0 : parseFloat(clean) || 0);
                    }}
                  />
                </FormControl>
              </div>
              <div className="flex gap-2">
                {quickDeposits.map((q) => {
                  const isOn = depositAmount === q.val;
                  return (
                    <button
                      key={q.label}
                      type="button"
                      onClick={() => field.onChange(q.val)}
                      className={cn(
                        "flex-grow h-10 rounded-md text-xs font-semibold border transition-colors",
                        isOn ? "border-primary bg-primary/5 text-primary" : "border-border text-foreground hover:border-primary/40"
                      )}
                    >
                      {q.label}
                    </button>
                  );
                })}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="depositPaymentMethod"
          render={({ field }) => (
            <FormItem className="flex flex-col gap-2">
              <Label className="text-sm font-semibold">Deposit method</Label>
              <FormControl>
                <SegmentedControl
                  id="booking-deposit-method"
                  aria-label="Deposit method"
                  value={field.value}
                  onChange={field.onChange}
                  options={[
                    { value: "cash", label: "Cash" },
                    { value: "transfer", label: "Transfer" },
                    { value: "pos", label: "POS" },
                  ]}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div
          role="status"
          className={cn(
            "flex items-center justify-between rounded-lg px-4 py-4 border",
            paidInFull
              ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900"
              : "bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-900"
          )}
        >
          <span className={cn("text-sm font-semibold", paidInFull ? "text-emerald-700 dark:text-emerald-400" : "text-orange-700 dark:text-orange-400")}>
            {paidInFull ? "Paid in full" : "Balance due on the day"}
          </span>
          <span className={cn("text-lg font-bold tabular-nums", paidInFull ? "text-emerald-700 dark:text-emerald-400" : "text-orange-700 dark:text-orange-400")}>
            ₦{outstanding.toLocaleString()}
          </span>
        </div>

        <Button
          type="submit"
          id="booking-submit-btn"
          disabled={isSubmitting}
          className="h-12 text-base font-bold gap-2"
        >
          {isSubmitting ? (
            <><Spinner className="h-5 w-5 animate-spin" /> Creating...</>
          ) : (
            <><CheckCircle className="h-5 w-5" /> Confirm booking</>
          )}
        </Button>
        <Button type="button" variant="outline" onClick={onBack} disabled={isSubmitting} className="h-11">
          Back to schedule
        </Button>
      </aside>
    </div>
  );
}
