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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BaseCard } from "@/components/oop-ui/BaseCard";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
                    <p className="text-sm text-muted-foreground">Qty / Units</p>
                    <p className="font-semibold text-lg">{tx.amount}</p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-600 shrink-0">
                    <Coins className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Amount</p>
                    <p
                      className={`font-bold text-2xl ${isVoided ? "line-through text-muted-foreground" : ""}`}
                    >
                      {formatCurrency(tx.checkout?.totalPrice ?? 0)}
                    </p>
                    {storeCurrency !== "USD" && (
                      <p className="text-xs text-muted-foreground font-mono">
                        {formatCurrency((tx.checkout?.totalPrice ?? 0) / 1500, "USD")}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </BaseCard>
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

              {/* Void Log — Owner only */}
              {isVoided && user?.role === "owner" && (
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
    </div>
  );
}
