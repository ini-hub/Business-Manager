import { fetchAllPages } from "@/lib/paginated";
import { useState } from "react";
import { AddButton } from "@/components/add-button";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Eye, FileText, CheckCircle, Clock, Trash2, RefreshCw } from "lucide-react";
import { SpeedDialFAB } from "@/components/speed-dial-fab";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency as formatCurrencyUtil, formatCurrencyCompact } from "@/lib/currency-utils";
import { MetricRow } from "@/components/metric-row";
import { ListControls } from "@/components/list-controls";
import { QuoteFiltersSheet, QuoteSortSheet } from "@/components/quote-filter-sheets";
import { getCurrencyByCode } from "@/lib/currency-utils";
import {
  EMPTY_QUOTE_FILTERS,
  buildQuoteFilterChips,
  clearQuoteFilterChip,
  countActiveQuoteFilters,
  quoteMatchesFilters,
  quoteMatchesSearch,
  quoteSortLabel,
  sortQuotes,
  type QuoteFilterState,
  type QuoteSortState,
} from "@/lib/quote-filters";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CustomerLink } from "@/components/oop-ui/EntityDisplayPresenter";
import { useToast } from "@/hooks/use-toast";
import { BulkOperations } from "@/components/bulk-operations";
import { QUOTE_BULK_CONFIG } from "@/lib/bulk-entity-configs";
import { BulkSelectionActionBar } from "@/components/bulk-selection-action-bar";
import { runBulkFanOut } from "@/lib/bulk-actions";
import { exportReportToPDF } from "@/lib/export-utils";
import type { Quote, Customer } from "@shared/schema";

type QuoteWithCustomer = Quote & { customer: Customer | null };

