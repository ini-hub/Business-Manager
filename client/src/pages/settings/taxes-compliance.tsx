import { fetchAllPages } from "@/lib/paginated";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Trash2, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useStore } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { IconButton } from "@/components/icon-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency-utils";
import { SettingsPageHeader } from "@/components/settings-page-header";
import { useAuth } from "@/hooks/useAuth";
import { BulkOperations } from "@/components/bulk-operations";
import { TAX_RATE_BULK_CONFIG } from "@/lib/bulk-entity-configs";
import { ExportToolbar } from "@/components/export-toolbar";
import { cn } from "@/lib/utils";
import type { TaxRate } from "@shared/schema";
import { Spinner } from "@/components/ui/loader";

type Transaction = {
  id: string;
  storeId: string;
  createdAt: string;
  checkout: {
    totalPrice: number;
    totalCharged: number;
    subtotal: number;
    taxTotal: number;
    isVoided: boolean;
    taxRefunded: number;
  };
};

type TaxRateRow = TaxRate & { statusLabel: "Default" | "Custom" };

const TABS = [
  { id: "rates", label: "Tax rates" },
  { id: "collected", label: "Tax collected" },
] as const;

const when = (d: string | Date) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default function TaxesCompliancePage() {
  const { currentStore, stores } = useStore();
  const { user } = useAuth();
  const [tab, setTab] = useState<"rates" | "collected">("rates");
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [removing, setRemoving] = useState<TaxRate | null>(null);
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
    // VAT totals add up every receipt, so this reads them all (page by page).
    queryFn: () => fetchAllPages<Transaction>(`/api/transactions?storeId=${currentStore?.id}`),
    enabled: !!currentStore?.id,
  });

  // Create Tax Rate Mutation
  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      return apiRequest("POST", "/api/tax-rates", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tax-rates"] });
      toast({ title: `${name.trim()} ${rate}% added` });
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
      toast({ title: "Checkout tax updated" });
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
      toast({ title: `${removing?.name ?? "Tax rate"} removed` });
      setRemoving(null);
    },
    onError: (err: any) => {
      toast({
        title: "Could not remove tax rate",
        description: err.message || "Tax rate could not be removed.",
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setName("");
    setRate("");
    setIsDefault(false);
    setSelectedStoreId("");
  };

  const rateNum = parseFloat(rate);
  const storeIdToUse = currentStore?.id === "all" ? selectedStoreId : currentStore?.id;
  const missing: string[] = [];
  if (currentStore?.id === "all" && !selectedStoreId) missing.push("choose a store");
  if (!name.trim()) missing.push("name it");
  if (!(rateNum > 0 && rateNum < 100)) missing.push("enter a rate between 0 and 100");

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (missing.length || !storeIdToUse) return;
    createMutation.mutate({ storeId: storeIdToUse, name: name.trim(), rate: rateNum, isDefault });
  };

  const formatCurrency = (value: number) => formatCurrencyUtil(value, storeCurrency);

  // Computations for Compliance Reporting.
  // Checkout-level fields live under tx.checkout, not on tx directly — and
  // taxTotal/taxableSales must net out taxRefunded so a returned sale doesn't
  // keep counting toward VAT the store no longer actually collected.
  const validCheckouts = transactions.filter(tx => !tx.checkout?.isVoided);
  const netTax = (tx: Transaction) => Math.max(0, (tx.checkout?.taxTotal || 0) - (tx.checkout?.taxRefunded || 0));
  const defaultRate = taxRates.find(r => r.isDefault);

  // Group VAT collected by calendar month
  const monthlyMetrics: Record<string, { month: string; taxableSales: number; vatCollected: number; count: number }> = {};
  validCheckouts.forEach(tx => {
    const d = new Date(tx.createdAt);
    if (isNaN(d.getTime())) return;
    const monthKey = d.toLocaleString("en-US", { month: "short", year: "numeric" });

    if (!monthlyMetrics[monthKey]) {
      monthlyMetrics[monthKey] = { month: monthKey, taxableSales: 0, vatCollected: 0, count: 0 };
    }

    const tax = netTax(tx);
    const sub = tx.checkout?.subtotal || (tx.checkout?.totalPrice ?? 0) - tax;

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

  const taxRatesWithStatus: TaxRateRow[] = taxRates.map(r => ({ ...r, statusLabel: r.isDefault ? "Default" : "Custom" }));

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <SettingsPageHeader title="Tax rates" description="Tax added to sales at checkout." scope="store" />
        <StoreRequiredAlert title="Store Required for Taxes & Compliance" />
      </div>
    );
  }

  const taxRateExportColumns = [
    { key: "name", header: "Label" },
    { key: "rate", header: "Rate %" },
    { key: "statusLabel", header: "Status" },
    { key: "createdAt", header: "Configured On" },
  ];
  const auditExportColumns = [
    { key: "month", header: "Fiscal Period" },
    { key: "count", header: "Transactions Count" },
    { key: "taxableSales", header: "Taxable Revenue" },
    { key: "vatCollected", header: "VAT / Sales Tax" },
  ];

  const sample = rateNum > 0 ? 10000 * (1 + rateNum / 100) : 0;
  const money2 = (n: number) => formatCurrencyUtil(n, storeCurrency);

  return (
    <div className="space-y-4">
      <SettingsPageHeader
        title="Tax rates"
        description={`Tax added to ${currentStore.name} sales at checkout.`}
        scope="store"
      />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
        <p className="font-semibold" data-testid="text-tax-status">
          {defaultRate ? `${defaultRate.name} ${defaultRate.rate}% is added to every sale at checkout.` : "No tax is added at checkout right now."}
        </p>
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
          {isManagerOrOwner && !isOpen && (
            <Button onClick={() => { resetForm(); setIsDefault(taxRates.length === 0); setTab("rates"); setIsOpen(true); }} data-testid="button-new-tax-rate">
              Add rate
            </Button>
          )}
        </div>
      </div>

      <div role="tablist" className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "rates" && (
        <>
          {isOpen && (
            <form onSubmit={handleCreate} className="space-y-4 rounded-xl border-2 border-primary bg-card p-4 sm:p-5" aria-label="New tax rate">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">New tax rate</h2>
                <IconButton type="button" variant="ghost" label="Close" onClick={() => setIsOpen(false)}><X className="h-4 w-4" /></IconButton>
              </div>
              {currentStore.id === "all" && (
                <div className="space-y-2">
                  <Label htmlFor="tax-store">Store</Label>
                  <select id="tax-store" value={selectedStoreId} onChange={(e) => setSelectedStoreId(e.target.value)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                    <option value="">Choose a store</option>
                    {stores.filter((s) => s.id !== "all").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
                <div className="space-y-2">
                  <Label htmlFor="tax-name">Name</Label>
                  <Input id="tax-name" placeholder="VAT" value={name} onChange={(e) => setName(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Shown on receipts.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tax-rate">Rate</Label>
                  <div className="flex">
                    <Input id="tax-rate" inputMode="decimal" className="rounded-r-none" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ""))} />
                    <span className="flex items-center rounded-r-md border border-l-0 bg-muted px-3 text-sm text-muted-foreground">%</span>
                  </div>
                </div>
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor="tax-default">Add to every sale at checkout</Label>
                  <p className="text-sm text-muted-foreground">Shown as its own line on the receipt. Only one rate can be added automatically.</p>
                </div>
                <Switch id="tax-default" checked={isDefault} onCheckedChange={setIsDefault} />
              </div>
              <p className={cn("rounded-lg bg-muted/60 p-3 text-sm", sample ? "font-medium" : "text-muted-foreground")}>
                {sample
                  ? `On a ${money2(10000)} sale, the customer pays ${money2(sample)}, of which ${money2(100 * rateNum)} is ${name.trim() || "tax"}.`
                  : "Enter a rate to see what customers pay."}
              </p>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className={cn("text-sm", missing.length ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground")}>
                  {missing.length ? `To add it, ${missing.join(" and ")}.` : isDefault ? "It starts on the next sale." : "Saved but not added to sales until you turn it on."}
                </p>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={missing.length > 0 || createMutation.isPending}>
                    {createMutation.isPending && <Spinner className="mr-2 h-5 w-5 animate-spin" />}
                    Add rate
                  </Button>
                </div>
              </div>
            </form>
          )}

          {isLoadingRates ? (
            <div className="flex h-32 items-center justify-center"><Spinner className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : taxRates.length === 0 ? (
            <div className="rounded-xl border bg-card p-4">
              <div className="rounded-lg bg-muted/60 px-4 py-8 text-center">
                <p className="font-semibold">No tax rates yet</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  Customers pay the item price only. If you charge VAT, add it here and it's worked out on every sale.
                </p>
              </div>
            </div>
          ) : (
            <ul className="divide-y rounded-xl border bg-card">
              {taxRates.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 p-4" data-testid={`tax-rate-${r.id}`}>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{r.name} <span className="font-normal text-muted-foreground">{r.rate}%</span></p>
                    <p className="text-sm text-muted-foreground">Added {when(r.createdAt)}</p>
                  </div>
                  {r.isDefault ? (
                    <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-500/20 dark:text-green-300">Added to every sale</span>
                  ) : (
                    isManagerOrOwner && (
                      <Button size="sm" variant="outline" disabled={setDefaultMutation.isPending}
                        onClick={() => setDefaultMutation.mutate({ id: r.id, isDefault: true })} aria-label={`Add ${r.name} to every sale`}>
                        Add to every sale
                      </Button>
                    )
                  )}
                  {r.isDefault && isManagerOrOwner && (
                    <Button size="sm" variant="ghost" disabled={setDefaultMutation.isPending}
                      onClick={() => setDefaultMutation.mutate({ id: r.id, isDefault: false })}>
                      Stop adding
                    </Button>
                  )}
                  {isManagerOrOwner && (
                    <IconButton variant="ghost" label={`Remove ${r.name}`} className="text-muted-foreground hover:text-destructive" onClick={() => setRemoving(r)}>
                      <Trash2 className="h-4 w-4" />
                    </IconButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {tab === "collected" && (
        <section className="space-y-3 rounded-xl border bg-card p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">Tax collected</h2>
              <p className="text-sm text-muted-foreground">Sales and the tax added to them, month by month.</p>
            </div>
            <ExportToolbar
              data={reportsList as unknown as Record<string, unknown>[]}
              columns={auditExportColumns}
              filename={`tax-collected_${currentStore.name}`}
              title="Tax collected"
              disabled={reportsList.length === 0}
            />
          </div>
          {isLoadingTransactions ? (
            <div className="flex justify-center py-10"><Spinner className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : reportsList.length === 0 ? (
            <div className="rounded-lg bg-muted/60 px-4 py-8 text-center">
              <p className="font-semibold">Nothing collected yet</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Months appear here once a sale has tax added to it.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-4 font-semibold">Month</th>
                    <th className="py-2 pr-4 text-right font-semibold">Sales</th>
                    <th className="py-2 pr-4 text-right font-semibold">Taxable sales</th>
                    <th className="py-2 text-right font-semibold">Tax collected</th>
                  </tr>
                </thead>
                <tbody>
                  {reportsList.map((m) => (
                    <tr key={m.month} className="border-b last:border-0">
                      <td className="py-3 pr-4 font-medium">{m.month}</td>
                      <td className="py-3 pr-4 text-right">{m.count}</td>
                      <td className="py-3 pr-4 text-right">{formatCurrency(m.taxableSales)}</td>
                      <td className="py-3 text-right font-semibold">{formatCurrency(m.vatCollected)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.name ?? "tax rate"}?`}
        description="It stops being added to sales straight away. Past receipts keep what they were charged."
        confirmText="Remove"
        isDestructive
        isLoading={deleteMutation.isPending}
        onConfirm={() => { if (removing) deleteMutation.mutate(removing.id); }}
      />
    </div>
  );
}
