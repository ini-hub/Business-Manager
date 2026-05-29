import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, FileText, CheckCircle, XCircle, Clock, Trash2, Edit, Printer, FileDown, PlusCircle, Trash, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency-utils";
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
import { CustomerPresenter, EntityDisplay } from "@/components/oop-ui/EntityDisplayPresenter";
import { useToast } from "@/hooks/use-toast";
import type { Quote, QuoteItem, Customer, Inventory } from "@shared/schema";

type QuoteWithCustomer = Quote & { customer: Customer | null };
type FullQuote = Quote & { customer: Customer | null; items: (QuoteItem & { inventory: Inventory })[] };

export default function QuotesPage() {
  const { currentStore } = useStore();
  const { user } = useAuth();
  const { toast } = useToast();
  const storeCurrency = currentStore?.currency || "NGN";

  const [activeTab, setActiveTab] = useState<string>("list");
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  // New quote form state
  const [customerId, setCustomerId] = useState<string>("");
  const [quoteRef, setQuoteRef] = useState<string>(`QT-${Date.now().toString().slice(-6)}`);
  const [notes, setNotes] = useState<string>("");
  const [validUntil, setValidUntil] = useState<string>("");
  const [items, setItems] = useState<{ inventoryId: string; quantity: number; unitPrice: number }[]>([]);

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

  // Fetch Inventory items
  const { data: inventoryItems = [] } = useQuery<Inventory[]>({
    queryKey: ["/api/inventory", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/inventory?storeId=${currentStore!.id}`);
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

  // Create Quote mutation
  const createQuoteMutation = useMutation({
    mutationFn: async () => {
      if (items.length === 0) throw new Error("At least one item is required.");
      const submission = {
        storeId: currentStore!.id,
        customerId: customerId || null,
        quoteRef,
        notes: notes || null,
        validUntil: validUntil || null,
        items,
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

  const resetForm = () => {
    setCustomerId("");
    setQuoteRef(`QT-${Date.now().toString().slice(-6)}`);
    setNotes("");
    setValidUntil("");
    setItems([]);
  };

  const formatCurrency = (value: number) => formatCurrencyUtil(value, storeCurrency);

  const addItemRow = () => {
    setItems([...items, { inventoryId: "", quantity: 1, unitPrice: 0 }]);
  };

  const removeItemRow = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItemRow = (index: number, field: string, value: any) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };

    // Auto-populate price if inventory item is selected
    if (field === "inventoryId") {
      const inv = inventoryItems.find(i => i.id === value);
      if (inv) {
        updated[index].unitPrice = Number(inv.sellingPrice || inv.costPrice || 0);
      }
    }
    setItems(updated);
  };

  const quoteTotal = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);

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
    const printContent = document.getElementById("quote-printable-invoice");
    if (!printContent) return;
    const windowUrl = "about:blank";
    const uniqueName = new Date().getTime();
    const printWindow = window.open(windowUrl, uniqueName.toString(), "left=50000,top=50000,width=0,height=0");
    if (!printWindow) return;
    
    printWindow.document.write(`
      <html>
        <head>
          <title>Quote #${fullQuote?.quoteRef}</title>
          <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
          <style>
            body { font-family: sans-serif; color: #111; padding: 40px; }
            @media print {
              body { padding: 0; }
            }
          </style>
        </head>
        <body onload="window.print();window.close();">
          ${printContent.innerHTML}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
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
      render: (q: QuoteWithCustomer) => {
        const presenter = new CustomerPresenter({
          name: q.customer?.name || "Walk-in Customer",
          customerNumber: q.customer?.customerNumber || q.customerId || "—",
          mobileNumber: q.customer?.mobileNumber,
        });
        return <EntityDisplay presenter={presenter} />;
      },
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

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader
        title="Quotes & Proposals"
        description="Draft pricing proposals, dispatch proforma receipts, and track pipeline values."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total Proposal Value"
          value={formatCurrency(totalVal)}
          icon={<FileText className="h-4 w-4 text-indigo-500" />}
          isLoading={isLoadingQuotes}
        />
        <MetricCard
          title="Draft / Estimates"
          value={formatCurrency(draftVal)}
          icon={<Clock className="h-4 w-4 text-slate-500" />}
          isLoading={isLoadingQuotes}
        />
        <MetricCard
          title="Sent (In Pipeline)"
          value={formatCurrency(sentVal)}
          icon={<RefreshCw className="h-4 w-4 text-blue-500 animate-spin-slow" />}
          isLoading={isLoadingQuotes}
        />
        <MetricCard
          title="Accepted Proposals"
          value={formatCurrency(acceptedVal)}
          icon={<CheckCircle className="h-4 w-4 text-emerald-500" />}
          isLoading={isLoadingQuotes}
        />
      </div>

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
            <CardContent>
              <DataTable
                data={quotes}
                columns={columns}
                searchable
                searchPlaceholder="Search quote reference..."
                searchKeys={["quoteRef", "notes"]}
                isLoading={isLoadingQuotes}
                emptyMessage="No quotes found. Open the builder to create one."
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
                  <div className="space-y-3">
                    {items.map((item, index) => (
                      <div key={index} className="flex gap-4 items-center bg-muted/40 p-3 rounded-lg border">
                        <div className="flex-1 min-w-[200px]">
                          <Label className="text-xs text-muted-foreground">Select Product / Service</Label>
                          <Select
                            value={item.inventoryId}
                            onValueChange={(val) => updateItemRow(index, "inventoryId", val)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Choose inventory item" />
                            </SelectTrigger>
                            <SelectContent>
                              {inventoryItems.map((inv) => (
                                <SelectItem key={inv.id} value={inv.id}>
                                  {inv.name} ({inv.id.substring(0, 8).toUpperCase()}) - Cost: {formatCurrency(inv.costPrice)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="w-24">
                          <Label className="text-xs text-muted-foreground font-mono">Qty</Label>
                          <Input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => updateItemRow(index, "quantity", Number(e.target.value))}
                          />
                        </div>

                        <div className="w-32">
                          <Label className="text-xs text-muted-foreground">Rate ({storeCurrency})</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unitPrice}
                            onChange={(e) => updateItemRow(index, "unitPrice", Number(e.target.value))}
                          />
                        </div>

                        <div className="w-36 text-right">
                          <Label className="text-xs text-muted-foreground block">Line Total</Label>
                          <span className="font-mono font-medium block mt-2">
                            {formatCurrency(item.quantity * item.unitPrice)}
                          </span>
                        </div>

                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeItemRow(index)}
                          className="text-red-500 hover:text-red-700 mt-5"
                        >
                          <Trash className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}

                    <Button variant="outline" onClick={addItemRow} className="w-full gap-2">
                      <PlusCircle className="h-4 w-4" /> Add Item Line
                    </Button>
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
                      disabled={createQuoteMutation.isPending || items.length === 0}
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
                    <p className="font-bold text-gray-800">{fullQuote.customer?.name || "Walk-in Customer"}</p>
                    {fullQuote.customer?.mobileNumber && (
                      <p className="text-gray-500 text-xs">{fullQuote.customer.mobileNumber}</p>
                    )}
                  </div>
                </div>

                <table className="w-full text-left text-sm border-collapse my-6">
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
                          <p className="font-medium text-gray-800">{item.inventory.name}</p>
                          <p className="text-xs text-gray-400 font-mono">{item.inventory.id.substring(0, 8).toUpperCase()}</p>
                        </td>
                        <td className="py-3 px-3 text-right font-mono">{item.quantity}</td>
                        <td className="py-3 px-3 text-right font-mono">{formatCurrency(item.unitPrice)}</td>
                        <td className="py-3 px-3 text-right font-mono font-semibold">{formatCurrency(item.totalPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

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
    </div>
  );
}
