import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useStore } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2, ShieldAlert, Sparkles, Percent, Calendar, FileText, CheckCircle, HelpCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { formatCurrency as formatCurrencyUtil, formatCurrencyCompact } from "@/lib/currency-utils";
import { MetricGrid } from "@/components/metric-grid";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { DataTable } from "@/components/data-table";
import { BulkOperations } from "@/components/bulk-operations";
import { TAX_RATE_BULK_CONFIG } from "@/lib/bulk-entity-configs";
import { BulkSelectionActionBar } from "@/components/bulk-selection-action-bar";
import { runBulkFanOut } from "@/lib/bulk-actions";
import { ExportToolbar } from "@/components/export-toolbar";
import type { TableFilterConfig } from "@/components/oop-ui/PolymorphicTable";
import type { TaxRate } from "@shared/schema";

type Transaction = {
  id: string;
  storeId: string;
  totalPrice: number;
  totalCharged: number;
  subtotal: number;
  taxTotal: number;
  isVoided: boolean;
  createdAt: string;
};

export default function TaxesCompliancePage() {
  const { currentStore, stores } = useStore();
  const { user } = useAuth();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<(string | number)[]>([]);
  const isManagerOrOwner = user?.role === "owner" || user?.role === "manager";
  const storeCurrency = currentStore?.currency || "NGN";

  // Form State
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [selectedStoreId, setSelectedStoreId] = useState("");


  // Fetch Tax Rates
  const { data: taxRates = [], isLoading: isLoadingRates } = useQuery<TaxRate[]>({
    queryKey: ["/api/tax-rates", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/tax-rates?storeId=${currentStore?.id}`);
      return res.json();
    },
    enabled: !!currentStore?.id,
  });

  // Fetch Transactions for VAT reporting
  const { data: transactions = [], isLoading: isLoadingTransactions } = useQuery<Transaction[]>({
    queryKey: ["/api/transactions", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/transactions?storeId=${currentStore?.id}`);
      return res.json();
    },
    enabled: !!currentStore?.id,
  });

  // Create Tax Rate Mutation
  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      return apiRequest("POST", "/api/tax-rates", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tax-rates"] });
      toast({ title: "Tax Rate configured", description: "The compliance rate has been added." });
      setIsOpen(false);
      resetForm();
    },
    onError: (err: any) => {
      toast({
        title: "Configuration failed",
        description: err.message || "Could not save tax rate.",
        variant: "destructive",
      });
    },
  });

  // Set Default Mutation
  const setDefaultMutation = useMutation({
    mutationFn: async ({ id, isDefault }: { id: string; isDefault: boolean }) => {
      return apiRequest("PATCH", `/api/tax-rates/${id}`, { isDefault });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tax-rates"] });
      toast({ title: "Compliance settings updated", description: "Default tax rate adjusted." });
    },
    onError: (err: any) => {
      toast({
        title: "Compliance update failed",
        description: err.message || "Could not toggle default tax rate.",
        variant: "destructive",
      });
    },
  });

  // Delete Tax Rate Mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/tax-rates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tax-rates"] });
      toast({ title: "Tax configuration removed", description: "The tax rate has been permanently deleted." });
    },
    onError: (err: any) => {
      toast({
        title: "Deleletion failed",
        description: err.message || "Tax rate could not be removed.",
        variant: "destructive",
      });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) =>
      runBulkFanOut(ids, async (id) => {
        const res = await apiRequest("DELETE", `/api/tax-rates/${id}`);
        if (!res.ok) throw new Error("delete failed");
        return "deleted" as const;
      }),
    onSuccess: ({ counts }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tax-rates"] });
      setSelectedIds([]);
      const deleted = counts.deleted ?? 0;
      const failed = counts.failed ?? 0;
      toast(
        failed === 0
          ? { title: `${deleted} tax rate${deleted !== 1 ? "s" : ""} deleted` }
          : { title: `${deleted} deleted, ${failed} failed`, variant: "destructive" }
      );
    },
    onError: () => toast({ title: "Bulk delete failed", variant: "destructive" }),
  });

  const resetForm = () => {
    setName("");
    setRate("");
    setIsDefault(false);
    setSelectedStoreId("");
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast({ title: "Label is required", variant: "destructive" });
      return;
    }
    const rVal = parseFloat(rate);
    if (isNaN(rVal) || rVal < 0) {
      toast({ title: "Please enter a valid positive tax rate percentage", variant: "destructive" });
      return;
    }

    const storeIdToUse = currentStore?.id === "all" ? selectedStoreId : currentStore?.id;
    if (!storeIdToUse) {
      toast({ title: "Target Store Location is required", variant: "destructive" });
      return;
    }

    createMutation.mutate({
      storeId: storeIdToUse,
      name: name.trim(),
      rate: rVal,
      isDefault,
    });
  };

  const formatCurrency = (value: number) => formatCurrencyUtil(value, storeCurrency);
  const formatCompact = (value: number) => formatCurrencyCompact(value, storeCurrency);

  // Computations for Compliance Reporting
  const validCheckouts = transactions.filter(tx => !tx.isVoided);
  const totalVAT = validCheckouts.reduce((sum, tx) => sum + (tx.taxTotal || 0), 0);
  const defaultRate = taxRates.find(r => r.isDefault);
  const totalTaxableSales = validCheckouts
    .filter(tx => (tx.taxTotal || 0) > 0)
    .reduce((sum, tx) => sum + (tx.subtotal || tx.totalPrice - tx.taxTotal), 0);

  // Group VAT collected by calendar month
  const monthlyMetrics: Record<string, { month: string; taxableSales: number; vatCollected: number; count: number }> = {};
  validCheckouts.forEach(tx => {
    const d = new Date(tx.createdAt);
    if (isNaN(d.getTime())) return;
    const monthKey = d.toLocaleString("en-US", { month: "short", year: "numeric" });
    
    if (!monthlyMetrics[monthKey]) {
      monthlyMetrics[monthKey] = { month: monthKey, taxableSales: 0, vatCollected: 0, count: 0 };
    }
    
    const tax = tx.taxTotal || 0;
    const sub = tx.subtotal || tx.totalPrice - tax;
    
    monthlyMetrics[monthKey].vatCollected += tax;
    if (tax > 0) {
      monthlyMetrics[monthKey].taxableSales += sub;
    }
    monthlyMetrics[monthKey].count += 1;
  });

  const reportsList = Object.values(monthlyMetrics).sort((a, b) => {
    const dateA = new Date(a.month);
    const dateB = new Date(b.month);
    return dateB.getTime() - dateA.getTime();
  });

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Taxes & Compliance"
          description="Establish VAT, sales, and localized service tax rates to guarantee fiscal compliance."
        />
        <StoreRequiredAlert title="Store Required for Taxes & Compliance" />
      </div>
    );
  }

  const taxRatesWithStatus = taxRates.map(r => ({ ...r, statusLabel: r.isDefault ? "Default" : "Custom" }));

  const taxRateExportColumns = [
    { key: "name", header: "Label" },
    { key: "rate", header: "Rate %" },
    { key: "statusLabel", header: "Status" },
    { key: "createdAt", header: "Configured On" },
  ];

  const taxRateFilterConfigs: TableFilterConfig[] = [
    { key: "statusLabel", label: "Status", type: "select" },
  ];

  const taxRateColumns = [
    {
      key: "name",
      header: "Label",
      render: (rate: TaxRate) => (
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs shrink-0">
            {rate.rate}%
          </div>
          <div>
            <p className="font-medium text-sm flex items-center gap-2">
              {rate.name}
              {rate.isDefault && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 font-bold border border-emerald-500/20">
                  Default
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">Configured on {new Date(rate.createdAt).toLocaleDateString()}</p>
          </div>
        </div>
      ),
    },
    {
      key: "isDefault",
      header: "Default",
      render: (rate: TaxRate) => (
        <Switch
          checked={rate.isDefault}
          onCheckedChange={(checked) => setDefaultMutation.mutate({ id: rate.id, isDefault: checked })}
          disabled={setDefaultMutation.isPending}
        />
      ),
    },
    {
      key: "actions",
      header: "",
      render: (rate: TaxRate) => (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            if (confirm("Permanently delete this tax compliance rate?")) {
              deleteMutation.mutate(rate.id);
            }
          }}
          disabled={deleteMutation.isPending}
          className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  const auditExportColumns = [
    { key: "month", header: "Fiscal Period" },
    { key: "count", header: "Transactions Count" },
    { key: "taxableSales", header: "Taxable Revenue" },
    { key: "vatCollected", header: "VAT / Sales Tax" },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageHeader
        title="Taxes & Compliance"
        description="Configure VAT levels, automate checkout surcharge calculations, and audit monthly tax logs."
        actions={
          <div className="flex items-center gap-2">
            <BulkOperations
              entityConfig={TAX_RATE_BULK_CONFIG}
              data={taxRatesWithStatus as unknown as Record<string, unknown>[]}
              columns={taxRateExportColumns}
              isLoading={isLoadingRates}
              storeId={currentStore.id}
              pdfTitle="Tax Rates Report"
              showImportOption={isManagerOrOwner}
            />
            <Button onClick={() => { resetForm(); setIsOpen(true); }} className="hover-elevate shadow-md flex items-center gap-2">
              <Plus className="h-4 w-4" /> Add Custom Rate
            </Button>
          </div>
        }
      />

      <MetricGrid>
        <MetricCard
          title="VAT / Sales Tax Collected"
          value={formatCurrency(totalVAT)}
          compactValue={formatCompact(totalVAT)}
          icon={<Percent className="h-4 w-4 text-emerald-500 animate-pulse" />}
          isLoading={isLoadingTransactions}
        />
        <MetricCard
          title="Taxable Sales Volume"
          value={formatCurrency(totalTaxableSales)}
          compactValue={formatCompact(totalTaxableSales)}
          icon={<FileText className="h-4 w-4 text-blue-500" />}
          isLoading={isLoadingTransactions}
        />
        <MetricCard
          title="Store Default Rate"
          value={defaultRate ? `${defaultRate.name} (${defaultRate.rate}%)` : "No Default Set"}
          icon={<CheckCircle className="h-4 w-4 text-purple-500" />}
          isLoading={isLoadingRates}
        />
      </MetricGrid>

      <Tabs defaultValue="rates" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="rates" className="gap-2">
            <Percent className="h-4 w-4" /> Taxes Registry
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-2">
            <Calendar className="h-4 w-4" /> VAT Collected Audits
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rates" className="space-y-6">
          <Card className="border border-border/40 bg-background/50 backdrop-blur-md">
            <CardHeader>
              <CardTitle>Configured Tax Rates</CardTitle>
              <CardDescription>
                Rates flagged as "Default" are auto-appended as itemized surcharges during checkout transactions.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {isManagerOrOwner && (
                <BulkSelectionActionBar
                  count={selectedIds.length}
                  unitLabel="tax rate"
                  onClear={() => setSelectedIds([])}
                  actions={[
                    {
                      key: "delete",
                      label: "Delete Selected",
                      pendingLabel: "Deleting…",
                      icon: <Trash2 className="h-3.5 w-3.5" />,
                      tone: "destructive",
                      pending: bulkDeleteMutation.isPending,
                      onClick: () => bulkDeleteMutation.mutate(selectedIds as string[]),
                    },
                  ]}
                />
              )}
              <DataTable
                data={taxRatesWithStatus}
                columns={taxRateColumns}
                filterConfigs={taxRateFilterConfigs}
                isLoading={isLoadingRates}
                emptyTitle="No custom tax rates set"
                emptyMessage="Configure a tax rate like VAT 7.5% to automatically calculate compliance tax breakdowns on customer receipts."
                emptyIcon={<Percent className="h-6 w-6" />}
                emptyAction={<Button onClick={() => setIsOpen(true)} variant="outline" size="sm">Configure First Tax Rate</Button>}
                multiselect={isManagerOrOwner}
                selectedIds={selectedIds}
                onSelectedIdsChange={setSelectedIds}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="space-y-6">
          <Card className="border border-border/40 bg-background/50 backdrop-blur-md">
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle>Historical Compliance Audit Sheets</CardTitle>
                <CardDescription>
                  Consolidated records of sales volume and itemized compliance taxes accrued per calendar month.
                </CardDescription>
              </div>
              <ExportToolbar
                data={reportsList as unknown as Record<string, unknown>[]}
                columns={auditExportColumns}
                filename={`vat-compliance-audit_${currentStore.name}`}
                title="VAT / Sales Tax Compliance Audit"
                disabled={reportsList.length === 0}
              />
            </CardHeader>
            <CardContent>
              {isLoadingTransactions ? (
                <div className="flex justify-center items-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : reportsList.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 text-center bg-card/10 border-2 border-dashed rounded-lg">
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4 text-primary">
                    <Calendar className="h-6 w-6" />
                  </div>
                  <h4 className="text-md font-bold mb-1">No fiscal records available</h4>
                  <p className="text-sm text-muted-foreground max-w-sm">
                    Reports will compile automatically once checkout sales with configured compliance tax rates are authorized.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead>
                      <tr className="border-b bg-muted/50 font-semibold text-muted-foreground">
                        <th className="py-3 px-4">Fiscal Period</th>
                        <th className="py-3 px-4 text-right">Transactions Count</th>
                        <th className="py-3 px-4 text-right">Taxable Revenue</th>
                        <th className="py-3 px-4 text-right text-emerald-500 font-bold">VAT / Sales Tax Liability</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportsList.map((item, idx) => (
                        <tr key={idx} className="border-b hover:bg-muted/10 transition-colors">
                          <td className="py-4 px-4 font-semibold text-foreground flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-primary" /> {item.month}
                          </td>
                          <td className="py-4 px-4 text-right font-mono">{item.count} checkouts</td>
                          <td className="py-4 px-4 text-right font-mono font-medium">{formatCurrency(item.taxableSales)}</td>
                          <td className="py-4 px-4 text-right font-mono font-bold text-emerald-500">
                            {formatCurrency(item.vatCollected)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Configuration Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-md border border-border/80 bg-background/95 backdrop-blur-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-bold">
              <Sparkles className="h-5 w-5 text-primary" /> Configure Tax Rate
            </DialogTitle>
            <DialogDescription>
              Deploy a legal localized tax bracket to be applied seamlessly during client sales.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4 pt-2">
            {currentStore?.id === "all" && (
              <div className="space-y-1.5">
                <Label htmlFor="tax-store">Target Store Location</Label>
                <Select value={selectedStoreId} onValueChange={setSelectedStoreId}>
                  <SelectTrigger id="tax-store">
                    <SelectValue placeholder="Choose a store location..." />
                  </SelectTrigger>
                  <SelectContent>
                    {stores.filter(s => s.id !== "all").map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">

              <Label htmlFor="tax-name">Compliance Rate Label</Label>
              <Input
                id="tax-name"
                placeholder="e.g. VAT 7.5%, GST 5%"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tax-rate">Rate Percentage (%)</Label>
              <Input
                id="tax-rate"
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 7.50"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                required
              />
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
              <div className="space-y-0.5">
                <Label htmlFor="tax-default" className="text-sm font-semibold cursor-pointer">
                  Activate as Store Default
                </Label>
                <p className="text-xs text-muted-foreground">
                  Automatically items-aggregate this compliance surcharge on all checkout invoices.
                </p>
              </div>
              <Switch
                id="tax-default"
                checked={isDefault}
                onCheckedChange={setIsDefault}
              />
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending} className="px-6">
                {createMutation.isPending ? "Configuring..." : "Save Compliance Rate"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
