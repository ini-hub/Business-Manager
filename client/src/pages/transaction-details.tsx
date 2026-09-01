import { useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  Calendar,
  User,
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
  Plus,
  Droplet,
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

  // Basket total = sum of each line's totalCharged (the per-line post-discount amount).
  // DO NOT use primaryCheckout.totalCharged — it is only this one checkout's line amount.
  // primaryCheckout.subtotal IS the basket pre-discount total (stored on every checkout row).
  const receiptTotal =
    receiptDetails?.items?.length > 0
      ? receiptDetails.items.reduce(
          (sum: number, item: any) =>
            sum + Number(item.checkout?.totalCharged || item.checkout?.totalPrice || 0),
          0
        )
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

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Back Navigation */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild className="shrink-0">
          <Link href={backHref}>
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
                    {tx.checkout?.staff?.id ? (
                      <EntityLink href={`/staffs/${tx.checkout.staff.id}/edit`} className="font-semibold text-primary">
                        {tx.checkout.staff.name}
                      </EntityLink>
                    ) : (
                      <p className="font-semibold">{tx.checkout?.staff?.name ?? "Unknown"}</p>
                    )}
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
                    {tx.customer?.id ? (
                      <EntityLink
                        href={`/customers/${buildSlug(tx.customer.name, tx.customer.id)}`}
                        className="font-semibold text-primary"
                      >
                        {tx.customer.name}
                      </EntityLink>
                    ) : (
                      <p className="font-semibold">Unknown</p>
                    )}
                    <p className="text-xs text-muted-foreground font-mono">
                      {tx.customer?.customerNumber}
                    </p>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Payment Method & Receipt Total */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
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

                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-600 shrink-0">
                    <Coins className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-muted-foreground">Receipt Total</p>
                    <p
                      className={`font-bold text-2xl ${isVoided ? "line-through text-muted-foreground" : ""}`}
                    >
                      {isReceiptLoading ? (
                        <span className="text-muted-foreground text-base">Loading…</span>
                      ) : (
                        formatCurrency(receiptTotal)
                      )}
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
                    <div className="rounded-lg border bg-card overflow-x-auto">
                      <table className="w-full min-w-[480px] text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-muted/40 border-b border-muted/50 font-semibold text-muted-foreground">
                            <th className="p-3">Item</th>
                            <th className="p-3 text-center">Qty</th>
                            <th className="p-3 text-right">Unit Price</th>
                            <th className="p-3 text-right">Total</th>
                            <th className="p-3 text-center">Returned</th>
                            {canManage && !isVoided && <th className="p-3 text-center">Supplies</th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-muted/40">
                          {receiptDetails.items.map((item: any) => {
                            const unitPrice = item.order.quantity > 0 ? (item.checkout.totalPrice / item.order.quantity) : 0;
                            const returnedQty = item.order.returnedQuantity || 0;
                            return (
                              <tr key={item.order.id} className="hover:bg-muted/10 transition-colors">
                                <td className="p-3">
                                  {item.inventory?.id ? (
                                    <EntityLink href={`/inventory/${buildSlug(item.inventory.name, item.inventory.id)}`}>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <p className="font-medium text-foreground truncate max-w-[220px]">{item.inventory.name}</p>
                                        </TooltipTrigger>
                                        <TooltipContent>{item.inventory.name}</TooltipContent>
                                      </Tooltip>
                                    </EntityLink>
                                  ) : (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <p className="font-medium text-foreground truncate max-w-[220px]">{item.inventory?.name || "Unknown Item"}</p>
                                      </TooltipTrigger>
                                      <TooltipContent>{item.inventory?.name || "Unknown Item"}</TooltipContent>
                                    </Tooltip>
                                  )}
                                  <Badge variant="outline" className={`text-[10px] py-0 px-1 capitalize mt-0.5 ${
                                    item.inventory?.type === "service" ? "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-400 dark:border-violet-900/30"
                                    : item.inventory?.type === "mixed" ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-800"
                                    : "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-400 dark:border-sky-900/30"}`}>
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
                                {canManage && !isVoided && (
                                  <td className="p-3 text-center">
                                    {item.inventory?.type === "service" && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
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
                                  </td>
                                )}
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

              {/* Process Return — hidden when all items already returned */}
              {canManage && !isVoided && !isFullyReturned && (
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

              {/* Resolve Pending — shown only while payment is pending and transaction is active */}
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

              {/* Update Payment — for completed transactions (method correction) and fully-returned record correction */}
              {canManage && !isVoided && tx.checkout?.paymentStatus !== "pending" && (
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={openPaymentDialog}
                >
                  <CreditCard className="mr-2 h-4 w-4" />
                  {isFullyReturned ? "Correct Payment Record" : "Update Payment"}
                </Button>
              )}

              {/* Edit Transaction Date — owner only, post-sale correction */}
              {canEditDate && !isVoided && (
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={openEditDateDialog}
                >
                  <Calendar className="mr-2 h-4 w-4" />
                  Edit Transaction Date
                </Button>
              )}

              {/* Add Missed Item — only for non-voided, non-pending receipts */}
              {canManage && !isVoided && tx.checkout?.paymentStatus !== "pending" && (
                <Button
                  variant="outline"
                  className="w-full justify-start border-blue-200 hover:bg-blue-50 hover:text-blue-700 text-blue-700 dark:border-blue-900/30 dark:hover:bg-blue-950/20"
                  onClick={() => setIsAddendumOpen(true)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Missed Item
                </Button>
              )}

              {/* Void Transaction — blocked when fully returned: stock & refunds already reversed
                  by the return process; voiding on top would cause double-inventory entries */}
              {canManage && !isVoided && !isFullyReturned && (
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
