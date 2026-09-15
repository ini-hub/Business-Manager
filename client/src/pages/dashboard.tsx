import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { STALE_TIMES } from "@/lib/queryClient";
import { Users, UserCog, Package, TrendingUp, ShoppingCart, AlertTriangle, Plus, ChevronRight, ArrowUp, ArrowDown, PackagePlus, UserPlus, Calendar as CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, useLocation, useSearch } from "wouter";
import { buildSlug } from "@/lib/slug";
import { appendReturnTo } from "@/lib/return-to";
import { SalesTrendChart, RevenueByItemChart, RevenueBreakdownChart } from "@/components/charts";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { GettingStartedChecklist } from "@/components/getting-started-checklist";
import { formatCurrency as formatCurrencyUtil, formatCurrencyCompact } from "@/lib/currency-utils";
import type { Inventory, ProfitLossWithInventory } from "@shared/schema";
import { DateRangeFilter, type DateRange } from "@/components/date-range-filter";
import { format, startOfDay, endOfDay, isSameDay, subDays, startOfMonth, startOfYear } from "date-fns";
import { useAuth } from "@/hooks/useAuth";
import { usePersistedDateRange, readPersistedRange } from "@/hooks/use-persisted-date-range";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface DashboardStats {
  totalCustomers: number;
  totalStaff: number;
  totalInventory: number;
  totalProducts: number;
  totalServices: number;
  totalTransactions: number;
  uniqueCustomersInPeriod?: number;
  totalRevenue: number;
  grossRevenue?: number;
  returnedRevenue?: number;
  totalProfit: number;
  revenueMix?: { services: number; products: number };
  lowStockThreshold?: number;
  lowStockItems: Inventory[];
  outOfStockCount?: number;
  lowStockCount?: number;
}

type DatePreset = "today" | "7d" | "30d" | "month" | "year" | "all" | "custom";

/** % change from `prev` to `cur`, rounded. Undefined when there's no baseline to compare against. */
function pctChange(cur: number, prev: number): number | undefined {
  if (prev === 0) return cur === 0 ? undefined : 100;
  return Math.round(((cur - prev) / prev) * 100);
}

/**
 * Comparison window for a given preset: "Today" compares to yesterday, "7d"/"30d"
 * to the same number of days immediately before, "Month" to the same
 * day-of-month span in the previous calendar month (so "1-15 Sep" compares to
 * "1-15 Aug", not a raw 15-day shift which would land mid-August), and "Year"
 * to the same day-of-year span in the previous calendar year. "All time" has
 * no baseline to compare against — returns an empty range, which the caller
 * uses to skip the comparison query entirely. Custom ranges fall back to an
 * equal-length immediately-preceding window.
 */
function getPreviousPeriod(preset: DatePreset, from: Date, to: Date): DateRange {
  if (preset === "all") {
    return { from: undefined, to: undefined };
  }
  if (preset === "month") {
    const dayOffset = to.getDate() - from.getDate();
    const prevFrom = new Date(from.getFullYear(), from.getMonth() - 1, from.getDate());
    const prevTo = new Date(prevFrom.getFullYear(), prevFrom.getMonth(), prevFrom.getDate() + dayOffset);
    return { from: startOfDay(prevFrom), to: endOfDay(prevTo) };
  }
  if (preset === "year") {
    const prevFrom = new Date(from.getFullYear() - 1, from.getMonth(), from.getDate());
    const prevTo = new Date(to.getFullYear() - 1, to.getMonth(), to.getDate());
    return { from: startOfDay(prevFrom), to: endOfDay(prevTo) };
  }
  const spanMs = endOfDay(to).getTime() - startOfDay(from).getTime();
  const prevTo = new Date(startOfDay(from).getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - spanMs);
  return { from: startOfDay(prevFrom), to: endOfDay(prevTo) };
}

