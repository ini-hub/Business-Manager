import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useUrlState } from "@/hooks/use-url-state";
import { Plus, FileText, CheckCircle, XCircle, Clock, Trash2, Printer, Download, MessageCircle, RefreshCw, Package, ShoppingCart } from "lucide-react";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { SpeedDialFAB } from "@/components/speed-dial-fab";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency as formatCurrencyUtil, formatCurrencyCompact } from "@/lib/currency-utils";
import { MetricGrid } from "@/components/metric-grid";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CustomerLink, EntityLink } from "@/components/oop-ui/EntityDisplayPresenter";
import { buildSlug } from "@/lib/slug";
import { useToast } from "@/hooks/use-toast";
import { BulkOperations } from "@/components/bulk-operations";
import { QUOTE_BULK_CONFIG } from "@/lib/bulk-entity-configs";
import { BulkSelectionActionBar } from "@/components/bulk-selection-action-bar";
import { runBulkFanOut } from "@/lib/bulk-actions";
import { exportReportToPDF } from "@/lib/export-utils";
import { ProductGrid } from "@/pages/new-sale/ProductGrid";
import { QuoteItemRow } from "@/pages/quotes/QuoteItemRow";
import type { QuoteCartItem } from "@/pages/quotes/types";
import { cn } from "@/lib/utils";
import type { TableFilterConfig } from "@/components/oop-ui/PolymorphicTable";
import type { Quote, QuoteItem, Customer, Inventory } from "@shared/schema";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type QuoteWithCustomer = Quote & { customer: Customer | null };
type FullQuote = Quote & { customer: Customer | null; items: (QuoteItem & { inventory: Inventory })[] };

