import { useState } from "react";
import { usePoweredByText } from "@/lib/export-branding";
import { AddButton } from "@/components/add-button";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, FileText, CheckCircle, XCircle, Clock, Trash2, Printer, Download, MessageCircle, RefreshCw } from "lucide-react";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { printWithFormat } from "@/lib/print-utils";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getCustomerInitials } from "@/lib/customer-detail-utils";
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
import {
  Dialog,
  DialogContent, DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CustomerLink, EntityLink } from "@/components/oop-ui/EntityDisplayPresenter";
import { buildSlug } from "@/lib/slug";
import { useToast } from "@/hooks/use-toast";
import { BulkOperations } from "@/components/bulk-operations";
import { QUOTE_BULK_CONFIG } from "@/lib/bulk-entity-configs";
import { BulkSelectionActionBar } from "@/components/bulk-selection-action-bar";
import { runBulkFanOut } from "@/lib/bulk-actions";
import { exportReportToPDF } from "@/lib/export-utils";
import type { Quote, QuoteItem, Customer, Inventory } from "@shared/schema";

type QuoteWithCustomer = Quote & { customer: Customer | null };
type FullQuote = Quote & { customer: Customer | null; items: (QuoteItem & { inventory: Inventory })[] };

export default function QuotesPage() {
  const poweredBy = usePoweredByText();
  const { currentStore } = useStore();
  const { user } = useAuth();
  const { toast } = useToast();
  const storeCurrency = currentStore?.currency || "NGN";

  const [, setLocation] = useLocation();
  const [quoteSearchTerm, setQuoteSearchTerm] = useState("");
  const [quoteFilters, setQuoteFilters] = useState<QuoteFilterState>(EMPTY_QUOTE_FILTERS);
  const [quoteSort, setQuoteSort] = useState<QuoteSortState | null>(null);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<(string | number)[]>([]);

  const isManagerOrOwner = user?.role === "owner" || user?.role === "manager";

  // Fetch Quotes
  const { data: quotes = [], isLoading: isLoadingQuotes } = useQuery<QuoteWithCustomer[]>({
    queryKey: ["/api/quotes", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/quotes?storeId=${currentStore!.id}`);
      return res.json();
    },
    enabled: !!currentStore?.id,
  });



  // Fetch Single Quote details
  const { data: fullQuote, isLoading: isLoadingDetails } = useQuery<FullQuote>({
    queryKey: ["/api/quotes", selectedQuoteId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/quotes/${selectedQuoteId}`);
      return res.json();
    },
    enabled: !!selectedQuoteId,
  });

  // Update Quote Status mutation
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await apiRequest("PATCH", `/api/quotes/${id}/status`, { status });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      toast({ title: "Status Updated", description: `Quote status changed to ${variables.status}.` });
    },
  });

  // Delete Quote mutation
  const deleteQuoteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/quotes/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      setIsDetailsOpen(false);
      setSelectedQuoteId(null);
      toast({ title: "Success", description: "Quote deleted successfully." });
    },
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

  const handlePrint = () => {
    if (!document.getElementById("quote-printable-invoice")) {
      toast({ title: "Nothing to print", description: "The proposal hasn't finished loading yet.", variant: "destructive" });
      return;
    }
    printWithFormat("a4-document");
  };

  const handleDownloadPdf = async () => {
    const printContent = document.getElementById("quote-printable-invoice");
    if (!printContent) {
      toast({ title: "Nothing to download", description: "The proposal hasn't finished loading yet.", variant: "destructive" });
      return;
    }
    try {
      // Force a desktop-width layout for the capture regardless of the
      // device's actual viewport — on a narrow phone the invoice card (and
      // the wide item table inside it) renders cramped/scrolled, and
      // html2canvas otherwise screenshots exactly that cramped state,
      // clipping whatever didn't fit.
      const canvas = await html2canvas(printContent, {
        scale: 2,
        useCORS: true,
        windowWidth: 900,
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ unit: "mm", format: "a4" });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfPageHeight = pdf.internal.pageSize.getHeight();
      const imgHeight = (canvas.height * pdfWidth) / canvas.width;

      // A quote with enough line items renders taller than one A4 page.
      // addImage doesn't paginate on its own — without slicing across pages,
      // everything past the first page's worth of height is silently cut
      // off the exported file. Draw the full-height image repeatedly, each
      // time shifted up by one page height, and add a new page per slice.
      let heightLeft = imgHeight;
      let position = 0;
      pdf.addImage(imgData, "PNG", 0, position, pdfWidth, imgHeight);
      heightLeft -= pdfPageHeight;
      while (heightLeft > 0) {
        position -= pdfPageHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, pdfWidth, imgHeight);
        heightLeft -= pdfPageHeight;
      }

      pdf.save(`${fullQuote?.quoteRef ?? "quote"}.pdf`);
    } catch (err) {
      console.error("Quote PDF generation failed:", err);
      toast({ title: "Download failed", description: "Could not generate the PDF. Please try again.", variant: "destructive" });
    }
  };

  const handleWhatsAppShare = () => {
    if (!fullQuote) {
      toast({ title: "Nothing to share", description: "The proposal hasn't finished loading yet.", variant: "destructive" });
      return;
    }
    const customerName = fullQuote.customer?.name ?? "Walk-in Customer";
    const createdDate = new Date(fullQuote.createdAt).toLocaleDateString();
    const validUntil = fullQuote.validUntil ? new Date(fullQuote.validUntil).toLocaleDateString() : "N/A";

    // Mirror the printable proforma line-by-line so a recipient gets the full
    // grasp of the quote from the WhatsApp message alone, not just a total.
    const itemLines = fullQuote.items
      .map((item) => {
        const name = item.inventory?.name ?? "Item";
        const type = item.inventory?.type ? ` (${item.inventory.type})` : "";
        return `• ${name}${type} — ${item.quantity} x ${formatCurrency(item.unitPrice)} = ${formatCurrency(item.totalPrice)}`;
      })
      .join("\n");

    const msg = encodeURIComponent(
      `*${currentStore?.name ?? "Business"}*\n` +
      `PROFORMA ESTIMATE PROPOSAL\n\n` +
      `Ref: ${fullQuote.quoteRef}\n` +
      `Status: ${fullQuote.status.toUpperCase()}\n` +
      `Date: ${createdDate}\n` +
      `Valid until: ${validUntil}\n\n` +
      `*Client:* ${customerName}${fullQuote.customer?.mobileNumber ? ` (${fullQuote.customer.mobileNumber})` : ""}\n\n` +
      `*Items:*\n${itemLines}\n\n` +
      `*Terms & Notes:*\n${fullQuote.notes || "Standard proforma conditions apply."}\n\n` +
      `*Aggregated Quote Value: ${formatCurrency(fullQuote.totalPrice)}*\n\n` +
      `Thank you for your business!`
    );
    window.open(`https://wa.me/?text=${msg}`, "_blank");
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
    {
      key: "actions",
      header: "Actions",
      render: (q: QuoteWithCustomer) => (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setSelectedQuoteId(q.id);
            setIsDetailsOpen(true);
          }}
        >
          View Details
        </Button>
      ),
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
  const quoteCardAvatar = (q: QuoteWithCustomer) => (
    <Avatar className="h-10 w-10">
      <AvatarFallback className="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 text-sm font-semibold">
        {getCustomerInitials(q.customer?.name || "Walk-in")}
      </AvatarFallback>
    </Avatar>
  );

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
          onRowClick={(q) => { setSelectedQuoteId(q.id); setIsDetailsOpen(true); }}
          showCardChevron
          cardLayout="compact-grid"
          cardAvatar={quoteCardAvatar}
        />
      </div>

      {/* View Quote Details dialog */}
      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        {/* print: resets undo the fixed-position, height-capped, scrollable
            dialog chrome for the print path — window.print() lays out
            content inside whatever box it's still sitting in, so without
            this only the portion scrolled into view at print-time would
            make it onto the page instead of the full proposal. */}
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto border border-border bg-background/90 backdrop-blur-lg print:static print:max-h-none print:overflow-visible print:translate-x-0 print:translate-y-0 print:border-none print:bg-white print:backdrop-blur-none">
          <DialogHeader>
            <DialogTitle>Proposal Detailed View</DialogTitle>
          </DialogHeader>

          {isLoadingDetails ? (
            <div className="py-12 flex justify-center items-center">
              <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !fullQuote ? (
            <p className="text-center text-muted-foreground py-8">Quote proposal not found.</p>
          ) : (
            <div className="space-y-6">
              {/* Action buttons — wrap onto multiple lines on narrow screens
                  instead of overflowing off the edge of the dialog. */}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1">
                  <Printer className="h-4 w-4" /> Print Proforma
                </Button>
                <Button variant="outline" size="sm" onClick={handleDownloadPdf} className="gap-1">
                  <Download className="h-4 w-4" /> Download PDF
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleWhatsAppShare}
                  className="gap-1 text-green-600 border-green-300 hover:bg-green-50"
                >
                  <MessageCircle className="h-4 w-4" /> Share
                </Button>
                {["draft", "sent"].includes(fullQuote.status) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-emerald-500 hover:text-emerald-700 gap-1"
                    onClick={() => updateStatusMutation.mutate({ id: fullQuote.id, status: "accepted" })}
                  >
                    <CheckCircle className="h-4 w-4" /> Accept
                  </Button>
                )}
                {["draft", "sent"].includes(fullQuote.status) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-red-500 hover:text-red-700 gap-1"
                    onClick={() => updateStatusMutation.mutate({ id: fullQuote.id, status: "declined" })}
                  >
                    <XCircle className="h-4 w-4" /> Decline
                  </Button>
                )}
                {fullQuote.status === "accepted" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-primary hover:text-primary/80 gap-1"
                    onClick={() => updateStatusMutation.mutate({ id: fullQuote.id, status: "converted" })}
                  >
                    <RefreshCw className="h-4 w-4" /> Convert to Sale
                  </Button>
                )}
                {user?.role === "owner" && fullQuote.status === "draft" && (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-1"
                    onClick={() => deleteQuoteMutation.mutate(fullQuote.id)}
                  >
                    <Trash2 className="h-4 w-4" /> Delete
                  </Button>
                )}
              </div>

              {/* Detailed Invoice Card */}
              <div id="quote-printable-invoice" className="bg-white text-black p-4 sm:p-8 rounded-lg border shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-start border-b pb-6">
                  <div>
                    <h1 className="text-[26px] sm:text-[26px] font-bold tracking-tight text-primary uppercase">{currentStore?.name}</h1>
                    <p className="text-xs text-gray-500 mt-1">PROFORMA ESTIMATE proposal</p>
                    <p className="text-sm font-semibold text-gray-700 mt-2">Ref: {fullQuote.quoteRef}</p>
                  </div>
                  <div className="text-right">
                    <span className="inline-flex items-center justify-center leading-none px-3 py-2 bg-primary/10 border text-primary rounded-full font-bold text-xs uppercase tracking-wide">
                      {fullQuote.status}
                    </span>
                    <p className="text-xs text-gray-400 mt-2">Date: {new Date(fullQuote.createdAt).toLocaleDateString()}</p>
                    {fullQuote.validUntil && (
                      <p className="text-xs text-red-500 font-medium">Valid until: {new Date(fullQuote.validUntil).toLocaleDateString()}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 my-6 text-sm">
                  <div>
                    <p className="text-xs text-gray-400 uppercase font-semibold">Prepared By</p>
                    <p className="font-bold text-gray-800">{currentStore?.name}</p>
                    <p className="text-gray-500 text-xs">Branch ID: {currentStore?.id}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 uppercase font-semibold">Client Recipient</p>
                    {fullQuote.customer?.id ? (
                      <EntityLink href={`/customers/${buildSlug(fullQuote.customer.name, fullQuote.customer.id)}`} className="font-bold text-gray-800">
                        {fullQuote.customer.name}
                      </EntityLink>
                    ) : (
                      <p className="font-bold text-gray-800">Walk-in Customer</p>
                    )}
                    {fullQuote.customer?.mobileNumber && (
                      <p className="text-gray-500 text-xs">{fullQuote.customer.mobileNumber}</p>
                    )}
                  </div>
                </div>

                {/* Mobile: stacked cards instead of squeezing a 4-column table into a
                    phone width — the table's horizontal scroll hid Quantity/Rate/Total
                    off-screen and required sideways scrolling per row to read them. */}
                <div className="sm:hidden my-6 space-y-3">
                  {fullQuote.items.map((item, idx) => (
                    <div key={idx} className="rounded-lg border p-3 text-sm text-gray-700">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex flex-col items-start gap-1 min-w-0">
                          {item.inventory?.id ? (
                            <EntityLink href={`/inventory/${buildSlug(item.inventory.name, item.inventory.id)}`} className="block">
                              <p className="font-medium text-gray-800">{item.inventory.name}</p>
                            </EntityLink>
                          ) : (
                            <p className="font-medium text-gray-800">{item.inventory.name}</p>
                          )}
                          <Badge variant="outline" className={`text-[11px] leading-none capitalize ${
                            item.inventory.type === "service" ? "bg-violet-50 text-violet-700 border-violet-200"
                            : item.inventory.type === "mixed" ? "bg-amber-50 text-amber-700 border-amber-200"
                            : "bg-sky-50 text-sky-700 border-sky-200"}`}>
                            {item.inventory.type}
                          </Badge>
                        </div>
                        <p className="font-mono font-semibold text-gray-800 whitespace-nowrap">{formatCurrency(item.totalPrice)}</p>
                      </div>
                      <div className="mt-2 flex justify-between text-xs text-gray-500 font-mono">
                        <span>{item.quantity} × {formatCurrency(item.unitPrice)}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="hidden sm:block overflow-x-auto my-6">
                <table className="w-full min-w-[500px] text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b bg-gray-50 text-gray-500 font-semibold">
                      <th className="py-2 px-3">Item Description</th>
                      <th className="py-2 px-3 text-right">Quantity</th>
                      <th className="py-2 px-3 text-right">Unit Rate</th>
                      <th className="py-2 px-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fullQuote.items.map((item, idx) => (
                      <tr key={idx} className="border-b text-gray-700">
                        <td className="py-3 px-3">
                          {/* Explicit column stack — EntityLink renders an inline <span>
                              wrapping a block <p>, which otherwise lets the badge below
                              render tucked into/overlapping the name instead of under it. */}
                          {/* No `truncate` (text-overflow: ellipsis) on the name — html2canvas
                              (used for the PDF download) mis-renders CSS ellipsis truncation as
                              a garbled/strikethrough-looking mess in the captured image. Wrapping
                              within max-w is safe and reads fine on screen too, so the Tooltip
                              (only useful for hidden overflow) is dropped along with it. */}
                          <div className="flex flex-col items-start gap-1">
                            {item.inventory?.id ? (
                              <EntityLink href={`/inventory/${buildSlug(item.inventory.name, item.inventory.id)}`} className="block max-w-[220px]">
                                <p className="font-medium text-gray-800 break-words">{item.inventory.name}</p>
                              </EntityLink>
                            ) : (
                              <p className="font-medium text-gray-800 break-words max-w-[220px]">{item.inventory.name}</p>
                            )}
                            <Badge variant="outline" className={`text-[11px] leading-none capitalize ${
                              item.inventory.type === "service" ? "bg-violet-50 text-violet-700 border-violet-200"
                              : item.inventory.type === "mixed" ? "bg-amber-50 text-amber-700 border-amber-200"
                              : "bg-sky-50 text-sky-700 border-sky-200"}`}>
                              {item.inventory.type}
                            </Badge>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono">{item.quantity}</td>
                        <td className="py-3 px-3 text-right font-mono">{formatCurrency(item.unitPrice)}</td>
                        <td className="py-3 px-3 text-right font-mono font-semibold">{formatCurrency(item.totalPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>

                <div className="flex justify-between items-start mt-6 pt-6 border-t">
                  <div className="max-w-[400px]">
                    <p className="text-xs text-gray-400 uppercase font-semibold">Terms & Notes</p>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed italic">
                      {fullQuote.notes || "Standard proforma conditions apply."}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400 uppercase font-semibold">Aggregated Quote Value</p>
                    <h2 className="text-lg font-bold text-primary font-mono mt-1">
                      {formatCurrency(fullQuote.totalPrice)}
                    </h2>
                  </div>
                </div>
                {poweredBy && <p className="text-center text-[10px] text-gray-400 mt-6">{poweredBy}</p>}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

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
