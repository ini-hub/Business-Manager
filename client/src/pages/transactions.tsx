import { useState, useMemo } from "react";
import { startOfDay, endOfDay } from "date-fns";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Receipt, Calendar, User, Package, Coins, CreditCard, Hash, AlertCircle, X, Printer, Ban, Edit } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Link } from "wouter";
import { DateRangeFilter, type DateRange } from "@/components/date-range-filter";
import { ExportToolbar } from "@/components/export-toolbar";
import { MetricCard } from "@/components/metric-card";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ReceiptModal } from "@/components/receipt-modal";
import { type TransactionWithRelations, VOID_REASON_PRESETS } from "@shared/schema";

export default function Transactions() {
  const { currentStore } = useStore();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const userRole = user?.role || "staff";
  const canManage = userRole === "manager" || userRole === "owner";

  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const params = new URLSearchParams(window.location.search);
    const startDateParam = params.get("startDate");
    const endDateParam = params.get("endDate");
    if (startDateParam && endDateParam) {
      return {
        from: startOfDay(new Date(startDateParam)),
        to: endOfDay(new Date(endDateParam))
      };
    }
    return {
      from: startOfDay(new Date()),
      to: endOfDay(new Date()),
    };
  });
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionWithRelations | null>(null);

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

  const { data: transactions = [], isLoading } = useQuery<TransactionWithRelations[]>({
    queryKey: ["/api/transactions", currentStore?.id],
    enabled: !!currentStore?.id,
    refetchInterval: 20000, // Refetch transactions list in background every 20 seconds
  });

  const filteredTransactions = useMemo(() => {
    if (!dateRange.from && !dateRange.to) return transactions;

    return transactions.filter((tx) => {
      const txDate = new Date(tx.transactionDate);
      if (dateRange.from && txDate < dateRange.from) return false;
      if (dateRange.to && txDate > dateRange.to) return false;
      return true;
    });
  }, [transactions, dateRange]);

  const storeCurrency = currentStore?.currency || "NGN";
  
  const formatCurrency = (value: number, currency: string = storeCurrency) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: currency,
    }).format(value);
  };

  const formatDualCurrency = (value: number, isVoided: boolean = false) => {
    const primaryAmount = formatCurrency(value, storeCurrency);
    let usdAmount = null;
    
    if (storeCurrency !== "USD") {
      const usdRate = 1500;
      usdAmount = formatCurrency(value / usdRate, "USD");
    }

    return (
      <div className={`flex flex-col ${isVoided ? "opacity-50 line-through" : ""}`}>
        <span className="font-mono font-medium">{primaryAmount}</span>
        {usdAmount && <span className="text-xs text-muted-foreground font-mono">{usdAmount}</span>}
      </div>
    );
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

  const totalAmount = filteredTransactions.reduce(
    (sum, tx) => sum + (!tx.checkout?.isVoided ? (tx.checkout?.totalPrice ?? 0) : 0),
    0
  );
  
  const nonVoidedCount = filteredTransactions.filter(tx => !tx.checkout?.isVoided).length;

  const voidMutation = useMutation({
    mutationFn: async (params: { checkoutId: string; reason: string }) => {
      const res = await apiRequest("POST", `/api/transactions/${params.checkoutId}/void`, { reason: params.reason });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions", currentStore?.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/profit-loss"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast({ title: "Transaction voided successfully" });
      setIsVoidDialogOpen(false);
      setSelectedTransaction(null);
      setVoidReason("");
      setCustomVoidReason("");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to void transaction", description: error.message, variant: "destructive" });
    }
  });

  const paymentMutation = useMutation({
    mutationFn: async (params: { checkoutId: string; paymentMethod: string; paymentStatus: string }) => {
      const res = await apiRequest("PATCH", `/api/transactions/${params.checkoutId}/payment-status`, {
        paymentMethod: params.paymentMethod,
        paymentStatus: params.paymentStatus,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions", currentStore?.id] });
      toast({ title: "Payment status updated" });
      setIsPaymentDialogOpen(false);
      setSelectedTransaction(null);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update payment", description: error.message, variant: "destructive" });
    }
  });

  const handleVoidConfirm = () => {
    if (!selectedTransaction?.checkout?.id) return;
    const reasonToSubmit = voidReason === "Other" ? customVoidReason : voidReason;
    if (!reasonToSubmit) {
      toast({ title: "Reason required", description: "Please select or enter a void reason.", variant: "destructive" });
      return;
    }
    voidMutation.mutate({ checkoutId: selectedTransaction.checkout.id, reason: reasonToSubmit });
  };

  const handlePaymentUpdateConfirm = () => {
    if (!selectedTransaction?.checkout?.id) return;
    paymentMutation.mutate({
      checkoutId: selectedTransaction.checkout.id,
      paymentMethod: editPaymentMethod,
      paymentStatus: editPaymentStatus,
    });
  };

  const openPaymentDialog = (tx: TransactionWithRelations) => {
    setEditPaymentMethod(tx.checkout?.paymentMethod ?? "cash");
    setEditPaymentStatus(tx.checkout?.paymentStatus ?? "completed");
    setIsPaymentDialogOpen(true);
  };

  const columns = [
    {
      key: "transactionDate",
      header: "Date",
      render: (tx: TransactionWithRelations) => (
        <div className="flex items-center gap-2">
          <Calendar className="h-3 w-3 text-muted-foreground" />
          <span className="text-sm">{formatDate(tx.transactionDate)}</span>
        </div>
      ),
    },
    {
      key: "receiptNumber",
      header: "Receipt No.",
      render: (tx: TransactionWithRelations) => (
        <div className="flex flex-col gap-1 items-start">
          <span className="font-mono text-sm">{tx.checkout?.receiptNumber}</span>
          {tx.checkout?.isVoided && (
             <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">VOID</Badge>
          )}
        </div>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      render: (tx: TransactionWithRelations) => (
        <div className="flex items-center gap-2">
          <User className="h-3 w-3 text-muted-foreground" />
          <div>
            <p className="font-medium text-sm">{tx.customer?.name ?? "Unknown"}</p>
            <p className="text-xs text-muted-foreground">{tx.customer?.customerNumber}</p>
          </div>
        </div>
      ),
    },
    {
      key: "inventory",
      header: "Item",
      render: (tx: TransactionWithRelations) => (
        <div className="flex items-center gap-2">
          <Package className="h-3 w-3 text-muted-foreground" />
          <div>
            <p className="font-medium text-sm">{tx.inventory?.name ?? "Unknown"}</p>
            <Badge variant="outline" className="text-xs capitalize mt-1">
              {tx.inventory?.type ?? "unknown"}
            </Badge>
          </div>
        </div>
      ),
    },
    {
      key: "paymentMethod",
      header: "Payment",
      render: (tx: TransactionWithRelations) => (
        <div className="flex flex-col gap-1 items-start">
          <div className="flex items-center gap-2">
            <CreditCard className="h-3 w-3 text-muted-foreground" />
            <Badge variant="secondary" className="capitalize">
              {tx.checkout?.paymentMethod ?? "cash"}
            </Badge>
          </div>
          {tx.checkout?.paymentStatus === "pending" && !tx.checkout?.isVoided && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-amber-600 border-amber-300 bg-amber-50">
              PENDING
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: "checkout",
      header: "Amount",
      render: (tx: TransactionWithRelations) => (
        <div className="flex items-center gap-2">
          {formatDualCurrency(tx.checkout?.totalPrice ?? 0, tx.checkout?.isVoided)}
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (tx: TransactionWithRelations) => (
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={(e) => { e.stopPropagation(); setReceiptCheckoutId(tx.checkout?.id || null); }}
        >
          <Printer className="h-4 w-4 text-muted-foreground" />
        </Button>
      ),
    }
  ];

  const exportColumns = [
    { key: "checkout.receiptNumber", header: "Transaction No." },
    { key: "transactionDate", header: "Date" },
    { key: "customer.name", header: "Customer Name" },
    { key: "customer.customerNumber", header: "Customer Number" },
    { key: "checkout.staff.name", header: "Billed By" },
    { key: "checkout.staff.staffNumber", header: "Staff ID" },
    { key: "inventory.name", header: "Item Name" },
    { key: "inventory.type", header: "Item Type" },
    { key: "checkout.totalPrice", header: "Amount" },
    { key: "checkout.isVoided", header: "Voided" },
  ];

  const exportData = filteredTransactions.map((tx) => ({
    id: tx.id,
    transactionDate: new Date(tx.transactionDate).toLocaleString(),
    customer: tx.customer,
    inventory: tx.inventory,
    checkout: {
      ...tx.checkout,
      isVoided: tx.checkout?.isVoided ? "Yes" : "No"
    },
  }));

  const tableData = useMemo(() => {
    return filteredTransactions.map((tx) => ({
      ...tx,
      status: tx.checkout?.isVoided ? "Void" : (tx.checkout?.paymentStatus === "pending" ? "Pending" : "Paid"),
      paymentMethod: tx.checkout?.paymentMethod || "cash",
      staffName: tx.checkout?.staff?.name || "Unknown",
      amount: tx.checkout?.totalPrice ?? 0
    }));
  }, [filteredTransactions]);

  const filterConfigs = [
    { key: "status", label: "Status", type: "select" as const },
    { 
      key: "paymentMethod", 
      label: "Payment Method", 
      type: "select" as const,
      valueMapper: (val: any) => {
        if (!val) return "Unknown";
        const str = String(val).toLowerCase();
        if (str === "cash") return "Cash";
        if (str === "transfer" || str === "bank transfer") return "Transfer";
        if (str === "pos" || str === "card") return "POS";
        return String(val).charAt(0).toUpperCase() + String(val).slice(1);
      }
    },
    { key: "staffName", label: "Staff", type: "select" as const },
    { key: "amount", label: "Amount", type: "range" as const, currencySymbol: storeCurrency === "USD" ? "$" : "₦" }
  ];

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Transactions"
          description="View all sales transactions"
        />
        <StoreRequiredAlert title="Store Required for Transactions" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transactions"
        description={`Sales transactions for ${currentStore.name}`}
        actions={
          <Button asChild data-testid="button-new-sale">
            <Link href="/sales/new">
              <Receipt className="mr-2 h-4 w-4" />
              New Sale
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          title="Valid Transactions"
          value={nonVoidedCount}
          icon={<Receipt className="h-4 w-4" />}
          isLoading={isLoading}
        />
        <MetricCard
          title="Valid Revenue"
          value={formatCurrency(totalAmount)}
          icon={<Coins className="h-4 w-4" />}
          isLoading={isLoading}
        />
        <MetricCard
          title="Avg. Transaction"
          value={formatCurrency(
            nonVoidedCount > 0 ? totalAmount / nonVoidedCount : 0
          )}
          icon={<Coins className="h-4 w-4" />}
          isLoading={isLoading}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
          <CardTitle className="text-base font-medium">Transaction History</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <DateRangeFilter
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
            />
            <ExportToolbar
              data={exportData as unknown as Record<string, unknown>[]}
              columns={exportColumns}
              filename="transactions"
              title="Transaction Report"
              disabled={isLoading}
            />
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            data={tableData}
            columns={columns}
            searchable
            searchPlaceholder="Search receipt, customer, item, payment..."
            searchKeys={["checkout.receiptNumber", "customer.name", "inventory.name", "paymentMethod"]}
            isLoading={isLoading}
            emptyMessage="No transactions found. Complete your first sale to see records here."
            onRowClick={(tx) => setSelectedTransaction(tx)}
            filterConfigs={filterConfigs}
          />
        </CardContent>
      </Card>

      <Dialog open={!!selectedTransaction} onOpenChange={(open) => !open && setSelectedTransaction(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between pr-6">
              <div className="flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                Transaction Details
              </div>
              {selectedTransaction?.checkout?.isVoided && (
                <Badge variant="destructive">VOIDED</Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              Full details for this transaction
            </DialogDescription>
          </DialogHeader>
          {selectedTransaction && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Hash className="h-3 w-3" />
                    Transaction No.
                  </p>
                  <p className="font-mono text-xs break-all" data-testid="text-tx-id">
                    {selectedTransaction.checkout?.receiptNumber}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    Date
                  </p>
                  <p className="text-sm">
                    {formatDate(selectedTransaction.transactionDate)}
                  </p>
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <User className="h-3 w-3" />
                    Customer
                  </p>
                  <div>
                    <p className="font-medium">{selectedTransaction.customer?.name ?? "Unknown"}</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {selectedTransaction.customer?.customerNumber}
                    </p>
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <User className="h-3 w-3" />
                    Billed By
                  </p>
                  <div>
                    <p className="font-medium">{selectedTransaction.checkout?.staff?.name ?? "Unknown"}</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {selectedTransaction.checkout?.staff?.staffNumber ?? "N/A"}
                    </p>
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Package className="h-3 w-3" />
                    Item
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{selectedTransaction.inventory?.name ?? "Unknown"}</span>
                    <Badge variant="outline" className="capitalize">
                      {selectedTransaction.inventory?.type ?? "unknown"}
                    </Badge>
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <CreditCard className="h-3 w-3" />
                    Payment Method
                  </p>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="capitalize">
                      {selectedTransaction.checkout?.paymentMethod ?? "cash"}
                    </Badge>
                    {selectedTransaction.checkout?.paymentStatus === "pending" && (
                      <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">
                        PENDING
                      </Badge>
                    )}
                    {canManage && !selectedTransaction.checkout?.isVoided && (
                      <Button variant="ghost" size="icon" className="h-6 w-6 ml-auto" onClick={() => openPaymentDialog(selectedTransaction)}>
                        <Edit className="h-3 w-3 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Total Amount
                </p>
                <div className="text-lg font-bold flex items-center gap-2">
                  <span className={selectedTransaction.checkout?.isVoided ? "line-through text-muted-foreground" : ""}>
                    {formatCurrency(selectedTransaction.checkout?.totalPrice ?? 0)}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col gap-2 pt-2">
                <Button 
                  variant="outline" 
                  className="w-full justify-start"
                  onClick={() => {
                    setReceiptCheckoutId(selectedTransaction.checkout?.id || null);
                    setSelectedTransaction(null);
                  }}
                >
                  <Printer className="mr-2 h-4 w-4" />
                  View Receipt
                </Button>
                
                {canManage && !selectedTransaction.checkout?.isVoided && (
                  <Button 
                    variant="destructive" 
                    className="w-full justify-start"
                    onClick={() => setIsVoidDialogOpen(true)}
                  >
                    <Ban className="mr-2 h-4 w-4" />
                    Void Transaction
                  </Button>
                )}

                {user?.role === "owner" && selectedTransaction.checkout?.isVoided && (
                  <div className="mt-4 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-md">
                    <h4 className="text-xs font-semibold text-red-800 dark:text-red-400 mb-1 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      Void Log
                    </h4>
                    <div className="text-xs space-y-1 text-red-700 dark:text-red-300">
                      <p><span className="font-medium">Date:</span> {selectedTransaction.checkout.voidedAt ? formatDate(selectedTransaction.checkout.voidedAt) : "Unknown"}</p>
                      <p><span className="font-medium">Reason:</span> {selectedTransaction.checkout.voidReason || "None provided"}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Receipt Modal */}
      <ReceiptModal
        checkoutId={receiptCheckoutId}
        open={!!receiptCheckoutId}
        onClose={() => setReceiptCheckoutId(null)}
      />

      {/* Void Dialog */}
      <AlertDialog open={isVoidDialogOpen} onOpenChange={setIsVoidDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void Transaction</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to void this transaction? This will reverse any revenue and restore product stock. If this is part of a paid payroll, it will create a deduction next period.
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
                    <SelectItem key={reason} value={reason}>{reason}</SelectItem>
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
              disabled={voidMutation.isPending || !voidReason || (voidReason === "Other" && !customVoidReason.trim())}
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
            <Button variant="outline" onClick={() => setIsPaymentDialogOpen(false)} disabled={paymentMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={handlePaymentUpdateConfirm} disabled={paymentMutation.isPending}>
              {paymentMutation.isPending ? "Updating..." : "Save Changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
