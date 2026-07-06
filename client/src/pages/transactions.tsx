import { useState, useMemo, useEffect } from "react";
import { startOfDay, endOfDay } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Receipt, Calendar, User, Package, Coins, CreditCard, ChevronRight, ShoppingBag, AlertCircle as AlertIcon, UserCheck } from "lucide-react";
import { ResolvePendingDialog } from "@/components/ResolvePendingDialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import { DateRangeFilter, type DateRange } from "@/components/date-range-filter";
import { CustomerPresenter, EntityDisplay } from "@/components/oop-ui/EntityDisplayPresenter";
import { ExportToolbar } from "@/components/export-toolbar";
import { MetricCard } from "@/components/metric-card";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { type TransactionWithRelations } from "@shared/schema";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, Clock } from "lucide-react";

const PAGE_LIMIT = 50;

export default function Transactions() {
  const { currentStore, stores } = useStore();
  const [, setLocation] = useLocation();

  // Resolve Pending inline dialog state
  const [resolveTx, setResolveTx] = useState<TransactionWithRelations | null>(null);

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

  const dateParams = useMemo(() => {
    const p = new URLSearchParams();
    if (dateRange.from) p.set("startDate", dateRange.from.toISOString());
    if (dateRange.to) p.set("endDate", dateRange.to.toISOString());
    return p.toString();
  }, [dateRange]);

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Reset page when date range or store changes
  useEffect(() => { setPage(1); }, [dateParams, currentStore?.id]);

  const { data: transactions = [], isLoading } = useQuery<TransactionWithRelations[]>({
    queryKey: ["/api/transactions", currentStore?.id, stores.map(s => s.id).join(","), dateParams, page],
    queryFn: async () => {
      if (currentStore?.id === "all" && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const res = await fetch(`/api/transactions?storeId=${s.id}&${dateParams}`);
              if (!res.ok) return [];
              const list = await res.json() as TransactionWithRelations[];
              return list.map(item => ({ ...item, storeName: s.name }));
            } catch {
              return [];
            }
          })
        );
        setTotalPages(1);
        return responses.flat().sort((a, b) => new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime());
      }
      const dateStr = dateParams ? `&${dateParams}` : "";
      const res = await fetch(`/api/transactions?storeId=${currentStore?.id}${dateStr}&page=${page}&limit=${PAGE_LIMIT}`);
      if (!res.ok) throw new Error("Failed to fetch transactions");
      const json = await res.json();
      if (Array.isArray(json)) {
        setTotalPages(1);
        return json;
      }
      setTotalPages(json.pagination?.totalPages ?? 1);
      return json.data as TransactionWithRelations[];
    },
    enabled: currentStore?.id === "all" ? stores.length > 0 : !!currentStore?.id,
    refetchInterval: 5 * 60 * 1000, // 5-min fallback; WS broadcasts handle live invalidation
  });

  // Query to fetch historical shift drawer sessions
  const { data: drawerSessions = [], isLoading: drawerLoading } = useQuery<any[]>({
    queryKey: ["/api/cash-register/sessions", currentStore?.id, stores.map(s => s.id).join(",")],
    queryFn: async () => {
      if (currentStore?.id === "all" && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const res = await fetch(`/api/cash-register/sessions?storeId=${s.id}`);
              if (!res.ok) return [];
              const list = await res.json() as any[];
              return list.map(item => ({ ...item, storeName: s.name }));
            } catch {
              return [];
            }
          })
        );
        return responses.flat().sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime());
      }
      const res = await fetch(`/api/cash-register/sessions?storeId=${currentStore?.id}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: currentStore?.id === "all" ? stores.length > 0 : !!currentStore?.id,
  });

  const closedSessions = useMemo(() => drawerSessions.filter((s: any) => s.status === "closed"), [drawerSessions]);
  const totalVariance = useMemo(() => closedSessions.reduce((sum: number, s: any) => sum + Number(s.difference || 0), 0), [closedSessions]);
  const activeSessionItem = useMemo(() => drawerSessions.find((s: any) => s.status === "open"), [drawerSessions]);

  const drawerColumns = [
    ...(currentStore?.id === "all" ? [{
      key: "storeName",
      header: "Store",
      render: (session: any) => (
        <Badge variant="outline" className="bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 font-medium font-outfit uppercase shrink-0">
          {session.storeName || "Global"}
        </Badge>
      ),
    }] : []),
    {
      key: "openedAt",
      header: "Shift Timing",
      render: (session: any) => (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 text-sm">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-semibold text-foreground">Opened: {formatDate(session.openedAt)}</span>
          </div>
          {session.status === "closed" && (
            <span className="text-[10px] text-muted-foreground pl-5 italic font-medium">
              Closed: {formatDate(session.closedAt)}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "openingFloat",
      header: "Base Float",
      render: (session: any) => (
        <span className="font-mono text-xs font-semibold text-foreground">{formatCurrency(Number(session.openingFloat))}</span>
      ),
    },
    {
      key: "expectedCash",
      header: "Expected Till",
      render: (session: any) => (
        <span className="font-mono text-xs font-semibold text-muted-foreground">{formatCurrency(Number(session.expectedCash))}</span>
      ),
    },
    {
      key: "actualCash",
      header: "Counted Till",
      render: (session: any) => (
        <span className="font-mono text-xs font-bold text-foreground">
          {session.status === "open" ? (
            <Badge variant="outline" className="text-[8px] font-bold border-none bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 uppercase tracking-wider px-2 py-0.5">
              ACTIVE
            </Badge>
          ) : (
            formatCurrency(Number(session.actualCash))
          )}
        </span>
      ),
    },
    {
      key: "difference",
      header: "Discrepancy (Drift)",
      render: (session: any) => {
        if (session.status === "open") {
          return (
            <Badge variant="outline" className="border-none font-bold text-[8px] uppercase bg-muted text-muted-foreground tracking-wider px-2 py-0.5">
              DRAWER OPEN
            </Badge>
          );
        }
        const diff = Number(session.difference || 0);
        return (
          <Badge
            variant="outline"
            className={`border-none font-bold text-[9px] uppercase tracking-wider px-2.5 py-0.5 ${
              diff === 0
                ? "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                : diff > 0
                ? "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-400"
                : "bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-400"
            }`}
          >
            {diff === 0
              ? "Balanced"
              : diff > 0
              ? `+${formatCurrency(diff)} (Surplus)`
              : `-${formatCurrency(Math.abs(diff))} (Shortage)`}
          </Badge>
        );
      },
    },
    {
      key: "notes",
      header: "Reconciliation Remarks",
      render: (session: any) => (
        <span className="text-xs text-muted-foreground truncate max-w-[180px] block font-medium">
          {session.notes || "No closing remarks logged."}
        </span>
      ),
    },
  ];

  const [staffSaleFilter, setStaffSaleFilter] = useState<"all" | "staff" | "regular">("all");

  // Apply staff sale filter on top of date-range results
  const filteredTransactions = useMemo(() => {
    if (staffSaleFilter === "staff") return transactions.filter(tx => !!(tx.customer as any)?.staffId);
    if (staffSaleFilter === "regular") return transactions.filter(tx => !(tx.customer as any)?.staffId);
    return transactions;
  }, [transactions, staffSaleFilter]);


  const storeCurrency = currentStore?.currency || "NGN";
  
  const formatCurrency = (value: number, currency: string = storeCurrency) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: currency,
    }).format(value);
  };

  const formatDualCurrency = (value: number, isVoided: boolean = false) => {
    return (
      <div className={`flex flex-col ${isVoided ? "opacity-50 line-through" : ""}`}>
        <span className="font-mono font-medium">{formatCurrency(value, storeCurrency)}</span>
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

  // De-duplicate by receipt number to avoid counting multi-item checkouts multiple times.
  // Each transaction row is one line-item; tx.amount is its individual amount.
  // For receipt-level metrics (revenue, count) we collapse to unique receipts.
  const uniqueReceipts = useMemo(() => {
    const seen = new Map<string, TransactionWithRelations>();
    for (const tx of filteredTransactions) {
      const key = tx.checkout?.receiptNumber ?? tx.checkoutId;
      if (!seen.has(key)) seen.set(key, tx);
    }
    return Array.from(seen.values());
  }, [filteredTransactions]);

  const totalAmount = uniqueReceipts.reduce(
    (sum, tx) => sum + (!tx.checkout?.isVoided ? (tx.checkout?.totalCharged ?? tx.checkout?.totalPrice ?? 0) : 0),
    0
  );

  const totalRefunded = uniqueReceipts.reduce(
    (sum, tx) => sum + (!tx.checkout?.isVoided ? (tx.checkout?.refundedAmount ?? 0) : 0),
    0
  );

  const actualRevenueNet = totalAmount - totalRefunded;

  const nonVoidedCount = uniqueReceipts.filter(tx => !tx.checkout?.isVoided).length;

  const paymentBadgeClass = (method: string) => {
    const m = (method ?? "cash").toLowerCase();
    if (m === "cash") return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/30";
    if (m === "transfer" || m === "bank transfer") return "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900/30";
    if (m === "pos" || m === "card") return "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-400 dark:border-purple-900/30";
    if (m === "flutterwave") return "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-900/30";
    if (m === "split") return "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-400 dark:border-indigo-900/30";
    return "bg-muted text-muted-foreground border-border";
  };

  const columns = [
    ...(currentStore?.id === "all" ? [{
      key: "storeName",
      header: "Store",
      render: (tx: any) => (
        <Badge variant="outline" className="bg-slate-900/40 border-slate-800 text-xs text-slate-300 font-medium font-outfit uppercase shrink-0">
          {tx.storeName || "Global"}
        </Badge>
      ),
    }] : []),
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
      render: (tx: TransactionWithRelations) => {
        const isVoided = tx.checkout?.isVoided;
        const returnedQty = tx.checkout?.returnedQuantity ?? 0;
        const soldQty = tx.checkout?.quantity ?? 1;
        const isFullyReturned = !isVoided && returnedQty >= soldQty;
        const isPartiallyReturned = !isVoided && !isFullyReturned && returnedQty > 0;
        const itemCount = (tx.checkout as any).basketItemCount ?? 1;

        return (
          <div className="flex flex-col gap-1 items-start">
            <span className="font-mono text-sm">{tx.checkout?.receiptNumber}</span>
            {itemCount > 1 && (
              <span className="text-[10px] text-muted-foreground font-medium">
                {itemCount} items in basket
              </span>
            )}
            {isVoided && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">VOID</Badge>
            )}
            {isFullyReturned && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 h-4 border-red-300 text-red-600 bg-red-50 dark:bg-red-950/20 dark:border-red-900/30 font-semibold animate-pulse"
              >
                RETURNED
              </Badge>
            )}
            {isPartiallyReturned && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 h-4 border-orange-300 text-orange-600 bg-orange-50 dark:bg-orange-950/20 dark:border-orange-900/30 font-semibold"
              >
                PARTIAL RETURN
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      key: "customer",
      header: "Customer",
      render: (tx: TransactionWithRelations) => {
        const presenter = new CustomerPresenter({
          name: tx.customer?.name || "Unknown",
          customerNumber: tx.customer?.customerNumber || tx.customerId || "—",
          mobileNumber: tx.customer?.mobileNumber,
          staffId: (tx.customer as any)?.staffId,
        });
        return (
          <div className="flex items-center gap-2">
            <User className="h-3 w-3 text-muted-foreground text-opacity-70" />
            <EntityDisplay presenter={presenter} />
          </div>
        );
      },
    },
    {
      key: "inventory",
      header: "Item",
      render: (tx: TransactionWithRelations) => {
        const badgeLabel = tx.inventory?.type ?? "unknown";
        const badgeClass = badgeLabel === "mixed"
          ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-800"
          : badgeLabel === "service"
          ? "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-400 dark:border-violet-900/30"
          : badgeLabel === "product"
          ? "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-400 dark:border-sky-900/30"
          : "";

        const extraItems = ((tx.checkout as any).basketItemCount ?? 1) - 1;

        return (
          <div className="flex items-center gap-2">
            <Package className="h-3 w-3 text-muted-foreground" />
            <div>
              <div className="flex items-baseline gap-1.5">
                <p className="font-medium text-sm">{tx.inventory?.name ?? "Unknown"}</p>
                {extraItems > 0 && (
                  <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                    +{extraItems} more
                  </span>
                )}
              </div>
              <Badge variant="outline" className={`text-xs capitalize mt-1 ${badgeClass}`}>
                {badgeLabel}
              </Badge>
            </div>
          </div>
        );
      },
    },
    {
      key: "staffName",
      header: "Billed By",
      render: (tx: TransactionWithRelations) => (
        <div className="flex items-center gap-1.5">
          <User className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="text-sm">{tx.checkout?.staff?.name ?? "—"}</span>
        </div>
      ),
    },
    {
      key: "paymentMethod",
      header: "Payment",
      render: (tx: TransactionWithRelations) => (
        <div className="flex flex-col gap-1 items-start">
          <div className="flex items-center gap-1.5">
            <CreditCard className="h-3 w-3 text-muted-foreground" />
            <Badge
              variant="outline"
              className={`capitalize text-xs font-semibold border ${paymentBadgeClass(tx.checkout?.paymentMethod ?? "cash")}`}
            >
              {tx.checkout?.paymentMethod ?? "cash"}
            </Badge>
          </div>
          {tx.checkout?.paymentStatus === "pending" && !tx.checkout?.isVoided && (
            <button
              className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-950/40 transition-colors"
              onClick={(e) => { e.stopPropagation(); setResolveTx(tx); }}
              title="Resolve pending payment"
            >
              PENDING · Resolve
            </button>
          )}
        </div>
      ),
    },
    {
      key: "amount",
      header: "Line Amount",
      render: (tx: TransactionWithRelations) => (
        // tx.amount is the per-line-item amount set at checkout time.
        // tx.checkout.totalPrice is the full basket total — NOT shown here.
        <div className="flex items-center justify-between gap-2">
          {formatDualCurrency(tx.amount ?? 0, tx.checkout?.isVoided)}
          <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
        </div>
      ),
    },
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
      status: tx.checkout?.isVoided
        ? "Void"
        : (tx.checkout?.returnedQuantity && tx.checkout.returnedQuantity >= (tx.checkout.quantity ?? 1)
          ? "Returned"
          : (tx.checkout?.returnedQuantity && tx.checkout.returnedQuantity > 0
            ? "Partially Returned"
            : (tx.checkout?.paymentStatus === "pending" ? "Pending" : "Paid")
          )
        ),
      paymentMethod: tx.checkout?.paymentMethod || "cash",
      staffName: tx.checkout?.staff?.name || "Unknown",
      // Flatten frequently searched nested fields so DataTable can search them directly
      receiptNumber: tx.checkout?.receiptNumber ?? "",
      customerName: tx.customer?.name ?? "",
      inventoryName: tx.inventory?.name ?? "",
      amount: tx.amount ?? 0,
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
    { key: "amount", label: "Line Amount", type: "range" as const, currencySymbol: storeCurrency === "USD" ? "$" : "₦" }
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

      <Tabs defaultValue="transactions" className="space-y-6">
        <TabsList>
          <TabsTrigger value="transactions">Sales Ledger</TabsTrigger>
          <TabsTrigger value="drawer-shifts">Register Shifts</TabsTrigger>
        </TabsList>

        <TabsContent value="transactions" className="space-y-6 animate-in fade-in duration-300">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              title="Valid Transactions"
              value={nonVoidedCount}
              icon={<Receipt className="h-4 w-4" />}
              isLoading={isLoading}
            />
            <MetricCard
              title="Gross Revenue"
              value={formatCurrency(totalAmount)}
              description="Revenue before returns"
              icon={<Coins className="h-4 w-4" />}
              isLoading={isLoading}
            />
            <MetricCard
              title="Actual Revenue (Net)"
              value={formatCurrency(actualRevenueNet)}
              description={totalRefunded > 0 ? `Refunded: ${formatCurrency(totalRefunded)}` : "Net revenue after returns"}
              icon={<Coins className="h-4 w-4" />}
              isLoading={isLoading}
            />
            <MetricCard
              title="Avg. Transaction (Net)"
              value={formatCurrency(
                nonVoidedCount > 0 ? actualRevenueNet / nonVoidedCount : 0
              )}
              icon={<Coins className="h-4 w-4" />}
              isLoading={isLoading}
            />
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
              <CardTitle className="text-base font-medium">Transaction History</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 rounded-md border bg-background p-1">
                  {(["all", "staff", "regular"] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setStaffSaleFilter(opt)}
                      className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                        staffSaleFilter === opt
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {opt === "staff" && <UserCheck className="h-3 w-3" />}
                      {opt === "all" ? "All Sales" : opt === "staff" ? "Staff Sales" : "Regular"}
                    </button>
                  ))}
                </div>
                <DateRangeFilter
                  dateRange={dateRange}
                  onDateRangeChange={setDateRange}
                  defaultPreset="today"
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
                searchPlaceholder="Search receipt no., customer, item or staff..."
                searchKeys={["receiptNumber", "customerName", "inventoryName", "staffName", "paymentMethod"]}
                isLoading={isLoading}
                emptyTitle="No Transactions"
                emptyMessage="No transactions found for the selected date range. Try adjusting the filters or date range."
                emptyIcon={<ShoppingBag className="h-6 w-6" />}
                onRowClick={(tx) => setLocation("/transactions/" + tx.id)}
                filterConfigs={filterConfigs}
              />
              {currentStore?.id !== "all" && totalPages > 1 && (
                <Pagination className="mt-4">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        aria-disabled={page === 1}
                        className={page === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                      />
                    </PaginationItem>
                    <PaginationItem>
                      <span className="px-3 py-2 text-sm text-muted-foreground">
                        Page {page} of {totalPages}
                      </span>
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationNext
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        aria-disabled={page === totalPages}
                        className={page === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="drawer-shifts" className="space-y-6 animate-in fade-in duration-300">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard
              title="Shift Sessions Run"
              value={drawerSessions.length}
              icon={<Clock className="h-4 w-4" />}
              isLoading={drawerLoading}
            />
            <MetricCard
              title="Accumulated Drawer Variance"
              value={formatCurrency(totalVariance)}
              icon={<Coins className="h-4 w-4" />}
              isLoading={drawerLoading}
            />
            <MetricCard
              title="Active Shift Session"
              value={activeSessionItem ? "SHIFT DRAW ACTIVE" : "ALL SHIFTS AUDITED"}
              icon={<AlertCircle className="h-4 w-4" />}
              isLoading={drawerLoading}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base font-medium">Drawer Shifts & Reconciliations</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                data={drawerSessions}
                columns={drawerColumns}
                searchable
                searchPlaceholder="Search shift remarks..."
                searchKeys={["notes"]}
                isLoading={drawerLoading}
                emptyMessage="No historical cash register sessions found for this branch."
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Resolve Pending Payment — inline from transactions list */}
      {resolveTx && resolveTx.checkout?.id && resolveTx.customer?.id && (
        <ResolvePendingDialog
          open={!!resolveTx}
          onOpenChange={(v) => { if (!v) setResolveTx(null); }}
          checkoutId={resolveTx.checkout.id}
          receiptNumber={resolveTx.checkout.receiptNumber ?? ""}
          amountOwed={Number(resolveTx.checkout.totalPrice ?? resolveTx.amount ?? 0)}
          customerId={resolveTx.customer.id}
          customerName={resolveTx.customer.name ?? "Customer"}
          storeId={resolveTx.checkout.storeId ?? currentStore?.id ?? ""}
          storeCurrency={currentStore?.currency ?? "NGN"}
          onResolved={() => setResolveTx(null)}
        />
      )}
    </div>
  );
}
