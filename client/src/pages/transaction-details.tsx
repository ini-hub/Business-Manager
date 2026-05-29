import { useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  Calendar,
  User,
  Package,
  CreditCard,
  Hash,
  AlertCircle,
  Printer,
  Ban,
  Edit,
  Coins,
  ShoppingBag,
  Loader2,
  Undo2,
  Store,
  Tag,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useStore } from "@/lib/store-context";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { type TransactionWithRelations, VOID_REASON_PRESETS } from "@shared/schema";

export default function TransactionDetailsPage() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { currentStore } = useStore();
  const { user } = useAuth();
  const { toast } = useToast();

  const userRole = user?.role || "staff";
  const canManage = userRole === "manager" || userRole === "owner";

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

  // Return Dialog State
  const [isReturnDialogOpen, setIsReturnDialogOpen] = useState(false);
  // Track return success to block re-opening until data is fresh
  const [isRefreshingAfterReturn, setIsRefreshingAfterReturn] = useState(false);

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

  const { data: transactions = [], isLoading } = useQuery<TransactionWithRelations[]>({
    queryKey: ["/api/transactions", currentStore?.id],
    enabled: !!currentStore?.id,
  });

  const transaction = transactions.find((tx) => String(tx.id) === id);

  const isVoided = transaction?.checkout?.isVoided ?? false;
  const checkoutId = transaction?.checkout?.id;

  // Fetch full checkout receipt details (which includes all items and returns history)
  const { data: receiptDetails, isLoading: isReceiptLoading } = useQuery<any>({
    queryKey: [`/api/transactions/${checkoutId}/receipt`],
    enabled: !!checkoutId,
  });

  // Use receipt-level totals from receiptDetails when available.
  // The storage layer overrides checkout.totalPrice to the per-line amount on the list endpoint,
  // but the /receipt endpoint returns the true basket-level totals.
  const receiptTotal = receiptDetails?.checkout?.totalCharged ?? receiptDetails?.checkout?.totalPrice ?? (transaction?.checkout?.totalPrice ?? 0);
  const receiptSubtotal = receiptDetails?.checkout?.subtotal ?? receiptTotal;
  const receiptDiscount = receiptDetails?.checkout?.discountAmount ?? 0;
  const receiptDiscountPct = receiptDetails?.checkout?.discountPercent ?? 0;
  const receiptDiscountReason = receiptDetails?.checkout?.discountReason ?? "";
  const hasDiscount = receiptDiscount > 0;

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
      // 3. Invalidate the receipt endpoint (drives returnedQuantity / items list)
      await queryClient.invalidateQueries({ queryKey: [`/api/transactions/${checkoutId}/receipt`] });
      // 4. Invalidate the transactions list (drives returnCheckoutObj rebuild)
      await queryClient.invalidateQueries({ queryKey: ["/api/transactions", currentStore?.id] });
      // 5. Invalidate downstream caches
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
      totalPrice: item.checkout.totalPrice,
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
          <Button onClick={() => setLocation("/transactions")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Transactions
          </Button>
        </div>
      </div>
    );
  }

  const tx = transaction;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Back Navigation */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild className="shrink-0">
          <Link href="/transactions">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight">Transaction Details</h1>
            {isVoided && (
              <Badge variant="destructive" className="text-sm px-3 py-1">
                VOIDED
              </Badge>
            )}
            {isFullyReturned ? (
              <Badge
                variant="outline"
                className="text-sm px-3 py-1 text-red-600 border-red-300 bg-red-50 dark:bg-red-950/20 dark:border-red-900/30 font-semibold"
              >
                FULLY RETURNED
              </Badge>
            ) : receiptDetails?.checkout?.isPartiallyReturned ? (
              <Badge
                variant="outline"
                className="text-sm px-3 py-1 text-orange-600 border-orange-300 bg-orange-50 dark:bg-orange-950/20 dark:border-orange-900/30 font-semibold"
              >
                PARTIALLY RETURNED
              </Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground font-mono mt-0.5">
            {tx.checkout?.receiptNumber}
          </p>
        </div>
      </div>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Section — Transaction Info */}
        <div className="lg:col-span-2 space-y-6">
          <BaseCard hoverElevation>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShoppingBag className="h-5 w-5 text-primary" />
                Transaction Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Receipt Number & Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    <Hash className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-muted-foreground">Receipt Number</p>
                    <p className="font-mono font-semibold text-lg truncate">
                      {tx.checkout?.receiptNumber}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    <Calendar className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Date</p>
                    <p className="font-semibold text-lg">
                      {formatDate(tx.transactionDate)}
                    </p>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Billed By & Customer */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-600 shrink-0">
                    <User className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Billed By</p>
                    <p className="font-semibold">
                      {tx.checkout?.staff?.name ?? "Unknown"}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {tx.checkout?.staff?.staffNumber ?? "N/A"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center text-green-600 shrink-0">
                    <User className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Customer</p>
                    <Link
                      href={`/customers/${tx.customer?.id}`}
                      className="font-semibold text-primary hover:underline"
                    >
                      {tx.customer?.name ?? "Unknown"}
                    </Link>
                    <p className="text-xs text-muted-foreground font-mono">
                      {tx.customer?.customerNumber}
                    </p>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Item & Payment Method */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-600 shrink-0">
                    <Package className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Item</p>
                    <p className="font-semibold">
                      {tx.inventory?.name ?? "Unknown"}
                    </p>
                    <Badge variant="outline" className="capitalize mt-1">
                      {tx.inventory?.type ?? "unknown"}
                    </Badge>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-600 shrink-0">
                    <CreditCard className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Payment Method</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary" className="capitalize">
                        {tx.checkout?.paymentMethod ?? "cash"}
                      </Badge>
                      {tx.checkout?.paymentStatus === "pending" && !isVoided && (
                        <Badge
                          variant="outline"
                          className="text-amber-600 border-amber-300 bg-amber-50"
                        >
                          PENDING
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Quantity & Total Amount */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-600 shrink-0">
                    <Coins className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Qty / Units (this item)</p>
                    <p className="font-semibold text-lg">{tx.checkout?.quantity ?? 1}</p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-600 shrink-0">
                    <Coins className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-muted-foreground">Receipt Total (full basket)</p>
                    <p
                      className={`font-bold text-2xl ${isVoided ? "line-through text-muted-foreground" : ""}`}
                    >
                      {formatCurrency(receiptTotal)}
                    </p>
                    {storeCurrency !== "USD" && (
                      <p className="text-xs text-muted-foreground font-mono">
                        {formatCurrency(receiptTotal / 1500, "USD")}
                      </p>
                    )}
                    {/* Line-item amount breakdown */}
                    <p className="text-xs text-muted-foreground mt-1">
                      This line: <span className="font-mono font-semibold">{formatCurrency(tx.amount ?? 0)}</span>
                    </p>
                  </div>
                </div>
              </div>

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
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <ShoppingBag className="h-4 w-4 text-primary" />
                      Purchased Items
                    </h3>
                    <div className="rounded-lg border bg-card overflow-hidden">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-muted/40 border-b border-muted/50 font-semibold text-muted-foreground">
                            <th className="p-3">Item</th>
                            <th className="p-3 text-center">Qty</th>
                            <th className="p-3 text-right">Unit Price</th>
                            <th className="p-3 text-right">Total</th>
                            <th className="p-3 text-center">Returned</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-muted/40">
                          {receiptDetails.items.map((item: any) => {
                            const unitPrice = item.order.quantity > 0 ? (item.checkout.totalPrice / item.order.quantity) : 0;
                            const returnedQty = item.order.returnedQuantity || 0;
                            return (
                              <tr key={item.order.id} className="hover:bg-muted/10 transition-colors">
                                <td className="p-3">
                                  <p className="font-medium text-foreground">{item.inventory?.name || "Unknown Item"}</p>
                                  <Badge variant="outline" className="text-[10px] py-0 px-1 capitalize mt-0.5">
                                    {item.inventory?.type || "product"}
                                  </Badge>
                                </td>
                                <td className="p-3 text-center font-mono">{item.order.quantity}</td>
                                <td className="p-3 text-right font-mono">{formatCurrency(unitPrice)}</td>
                                <td className="p-3 text-right font-mono font-medium">{formatCurrency(item.checkout.totalPrice)}</td>
                                <td className="p-3 text-center">
                                  {returnedQty > 0 ? (
                                    <Badge variant="outline" className="text-orange-600 border-orange-200 bg-orange-50 dark:bg-orange-950/20 dark:border-orange-900/30 font-mono text-[10px] font-semibold">
                                      {returnedQty} returned
                                    </Badge>
                                  ) : (
                                    <span className="text-muted-foreground/50">-</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
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
                          Returned {log.quantity} × {log.inventory?.name || "Item"}
                        </p>
                        <span className="font-mono font-bold text-orange-600 dark:text-orange-400">
                          -{formatCurrency(log.refundAmount)}
                        </span>
                      </div>
                      <p className="text-muted-foreground">
                        Refunded via <span className="capitalize font-medium text-foreground">{log.refundMethod.replace("_", " ")}</span>
                        {log.staff && ` by ${log.staff.name}`}
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
        </div>

        {/* Right Section — Actions */}
        <div className="space-y-6">
          <BaseCard hoverElevation>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                <Edit className="h-4 w-4" />
                Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Print / View Receipt */}
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => setReceiptCheckoutId(tx.checkout?.id || null)}
              >
                <Printer className="mr-2 h-4 w-4" />
                Print / View Receipt
              </Button>

              {/* Process Return — only if receipt data has loaded and not refreshing after a return */}
              {canManage && !isVoided && (
                <Button
                  variant="outline"
                  className="w-full justify-start border-orange-200 hover:bg-orange-50 hover:text-orange-600 text-orange-600 dark:border-orange-900/30 dark:hover:bg-orange-950/20"
                  onClick={() => setIsReturnDialogOpen(true)}
                  disabled={isReceiptLoading || !returnCheckoutObj || isRefreshingAfterReturn}
                  title={
                    isRefreshingAfterReturn
                      ? "Refreshing transaction data..."
                      : isReceiptLoading
                      ? "Loading receipt data..."
                      : "Process Return"
                  }
                >
                  <Undo2 className="mr-2 h-4 w-4" />
                  {isRefreshingAfterReturn
                    ? "Refreshing..."
                    : isReceiptLoading
                    ? "Loading..."
                    : "Process Return"}
                </Button>
              )}

              {/* Update Payment */}
              {canManage && !isVoided && (
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={openPaymentDialog}
                >
                  <CreditCard className="mr-2 h-4 w-4" />
                  Update Payment
                </Button>
              )}

              {/* Void Transaction */}
              {canManage && !isVoided && (
                <Button
                  variant="destructive"
                  className="w-full justify-start"
                  onClick={() => setIsVoidDialogOpen(true)}
                >
                  <Ban className="mr-2 h-4 w-4" />
                  Void Transaction
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
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </BaseCard>
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
            <DialogTitle>Update Payment Details</DialogTitle>
            <DialogDescription>
              Change how or if this transaction was paid.
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

      {/* Return Dialog */}
      {returnCheckoutObj && (
        <ReturnDialog
          open={isReturnDialogOpen}
          onOpenChange={setIsReturnDialogOpen}
          checkout={returnCheckoutObj}
          onSuccess={handleReturnSuccess}
        />
      )}
    </div>
  );
}
