import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { appendReturnTo } from "@/lib/return-to";
import { buildSlug } from "@/lib/slug";
import { BarChart3, Coins, ArrowRight, Wallet, ShoppingCart, Info, RefreshCw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { ListControls } from "@/components/list-controls";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getCustomerInitials } from "@/lib/customer-detail-utils";
import { ProfitabilityFiltersSheet, ProfitabilitySortSheet } from "@/components/profitability-filter-sheets";
import {
  EMPTY_PROFITABILITY_FILTERS,
  buildProfitabilityFilterChips,
  clearProfitabilityFilterChip,
  countActiveProfitabilityFilters,
  profitabilityMatchesFilters,
  profitabilitySortLabel,
  sortProfitability,
  type ProfitabilityFilterState,
  type ProfitabilitySortState,
} from "@/lib/profitability-filters";
import { useStore } from "@/lib/store-context";
import { formatCurrency as formatCurrencyUtil, formatCurrencyCompact } from "@/lib/currency-utils";
import { MetricGrid } from "@/components/metric-grid";
import { type DateRange } from "@/components/date-range-filter";
import { usePersistedDateRange, readPersistedRange } from "@/hooks/use-persisted-date-range";
import { endOfDay, format, startOfDay, startOfMonth } from "date-fns";
import { PageContainer } from "@/components/oop-ui/PageContainer";
import { PolymorphicMetricCard } from "@/components/oop-ui/PolymorphicMetricCard";
import { analyticsApi } from "@/services/AnalyticsApiService";
import { ExportToolbar } from "@/components/export-toolbar";

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
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const { currentStore } = useStore();
  const storeCurrency = currentStore?.currency || "NGN";

  const [dateRange, setDateRange] = usePersistedDateRange<DateRange>(
    "service_profitability_date_range",
    () =>
      readPersistedRange("service_profitability_date_range") ?? {
        from: startOfMonth(new Date()),
        to: new Date(),
      },
  );

  const [searchText, setSearchText] = useState("");
  // The date range is the report's server-side scope and stays persisted; the Filters sheet
  // edits it alongside the client-side filters.
  const [otherFilters, setOtherFilters] = useState<ProfitabilityFilterState>(EMPTY_PROFITABILITY_FILTERS);
  const [sort, setSort] = useState<ProfitabilitySortState | null>(null);

  const startDateStr = dateRange.from ? format(dateRange.from, "yyyy-MM-dd") : undefined;
  const filters: ProfitabilityFilterState = {
    ...otherFilters,
    dateFrom: startDateStr ?? null,
    dateTo: dateRange.to ? format(dateRange.to, "yyyy-MM-dd") : null,
  };
  const setFilters = (next: ProfitabilityFilterState) => {
    setOtherFilters(next);
    setDateRange({
      from: next.dateFrom ? startOfDay(new Date(`${next.dateFrom}T00:00:00`)) : undefined,
      to: next.dateTo ? endOfDay(new Date(`${next.dateTo}T00:00:00`)) : undefined,
    });
  };
  const endDateStr = dateRange.to ? format(dateRange.to, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");

  const { data: report, isLoading, isError, refetch } = useQuery<ServiceProfitabilityReport>({
    queryKey: ["service-profitability-report", currentStore?.id, startDateStr, endDateStr],
    queryFn: () => analyticsApi.getServiceProfitability(currentStore!.id, startDateStr, endDateStr),
    enabled: !!currentStore?.id,
  });

  const formatCurrency = (value: number) => formatCurrencyUtil(value, storeCurrency);
  const formatCompact = (value: number) => formatCurrencyCompact(value, storeCurrency);

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

  const openItem = (item: ServiceProfitabilityItem) =>
    setLocation(appendReturnTo(`/inventory/${buildSlug(item.name, item.id)}`, location, search));

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
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Sustaining cost breakdown"
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 rounded text-muted-foreground cursor-help focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
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
          onClick={(e) => { e.stopPropagation(); openItem(item); }}
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

  const itemCardAvatar = (item: ServiceProfitabilityItem) => (
    <Avatar className="h-10 w-10">
      <AvatarFallback className={`text-sm font-semibold ${
        item.type === "service"
          ? "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
          : "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300"}`}>
        {getCustomerInitials(item.name)}
      </AvatarFallback>
    </Avatar>
  );

  const searchTerm = searchText.trim().toLowerCase();
  const searchedItems = (report?.items ?? []).filter((i) => !searchTerm || i.name.toLowerCase().includes(searchTerm));
  const visibleItems = sortProfitability(
    searchedItems.filter((i) => profitabilityMatchesFilters(i, filters)),
    sort,
  );

  const hasActiveView = searchTerm !== "" || countActiveProfitabilityFilters(filters) > 0;
  const exportRows = visibleItems as unknown as Record<string, unknown>[];
  const rangeLabel = `${startDateStr ?? "start"}_${endDateStr}`;

  return (
    <TooltipProvider delayDuration={100}>
    <PageContainer
      title="Service & Product Profitability"
      description="Comprehensive analysis of direct margins, COGS, and item-specific sustaining costs"
      storeRequired
      currentStore={currentStore}
      actions={
        <div className="flex items-center gap-2">
          <ExportToolbar
            data={exportRows}
            columns={exportColumns}
            filename={`service-product-profitability_${rangeLabel}`}
            title="Service & Product Profitability Report"
            disabled={isLoading || isError}
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
              rows: exportRows,
              amountKey: "netProfit",
              formatAmount: formatCurrency,
              statusKey: "status",
              unitLabel: "items",
            }}
          />
        </div>
      }
    >
      {isError && (
        <Card className="border-red-200 dark:border-red-900/40">
          <CardContent className="p-4 flex items-center justify-between gap-3">
            <span className="text-sm text-red-700 dark:text-red-300">Couldn't load the profitability report.</span>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1">
              <RefreshCw className="h-3 w-3" /> Retry
            </Button>
          </CardContent>
        </Card>
      )}

      <MetricGrid>
        <PolymorphicMetricCard
          title="Total Revenue"
          value={formatCurrency(report?.totalRevenue ?? 0)}
          compactValue={formatCompact(report?.totalRevenue ?? 0)}
          icon={<Coins className="h-5 w-5 text-green-600" />}
          isLoading={isLoading}
        />
        <PolymorphicMetricCard
          title="Total Cost of Goods (COGS)"
          value={formatCurrency(report?.totalCogs ?? 0)}
          compactValue={formatCompact(report?.totalCogs ?? 0)}
          icon={<ShoppingCart className="h-5 w-5 text-amber-600" />}
          isLoading={isLoading}
        />
        <PolymorphicMetricCard
          title="Total Sustaining Costs"
          value={formatCurrency(report?.totalSustainingCosts ?? 0)}
          compactValue={formatCompact(report?.totalSustainingCosts ?? 0)}
          icon={<Wallet className="h-5 w-5 text-red-500" />}
          isLoading={isLoading}
        />
        <PolymorphicMetricCard
          title="Net Consolidated Profit"
          value={formatCurrency(report?.netProfit ?? 0)}
          compactValue={formatCompact(report?.netProfit ?? 0)}
          trend={(report?.netProfit ?? 0) >= 0 ? "up" : "down"}
          trendValue={`Margin: ${(report?.netProfitMargin ?? 0).toFixed(1)}%`}
          icon={<BarChart3 className="h-5 w-5 text-primary" />}
          isLoading={isLoading}
        />
      </MetricGrid>

      <Card className="border border-blue-100 bg-gradient-to-br from-blue-50/20 to-indigo-50/25 dark:border-blue-900/20 dark:from-blue-950/10 dark:to-indigo-950/10 shadow-sm">
        <CardContent className="p-4 flex gap-3 items-center">
          <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0" />
          <div className="text-xs md:text-sm text-blue-800 dark:text-blue-200">
            <span className="font-semibold">How sustaining costs are counted:</span> these are the same money the P&amp;L reports on its
            Direct Supplies &amp; Consumables line — shown here split across the items that incurred them, rather than as one
            total. Attributing a cost to an item changes where it is reported, never whether it is counted, so these figures
            add back up to that line exactly.
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <ListControls
          testIdPrefix="profitability"
          placeholder="Search services or products"
          search={searchText}
          onSearchChange={setSearchText}
          filterCount={countActiveProfitabilityFilters(filters)}
          filters={(trigger) => (
            <ProfitabilityFiltersSheet
              filters={filters}
              onApply={setFilters}
              resultCountFor={(draft) => searchedItems.filter((i) => profitabilityMatchesFilters(i, draft)).length}
              trigger={trigger}
            />
          )}
          sortLabel={profitabilitySortLabel(sort).replace(/^Sort: /, "")}
          sort={(trigger) => <ProfitabilitySortSheet sort={sort} onChange={setSort} trigger={trigger} />}
          chips={buildProfitabilityFilterChips(filters)}
          onRemoveChip={(key) => setFilters(clearProfitabilityFilterChip(filters, key as Parameters<typeof clearProfitabilityFilterChip>[1]))}
          hasSort={sort !== null}
          onClearAll={() => { setFilters(EMPTY_PROFITABILITY_FILTERS); setSort(null); }}
          visibleCount={visibleItems.length}
          noun="item"
        />
        <DataTable
          data={visibleItems}
          columns={columns}
          hideToolbar
          isLoading={isLoading}
          emptyTitle="No Items Found"
          emptyMessage={hasActiveView ? "No items match your search or filters." : "No items sold in this period."}
          emptyIcon={<BarChart3 className="h-6 w-6" />}
          onRowClick={openItem}
          urlKey="profitability"
          showCardChevron
          cardLayout="compact-grid"
          cardAvatar={itemCardAvatar}
        />
      </div>
    </PageContainer>
    </TooltipProvider>
  );
}
