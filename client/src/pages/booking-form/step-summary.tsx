import { useState, useEffect } from "react";
import { UseFormReturn } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Percent, CreditCard, CheckCircle, Loader2 } from "lucide-react";

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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

import { useStore } from "@/lib/store-context";
import type { Customer, Staff, Inventory } from "@shared/schema";
import { BookingFormValues } from "./types";
import { cn } from "@/lib/utils";

interface StepSummaryProps {
  form: UseFormReturn<BookingFormValues>;
  onBack: () => void;
  isSubmitting: boolean;
}

export function StepSummary({ form, onBack, isSubmitting }: StepSummaryProps) {
  const { currentStore } = useStore();

  const [applyDiscount, setApplyDiscount] = useState(false);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [discountReason, setDiscountReason] = useState("");

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers", currentStore?.id],
    enabled: !!currentStore?.id,
  });
  const { data: staff = [] } = useQuery<Staff[]>({
    queryKey: ["/api/staff", currentStore?.id],
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
  const finalTotal = applyDiscount ? Math.max(0, subtotal - discountAmount) : subtotal;
  const depositAmount = Number(values.depositAmount) || 0;
  const outstanding = Math.max(0, finalTotal - depositAmount);

  useEffect(() => {
    if (applyDiscount && discountPercent > 0) {
      setDiscountAmount(subtotal * (discountPercent / 100));
    }
  }, [subtotal, discountPercent, applyDiscount]);

  // Sync discount values into form before submit
  useEffect(() => {
    form.setValue("discountAmount", applyDiscount ? discountAmount : 0);
    form.setValue("discountPercent", applyDiscount ? discountPercent : 0);
    form.setValue("discountReason", applyDiscount ? discountReason : "");
    form.setValue("totalPrice", finalTotal);
    form.setValue("subtotal", subtotal);
  }, [applyDiscount, discountAmount, discountPercent, discountReason, finalTotal, subtotal]);

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

  const typeLabel = values.type === "appointment" ? "Service Appointment" : "Product Pre-Order";

  return (
    <div className="space-y-6">
      {/* Booking Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-primary" />
            Booking Summary
          </CardTitle>
          <CardDescription>Review the details before confirming.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Type + Customer */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">Type</p>
              <Badge variant="secondary">{typeLabel}</Badge>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">Customer</p>
              <p className="font-semibold">{selectedCustomer?.name ?? "—"}</p>
              {selectedCustomer?.mobileNumber && (
                <p className="text-xs text-muted-foreground">{selectedCustomer.mobileNumber}</p>
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">
                {values.type === "appointment" ? "Date & Time" : "Order Date"}
              </p>
              <p className="font-semibold">
                {values.scheduledAt ? format(values.scheduledAt, "PPP") : "—"}
                {values.type === "appointment" && values.time ? ` at ${values.time}` : ""}
              </p>
            </div>
            {values.type === "appointment" && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">Staff</p>
                <p className="font-semibold">{selectedStaff?.name ?? "Unassigned"}</p>
              </div>
            )}
          </div>

          <Separator />

          {/* Items */}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Items / Services</p>
            {(values.bookingItems || []).map((item, i) => {
              const inv = inventory.find((x) => x.id === item.inventoryId);
              return (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span>{inv?.name ?? item.inventoryId}</span>
                  <span className="text-muted-foreground">
                    {item.quantity} × ₦{Number(item.unitPrice).toLocaleString()} ={" "}
                    <span className="font-medium text-foreground">
                      ₦{(Number(item.quantity) * Number(item.unitPrice)).toLocaleString()}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Discount */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Percent className="h-5 w-5 text-primary" />
            Discount
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Apply Discount</p>
              <p className="text-xs text-muted-foreground">Reduce the booking total</p>
            </div>
            <Switch
              id="booking-discount-toggle"
              checked={applyDiscount}
              onCheckedChange={handleDiscountToggle}
            />
          </div>

          {applyDiscount && (
            <div className="space-y-4 pt-2 border-t animate-in fade-in duration-200">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="discount-amount" className="text-xs text-muted-foreground">Amount (₦)</Label>
                  <Input
                    id="discount-amount"
                    type="number"
                    min="0"
                    placeholder="0"
                    value={discountAmount === 0 ? "0" : discountAmount || ""}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setDiscountAmount(val);
                      if (subtotal > 0) setDiscountPercent(Math.min(100, (val / subtotal) * 100));
                    }}
                    className="h-8"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="discount-percent" className="text-xs text-muted-foreground">Percent (%)</Label>
                  <Input
                    id="discount-percent"
                    type="number"
                    min="0"
                    max="100"
                    placeholder="0"
                    value={discountPercent === 0 ? "0" : discountPercent || ""}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setDiscountPercent(val);
                      setDiscountAmount(subtotal * (val / 100));
                    }}
                    className="h-8"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="discount-reason" className="text-xs text-muted-foreground">Reason for Discount</Label>
                <Select value={discountReason} onValueChange={setDiscountReason}>
                  <SelectTrigger id="discount-reason" className="h-8">
                    <SelectValue placeholder="Select reason" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="loyalty">Customer Loyalty</SelectItem>
                    <SelectItem value="promo">Promotional Event</SelectItem>
                    <SelectItem value="apology">Service Apology</SelectItem>
                    <SelectItem value="staff_perk">Staff / Family Perk</SelectItem>
                    <SelectItem value="custom">Custom (Requires Approval)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Deposit & Totals */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            Payment
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span>₦{subtotal.toLocaleString()}</span>
          </div>
          {applyDiscount && discountAmount > 0 && (
            <div className="flex justify-between text-sm text-emerald-600">
              <span>Discount</span>
              <span>-₦{discountAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
            </div>
          )}
          <Separator />
          <div className="flex justify-between font-semibold text-lg">
            <span>Total</span>
            <span>₦{finalTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="depositAmount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Deposit Paid (₦)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="0"
                      placeholder="0"
                      id="booking-deposit-amount"
                      value={field.value === 0 ? "0" : field.value ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        let clean = val;
                        if (/^0\d+/.test(val)) clean = val.replace(/^0+/, "");
                        field.onChange(clean === "" ? 0 : parseFloat(clean) || 0);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="depositPaymentMethod"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Deposit Method</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger id="booking-deposit-method">
                        <SelectValue placeholder="Method" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="transfer">Bank Transfer</SelectItem>
                      <SelectItem value="pos">POS</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div
            className={cn(
              "flex justify-between items-center rounded-lg px-4 py-3 text-sm font-medium",
              outstanding > 0
                ? "bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-900"
                : "bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900"
            )}
          >
            <span className={outstanding > 0 ? "text-orange-700 dark:text-orange-400" : "text-emerald-700 dark:text-emerald-400"}>
              Outstanding Balance
            </span>
            <span className={outstanding > 0 ? "text-orange-700 dark:text-orange-400 text-lg font-bold" : "text-emerald-700 dark:text-emerald-400 text-lg font-bold"}>
              {outstanding > 0 ? `₦${outstanding.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "Fully Paid ✓"}
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-between gap-3">
        <Button type="button" variant="outline" onClick={onBack} id="booking-back-step-4" disabled={isSubmitting}>
          ← Back
        </Button>
        <Button
          type="submit"
          id="booking-submit-btn"
          disabled={isSubmitting}
          className="min-w-[160px] h-12 text-base"
        >
          {isSubmitting ? (
            <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Creating...</>
          ) : (
            <><CheckCircle className="mr-2 h-5 w-5" /> Confirm Booking</>
          )}
        </Button>
      </div>
    </div>
  );
}
