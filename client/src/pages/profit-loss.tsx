import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Coins, Package, Wrench, ShoppingBag, BarChart3, AlertCircle, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { ExportToolbar } from "@/components/export-toolbar";
import { useStore } from "@/lib/store-context";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency-utils";
import { Link } from "wouter";
import { DateRangeFilter } from "@/components/date-range-filter";
import { Separator } from "@/components/ui/separator";
import type { ProfitLossWithInventory } from "@shared/schema";
import { useAuth } from "@/hooks/useAuth";
import { endOfDay, startOfMonth, subMonths, format } from "date-fns";

export default function ProfitLossPage() {
  const { currentStore } = useStore();
  const { user } = useAuth();
  const storeCurrency = currentStore?.currency || "NGN";

  const [dateRange, setDateRange] = useState<{ from: Date; to: Date } | undefined>({
    from: startOfMonth(new Date()),
    to: endOfDay(new Date())
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

  if (user?.role !== "owner") {
    return (
      <div className="space-y-6">
        <PageHeader title="Profit & Loss Report" />
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            You do not have permission to view Profit & Loss reports. This page is restricted to Owners.
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
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please <Link href="/settings/stores" className="underline font-medium">set up your business and store</Link> first to view profit & loss reports.
          </AlertDescription>
        </Alert>
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
        <MetricCard
          title="Total Expenses"
          value={formatCurrency(summary?.totalExpenses ?? 0)}
          icon={<Wallet className="h-4 w-4 text-amber-600" />}
          description="Operational + Payroll"
          isLoading={isLoading}
        />
        <MetricCard
          title="Operating Profit"
          value={formatCurrency(opProfit)}
          icon={opProfit >= 0 ? <TrendingUp className="h-4 w-4 text-green-600" /> : <TrendingDown className="h-4 w-4 text-red-600" />}
          description="Gross Profit − Total Expenses"
          isLoading={isLoading}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-primary/20 shadow-sm">
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

            <Separator className="my-4" />

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

            <div className="flex justify-between items-center font-bold text-xl pt-4 border-t mt-4">
              <span>OPERATING PROFIT</span>
              <span className={`font-mono ${opProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                {formatCurrency(opProfit)}
              </span>
            </div>
          </CardContent>
        </Card>

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
      </div>
    </div>
  );
}
