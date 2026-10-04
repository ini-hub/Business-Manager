import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, Users, Clock, Percent, ArrowUpRight, Award, ShoppingBag, Wrench, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { MetricGrid } from "@/components/metric-grid";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { useStore } from "@/lib/store-context";
import { useAuth } from "@/hooks/useAuth";
import { useHasPermission } from "@/lib/permissions";
import type { Customer } from "@shared/schema";
import {
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  BarChart,
  Bar
} from "recharts";

export default function CustomerInsights() {
  const { currentStore, stores } = useStore();
  const { user } = useAuth();
  // Same rule as the customer list: spend and visit history are money figures.
  const { hasPermission: hasCustomersModule, isLoading: isLoadingPermission } = useHasPermission("Customers");
  const canSeeSpend = user?.role === "owner" || user?.role === "manager" || (user?.role !== "staff" && hasCustomersModule);

  const { data: customers = [], isLoading } = useQuery<Customer[]>({
    queryKey: ["/api/customers", currentStore?.id, stores.map(s => s.id).join(",")],
    queryFn: async () => {
      if (currentStore?.id === "all" && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const res = await fetch(`/api/customers?storeId=${s.id}`);
              if (!res.ok) return [];
              const list = await res.json() as Customer[];
              return list.map(item => ({ ...item, storeName: s.name }));
            } catch {
              return [];
            }
          })
        );
        const mergedMap = new Map<string, Customer & { storeName?: string }>();
        for (const list of responses) {
          for (const item of list) {
            const key = item.id;
            const existing = mergedMap.get(key);
            if (existing) {
              if (item.storeName && !existing.storeName?.includes(item.storeName)) {
                existing.storeName = `${existing.storeName}, ${item.storeName}`;
              }
            } else {
              mergedMap.set(key, { ...item });
            }
          }
        }
        return Array.from(mergedMap.values());
      }
      const res = await fetch(`/api/customers?storeId=${currentStore?.id}`);
      if (!res.ok) throw new Error("Failed to fetch customers");
      return res.json();
    },
    enabled: currentStore?.id === "all" ? stores.length > 0 : !!currentStore?.id,
  });

  // list never has to download the full transaction history.
  type CustomerSummary = { customerId: string; totalSpend: number; firstVisit: string; lastVisit: string };
  const { data: customerSummaries = [], isLoading: isLoadingSummaries } = useQuery<CustomerSummary[]>({
    queryKey: ["/api/customers/summary", currentStore?.id],
    queryFn: async () => {
      const res = await fetch(`/api/customers/summary?storeId=${currentStore?.id}`);
      if (!res.ok) throw new Error("Failed to fetch customer activity");
      return res.json();
    },
    enabled: !!currentStore?.id && canSeeSpend,
    staleTime: 0,
  });

  const { data: transactionsData = [], isPending: isPendingTxs } = useQuery<any[]>({
    queryKey: ["/api/transactions", currentStore?.id, stores.map(s => s.id).join(",")],
    queryFn: async () => {
      if (currentStore?.id === "all" && stores.length > 0) {
        const responses = await Promise.all(
          stores.map(async (s) => {
            try {
              const res = await fetch(`/api/transactions?storeId=${s.id}`);
              if (!res.ok) return [];
              const list = await res.json() as any[];
              return list.map(item => ({ ...item, storeName: s.name }));
            } catch {
              return [];
            }
          })
        );
        return responses.flat().sort((a, b) => new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime());
      }
      const res = await fetch(`/api/transactions?storeId=${currentStore?.id}`);
      if (!res.ok) throw new Error("Failed to fetch transactions");
      return res.json();
    },
    enabled: canSeeSpend && (currentStore?.id === "all" ? stores.length > 0 : !!currentStore?.id),
  });

  // Calculate Customer Analytics Metrics
  const validTxs = useMemo(
    () => transactionsData.filter((tx: any) => tx.checkout && !tx.checkout.isVoided),
    [transactionsData]
  );

  const customerVisits = useMemo(() => {
    const visitsMap = new Map<string, { checkoutId: string, customerId: string, date: Date, items: { name: string, type: string }[] }>();
    validTxs.forEach((tx: any) => {
      if (!tx.checkoutId || !tx.customerId) return;
      const date = new Date(tx.transactionDate || tx.checkout?.createdAt);
      if (!visitsMap.has(tx.checkoutId)) {
        visitsMap.set(tx.checkoutId, {
          checkoutId: tx.checkoutId,
          customerId: tx.customerId,
          date,
          items: []
        });
      }
      if (tx.inventory) {
        visitsMap.get(tx.checkoutId)!.items.push({
          name: tx.inventory.name,
          type: tx.inventory.type
        });
      }
    });

    const visits = Array.from(visitsMap.values()).sort((a, b) => a.date.getTime() - b.date.getTime());

    const map = new Map<string, typeof visits>();
    visits.forEach(v => {
      if (!map.has(v.customerId)) {
        map.set(v.customerId, []);
      }
      map.get(v.customerId)!.push(v);
    });
    return map;
  }, [validTxs]);

  const totalCustomersCount = customerVisits.size;
  const returningCustomersCount = Array.from(customerVisits.values()).filter(vList => vList.length >= 2).length;
  const retentionRate = totalCustomersCount > 0 ? Math.round((returningCustomersCount / totalCustomersCount) * 100) : 0;

  let totalGapsMs = 0;
  let gapCount = 0;
  customerVisits.forEach((vList) => {
    if (vList.length < 2) return;
    for (let i = 1; i < vList.length; i++) {
      const gap = vList[i].date.getTime() - vList[i - 1].date.getTime();
      totalGapsMs += gap;
      gapCount++;
    }
  });
  const avgReturnDays = gapCount > 0 ? Math.round(totalGapsMs / gapCount / (1000 * 60 * 60 * 24)) : 0;

  const now = new Date();
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

  let newThisMonth = 0;
  let newLastMonth = 0;

  customerSummaries.forEach((c) => {
    const firstVisitDate = new Date(c.firstVisit);
    if (firstVisitDate >= startOfThisMonth) {
      newThisMonth++;
    } else if (firstVisitDate >= startOfLastMonth && firstVisitDate <= endOfLastMonth) {
      newLastMonth++;
    }
  });

  const acquisitionPercentChange = newLastMonth > 0 ? Math.round(((newThisMonth - newLastMonth) / newLastMonth) * 100) : 0;

  const acquisitionDrivers = new Map<string, { name: string, type: string, count: number }>();
  const retentionDrivers = new Map<string, { name: string, type: string, count: number }>();

  customerVisits.forEach(vList => {
    const firstVisit = vList[0];
    firstVisit.items.forEach(item => {
      const key = `${item.name}-${item.type}`;
      if (!acquisitionDrivers.has(key)) {
        acquisitionDrivers.set(key, { name: item.name, type: item.type, count: 0 });
      }
      acquisitionDrivers.get(key)!.count++;
    });

    for (let i = 1; i < vList.length; i++) {
      vList[i].items.forEach(item => {
        const key = `${item.name}-${item.type}`;
        if (!retentionDrivers.has(key)) {
          retentionDrivers.set(key, { name: item.name, type: item.type, count: 0 });
        }
        retentionDrivers.get(key)!.count++;
      });
    }
  });

  const topAcquisition = Array.from(acquisitionDrivers.values()).sort((a, b) => b.count - a.count).slice(0, 5);
  const topRetention = Array.from(retentionDrivers.values()).sort((a, b) => b.count - a.count).slice(0, 5);

  const monthlyTrendsMap = new Map<string, { monthLabel: string, newCount: number, returningCount: number, sortKey: number }>();
  
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleDateString('default', { month: 'short', year: '2-digit' });
    const sortKey = d.getFullYear() * 12 + d.getMonth();
    monthlyTrendsMap.set(label, { monthLabel: label, newCount: 0, returningCount: 0, sortKey });
  }

  customerVisits.forEach(vList => {
    const firstMonthLabel = vList[0].date.toLocaleDateString('default', { month: 'short', year: '2-digit' });
    if (monthlyTrendsMap.has(firstMonthLabel)) {
      monthlyTrendsMap.get(firstMonthLabel)!.newCount++;
    }

    for (let i = 1; i < vList.length; i++) {
      const monthLabel = vList[i].date.toLocaleDateString('default', { month: 'short', year: '2-digit' });
      if (monthlyTrendsMap.has(monthLabel)) {
        monthlyTrendsMap.get(monthLabel)!.returningCount++;
      }
    }
  });

  const trendData = Array.from(monthlyTrendsMap.values()).sort((a, b) => a.sortKey - b.sortKey);

  let topLoyaltyCustomerName = "-";
  let topLoyaltyVisitCount = 0;
  customerVisits.forEach((vList, custId) => {
    if (vList.length > topLoyaltyVisitCount) {
      topLoyaltyVisitCount = vList.length;
      const found = customers.find(c => c.id === custId);
      if (found) {
        topLoyaltyCustomerName = found.name;
      }
    }
  });

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader title="Customer Insights" description="Acquisition, retention and visit patterns" />
        <StoreRequiredAlert title="Store Required for Customer Insights" />
      </div>
    );
  }

  if (!isLoadingPermission && !canSeeSpend) {
    return (
      <div className="space-y-6">
        <PageHeader title="Customer Insights" description="Acquisition, retention and visit patterns" />
        <p className="text-sm text-muted-foreground">You don't have access to customer spend and visit analytics.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customer Insights"
        description="Acquisition, retention and visit patterns"
        compact
        actions={
          <Button variant="outline" asChild data-testid="button-back-to-customers">
            <Link href="/customers">
              <ArrowLeft className="h-4 w-4 lg:mr-2" />
              <span className="hidden lg:inline">Customers</span>
            </Link>
          </Button>
        }
      />
      <div className="space-y-6">
          {isLoading || isPendingTxs || isLoadingSummaries ? (
            <MetricGrid>
              {[...Array(4)].map((_, i) => (
                <MetricCard key={i} title="" value="" isLoading className="border-primary/10" />
              ))}
            </MetricGrid>
          ) : (
            <>
              {/* Key Indicators Row */}
              <MetricGrid>
                <MetricCard
                  title="New Customers (This Month)"
                  value={newThisMonth}
                  icon={<Users className="h-4 w-4 text-indigo-500" />}
                  trend={acquisitionPercentChange >= 0 ? "up" : "down"}
                  trendValue={`${acquisitionPercentChange >= 0 ? "+" : ""}${acquisitionPercentChange}%`}
                  description="vs last month"
                  className="border-primary/10 hover:border-primary/20"
                />
                <MetricCard
                  title="Returning Customer Rate"
                  value={`${retentionRate}%`}
                  icon={<Percent className="h-4 w-4 text-emerald-500" />}
                  description={`${returningCustomersCount} out of ${totalCustomersCount} active profiles`}
                  className="border-primary/10 hover:border-primary/20"
                />
                <MetricCard
                  title="Avg. Days to Return"
                  value={`${avgReturnDays} days`}
                  icon={<Clock className="h-4 w-4 text-cyan-500" />}
                  description="Typical gap between checkouts for regulars"
                  className="border-primary/10 hover:border-primary/20"
                />
                <MetricCard
                  title="Top Loyalty Customer"
                  value={topLoyaltyCustomerName}
                  valueClassName="font-sans text-base sm:text-lg truncate"
                  icon={<Award className="h-4 w-4 text-amber-500" />}
                  description={`Completed ${topLoyaltyVisitCount} visits overall`}
                  className="border-primary/10 hover:border-primary/20"
                />
              </MetricGrid>

              {/* Trend Chart */}
              <Card className="border-primary/10 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-sm font-semibold flex items-center justify-between">
                    <span>Acquisition vs Retention Over Time</span>
                    <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">Last 6 Months</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[280px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={trendData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted/40" />
                        <XAxis
                          dataKey="monthLabel"
                          tickLine={false}
                          axisLine={false}
                          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                        />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                        />
                        <Tooltip
                          cursor={{ fill: "hsl(var(--muted)/0.15)" }}
                          content={({ active, payload, label }) => {
                            if (active && payload && payload.length) {
                              return (
                                <div className="bg-background/95 backdrop-blur-md border border-border/80 p-3 rounded-lg shadow-xl text-xs space-y-1.5 font-sans min-w-[150px]">
                                  <p className="font-semibold text-foreground border-b border-border/60 pb-1 mb-1">{label}</p>
                                  {payload.map((item: any, idx: number) => (
                                    <p key={idx} className="flex justify-between gap-4 font-medium" style={{ color: item.color }}>
                                      <span>{item.name}:</span>
                                      <span className="font-mono font-bold">{item.value} visits</span>
                                    </p>
                                  ))}
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="newCount" name="New Customers" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={25} />
                        <Bar dataKey="returningCount" name="Returning Customers" fill="#10b981" radius={[4, 4, 0, 0]} barSize={25} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Drivers Breakdown */}
              <div className="grid gap-6 md:grid-cols-2">
                {/* Acquisition Drivers */}
                <Card className="border-primary/10 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <ArrowUpRight className="h-4 w-4 text-indigo-500" />
                      Top Acquisition Drivers
                    </CardTitle>
                    <p className="text-[11px] text-muted-foreground">What services or products bring in customers for their very first checkout</p>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-2">
                    {topAcquisition.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic text-center py-6">No acquisition statistics available.</p>
                    ) : (
                      topAcquisition.map((item, idx) => {
                        const maxVal = topAcquisition[0]?.count || 1;
                        const percentage = Math.round((item.count / maxVal) * 100);
                        return (
                          <div key={idx} className="space-y-1.5">
                            <div className="flex justify-between text-xs font-medium">
                              <span className="truncate flex items-center gap-1.5">
                                {item.type === "service" ? (
                                  <Wrench className="h-3.5 w-3.5 text-indigo-400" />
                                ) : (
                                  <ShoppingBag className="h-3.5 w-3.5 text-amber-400" />
                                )}
                                {item.name}
                              </span>
                              <span className="text-muted-foreground">{item.count} checkouts</span>
                            </div>
                            <div className="w-full bg-indigo-50 dark:bg-muted/40 rounded-full h-1.5 overflow-hidden">
                              <div className="bg-indigo-600 h-full rounded-full transition-all" style={{ width: `${percentage}%` }} />
                            </div>
                          </div>
                        );
                      })
                    )}
                  </CardContent>
                </Card>

                {/* Retention Drivers */}
                <Card className="border-primary/10 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <RotateCcw className="h-4 w-4 text-emerald-500" />
                      Top Retention Drivers
                    </CardTitle>
                    <p className="text-[11px] text-muted-foreground">What services or products keep customers returning for subsequent checkouts</p>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-2">
                    {topRetention.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic text-center py-6">No retention statistics available.</p>
                    ) : (
                      topRetention.map((item, idx) => {
                        const maxVal = topRetention[0]?.count || 1;
                        const percentage = Math.round((item.count / maxVal) * 100);
                        return (
                          <div key={idx} className="space-y-1.5">
                            <div className="flex justify-between text-xs font-medium">
                              <span className="truncate flex items-center gap-1.5">
                                {item.type === "service" ? (
                                  <Wrench className="h-3.5 w-3.5 text-emerald-400" />
                                ) : (
                                  <ShoppingBag className="h-3.5 w-3.5 text-amber-400" />
                                )}
                                {item.name}
                              </span>
                              <span className="text-muted-foreground">{item.count} return visits</span>
                            </div>
                            <div className="w-full bg-emerald-50 dark:bg-muted/40 rounded-full h-1.5 overflow-hidden">
                              <div className="bg-emerald-600 h-full rounded-full transition-all" style={{ width: `${percentage}%` }} />
                            </div>
                          </div>
                        );
                      })
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
      </div>
    </div>
  );
}
