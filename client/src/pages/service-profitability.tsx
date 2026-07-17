import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { buildSlug } from "@/lib/slug";
import { BarChart3, RefreshCw, Layers, Coins, AlertTriangle, ArrowRight, Wallet, ShoppingCart, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency-utils";
import { DateRangeFilter, type DateRange } from "@/components/date-range-filter";
import { format } from "date-fns";
import { PageContainer } from "@/components/oop-ui/PageContainer";
import { PolymorphicMetricCard } from "@/components/oop-ui/PolymorphicMetricCard";
import { analyticsApi } from "@/services/AnalyticsApiService";
import { ExportToolbar } from "@/components/export-toolbar";
import type { TableFilterConfig } from "@/components/oop-ui/PolymorphicTable";

interface SustainingBreakdownEntry {
  title: string;
  amount: number;
  percent: number;
}

interface ServiceProfitabilityItem {
  id: string;
  name: string;
  type: "product" | "service";
  totalRevenue: number;
  totalCogs: number;
  grossProfit: number;
  totalSustainingCosts: number;
  sustainingBreakdown: SustainingBreakdownEntry[];
  netProfit: number;
  netProfitMargin: number;
  status: "profit" | "breakeven" | "loss";
}

interface ServiceProfitabilityReport {
  period: string;
  startDate?: string;
  endDate: string;
  totalRevenue: number;
  totalCogs: number;
  totalSustainingCosts: number;
  netProfit: number;
  netProfitMargin: number;
  status: "profit" | "breakeven" | "loss";
  items: ServiceProfitabilityItem[];
}

export default function ServiceProfitabilityPage() {
  const [, setLocation] = useLocation();
  const { currentStore } = useStore();
  const storeCurrency = currentStore?.currency || "NGN";
  
  const [dateRange, setDateRange] = useState<DateRange>({
    from: (() => {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      return d;
    })(),
    to: new Date(),
  });

  const startDateStr = dateRange.from ? format(dateRange.from, "yyyy-MM-dd") : undefined;
  const endDateStr = dateRange.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

  const { data: report, isLoading } = useQuery<ServiceProfitabilityReport>({
    queryKey: ["service-profitability-report", currentStore?.id, startDateStr, endDateStr],
    queryFn: () => analyticsApi.getServiceProfitability(currentStore!.id, startDateStr, endDateStr),
    enabled: !!currentStore?.id,
  });

  const formatCurrency = (value: number) => {
    return formatCurrencyUtil(value, storeCurrency);
  };

  const getStatusBadge = (status: "profit" | "breakeven" | "loss") => {
    switch (status) {
      case "profit":
        return (
          <Badge className="bg-green-100 hover:bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 font-bold px-2">
            ✅ In Profit
          </Badge>
        );
      case "breakeven":
        return (
          <Badge className="bg-amber-100 hover:bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 font-bold px-2">
            ⚠️ Break Even
          </Badge>
        );
      case "loss":
        return (
          <Badge className="bg-red-100 hover:bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 font-bold px-2">
            ❌ In Loss
          </Badge>
        );
    }
  };

  const columns = [
    {
      key: "name",
      header: "Item / Service Name",
      render: (item: ServiceProfitabilityItem) => (
        <div>
          <span className="font-semibold">{item.name}</span>
          <div className="mt-0.5">
            <Badge variant="outline" className={`capitalize text-[10px] h-4 ${
              item.type === "service" ? "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-400 dark:border-violet-900/30"
              : "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-400 dark:border-sky-900/30"}`}>
              {item.type}
            </Badge>
          </div>
        </div>
      ),
    },
    {
      key: "totalRevenue",
      header: "Revenue",
      render: (item: ServiceProfitabilityItem) => (
        <span className="font-mono">{formatCurrency(item.totalRevenue)}</span>
      ),
    },
    {
      key: "totalCogs",
      header: "COGS",
      render: (item: ServiceProfitabilityItem) => (
        <span className="font-mono text-muted-foreground">{formatCurrency(item.totalCogs)}</span>
      ),
    },
    {
      key: "totalSustainingCosts",
      header: "Sustaining Costs",
      render: (item: ServiceProfitabilityItem) => (
        <div className="flex items-center gap-1">
          <span className="font-mono text-red-500 font-medium">{formatCurrency(item.totalSustainingCosts)}</span>
          {item.sustainingBreakdown?.length > 0 && (
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[220px] p-3 space-y-1.5">
                  <p className="text-xs font-semibold mb-1">Sustaining Cost Breakdown</p>
                  {item.sustainingBreakdown.map((b, i) => (
                    <div key={i} className="flex justify-between gap-3 text-xs">
                      <span className="text-muted-foreground truncate">{b.title}</span>
                      <span className="font-mono shrink-0">
                        {formatCurrency(b.amount)} <span className="text-muted-foreground">({b.percent}%)</span>
                      </span>
                    </div>
                  ))}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      ),
    },
    {
      key: "netProfit",
      header: "Net Profit",
      render: (item: ServiceProfitabilityItem) => (
        <div className="flex flex-col">
          <span className={`font-mono font-bold ${item.netProfit > 0 ? "text-green-600 dark:text-green-400" : item.netProfit < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
            {formatCurrency(item.netProfit)}
          </span>
          <span className="text-[10px] text-muted-foreground mt-0.5">
            Margin: {item.netProfitMargin.toFixed(1)}%
          </span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (item: ServiceProfitabilityItem) => getStatusBadge(item.status),
    },
    {
      key: "actions",
      header: "Actions",
      render: (item: ServiceProfitabilityItem) => (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setLocation(`/inventory/${buildSlug(item.name, item.id)}`)}
          className="flex items-center gap-1 hover:bg-primary hover:text-primary-foreground transition-all duration-200"
        >
          Details
          <ArrowRight className="h-3 w-3" />
        </Button>
      ),
    },
  ];

  const exportColumns = [
    { key: "name", header: "Item / Service" },
    { key: "type", header: "Type" },
    { key: "totalRevenue", header: "Revenue" },
    { key: "totalCogs", header: "COGS" },
    { key: "totalSustainingCosts", header: "Sustaining Costs" },
    { key: "netProfit", header: "Net Profit" },
    { key: "netProfitMargin", header: "Margin %" },
    { key: "status", header: "Status" },
  ];

  const profitabilityFilterConfigs: TableFilterConfig[] = [
    { key: "type", label: "Type", type: "select" },
    { key: "status", label: "Status", type: "select" },
  ];

  return (
    <PageContainer
      title="Service & Product Profitability"
      description="Comprehensive analysis of direct margins, COGS, and item-specific sustaining costs"
      storeRequired
      currentStore={currentStore}
      actions={
        <div className="flex items-center gap-2">
          <DateRangeFilter
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            defaultPreset="30days"
            timezone={currentStore?.timezone}
          />
          <ExportToolbar
            data={(report?.items ?? []) as unknown as Record<string, unknown>[]}
            columns={exportColumns}
            filename={`service-product-profitability_${startDateStr}_${endDateStr}`}
            title="Service & Product Profitability Report"
            disabled={isLoading}
            pdfReport={{
              businessName: currentStore?.name ?? "Business",
              storeName: currentStore?.name ?? "All Stores",
              kpis: [
                { label: "Total Revenue", value: formatCurrency(report?.totalRevenue ?? 0) },
                { label: "Total COGS", value: formatCurrency(report?.totalCogs ?? 0) },
                { label: "Sustaining Costs", value: formatCurrency(report?.totalSustainingCosts ?? 0) },
                { label: "Net Profit", value: formatCurrency(report?.netProfit ?? 0), sub: `Margin: ${(report?.netProfitMargin ?? 0).toFixed(1)}%` },
              ],
              columns: [
                { key: "name", header: "Item" },
                { key: "type", header: "Type" },
                { key: "totalRevenue", header: "Revenue", align: "right" as const, format: (i: Record<string, unknown>) => formatCurrency(i.totalRevenue as number) },
                { key: "netProfit", header: "Net Profit", align: "right" as const, format: (i: Record<string, unknown>) => formatCurrency(i.netProfit as number) },
              ],
              rows: (report?.items ?? []) as unknown as Record<string, unknown>[],
              amountKey: "netProfit",
              formatAmount: formatCurrency,
              statusKey: "status",
              unitLabel: "items",
            }}
          />
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <PolymorphicMetricCard
          title="Total Sustained Revenue"
          value={formatCurrency(report?.totalRevenue ?? 0)}
          icon={<Coins className="h-5 w-5 text-green-600 animate-pulse" />}
          isLoading={isLoading}
        />
        <PolymorphicMetricCard
          title="Total Cost of Goods (COGS)"
          value={formatCurrency(report?.totalCogs ?? 0)}
          icon={<ShoppingCart className="h-5 w-5 text-amber-600" />}
          isLoading={isLoading}
        />
        <PolymorphicMetricCard
          title="Total Sustaining Costs"
          value={formatCurrency(report?.totalSustainingCosts ?? 0)}
          icon={<Wallet className="h-5 w-5 text-red-500" />}
          isLoading={isLoading}
        />
        <PolymorphicMetricCard
          title="Net Consolidated Profit"
          value={formatCurrency(report?.netProfit ?? 0)}
          trend={(report?.netProfit ?? 0) >= 0 ? "up" : "down"}
          trendValue={`Margin: ${(report?.netProfitMargin ?? 0).toFixed(1)}%`}
          icon={<BarChart3 className="h-5 w-5 text-primary" />}
          isLoading={isLoading}
        />
      </div>

      <Card className="border border-blue-100 bg-gradient-to-br from-blue-50/20 to-indigo-50/25 dark:border-blue-900/20 dark:from-blue-950/10 dark:to-indigo-950/10 shadow-sm">
        <CardContent className="p-4 flex gap-3 items-center">
          <AlertTriangle className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0" />
          <div className="text-xs md:text-sm text-blue-800 dark:text-blue-200">
            <span className="font-semibold">Sustainability Accounting Concept:</span> Unlike traditional Operational Expenses (OPEX), product/service sustaining costs are directly linked to item replenishment or upkeep, and are entirely excluded from the General P&L statement to facilitate per-item ROI precision.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Profitability & Sustainability Ledger</CardTitle>
          <CardDescription>
            Detailed analysis of active inventory types, replenishments, and associated maintenance allocations
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            data={report?.items ?? []}
            columns={columns}
            searchable
            searchPlaceholder="Search services or products..."
            searchKeys={["name"]}
            filterConfigs={profitabilityFilterConfigs}
            isLoading={isLoading}
            emptyMessage="No inventory items found."
          />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
