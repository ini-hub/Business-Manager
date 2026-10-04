import { useState } from "react";
import { AddButton } from "@/components/add-button";
import { useLocation, Link } from "wouter";
import { useUrlState } from "@/hooks/use-url-state";
import { useQuery, useMutation } from "@tanstack/react-query";
import { FileText, CheckSquare, AlertTriangle, Trash, Coins, Plus } from "lucide-react";
import { SpeedDialFAB } from "@/components/speed-dial-fab";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable, type BulkAction } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { PoFilterSheet, PoSortSheet } from "@/components/po-filter-sheet";
import {
  EMPTY_PO_FILTERS, buildPoFilterChips, clearPoFilterChip, countActivePoFilters, daysLate, dueDay, isAwaiting,
  poMatchesFilters, poMatchesSearch, sortPos, PO_SORT_LABELS, type PoFilterState, type PoSort,
} from "@/lib/po-filters";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency as formatCurrencyUtil, formatCurrencyCompact, getCurrencyByCode } from "@/lib/currency-utils";
import { MetricRow } from "@/components/metric-row";
import { ListControls } from "@/components/list-controls";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PolymorphicTabsList } from "@/components/oop-ui/PolymorphicTabsList";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { BulkOperations } from "@/components/bulk-operations";
import { PURCHASE_ORDER_BULK_CONFIG } from "@/lib/bulk-entity-configs";
import { runBulkFanOut } from "@/lib/bulk-actions";
import { exportReportToPDF } from "@/lib/export-utils";
import type { PurchaseOrder } from "@shared/schema";

type Vendor = { id: string; name: string; phoneNumber?: string; email?: string; companyName?: string };
type POWithVendor = PurchaseOrder & { vendor?: Vendor; vendorName?: string; poNumber: string };

