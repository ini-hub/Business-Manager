/**
 * ResolvePendingDialog
 *
 * Shown when a transaction's payment status is "pending".
 * Offers two resolution paths:
 *   A) Mark as Paid    — records the payment method and closes the debt
 *   B) Convert to Credit Entry — moves the amount to the credit ledger with
 *      full tracking (due date, reminders, repayments, write-off)
 *
 * Used by both the transaction detail page and the transactions list inline action.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, BookOpen, CreditCard, Calendar, StickyNote, ChevronRight, ArrowLeft } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface ResolvePendingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  // Transaction context
  checkoutId: string;
  receiptNumber: string;
  amountOwed: number;           // total outstanding
  customerId: string;
  customerName: string;
  storeId: string;
  storeCurrency?: string;

  // Called after either resolution path succeeds
  onResolved: () => void;
}

type Mode = "choose" | "mark-paid" | "convert-credit";

const PAYMENT_METHODS = [
  { value: "cash",        label: "Cash" },
  { value: "transfer",    label: "Bank Transfer" },
  { value: "pos",         label: "POS / Card" },
  { value: "flutterwave", label: "Flutterwave" },
];

export function ResolvePendingDialog({
  open, onOpenChange,
  checkoutId, receiptNumber, amountOwed, customerId, customerName, storeId, storeCurrency = "NGN",
  onResolved,
}: ResolvePendingDialogProps) {
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>("choose");

  // Mark as Paid state
  const [payMethod, setPayMethod] = useState("cash");

  // Convert to Credit state
  const [dueDate, setDueDate] = useState("");
  const [upfrontPaid, setUpfrontPaid] = useState("");
  const [notes, setNotes] = useState("");

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-NG", { style: "currency", currency: storeCurrency }).format(n);

  const outstanding = amountOwed - (parseFloat(upfrontPaid) || 0);

  // ── Mark as Paid ────────────────────────────────────────────────────────────
  const markPaidMutation = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/transactions/${checkoutId}/payment-status`, {
        paymentMethod: payMethod,
        paymentStatus: "completed",
      }),
    onSuccess: () => {
      toast({ title: "Payment recorded", description: `${receiptNumber} marked as paid via ${payMethod}.` });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      onResolved();
      handleClose();
    },
    onError: (e: Error) => toast({ title: "Failed to update payment", description: e.message, variant: "destructive" }),
  });

  // ── Convert to Credit Entry ──────────────────────────────────────────────
  const convertCreditMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/credit/entries", {
        storeId,
        customerId,
        amountOwed,
        amountPaidUpfront: parseFloat(upfrontPaid) || 0,
        dueDate: dueDate || undefined,
        description: `Converted from pending transaction ${receiptNumber}`,
        notes: notes || undefined,
        linkedTransactionId: checkoutId,
      }),
    onSuccess: () => {
      toast({
        title: "Credit entry created",
        description: `${receiptNumber} moved to Credit Sales. ${outstanding > 0 ? `${fmt(outstanding)} outstanding.` : "Fully settled."}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/credit/ledger"] });
      queryClient.invalidateQueries({ queryKey: ["/api/credit/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      onResolved();
      handleClose();
    },
    onError: (e: Error) => toast({ title: "Failed to create credit entry", description: e.message, variant: "destructive" }),
  });

  const handleClose = () => {
    setMode("choose");
    setPayMethod("cash");
    setDueDate("");
    setUpfrontPaid("");
    setNotes("");
    onOpenChange(false);
  };

  const isPending = markPaidMutation.isPending || convertCreditMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !isPending) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode !== "choose" && (
              <Button variant="ghost" size="icon" className="h-7 w-7 -ml-1 mr-1" onClick={() => setMode("choose")} disabled={isPending}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            {mode === "choose" && "Resolve Pending Payment"}
            {mode === "mark-paid" && "Mark as Paid"}
            {mode === "convert-credit" && "Convert to Credit Entry"}
          </DialogTitle>
          <DialogDescription>
            <span className="font-mono font-semibold">{receiptNumber}</span>
            {" · "}
            <span className="font-medium text-foreground">{fmt(amountOwed)}</span>
            {" owing from "}
            <span className="font-medium text-foreground">{customerName}</span>
          </DialogDescription>
        </DialogHeader>

        {/* ── Choose mode ─────────────────────────────────────────────────── */}
        {mode === "choose" && (
          <div className="space-y-3 py-2">
            <button
              className="w-full flex items-start gap-4 rounded-xl border-2 border-border hover:border-emerald-400 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 p-4 text-left transition-all group"
              onClick={() => setMode("mark-paid")}
            >
              <div className="h-10 w-10 rounded-full bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center shrink-0 group-hover:bg-emerald-200 dark:group-hover:bg-emerald-900 transition-colors">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">Mark as Paid</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  Customer has paid in full. Select the payment method and close this transaction immediately.
                </p>
                <Badge variant="outline" className="text-[10px] mt-2 text-emerald-600 border-emerald-300">Closes the debt now</Badge>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 self-center" />
            </button>

            <button
              className="w-full flex items-start gap-4 rounded-xl border-2 border-border hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-950/20 p-4 text-left transition-all group"
              onClick={() => setMode("convert-credit")}
            >
              <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-950 flex items-center justify-center shrink-0 group-hover:bg-blue-200 dark:group-hover:bg-blue-900 transition-colors">
                <BookOpen className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">Convert to Credit Entry</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  Customer owes the money. Move it to the credit ledger with a due date, reminders, and partial repayment tracking.
                </p>
                <Badge variant="outline" className="text-[10px] mt-2 text-blue-600 border-blue-300">Full repayment tracking</Badge>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 self-center" />
            </button>
          </div>
        )}

        {/* ── Mark as Paid ────────────────────────────────────────────────── */}
        {mode === "mark-paid" && (
          <div className="space-y-4 py-2">
            <div className="rounded-xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/30 p-3 text-sm">
              <p className="text-emerald-800 dark:text-emerald-300 font-medium">
                Recording full payment of <span className="font-mono font-bold">{fmt(amountOwed)}</span>
              </p>
              <p className="text-xs text-emerald-700/70 dark:text-emerald-400/70 mt-0.5">
                This transaction will be marked as completed and closed.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><CreditCard className="h-3.5 w-3.5" />Payment Method</Label>
              <Select value={payMethod} onValueChange={setPayMethod}>
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map(m => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setMode("choose")} disabled={isPending}>Back</Button>
              <Button
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => markPaidMutation.mutate()}
                disabled={isPending}
              >
                {markPaidMutation.isPending ? "Recording…" : "Confirm Payment"}
              </Button>
            </div>
          </div>
        )}

        {/* ── Convert to Credit ────────────────────────────────────────────── */}
        {mode === "convert-credit" && (
          <div className="space-y-4 py-2">
            <div className="rounded-xl bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/30 p-3 text-sm">
              <p className="text-blue-800 dark:text-blue-300 font-medium">
                Moving <span className="font-mono font-bold">{fmt(amountOwed)}</span> to the credit ledger
              </p>
              <p className="text-xs text-blue-700/70 dark:text-blue-400/70 mt-0.5">
                This will appear in Credit Sales where you can track repayments and send reminders.
              </p>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs font-semibold">
                  Paid Upfront Today
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-mono">
                    {storeCurrency === "USD" ? "$" : "₦"}
                  </span>
                  <Input
                    type="number"
                    min={0}
                    max={amountOwed}
                    step="0.01"
                    placeholder="0.00"
                    value={upfrontPaid}
                    onChange={e => setUpfrontPaid(e.target.value)}
                    className="pl-8 h-11 font-mono"
                  />
                </div>
                {parseFloat(upfrontPaid) > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Outstanding after upfront: <span className="font-mono font-semibold text-foreground">{fmt(Math.max(0, outstanding))}</span>
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs font-semibold">
                  <Calendar className="h-3 w-3" />Due Date
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                  className="h-11"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs font-semibold">
                  <StickyNote className="h-3 w-3" />Notes
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  placeholder="e.g. Customer will pay balance on Friday"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="resize-none text-sm"
                  rows={2}
                />
              </div>
            </div>

            <Separator />
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setMode("choose")} disabled={isPending}>Back</Button>
              <Button
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                onClick={() => convertCreditMutation.mutate()}
                disabled={isPending || outstanding < 0}
              >
                {convertCreditMutation.isPending ? "Converting…" : "Create Credit Entry"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