export default function QuotesPage() {
  const { currentStore } = useStore();
  const { user } = useAuth();
  const { toast } = useToast();
  const storeCurrency = currentStore?.currency || "NGN";

  const [, setLocation] = useLocation();
  const [quoteSearchTerm, setQuoteSearchTerm] = useState("");
  const [quoteFilters, setQuoteFilters] = useState<QuoteFilterState>(EMPTY_QUOTE_FILTERS);
  const [quoteSort, setQuoteSort] = useState<QuoteSortState | null>(null);
  const [selectedIds, setSelectedIds] = useState<(string | number)[]>([]);

  const isManagerOrOwner = user?.role === "owner" || user?.role === "manager";

  // Fetch Quotes
  const { data: quotes = [], isLoading: isLoadingQuotes } = useQuery<QuoteWithCustomer[]>({
    queryKey: ["/api/quotes", currentStore?.id],
    queryFn: () => fetchAllPages<QuoteWithCustomer>(`/api/quotes?storeId=${currentStore!.id}`),
    enabled: !!currentStore?.id,
  });



  const bulkMarkSentMutation = useMutation({
    mutationFn: (ids: string[]) =>
      runBulkFanOut(ids, async (id) => {
        const res = await apiRequest("PATCH", `/api/quotes/${id}/status`, { status: "sent" });
        if (!res.ok) throw new Error("update failed");
        return "sent" as const;
      }),
    onSuccess: ({ counts }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      setSelectedIds([]);
      const sent = counts.sent ?? 0;
      const failed = counts.failed ?? 0;
      toast(
        failed === 0
          ? { title: `${sent} quote${sent !== 1 ? "s" : ""} marked as sent` }
          : { title: `${sent} updated, ${failed} failed`, variant: "destructive" }
      );
    },
    onError: () => toast({ title: "Bulk update failed", variant: "destructive" }),
  });

  const bulkDeleteQuoteMutation = useMutation({
    mutationFn: (ids: string[]) =>
      runBulkFanOut(ids, async (id) => {
        const res = await apiRequest("DELETE", `/api/quotes/${id}`);
        if (!res.ok) throw new Error("delete failed");
        return "deleted" as const;
      }),
    onSuccess: ({ counts }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      setSelectedIds([]);
      const deleted = counts.deleted ?? 0;
      const failed = counts.failed ?? 0;
      toast(
        failed === 0
          ? { title: `${deleted} quote${deleted !== 1 ? "s" : ""} deleted` }
          : { title: `${deleted} deleted, ${failed} failed`, variant: "destructive" }
      );
    },
    onError: () => toast({ title: "Bulk delete failed", variant: "destructive" }),
  });

  const formatCurrency = (value: number) => formatCurrencyUtil(value, storeCurrency);
  const formatCompact = (value: number) => formatCurrencyCompact(value, storeCurrency);

  const getStatusBadge = (status: string) => {
    const s = status.toLowerCase();
    if (s === "draft") return <Badge variant="secondary" className="bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-300">Draft</Badge>;
    if (s === "sent") return <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300">Sent</Badge>;
    if (s === "accepted") return <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Accepted</Badge>;
    if (s === "declined") return <Badge variant="secondary" className="bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">Declined</Badge>;
    if (s === "converted") return <Badge variant="secondary" className="bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300">Converted</Badge>;
    return <Badge>{status}</Badge>;
  };

  const columns = [
    {
      key: "quoteRef",
      header: "Proposal Ref",
      priority: 3 as const,
      render: (q: QuoteWithCustomer) => (
        <span className="font-mono text-sm font-semibold text-primary">{q.quoteRef}</span>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      priority: 1 as const,
      cardRender: (q: QuoteWithCustomer) => <span className="truncate">{q.customer?.name || "Walk-in Customer"}</span>,
      render: (q: QuoteWithCustomer) => (
        <CustomerLink customer={q.customer} customerId={q.customerId} fallbackName="Walk-in Customer" />
      ),
    },
    {
      key: "totalPrice",
      header: "Estimated Value",
      priority: 1 as const,
      render: (q: QuoteWithCustomer) => (
        <span className="font-mono font-medium">{formatCurrency(q.totalPrice)}</span>
      ),
    },
    {
      key: "validUntil",
      header: "Expiry Date",
      priority: 2 as const,
      cardRender: (q: QuoteWithCustomer) => (
        <span className="truncate">{q.validUntil ? new Date(q.validUntil).toLocaleDateString() : "No Expiry"}</span>
      ),
      render: (q: QuoteWithCustomer) => (
        <span className="text-muted-foreground text-sm">
          {q.validUntil ? new Date(q.validUntil).toLocaleDateString() : "No Expiry"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      priority: 2 as const,
      render: (q: QuoteWithCustomer) => getStatusBadge(q.status),
    },
  ];

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader title="Quotes & Proposals" description="Generate professional proforma invoices & estimates for leads." />
        <StoreRequiredAlert title="Store Required for Quotes" />
      </div>
    );
  }

  // Metric aggregates
  const draftVal = quotes.filter(q => q.status === "draft").reduce((sum, q) => sum + q.totalPrice, 0);
  const sentVal = quotes.filter(q => q.status === "sent").reduce((sum, q) => sum + q.totalPrice, 0);
  const acceptedVal = quotes.filter(q => q.status === "accepted").reduce((sum, q) => sum + q.totalPrice, 0);
  const totalVal = quotes.reduce((sum, q) => sum + q.totalPrice, 0);

  const quoteExportColumns = [
    { key: "quoteRef", header: "Proposal Ref" },
    { key: "customer.name", header: "Customer" },
    { key: "totalPrice", header: "Estimated Value" },
    { key: "status", header: "Status" },
    { key: "validUntil", header: "Expiry Date" },
    { key: "createdAt", header: "Created" },
  ];

  const handleQuoteReportExport = () => {
    return exportReportToPDF({
      filename: `quotes-report_${new Date().toISOString().slice(0, 10)}`,
      title: "Quotes & Proposals Report",
      businessName: currentStore.name,
      storeName: currentStore.name,
      kpis: [
        { label: "Total Proposal Value", value: formatCurrency(totalVal) },
        { label: "Draft / Estimates", value: formatCurrency(draftVal) },
        { label: "Sent (In Pipeline)", value: formatCurrency(sentVal) },
        { label: "Accepted Proposals", value: formatCurrency(acceptedVal) },
      ],
      columns: [
        { key: "quoteRef", header: "Ref" },
        { key: "customerName", header: "Customer", format: (q: QuoteWithCustomer) => q.customer?.name || "Walk-in" },
        { key: "totalPrice", header: "Value", align: "right" as const, format: (q: QuoteWithCustomer) => formatCurrency(q.totalPrice) },
        { key: "status", header: "Status" },
      ],
      rows: quotes,
      amountKey: "totalPrice",
      formatAmount: formatCurrency,
      statusKey: "status",
      unitLabel: "quotes",
    });
  };

  const currencySymbol = getCurrencyByCode(storeCurrency)?.symbol ?? "₦";
  const searchedQuotes = quotes.filter((q) => quoteMatchesSearch(q, quoteSearchTerm));
  const visibleQuotes = sortQuotes(searchedQuotes.filter((q) => quoteMatchesFilters(q, quoteFilters)), quoteSort);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader
        compact
        title="Quotes & Proposals"
        description="Draft pricing proposals, dispatch proforma receipts, and track pipeline values."
        actions={
          <>
            <AddButton label="New Quote" gate="quotes_management" onClick={() => setLocation("/quotes/new")} data-testid="button-new-quote" />
            <div className="lg:hidden">
              <BulkOperations
                entityConfig={QUOTE_BULK_CONFIG}
                data={quotes as unknown as Record<string, unknown>[]}
                columns={quoteExportColumns}
                isLoading={isLoadingQuotes}
                storeId={currentStore.id}
                pdfTitle="Quotes Report"
                onExportPDF={handleQuoteReportExport}
                showImportOption={isManagerOrOwner}
                compact
              />
            </div>
            <div className="hidden lg:block">
              <BulkOperations
                entityConfig={QUOTE_BULK_CONFIG}
                data={quotes as unknown as Record<string, unknown>[]}
                columns={quoteExportColumns}
                isLoading={isLoadingQuotes}
                storeId={currentStore.id}
                pdfTitle="Quotes Report"
                onExportPDF={handleQuoteReportExport}
                showImportOption={isManagerOrOwner}
              />
            </div>
          </>
        }
      />

      <MetricRow
        metrics={[
          { title: "Total Proposal Value", value: formatCurrency(totalVal), compactValue: formatCompact(totalVal), icon: <FileText className="h-4 w-4 text-primary" />, isLoading: isLoadingQuotes },
          { title: "Draft / Estimates", value: formatCurrency(draftVal), compactValue: formatCompact(draftVal), icon: <Clock className="h-4 w-4 text-slate-500" />, isLoading: isLoadingQuotes },
          { title: "Sent (In Pipeline)", value: formatCurrency(sentVal), compactValue: formatCompact(sentVal), icon: <RefreshCw className="h-4 w-4 text-blue-500 animate-spin-slow" />, isLoading: isLoadingQuotes },
          { title: "Accepted Proposals", value: formatCurrency(acceptedVal), compactValue: formatCompact(acceptedVal), icon: <CheckCircle className="h-4 w-4 text-emerald-500" />, isLoading: isLoadingQuotes },
        ]}
      />

      <div className="space-y-3">
            {isManagerOrOwner && (
              <BulkSelectionActionBar
                count={selectedIds.length}
                unitLabel="quote"
                onClear={() => setSelectedIds([])}
                actions={[
                  {
                    key: "mark-sent",
                    label: "Mark as Sent",
                    pendingLabel: "Updating…",
                    icon: <RefreshCw className="h-3.5 w-3.5" />,
                    pending: bulkMarkSentMutation.isPending,
                    onClick: () => bulkMarkSentMutation.mutate(selectedIds as string[]),
                  },
                  {
                    key: "delete",
                    label: "Delete Selected",
                    pendingLabel: "Deleting…",
                    icon: <Trash2 className="h-3.5 w-3.5" />,
                    tone: "destructive",
                    pending: bulkDeleteQuoteMutation.isPending,
                    onClick: () => bulkDeleteQuoteMutation.mutate(selectedIds as string[]),
                  },
                ]}
              />
            )}

        <ListControls
          testIdPrefix="quote"
          placeholder="Search reference, customer or notes"
          search={quoteSearchTerm}
          onSearchChange={setQuoteSearchTerm}
          filterCount={countActiveQuoteFilters(quoteFilters)}
          filters={(trigger) => (
            <QuoteFiltersSheet
              filters={quoteFilters}
              onApply={(next) => { setQuoteFilters(next); setSelectedIds([]); }}
              currencySymbol={currencySymbol}
              resultCountFor={(draft) => searchedQuotes.filter((q) => quoteMatchesFilters(q, draft)).length}
              trigger={trigger}
            />
          )}
          sortLabel={quoteSortLabel(quoteSort).replace(/^Sort: /, "")}
          sort={(trigger) => <QuoteSortSheet sort={quoteSort} onChange={setQuoteSort} trigger={trigger} />}
          chips={buildQuoteFilterChips(quoteFilters, currencySymbol)}
          onRemoveChip={(key) => setQuoteFilters((f) => clearQuoteFilterChip(f, key as Parameters<typeof clearQuoteFilterChip>[1]))}
          hasSort={quoteSort !== null}
          onClearAll={() => { setQuoteFilters(EMPTY_QUOTE_FILTERS); setQuoteSort(null); }}
          visibleCount={visibleQuotes.length}
          noun="quote"
        />

        <DataTable
          data={visibleQuotes}
          columns={columns}
          hideToolbar
          isLoading={isLoadingQuotes}
          emptyMessage="No quotes found. Create one to get started."
          emptyAction={isManagerOrOwner ? <Button size="sm" className="gap-2" onClick={() => setLocation("/quotes/new")}><Plus className="h-4 w-4" />New Quote</Button> : undefined}
          multiselect={isManagerOrOwner}
          selectedIds={selectedIds}
          onSelectedIdsChange={setSelectedIds}
          urlKey="quotes"
          onRowClick={(q) => setLocation(`/quotes/${q.id}`)}
          rowActions={(q) => [
            { label: "View Details", icon: <Eye className="h-4 w-4" />, onClick: () => setLocation(`/quotes/${q.id}`), testId: `action-view-quote-${q.id}` },
          ]}
        />
      </div>

      {(
        <SpeedDialFAB
          actions={[
            {
              label: "New Quote",
              icon: <FileText className="h-5 w-5" />,
              onClick: () => setLocation("/quotes/new"),
              testId: "fab-new-quote",
            },
          ]}
        />
      )}
    </div>
  );
}