export default function PurchaseOrdersPage() {
  const [, setLocation] = useLocation();
  const { currentStore, stores } = useStore();
  const { user } = useAuth();
  const { toast } = useToast();
  const storeCurrency = currentStore?.currency || "NGN";

  const [activeTab, setActiveTab] = useUrlState<string>("tab", "list");
  const [poSearch, setPoSearch] = useState("");
  const [poFilters, setPoFilters] = useState<PoFilterState>(EMPTY_PO_FILTERS);
  const [poSort, setPoSort] = useState<PoSort | null>(null);
  const [selectedIds, setSelectedIds] = useState<(string | number)[]>([]);

  const isManagerOrOwner = user?.role === "owner" || user?.role === "manager";

  // Vendor Bills State
  const [payAmount, setPayAmount] = useState<string>("");
  const [payNotes, setPayNotes] = useState<string>("");
  const [isPayDialogOpen, setIsPayDialogOpen] = useState(false);
  const [selectedBill, setSelectedBill] = useState<any | null>(null);

  // Fetch Vendor Bills
  const { data: vendorBills = [], isLoading: isLoadingBills } = useQuery<any[]>({
    queryKey: ["/api/vendors/bills", currentStore?.id, stores.map(s => s.id).join(",")],
    queryFn: async () => {
      if (currentStore?.id === "all" && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const res = await fetch(`/api/vendors/bills?storeId=${s.id}`);
              if (!res.ok) return [];
              const list = await res.json() as any[];
              return list.map(item => ({ ...item, storeName: s.name }));
            } catch {
              return [];
            }
          })
        );
        return responses.flat();
      }
      const res = await apiRequest("GET", `/api/vendors/bills?storeId=${currentStore!.id}`);
      return res.json();
    },
    enabled: currentStore?.id === "all" ? stores.length > 0 : !!currentStore?.id,
  });

  const recordPaymentMutation = useMutation({
    mutationFn: async () => {
      if (!selectedBill) return;
      const parsedAmount = Number(payAmount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) throw new Error("Please enter a valid positive payment amount.");
      
      const newPaid = Number(selectedBill.amountPaid || 0) + parsedAmount;
      const status = newPaid >= Number(selectedBill.amount) ? "paid" : "partially_paid";
      
      await apiRequest("PATCH", `/api/vendors/bills/${selectedBill.id}`, {
        amountPaid: newPaid,
        status,
        notes: payNotes || selectedBill.notes || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vendors/bills"] });
      toast({ title: "Success", description: "Supplier payment recorded, liability updated." });
      setIsPayDialogOpen(false);
      setSelectedBill(null);
      setPayAmount("");
      setPayNotes("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to record payment.", variant: "destructive" });
    },
  });

  // Fetch Purchase Orders
  const { data: purchaseOrders = [], isLoading: isLoadingPOs } = useQuery<POWithVendor[]>({
    queryKey: ["/api/purchase-orders", currentStore?.id, stores.map(s => s.id).join(",")],
    queryFn: async () => {
      if (currentStore?.id === "all" && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const res = await fetch(`/api/purchase-orders?storeId=${s.id}`);
              if (!res.ok) return [];
              const list = await res.json() as POWithVendor[];
              return list.map(item => ({ ...item, storeName: s.name }));
            } catch {
              return [];
            }
          })
        );
        return responses.flat().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }
      const res = await apiRequest("GET", `/api/purchase-orders?storeId=${currentStore!.id}`);
      return res.json();
    },
    enabled: currentStore?.id === "all" ? stores.length > 0 : !!currentStore?.id,
  });

  // No toast/selection-clear here — driven via BulkAction.onExecute now, and
  // BulkActionsBar reports the outcome itself; a toast here too would double up.
  const bulkCancelMutation = useMutation({
    mutationFn: (ids: string[]) =>
      runBulkFanOut(ids, async (id) => {
        const res = await apiRequest("PATCH", `/api/purchase-orders/${id}/status`, { status: "cancelled" });
        if (!res.ok) throw new Error("cancel failed");
        return "cancelled" as const;
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
    },
  });

  const bulkDeletePOMutation = useMutation({
    mutationFn: (ids: string[]) =>
      runBulkFanOut(ids, async (id) => {
        const res = await apiRequest("DELETE", `/api/purchase-orders/${id}`);
        if (!res.ok) throw new Error("delete failed");
        return "deleted" as const;
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
    },
  });

  const poBulkActions: BulkAction<POWithVendor>[] = [
    {
      id: "cancel",
      label: "Cancel",
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
      // Not truly undoable (no "un-cancel" endpoint) — "safe" rather than "reversible"
      // so the bar doesn't offer an Undo it can't back up. Only cancellable-state
      // orders are valid; the server rejects the rest, counted here as failures
      // (same no-precheck behavior the old bar had).
      kind: "safe",
      onExecute: async (selection) => {
        const { counts } = await bulkCancelMutation.mutateAsync(selection.ids as string[]);
        return { succeeded: counts.cancelled ?? 0, failed: counts.failed ?? 0 };
      },
    },
    {
      id: "delete",
      label: "Delete",
      icon: <Trash className="h-3.5 w-3.5" />,
      kind: "destructive",
      destructiveDescription: "This can't be undone.",
      onExecute: async (selection) => {
        const { counts } = await bulkDeletePOMutation.mutateAsync(selection.ids as string[]);
        return { succeeded: counts.deleted ?? 0, failed: counts.failed ?? 0 };
      },
    },
  ];

  const formatCurrency = (value: number) => formatCurrencyUtil(value, storeCurrency);
  const formatCompact = (value: number) => formatCurrencyCompact(value, storeCurrency);

  const getStatusBadge = (status: string) => {
    const s = status.toLowerCase();
    const styles: Record<string, [string, string]> = {
      draft: ["Draft", "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"],
      ordered: ["Awaiting delivery", "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"],
      partially_received: ["Partly received", "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"],
      received: ["Received", "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"],
      cancelled: ["Cancelled", "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"],
    };
    const [label, cls] = styles[s] ?? [status, ""];
    return <Badge variant="secondary" className={`${cls} whitespace-nowrap`}>{label}</Badge>;
  };

  const localToday = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const columns = [
    ...(currentStore?.id === "all" ? [{
      key: "storeName",
      header: "Store",
      render: (q: any) => (
        <Badge variant="outline" className="bg-slate-900/40 border-slate-800 text-xs text-slate-300 font-medium uppercase shrink-0">
          {q.storeName || "Global"}
        </Badge>
      ),
    }] : []),
    {
      key: "poNumber",
      header: "Purchase order",
      priority: 1 as const,
      cardRender: (q: POWithVendor) => <span className="font-mono truncate">{q.poNumber}</span>,
      render: (q: POWithVendor) => (
        <div>
          <Link href={`/purchase-orders/${q.id}`} className="font-mono text-sm font-semibold text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{q.poNumber}</Link>
          {q.supplierRef && <p className="text-xs text-muted-foreground font-mono">Their ref {q.supplierRef}</p>}
        </div>
      ),
    },
    {
      key: "vendor",
      header: "Vendor",
      priority: 2 as const,
      cardRender: (q: POWithVendor) => {
        const due = dueDay(q);
        return (
          <span className="truncate">
            {q.vendor?.name || "Unknown vendor"}
            {due ? ` · ${new Date(`${due}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}
          </span>
        );
      },
      render: (q: POWithVendor) => <span className="font-medium">{q.vendor?.name || "Unknown vendor"}</span>,
    },
    {
      key: "status",
      header: "Status",
      priority: 2 as const,
      render: (q: POWithVendor) => getStatusBadge(q.status),
    },
    {
      key: "expectedDelivery",
      header: "Expected",
      render: (q: POWithVendor) => {
        const due = dueDay(q);
        if (!due) return <span className="text-muted-foreground text-sm">No date set</span>;
        const late = daysLate(q, localToday);
        return (
          <div className="text-sm">
            <p className={late !== null && late >= 0 ? "text-amber-700 dark:text-amber-400" : ""}>
              {new Date(`${due}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
            </p>
            {late !== null && late >= 0 && (
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                {late === 0 ? "Due today" : `${late} day${late === 1 ? "" : "s"} late`}
              </p>
            )}
          </div>
        );
      },
    },
    {
      key: "totalAmount",
      header: "Total",
      priority: 1 as const,
      render: (q: POWithVendor) => <span className="font-semibold tabular-nums block text-right">{formatCurrency(q.totalAmount)}</span>,
    },
  ];

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader title="Purchase Orders" description="Procure supplies, restock inventory and balance cost matrixes." />
        <StoreRequiredAlert title="Store Required for Purchase Orders" />
      </div>
    );
  }

  // Procurement metrics
  const now = new Date();
  const inThisMonth = (d?: Date | string | null) => {
    if (!d) return false;
    const x = new Date(d);
    return x.getFullYear() === now.getFullYear() && x.getMonth() === now.getMonth();
  };
  const totalPOVal = purchaseOrders.reduce((sum, po) => sum + po.totalAmount, 0);
  const awaiting = purchaseOrders.filter(isAwaiting);
  const orderedCount = awaiting.length;
  const awaitingValue = awaiting.reduce((sum, po) => sum + po.totalAmount, 0);
  const overdue = awaiting
    .map((po) => ({ po, late: daysLate(po, localToday) }))
    .filter((x): x is { po: POWithVendor; late: number } => x.late !== null && x.late >= 0)
    .sort((a, b) => b.late - a.late);
  const receivedThisMonth = purchaseOrders.filter((po) => po.status === "received" && inThisMonth(po.updatedAt));
  const receivedValue = receivedThisMonth.reduce((sum, po) => sum + po.totalAmount, 0);
  const orderedThisMonth = purchaseOrders.filter(
    (po) => po.status !== "draft" && po.status !== "cancelled" && inThisMonth(po.placedAt ?? po.createdAt),
  );
  const orderedMonthValue = orderedThisMonth.reduce((sum, po) => sum + po.totalAmount, 0);
  const orderedMonthVendors = new Set(orderedThisMonth.map((po) => po.vendorId)).size;
  const fulfilledCount = purchaseOrders.filter(po => po.status === "received").length;
  const searchedOrders = purchaseOrders.filter((po) => poMatchesSearch(po, poSearch));
  const visibleOrders = sortPos(
    searchedOrders.filter((po) => poMatchesFilters(po, poFilters, localToday)),
    poSort,
  );
  const poVendorOptions = Array.from(
    new Map(purchaseOrders.map((po) => [po.vendorId, po.vendor?.name ?? "Unknown vendor"])).entries(),
  ).map(([id, name]) => ({ id, name }));
  const poCurrencySymbol = getCurrencyByCode(storeCurrency)?.symbol ?? storeCurrency;
  const activePoFilterCount = countActivePoFilters(poFilters);
  const poFilterChips = buildPoFilterChips(
    poFilters,
    (id) => poVendorOptions.find((v) => v.id === id)?.name ?? "Vendor",
    poCurrencySymbol,
  );
  const hasPoFiltersOrSort = activePoFilterCount > 0 || poSort !== null;
  const outstandingPayable = vendorBills
    .filter(b => b.status !== "paid")
    .reduce((sum, b) => sum + (Number(b.amount) - Number(b.amountPaid || 0)), 0);
  const paidLiabilities = vendorBills
    .filter(b => b.status === "paid" || b.status === "partially_paid")
    .reduce((sum, b) => sum + Number(b.amountPaid || 0), 0);

  const poExportColumns = [
    { key: "poNumber", header: "PO Code" },
    { key: "vendor.name", header: "Vendor" },
    { key: "totalAmount", header: "Total Cost" },
    { key: "status", header: "Status" },
    { key: "expectedDelivery", header: "Expected Delivery" },
    { key: "createdAt", header: "Created" },
  ];

  const handlePOReportExport = () => {
    return exportReportToPDF({
      filename: `purchase-orders-report_${new Date().toISOString().slice(0, 10)}`,
      title: "Purchase Orders Report",
      businessName: currentStore.name,
      storeName: currentStore.name,
      kpis: [
        { label: "Procurement Volume", value: formatCurrency(totalPOVal) },
        { label: "Orders In Transit", value: String(orderedCount) },
        { label: "Fulfilled Receipts", value: String(fulfilledCount) },
        { label: "Total Orders", value: String(purchaseOrders.length) },
      ],
      columns: [
        { key: "poNumber", header: "PO Code" },
        { key: "vendorName", header: "Vendor", format: (po: POWithVendor) => po.vendor?.name || "Unknown" },
        { key: "totalAmount", header: "Total Cost", align: "right" as const, format: (po: POWithVendor) => formatCurrency(po.totalAmount) },
        { key: "status", header: "Status" },
      ],
      rows: purchaseOrders,
      amountKey: "totalAmount",
      formatAmount: formatCurrency,
      statusKey: "status",
      unitLabel: "purchase orders",
    });
  };



  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader
        compact
        title="Purchase orders"
        description={`Order stock from vendors and receive it into ${currentStore.name}.`}
        actions={
          activeTab === "list" && (
            <>
              {isManagerOrOwner && (
                <AddButton label="New purchase order" onClick={() => setLocation("/purchase-orders/new")} data-testid="button-new-po" />
              )}
              <div className="lg:hidden">
                <BulkOperations
                  entityConfig={PURCHASE_ORDER_BULK_CONFIG}
                  data={purchaseOrders as unknown as Record<string, unknown>[]}
                  columns={poExportColumns}
                  isLoading={isLoadingPOs}
                  storeId={currentStore.id}
                  pdfTitle="Purchase Orders Report"
                  onExportPDF={handlePOReportExport}
                  showImportOption={isManagerOrOwner}
                  compact
                />
              </div>
              <div className="hidden lg:block">
                <BulkOperations
                  entityConfig={PURCHASE_ORDER_BULK_CONFIG}
                  data={purchaseOrders as unknown as Record<string, unknown>[]}
                  columns={poExportColumns}
                  isLoading={isLoadingPOs}
                  storeId={currentStore.id}
                  pdfTitle="Purchase Orders Report"
                  onExportPDF={handlePOReportExport}
                  showImportOption={isManagerOrOwner}
                />
              </div>
            </>
          )
        }
      />

      <MetricRow
        metrics={
          activeTab === "bills"
            ? [
                {
                  title: "Accounts Payable (Outstanding)",
                  value: formatCurrency(outstandingPayable),
                  compactValue: formatCompact(outstandingPayable),
                  icon: <AlertTriangle className="h-4 w-4 text-red-500" />,
                  isLoading: isLoadingBills,
                },
                {
                  title: "Paid Liabilities (This Month)",
                  value: formatCurrency(paidLiabilities),
                  compactValue: formatCompact(paidLiabilities),
                  icon: <CheckSquare className="h-4 w-4 text-emerald-500" />,
                  isLoading: isLoadingBills,
                },
                {
                  title: "Active Invoices",
                  value: vendorBills.filter((b) => b.status !== "paid").length,
                  icon: <FileText className="h-4 w-4 text-blue-500" />,
                  isLoading: isLoadingBills,
                },
              ]
            : [
                {
                  title: "Awaiting delivery",
                  value: orderedCount,
                  description: orderedCount ? `${formatCompact(awaitingValue)} on order` : "Nothing on order",
                  isLoading: isLoadingPOs,
                  onClick: () => setPoFilters((f) => ({ ...f, status: "awaiting" })),
                },
                {
                  title: "Received this month",
                  value: receivedThisMonth.length,
                  description: receivedThisMonth.length ? `${formatCompact(receivedValue)} into stock` : "Nothing received yet",
                  isLoading: isLoadingPOs,
                  onClick: () => setPoFilters((f) => ({ ...f, status: "received" })),
                },
                {
                  title: "Ordered this month",
                  value: formatCurrency(orderedMonthValue),
                  compactValue: formatCompact(orderedMonthValue),
                  description: `${orderedThisMonth.length} order${orderedThisMonth.length === 1 ? "" : "s"}, ${orderedMonthVendors} vendor${orderedMonthVendors === 1 ? "" : "s"}`,
                  isLoading: isLoadingPOs,
                },
                {
                  title: "Due today or late",
                  value: overdue.length,
                  tone: overdue.length ? "amber" : "default",
                  description: overdue.length
                    ? `${overdue[0].po.poNumber}, ${overdue[0].late === 0 ? "due today" : `${overdue[0].late} day${overdue[0].late === 1 ? "" : "s"} late`}`
                    : "All on schedule",
                  isLoading: isLoadingPOs,
                  onClick: () => setPoFilters((f) => ({ ...f, status: "awaiting" })),
                },
              ]
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <PolymorphicTabsList
          tabs={[
            { value: "list", label: "Orders", icon: <FileText className="h-4 w-4" /> },
            { value: "bills", label: "Vendor bills", icon: <Coins className="h-4 w-4" /> },
          ]}
          variant="bordered"
        />

        <TabsContent value="list" className="mt-4 space-y-3">
          <ListControls
            testIdPrefix="po"
            placeholder="Search orders"
            search={poSearch}
            onSearchChange={setPoSearch}
            filterCount={activePoFilterCount}
            filters={(trigger) => (
              <PoFilterSheet
                filters={poFilters}
                vendors={poVendorOptions}
                currencySymbol={poCurrencySymbol}
                resultCountFor={(draft) => searchedOrders.filter((po) => poMatchesFilters(po, draft, localToday)).length}
                onApply={(next) => { setPoFilters(next); setSelectedIds([]); }}
                trigger={trigger}
              />
            )}
            sortLabel={PO_SORT_LABELS[poSort ?? "newest"]}
            sort={(trigger) => <PoSortSheet sort={poSort} onChange={setPoSort} trigger={trigger} />}
            chips={poFilterChips}
            onRemoveChip={(key) => setPoFilters((f) => clearPoFilterChip(f, key as Parameters<typeof clearPoFilterChip>[1]))}
            hasSort={poSort !== null}
            onClearAll={() => { setPoFilters(EMPTY_PO_FILTERS); setPoSort(null); }}
            visibleCount={visibleOrders.length}
            noun="order"
          />

          <DataTable
            data={visibleOrders}
            columns={columns}
            hideToolbar
            isLoading={isLoadingPOs}
            onRowClick={(po) => setLocation(`/purchase-orders/${po.id}`)}
            showCardChevron
            cardLayout="compact-grid"
            cardAvatar={() => (
              <div className="h-10 w-10 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 flex items-center justify-center">
                <FileText className="h-5 w-5" />
              </div>
            )}
            emptyTitle={!poSearch && !hasPoFiltersOrSort ? "No purchase orders yet" : "Nothing matches"}
            emptyMessage={
              !poSearch && !hasPoFiltersOrSort
                ? "Create your first order to restock from a vendor."
                : "Try a different search or filter."
            }
            emptyAction={!poSearch && !hasPoFiltersOrSort && isManagerOrOwner ? (
              <Button onClick={() => setLocation("/purchase-orders/new")}><Plus className="h-4 w-4 mr-1" /> New purchase order</Button>
            ) : undefined}
            multiselect={isManagerOrOwner}
            selectedIds={selectedIds}
            onSelectedIdsChange={setSelectedIds}
            bulkActions={isManagerOrOwner ? poBulkActions : undefined}
            entityNoun={{ singular: "purchase order", plural: "purchase orders" }}
            urlKey="orders"
          />
        </TabsContent>

        <TabsContent value="bills" className="space-y-6">

          <Card className="border border-border/40 bg-background/50 backdrop-blur-md">
            <CardHeader>
              <CardTitle>Accounts Payable Registry</CardTitle>
              <CardDescription>Verify supplier invoices, balance payments, and track upcoming due dates.</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                data={vendorBills}
                columns={[
                  ...(currentStore?.id === "all" ? [{
                    key: "storeName",
                    header: "Store",
                    render: (b: any) => (
                      <Badge variant="outline" className="bg-slate-900/40 border-slate-800 text-xs text-slate-300 font-medium uppercase shrink-0">
                        {b.storeName || "Global"}
                      </Badge>
                    ),
                  }] : []),
                  {
                    key: "billDate",
                    header: "Invoice Date",
                    render: (b: any) => (
                      <span className="text-sm">{new Date(b.billDate).toLocaleDateString()}</span>
                    )
                  },
                  {
                    key: "vendor",
                    header: "Supplier / Vendor",
                    render: (b: any) => (
                      <span className="font-semibold text-primary">{b.vendor?.name || "Unknown Vendor"}</span>
                    )
                  },
                  {
                    key: "amount",
                    header: "Bill Total",
                    render: (b: any) => (
                      <span className="font-mono font-medium">{formatCurrency(b.amount)}</span>
                    )
                  },
                  {
                    key: "amountPaid",
                    header: "Amount Paid",
                    render: (b: any) => (
                      <span className="font-mono text-emerald-500">{formatCurrency(b.amountPaid || 0)}</span>
                    )
                  },
                  {
                    key: "balance",
                    header: "Outstanding Balance",
                    render: (b: any) => {
                      const balance = Number(b.amount) - Number(b.amountPaid || 0);
                      return (
                        <span className={`font-mono font-semibold ${balance > 0 ? "text-red-500 animate-pulse" : "text-emerald-500"}`}>
                          {formatCurrency(balance)}
                        </span>
                      );
                    }
                  },
                  {
                    key: "dueDate",
                    header: "Due Date",
                    render: (b: any) => {
                      if (!b.dueDate) return <span className="text-muted-foreground text-sm">N/A</span>;
                      const due = new Date(b.dueDate);
                      const isOverdue = due.getTime() < Date.now() && b.status !== "paid";
                      return (
                        <span className={`text-sm font-medium ${isOverdue ? "text-red-500 underline font-bold" : "text-muted-foreground"}`}>
                          {due.toLocaleDateString()}
                          {isOverdue && " (Overdue!)"}
                        </span>
                      );
                    }
                  },
                  {
                    key: "status",
                    header: "Payment Status",
                    render: (b: any) => {
                      const status = b.status.toLowerCase();
                      if (status === "paid") return <Badge className="bg-emerald-100 hover:bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400">Fully Paid</Badge>;
                      if (status === "partially_paid") return <Badge className="bg-amber-100 hover:bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400">Partially Paid</Badge>;
                      return <Badge className="bg-red-100 hover:bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400">Unpaid Liability</Badge>;
                    }
                  },
                  {
                    key: "actions",
                    header: "Actions",
                    render: (b: any) => {
                      const balance = Number(b.amount) - Number(b.amountPaid || 0);
                      if (balance <= 0) return <Badge variant="outline" className="text-emerald-500 border-emerald-500/25">Settled</Badge>;
                      return (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedBill(b);
                            setPayAmount(balance.toString());
                            setIsPayDialogOpen(true);
                          }}
                        >
                          Record Payment
                        </Button>
                      );
                    }
                  }
                ]}
                searchable
                searchPlaceholder="Search bills by vendor..."
                searchKeys={["vendor.name"]}
                isLoading={isLoadingBills}
                emptyMessage="No accounts payable invoices logged."
                urlKey="bills"
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* PO Details Modal */}
      {/* Record Payment Dialog */}
      <Dialog open={isPayDialogOpen} onOpenChange={setIsPayDialogOpen}>
        <DialogContent className="max-w-md border border-border bg-background/95 backdrop-blur-lg text-foreground">
          <DialogHeader>
            <DialogTitle>Record Supplier Payment</DialogTitle>
            <DialogDescription>Log a partial or full cash disbursement against an outstanding vendor bill.</DialogDescription>
          </DialogHeader>

          {selectedBill && (
            <div className="space-y-4 pt-4">
              <div className="space-y-1 text-sm bg-muted/30 p-3 rounded border border-border/40">
                <p><strong>Supplier:</strong> {selectedBill.vendor?.name}</p>
                <p><strong>Invoice Date:</strong> {new Date(selectedBill.billDate).toLocaleDateString()}</p>
                <p><strong>Total Bill:</strong> {formatCurrency(selectedBill.amount)}</p>
                <p><strong>Already Settled:</strong> {formatCurrency(selectedBill.amountPaid || 0)}</p>
                <p className="text-red-500 font-semibold">
                  <strong>Remaining Balance:</strong> {formatCurrency(Number(selectedBill.amount) - Number(selectedBill.amountPaid || 0))}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="pay-amount">Payment Amount to Log ({storeCurrency})</Label>
                <Input
                  id="pay-amount"
                  type="number"
                  min="0.01"
                  max={Number(selectedBill.amount) - Number(selectedBill.amountPaid || 0)}
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder="e.g. 5000"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pay-notes">Transaction Reference / Notes</Label>
                <Input
                  id="pay-notes"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  placeholder="e.g. Bank Transfer Ref: 109283"
                />
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <Button variant="ghost" onClick={() => setIsPayDialogOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => recordPaymentMutation.mutate()}
                  disabled={recordPaymentMutation.isPending || !payAmount}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {recordPaymentMutation.isPending ? "Recording..." : "Confirm Disbursement"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>


      {activeTab === "list" && (
        <SpeedDialFAB
          actions={[
            {
              label: "New PO",
              icon: <FileText className="h-5 w-5" />,
              onClick: () => setLocation("/purchase-orders/new"),
              testId: "fab-new-po",
            },
          ]}
        />
      )}
    </div>
  );
}

