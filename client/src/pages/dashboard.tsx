import { useQuery } from "@tanstack/react-query";
import { STALE_TIMES } from "@/lib/queryClient";
import { Users, UserCog, Package, Receipt, TrendingUp, Coins, ShoppingCart, AlertTriangle, Plus, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { format, startOfDay, endOfDay, isSameDay } from "date-fns";
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
  totalRevenue: number;
  grossRevenue?: number;
  returnedRevenue?: number;
  totalProfit: number;
  lowStockItems: Inventory[];
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

  const queryParams = new URLSearchParams();
  if (dateRange.from) queryParams.set("from", format(dateRange.from, "yyyy-MM-dd"));
  if (dateRange.to) queryParams.set("to", format(dateRange.to, "yyyy-MM-dd"));
  const queryString = queryParams.toString() ? `?${queryParams.toString()}` : "";

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
    <div className="space-y-4">
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
  );
}
