import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Coins, Package, Wrench, ShoppingBag, BarChart3, AlertCircle, Wallet, ChevronDown } from "lucide-react";
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
import { useAuth } from "@/hooks/useAuth";
import { endOfDay, startOfDay, startOfMonth, subMonths, format } from "date-fns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function ProfitLossPage() {
  const { currentStore } = useStore();
  const { user } = useAuth();
  const storeCurrency = currentStore?.currency || "NGN";
  const [discountsCollapsed, setDiscountsCollapsed] = useState(true);

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
    queryKey: ["/api/profit-loss", currentStore?.id],
    enabled: !!currentStore?.id,
  });

  const { data: summary, isLoading: isLoadingSummary } = useQuery<any>({
    queryKey: [
      "/api/profit-loss/summary",
      currentStore?.id,
      dateRange?.from?.toISOString(),
      dateRange?.to?.toISOString()
    ],
    queryFn: async () => {
      const params = new URLSearchParams({ storeId: currentStore!.id });
      if (dateRange?.from) params.append("startDate", dateRange.from.toISOString().split('T')[0]);
      if (dateRange?.to) params.append("endDate", dateRange.to.toISOString().split('T')[0]);
      const res = await fetch(`/api/profit-loss/summary?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch summary");
      return res.json();
    },
    enabled: !!currentStore?.id,
  });

  const formatCurrency = (value: number) => {
    return formatCurrencyUtil(value, storeCurrency);
  };

  const isLoading = isLoadingPL || isLoadingSummary;

  if (user?.role === "staff") {
    return (
      <div className="space-y-6">
        <PageHeader title="Profit & Loss Report" />
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            You do not have permission to view Profit & Loss reports.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Profit & Loss Report"
          description="Analyze revenue and profit across all inventory items"
        />
        <StoreRequiredAlert title="Store Required for Reports" />
      </div>
    );
  }

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
            <Badge variant="outline" className="text-xs capitalize mt-1">
              {pl.inventory?.type ?? "unknown"}
            </Badge>
          </div>
        </div>
      ),
    },
    {
      key: "totalQuantitySold",
      header: "Qty Sold",
      render: (pl: ProfitLossWithInventory) => (
        <div className="flex items-center gap-2">
          <ShoppingBag className="h-3 w-3 text-muted-foreground" />
          <span className="font-mono">{pl.totalQuantitySold}</span>
        </div>
      ),
    },
    {
      key: "quantityRemaining",
      header: "Remaining",
      render: (pl: ProfitLossWithInventory) => (
        <span className="font-mono">
          {pl.inventory?.type === "service" ? "N/A" : pl.quantityRemaining}
        </span>
      ),
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
  const isOwner = user?.role === "owner";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profit & Loss Statement"
        description={`Financial performance analysis for ${currentStore.name}`}
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
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total Revenue"
          value={formatCurrency(summary?.totalRevenue ?? 0)}
          icon={<Coins className="h-4 w-4 text-emerald-600" />}
          isLoading={isLoading}
        />
        <MetricCard
          title="Gross Profit"
          value={formatCurrency(summary?.grossProfit ?? 0)}
          icon={(summary?.grossProfit ?? 0) >= 0 ? <TrendingUp className="h-4 w-4 text-blue-600" /> : <TrendingDown className="h-4 w-4 text-red-600" />}
          description="Revenue − Cost of Goods Sold"
          isLoading={isLoading}
        />
        {isOwner && (
          <MetricCard
            title="Total Expenses"
            value={formatCurrency(summary?.totalExpenses ?? 0)}
            icon={<Wallet className="h-4 w-4 text-amber-600" />}
            description="Operational + Payroll"
            isLoading={isLoading}
          />
        )}
        {isOwner && (
          <MetricCard
            title="Operating Profit"
            value={formatCurrency(opProfit)}
            icon={opProfit >= 0 ? <TrendingUp className="h-4 w-4 text-green-600" /> : <TrendingDown className="h-4 w-4 text-red-600" />}
            description="Gross Profit − Total Expenses"
            isLoading={isLoading}
          />
        )}
      </div>

      <Tabs defaultValue="income" className="w-full">
        <TabsList className={`grid w-full mb-6 ${isOwner ? "grid-cols-4" : "grid-cols-2"}`}>
          <TabsTrigger value="income">Income Statement</TabsTrigger>
          {isOwner && <TabsTrigger value="expenses">Expense Details</TabsTrigger>}
          {isOwner && <TabsTrigger value="discounts">Discounts Report</TabsTrigger>}
          <TabsTrigger value="breakdown">Item-by-Item Breakdown (All Time)</TabsTrigger>
        </TabsList>

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
                <span className="text-muted-foreground">Service Revenue</span>
                <span className="font-mono">{formatCurrency(summary?.serviceRevenue ?? 0)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Product Sales</span>
                <span className="font-mono">{formatCurrency(summary?.productRevenue ?? 0)}</span>
              </div>
              <div className="flex justify-between items-center font-medium pt-2 border-t">
                <span>Total Revenue</span>
                <span className="font-mono text-emerald-600">{formatCurrency(summary?.totalRevenue ?? 0)}</span>
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
                <div className="rounded-md border overflow-hidden">
                  <table className="w-full text-sm text-left">
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
                emptyMessage="No historical data available."
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
