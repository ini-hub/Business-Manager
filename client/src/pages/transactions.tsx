import { useState, useMemo, useEffect } from "react";
import { startOfDay, endOfDay, format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Receipt, Calendar, User, Package, Coins, CreditCard, ChevronRight, ShoppingBag, AlertCircle as AlertIcon, UserCheck, Search, SlidersHorizontal, X, RotateCcw, Wallet } from "lucide-react";
import { ResolvePendingDialog } from "@/components/ResolvePendingDialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Link, useLocation, useSearch } from "wouter";
import { DateRangeFilter, type DateRange } from "@/components/date-range-filter";
import { usePersistedDateRange, readPersistedRange } from "@/hooks/use-persisted-date-range";
import { useUrlState } from "@/hooks/use-url-state";
import { CustomerLink, EntityLink } from "@/components/oop-ui/EntityDisplayPresenter";
import { appendReturnTo } from "@/lib/return-to";
import { buildSlug } from "@/lib/slug";
import { ExportToolbar } from "@/components/export-toolbar";
import { MetricCard } from "@/components/metric-card";
import { MetricGrid } from "@/components/metric-grid";
import { formatCurrencyCompact } from "@/lib/currency-utils";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { type TransactionWithRelations } from "@shared/schema";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PolymorphicTabsList } from "@/components/oop-ui/PolymorphicTabsList";
import { AlertCircle, Clock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ClearableInput } from "@/components/clearable-input";
import { cn } from "@/lib/utils";
import {
  type SaleFilterState,
  type SaleSortState,
  EMPTY_SALE_FILTERS,
  saleMatchesFilters,
  countActiveSaleFilters,
  buildSaleFilterChips,
  clearSaleFilterChip,
  sortSales,
  saleSortLabel,
} from "@/lib/sale-filters";
import { SaleFiltersSheet } from "@/components/sale-filter-sheet";

const PAGE_LIMIT = 50;

