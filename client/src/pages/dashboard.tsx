import { useQuery } from "@tanstack/react-query";
import { STALE_TIMES } from "@/lib/queryClient";
import { Users, UserCog, Package, Receipt, TrendingUp, Coins, ShoppingCart, AlertTriangle, AlertCircle, Building2 } from "lucide-react";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Link } from "wouter";
import { SalesTrendChart, RevenueByItemChart, RevenueBreakdownChart } from "@/components/charts";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency-utils";
import type { Inventory, ProfitLossWithInventory } from "@shared/schema";
import { DateRangeFilter, type DateRange } from "@/components/date-range-filter";
import { useEffect, useState } from "react";
import { format, startOfDay, endOfDay } from "date-fns";
import { useAuth } from "@/hooks/useAuth";
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

  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const saved = sessionStorage.getItem("dashboard_date_range");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.from && parsed.to) {
          return { from: new Date(parsed.from), to: new Date(parsed.to) };
        }
      } catch (e) {
        // ignore parsing errors
      }
    }
    return { from: startOfDay(new Date()), to: endOfDay(new Date()) };
  });

  useEffect(() => {
    sessionStorage.setItem("dashboard_date_range", JSON.stringify(dateRange));
  }, [dateRange]);

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

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description={currentStore?.id === "all" ? `Consolidated overview for all ${stores.length} branches` : `Overview for ${currentStore?.name}`}
        actions={
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
            <DateRangeFilter dateRange={dateRange} onDateRangeChange={setDateRange} timezone={currentStore?.timezone} />
            <Button asChild data-testid="button-new-sale" className="w-full sm:w-auto">
              <Link href="/sales/new">
                <ShoppingCart className="mr-2 h-4 w-4" />
                New Sale
              </Link>
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total Customers"
          value={stats?.totalCustomers ?? 0}
          icon={<Users className="h-4 w-4" />}
          isLoading={isLoading}
          href="/customers"
        />
        <MetricCard
          title="Total Staff"
          value={stats?.totalStaff ?? 0}
          icon={<UserCog className="h-4 w-4" />}
          isLoading={isLoading}
          href="/staff"
        />
        <MetricCard
          title="Inventory Items"
          value={stats?.totalInventory ?? 0}
          description={`${stats?.totalProducts ?? 0} products, ${stats?.totalServices ?? 0} services`}
          icon={<Package className="h-4 w-4" />}
          isLoading={isLoading}
          href="/inventory"
        />
        <MetricCard
          title="Total Transactions"
          value={stats?.totalTransactions ?? 0}
          icon={<Receipt className="h-4 w-4" />}
          isLoading={isLoading}
          href={`/transactions${deepLinkQuery}`}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <MetricCard
          title="Actual Revenue (Net)"
          value={formatCurrency(stats?.totalRevenue ?? 0)}
          description={stats?.returnedRevenue && stats.returnedRevenue > 0 ? `Gross: ${formatCurrency(stats.grossRevenue ?? 0)} (Refunded: ${formatCurrency(stats.returnedRevenue)})` : "Net revenue after returns"}
          icon={<Coins className="h-4 w-4" />}
          trend="up"
          trendValue="All time"
          isLoading={isLoading}
          href={`/profit-loss${deepLinkQuery}`}
        />
        <MetricCard
          title="Gross Profit"
          value={formatCurrency(stats?.totalProfit ?? 0)}
          icon={<TrendingUp className="h-4 w-4" />}
          trend={(stats?.totalProfit ?? 0) >= 0 ? "up" : "down"}
          trendValue="All time"
          isLoading={isLoading}
          href={`/profit-loss${deepLinkQuery}`}
        />
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
                  <div
                    key={customer.id}
                    className="flex items-center justify-between p-3 bg-muted/50 rounded-md"
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
                  </div>
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
          <Link href="/staff">
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
