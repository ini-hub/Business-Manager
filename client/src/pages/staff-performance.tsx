import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, TrendingUp, TrendingDown, Calendar, ShoppingBag, Wrench, BarChart3, AlertCircle, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { ExportToolbar } from "@/components/export-toolbar";
import { useStore } from "@/lib/store-context";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency-utils";
import { DateRangeFilter, type DateRange } from "@/components/date-range-filter";
import { usePersistedDateRange, readPersistedRange } from "@/hooks/use-persisted-date-range";
import { startOfMonth, startOfDay, endOfDay, format } from "date-fns";
import { Link, useLocation, useSearch } from "wouter";
import { appendReturnTo } from "@/lib/return-to";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { PolymorphicTabsList, TabItem } from "@/components/oop-ui/PolymorphicTabsList";

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
  const { currentStore, business } = useStore();
  const storeCurrency = currentStore?.currency || "NGN";
  const [location, setLocation] = useLocation();
  const search = useSearch();

  const [dateRange, setDateRange] = usePersistedDateRange<DateRange>(
    "staff_performance_date_range",
    () => {
      const params = new URLSearchParams(window.location.search);
      const startDateParam = params.get("startDate");
      const endDateParam = params.get("endDate");
      if (startDateParam && endDateParam) {
        return {
          from: startOfDay(new Date(startDateParam)),
          to: endOfDay(new Date(endDateParam))
        };
      }
      return (
        readPersistedRange("staff_performance_date_range") ?? {
          from: startOfMonth(new Date()),
          to: endOfDay(new Date())
        }
      );
    },
  );

  const { data: performanceData = [], isLoading } = useQuery<any[]>({
    queryKey: [
      "/api/reports/staff-performance",
      currentStore?.id,
      dateRange?.from?.toISOString(),
      dateRange?.to?.toISOString()
    ],
    queryFn: async () => {
      const params = new URLSearchParams({ storeId: currentStore!.id });
      if (dateRange?.from) params.append("startDate", format(dateRange.from, "yyyy-MM-dd"));
      if (dateRange?.to) params.append("endDate", format(dateRange.to, "yyyy-MM-dd"));
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

  const [drawerStaff, setDrawerStaff] = useState<{ id: string; name: string } | null>(null);

  const { data: breakdownData, isLoading: breakdownLoading } = useQuery<{ services: any[]; products: any[] }>({
    queryKey: [
      "/api/reports/staff-performance/breakdown",
      drawerStaff?.id,
      currentStore?.id,
      dateRange?.from?.toISOString(),
      dateRange?.to?.toISOString(),
    ],
    queryFn: async () => {
      const params = new URLSearchParams({ storeId: currentStore!.id });
      if (dateRange?.from) params.append("startDate", format(dateRange.from, "yyyy-MM-dd"));
      if (dateRange?.to) params.append("endDate", format(dateRange.to, "yyyy-MM-dd"));
      const res = await fetch(`/api/reports/staff-performance/${drawerStaff!.id}/breakdown?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch breakdown");
      return res.json();
    },
    enabled: !!drawerStaff && !!currentStore?.id,
  });

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
      header: "Revenue Share",
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
    {
      key: "actions",
      header: "",
      render: (row: any) => (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs gap-1"
          onClick={() => setDrawerStaff({ id: row.id, name: row.name })}
        >
          View <ChevronRight className="h-3 w-3" />
        </Button>
      ),
    },
  ];

  const exportColumns = [
    { key: "name", header: "Staff Name" },
    { key: "role", header: "Role" },
    { key: "servicesCount", header: "Services Performed" },
    { key: "productsCount", header: "Products Sold" },
    { key: "totalRevenue", header: "Revenue Share" },
    { key: "presentDays", header: "Days Present" },
    { key: "absentDays", header: "Days Absent" },
  ];

  type PerfReportRow = {
    name: string;
    role: string;
    servicesCount: number;
    productsCount: number;
    totalRevenue: number;
    presentDays: number;
    absentDays: number;
    performanceLabel: string;
  };

  const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  // Sorted by role so groupBy produces contiguous sections.
  const buildPerfPdfRows = (data: any[]): PerfReportRow[] =>
    [...data]
      .map((r: any) => {
        const avgDaily = (r.totalRevenue || 0) / (r.presentDays || 1);
        return {
          name: r.name,
          role: r.role,
          servicesCount: r.servicesCount || 0,
          productsCount: r.productsCount || 0,
          totalRevenue: r.totalRevenue || 0,
          presentDays: r.presentDays || 0,
          absentDays: r.absentDays || 0,
          performanceLabel: avgDaily > 5000 ? "Above Avg" : "Below Avg",
        };
      })
      .sort((a, b) => a.role.localeCompare(b.role));

  const buildPerfPdfKpis = (rows: PerfReportRow[]) => [
    { label: "Total Revenue", value: formatCurrency(rows.reduce((s, r) => s + r.totalRevenue, 0)) },
    { label: "Staff Count", value: String(rows.length) },
    { label: "Services Performed", value: String(rows.reduce((s, r) => s + r.servicesCount, 0)) },
    { label: "Products Sold", value: String(rows.reduce((s, r) => s + r.productsCount, 0)) },
  ];

  const pdfRows: PerfReportRow[] = buildPerfPdfRows(performanceData);
  const pdfKpis = buildPerfPdfKpis(pdfRows);

  const [visiblePerformanceRows, setVisiblePerformanceRows] = useState<any[]>([]);
  const visiblePdfRows: PerfReportRow[] = buildPerfPdfRows(visiblePerformanceRows);
  const visiblePdfKpis = buildPerfPdfKpis(visiblePdfRows);

  const periodLabel = dateRange.from
    ? (!dateRange.to || format(dateRange.to, "yyyy-MM-dd") === format(dateRange.from, "yyyy-MM-dd")
      ? format(dateRange.from, "d MMM yyyy")
      : `${format(dateRange.from, "d MMM")} – ${format(dateRange.to, "d MMM yyyy")}`)
    : undefined;

  const pdfReport = {
    businessName: business?.name ?? currentStore?.name ?? "Business",
    storeName: currentStore?.name ?? "All Stores",
    periodLabel,
    kpis: pdfKpis,
    columns: [
      { key: "name", header: "Staff Name" },
      { key: "role", header: "Role", format: (r: PerfReportRow) => capitalize(r.role) },
      { key: "servicesCount", header: "Services", align: "right" as const },
      { key: "productsCount", header: "Products", align: "right" as const },
      { key: "totalRevenue", header: "Revenue Share", align: "right" as const, format: (r: PerfReportRow) => formatCurrency(r.totalRevenue) },
      { key: "performanceLabel", header: "Performance" },
      { key: "presentDays", header: "Present Days", align: "right" as const },
      { key: "absentDays", header: "Absent Days", align: "right" as const },
    ],
    rows: pdfRows,
    amountKey: "totalRevenue",
    formatAmount: formatCurrency,
    unitLabel: "staff",
    groupBy: (r: PerfReportRow) => capitalize(r.role),
    statusKey: "performanceLabel",
    getStatus: (r: PerfReportRow) => ({ label: r.performanceLabel, tone: r.performanceLabel === "Above Avg" ? ("success" as const) : ("warning" as const) }),
  };

  const visiblePdfReport = {
    ...pdfReport,
    kpis: visiblePdfKpis,
    rows: visiblePdfRows,
  };

  const metricTabItems: TabItem[] = [
    { value: "revenue", label: "Revenue" },
    { value: "services", label: "Services" },
    { value: "products", label: "Products" },
    { value: "attendance", label: "Attendance" },
    { value: "performance", label: "Performance" },
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
              defaultPreset="thisMonth"
              timezone={currentStore?.timezone}
            />
            <ExportToolbar
              data={performanceData}
              columns={exportColumns}
              filename={`staff-performance-${format(new Date(), "yyyy-MM-dd")}`}
              title="Staff Performance Report"
              disabled={isLoading}
              pdfReport={pdfReport}
              visibleData={visiblePerformanceRows}
              visiblePdfReport={visiblePdfReport}
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
                onVisibleDataChange={setVisiblePerformanceRows}
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
                    <PolymorphicTabsList tabs={metricTabItems} variant="solid" className="w-full xl:w-auto" />
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

      {/* Staff breakdown drawer */}
      <Sheet open={!!drawerStaff} onOpenChange={(open) => { if (!open) setDrawerStaff(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>{drawerStaff?.name} — Revenue Breakdown</SheetTitle>
            <p className="text-xs text-muted-foreground">
              {dateRange?.from && dateRange?.to
                ? `${format(dateRange.from, "dd MMM yyyy")} – ${format(dateRange.to, "dd MMM yyyy")}`
                : "Selected period"}
            </p>
          </SheetHeader>

          {breakdownLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-8 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : (
            <div className="space-y-6">
              {/* Services */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Wrench className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-semibold text-sm">Services Performed ({breakdownData?.services.length ?? 0})</h3>
                </div>
                {breakdownData?.services.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No services in this period.</p>
                ) : (
                  <div className="rounded-md border text-xs overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">Service</th>
                          <th className="text-left px-3 py-2 font-medium">Receipt</th>
                          <th className="text-left px-3 py-2 font-medium">Date</th>
                          <th className="text-right px-3 py-2 font-medium">Revenue</th>
                          <th className="text-center px-3 py-2 font-medium">Role</th>
                        </tr>
                      </thead>
                      <tbody>
                        {breakdownData?.services.map((s: any, i: number) => (
                          <tr
                            key={i}
                            className={`border-t ${s.transactionId ? "cursor-pointer hover:bg-muted/40" : ""}`}
                            onClick={() => {
                              if (!s.transactionId) return;
                              setLocation(appendReturnTo(`/transactions/${s.transactionId}`, location, search));
                            }}
                          >
                            <td className="px-3 py-2">{s.inventoryName}</td>
                            <td className="px-3 py-2 text-muted-foreground">{s.receiptNumber}</td>
                            <td className="px-3 py-2 text-muted-foreground">{format(new Date(s.date), "dd MMM")}</td>
                            <td className="px-3 py-2 text-right font-mono">{formatCurrency(s.revenue)}</td>
                            <td className="px-3 py-2 text-center">
                              <Badge variant={s.role === "lead" ? "default" : "secondary"} className="text-[10px] h-4 px-1">
                                {s.role === "lead" ? "Lead" : "Assist"}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-muted/30 border-t font-semibold">
                        <tr>
                          <td colSpan={3} className="px-3 py-2">Total</td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatCurrency(breakdownData?.services.reduce((s: number, r: any) => s + r.revenue, 0) ?? 0)}
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>

              {/* Products */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <ShoppingBag className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-semibold text-sm">Products Sold ({breakdownData?.products.length ?? 0})</h3>
                </div>
                {breakdownData?.products.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No products in this period.</p>
                ) : (
                  <div className="rounded-md border text-xs overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">Product</th>
                          <th className="text-left px-3 py-2 font-medium">Receipt</th>
                          <th className="text-left px-3 py-2 font-medium">Date</th>
                          <th className="text-center px-3 py-2 font-medium">Qty</th>
                          <th className="text-right px-3 py-2 font-medium">Revenue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {breakdownData?.products.map((p: any, i: number) => (
                          <tr
                            key={i}
                            className={`border-t ${p.transactionId ? "cursor-pointer hover:bg-muted/40" : ""}`}
                            onClick={() => {
                              if (!p.transactionId) return;
                              setLocation(appendReturnTo(`/transactions/${p.transactionId}`, location, search));
                            }}
                          >
                            <td className="px-3 py-2">{p.inventoryName}</td>
                            <td className="px-3 py-2 text-muted-foreground">{p.receiptNumber}</td>
                            <td className="px-3 py-2 text-muted-foreground">{format(new Date(p.date), "dd MMM")}</td>
                            <td className="px-3 py-2 text-center">{p.quantity}</td>
                            <td className="px-3 py-2 text-right font-mono">{formatCurrency(p.revenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-muted/30 border-t font-semibold">
                        <tr>
                          <td colSpan={4} className="px-3 py-2">Total</td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatCurrency(breakdownData?.products.reduce((s: number, r: any) => s + r.revenue, 0) ?? 0)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
