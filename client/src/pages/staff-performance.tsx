import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, TrendingUp, TrendingDown, Calendar, ShoppingBag, Wrench, BarChart3, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { ExportToolbar } from "@/components/export-toolbar";
import { useStore } from "@/lib/store-context";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency-utils";
import { DateRangeFilter, type DateRange } from "@/components/date-range-filter";
import { startOfMonth, startOfDay, endOfDay, format } from "date-fns";
import { Link } from "wouter";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend
} from "recharts";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";

const CustomTooltip = ({ active, payload, label, selectedMetric, formatCurrency }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-background/95 backdrop-blur-md border border-border/80 p-3 rounded-lg shadow-xl text-xs space-y-1.5 font-sans min-w-[150px]">
        <p className="font-semibold text-foreground border-b border-border/60 pb-1 mb-1">{label}</p>
        {payload.map((item: any, idx: number) => {
          let val = item.value;
          if (selectedMetric === "revenue" || selectedMetric === "performance") {
            val = formatCurrency(val);
          } else if (selectedMetric === "attendance") {
            val = `${val} days`;
          } else if (selectedMetric === "services") {
            val = `${val} completed`;
          } else if (selectedMetric === "products") {
            val = `${val} sold`;
          }
          return (
            <p key={idx} className="flex justify-between gap-4 font-medium" style={{ color: item.color }}>
              <span>{item.name}:</span>
              <span className="font-mono font-bold">{val}</span>
            </p>
          );
        })}
      </div>
    );
  }
  return null;
};