export default function Dashboard() {
  const { currentStore, business, stores } = useStore();
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const [location] = useLocation();
  const search = useSearch();

  const [dateRange, setDateRange] = usePersistedDateRange<DateRange>(
    "dashboard_date_range",
    () =>
      readPersistedRange("dashboard_date_range") ?? {
        from: startOfDay(new Date()),
        to: endOfDay(new Date()),
      },
  );
  // Tracks which segmented preset produced `dateRange`, so the desktop header can
  // highlight the right button and compute the correct comparison window (see
  // getPreviousPeriod). Defaults to "month" to match the desktop-first mockup;
  // has no effect on the separate mobile compact date pill below.
  const [datePreset, setDatePreset] = useState<DatePreset>("month");

  const applyDatePreset = (preset: DatePreset) => {
    const now = new Date();
    const range: DateRange =
      preset === "today" ? { from: startOfDay(now), to: endOfDay(now) } :
      preset === "7d" ? { from: startOfDay(subDays(now, 6)), to: endOfDay(now) } :
      preset === "30d" ? { from: startOfDay(subDays(now, 29)), to: endOfDay(now) } :
      preset === "month" ? { from: startOfDay(startOfMonth(now)), to: endOfDay(now) } :
      preset === "year" ? { from: startOfDay(startOfYear(now)), to: endOfDay(now) } :
      preset === "all" ? { from: undefined, to: undefined } :
      dateRange;
    setDatePreset(preset);
    if (preset !== "custom") setDateRange(range);
  };

  const previousRange = dateRange.from && dateRange.to
    ? getPreviousPeriod(datePreset, dateRange.from, dateRange.to)
    : { from: undefined, to: undefined };

  const queryParams = new URLSearchParams();
  if (dateRange.from) queryParams.set("from", format(dateRange.from, "yyyy-MM-dd"));
  if (dateRange.to) queryParams.set("to", format(dateRange.to, "yyyy-MM-dd"));
  const queryString = queryParams.toString() ? `?${queryParams.toString()}` : "";

  const prevQueryParams = new URLSearchParams();
  if (previousRange.from) prevQueryParams.set("from", format(previousRange.from, "yyyy-MM-dd"));
  if (previousRange.to) prevQueryParams.set("to", format(previousRange.to, "yyyy-MM-dd"));
  const prevQueryString = prevQueryParams.toString() ? `?${prevQueryParams.toString()}` : "";

  const deepLinkParams = new URLSearchParams();
  if (dateRange.from) deepLinkParams.set("startDate", format(dateRange.from, "yyyy-MM-dd"));
  if (dateRange.to) deepLinkParams.set("endDate", format(dateRange.to, "yyyy-MM-dd"));
  const deepLinkQuery = deepLinkParams.toString() ? `?${deepLinkParams.toString()}` : "";
  const dateQuerySuffix = deepLinkQuery ? `&${deepLinkQuery.substring(1)}` : "";

  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats", currentStore?.id, business?.id, queryString],
    queryFn: async () => {
      const param = currentStore?.id === "all" ? `businessId=${business?.id}` : `storeId=${currentStore?.id}`;
      const res = await fetch(`/api/dashboard/stats?${param}${queryString ? '&' + queryString.substring(1) : ''}`);
      if (!res.ok) throw new Error("Failed to fetch dashboard stats");
      return res.json();
    },
    enabled: currentStore?.id === "all" ? !!business?.id : !!currentStore?.id,
    staleTime: STALE_TIMES.live,
    refetchInterval: 5 * 60 * 1000, // 5-min fallback; WS broadcasts handle live invalidation
  });

  // Desktop-only comparison stats: same query, shifted to the preceding window
  // (see getPreviousPeriod) — powers the "▲18% vs last period" deltas.
  const { data: prevStats } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats", currentStore?.id, business?.id, prevQueryString, "previous"],
    queryFn: async () => {
      const param = currentStore?.id === "all" ? `businessId=${business?.id}` : `storeId=${currentStore?.id}`;
      const res = await fetch(`/api/dashboard/stats?${param}${prevQueryString ? '&' + prevQueryString.substring(1) : ''}`);
      if (!res.ok) throw new Error("Failed to fetch previous-period dashboard stats");
      return res.json();
    },
    enabled: (currentStore?.id === "all" ? !!business?.id : !!currentStore?.id) && !!previousRange.from,
    staleTime: STALE_TIMES.live,
  });

  const { data: profitLoss, isLoading: plLoading } = useQuery<ProfitLossWithInventory[]>({
    queryKey: ["/api/profit-loss", currentStore?.id, business?.id, deepLinkQuery],
    queryFn: async () => {
      if (currentStore?.id === "all" && business?.id && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const res = await fetch(`/api/profit-loss?storeId=${s.id}${dateQuerySuffix}`);
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
      const res = await fetch(`/api/profit-loss?storeId=${currentStore?.id}${dateQuerySuffix}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: currentStore?.id === "all" ? !!business?.id : !!currentStore?.id,
    staleTime: STALE_TIMES.live,
    refetchInterval: 5 * 60 * 1000, // 5-min fallback; WS broadcasts handle live invalidation
  });

  const { data: topCustomers = [] } = useQuery<any[]>({
    queryKey: ["/api/reports/top-customers", currentStore?.id, business?.id, deepLinkQuery],
    queryFn: async () => {
      if (currentStore?.id === "all" && business?.id && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const res = await fetch(`/api/reports/top-customers?storeId=${s.id}${dateQuerySuffix}`);
              if (!res.ok) return [];
              return await res.json();
            } catch {
              return [];
            }
          })
        );
        const mergedMap = new Map<string, any>();
        for (const list of responses) {
          for (const cust of list) {
            const key = cust.id;
            const existing = mergedMap.get(key);
            if (existing) {
              existing.transactionCount += cust.transactionCount;
              existing.totalSpent += cust.totalSpent;
            } else {
              mergedMap.set(key, { ...cust });
            }
          }
        }
        return Array.from(mergedMap.values()).sort((a, b) => b.totalSpent - a.totalSpent).slice(0, 5);
      }
      const res = await fetch(`/api/reports/top-customers?storeId=${currentStore?.id}${dateQuerySuffix}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: currentStore?.id === "all" ? !!business?.id : !!currentStore?.id,
    staleTime: STALE_TIMES.live,
    refetchInterval: 5 * 60 * 1000, // 5-min fallback; WS broadcasts handle live invalidation
  });

  const storeCurrency = currentStore?.currency || "NGN";
  const formatCurrency = (value: number) => {
    return formatCurrencyUtil(value, storeCurrency);
  };
  const formatCompact = (value: number) => formatCurrencyCompact(value, storeCurrency);

  const firstName = user?.name?.split(" ")[0] || "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const isToday = !!dateRange.from && !!dateRange.to && isSameDay(dateRange.from, new Date()) && isSameDay(dateRange.to, new Date());
  const avgSale = (stats?.totalTransactions ?? 0) > 0 ? (stats?.totalRevenue ?? 0) / (stats?.totalTransactions ?? 1) : 0;
  const prevAvgSale = (prevStats?.totalTransactions ?? 0) > 0 ? (prevStats?.totalRevenue ?? 0) / (prevStats?.totalTransactions ?? 1) : 0;

  // Desktop metric-tile deltas vs the comparison window computed by getPreviousPeriod.
  const revenueChangePct = prevStats ? pctChange(stats?.totalRevenue ?? 0, prevStats.totalRevenue) : undefined;
  const profitChangePct = prevStats ? pctChange(stats?.totalProfit ?? 0, prevStats.totalProfit) : undefined;
  const transactionsChangePct = prevStats ? pctChange(stats?.totalTransactions ?? 0, prevStats.totalTransactions) : undefined;
  const avgSaleChangePct = prevStats ? pctChange(avgSale, prevAvgSale) : undefined;
  const grossMarginPct = (stats?.totalRevenue ?? 0) > 0 ? Math.round(((stats?.totalProfit ?? 0) / (stats!.totalRevenue)) * 100) : 0;

  const revenueMixTotal = (stats?.revenueMix?.services ?? 0) + (stats?.revenueMix?.products ?? 0);
  const servicesSharePct = revenueMixTotal > 0 ? Math.round(((stats?.revenueMix?.services ?? 0) / revenueMixTotal) * 100) : 0;
  const productsSharePct = revenueMixTotal > 0 ? 100 - servicesSharePct : 0;

  const outOfStockItems = (stats?.lowStockItems ?? []).filter((i) => i.quantity === 0);
  const lowStockOnlyItems = (stats?.lowStockItems ?? []).filter((i) => i.quantity > 0);
  const stockAlertItems = [...outOfStockItems, ...lowStockOnlyItems];

  const topCustomersTotalSpend = topCustomers.reduce((sum: number, c: any) => sum + (c.totalSpent ?? 0), 0);
  const topItemsSorted = [...(profitLoss ?? [])].sort((a, b) => b.totalRevenue - a.totalRevenue).slice(0, 5);

  const dateRangeLabel = dateRange.from && dateRange.to
    ? `${format(dateRange.from, "d MMM")} to ${format(dateRange.to, "d MMM yyyy")}`
    : "";
  const prevRangeLabel = previousRange.from && previousRange.to
    ? `${format(previousRange.from, "d MMM")} to ${format(previousRange.to, "d MMM")}`
    : "";
  const presetLabel: Record<DatePreset, string> = {
    today: "Today", "7d": "Last 7 Days", "30d": "Last 30 Days",
    month: "This Month", year: "This Year", all: "All Time", custom: dateRangeLabel,
  };

  if (!currentStore) {
    return (
      <div className="space-y-8">
        <PageHeader
          title="Dashboard"
          description="Overview of your business performance"
        />
        <StoreRequiredAlert title="Store Required for Dashboard" />
      </div>
    );
  }

  const totalsRows: { key: string; label: string; icon: React.ReactNode; value: React.ReactNode; href: string }[] = [
    {
      key: "customers",
      label: "Customers",
      icon: <Users className="h-3.5 w-3.5 text-muted-foreground" />,
      value: stats?.totalCustomers ?? 0,
      href: "/customers",
    },
    {
      key: "staff",
      label: "Staff",
      icon: <UserCog className="h-3.5 w-3.5 text-muted-foreground" />,
      value: stats?.totalStaff ?? 0,
      href: "/staffs",
    },
    {
      key: "inventory",
      label: "Inventory",
      icon: <Package className="h-3.5 w-3.5 text-muted-foreground" />,
      value: (
        <>
          {stats?.totalInventory ?? 0}{" "}
          <span className="text-[11px] font-normal text-muted-foreground">
            ({stats?.totalProducts ?? 0} products, {stats?.totalServices ?? 0} services)
          </span>
        </>
      ),
      href: "/inventory",
    },
  ];

  const periodRows: { key: string; label: string; value: React.ReactNode; href: string }[] = [
    {
      key: "profit",
      label: "Gross Profit",
      value: formatCurrency(stats?.totalProfit ?? 0),
      href: `/profit-loss${deepLinkQuery}`,
    },
    {
      key: "gross-revenue",
      label: "Gross Revenue",
      value: (
        <>
          {formatCurrency(stats?.grossRevenue ?? stats?.totalRevenue ?? 0)}
          {stats?.returnedRevenue && stats.returnedRevenue > 0 ? (
            <span className="text-[11px] font-normal text-muted-foreground ml-1">
              (−{formatCurrency(stats.returnedRevenue)} refunded)
            </span>
          ) : null}
        </>
      ),
      href: `/profit-loss${deepLinkQuery}`,
    },
  ];

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* ─── Mobile / tablet (<lg): compact space-optimized layout ─── */}
      <div className="lg:hidden space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground leading-tight">
            {greeting}, {firstName}
            {currentStore?.id === "all" && ` · All ${stores.length} branches`}
          </p>
          <h1 className="text-xl font-bold tracking-tight leading-tight">Dashboard</h1>
        </div>
        <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} timezone={currentStore?.timezone} compact />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground">{isToday ? "Sales today" : "Sales (period)"}</p>
          {isLoading ? (
            <Skeleton className="h-6 w-20 mt-1" />
          ) : (
            <p className="text-lg font-bold font-mono tabular-nums mt-0.5 truncate" title={formatCurrency(stats?.totalRevenue ?? 0)}>
              <span className="sm:hidden">{formatCompact(stats?.totalRevenue ?? 0)}</span>
              <span className="hidden sm:inline">{formatCurrency(stats?.totalRevenue ?? 0)}</span>
            </p>
          )}
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {stats?.totalTransactions ?? 0} transaction{(stats?.totalTransactions ?? 0) === 1 ? "" : "s"}
          </p>
        </div>
        <div className="rounded-lg bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground">Avg. sale</p>
          {isLoading ? (
            <Skeleton className="h-6 w-20 mt-1" />
          ) : (
            <p className="text-lg font-bold font-mono tabular-nums mt-0.5 truncate" title={formatCurrency(avgSale)}>
              <span className="sm:hidden">{formatCompact(avgSale)}</span>
              <span className="hidden sm:inline">{formatCurrency(avgSale)}</span>
            </p>
          )}
          <p className="text-[11px] text-muted-foreground mt-0.5">per transaction</p>
        </div>
      </div>

      <div className="flex gap-2">
        <Button asChild data-testid="button-new-sale" className="flex-1">
          <Link href="/sales/new">
            <ShoppingCart className="mr-2 h-4 w-4" />
            New sale
          </Link>
        </Button>
        <Button asChild variant="outline" data-testid="button-add-item">
          <Link href="/inventory/new">
            <Plus className="mr-1.5 h-4 w-4" />
            Item
          </Link>
        </Button>
      </div>

      <GettingStartedChecklist />

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">All-time totals</p>
        <Card>
          <CardContent className="p-0">
            {totalsRows.map((row, i) => (
              <Link
                key={row.key}
                href={row.href}
                className={cn(
                  "flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover-elevate",
                  i < totalsRows.length - 1 && "border-b",
                )}
                data-testid={`row-total-${row.key}`}
              >
                <span className="flex items-center gap-2 font-medium">
                  {row.icon} {row.label}
                </span>
                <span className="flex items-center gap-1 font-mono font-semibold">
                  {isLoading ? <Skeleton className="h-4 w-8" /> : row.value}
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">For selected period</p>
        <Card>
          <CardContent className="p-0">
            {periodRows.map((row, i) => (
              <Link
                key={row.key}
                href={row.href}
                className={cn(
                  "flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover-elevate",
                  i < periodRows.length - 1 && "border-b",
                )}
                data-testid={`row-period-${row.key}`}
              >
                <span className="font-medium">{row.label}</span>
                <span className="flex items-center gap-1 font-mono font-semibold">
                  {isLoading ? <Skeleton className="h-4 w-16" /> : row.value}
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SalesTrendChart 
          storeId={currentStore?.id === "all" ? undefined : currentStore?.id} 
          businessId={currentStore?.id === "all" ? business?.id : undefined}
          storeCurrency={storeCurrency} 
          queryString={queryString} 
        />
        <RevenueByItemChart 
          storeId={currentStore?.id === "all" ? undefined : currentStore?.id} 
          businessId={currentStore?.id === "all" ? business?.id : undefined}
          storeCurrency={storeCurrency} 
          queryString={queryString} 
        />
      </div>

      <RevenueBreakdownChart 
        storeId={currentStore?.id === "all" ? undefined : currentStore?.id} 
        businessId={currentStore?.id === "all" ? business?.id : undefined}
        storeCurrency={storeCurrency} 
        queryString={queryString} 
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
            <CardTitle className="text-base font-medium">Low Stock Alerts</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-muted/50 rounded-md animate-pulse">
                    <div className="h-4 w-32 bg-muted rounded" />
                    <div className="h-5 w-16 bg-muted rounded" />
                  </div>
                ))}
              </div>
            ) : (stats?.lowStockItems?.length ?? 0) > 0 ? (
              <div className="space-y-3">
                {stats?.lowStockItems?.slice(0, 5).map((item) => {
                  const reorderQty = Math.max(10 - item.quantity, 5);
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-3 bg-muted/50 rounded-md"
                      data-testid={`low-stock-item-${item.id.slice(0, 8)}`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{item.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant={item.quantity === 0 ? "destructive" : "secondary"} className="text-xs shrink-0">
                            {item.quantity === 0 ? "Out of Stock" : `${item.quantity} left`}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            Reorder: +{reorderQty} units
                          </span>
                        </div>
                      </div>
                      <Button asChild variant="ghost" size="icon" className="shrink-0 ml-2" data-testid={`button-restock-${item.id.slice(0, 8)}`}>
                        <Link href="/inventory">
                          <Package className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  );
                })}
                {(stats?.lowStockItems?.length ?? 0) > 5 && (
                  <Button asChild variant="outline" size="sm" className="w-full" data-testid="button-view-all-low-stock">
                    <Link href="/inventory">
                      View All {stats?.lowStockItems?.length} Items
                    </Link>
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Package className="h-10 w-10 text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">All items are well stocked</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
            <CardTitle className="text-base font-medium">Top Performers</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {plLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-muted/50 rounded-md animate-pulse">
                    <div className="h-4 w-32 bg-muted rounded" />
                    <div className="h-4 w-20 bg-muted rounded" />
                  </div>
                ))}
              </div>
            ) : (profitLoss?.length ?? 0) > 0 ? (
              <div className="space-y-3">
                {profitLoss
                  ?.sort((a, b) => b.totalRevenue - a.totalRevenue)
                  .slice(0, 5)
                  .map((pl, index) => (
                    <div
                      key={pl.id}
                      className="flex items-center justify-between p-3 bg-muted/50 rounded-md"
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                          {index + 1}
                        </span>
                        <div>
                          <p className="font-medium text-sm">{pl.inventory?.name ?? "Unknown"}</p>
                          <p className="text-xs text-muted-foreground">
                            {pl.totalQuantitySold} sold
                          </p>
                        </div>
                      </div>
                      <p className="font-mono text-sm font-medium">
                        {formatCurrency(pl.totalRevenue)}
                      </p>
                    </div>
                  ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <TrendingUp className="h-10 w-10 text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">No sales data yet</p>
                <Button asChild variant="outline" size="sm" className="mt-3">
                  <Link href="/sales/new">Make your first sale</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg font-medium flex items-center gap-2">
              <Users className="h-4 w-4" /> Top Customers
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topCustomers.length > 0 ? (
              <div className="space-y-4">
                {topCustomers.map((customer: any, index: number) => (
                  <Link
                    key={customer.id}
                    href={appendReturnTo(`/customers/${buildSlug(customer.name, customer.id)}`, location, search)}
                    className="flex items-center justify-between p-3 bg-muted/50 rounded-md hover:bg-muted transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                        {index + 1}
                      </span>
                      <div>
                        <p className="font-medium text-sm">{customer.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {customer.transactionCount} orders
                        </p>
                      </div>
                    </div>
                    <p className="font-mono text-sm font-medium">
                      {formatCurrency(customer.totalSpent)}
                    </p>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Users className="h-10 w-10 text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">No customer data yet</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="hover-elevate">
          <Link href="/customers">
            <CardContent className="flex flex-col items-center justify-center py-6">
              <Users className="h-8 w-8 text-primary mb-3" />
              <p className="font-medium">Manage Customers</p>
              <p className="text-xs text-muted-foreground mt-1">{stats?.totalCustomers ?? 0} records</p>
            </CardContent>
          </Link>
        </Card>
        <Card className="hover-elevate">
          <Link href="/staffs">
            <CardContent className="flex flex-col items-center justify-center py-6">
              <UserCog className="h-8 w-8 text-primary mb-3" />
              <p className="font-medium">Manage Staff</p>
              <p className="text-xs text-muted-foreground mt-1">{stats?.totalStaff ?? 0} employees</p>
            </CardContent>
          </Link>
        </Card>
        <Card className="hover-elevate">
          <Link href="/inventory">
            <CardContent className="flex flex-col items-center justify-center py-6">
              <Package className="h-8 w-8 text-primary mb-3" />
              <p className="font-medium">Manage Inventory</p>
              <p className="text-xs text-muted-foreground mt-1">{stats?.totalInventory ?? 0} items</p>
            </CardContent>
          </Link>
        </Card>
        <Card className="hover-elevate">
          <Link href={`/profit-loss${deepLinkQuery}`}>
            <CardContent className="flex flex-col items-center justify-center py-6">
              <TrendingUp className="h-8 w-8 text-primary mb-3" />
              <p className="font-medium">View Reports</p>
              <p className="text-xs text-muted-foreground mt-1">Profit & Loss</p>
            </CardContent>
          </Link>
        </Card>
      </div>
      </div>
      {/* ─── End mobile / tablet layout ─── */}

      {/* ─── Desktop (lg+): dense analytics layout ─── */}
      <div className="hidden lg:block space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {currentStore?.id === "all" ? `All ${stores.length} branches` : currentStore?.name}
              {dateRangeLabel && ` · ${dateRangeLabel}`}
              {prevRangeLabel && ` vs ${prevRangeLabel}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-md border p-0.5">
              {([
                ["today", "Today"],
                ["7d", "7d"],
                ["30d", "30d"],
                ["month", "Month"],
                ["year", "Year"],
                ["all", "All time"],
              ] as [DatePreset, string][]).map(([preset, label]) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => applyDatePreset(preset)}
                  className={cn(
                    "px-3 py-1.5 text-sm rounded font-medium transition-colors whitespace-nowrap",
                    datePreset === preset ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                  data-testid={`button-preset-${preset}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn("gap-1.5", datePreset === "custom" ? "border-primary text-primary" : "text-muted-foreground")}
                  data-testid="button-custom-range"
                >
                  <CalendarIcon className="h-4 w-4" />
                  {datePreset === "custom" && dateRange.from && dateRange.to
                    ? `${format(dateRange.from, "MMM d")} - ${format(dateRange.to, "MMM d")}`
                    : "Custom"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="range"
                  selected={{ from: dateRange.from, to: dateRange.to }}
                  onSelect={(range) => {
                    if (!range?.from) return;
                    setDatePreset("custom");
                    setDateRange({ from: startOfDay(range.from), to: range.to ? endOfDay(range.to) : endOfDay(range.from) });
                  }}
                  numberOfMonths={2}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
            <Button asChild data-testid="button-new-sale-desktop">
              <Link href="/sales/new">
                <ShoppingCart className="mr-2 h-4 w-4" />
                New sale
              </Link>
            </Button>
          </div>
        </div>

        {/* 4 headline metrics with period-over-period deltas */}
        <div className="grid grid-cols-4 gap-4">
          {[
            {
              key: "revenue",
              title: "Net revenue",
              value: formatCurrency(stats?.totalRevenue ?? 0),
              change: revenueChangePct,
              sub: (stats?.returnedRevenue ?? 0) > 0 ? `${formatCurrency(stats!.returnedRevenue!)} refunded` : undefined,
              href: `/profit-loss${deepLinkQuery}`,
            },
            {
              key: "profit",
              title: "Gross profit",
              value: formatCurrency(stats?.totalProfit ?? 0),
              change: profitChangePct,
              sub: `${grossMarginPct}% margin`,
              href: `/profit-loss${deepLinkQuery}`,
            },
            {
              key: "transactions",
              title: "Transactions",
              value: String(stats?.totalTransactions ?? 0),
              change: transactionsChangePct,
              sub: `${stats?.uniqueCustomersInPeriod ?? 0} customer${(stats?.uniqueCustomersInPeriod ?? 0) === 1 ? "" : "s"}`,
              href: `/transactions${deepLinkQuery}`,
            },
            {
              key: "avg-sale",
              title: "Avg. sale",
              value: formatCurrency(avgSale),
              change: avgSaleChangePct,
              sub: "vs last period",
              href: `/transactions${deepLinkQuery}`,
            },
          ].map((tile) => (
            <Link key={tile.key} href={tile.href} className="block">
              <Card className="hover-elevate h-full">
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">{tile.title}</p>
                  {isLoading ? (
                    <Skeleton className="h-8 w-28 mt-1.5" />
                  ) : (
                    <p className="text-2xl font-bold font-mono tabular-nums mt-1">{tile.value}</p>
                  )}
                  <div className="flex items-center gap-1.5 mt-1.5 text-xs">
                    {tile.change !== undefined && (
                      <span className={cn("flex items-center gap-0.5 font-medium", tile.change >= 0 ? "text-emerald-600" : "text-red-600")}>
                        {tile.change >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                        {Math.abs(tile.change)}%
                      </span>
                    )}
                    {tile.sub && <span className="text-muted-foreground">{tile.change !== undefined ? `· ${tile.sub}` : tile.sub}</span>}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        {/* Sales trend + revenue mix */}
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2">
            <SalesTrendChart
              storeId={currentStore?.id === "all" ? undefined : currentStore?.id}
              businessId={currentStore?.id === "all" ? business?.id : undefined}
              storeCurrency={storeCurrency}
              queryString={queryString}
              periodLabel={presetLabel[datePreset]}
            />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">Revenue mix</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="h-2.5 w-full rounded-full overflow-hidden bg-muted flex">
                <div className="h-full bg-primary" style={{ width: `${servicesSharePct}%` }} />
                <div className="h-full bg-muted-foreground/30" style={{ width: `${productsSharePct}%` }} />
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-primary inline-block" /> Services</span>
                  <span className="font-mono">
                    {formatCurrency(stats?.revenueMix?.services ?? 0)} <span className="text-muted-foreground text-xs">{servicesSharePct}%</span>
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-muted-foreground/30 inline-block" /> Products</span>
                  <span className="font-mono">
                    {formatCurrency(stats?.revenueMix?.products ?? 0)} <span className="text-muted-foreground text-xs">{productsSharePct}%</span>
                  </span>
                </div>
              </div>

              <div className="pt-2 border-t space-y-2">
                <p className="text-base font-semibold">Business size</p>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2"><Users className="h-3.5 w-3.5 text-muted-foreground" /> Customers</span>
                  <span className="font-mono">{stats?.totalCustomers ?? 0}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2"><UserCog className="h-3.5 w-3.5 text-muted-foreground" /> Staff</span>
                  <span className="font-mono">{stats?.totalStaff ?? 0}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2"><Package className="h-3.5 w-3.5 text-muted-foreground" /> Catalogue</span>
                  <span className="font-mono">
                    {stats?.totalInventory ?? 0}{" "}
                    <span className="text-muted-foreground text-xs">
                      ({stats?.totalProducts ?? 0} products, {stats?.totalServices ?? 0} services)
                    </span>
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Stock alerts / Top items / Top customers */}
        <div className="grid grid-cols-3 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" /> Stock alerts
              </CardTitle>
              <Link href="/inventory" className="text-xs text-primary font-medium hover:underline">
                All {stats?.lowStockItems?.length ?? 0}
              </Link>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="destructive" className="text-xs">{stats?.outOfStockCount ?? 0} out</Badge>
                <Badge variant="secondary" className="text-xs">{stats?.lowStockCount ?? 0} low</Badge>
              </div>
              {isLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : stockAlertItems.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">All items are well stocked</p>
              ) : (
                <div className="space-y-1">
                  {stockAlertItems.slice(0, 4).map((item) => {
                    const threshold = item.reorderPoint != null ? item.reorderPoint : (stats?.lowStockThreshold ?? 5);
                    return (
                      <div key={item.id} className="flex items-center justify-between gap-2 py-1.5 border-b last:border-0">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{item.name}</p>
                          <p className="text-xs text-muted-foreground">Reorder {threshold}</p>
                        </div>
                        <Badge variant={item.quantity === 0 ? "destructive" : "secondary"} className="text-xs shrink-0">
                          {item.quantity === 0 ? "Out" : `${item.quantity} left`}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
              <Button asChild variant="outline" size="sm" className="w-full">
                <Link href="/inventory?view=low-stock">
                  <PackagePlus className="mr-2 h-3.5 w-3.5" />
                  Restock inventory
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
              <CardTitle className="text-base font-semibold">Top items</CardTitle>
              <Link href={`/profit-loss${deepLinkQuery}`} className="text-xs text-primary font-medium hover:underline">
                Report
              </Link>
            </CardHeader>
            <CardContent className="space-y-3">
              {plLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : topItemsSorted.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No sales data yet</p>
              ) : (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-muted-foreground pb-1.5 border-b">
                    <span>Item</span>
                    <span>Sold · Revenue</span>
                  </div>
                  {topItemsSorted.map((pl) => (
                    <div key={pl.id} className="flex items-center justify-between gap-2 py-1.5 border-b last:border-0">
                      <span className="text-sm truncate">{pl.inventory?.name ?? "Unknown"}</span>
                      <span className="text-sm font-mono shrink-0">
                        {pl.totalQuantitySold} · {formatCurrency(pl.totalRevenue)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <Button asChild variant="outline" size="sm" className="w-full">
                <Link href="/sales/new">
                  <ShoppingCart className="mr-2 h-3.5 w-3.5" />
                  New sale
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
              <CardTitle className="text-base font-semibold">Top customers</CardTitle>
              <Link href="/customers" className="text-xs text-primary font-medium hover:underline">
                All customers
              </Link>
            </CardHeader>
            <CardContent className="space-y-3">
              {topCustomers.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No customer data yet</p>
              ) : (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-muted-foreground pb-1.5 border-b">
                    <span>Customer</span>
                    <span>Share of revenue</span>
                  </div>
                  {topCustomers.slice(0, 5).map((customer: any) => {
                    const share = topCustomersTotalSpend > 0 ? Math.round((customer.totalSpent / topCustomersTotalSpend) * 100) : 0;
                    return (
                      <Link
                        key={customer.id}
                        href={appendReturnTo(`/customers/${buildSlug(customer.name, customer.id)}`, location, search)}
                        className="block py-1.5 border-b last:border-0 hover-elevate -mx-2 px-2 rounded"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm truncate">
                            {customer.name} <span className="text-xs text-muted-foreground">{customer.transactionCount} orders</span>
                          </span>
                          <span className="text-sm font-mono shrink-0">{formatCurrency(customer.totalSpent)}</span>
                        </div>
                        <div className="h-1 w-full rounded-full bg-muted mt-1 overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${share}%` }} />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
              <Button asChild variant="outline" size="sm" className="w-full">
                <Link href="/customers/new">
                  <UserPlus className="mr-2 h-3.5 w-3.5" />
                  Add customer
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
      {/* ─── End desktop layout ─── */}
    </div>
  );
}
