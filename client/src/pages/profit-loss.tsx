import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, DollarSign, Package, Wrench, ShoppingBag, BarChart3, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { ExportToolbar } from "@/components/export-toolbar";
import { useStore } from "@/lib/store-context";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency-utils";
import { Link } from "wouter";
import type { ProfitLossWithInventory } from "@shared/schema";

export default function ProfitLossPage() {
  const { currentStore } = useStore();
  const storeCurrency = currentStore?.currency || "NGN";

  const { data: profitLossData = [], isLoading } = useQuery<ProfitLossWithInventory[]>({
    queryKey: ["/api/profit-loss", currentStore?.id],
    enabled: !!currentStore?.id,
  });

  const formatCurrency = (value: number) => {
    return formatCurrencyUtil(value, storeCurrency);
  };

  const totalRevenue = profitLossData.reduce((sum, pl) => sum + pl.totalRevenue, 0);
  const totalProfit = profitLossData.reduce((sum, pl) => sum + pl.totalNetProfit, 0);
  const totalQuantitySold = profitLossData.reduce((sum, pl) => sum + pl.totalQuantitySold, 0);
  const profitableItems = profitLossData.filter((pl) => pl.totalNetProfit > 0).length;
  const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

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
            <p className="font-medium" data-testid={`text-item-name-${pl.inventoryId.slice(0, 8)}`}>
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
      key: "costPrice",
      header: "Unit Cost",
      render: (pl: ProfitLossWithInventory) => (
        <span className="font-mono text-sm text-muted-foreground">
          {formatCurrency(pl.inventory?.costPrice ?? 0)}
        </span>
      ),
    },
    {
      key: "sellingPrice",
      header: "Unit Price",
      render: (pl: ProfitLossWithInventory) => (
        <span className="font-mono text-sm">
          {formatCurrency(pl.inventory?.sellingPrice ?? 0)}
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
      key: "totalNetProfit",
      header: "Net Profit",
      render: (pl: ProfitLossWithInventory) => (
        <div className="flex items-center gap-2">
          {pl.totalNetProfit >= 0 ? (
            <TrendingUp className="h-3 w-3 text-green-600 dark:text-green-400" />
          ) : (
            <TrendingDown className="h-3 w-3 text-red-600 dark:text-red-400" />
          )}
          <span
            className={`font-mono font-medium ${
              pl.totalNetProfit >= 0
                ? "text-green-600 dark:text-green-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {formatCurrency(pl.totalNetProfit)}
          </span>
        </div>
      ),
    },
    {
      key: "margin",
      header: "Margin",
      render: (pl: ProfitLossWithInventory) => {
        const margin = pl.totalRevenue > 0
          ? (pl.totalNetProfit / pl.totalRevenue) * 100
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
    { key: "totalNetProfit", header: "Net Profit" },
    { key: "margin", header: "Profit Margin %" },
  ];

  const exportData = profitLossData.map((pl) => ({
    inventory: pl.inventory,
    totalQuantitySold: pl.totalQuantitySold,
    quantityRemaining: pl.inventory?.type === "service" ? "N/A" : pl.quantityRemaining,
    totalRevenue: pl.totalRevenue,
    totalNetProfit: pl.totalNetProfit,
    margin: pl.totalRevenue > 0 ? ((pl.totalNetProfit / pl.totalRevenue) * 100).toFixed(1) : "0.0",
  }));

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profit & Loss Report"
        description={`Revenue and profit analysis for ${currentStore.name}`}
        actions={
          <ExportToolbar
            data={exportData as unknown as Record<string, unknown>[]}
            columns={exportColumns}
            filename="profit-loss-report"
            title="Profit & Loss Report"
            disabled={isLoading}
          />
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          title="Total Revenue"
          value={formatCurrency(totalRevenue)}
          icon={<DollarSign className="h-4 w-4" />}
          isLoading={isLoading}
        />
        <MetricCard
          title="Net Profit"
          value={formatCurrency(totalProfit)}
          icon={totalProfit >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          trend={totalProfit >= 0 ? "up" : "down"}
          isLoading={isLoading}
        />
        <MetricCard
          title="Profit Margin"
          value={`${profitMargin.toFixed(1)}%`}
          icon={<BarChart3 className="h-4 w-4" />}
          isLoading={isLoading}
        />
        <MetricCard
          title="Total Items Sold"
          value={totalQuantitySold}
          icon={<ShoppingBag className="h-4 w-4" />}
          isLoading={isLoading}
        />
        <MetricCard
          title="Profitable Items"
          value={`${profitableItems} / ${profitLossData.length}`}
          icon={<BarChart3 className="h-4 w-4" />}
          description="Items with positive profit"
          isLoading={isLoading}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Item-by-Item Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            data={profitLossData}
            columns={columns}
            searchable
            searchPlaceholder="Search items..."
            searchKeys={["inventoryId"]}
            isLoading={isLoading}
            emptyMessage="No profit/loss data available. Complete some sales to see reports here."
          />
        </CardContent>
      </Card>
    </div>
  );
}
