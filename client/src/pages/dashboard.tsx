import { useQuery } from "@tanstack/react-query";
import { Users, UserCog, Package, Receipt, TrendingUp, DollarSign, ShoppingCart, AlertTriangle } from "lucide-react";
import { MetricCard } from "@/components/metric-card";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import type { Customer, Staff, Inventory, Transaction, ProfitLossWithInventory } from "@shared/schema";

interface DashboardStats {
  totalCustomers: number;
  totalStaff: number;
  totalInventory: number;
  totalProducts: number;
  totalServices: number;
  totalTransactions: number;
  totalRevenue: number;
  totalProfit: number;
  lowStockItems: Inventory[];
  recentTransactions: Transaction[];
}

export default function Dashboard() {
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
  });

  const { data: profitLoss, isLoading: plLoading } = useQuery<ProfitLossWithInventory[]>({
    queryKey: ["/api/profit-loss"],
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description="Overview of your business performance"
        actions={
          <Button asChild data-testid="button-new-sale">
            <Link href="/sales/new">
              <ShoppingCart className="mr-2 h-4 w-4" />
              New Sale
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total Customers"
          value={stats?.totalCustomers ?? 0}
          icon={<Users className="h-4 w-4" />}
          isLoading={isLoading}
        />
        <MetricCard
          title="Total Staff"
          value={stats?.totalStaff ?? 0}
          icon={<UserCog className="h-4 w-4" />}
          isLoading={isLoading}
        />
        <MetricCard
          title="Inventory Items"
          value={stats?.totalInventory ?? 0}
          description={`${stats?.totalProducts ?? 0} products, ${stats?.totalServices ?? 0} services`}
          icon={<Package className="h-4 w-4" />}
          isLoading={isLoading}
        />
        <MetricCard
          title="Total Transactions"
          value={stats?.totalTransactions ?? 0}
          icon={<Receipt className="h-4 w-4" />}
          isLoading={isLoading}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <MetricCard
          title="Total Revenue"
          value={formatCurrency(stats?.totalRevenue ?? 0)}
          icon={<DollarSign className="h-4 w-4" />}
          trend="up"
          trendValue="All time"
          isLoading={isLoading}
        />
        <MetricCard
          title="Net Profit"
          value={formatCurrency(stats?.totalProfit ?? 0)}
          icon={<TrendingUp className="h-4 w-4" />}
          trend={(stats?.totalProfit ?? 0) >= 0 ? "up" : "down"}
          trendValue="All time"
          isLoading={isLoading}
        />
      </div>

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
                {stats?.lowStockItems?.slice(0, 5).map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-3 bg-muted/50 rounded-md"
                  >
                    <div>
                      <p className="font-medium text-sm">{item.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(item.sellingPrice)}
                      </p>
                    </div>
                    <Badge variant={item.quantity === 0 ? "destructive" : "secondary"} className="text-xs">
                      {item.quantity} left
                    </Badge>
                  </div>
                ))}
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
          <Link href="/profit-loss">
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