export default function StaffPerformancePage() {
  const { currentStore } = useStore();
  const storeCurrency = currentStore?.currency || "NGN";

  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const params = new URLSearchParams(window.location.search);
    const startDateParam = params.get("startDate");
    const endDateParam = params.get("endDate");
    if (startDateParam && endDateParam) {
      return {
        from: startOfDay(new Date(startDateParam)),
        to: endOfDay(new Date(endDateParam))
      };
    }
    return {
      from: startOfMonth(new Date()),
      to: endOfDay(new Date())
    };
  });

  const { data: performanceData = [], isLoading } = useQuery<any[]>({
    queryKey: [
      "/api/reports/staff-performance",
      currentStore?.id,
      dateRange?.from?.toISOString(),
      dateRange?.to?.toISOString()
    ],
    queryFn: async () => {
      const params = new URLSearchParams({ storeId: currentStore!.id });
      if (dateRange?.from) params.append("startDate", dateRange.from.toISOString().split('T')[0]);
      if (dateRange?.to) params.append("endDate", dateRange.to.toISOString().split('T')[0]);
      const res = await fetch(`/api/reports/staff-performance?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch performance data");
      return res.json();
    },
    enabled: !!currentStore?.id,
  });

  const formatCurrency = (value: number) => {
    return formatCurrencyUtil(value, storeCurrency);
  };

  const [selectedMetric, setSelectedMetric] = useState<"revenue" | "services" | "products" | "attendance" | "performance">("revenue");
  const [activeTab, setActiveTab] = useState("directory");

  const chartData = performanceData.map((row: any) => ({
    name: row.name,
    role: row.role,
    revenue: row.totalRevenue || 0,
    services: row.servicesCount || 0,
    products: row.productsCount || 0,
    present: row.presentDays || 0,
    absent: row.absentDays || 0,
    performance: (row.totalRevenue || 0) / (row.presentDays || 1),
  }));

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader title="Staff Performance Report" />
        <StoreRequiredAlert title="Store Required for Staff Performance" />
      </div>
    );
  }

  const columns = [
    {
      key: "name",
      header: "Staff Name",
      render: (row: any) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.name}</span>
          <span className="text-xs text-muted-foreground capitalize">{row.role}</span>
        </div>
      ),
    },
    {
      key: "servicesCount",
      header: "Services",
      render: (row: any) => (
        <div className="flex items-center gap-2">
          <Wrench className="h-3 w-3 text-muted-foreground" />
          <span>{row.servicesCount}</span>
        </div>
      ),
    },
    {
      key: "productsCount",
      header: "Products",
      render: (row: any) => (
        <div className="flex items-center gap-2">
          <ShoppingBag className="h-3 w-3 text-muted-foreground" />
          <span>{row.productsCount}</span>
        </div>
      ),
    },
    {
      key: "totalRevenue",
      header: "Revenue Generated",
      render: (row: any) => (
        <span className="font-mono font-medium">{formatCurrency(row.totalRevenue)}</span>
      ),
    },
    {
      key: "attendance",
      header: "Attendance",
      render: (row: any) => (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="secondary" className="h-4 px-1 text-[10px]">Present: {row.presentDays}</Badge>
            <Badge variant="outline" className="h-4 px-1 text-[10px] text-red-600">Absent: {row.absentDays}</Badge>
          </div>
        </div>
      ),
    },
    {
      key: "score",
      header: "Performance",
      render: (row: any) => {
        // Simple heuristic: Revenue / (Present Days || 1)
        const avgRevenue = row.totalRevenue / (row.presentDays || 1);
        return (
          <div className="flex items-center gap-2">
            {avgRevenue > 5000 ? (
              <TrendingUp className="h-4 w-4 text-green-600" />
            ) : (
              <TrendingDown className="h-4 w-4 text-amber-600" />
            )}
            <span className="text-xs font-medium">
              {formatCurrency(avgRevenue)}/day
            </span>
          </div>
        );
      },
    },
  ];

  const exportColumns = [
    { key: "name", header: "Staff Name" },
    { key: "role", header: "Role" },
    { key: "servicesCount", header: "Services Performed" },
    { key: "productsCount", header: "Products Sold" },
    { key: "totalRevenue", header: "Total Revenue Generated" },
    { key: "presentDays", header: "Days Present" },
    { key: "absentDays", header: "Days Absent" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff Performance"
        description="Monitor staff productivity and attendance"
        actions={
          <div className="flex flex-col sm:flex-row gap-2 items-center">
            <DateRangeFilter
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
            />
            <ExportToolbar
              data={performanceData}
              columns={exportColumns}
              filename={`staff-performance-${format(new Date(), "yyyy-MM-dd")}`}
              title="Staff Performance Report"
              disabled={isLoading}
            />
          </div>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="directory" data-testid="tab-staff-directory">
            Performance Directory
          </TabsTrigger>
          <TabsTrigger value="analytics" data-testid="tab-staff-analytics">
            Analytics & Visualization
          </TabsTrigger>
        </TabsList>

        <TabsContent value="directory" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Staff Metrics Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                data={performanceData}
                columns={columns}
                searchable
                searchPlaceholder="Search staff..."
                searchKeys={["name", "role"]}
                isLoading={isLoading}
                emptyMessage="No data available for the selected period."
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          <Card className="border-primary/10 shadow-sm">
            <CardContent className="pt-6">
              {isLoading ? (
                <div className="space-y-4">
                  <Skeleton className="h-6 w-[200px]" />
                  <Skeleton className="h-[300px] w-full" />
                </div>
              ) : performanceData.length === 0 ? (
                <div className="flex h-[300px] items-center justify-center text-muted-foreground text-sm italic">
                  No visualization data available for this selected date range.
                </div>
              ) : (
                <Tabs value={selectedMetric} onValueChange={(v: any) => setSelectedMetric(v)} className="w-full">
                  <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 mb-6">
                    <div>
                      <h3 className="font-semibold text-sm leading-none tracking-tight">Staff Metrics Visualization</h3>
                      <p className="text-xs text-muted-foreground mt-1">Select a tab below to compare staff contributions</p>
                    </div>
                    <TabsList className="grid grid-cols-5 w-full xl:w-auto bg-muted/40 p-0.5 rounded-lg border border-border/40">
                      <TabsTrigger value="revenue" className="text-xs py-1.5">Revenue</TabsTrigger>
                      <TabsTrigger value="services" className="text-xs py-1.5">Services</TabsTrigger>
                      <TabsTrigger value="products" className="text-xs py-1.5">Products</TabsTrigger>
                      <TabsTrigger value="attendance" className="text-xs py-1.5">Attendance</TabsTrigger>
                      <TabsTrigger value="performance" className="text-xs py-1.5">Performance</TabsTrigger>
                    </TabsList>
                  </div>

                  <div className="h-[320px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted/40" />
                        <XAxis
                          dataKey="name"
                          tickLine={false}
                          axisLine={false}
                          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                          dy={10}
                        />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                          tickFormatter={(value) => {
                            if (selectedMetric === "revenue" || selectedMetric === "performance") {
                              return formatCurrency(value).split('.')[0];
                            }
                            return value;
                          }}
                        />
                        <Tooltip
                          cursor={{ fill: "hsl(var(--muted)/0.2)" }}
                          content={
                            <CustomTooltip
                              selectedMetric={selectedMetric}
                              formatCurrency={(v: number) => formatCurrency(v)}
                            />
                          }
                        />
                        {selectedMetric === "revenue" && (
                          <Bar dataKey="revenue" name="Revenue Generated" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={40} />
                        )}
                        {selectedMetric === "services" && (
                          <Bar dataKey="services" name="Services Performed" fill="#a855f7" radius={[4, 4, 0, 0]} barSize={40} />
                        )}
                        {selectedMetric === "products" && (
                          <Bar dataKey="products" name="Products Sold" fill="#10b981" radius={[4, 4, 0, 0]} barSize={40} />
                        )}
                        {selectedMetric === "attendance" && [
                          <Bar key="present" dataKey="present" name="Present" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} barSize={40} />,
                          <Bar key="absent" dataKey="absent" name="Absent" stackId="a" fill="#f43f5e" radius={[4, 4, 0, 0]} barSize={40} />
                        ]}
                        {selectedMetric === "performance" && (
                          <Bar dataKey="performance" name="Avg Daily Revenue" fill="#06b6d4" radius={[4, 4, 0, 0]} barSize={40} />
                        )}
                        {selectedMetric === "attendance" && <Legend verticalAlign="top" height={36} iconType="circle" />}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Tabs>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