export default function QuotesPage() {
  const { currentStore } = useStore();
  const { user } = useAuth();
  const { toast } = useToast();
  const storeCurrency = currentStore?.currency || "NGN";

  const [activeTab, setActiveTab] = useUrlState<string>("tab", "list");
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<(string | number)[]>([]);

  const isManagerOrOwner = user?.role === "owner" || user?.role === "manager";

  // New quote form state
  const [customerId, setCustomerId] = useState<string>("");
  const [quoteRef, setQuoteRef] = useState<string>(`QT-${Date.now().toString().slice(-6)}`);
  const [notes, setNotes] = useState<string>("");
  const [validUntil, setValidUntil] = useState<string>("");
  const [quoteCart, setQuoteCart] = useState<QuoteCartItem[]>([]);
  const [productSearch, setProductSearch] = useState("");
  // Mobile-only pane switcher — mirrors the POS builder's Products/Cart tab bar.
  const [builderView, setBuilderView] = useState<"items" | "review">("items");

  // Fetch Quotes
  const { data: quotes = [], isLoading: isLoadingQuotes } = useQuery<QuoteWithCustomer[]>({
    queryKey: ["/api/quotes", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/quotes?storeId=${currentStore!.id}`);
      return res.json();
    },
    enabled: !!currentStore?.id,
  });

  // Fetch Customers
  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/customers?storeId=${currentStore!.id}`);
      return res.json();
    },
    enabled: !!currentStore?.id,
  });

  // Fetch Inventory items. Unlike /api/products (manager/owner only, used by the
  // POS's variant-grouped picker), this endpoint is open to any authenticated
  // staff member, which the quote builder needs to keep — quoting isn't a
  // manager-only action today and this rebuild must not make it one.
  const { data: inventoryItems = [], isLoading: isLoadingInventory } = useQuery<Inventory[]>({
    queryKey: ["/api/inventory", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/inventory?storeId=${currentStore!.id}`);
      return res.json();
    },
    enabled: !!currentStore?.id,
  });

  // ProductGrid expects variant-grouped products; without the manager-gated
  // /api/products endpoint, each inventory row becomes its own single-variant
  // group so the same tile/search/popover UI still works for every role.
  const productGroups = inventoryItems
    .filter((inv) => inv.type !== "supply")
    .map((inv) => ({
      id: inv.id,
      name: inv.name,
      type: (inv.type === "service" ? "service" : "product") as "product" | "service",
      variants: [inv],
    }));

  // Fetch Single Quote details
  const { data: fullQuote, isLoading: isLoadingDetails } = useQuery<FullQuote>({
    queryKey: ["/api/quotes", selectedQuoteId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/quotes/${selectedQuoteId}`);
      return res.json();
    },
    enabled: !!selectedQuoteId,
  });

  // Create Quote mutation
  const createQuoteMutation = useMutation({
    mutationFn: async () => {
      if (quoteCart.length === 0) throw new Error("At least one item is required.");
      const submission = {
        storeId: currentStore!.id,
        customerId: customerId || null,
        quoteRef,
        notes: notes || null,
        validUntil: validUntil || null,
        items: quoteCart.map((c) => ({
          inventoryId: c.inventory.id,
          quantity: c.quantity,
          unitPrice: c.customPrice,
        })),
      };
      await apiRequest("POST", "/api/quotes", submission);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotes"] });
      toast({ title: "Success", description: "Quote proposal created successfully." });
      setActiveTab("list");
      resetForm();
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message || "Failed to create quote.", variant: "destructive" });
    },
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

  const resetForm = () => {
    setCustomerId("");
    setQuoteRef(`QT-${Date.now().toString().slice(-6)}`);
    setNotes("");
    setValidUntil("");
    setQuoteCart([]);
    setProductSearch("");
    setBuilderView("items");
  };

  const formatCurrency = (value: number) => formatCurrencyUtil(value, storeCurrency);
  const formatCompact = (value: number) => formatCurrencyCompact(value, storeCurrency);

  // Cart mechanics mirror the POS builder (new-sale.tsx): tap a tile to add or
  // bump quantity, then adjust quantity/price freely from the line item — a
  // quote never touches stock, so there's no ceiling to enforce here.
  const addToQuoteCart = (item: Inventory) => {
    setQuoteCart((prev) => {
      const existing = prev.find((c) => c.inventory.id === item.id);
      const step = item.allowFractional ? 0.5 : 1;
      if (existing) {
        const newQty = Math.round((existing.quantity + step) * 100) / 100;
        return prev.map((c) =>
          c.inventory.id === item.id
            ? { ...c, quantity: newQty, totalPrice: Math.round(newQty * c.customPrice * 100) / 100 }
            : c
        );
      }
      const initialQty = item.allowFractional ? step : 1;
      const price = Number(item.sellingPrice || item.costPrice || 0);
      return [...prev, {
        inventory: item,
        quantity: initialQty,
        customPrice: price,
        totalPrice: Math.round(initialQty * price * 100) / 100,
      }];
    });
  };

  const updateQuoteQuantity = (itemId: string, delta: number) => {
    setQuoteCart((prev) =>
      prev
        .map((c) => {
          if (c.inventory.id !== itemId) return c;
          const newQty = Math.round((c.quantity + delta) * 10000) / 10000;
          const minQty = c.inventory.allowFractional ? 0.01 : 1;
          if (newQty < minQty) return null as unknown as QuoteCartItem;
          return { ...c, quantity: newQty, totalPrice: Math.round(newQty * c.customPrice * 100) / 100 };
        })
        .filter(Boolean)
    );
  };

  const setQuoteExactQuantity = (itemId: string, newQty: number) => {
    setQuoteCart((prev) =>
      prev.map((c) => {
        if (c.inventory.id !== itemId) return c;
        const minQty = c.inventory.allowFractional ? 0.01 : 1;
        const validQty = Math.max(minQty, newQty);
        return { ...c, quantity: validQty, totalPrice: Math.round(validQty * c.customPrice * 100) / 100 };
      })
    );
  };

  const updateQuoteItemPrice = (itemId: string, newPrice: number) => {
    if (newPrice < 0) return;
    setQuoteCart((prev) =>
      prev.map((c) =>
        c.inventory.id === itemId
          ? { ...c, customPrice: newPrice, totalPrice: Math.round(c.quantity * newPrice * 100) / 100 }
          : c
      )
    );
  };

  const removeFromQuoteCart = (itemId: string) => {
    setQuoteCart((prev) => prev.filter((c) => c.inventory.id !== itemId));
  };

  const quoteTotal = quoteCart.reduce((sum, item) => sum + item.totalPrice, 0);

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
    window.print();
  };

  const handleDownloadPdf = async () => {
    const printContent = document.getElementById("quote-printable-invoice");
    if (!printContent) {
      toast({ title: "Nothing to download", description: "The proposal hasn't finished loading yet.", variant: "destructive" });
      return;
    }
    try {
      const canvas = await html2canvas(printContent, { scale: 2, useCORS: true });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ unit: "mm", format: "a4" });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
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
    const validUntil = fullQuote.validUntil ? new Date(fullQuote.validUntil).toLocaleDateString() : "N/A";
    const msg = encodeURIComponent(
      `*Proposal from ${currentStore?.name ?? "Business"}*\n` +
      `Ref: ${fullQuote.quoteRef}\n` +
      `Customer: ${customerName}\n` +
      `Total: ${formatCurrency(fullQuote.totalPrice)}\n` +
      `Status: ${fullQuote.status}\n` +
      `Valid until: ${validUntil}\n\n` +
      `Thank you for your business!`
    );
    window.open(`https://wa.me/?text=${msg}`, "_blank");
  };

  const columns = [
    {
      key: "quoteRef",
      header: "Proposal Ref",
      render: (q: QuoteWithCustomer) => (
        <span className="font-mono text-sm font-semibold text-primary">{q.quoteRef}</span>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      render: (q: QuoteWithCustomer) => (
        <CustomerLink customer={q.customer} customerId={q.customerId} fallbackName="Walk-in Customer" />
      ),
    },
    {
      key: "totalPrice",
      header: "Estimated Value",
      render: (q: QuoteWithCustomer) => (
        <span className="font-mono font-medium">{formatCurrency(q.totalPrice)}</span>
      ),
    },
    {
      key: "validUntil",
      header: "Expiry Date",
      render: (q: QuoteWithCustomer) => (
        <span className="text-muted-foreground text-sm">
          {q.validUntil ? new Date(q.validUntil).toLocaleDateString() : "No Expiry"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
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

  const quoteFilterConfigs: TableFilterConfig[] = [
    { key: "status", label: "Status", type: "select" },
    { key: "createdAt", label: "Created Date", type: "date-range" },
    { key: "totalPrice", label: "Estimated Value", type: "range", currencySymbol: storeCurrency === "USD" ? "$" : "₦" },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader
        title="Quotes & Proposals"
        description="Draft pricing proposals, dispatch proforma receipts, and track pipeline values."
        actions={
          activeTab === "list" && (
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
          )
        }
      />

      <MetricGrid>
        <MetricCard
          title="Total Proposal Value"
          value={formatCurrency(totalVal)}
          compactValue={formatCompact(totalVal)}
          icon={<FileText className="h-4 w-4 text-indigo-500" />}
          isLoading={isLoadingQuotes}
        />
        <MetricCard
          title="Draft / Estimates"
          value={formatCurrency(draftVal)}
          compactValue={formatCompact(draftVal)}
          icon={<Clock className="h-4 w-4 text-slate-500" />}
          isLoading={isLoadingQuotes}
        />
        <MetricCard
          title="Sent (In Pipeline)"
          value={formatCurrency(sentVal)}
          compactValue={formatCompact(sentVal)}
          icon={<RefreshCw className="h-4 w-4 text-blue-500 animate-spin-slow" />}
          isLoading={isLoadingQuotes}
        />
        <MetricCard
          title="Accepted Proposals"
          value={formatCurrency(acceptedVal)}
          compactValue={formatCompact(acceptedVal)}
          icon={<CheckCircle className="h-4 w-4 text-emerald-500" />}
          isLoading={isLoadingQuotes}
        />
      </MetricGrid>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="list" className="gap-2">
            <FileText className="h-4 w-4" /> Quotes Registry
          </TabsTrigger>
          <TabsTrigger value="create" className="gap-2">
            <Plus className="h-4 w-4" /> Visual Proposal Builder
          </TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-6">
          <Card className="border border-border/40 bg-background/50 backdrop-blur-md">
            <CardHeader>
              <CardTitle>Quotes Registry</CardTitle>
              <CardDescription>Track customer estimates, status tags, and expiry dates.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
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
              <DataTable
                data={quotes}
                columns={columns}
                searchable
                searchPlaceholder="Search quote reference..."
                searchKeys={["quoteRef", "notes"]}
                filterConfigs={quoteFilterConfigs}
                isLoading={isLoadingQuotes}
                emptyMessage="No quotes found. Open the builder to create one."
                multiselect={isManagerOrOwner}
                selectedIds={selectedIds}
                onSelectedIdsChange={setSelectedIds}
                urlKey="quotes"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="create" className="space-y-6">
          <Card className="border border-border/40 bg-background/50 backdrop-blur-md">
            <CardHeader>
              <CardTitle>Visual Proposal Builder</CardTitle>
              <CardDescription>Assemble pricing lists, adjust unit rates, and configure margins dynamically.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="customer">Customer Link (Optional)</Label>
                    <Select value={customerId} onValueChange={setCustomerId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Walk-in Customer" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Walk-in / General</SelectItem>
                        {customers.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name} ({c.mobileNumber || "No Phone"})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="quoteRef">Quote Reference</Label>
                    <Input
                      id="quoteRef"
                      value={quoteRef}
                      onChange={(e) => setQuoteRef(e.target.value)}
                      placeholder="e.g. QT-1002"
                      className="font-mono"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="validUntil">Proposal Validity Expiry</Label>
                    <Input
                      id="validUntil"
                      type="date"
                      value={validUntil}
                      onChange={(e) => setValidUntil(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Proposal Line Items</Label>

                  {/* Mobile pane switcher — same pattern as the POS builder's Products/Cart tab bar */}
                  <div className="flex lg:hidden rounded-lg border bg-muted/40 p-1 gap-1">
                    <button
                      type="button"
                      onClick={() => setBuilderView("items")}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors",
                        builderView === "items" ? "bg-background shadow-sm text-primary" : "text-muted-foreground"
                      )}
                    >
                      <Package className="h-3.5 w-3.5" /> Items
                    </button>
                    <button
                      type="button"
                      onClick={() => setBuilderView("review")}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors relative",
                        builderView === "review" ? "bg-background shadow-sm text-primary" : "text-muted-foreground"
                      )}
                    >
                      <ShoppingCart className="h-3.5 w-3.5" /> Review
                      {quoteCart.length > 0 && (
                        <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px]">{quoteCart.length}</Badge>
                      )}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4">
                    <div className={cn(builderView === "items" ? "block" : "hidden lg:block")}>
                      <ProductGrid
                        products={productGroups}
                        isLoading={isLoadingInventory}
                        cart={quoteCart}
                        searchTerm={productSearch}
                        onSearchChange={setProductSearch}
                        onAddToCart={addToQuoteCart}
                        formatCurrency={formatCurrency}
                        allowOutOfStock
                      />
                    </div>

                    <div className={cn(builderView === "review" ? "block" : "hidden lg:block")}>
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base font-medium flex items-center gap-2">
                            <ShoppingCart className="h-4 w-4" />
                            Proposal Items ({quoteCart.length})
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          {quoteCart.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-8 text-center">
                              <ShoppingCart className="h-10 w-10 text-muted-foreground/50 mb-3" />
                              <p className="text-sm text-muted-foreground">
                                Pick a product or service to add it to the proposal
                              </p>
                            </div>
                          ) : (
                            <div id="quote-builder-cart" className="space-y-3">
                              {quoteCart.map((item) => (
                                <QuoteItemRow
                                  key={item.inventory.id}
                                  item={item}
                                  formatCurrency={formatCurrency}
                                  onUpdateQuantity={updateQuoteQuantity}
                                  onSetExactQuantity={setQuoteExactQuantity}
                                  onUpdatePrice={updateQuoteItemPrice}
                                  onRemove={removeFromQuoteCart}
                                />
                              ))}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notes">Terms & Additional Notes (Optional)</Label>
                  <Input
                    id="notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Price valid for 14 days. 50% deposit required to confirm transaction."
                  />
                </div>

                <div className="flex justify-between items-center bg-muted/20 p-4 rounded-lg border">
                  <div>
                    <span className="text-sm text-muted-foreground">Proposal Total</span>
                    <h2 className="text-2xl font-bold font-mono text-primary mt-1">{formatCurrency(quoteTotal)}</h2>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={resetForm}>Reset Form</Button>
                    <Button
                      onClick={() => createQuoteMutation.mutate()}
                      disabled={createQuoteMutation.isPending || quoteCart.length === 0}
                      className="px-6"
                    >
                      Generate Estimate Proposal
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* View Quote Details dialog */}
      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="max-w-3xl border border-border bg-background/90 backdrop-blur-lg">
          <DialogHeader>
            <DialogTitle className="flex justify-between items-center w-full pr-6">
              <span>Proposal Detailed View</span>
              <div className="flex gap-2">
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
                {fullQuote && ["draft", "sent"].includes(fullQuote.status) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-emerald-500 hover:text-emerald-700 gap-1"
                    onClick={() => updateStatusMutation.mutate({ id: fullQuote.id, status: "accepted" })}
                  >
                    <CheckCircle className="h-4 w-4" /> Accept
                  </Button>
                )}
                {fullQuote && ["draft", "sent"].includes(fullQuote.status) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-red-500 hover:text-red-700 gap-1"
                    onClick={() => updateStatusMutation.mutate({ id: fullQuote.id, status: "declined" })}
                  >
                    <XCircle className="h-4 w-4" /> Decline
                  </Button>
                )}
                {fullQuote && fullQuote.status === "accepted" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-purple-500 hover:text-purple-700 gap-1"
                    onClick={() => updateStatusMutation.mutate({ id: fullQuote.id, status: "converted" })}
                  >
                    <RefreshCw className="h-4 w-4" /> Convert to Sale
                  </Button>
                )}
                {user?.role === "owner" && fullQuote?.status === "draft" && (
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
            </DialogTitle>
          </DialogHeader>

          {isLoadingDetails ? (
            <div className="py-12 flex justify-center items-center">
              <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !fullQuote ? (
            <p className="text-center text-muted-foreground py-8">Quote proposal not found.</p>
          ) : (
            <div className="space-y-6 max-h-[75vh] overflow-y-auto pr-2">
              {/* Detailed Invoice Card */}
              <div id="quote-printable-invoice" className="bg-white text-black p-8 rounded-lg border shadow-sm">
                <div className="flex justify-between items-start border-b pb-6">
                  <div>
                    <h1 className="text-3xl font-extrabold tracking-tight text-primary uppercase">{currentStore?.name}</h1>
                    <p className="text-xs text-gray-500 mt-1">PROFORMA ESTIMATE proposal</p>
                    <p className="text-sm font-semibold text-gray-700 mt-2">Ref: {fullQuote.quoteRef}</p>
                  </div>
                  <div className="text-right">
                    <span className="px-3 py-1 bg-indigo-50 border text-indigo-700 rounded-full font-bold text-xs uppercase tracking-wide">
                      {fullQuote.status}
                    </span>
                    <p className="text-xs text-gray-400 mt-2">Date: {new Date(fullQuote.createdAt).toLocaleDateString()}</p>
                    {fullQuote.validUntil && (
                      <p className="text-xs text-red-500 font-medium">Valid until: {new Date(fullQuote.validUntil).toLocaleDateString()}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6 my-6 text-sm">
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

                <div className="overflow-x-auto my-6">
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
                          {item.inventory?.id ? (
                            <EntityLink href={`/inventory/${buildSlug(item.inventory.name, item.inventory.id)}`}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <p className="font-medium text-gray-800 truncate max-w-[220px]">{item.inventory.name}</p>
                                </TooltipTrigger>
                                <TooltipContent>{item.inventory.name}</TooltipContent>
                              </Tooltip>
                            </EntityLink>
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <p className="font-medium text-gray-800 truncate max-w-[220px]">{item.inventory.name}</p>
                              </TooltipTrigger>
                              <TooltipContent>{item.inventory.name}</TooltipContent>
                            </Tooltip>
                          )}
                          <Badge variant="outline" className={`text-[10px] capitalize mt-1 ${
                            item.inventory.type === "service" ? "bg-violet-50 text-violet-700 border-violet-200"
                            : item.inventory.type === "mixed" ? "bg-amber-50 text-amber-700 border-amber-200"
                            : "bg-sky-50 text-sky-700 border-sky-200"}`}>
                            {item.inventory.type}
                          </Badge>
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
                    <h2 className="text-3xl font-extrabold text-indigo-600 font-mono mt-1">
                      {formatCurrency(fullQuote.totalPrice)}
                    </h2>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {activeTab === "list" && (
        <SpeedDialFAB
          actions={[
            {
              label: "New Quote",
              icon: <FileText className="h-5 w-5" />,
              onClick: () => setActiveTab("create"),
              testId: "fab-new-quote",
            },
          ]}
        />
      )}
    </div>
  );
}
