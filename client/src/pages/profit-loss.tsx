import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Coins, Package, Wrench, ShoppingBag, BarChart3, AlertCircle, Wallet, ChevronDown, Building2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { ExportToolbar } from "@/components/export-toolbar";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency-utils";
import { Link } from "wouter";
import { DateRangeFilter } from "@/components/date-range-filter";
import { Separator } from "@/components/ui/separator";
import type { ProfitLossWithInventory } from "@shared/schema";
import { PageContainer } from "@/components/oop-ui/PageContainer";
import { PolymorphicMetricCard } from "@/components/oop-ui/PolymorphicMetricCard";
import { useAuth } from "@/hooks/useAuth";
import { analyticsApi } from "@/services/AnalyticsApiService";
import { endOfDay, startOfDay, startOfMonth, subMonths, format } from "date-fns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PolymorphicTabsList, TabItem } from "@/components/oop-ui/PolymorphicTabsList";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function ProfitLossPage() {
  const { currentStore, business, stores } = useStore();
  const { user } = useAuth();
  const storeCurrency = currentStore?.currency || "NGN";
  const [discountsCollapsed, setDiscountsCollapsed] = useState(true);
  const [activeTab, setActiveTab] = useState("income");
  const isOwner = user?.role === "owner";

  const [dateRange, setDateRange] = useState<{ from: Date; to: Date } | undefined>(() => {
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
      to: endOfDay(new Date())
    };
  });

  const { data: profitLossData = [], isLoading: isLoadingPL } = useQuery<ProfitLossWithInventory[]>({
    queryKey: ["/api/profit-loss", currentStore?.id, business?.id],
    queryFn: async () => {
      if (currentStore?.id === "all" && business?.id && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const res = await fetch(`/api/profit-loss?storeId=${s.id}`);
              if (!res.ok) return [];
              return await res.json() as ProfitLossWithInventory[];
            } catch {
              return [];
            }
          })
        );
        const mergedMap = new Map<string, ProfitLossWithInventory>();
        for (const list of responses) {
          for (const item of list) {
            const id = item.inventoryId;
            const existing = mergedMap.get(id);
            if (existing) {
              existing.totalQuantitySold += item.totalQuantitySold;
              existing.totalRevenue += item.totalRevenue;
              existing.totalGrossProfit += item.totalGrossProfit;
            } else {
              mergedMap.set(id, { ...item });
            }
          }
        }
        return Array.from(mergedMap.values());
      }
      const res = await fetch(`/api/profit-loss?storeId=${currentStore?.id}`);
      if (!res.ok) throw new Error("Failed to load profit/loss details");
      return res.json();
    },
    enabled: currentStore?.id === "all" ? !!business?.id : !!currentStore?.id,
  });

  const { data: summary, isLoading: isLoadingSummary } = useQuery<any>({
    queryKey: [
      "/api/profit-loss/summary",
      currentStore?.id,
      business?.id,
      dateRange?.from?.toISOString(),
      dateRange?.to?.toISOString()
    ],
    queryFn: async () => {
      const fromParam = dateRange?.from ? dateRange.from.toISOString().split('T')[0] : undefined;
      const toParam = dateRange?.to ? dateRange.to.toISOString().split('T')[0] : undefined;
      
      if (currentStore?.id === "all") {
        const params = new URLSearchParams();
        if (business?.id) params.append("businessId", business.id);
        if (fromParam) params.append("startDate", fromParam);
        if (toParam) params.append("endDate", toParam);
        const res = await fetch(`/api/profit-loss/summary?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to load consolidated profit/loss summary");
        return res.json();
      }
      
      return analyticsApi.getProfitLossSummary(
        currentStore!.id,
        fromParam,
        toParam
      );
    },
    enabled: currentStore?.id === "all" ? !!business?.id : !!currentStore?.id,
  });

  const { data: cashFlowData, isLoading: isLoadingCashFlow } = useQuery<any>({
    queryKey: [
      "/api/reports/cash-flow",
      currentStore?.id,
      business?.id,
      dateRange?.from?.toISOString(),
      dateRange?.to?.toISOString()
    ],
    queryFn: async () => {
      const fromParam = dateRange?.from ? dateRange.from.toISOString().split('T')[0] : "";
      const toParam = dateRange?.to ? dateRange.to.toISOString().split('T')[0] : "";
      
      if (currentStore?.id === "all" && business?.id && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const res = await fetch(`/api/reports/cash-flow?storeId=${s.id}&startDate=${fromParam}&endDate=${toParam}`);
              if (!res.ok) return null;
              return await res.json();
            } catch {
              return null;
            }
          })
        );
        const validRes = responses.filter(r => r !== null);
        const consolidated = {
          operatingActivities: {
            cashReceiptsFromCustomers: 0,
            cashPaidForOperatingExpenses: 0,
            cashDropsFromDrawer: 0,
            netCashFromOperatingActivities: 0
          },
          netCashIncrease: 0,
          cashSummary: {
            cashSales: 0,
            nonCashSales: 0,
            cashRepayments: 0,
            operatingExpensesNonCashOut: 0
          }
        };
        for (const r of validRes) {
          consolidated.operatingActivities.cashReceiptsFromCustomers += r.operatingActivities.cashReceiptsFromCustomers || 0;
          consolidated.operatingActivities.cashPaidForOperatingExpenses += r.operatingActivities.cashPaidForOperatingExpenses || 0;
          consolidated.operatingActivities.cashDropsFromDrawer += r.operatingActivities.cashDropsFromDrawer || 0;
          consolidated.operatingActivities.netCashFromOperatingActivities += r.operatingActivities.netCashFromOperatingActivities || 0;
          consolidated.netCashIncrease += r.netCashIncrease || 0;
          consolidated.cashSummary.cashSales += r.cashSummary.cashSales || 0;
          consolidated.cashSummary.nonCashSales += r.cashSummary.nonCashSales || 0;
          consolidated.cashSummary.cashRepayments += r.cashSummary.cashRepayments || 0;
          consolidated.cashSummary.operatingExpensesNonCashOut += r.cashSummary.operatingExpensesNonCashOut || 0;
        }
        return consolidated;
      }
      
      const res = await fetch(`/api/reports/cash-flow?storeId=${currentStore?.id}&startDate=${fromParam}&endDate=${toParam}`);
      if (!res.ok) throw new Error("Failed to load cash flow details");
      return res.json();
    },
    enabled: currentStore?.id === "all" ? !!business?.id : !!currentStore?.id,
  });

  const formatCurrency = (value: number) => {
    return formatCurrencyUtil(value, storeCurrency);
  };

  const isLoading = isLoadingPL || isLoadingSummary || isLoadingCashFlow;



  const columns = [
    {
      key: "inventory",
      header: "Item",
      render: (pl: ProfitLossWithInventory) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
            {pl.inventory?.type === "product" ? (
              <Package className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Wrench className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <div>
            <p className="font-medium">
              {pl.inventory?.name ?? "Unknown"}
            </p>
            <Badge variant="outline" className={`text-xs capitalize mt-1 ${
              pl.inventory?.type === "service" ? "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-400 dark:border-violet-900/30"
              : pl.inventory?.type === "product" ? "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-400 dark:border-sky-900/30"
              : ""}`}>
              {pl.inventory?.type ?? "unknown"}
            </Badge>
          </div>
        </div>
      ),
    },
    {
      key: "totalQuantitySold",
      header: "Qty Sold",
      render: (pl: ProfitLossWithInventory) => {
        const unit = pl.inventory?.unit;
        const qty = parseFloat(Number(pl.totalQuantitySold).toFixed(2));
        return (
          <div className="flex items-center gap-1.5">
            <ShoppingBag className="h-3 w-3 text-muted-foreground" />
            <span className="font-mono">{qty}{unit ? ` ${unit}` : ""}</span>
          </div>
        );
      },
    },
    {
      key: "quantityRemaining",
      header: "Remaining",
      render: (pl: ProfitLossWithInventory) => {
        if (pl.inventory?.type === "service") return <span className="font-mono text-muted-foreground">N/A</span>;
        const unit = pl.inventory?.unit;
        const qty = parseFloat(Number(pl.quantityRemaining).toFixed(2));
        return <span className="font-mono">{qty}{unit ? ` ${unit}` : ""}</span>;
      },
    },
    {
      key: "totalRevenue",
      header: "Revenue",
      render: (pl: ProfitLossWithInventory) => (
        <span className="font-mono font-medium">{formatCurrency(pl.totalRevenue)}</span>
      ),
    },
    {
      key: "totalGrossProfit",
      header: "Gross Profit",
      render: (pl: ProfitLossWithInventory) => (
        <div className="flex items-center gap-2">
          {pl.totalGrossProfit >= 0 ? (
            <TrendingUp className="h-3 w-3 text-green-600 dark:text-green-400" />
          ) : (
            <TrendingDown className="h-3 w-3 text-red-600 dark:text-red-400" />
          )}
          <span
            className={`font-mono font-medium ${
              pl.totalGrossProfit >= 0
                ? "text-green-600 dark:text-green-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {formatCurrency(pl.totalGrossProfit)}
          </span>
        </div>
      ),
    },
    {
      key: "margin",
      header: "Margin",
      render: (pl: ProfitLossWithInventory) => {
        const margin = pl.totalRevenue > 0
          ? (pl.totalGrossProfit / pl.totalRevenue) * 100
          : 0;
        return (
          <Badge
            variant={margin >= 20 ? "default" : margin >= 0 ? "secondary" : "destructive"}
          >
            {margin.toFixed(1)}%
          </Badge>
        );
      },
    },
  ];

  const exportColumns = [
    { key: "inventory.name", header: "Item Name" },
    { key: "inventory.type", header: "Type" },
    { key: "totalQuantitySold", header: "Quantity Sold" },
    { key: "quantityRemaining", header: "Quantity Remaining" },
    { key: "inventory.costPrice", header: "Unit Cost" },
    { key: "inventory.sellingPrice", header: "Selling Price" },
    { key: "totalRevenue", header: "Total Revenue" },
    { key: "totalGrossProfit", header: "Gross Profit" },
    { key: "margin", header: "Profit Margin %" },
  ];

  const exportData = profitLossData.map((pl) => ({
    inventory: pl.inventory,
    totalQuantitySold: pl.totalQuantitySold,
    quantityRemaining: pl.inventory?.type === "service" ? "N/A" : pl.quantityRemaining,
    totalRevenue: pl.totalRevenue,
    totalGrossProfit: pl.totalGrossProfit,
    margin: pl.totalRevenue > 0 ? ((pl.totalGrossProfit / pl.totalRevenue) * 100).toFixed(1) : "0.0",
  }));

  const opProfit = summary?.operatingProfit ?? 0;

  const plTabItems: TabItem[] = [
    { value: "income", label: "Income Statement" },
    { value: "cashflow", label: "Cash Flow Statement", visible: isOwner || user?.role === "manager" },
    { value: "expenses", label: "Expense Details", visible: isOwner },
    { value: "discounts", label: "Discounts Report", visible: isOwner },
    { value: "breakdown", label: "Item-by-Item Breakdown (All Time)" },
  ];

  return (
    <PageContainer
      title="Profit & Loss Statement"
      description={currentStore?.id === "all" ? `Consolidated financial performance analysis for all ${stores.length} branches` : `Financial performance analysis for ${currentStore?.name}`}
      storeRequired={currentStore?.id !== "all"}
      currentStore={currentStore}
      requiredRole="manager"
      currentUserRole={user?.role}
      actions={
        <div className="flex flex-col sm:flex-row gap-2 items-center">
          <DateRangeFilter
            dateRange={dateRange ?? { from: undefined, to: undefined }}
            onDateRangeChange={(r) => setDateRange(
              r.from && r.to ? { from: r.from, to: r.to } : undefined
            )}
          />
          <ExportToolbar
            data={exportData as unknown as Record<string, unknown>[]}
            columns={exportColumns}
            filename={`profit-loss-${format(new Date(), "yyyy-MM-dd")}`}
            title="Profit & Loss Detail"
            disabled={isLoading}
          />
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {activeTab === "cashflow" ? (
          <>
            <PolymorphicMetricCard
              title="Customer Cash Inflows"
              value={formatCurrency(cashFlowData?.operatingActivities?.cashReceiptsFromCustomers ?? 0)}
              icon={<Coins className="h-5 w-5 text-emerald-600" />}
              isLoading={isLoadingCashFlow}
            />
            <PolymorphicMetricCard
              title="Cash Paid for Expenses"
              value={formatCurrency(cashFlowData?.operatingActivities?.cashPaidForOperatingExpenses ?? 0)}
              icon={<Wallet className="h-5 w-5 text-red-600" />}
              isLoading={isLoadingCashFlow}
            />
            <PolymorphicMetricCard
              title="Drawer Cash Drops"
              value={formatCurrency(cashFlowData?.operatingActivities?.cashDropsFromDrawer ?? 0)}
              icon={<TrendingDown className="h-5 w-5 text-amber-600" />}
              isLoading={isLoadingCashFlow}
            />
            <PolymorphicMetricCard
              title="Net Cash Flow"
              value={formatCurrency(cashFlowData?.netCashIncrease ?? 0)}
              trend={(cashFlowData?.netCashIncrease ?? 0) >= 0 ? "up" : "down"}
              trendValue="Net Cash Increase"
              icon={<TrendingUp className="h-5 w-5 text-blue-600" />}
              isLoading={isLoadingCashFlow}
            />
          </>
        ) : (
          <>
            <PolymorphicMetricCard
              title="Actual Revenue (Net)"
              value={formatCurrency(summary?.totalRevenue ?? 0)}
              description={summary?.returnedRevenue > 0 ? `Gross: ${formatCurrency(summary.grossRevenue)} (Refunded: ${formatCurrency(summary.returnedRevenue)})` : "Net revenue after returns"}
              icon={<Coins className="h-5 w-5 text-emerald-600" />}
              isLoading={isLoading}
            />
            <PolymorphicMetricCard
              title="Gross Profit"
              value={formatCurrency(summary?.grossProfit ?? 0)}
              trend={(summary?.grossProfit ?? 0) >= 0 ? "up" : "down"}
              trendValue="Gross margin"
              icon={(summary?.grossProfit ?? 0) >= 0 ? <TrendingUp className="h-5 w-5 text-blue-600" /> : <TrendingDown className="h-5 w-5 text-red-600" />}
              isLoading={isLoading}
            />
            {isOwner && (
              <PolymorphicMetricCard
                title="Total Expenses"
                value={formatCurrency(summary?.totalExpenses ?? 0)}
                icon={<Wallet className="h-5 w-5 text-amber-600" />}
                description="Operational + Payroll"
                isLoading={isLoading}
              />
            )}
            {isOwner && (
              <PolymorphicMetricCard
                title="Operating Profit"
                value={formatCurrency(opProfit)}
                trend={opProfit >= 0 ? "up" : "down"}
                trendValue="Operating margin"
                icon={opProfit >= 0 ? <TrendingUp className="h-5 w-5 text-green-600" /> : <TrendingDown className="h-5 w-5 text-red-600" />}
                isLoading={isLoading}
              />
            )}
          </>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <PolymorphicTabsList tabs={plTabItems} variant="default" className="mb-6" />

        <TabsContent value="income" className="space-y-6 mt-0 border-none p-0">
          <Card className="border-primary/20 shadow-sm max-w-3xl mx-auto">
            <CardHeader className="bg-muted/30 pb-4">
              <CardTitle>Income Statement</CardTitle>
              <CardDescription>
                {dateRange?.from && dateRange?.to ? (
                  `Period: ${format(dateRange.from, 'MMM d, yyyy')} to ${format(dateRange.to, 'MMM d, yyyy')}`
                ) : "All time"}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Service Revenue (Net)</span>
                <span className="font-mono">{formatCurrency(summary?.serviceRevenue ?? 0)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Product Sales (Net)</span>
                <span className="font-mono">{formatCurrency(summary?.productRevenue ?? 0)}</span>
              </div>
              <div className="flex justify-between items-center font-semibold pt-2 border-t text-base">
                <span>Actual Revenue (Net)</span>
                <span className="font-mono text-emerald-600">{formatCurrency(summary?.totalRevenue ?? 0)}</span>
              </div>
              
              <div className="border border-dashed border-muted/80 rounded-lg p-3 bg-muted/5 space-y-2 mt-2">
                <div className="flex justify-between items-center text-xs text-muted-foreground">
                  <span>Gross Revenue (Before Returns)</span>
                  <span className="font-mono">{formatCurrency(summary?.grossRevenue ?? 0)}</span>
                </div>
                <div className="flex justify-between items-center text-xs text-muted-foreground">
                  <span>Total Returns & Refunds Deducted</span>
                  <span className={`font-mono ${(summary?.returnedRevenue ?? 0) > 0 ? "text-red-500 font-medium" : ""}`}>
                    − {formatCurrency(summary?.returnedRevenue ?? 0)}
                  </span>
                </div>
              </div>
              
              <div className="flex justify-between items-center text-sm pt-4">
                <span className="text-muted-foreground">Cost of Goods/Services Sold</span>
                <span className="font-mono text-amber-600">− {formatCurrency(summary?.costOfGoodsSold ?? 0)}</span>
              </div>
              
              <div className="flex justify-between items-center font-bold text-lg pt-2 border-t">
                <span>GROSS PROFIT</span>
                <span className="font-mono text-blue-600">{formatCurrency(summary?.grossProfit ?? 0)}</span>
              </div>

              {isOwner && (
                <>
                  <Separator className="my-4" />

                  {/* Collapsible Discounts Given Row */}
                  <div className="border border-muted rounded-lg overflow-hidden bg-muted/10 my-3">
                    <button
                      onClick={() => setDiscountsCollapsed(!discountsCollapsed)}
                      className="w-full flex justify-between items-center text-sm p-3 hover:bg-muted/20 transition-colors font-medium"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Discounts Given</span>
                        <Badge variant="outline" className="text-xs bg-red-500/10 text-red-500 border-red-500/20 font-normal font-mono">
                          {summary?.discountsList?.length || 0} tx
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 font-mono text-red-500">
                        <span>− {formatCurrency(summary?.discountsGiven ?? 0)}</span>
                        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${!discountsCollapsed ? "rotate-180" : ""}`} />
                      </div>
                    </button>
                    {!discountsCollapsed && (
                      <div className="border-t border-muted bg-muted/5 divide-y divide-muted/50 max-h-60 overflow-y-auto">
                        {summary?.discountsList?.length > 0 ? (
                          summary.discountsList.map((d: any, idx: number) => (
                            <div key={idx} className="p-3 text-xs flex flex-col gap-1.5">
                              <div className="flex justify-between items-center">
                                <span className="font-mono font-medium text-foreground">{d.receiptNumber}</span>
                                <span className="font-mono text-red-500 font-semibold">
                                  − {formatCurrency(d.discountAmount)} ({d.discountPercent.toFixed(0)}%)
                                </span>
                              </div>
                              <div className="flex justify-between items-center text-muted-foreground">
                                <span>Approved by: <span className="text-foreground font-medium">{d.discountApprovedBy || "N/A"}</span></span>
                                <span>{d.createdAt ? format(new Date(d.createdAt), "MMM d, h:mm a") : ""}</span>
                              </div>
                              {d.discountReason && (
                                <div className="text-[11px] text-muted-foreground bg-muted/20 p-1.5 rounded italic mt-0.5">
                                  "{d.discountReason}"
                                </div>
                              )}
                            </div>
                          ))
                        ) : (
                          <div className="p-4 text-center text-muted-foreground text-xs">
                            No discounts recorded in this period.
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Operational Expenses</span>
                    <span className="font-mono">− {formatCurrency(summary?.totalOperationalExpenses ?? 0)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Payroll Expenses</span>
                    <span className="font-mono">− {formatCurrency(summary?.totalPayrollExpenses ?? 0)}</span>
                  </div>
                  <div className="flex justify-between items-center font-medium pt-2 border-t">
                    <span>Total Expenses</span>
                    <span className="font-mono text-red-600">− {formatCurrency(summary?.totalExpenses ?? 0)}</span>
                  </div>

                  <div className="flex justify-between items-center font-bold text-xl pt-4 border-t mt-4 mb-4">
                    <span>OPERATING PROFIT</span>
                    <span className={`font-mono ${opProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatCurrency(opProfit)}
                    </span>
                  </div>

                  <Separator className="my-4" />
                  <div className="flex gap-2 items-center p-3 rounded-lg border border-blue-100 bg-blue-50/50 text-blue-800 dark:border-blue-900/30 dark:bg-blue-900/10 dark:text-blue-200 shadow-sm">
                    <AlertCircle className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                    <div className="flex-1 text-xs md:text-sm flex flex-col md:flex-row md:items-center justify-between gap-2">
                      <span>ⓘ Service & Product sustaining costs are completely excluded from this statement.</span>
                      <Link href="/inventory">
                        <Button size="sm" variant="ghost" className="text-blue-700 dark:text-blue-400 p-0 h-auto font-semibold flex items-center gap-1">
                          View per-item breakdown in Inventory &rarr;
                        </Button>
                      </Link>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cashflow" className="space-y-6 mt-0 border-none p-0">
          <Card className="border-primary/20 shadow-sm max-w-3xl mx-auto">
            <CardHeader className="bg-muted/30 pb-4">
              <CardTitle>Cash Flow Statement</CardTitle>
              <CardDescription>
                {dateRange?.from && dateRange?.to ? (
                  `Period: ${format(dateRange.from, 'MMM d, yyyy')} to ${format(dateRange.to, 'MMM d, yyyy')}`
                ) : "All time"}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
              <div>
                <h3 className="font-bold text-sm text-foreground uppercase tracking-wider mb-2">1. Operating Activities</h3>
                <div className="space-y-2 pl-3 border-l border-muted">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Cash Sales (Customer Receipts)</span>
                    <span className="font-mono">{formatCurrency(cashFlowData?.cashSummary?.cashSales ?? 0)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Customer Repayments (Cash portion)</span>
                    <span className="font-mono">{formatCurrency(cashFlowData?.cashSummary?.cashRepayments ?? 0)}</span>
                  </div>
                  <div className="flex justify-between items-center font-medium text-sm pt-1 border-t border-muted/50">
                    <span>Total Cash Inflow from Operations</span>
                    <span className="font-mono text-emerald-600">{formatCurrency(cashFlowData?.operatingActivities?.cashReceiptsFromCustomers ?? 0)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm pt-2">
                    <span className="text-muted-foreground">Cash Paid for Operating Expenses</span>
                    <span className="font-mono text-red-500">− {formatCurrency(cashFlowData?.operatingActivities?.cashPaidForOperatingExpenses ?? 0)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Register Cash Drops to Safe</span>
                    <span className="font-mono text-amber-500">− {formatCurrency(cashFlowData?.operatingActivities?.cashDropsFromDrawer ?? 0)}</span>
                  </div>
                  <div className="flex justify-between items-center font-bold text-base pt-2 border-t mt-2">
                    <span>Net Cash from Operating Activities</span>
                    <span className={`font-mono ${(cashFlowData?.operatingActivities?.netCashFromOperatingActivities ?? 0) >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                      {formatCurrency(cashFlowData?.operatingActivities?.netCashFromOperatingActivities ?? 0)}
                    </span>
                  </div>
                </div>
              </div>

              <Separator />

              <div>
                <h3 className="font-bold text-sm text-foreground uppercase tracking-wider mb-2">2. Investing Activities</h3>
                <div className="space-y-2 pl-3 border-l border-muted">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Capital Expenditure</span>
                    <span className="font-mono">{formatCurrency(cashFlowData?.investingActivities?.capitalExpenditure ?? 0)}</span>
                  </div>
                  <div className="flex justify-between items-center font-medium text-sm pt-1 border-t border-muted/50">
                    <span>Net Cash from Investing Activities</span>
                    <span className="font-mono">{formatCurrency(0)}</span>
                  </div>
                </div>
              </div>

              <Separator />

              <div>
                <h3 className="font-bold text-sm text-foreground uppercase tracking-wider mb-2">3. Financing Activities</h3>
                <div className="space-y-2 pl-3 border-l border-muted">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Loans Received</span>
                    <span className="font-mono">{formatCurrency(cashFlowData?.financingActivities?.loansReceived ?? 0)}</span>
                  </div>
                  <div className="flex justify-between items-center font-medium text-sm pt-1 border-t border-muted/50">
                    <span>Net Cash from Financing Activities</span>
                    <span className="font-mono">{formatCurrency(0)}</span>
                  </div>
                </div>
              </div>

              <Separator className="my-4" />

              <div className="flex justify-between items-center font-extrabold text-xl pt-2 border-t mt-2">
                <span>NET INCREASE IN CASH</span>
                <span className={`font-mono ${(cashFlowData?.netCashIncrease ?? 0) >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  {formatCurrency(cashFlowData?.netCashIncrease ?? 0)}
                </span>
              </div>

              <div className="bg-slate-800/20 border border-slate-700/30 rounded-lg p-4 mt-6">
                <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">Operating Receipts Breakdown</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-slate-900/40 p-3 rounded border border-slate-800/80">
                    <p className="text-[11px] text-muted-foreground font-semibold uppercase">Cash vs Non-Cash Sales</p>
                    <div className="flex justify-between items-center mt-1.5 text-sm font-mono">
                      <span className="text-emerald-500">Cash: {formatCurrency(cashFlowData?.cashSummary?.cashSales ?? 0)}</span>
                      <span className="text-blue-400">Non-Cash: {formatCurrency(cashFlowData?.cashSummary?.nonCashSales ?? 0)}</span>
                    </div>
                  </div>
                  <div className="bg-slate-900/40 p-3 rounded border border-slate-800/80">
                    <p className="text-[11px] text-muted-foreground font-semibold uppercase">Non-Cash Expenses Paid</p>
                    <div className="flex justify-between items-center mt-1.5 text-sm font-mono">
                      <span className="text-muted-foreground">Card/Transfer:</span>
                      <span>{formatCurrency(cashFlowData?.cashSummary?.operatingExpensesNonCashOut ?? 0)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {isOwner && (
          <TabsContent value="expenses" className="space-y-6 mt-0 border-none p-0">
            <Card className="max-w-3xl mx-auto">
              <CardHeader>
                <CardTitle>Expense Detail</CardTitle>
                <CardDescription>Breakdown of costs for the selected period</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h4 className="text-sm font-medium mb-3 text-muted-foreground uppercase tracking-wider">Operational Expenses</h4>
                  <div className="space-y-2">
                    {summary?.expensesGrouped?.length > 0 ? (
                      summary.expensesGrouped.map((eg: any, idx: number) => (
                        <div key={idx} className="flex justify-between items-center text-sm">
                          <span>{eg.category}</span>
                          <span className="font-mono">{formatCurrency(eg.amount)}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground italic">No operational expenses found.</p>
                    )}
                  </div>
                </div>

                <Separator />

                <div>
                  <h4 className="text-sm font-medium mb-3 text-muted-foreground uppercase tracking-wider">Payroll Expenses</h4>
                  <div className="space-y-2">
                    {summary?.payrollDetails?.length > 0 ? (
                      summary.payrollDetails.map((pd: any, idx: number) => (
                        <div key={idx} className="flex justify-between items-center text-sm">
                          <span>{pd.label}</span>
                          <span className="font-mono">{formatCurrency(pd.amount)}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground italic">No paid payroll periods found.</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {isOwner && (
          <TabsContent value="discounts" className="space-y-6 mt-0 border-none p-0">
            <Card className="max-w-4xl mx-auto border-primary/20 shadow-sm">
              <CardHeader className="bg-muted/30">
                <CardTitle>Discounts Given Report</CardTitle>
                <CardDescription>Comprehensive audit log of all transaction-level basket discounts in the period</CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="rounded-md border overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm text-left min-w-[800px]">
                    <thead className="bg-muted/50 text-muted-foreground uppercase text-xs tracking-wider border-b">
                      <tr>
                        <th className="p-3">Date</th>
                        <th className="p-3">Receipt No</th>
                        <th className="p-3 text-right">Subtotal</th>
                        <th className="p-3 text-right">Discount</th>
                        <th className="p-3 text-right">Charged</th>
                        <th className="p-3">Approved By</th>
                        <th className="p-3">Reason</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {summary?.discountsList?.length > 0 ? (
                        summary.discountsList.map((d: any, idx: number) => (
                          <tr key={idx} className="hover:bg-muted/10 transition-colors">
                            <td className="p-3 font-mono text-xs">
                              {d.createdAt ? format(new Date(d.createdAt), "yyyy-MM-dd HH:mm") : "N/A"}
                            </td>
                            <td className="p-3 font-medium font-mono text-xs">{d.receiptNumber}</td>
                            <td className="p-3 text-right font-mono text-xs">{formatCurrency(d.subtotal || 0)}</td>
                            <td className="p-3 text-right font-mono text-xs text-red-500 font-medium">
                              − {formatCurrency(d.discountAmount)} ({d.discountPercent.toFixed(0)}%)
                            </td>
                            <td className="p-3 text-right font-mono text-xs text-emerald-600 font-semibold">
                              {formatCurrency((d.subtotal || 0) - d.discountAmount)}
                            </td>
                            <td className="p-3">
                              <Badge variant="outline" className="text-xs uppercase bg-muted font-normal">
                                {d.discountApprovedBy || "N/A"}
                              </Badge>
                            </td>
                            <td className="p-3 max-w-[200px] truncate text-xs text-muted-foreground italic" title={d.discountReason}>
                              {d.discountReason || "No reason given"}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={7} className="p-8 text-center text-muted-foreground text-sm">
                            No discounts recorded in the selected period.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="breakdown" className="space-y-6 mt-0 border-none p-0">
          <Card>
            <CardHeader>
              <CardTitle>Item-by-Item Breakdown (All Time)</CardTitle>
              <CardDescription>Historical gross profit per inventory item</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                data={profitLossData}
                columns={columns}
                searchable
                searchPlaceholder="Search items..."
                searchKeys={["inventoryId"]}
                isLoading={isLoadingPL}
                emptyTitle="No P&L Data"
                emptyMessage="No historical data yet. Complete sales to see per-item profit and loss breakdowns."
                emptyIcon={<BarChart3 className="h-6 w-6" />}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