export default function Transactions() {
  const { currentStore, stores, business } = useStore();
  const [location, setLocation] = useLocation();
  const search = useSearch();

  // Resolve Pending inline dialog state
  const [resolveTx, setResolveTx] = useState<TransactionWithRelations | null>(null);

  const [dateRange, setDateRange] = usePersistedDateRange<DateRange>(
    "transactions_date_range",
    () => {
      const params = new URLSearchParams(window.location.search);
      const startDateParam = params.get("startDate");
      const endDateParam = params.get("endDate");
      if (startDateParam && endDateParam) {
        return {
          from: startOfDay(new Date(startDateParam)),
          to: endOfDay(new Date(endDateParam))
        };
      }
      return (
        readPersistedRange("transactions_date_range") ?? {
          from: startOfDay(new Date()),
          to: endOfDay(new Date()),
        }
      );
    },
  );

  const dateParams = useMemo(() => {
    const p = new URLSearchParams();
    if (dateRange.from) p.set("startDate", dateRange.from.toISOString());
    if (dateRange.to) p.set("endDate", dateRange.to.toISOString());
    return p.toString();
  }, [dateRange]);

  const [ledgerTab, setLedgerTab] = useUrlState<string>("ledgerTab", "transactions");
  const [page, setPage] = useUrlState("page", 1, Number);
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
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-xs text-muted-foreground truncate max-w-[180px] block font-medium">
              {session.notes || "No closing remarks logged."}
            </span>
          </TooltipTrigger>
          <TooltipContent>{session.notes || "No closing remarks logged."}</TooltipContent>
        </Tooltip>
      ),
    },
  ];

  const [saleFilters, setSaleFilters] = useState<SaleFilterState>(EMPTY_SALE_FILTERS);
  const [saleSort, setSaleSort] = useState<SaleSortState | null>(null);
  const [saleSearchTerm, setSaleSearchTerm] = useState("");

  // Date range is the only server/URL-driven scope; everything else (search,
  // payment/staff/item-type/amount filters, the Returns/Credit/Staff quick chips)
  // is applied client-side below, same as the Customers list.
  const filteredTransactions = transactions;

  const storeCurrency = currentStore?.currency || "NGN";
  
  const formatCurrency = (value: number, currency: string = storeCurrency) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: currency,
    }).format(value);
  };

  const formatCompact = (value: number) => formatCurrencyCompact(value, storeCurrency);

  const formatDualCurrency = (value: number, strikethrough: boolean = false) => {
    return (
      <div className={`flex flex-col ${strikethrough ? "opacity-50 line-through" : ""}`}>
        <span className="font-mono font-medium">{formatCurrency(value, storeCurrency)}</span>
      </div>
    );
  };

  const isFullyReturnedTx = (tx: TransactionWithRelations) => {
    const isVoided = tx.checkout?.isVoided;
    const returnedQty = tx.checkout?.returnedQuantity ?? 0;
    const soldQty = tx.checkout?.quantity ?? 1;
    return !isVoided && returnedQty >= soldQty;
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

  // A receipt can have multiple line items, each with its own returned/sold quantity —
  // uniqueReceipts only keeps one representative line, so "fully returned" at the
  // receipt level means EVERY line in that receipt was fully returned, not just the
  // representative one. A fully refunded receipt generated zero net revenue and
  // shouldn't be counted as a "valid" transaction alongside genuine completed sales.
  const fullyReturnedReceiptNumbers = useMemo(() => {
    const byReceipt = new Map<string, TransactionWithRelations[]>();
    for (const tx of filteredTransactions) {
      const key = tx.checkout?.receiptNumber ?? tx.checkoutId;
      if (!byReceipt.has(key)) byReceipt.set(key, []);
      byReceipt.get(key)!.push(tx);
    }
    const fullyReturned = new Set<string>();
    for (const [key, lines] of Array.from(byReceipt.entries())) {
      const allFullyReturned = lines.every((tx) => {
        const returnedQty = tx.checkout?.returnedQuantity ?? 0;
        const soldQty = tx.checkout?.quantity ?? 1;
        return returnedQty >= soldQty;
      });
      if (allFullyReturned) fullyReturned.add(key);
    }
    return fullyReturned;
  }, [filteredTransactions]);

  const isReceiptFullyReturned = (tx: TransactionWithRelations) =>
    fullyReturnedReceiptNumbers.has(tx.checkout?.receiptNumber ?? tx.checkoutId);

  const nonVoidedCount = uniqueReceipts.filter(
    tx => !tx.checkout?.isVoided && !isReceiptFullyReturned(tx)
  ).length;

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
        const isFullyReturned = isFullyReturnedTx(tx);
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
      render: (tx: TransactionWithRelations) => (
        <div className="flex items-center gap-2">
          <User className="h-3 w-3 text-muted-foreground text-opacity-70" />
          <CustomerLink customer={tx.customer as any} customerId={tx.customerId} fallbackName="Unknown" />
        </div>
      ),
    },
    {
      key: "inventory",
      header: "Item",
      render: (tx: TransactionWithRelations) => {
        const extraItems = ((tx.checkout as any).basketItemCount ?? 1) - 1;

        return (
          <div className="flex items-center gap-2">
            <Package className="h-3 w-3 text-muted-foreground" />
            <div>
              <div className="flex items-baseline gap-1.5">
                {tx.inventory?.id ? (
                  <EntityLink href={`/inventory/${buildSlug(tx.inventory.name, tx.inventory.id)}`}>
                    <p className="font-medium text-sm">{tx.inventory.name}</p>
                  </EntityLink>
                ) : (
                  <p className="font-medium text-sm">{tx.inventory?.name ?? "Unknown"}</p>
                )}
                {extraItems > 0 && (
                  <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                    +{extraItems} more
                  </span>
                )}
              </div>
              <span className="text-xs text-muted-foreground capitalize">{tx.inventory?.type ?? "unknown"}</span>
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
          {tx.checkout?.staff?.id ? (
            <EntityLink href={`/staffs/${tx.checkout.staff.id}/edit`}>
              <span className="text-sm">{tx.checkout.staff.name}</span>
            </EntityLink>
          ) : (
            <span className="text-sm">{tx.checkout?.staff?.name ?? "—"}</span>
          )}
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
            <span className="text-sm capitalize">{tx.checkout?.paymentMethod ?? "cash"}</span>
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
      header: "Amount",
      render: (tx: TransactionWithRelations) => (
        // tx.amount is the per-line-item amount set at checkout time.
        // tx.checkout.totalPrice is the full basket total — NOT shown here.
        <div className="flex items-center justify-between gap-2">
          {formatDualCurrency(tx.amount ?? 0, tx.checkout?.isVoided || isFullyReturnedTx(tx))}
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
      staffId: tx.checkout?.staff?.id ?? null,
      inventoryType: tx.inventory?.type ?? null,
      isStaffPurchase: !!(tx.customer as any)?.staffId,
      isReturned: !!(tx.checkout?.returnedQuantity && tx.checkout.returnedQuantity > 0),
    }));
  }, [filteredTransactions]);

  type TxRow = (typeof tableData)[number];

  const staffOptions = useMemo(() => {
    const map = new Map<string, string>();
    tableData.forEach((row) => {
      if (row.staffId) map.set(row.staffId, row.staffName);
    });
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [tableData]);

  const paymentMethods = useMemo(
    () => Array.from(new Set(tableData.map((row) => row.paymentMethod))),
    [tableData]
  );

  const saleSearchedRows = useMemo(() => {
    const term = saleSearchTerm.trim().toLowerCase();
    if (!term) return tableData;
    return tableData.filter((row) =>
      row.receiptNumber.toLowerCase().includes(term) ||
      row.customerName.toLowerCase().includes(term) ||
      row.inventoryName.toLowerCase().includes(term) ||
      row.staffName.toLowerCase().includes(term)
    );
  }, [tableData, saleSearchTerm]);

  const saleFilteredRows = useMemo(
    () => saleSearchedRows.filter((row) => saleMatchesFilters(row, saleFilters)),
    [saleSearchedRows, saleFilters]
  );

  // Sort is consolidated into the same Filters sheet (see sale-filter-sheet.tsx) rather
  // than a separate control. Applied after filtering, before both the desktop table and
  // the mobile day-grouping below — day headings still fall out in date order either way
  // (grouping re-sorts by day key), but sorting by amount/customer reorders rows *within*
  // each day.
  const sortedSaleRows = useMemo(() => sortSales(saleFilteredRows, saleSort), [saleFilteredRows, saleSort]);

  // Day-grouped view for the mobile/tablet card list only (the desktop table stays flat —
  // it has the row density to show every field without grouping). Grouped by the browser's
  // local calendar day, same as every other date formatting on this page; NOT branch timezone.
  const saleGroupsByDay = useMemo(() => {
    const groups = new Map<string, { label: string; rows: typeof sortedSaleRows; total: number }>();
    for (const row of sortedSaleRows) {
      const dayKey = format(new Date(row.transactionDate), "yyyy-MM-dd");
      if (!groups.has(dayKey)) {
        groups.set(dayKey, { label: format(new Date(row.transactionDate), "EEE d MMM"), rows: [], total: 0 });
      }
      const group = groups.get(dayKey)!;
      group.rows.push(row);
      if (row.status !== "Void") group.total += row.amount;
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([, group]) => group);
  }, [sortedSaleRows]);

  const saleFilterCount = countActiveSaleFilters(saleFilters);
  const saleFilterChips = buildSaleFilterChips(
    saleFilters,
    storeCurrency === "USD" ? "$" : "₦",
    (staffId) => staffOptions.find((s) => s.id === staffId)?.name ?? "Staff"
  );
  const hasSaleFiltersOrQuickChips = saleFilterCount > 0 || saleFilters.returnsOnly || saleFilters.creditOnly || saleFilters.staffPurchasesOnly;
  // "Filters" button badge counts sort as one more active thing, since sort now lives
  // inside the same sheet instead of a separate button.
  const saleFilterAndSortCount = saleFilterCount + (saleSort ? 1 : 0);

  const statusTone = (status: string): "success" | "warning" | "critical" | "neutral" => {
    if (status === "Void") return "critical";
    if (status === "Returned" || status === "Partially Returned" || status === "Pending") return "warning";
    if (status === "Paid") return "success";
    return "neutral";
  };

  // Sorted chronologically so the PDF report's day-by-day grouping/subtotals come out contiguous.
  const transactionPdfRows = useMemo(
    () => [...tableData].sort((a, b) => new Date(a.transactionDate).getTime() - new Date(b.transactionDate).getTime()),
    [tableData]
  );

  const periodLabel = useMemo(() => {
    if (!dateRange.from) return undefined;
    if (!dateRange.to || startOfDay(dateRange.to).getTime() === startOfDay(dateRange.from).getTime()) {
      return format(dateRange.from, "d MMM yyyy");
    }
    return `${format(dateRange.from, "d MMM")} – ${format(dateRange.to, "d MMM yyyy")}`;
  }, [dateRange]);

  const pdfReport = {
    businessName: business?.name ?? currentStore?.name ?? "Business",
    storeName: currentStore?.name ?? "All Stores",
    periodLabel,
    kpis: [
      { label: "Net Collected", value: formatCurrency(actualRevenueNet) },
      {
        label: "Gross Revenue",
        value: formatCurrency(totalAmount),
        sub: totalRefunded > 0 ? `-${formatCurrency(totalRefunded)} refunded` : undefined,
        subTone: totalRefunded > 0 ? ("critical" as const) : undefined,
      },
      { label: "Receipts", value: String(nonVoidedCount) },
      { label: "Avg Transaction", value: formatCurrency(nonVoidedCount > 0 ? actualRevenueNet / nonVoidedCount : 0) },
    ],
    columns: [
      { key: "transactionDate", header: "Date", format: (row: TxRow) => format(new Date(row.transactionDate), "d MMM") },
      { key: "receiptNumber", header: "Receipt" },
      { key: "customerName", header: "Customer" },
      { key: "inventoryName", header: "Item" },
      { key: "staffName", header: "Staff" },
      { key: "paymentMethod", header: "Payment", format: (row: TxRow) => row.paymentMethod.charAt(0).toUpperCase() + row.paymentMethod.slice(1) },
      { key: "status", header: "Status" },
      { key: "amount", header: "Amount", align: "right" as const, format: (row: TxRow) => formatCurrency(row.amount) },
    ],
    rows: transactionPdfRows,
    amountKey: "amount",
    formatAmount: formatCurrency,
    unitLabel: "receipts",
    groupBy: (row: TxRow) => format(new Date(row.transactionDate), "d MMM yyyy"),
    statusKey: "status",
    getStatus: (row: TxRow) => ({ label: row.status, tone: statusTone(row.status) }),
    isVoided: (row: TxRow) => !!row.checkout?.isVoided,
    getRefundedAmount: (row: TxRow) => row.checkout?.refundedAmount ?? 0,
  };

  // Tracks the ledger's live search/filter result set so "Export current view" can offer
  // exactly what's currently on screen, separate from the always-full default export.
  const [visibleTxRows, setVisibleTxRows] = useState<TxRow[]>([]);
  const visiblePdfReport = {
    ...pdfReport,
    rows: [...visibleTxRows].sort((a, b) => new Date(a.transactionDate).getTime() - new Date(b.transactionDate).getTime()),
  };
  // Same shape as exportData above, just sourced from the narrowed rows.
  const visibleExportData = visibleTxRows.map((tx) => ({
    id: tx.id,
    transactionDate: new Date(tx.transactionDate).toLocaleString(),
    customer: tx.customer,
    inventory: tx.inventory,
    checkout: {
      ...tx.checkout,
      isVoided: tx.checkout?.isVoided ? "Yes" : "No"
    },
  }));

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Transactions"
          description="View all sales transactions"
          compact
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
        compact
        actions={
          <>
            {/* Date filter and export live in the top-level header now, next to the
                title, the same place Dashboard puts its date range and Customers puts
                its export/bulk-operations control — only relevant to the Sales Ledger
                tab, so hidden while Register Shifts is active. */}
            {ledgerTab === "transactions" && (
              <>
                <DateRangeFilter
                  dateRange={dateRange}
                  onDateRangeChange={setDateRange}
                  defaultPreset="today"
                  timezone={currentStore?.timezone}
                  compact
                />
                <ExportToolbar
                  data={exportData as unknown as Record<string, unknown>[]}
                  columns={exportColumns}
                  filename="transactions"
                  title="Transaction Report"
                  disabled={isLoading}
                  pdfReport={pdfReport}
                  visibleData={visibleExportData as unknown as Record<string, unknown>[]}
                  visiblePdfReport={visiblePdfReport}
                  compact
                />
              </>
            )}
            <Button asChild data-testid="button-new-sale">
              <Link href="/sales/new">
                <Receipt className="h-4 w-4 lg:mr-2" />
                <span className="hidden lg:inline">New Sale</span>
              </Link>
            </Button>
          </>
        }
      />

      <Tabs value={ledgerTab} onValueChange={setLedgerTab} className="space-y-6">
        <PolymorphicTabsList
          tabs={[
            { value: "transactions", label: "Sales Ledger" },
            { value: "drawer-shifts", label: "Register Shifts" },
          ]}
          variant="default"
        />

        <TabsContent value="transactions" className="space-y-6 animate-in fade-in duration-300">
          <MetricGrid>
            {/* Net is the headline figure — what the business actually kept —
                shown first, with gross and the refund it reconciles against
                folded into its own description line rather than a separate tile. */}
            <MetricCard
              title="Net Sales"
              value={formatCurrency(actualRevenueNet)}
              compactValue={formatCompact(actualRevenueNet)}
              description={
                totalRefunded > 0
                  ? `${formatCompact(totalAmount)} gross − ${formatCompact(totalRefunded)} returned`
                  : `${formatCompact(totalAmount)} gross · no returns`
              }
              icon={<Coins className="h-4 w-4" />}
              isLoading={isLoading}
            />
            <MetricCard
              title="Completed Sales"
              value={nonVoidedCount}
              description="Excludes voided and fully returned"
              icon={<Receipt className="h-4 w-4" />}
              isLoading={isLoading}
            />
            <MetricCard
              title="Avg. Sale (Net)"
              value={formatCurrency(
                nonVoidedCount > 0 ? actualRevenueNet / nonVoidedCount : 0
              )}
              compactValue={formatCompact(
                nonVoidedCount > 0 ? actualRevenueNet / nonVoidedCount : 0
              )}
              icon={<Coins className="h-4 w-4" />}
              isLoading={isLoading}
            />
          </MetricGrid>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-medium">Transaction History</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1 min-w-0">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <ClearableInput
                    placeholder="Search receipt, customer, item or staff"
                    value={saleSearchTerm}
                    onChange={(e) => setSaleSearchTerm(e.target.value)}
                    onClear={() => setSaleSearchTerm("")}
                    className="pl-9 h-9"
                  />
                </div>
                <SaleFiltersSheet
                  filters={saleFilters}
                  onApply={setSaleFilters}
                  sort={saleSort}
                  onSortChange={setSaleSort}
                  currencySymbol={storeCurrency === "USD" ? "$" : "₦"}
                  paymentMethods={paymentMethods}
                  staffOptions={staffOptions}
                  resultCountFor={(draft) => saleSearchedRows.filter((row) => saleMatchesFilters(row, draft)).length}
                  trigger={
                    <Button
                      variant={saleFilterAndSortCount > 0 ? "secondary" : "outline"}
                      size="sm"
                      className={cn("h-9 shrink-0 gap-1.5", saleFilterAndSortCount > 0 && "bg-primary/10 border-primary/30 text-primary")}
                      data-testid="button-sale-filters"
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      {saleFilterAndSortCount > 0 ? `Filters ${saleFilterAndSortCount}` : "Filters"}
                    </Button>
                  }
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSaleFilters((f) => ({ ...f, returnsOnly: !f.returnsOnly }))}
                  className={cn(
                    "h-8 px-3 rounded-full border text-xs font-medium transition-colors inline-flex items-center gap-1.5",
                    saleFilters.returnsOnly ? "bg-orange-50 border-orange-300 text-orange-700 dark:bg-orange-950/30 dark:border-orange-800 dark:text-orange-400" : "border-input text-foreground hover:bg-muted/50"
                  )}
                  data-testid="chip-returns"
                >
                  <RotateCcw className="h-3 w-3" />
                  Returns
                </button>
                <button
                  type="button"
                  onClick={() => setSaleFilters((f) => ({ ...f, creditOnly: !f.creditOnly }))}
                  className={cn(
                    "h-8 px-3 rounded-full border text-xs font-medium transition-colors inline-flex items-center gap-1.5",
                    saleFilters.creditOnly ? "bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400" : "border-input text-foreground hover:bg-muted/50"
                  )}
                  data-testid="chip-credit"
                >
                  <Wallet className="h-3 w-3" />
                  Credit
                </button>
                <button
                  type="button"
                  onClick={() => setSaleFilters((f) => ({ ...f, staffPurchasesOnly: !f.staffPurchasesOnly }))}
                  className={cn(
                    "h-8 px-3 rounded-full border text-xs font-medium transition-colors inline-flex items-center gap-1.5",
                    saleFilters.staffPurchasesOnly ? "bg-primary/10 border-primary/30 text-primary" : "border-input text-foreground hover:bg-muted/50"
                  )}
                  data-testid="chip-staff-purchases"
                >
                  <UserCheck className="h-3 w-3" />
                  Staff purchases
                </button>

                {(hasSaleFiltersOrQuickChips || saleSort) && (
                  <>
                    {saleSort && (
                      <span className="inline-flex items-center gap-1 h-7 pl-3 pr-1.5 rounded-full border border-input bg-muted/40 text-xs font-medium">
                        {saleSortLabel(saleSort)}
                        <button
                          type="button"
                          onClick={() => setSaleSort(null)}
                          aria-label="Remove sort"
                          title="Remove sort"
                          className="rounded-full p-0.5 hover:bg-muted"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    )}
                    {saleFilterChips.map((chip) => (
                      <span
                        key={chip.key}
                        className="inline-flex items-center gap-1 h-7 pl-3 pr-1.5 rounded-full border border-input bg-muted/40 text-xs font-medium"
                      >
                        {chip.label}
                        <button
                          type="button"
                          onClick={() => setSaleFilters((f) => clearSaleFilterChip(f, chip.key))}
                          aria-label={`Remove ${chip.label} filter`}
                          title={`Remove ${chip.label} filter`}
                          className="rounded-full p-0.5 hover:bg-muted"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                    <span className="text-xs text-muted-foreground ml-auto shrink-0">
                      {saleFilteredRows.length} sale{saleFilteredRows.length === 1 ? "" : "s"}
                    </span>
                    <button
                      type="button"
                      className="text-xs font-medium text-primary hover:underline shrink-0"
                      onClick={() => {
                        setSaleFilters(EMPTY_SALE_FILTERS);
                        setSaleSort(null);
                      }}
                      data-testid="button-sale-clear-all"
                    >
                      Clear all
                    </button>
                  </>
                )}
              </div>

              {/* Desktop: the flat table — enough row density that day grouping isn't needed. */}
              <div className="hidden lg:block">
                <DataTable
                  data={sortedSaleRows}
                  columns={columns}
                  hideToolbar
                  isLoading={isLoading}
                  emptyTitle="No Transactions"
                  emptyMessage="No transactions found for the selected date range. Try adjusting the filters or date range."
                  emptyIcon={<ShoppingBag className="h-6 w-6" />}
                  onRowClick={(tx) => setLocation(appendReturnTo(`/transactions/${tx.id}`, location, search))}
                  onVisibleDataChange={setVisibleTxRows}
                  urlKey="tx"
                />
              </div>

              {/* Mobile/tablet: date-grouped two-line rows with a daily total heading,
                  so a scan of the day's activity doesn't need every field spelled out per row. */}
              <div className="lg:hidden space-y-4">
                {isLoading ? (
                  <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>
                ) : saleGroupsByDay.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-10 text-center">
                    <ShoppingBag className="h-6 w-6 text-muted-foreground" />
                    <p className="text-sm font-medium">No Transactions</p>
                    <p className="text-xs text-muted-foreground max-w-xs">
                      No transactions found for the selected date range. Try adjusting the filters or date range.
                    </p>
                  </div>
                ) : (
                  saleGroupsByDay.map((group) => (
                    <div key={group.label} className="space-y-2">
                      <div className="flex items-center justify-between px-1">
                        <span className="text-xs font-semibold text-muted-foreground">{group.label}</span>
                        <span className="text-xs font-semibold text-muted-foreground font-mono">{formatCurrency(group.total)}</span>
                      </div>
                      <div className="rounded-lg border divide-y bg-card">
                        {group.rows.map((row) => {
                          const isVoidedRow = row.status === "Void";
                          const isReturnedRow = row.status === "Returned";
                          const isPartialRow = row.status === "Partially Returned";
                          const extraItems = ((row.checkout as any)?.basketItemCount ?? 1) - 1;
                          return (
                            <button
                              key={row.id}
                              type="button"
                              className="w-full text-left p-3 hover:bg-muted/40 transition-colors"
                              onClick={() => setLocation(appendReturnTo(`/transactions/${row.id}`, location, search))}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium text-sm truncate">{row.customerName || "Unknown"}</span>
                                <span className={cn("font-mono font-medium text-sm shrink-0", (isVoidedRow || isReturnedRow) && "opacity-50 line-through")}>
                                  {formatCurrency(row.amount)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-2 mt-0.5">
                                <span className="text-xs text-muted-foreground truncate">
                                  {new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit" }).format(new Date(row.transactionDate))}
                                  {" · "}{row.inventoryName || "Unknown"}{extraItems > 0 ? ` +${extraItems}` : ""}
                                  {" · "}{row.paymentMethod}
                                  {" · "}{row.staffName.split(" ")[0]}
                                </span>
                                <span className="text-[11px] text-muted-foreground font-mono shrink-0">
                                  #{row.receiptNumber}
                                </span>
                              </div>
                              {(isVoidedRow || isReturnedRow || isPartialRow) && (
                                <Badge
                                  variant={isVoidedRow ? "destructive" : "outline"}
                                  className={cn(
                                    "text-[10px] px-1.5 py-0 h-4 mt-1.5",
                                    isReturnedRow && "border-red-300 text-red-600 bg-red-50 dark:bg-red-950/20 dark:border-red-900/30 font-semibold",
                                    isPartialRow && "border-orange-300 text-orange-600 bg-orange-50 dark:bg-orange-950/20 dark:border-orange-900/30 font-semibold"
                                  )}
                                >
                                  {isVoidedRow ? "Void" : isReturnedRow ? "Returned" : "Part returned"}
                                </Badge>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
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
          <MetricGrid>
            <MetricCard
              title="Shift Sessions Run"
              value={drawerSessions.length}
              icon={<Clock className="h-4 w-4" />}
              isLoading={drawerLoading}
            />
            <MetricCard
              title="Accumulated Drawer Variance"
              value={formatCurrency(totalVariance)}
              compactValue={formatCompact(totalVariance)}
              icon={<Coins className="h-4 w-4" />}
              isLoading={drawerLoading}
            />
            <MetricCard
              title="Active Shift Session"
              value={activeSessionItem ? "SHIFT DRAW ACTIVE" : "ALL SHIFTS AUDITED"}
              icon={<AlertCircle className="h-4 w-4" />}
              isLoading={drawerLoading}
            />
          </MetricGrid>

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
                urlKey="drawer"
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
