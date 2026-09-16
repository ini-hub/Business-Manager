import { useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  Calendar,
  User,
  CreditCard,
  AlertCircle,
  Printer,
  Ban,
  Edit,
  ShoppingBag,
  Loader2,
  Undo2,
  Tag,
  Plus,
  Droplet,
  History,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { BaseCard } from "@/components/oop-ui/BaseCard";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ReturnDialog } from "@/components/ReturnDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReceiptModal } from "@/components/receipt-modal";
import { ResolvePendingDialog } from "@/components/ResolvePendingDialog";
import { AddendumDialog } from "@/components/AddendumDialog";
import { LogSupplyUsageDialog } from "@/components/log-supply-usage-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useReturnTo } from "@/lib/return-to";
import { EntityLink } from "@/components/oop-ui/EntityDisplayPresenter";
import { buildSlug } from "@/lib/slug";
import { useStore } from "@/lib/store-context";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { type TransactionWithRelations, VOID_REASON_PRESETS } from "@shared/schema";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export default function TransactionDetailsPage() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { backHref } = useReturnTo("/transactions");
  const { currentStore } = useStore();
  const { user } = useAuth();
  const { toast } = useToast();

  const userRole = user?.role || "staff";
  const canManage = userRole === "manager" || userRole === "owner";
  const canEditDate = userRole === "owner";

  // Receipt Modal State
  const [receiptCheckoutId, setReceiptCheckoutId] = useState<string | null>(null);

  // Void State
  const [isVoidDialogOpen, setIsVoidDialogOpen] = useState(false);
  const [voidReason, setVoidReason] = useState<string>("");
  const [customVoidReason, setCustomVoidReason] = useState("");

  // Payment Status State
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const [editPaymentMethod, setEditPaymentMethod] = useState("");
  const [editPaymentStatus, setEditPaymentStatus] = useState("");

  // Edit Transaction Date State
  const [isEditDateDialogOpen, setIsEditDateDialogOpen] = useState(false);
  const [editTransactionDate, setEditTransactionDate] = useState("");

  // Resolve Pending Dialog
  const [isResolvePendingOpen, setIsResolvePendingOpen] = useState(false);

  // Addendum Dialog State
  const [isAddendumOpen, setIsAddendumOpen] = useState(false);

  // Log Supply Usage Dialog State — which order line it's being logged against
  const [logUsageTarget, setLogUsageTarget] = useState<{ orderId: string; serviceName: string } | null>(null);

  // Return Dialog State
  const [isReturnDialogOpen, setIsReturnDialogOpen] = useState(false);
  // Track return success to block re-opening until data is fresh
  const [isRefreshingAfterReturn, setIsRefreshingAfterReturn] = useState(false);

  // Details/Activity tab — controlled so the header's history icon can jump straight
  // to Activity instead of only being reachable via the TabsList.
  const [detailTab, setDetailTab] = useState<"details" | "activity">("details");

  const storeCurrency = currentStore?.currency || "NGN";

  const formatCurrency = (value: number, currency: string = storeCurrency) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
    }).format(value);
  };

  const formatDate = (date: string | Date) => {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(date));
  };

  const { data: transaction, isLoading } = useQuery<TransactionWithRelations | null>({
    queryKey: ["/api/transactions", id],
    queryFn: async () => {
      const res = await fetch(`/api/transactions/${id}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch transaction");
      return res.json();
    },
    enabled: !!id,
  });

  const isVoided = transaction?.checkout?.isVoided ?? false;
  const checkoutId = transaction?.checkout?.id;

  // Fetch full checkout receipt details (which includes all items and returns history)
  const { data: receiptDetails, isLoading: isReceiptLoading } = useQuery<any>({
    queryKey: [`/api/transactions/${checkoutId}/receipt`],
    enabled: !!checkoutId,
  });

  // Activity tab — owner/manager only, mirrors the requireRole("owner", "manager") gate on GET /api/audit-logs
  const canViewActivity = userRole === "manager" || userRole === "owner";
  const { data: activityData, isLoading: isActivityLoading } = useQuery<{ logs: any[] }>({
    queryKey: ["/api/audit-logs", "checkout", checkoutId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/audit-logs?resource=checkout&resourceId=${checkoutId}`);
      return res.json();
    },
    enabled: !!checkoutId && canViewActivity,
  });
  const activityLogs = activityData?.logs ?? [];

  // Basket total = sum of each line's totalCharged (the per-line post-discount amount),
  // net of whatever's been refunded on each line (order.refundedAmount is now
  // tax/discount-inclusive, matching totalCharged's basis).
  // DO NOT use primaryCheckout.totalCharged — it is only this one checkout's line amount.
  // primaryCheckout.subtotal IS the basket pre-discount total (stored on every checkout row).
  const receiptTotal =
    receiptDetails?.items?.length > 0
      ? Math.max(0, receiptDetails.items.reduce(
          (sum: number, item: any) =>
            sum + Number(item.checkout?.totalCharged || item.checkout?.totalPrice || 0) - Number(item.order?.refundedAmount || 0),
          0
        ))
      : Number(transaction?.amount || 0);

  // Pre-discount basket total is stored directly on the primary checkout row
  const receiptSubtotal =
    Number(receiptDetails?.checkout?.subtotal) > 0
      ? Number(receiptDetails.checkout.subtotal)
      : receiptTotal;
  const receiptDiscount = receiptDetails?.checkout?.discountAmount ?? 0;
  const receiptDiscountPct = receiptDetails?.checkout?.discountPercent ?? 0;
  const receiptDiscountReason = receiptDetails?.checkout?.discountReason ?? "";
  const hasDiscount = receiptDiscount > 0;

  // Total refunded across every return event on this receipt — receiptTotal is already net
  // of this, so gross-charged (what the customer originally paid before any returns) is
  // receiptTotal + totalRefundedAll.
  const totalRefundedAll = (receiptDetails?.returnLogs ?? []).reduce(
    (sum: number, log: any) => sum + Number(log.refundAmount || 0),
    0
  );
  const grossCharged = receiptTotal + totalRefundedAll;
  const isSettled = transaction?.checkout?.paymentStatus !== "pending";

  // checkout.totalCharged is tax-inclusive (what the customer actually paid per line);
  // item rows below show the pre-tax price instead, with tax broken out as its own line
  // in the totals block — not folded invisibly into each item's displayed price.
  const taxTotalAll = (receiptDetails?.items ?? []).reduce(
    (sum: number, item: any) => sum + Number(item.checkout?.taxTotal || 0),
    0
  );
  const grossChargedExclTax = grossCharged - taxTotalAll;
  // Tax isn't stored as a rate anywhere on the checkout/order rows — only the computed
  // amount is — so the effective percentage shown to the user is derived from the two
  // totals rather than read from a field.
  const effectiveTaxRatePct = grossChargedExclTax > 0 ? (taxTotalAll / grossChargedExclTax) * 100 : 0;
  const formatTaxRate = (pct: number) => (Number.isInteger(pct) ? pct.toString() : pct.toFixed(1));

  const isFullyReturned =
    !isVoided &&
    receiptDetails?.items?.length > 0 &&
    receiptDetails.items.every((item: any) => {
      return (item.order?.returnedQuantity || 0) >= (item.order?.quantity || 0);
    });

  const handleReturnSuccess = async () => {
    // 1. Force-close the dialog immediately so it can't be re-submitted
    setIsReturnDialogOpen(false);
    // 2. Lock the return button while data refreshes
    setIsRefreshingAfterReturn(true);
    try {
      await queryClient.invalidateQueries({ queryKey: [`/api/transactions/${checkoutId}/receipt`] });
      await queryClient.invalidateQueries({ queryKey: ["/api/transactions", id] });
      await queryClient.invalidateQueries({ queryKey: ["/api/transactions", currentStore?.id] });
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/profit-loss"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/inventory", currentStore?.id] });
    } finally {
      setIsRefreshingAfterReturn(false);
    }
  };

  const returnCheckoutObj = receiptDetails ? {
    id: checkoutId,
    receiptNumber: receiptDetails.checkout?.receiptNumber,
    customerId: receiptDetails.customer?.id,
    staffId: receiptDetails.checkout?.staffId,
    orders: receiptDetails.items.map((item: any) => ({
      id: item.order.id,
      inventoryId: item.order.inventoryId,
      quantity: item.order.quantity,
      returnedQuantity: item.order.returnedQuantity || 0,
      // totalCharged (not totalPrice) is the actual tax/discount-inclusive amount the
      // customer paid for this line — that's what a return should be refunded against.
      totalCharged: item.checkout.totalCharged,
      taxTotal: item.checkout.taxTotal ?? 0,
      inventory: item.inventory,
    })),
  } : null;

  // Mutations
  const voidMutation = useMutation({
    mutationFn: async (params: { checkoutId: string; reason: string }) => {
      const res = await apiRequest("POST", `/api/transactions/${params.checkoutId}/void`, {
        reason: params.reason,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/profit-loss"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory", currentStore?.id] });
      toast({ title: "Transaction voided successfully" });
      setIsVoidDialogOpen(false);
      setVoidReason("");
      setCustomVoidReason("");
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to void transaction",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const paymentMutation = useMutation({
    mutationFn: async (params: {
      checkoutId: string;
      paymentMethod: string;
      paymentStatus: string;
    }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/transactions/${params.checkoutId}/payment-status`,
        {
          paymentMethod: params.paymentMethod,
          paymentStatus: params.paymentStatus,
        }
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions", currentStore?.id] });
      toast({ title: "Payment status updated" });
      setIsPaymentDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update payment",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const editDateMutation = useMutation({
    mutationFn: async (params: { checkoutId: string; newDate: string }) => {
      const res = await apiRequest("PATCH", `/api/transactions/${params.checkoutId}/date`, {
        newDate: params.newDate,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/charts/sales-trends"] });
      queryClient.invalidateQueries({ queryKey: ["/api/charts/revenue-by-type"] });
      queryClient.invalidateQueries({ queryKey: ["/api/profit-loss"] });
      toast({ title: "Transaction date updated" });
      setIsEditDateDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update date",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const openEditDateDialog = () => {
    if (!transaction?.transactionDate) return;
    setEditTransactionDate(new Date(transaction.transactionDate).toISOString().slice(0, 10));
    setIsEditDateDialogOpen(true);
  };

  const handleVoidConfirm = () => {
    if (!checkoutId) return;
    const reasonToSubmit = voidReason === "Other" ? customVoidReason : voidReason;
    if (!reasonToSubmit) {
      toast({
        title: "Reason required",
        description: "Please select or enter a void reason.",
        variant: "destructive",
      });
      return;
    }
    voidMutation.mutate({ checkoutId, reason: reasonToSubmit });
  };

  const handlePaymentUpdateConfirm = () => {
    if (!checkoutId) return;
    paymentMutation.mutate({
      checkoutId,
      paymentMethod: editPaymentMethod,
      paymentStatus: editPaymentStatus,
    });
  };

  const openPaymentDialog = () => {
    if (!transaction) return;
    setEditPaymentMethod(transaction.checkout?.paymentMethod ?? "cash");
    setEditPaymentStatus(transaction.checkout?.paymentStatus ?? "completed");
    setIsPaymentDialogOpen(true);
  };

  // Loading State
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] animate-in fade-in duration-300">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading transaction details...</p>
        </div>
      </div>
    );
  }

  // Not Found State
  if (!transaction) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] animate-in fade-in duration-300">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
          </div>
          <h2 className="text-2xl font-bold">Transaction Not Found</h2>
          <p className="text-muted-foreground max-w-md">
            The transaction you're looking for doesn't exist or you don't have access to view it.
          </p>
          <Button onClick={() => setLocation(backHref)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Transactions
          </Button>
        </div>
      </div>
    );
  }

  const tx = transaction;

  const statusBadge = isVoided ? (
    <Badge variant="destructive" className="text-xs px-2.5 py-1">Voided</Badge>
  ) : isFullyReturned ? (
    <Badge variant="outline" className="text-xs px-2.5 py-1 text-red-600 border-red-300 bg-red-50 dark:bg-red-950/20 dark:border-red-900/30 font-semibold">
      Returned
    </Badge>
  ) : receiptDetails?.checkout?.isPartiallyReturned ? (
    <Badge variant="outline" className="text-xs px-2.5 py-1 text-orange-600 border-orange-300 bg-orange-50 dark:bg-orange-950/20 dark:border-orange-900/30 font-semibold">
      Part returned
    </Badge>
  ) : null;

  // Shared between the mobile "More actions" sheet (triggered from the header, since a
  // phone screen has no room to show these inline) and the desktop inline Corrections
  // card (shown always there — desktop has the width to spare, so hiding them behind a
  // click only costs clicks for no space savings).
  const correctionsList = (
    <div className="space-y-1">
      <button
        type="button"
        className="w-full flex items-center gap-3 rounded-lg p-3 text-left hover:bg-muted/50 transition-colors disabled:opacity-50 disabled:hover:bg-transparent"
        disabled={tx.checkout?.paymentStatus === "pending"}
        onClick={openPaymentDialog}
      >
        <CreditCard className="h-4 w-4 text-muted-foreground shrink-0" />
        <div>
          <p className="text-sm font-medium">{isFullyReturned ? "Correct Payment Record" : "Change payment method"}</p>
          <p className="text-xs text-muted-foreground">
            {tx.checkout?.paymentStatus === "pending"
              ? "Resolve the pending payment first"
              : "Record a different method or split payment"}
          </p>
        </div>
      </button>

      {tx.checkout?.paymentStatus !== "pending" && (
        <button
          type="button"
          className="w-full flex items-center gap-3 rounded-lg p-3 text-left hover:bg-muted/50 transition-colors"
          onClick={() => setIsAddendumOpen(true)}
        >
          <Plus className="h-4 w-4 text-muted-foreground shrink-0" />
          <div>
            <p className="text-sm font-medium">Add missed item</p>
            <p className="text-xs text-muted-foreground">Adds to this receipt and records a balance due</p>
          </div>
        </button>
      )}

      {canEditDate && (
        <button
          type="button"
          className="w-full flex items-center gap-3 rounded-lg p-3 text-left hover:bg-muted/50 transition-colors"
          onClick={openEditDateDialog}
        >
          <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
          <div>
            <p className="text-sm font-medium">Correct sale date</p>
            <p className="text-xs text-muted-foreground">Owner only · moves revenue between reporting periods</p>
          </div>
        </button>
      )}

      {/* Void — disabled with an explanation once a return exists: stock &
          refunds are already reversed by the return, so voiding on top would
          double-count them. */}
      <button
        type="button"
        className="w-full flex items-center gap-3 rounded-lg p-3 text-left hover:bg-destructive/5 transition-colors disabled:opacity-50 disabled:hover:bg-transparent"
        disabled={isFullyReturned || (receiptDetails?.checkout?.isPartiallyReturned ?? false)}
        onClick={() => setIsVoidDialogOpen(true)}
      >
        <Ban className="h-4 w-4 text-destructive shrink-0" />
        <div>
          <p className="text-sm font-medium text-destructive">Void sale</p>
          <p className="text-xs text-muted-foreground">
            {isFullyReturned || receiptDetails?.checkout?.isPartiallyReturned
              ? "Unavailable after a return. Return the remaining items instead."
              : "Reverses revenue and restores stock"}
          </p>
        </div>
      </button>
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header — receipt-first: title is the receipt number, and every other
          field (status, total, date) reads top-to-bottom below it, matching how
          a physical receipt is scanned. Corrections live behind "More actions". */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild className="shrink-0">
          <Link href={backHref}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <h1 className="text-lg font-bold tracking-tight flex-1 min-w-0 truncate">
          Receipt {tx.checkout?.receiptNumber}
        </h1>
        {canViewActivity && (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            title="View activity"
            onClick={() => setDetailTab((t) => (t === "activity" ? "details" : "activity"))}
            data-testid="button-view-activity"
          >
            <History className="h-4 w-4" />
          </Button>
        )}
        {canManage && !isVoided && (
          // Desktop has a dedicated always-visible Corrections card in the right column
          // (more spacing there, so a click-to-reveal sheet just costs clicks) — this
          // trigger is mobile/tablet only.
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0 lg:hidden" data-testid="button-more-actions-header">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-xl p-5 gap-4">
              <SheetHeader className="text-left p-0 space-y-0.5">
                <SheetTitle className="text-lg">More actions</SheetTitle>
                <p className="text-xs text-muted-foreground font-mono">Receipt {tx.checkout?.receiptNumber}</p>
              </SheetHeader>

              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-1">
                Corrections · reason required, logged in activity
              </p>

              {correctionsList}
            </SheetContent>
          </Sheet>
        )}
      </div>

      {/* Net total headline */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Net total</p>
          <p className={`text-3xl font-bold ${isVoided ? "line-through text-muted-foreground" : ""}`}>
            {isReceiptLoading ? <span className="text-muted-foreground text-base">Loading…</span> : formatCurrency(receiptTotal)}
          </p>
        </div>
        {statusBadge}
      </div>
      <p className="text-sm text-muted-foreground -mt-4">
        {formatDate(tx.transactionDate)} · <span className="font-mono">{tx.checkout?.receiptNumber}</span>
      </p>

      {/* Customer / Billed by — two compact tappable blocks */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">Customer</p>
          {tx.customer?.id ? (
            <EntityLink href={`/customers/${buildSlug(tx.customer.name, tx.customer.id)}`} className="font-semibold text-primary text-sm">
              {tx.customer.name}
            </EntityLink>
          ) : (
            <p className="font-semibold text-sm">Unknown</p>
          )}
        </div>
        <div className="rounded-lg bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">Billed by</p>
          {tx.checkout?.staff?.id ? (
            <EntityLink href={`/staffs/${tx.checkout.staff.id}/edit`} className="font-semibold text-primary text-sm">
              {tx.checkout.staff.name}
            </EntityLink>
          ) : (
            <p className="font-semibold text-sm">{tx.checkout?.staff?.name ?? "Unknown"}</p>
          )}
        </div>
      </div>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Section — Transaction Info */}
        <div className="lg:col-span-2 space-y-6">
        <Tabs value={detailTab} onValueChange={(v) => setDetailTab(v as "details" | "activity")}>
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            {canViewActivity && <TabsTrigger value="activity">Activity</TabsTrigger>}
          </TabsList>

          <TabsContent value="details" className="space-y-6 mt-4">
          <BaseCard hoverElevation>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShoppingBag className="h-5 w-5 text-primary" />
                Transaction Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Receipt number, date, customer, billed-by, payment method and net total
                  all now live in the headline block and two-block row above — this card
                  starts straight at whatever needs more room: discount, items, totals. */}

              {/* Discount row — only shown when a discount was applied */}
              {(hasDiscount || isReceiptLoading) && hasDiscount && (
                <div className="flex items-start gap-4 rounded-lg border border-amber-200 bg-amber-50/50 dark:bg-amber-950/10 dark:border-amber-900/30 p-4">
                  <div className="h-10 w-10 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-600 shrink-0">
                    <Tag className="h-5 w-5" />
                  </div>
                  <div className="flex-1 space-y-0.5">
                    <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Discount Applied</p>
                    <p className="text-sm text-muted-foreground">
                      <span className="font-mono font-bold text-amber-700 dark:text-amber-400">-{formatCurrency(receiptDiscount)}</span>
                      {receiptDiscountPct > 0 && (
                        <span className="ml-1 text-xs">({receiptDiscountPct}% off)</span>
                      )}
                    </p>
                    {receiptDiscountReason && (
                      <p className="text-xs text-muted-foreground italic">"{receiptDiscountReason}"</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-muted-foreground">Subtotal before discount</p>
                    <p className="font-mono text-sm font-semibold">{formatCurrency(receiptSubtotal)}</p>
                  </div>
                </div>
              )}

              {/* Purchase Line Items */}
              {receiptDetails?.items && receiptDetails.items.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <ShoppingBag className="h-4 w-4 text-primary" />
                        {receiptDetails.items.length} item{receiptDetails.items.length === 1 ? "" : "s"}
                      </h3>
                      {taxTotalAll > 0 && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Prices shown are pre-tax · {formatTaxRate(effectiveTaxRatePct)}% tax added below
                        </p>
                      )}
                    </div>
                    {/* Data-quality flag: a fractional quantity on a piece-counted item (not a
                        service, which can legitimately be sold in fractional units of time/usage)
                        means checkout accepted a mistyped quantity — surface it rather than hide it. */}
                    {receiptDetails.items
                      .filter((item: any) => item.inventory?.type !== "service" && !Number.isInteger(Number(item.order.quantity)))
                      .map((item: any) => (
                        <div
                          key={`qty-flag-${item.order.id}`}
                          className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-400"
                        >
                          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                          <span>
                            <strong>{item.inventory?.name ?? "This item"}</strong> has quantity {item.order.quantity}.
                            Pieces should be whole numbers — this looks like a mistyped quantity at checkout
                            and should be reviewed for correction.
                          </span>
                        </div>
                      ))}
                    {/* Stacked list instead of a table — name/qty/unit price stack vertically per
                        item with the line total right-aligned, so nothing clips at phone widths
                        (the old table needed horizontal scroll to reach "Total" and beyond). */}
                    <div className="rounded-lg border divide-y divide-muted/40 bg-card">
                      {receiptDetails.items.map((item: any) => {
                        const lineCharged = item.checkout.totalCharged ?? item.checkout.totalPrice;
                        // Pre-tax line amount — tax is broken out as its own line in the
                        // totals block below rather than folded into each item's price.
                        const lineExclTax = lineCharged - Number(item.checkout?.taxTotal || 0);
                        const unitPrice = item.order.quantity > 0 ? (lineExclTax / item.order.quantity) : 0;
                        const returnedQty = item.order.returnedQuantity || 0;
                        // Per-line return amount: correlate this item's return logs by orderId
                        // (a receipt can have several return events against the same line).
                        const lineReturnLogs = (receiptDetails.returnLogs ?? []).filter(
                          (log: any) => log.orderId === item.order.id
                        );
                        const lineReturnedAmount = lineReturnLogs.reduce(
                          (sum: number, log: any) => sum + Number(log.refundAmount || 0) - Number(log.taxRefundAmount || 0),
                          0
                        );
                        const latestLineReturn = lineReturnLogs
                          .slice()
                          .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
                        return (
                          <div key={item.order.id} className="p-3 flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                {item.inventory?.id ? (
                                  <EntityLink href={`/inventory/${buildSlug(item.inventory.name, item.inventory.id)}`}>
                                    <p className="font-medium text-sm text-foreground truncate">{item.inventory.name}</p>
                                  </EntityLink>
                                ) : (
                                  <p className="font-medium text-sm text-foreground truncate">{item.inventory?.name || "Unknown Item"}</p>
                                )}
                                {canManage && !isVoided && item.inventory?.type === "service" && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 text-muted-foreground hover:text-foreground shrink-0"
                                        onClick={() => setLogUsageTarget({
                                          orderId: item.order.id,
                                          serviceName: item.inventory.name,
                                        })}
                                      >
                                        <Droplet className="h-3.5 w-3.5" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Log supply used for this service</TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                                {item.order.quantity} × {formatCurrency(unitPrice)}
                              </p>
                              {returnedQty > 0 && (
                                <p className="text-xs text-orange-600 dark:text-orange-400 font-medium mt-1">
                                  {returnedQty} returned
                                  {latestLineReturn ? ` · ${new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" }).format(new Date(latestLineReturn.createdAt))}` : ""}
                                  {lineReturnedAmount > 0 ? ` · -${formatCurrency(lineReturnedAmount)}` : ""}
                                </p>
                              )}
                            </div>
                            <p className={`font-mono font-medium text-sm shrink-0 ${returnedQty >= item.order.quantity ? "line-through text-muted-foreground" : ""}`}>
                              {formatCurrency(lineExclTax)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              {/* Subtotal / Returned / Net total — reconciles visibly instead of only
                  showing the final net figure, so a partial return's arithmetic is checkable. */}
              {receiptDetails && (
                <>
                  <Separator />
                  <div className="space-y-1.5 text-sm">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>Subtotal</span>
                      <span className="font-mono">{formatCurrency(grossChargedExclTax)}</span>
                    </div>
                    {taxTotalAll > 0 && (
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span>Tax ({formatTaxRate(effectiveTaxRatePct)}%)</span>
                        <span className="font-mono">{formatCurrency(taxTotalAll)}</span>
                      </div>
                    )}
                    {totalRefundedAll > 0 && (
                      <div className="flex items-center justify-between text-orange-600 dark:text-orange-400">
                        <span>Returned</span>
                        <span className="font-mono line-through opacity-70">-{formatCurrency(totalRefundedAll)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between font-bold text-base pt-1">
                      <span>Net total</span>
                      <span className="font-mono">{formatCurrency(receiptTotal)}</span>
                    </div>
                  </div>
                </>
              )}

              {/* Payments ledger — every payment and refund in order, ending in a
                  clear settled-or-balance-due line. */}
              {receiptDetails && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-foreground">Payments</h3>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-muted-foreground capitalize">
                          <span className="text-emerald-600">↙</span>
                          {tx.checkout?.paymentMethod ?? "cash"} · {new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" }).format(new Date(tx.transactionDate))}
                        </span>
                        <span className="font-mono">{formatCurrency(grossCharged)}</span>
                      </div>
                      {(receiptDetails.returnLogs ?? []).map((log: any) => (
                        <div key={log.id} className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5 text-muted-foreground capitalize">
                            <span className="text-red-500">↗</span>
                            Refund to {(log.refundMethod ?? "").replace("_", " ")} · {new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(log.createdAt))}
                          </span>
                          <span className="font-mono text-red-600 dark:text-red-400">-{formatCurrency(log.refundAmount)}</span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between pt-1.5 border-t">
                        <span className={`flex items-center gap-1.5 font-medium ${isSettled ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                          {isSettled ? "✓ Fully settled" : "Balance due"}
                        </span>
                        <span className={`font-mono font-medium ${isSettled ? "" : "text-amber-600 dark:text-amber-400"}`}>
                          {isSettled ? formatCurrency(0) : formatCurrency(receiptTotal)}
                        </span>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Primary actions — what staff do most, pinned at the bottom of the receipt
                  itself; corrections live behind the header's "More actions" sheet. */}
              <Separator />
              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  onClick={() => setReceiptCheckoutId(tx.checkout?.id || null)}
                  data-testid="button-send-receipt"
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Send receipt
                </Button>
                <Button
                  variant="outline"
                  className="border-orange-200 hover:bg-orange-50 hover:text-orange-600 text-orange-600 dark:border-orange-900/30 dark:hover:bg-orange-950/20 disabled:opacity-50"
                  onClick={() => setIsReturnDialogOpen(true)}
                  disabled={!canManage || isVoided || isFullyReturned || isReceiptLoading || !returnCheckoutObj || isRefreshingAfterReturn}
                  title={!canManage || isVoided || isFullyReturned ? "Return items" : isRefreshingAfterReturn ? "Refreshing transaction data..." : isReceiptLoading ? "Loading receipt data..." : "Return items"}
                  data-testid="button-return-items"
                >
                  <Undo2 className="mr-2 h-4 w-4" />
                  {isRefreshingAfterReturn ? "Refreshing..." : isReceiptLoading ? "Loading..." : "Return items"}
                </Button>
              </div>
            </CardContent>
          </BaseCard>

          {/* Return Logs Card */}
          {receiptDetails?.returnLogs && receiptDetails.returnLogs.length > 0 && (
            <BaseCard hoverElevation className="border-orange-500/20 bg-orange-500/[0.02]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
                  <Undo2 className="h-5 w-5" />
                  Return & Refund History
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {receiptDetails.returnLogs.map((log: any) => (
                  <div key={log.id} className="flex gap-4 p-3 bg-card border rounded-lg text-xs hover:shadow-sm transition-shadow animate-in fade-in duration-300">
                    <div className="h-8 w-8 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-600 shrink-0">
                      <Undo2 className="h-4 w-4" />
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex justify-between items-start">
                        <p className="font-semibold text-foreground">
                          Returned {log.quantity} ×{" "}
                          {log.inventory?.id ? (
                            <EntityLink href={`/inventory/${buildSlug(log.inventory.name, log.inventory.id)}`}>
                              {log.inventory.name}
                            </EntityLink>
                          ) : (
                            log.inventory?.name || "Item"
                          )}
                        </p>
                        <span className="font-mono font-bold text-orange-600 dark:text-orange-400">
                          -{formatCurrency(log.refundAmount)}
                        </span>
                      </div>
                      <p className="text-muted-foreground">
                        Refunded via <span className="capitalize font-medium text-foreground">{log.refundMethod.replace("_", " ")}</span>
                        {log.staff && (
                          <>
                            {" by "}
                            {log.staff.id ? (
                              <EntityLink href={`/staffs/${log.staff.id}/edit`}>{log.staff.name}</EntityLink>
                            ) : (
                              log.staff.name
                            )}
                          </>
                        )}
                      </p>
                      {log.reason && (
                        <p className="text-muted-foreground italic bg-muted/40 p-1.5 rounded mt-1.5 border-l-2 border-orange-400">
                          "{log.reason}"
                        </p>
                      )}
                      <p className="text-[10px] text-muted-foreground/80 font-mono mt-1">
                        {formatDate(log.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </BaseCard>
          )}
          </TabsContent>

          {canViewActivity && (
            <TabsContent value="activity" className="mt-4">
              <BaseCard hoverElevation>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <History className="h-5 w-5 text-primary" />
                    Activity
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {isActivityLoading ? (
                    <p className="text-sm text-muted-foreground">Loading activity…</p>
                  ) : activityLogs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No activity recorded for this transaction yet.</p>
                  ) : (
                    activityLogs.map((log: any) => (
                      <div key={log.id} className="flex gap-4 p-3 bg-card border rounded-lg text-xs hover:shadow-sm transition-shadow">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                          <History className="h-4 w-4" />
                        </div>
                        <div className="flex-1 space-y-1">
                          <div className="flex justify-between items-start gap-2">
                            <p className="font-semibold text-foreground">
                              {log.action.replace(/_/g, " ")}
                            </p>
                            <Badge
                              variant="outline"
                              className={
                                log.status === "failure"
                                  ? "text-red-600 border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900/30"
                                  : "text-emerald-600 border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-900/30"
                              }
                            >
                              {log.status}
                            </Badge>
                          </div>
                          <p className="text-muted-foreground">
                            By <span className="font-medium text-foreground">{log.actorName ?? "System"}</span>
                            {log.actorRole && <span className="capitalize"> ({log.actorRole})</span>}
                          </p>
                          {log.changedFields?.length > 0 && (
                            <p className="text-muted-foreground">
                              Changed: <span className="font-mono text-foreground">{log.changedFields.join(", ")}</span>
                            </p>
                          )}
                          {log.errorMessage && (
                            <p className="text-red-600 dark:text-red-400 italic">{log.errorMessage}</p>
                          )}
                          <p className="text-[10px] text-muted-foreground/80 font-mono mt-1">
                            {formatDate(log.timestamp)}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </BaseCard>
            </TabsContent>
          )}
        </Tabs>
        </div>

        {/* Right Section — Actions */}
        <div className="space-y-6">
          {/* Desktop-only: corrections shown inline instead of behind a click, since
              there's room here that a phone screen doesn't have (mirrors the header's
              mobile-only "More actions" sheet, which carries the same list). */}
          {canManage && !isVoided && (
            <div className="hidden lg:block">
              <BaseCard hoverElevation>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                    <Edit className="h-4 w-4" />
                    Corrections
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">Reason required, logged in activity</p>
                </CardHeader>
                <CardContent>
                  {correctionsList}
                </CardContent>
              </BaseCard>
            </div>
          )}

          {/* Resolve Pending / Void Log — the one thing that's neither a primary action
              (Send receipt / Return items, at the bottom of the receipt card) nor a
              correction (above): completing an unpaid sale, or the record of a past void.
              Hidden entirely rather than shown empty when neither applies. */}
          {((canManage && !isVoided && !isFullyReturned && tx.checkout?.paymentStatus === "pending") || (isVoided && canManage)) && (
          <BaseCard hoverElevation>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                <Edit className="h-4 w-4" />
                Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {canManage && !isVoided && !isFullyReturned && tx.checkout?.paymentStatus === "pending" && (
                <Button
                  variant="outline"
                  className="w-full justify-start border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950/30"
                  onClick={() => setIsResolvePendingOpen(true)}
                >
                  <CreditCard className="mr-2 h-4 w-4" />
                  Resolve Pending Payment
                </Button>
              )}

              {/* Void Log — visible to manager & owner */}
              {isVoided && canManage && (
                <>
                  <Separator className="my-4" />
                  <div className="p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg">
                    <h4 className="text-xs font-semibold text-red-800 dark:text-red-400 mb-2 flex items-center gap-1">
                      <AlertCircle className="h-3.5 w-3.5" />
                      Void Log
                    </h4>
                    <div className="text-sm space-y-1.5 text-red-700 dark:text-red-300">
                      <p>
                        <span className="font-medium">Date:</span>{" "}
                        {tx.checkout?.voidedAt
                          ? formatDate(tx.checkout.voidedAt)
                          : "Unknown"}
                      </p>
                      <p>
                        <span className="font-medium">Reason:</span>{" "}
                        {tx.checkout?.voidReason || "None provided"}
                      </p>
                      {tx.checkout?.voidedByUser && (
                        <p>
                          <span className="font-medium">Voided By:</span>{" "}
                          {(tx.checkout.voidedByUser as any).name || (tx.checkout.voidedByUser as any).email || "Unknown"}
                        </p>
                      )}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </BaseCard>
          )}
        </div>
      </div>

      {/* Receipt Modal */}
      <ReceiptModal
        checkoutId={receiptCheckoutId}
        open={!!receiptCheckoutId}
        onClose={() => setReceiptCheckoutId(null)}
      />

      {/* Void Alert Dialog */}
      <AlertDialog open={isVoidDialogOpen} onOpenChange={setIsVoidDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void Transaction</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to void this transaction? This will reverse any revenue
              and restore product stock. If this is part of a paid payroll, it will create a
              deduction next period.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="py-4 space-y-4">
            <div className="space-y-2">
              <Label>Reason for Voiding</Label>
              <Select value={voidReason} onValueChange={setVoidReason}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a reason" />
                </SelectTrigger>
                <SelectContent>
                  {VOID_REASON_PRESETS.map((reason) => (
                    <SelectItem key={reason} value={reason}>
                      {reason}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {voidReason === "Other" && (
              <div className="space-y-2">
                <Label>Custom Reason</Label>
                <Input
                  placeholder="Please specify..."
                  value={customVoidReason}
                  onChange={(e) => setCustomVoidReason(e.target.value)}
                />
              </div>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={voidMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleVoidConfirm}
              disabled={
                voidMutation.isPending ||
                !voidReason ||
                (voidReason === "Other" && !customVoidReason.trim())
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {voidMutation.isPending ? "Voiding..." : "Confirm Void"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Update Payment Dialog */}
      <Dialog open={isPaymentDialogOpen} onOpenChange={setIsPaymentDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{isFullyReturned ? "Correct Payment Record" : "Update Payment Details"}</DialogTitle>
            <DialogDescription>
              {isFullyReturned
                ? "This transaction is fully returned. You can correct the original payment method for audit accuracy."
                : "Change how or if this transaction was paid."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Payment Method</Label>
              <Select value={editPaymentMethod} onValueChange={setEditPaymentMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="transfer">Bank Transfer</SelectItem>
                  <SelectItem value="pos">POS / Card</SelectItem>
                  <SelectItem value="flutterwave">Flutterwave</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* Status selector hidden for fully-returned transactions — status is implicitly settled */}
            {!isFullyReturned && (
              <div className="space-y-2">
                <Label>Payment Status</Label>
                <Select value={editPaymentStatus} onValueChange={setEditPaymentStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setIsPaymentDialogOpen(false)}
              disabled={paymentMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handlePaymentUpdateConfirm}
              disabled={paymentMutation.isPending}
            >
              {paymentMutation.isPending ? "Updating..." : "Save Changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Transaction Date Dialog */}
      <AlertDialog open={isEditDateDialogOpen} onOpenChange={setIsEditDateDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Edit Transaction Date</AlertDialogTitle>
            <AlertDialogDescription>
              This changes the recorded sale date for this entire receipt (all line items),
              including for reports, revenue trends, and staff commission calculations. This
              cannot be done if either the current or new date falls within a finalized
              (approved/paid) payroll period.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2 space-y-2">
            <Label htmlFor="edit-transaction-date">New Date</Label>
            <Input
              id="edit-transaction-date"
              type="date"
              value={editTransactionDate}
              onChange={(e) => setEditTransactionDate(e.target.value)}
              max={new Date().toISOString().split("T")[0]}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={editDateMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                checkoutId &&
                editDateMutation.mutate({ checkoutId, newDate: editTransactionDate })
              }
              disabled={editDateMutation.isPending || !editTransactionDate}
            >
              {editDateMutation.isPending ? "Saving..." : "Save Date"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Return Dialog */}
      {returnCheckoutObj && (
        <ReturnDialog
          open={isReturnDialogOpen}
          onOpenChange={setIsReturnDialogOpen}
          checkout={returnCheckoutObj}
          onSuccess={handleReturnSuccess}
        />
      )}

      {/* Add Missed Item (Addendum) Dialog */}
      {checkoutId && receiptDetails && (
        <AddendumDialog
          open={isAddendumOpen}
          onOpenChange={setIsAddendumOpen}
          checkoutId={checkoutId}
          receiptNumber={receiptDetails.checkout?.receiptNumber ?? ""}
          storeId={receiptDetails.checkout?.storeId ?? currentStore?.id ?? ""}
          currency={receiptDetails.store?.currency ?? storeCurrency}
          customerStoreCreditBalance={Number(receiptDetails.customer?.storeCreditBalance ?? 0)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: [`/api/transactions/${id}/receipt`] });
            queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
            setIsAddendumOpen(false);
          }}
        />
      )}

      {/* Log Supply Usage Dialog */}
      {logUsageTarget && (
        <LogSupplyUsageDialog
          open={!!logUsageTarget}
          onOpenChange={(v) => { if (!v) setLogUsageTarget(null); }}
          orderId={logUsageTarget.orderId}
          storeId={receiptDetails?.checkout?.storeId ?? currentStore?.id ?? ""}
          serviceName={logUsageTarget.serviceName}
        />
      )}

      {/* Resolve Pending Payment Dialog */}
      {checkoutId && tx.customer?.id && (
        <ResolvePendingDialog
          open={isResolvePendingOpen}
          onOpenChange={setIsResolvePendingOpen}
          checkoutId={checkoutId}
          receiptNumber={tx.checkout?.receiptNumber ?? ""}
          amountOwed={receiptTotal}
          customerId={tx.customer.id}
          customerName={tx.customer.name ?? "Customer"}
          storeId={tx.checkout?.storeId ?? currentStore?.id ?? ""}
          storeCurrency={storeCurrency}
          onResolved={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/transactions", id] });
            queryClient.invalidateQueries({ queryKey: ["/api/transactions", currentStore?.id] });
            queryClient.invalidateQueries({ queryKey: [`/api/transactions/${checkoutId}/receipt`] });
          }}
        />
      )}
    </div>
  );
}
