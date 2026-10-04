import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart,
  Area, XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency as formatCurrencyUtil, getCurrencySymbol } from "@/lib/currency-utils";

interface SalesTrendData {
  date: string;
  revenue: number;
  transactions: number;
}

interface ChartProps {
  storeId?: string;
  businessId?: string;
  storeCurrency?: string;
  queryString?: string;
  /** Overrides the "(Last 30 Days)" suffix to reflect an actual applied filter, e.g. "This Month". */
  periodLabel?: string;
  /** Optional content shown right-aligned in the header next to the title, e.g. a compact revenue-mix summary. */
  headerRight?: React.ReactNode;
}

function createFormatCurrency(currencyCode: string = "NGN") {
  return (value: number) => formatCurrencyUtil(value, currencyCode);
}

function formatShortDate(dateStr: string) {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

export function SalesTrendChart({ storeId, businessId, storeCurrency = "NGN", queryString = "", periodLabel = "Last 30 Days", headerRight }: ChartProps) {
  const formatCurrency = createFormatCurrency(storeCurrency);
  const { data: trends = [], isLoading } = useQuery<SalesTrendData[]>({
    queryKey: ["/api/charts/sales-trends", storeId, businessId, queryString],
    queryFn: async () => {
      const param = businessId ? `businessId=${businessId}` : `storeId=${storeId}`;
      const res = await fetch(`/api/charts/sales-trends?${param}${queryString ? '&' + queryString.substring(1) : ''}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!storeId || !!businessId,
  });

  const chartData = useMemo(() => {
    return trends.map((item) => ({
      ...item,
      shortDate: formatShortDate(item.date),
    }));
  }, [trends]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Sales Trends ({periodLabel})</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[250px] w-full" />
        </CardContent>
      </Card>
    );
  }

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Sales Trends ({periodLabel})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[250px] items-center justify-center text-muted-foreground">
            No sales data available
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className={headerRight ? "flex flex-row items-center justify-between gap-4 space-y-0" : undefined}>
        <CardTitle className="text-base font-semibold">Sales Trends ({periodLabel})</CardTitle>
        {headerRight}
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="shortDate"
              tick={{ fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              className="text-muted-foreground"
            />
            <YAxis
              tick={{ fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `${getCurrencySymbol(storeCurrency)}${value}`}
              className="text-muted-foreground"
            />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="rounded-lg border bg-background p-3 shadow-sm">
                      <div className="grid gap-2">
                        <p className="font-medium">{payload[0].payload.date}</p>
                        <p className="text-sm text-muted-foreground">
                          Revenue: <span className="font-medium">{formatCurrency(payload[0].payload.revenue)}</span>
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Transactions: <span className="font-medium">{payload[0].payload.transactions}</span>
                        </p>
                      </div>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="hsl(var(--chart-1))"
              strokeWidth={2}
              fill="url(#colorRevenue)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

