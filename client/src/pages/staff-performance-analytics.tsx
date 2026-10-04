import { useMemo, useState } from "react";
import { useUrlState } from "@/hooks/use-url-state";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowDown, ArrowLeft, ArrowUp, BarChart3, CalendarCheck, ShoppingBag, Wallet, Wrench } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PageHeader } from "@/components/page-header";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { MetricRow } from "@/components/metric-row";
import { type DateRange } from "@/components/date-range-filter";
import { usePersistedDateRange, readPersistedRange } from "@/hooks/use-persisted-date-range";
import { useStore } from "@/lib/store-context";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency-utils";
import { getCustomerInitials } from "@/lib/customer-detail-utils";
import { cn } from "@/lib/utils";
import { startOfMonth, startOfDay, endOfDay, format } from "date-fns";

type MetricKey = "revenue" | "services" | "products" | "perDay" | "attendance";

/** Fewer recorded days than this and attendance / per-day figures aren't a fair comparison. */
const MIN_DAYS_ON_RECORD = 7;
/** Absent for at least this many days is called out next to the name. */
const ABSENT_CALLOUT_DAYS = 7;

interface StaffRow {
  id: string;
  name: string;
  role: string;
  revenue: number;
  services: number;
  products: number;
  present: number;
  absent: number;
  late: number;
  /** Days with an attendance record (present + absent). */
  recorded: number;
  perDay: number;
  /** 0–100, or null when there are no recorded days. */
  attendance: number | null;
  isNew: boolean;
}

const METRICS: { key: MetricKey; label: string }[] = [
  { key: "revenue", label: "Revenue" },
  { key: "services", label: "Services" },
  { key: "products", label: "Products" },
  { key: "perDay", label: "Per day present" },
  { key: "attendance", label: "Attendance" },
];

function toRow(r: any): StaffRow {
  const present = r.presentDays || 0;
  const absent = r.absentDays || 0;
  const recorded = present + absent;
  const revenue = r.totalRevenue || 0;
  return {
    id: r.id ?? r.name,
    name: r.name,
    role: r.role,
    revenue,
    services: r.servicesCount || 0,
    products: r.productsCount || 0,
    present,
    absent,
    late: r.lateDays || 0,
    recorded,
    perDay: present > 0 ? revenue / present : 0,
    attendance: recorded > 0 ? Math.round((present / recorded) * 100) : null,
    isNew: recorded < MIN_DAYS_ON_RECORD,
  };
}

export default function StaffPerformanceAnalyticsPage() {
  const { currentStore } = useStore();
  const storeCurrency = currentStore?.currency || "NGN";

  // Same persisted range as the directory, so both pages always describe the same period.
  const [dateRange, setDateRange] = usePersistedDateRange<DateRange>(
    "staff_performance_date_range",
    () => {
      const params = new URLSearchParams(window.location.search);
      const startDateParam = params.get("startDate");
      const endDateParam = params.get("endDate");
      if (startDateParam && endDateParam) {
        return { from: startOfDay(new Date(startDateParam)), to: endOfDay(new Date(endDateParam)) };
      }
      return readPersistedRange("staff_performance_date_range") ?? { from: startOfMonth(new Date()), to: endOfDay(new Date()) };
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

  const formatCurrency = (value: number) => formatCurrencyUtil(value, storeCurrency);

  const [selectedMetric, setSelectedMetric] = useUrlState<MetricKey>("metric", "revenue");
  const [tableSort, setTableSort] = useState<{ key: MetricKey; dir: "asc" | "desc" }>({ key: "revenue", dir: "desc" });

  const rows = useMemo(() => performanceData.map(toRow), [performanceData]);

  const periodLabel = dateRange?.from
    ? !dateRange.to || format(dateRange.to, "yyyy-MM-dd") === format(dateRange.from, "yyyy-MM-dd")
      ? format(dateRange.from, "d MMM yyyy")
      : `${format(dateRange.from, "d MMM")} – ${format(dateRange.to, "d MMM yyyy")}`
    : "the selected period";

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader title="Staff performance" />
        <StoreRequiredAlert title="Store Required for Staff Analytics" />
      </div>
    );
  }

  // ---- KPIs (team totals) ----
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalServices = rows.reduce((s, r) => s + r.services, 0);
  const totalProducts = rows.reduce((s, r) => s + r.products, 0);
  const totalPresent = rows.reduce((s, r) => s + r.present, 0);
  const totalRecorded = rows.reduce((s, r) => s + r.recorded, 0);
  const teamAttendance = totalRecorded > 0 ? Math.round((totalPresent / totalRecorded) * 100) : null;

  // ---- Ranked bars ----
  const metricValue = (r: StaffRow, key: MetricKey): number | null => {
    if (key === "attendance") return r.attendance;
    return r[key];
  };
  const formatMetric = (v: number, key: MetricKey) => {
    if (key === "revenue" || key === "perDay") return formatCurrency(v);
    if (key === "attendance") return `${v}%`;
    return String(v);
  };
  const emptyLabel = (r: StaffRow, key: MetricKey) =>
    (key === "attendance" || key === "perDay") && r.recorded === 0 ? "No records" : "None this period";

  const ranked = [...rows].sort((a, b) => (metricValue(b, selectedMetric) ?? -1) - (metricValue(a, selectedMetric) ?? -1));
  const maxValue = Math.max(0, ...ranked.map((r) => metricValue(r, selectedMetric) ?? 0));
  const leader = ranked[0] && (metricValue(ranked[0], selectedMetric) ?? 0) > 0 ? ranked[0] : null;
  const metricLabel = METRICS.find((m) => m.key === selectedMetric)!.label;

  // ---- Side-by-side table ----
  const tableRows = [...rows].sort((a, b) => {
    const av = metricValue(a, tableSort.key) ?? -1;
    const bv = metricValue(b, tableSort.key) ?? -1;
    return tableSort.dir === "desc" ? bv - av : av - bv;
  });
  const toggleSort = (key: MetricKey) =>
    setTableSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));

  const exportColumns = [
    { key: "name", header: "Staff Name" },
    { key: "role", header: "Role" },
    { key: "revenue", header: "Revenue" },
    { key: "services", header: "Services" },
    { key: "products", header: "Products" },
    { key: "perDay", header: "Revenue per day present" },
    { key: "present", header: "Days Present" },
    { key: "absent", header: "Days Absent" },
  ];

  const statusChip = (r: StaffRow) => {
    if (r.isNew) {
      return (
        <Badge variant="outline" className="h-5 px-1.5 text-[10px] border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800">
          New, {r.recorded} {r.recorded === 1 ? "day" : "days"} on record
        </Badge>
      );
    }
    if (r.absent >= ABSENT_CALLOUT_DAYS) {
      return (
        <Badge variant="outline" className="h-5 px-1.5 text-[10px] border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800">
          Absent {r.absent} days
        </Badge>
      );
    }
    return null;
  };

  const sortHeader = (key: MetricKey, label: string, align: "left" | "right" = "right") => (
    <th
      scope="col"
      aria-sort={tableSort.key === key ? (tableSort.dir === "desc" ? "descending" : "ascending") : "none"}
      className={cn("px-3 py-2.5 font-medium whitespace-nowrap", align === "right" ? "text-right" : "text-left")}
    >
      <button
        type="button"
        onClick={() => toggleSort(key)}
        className={cn("inline-flex items-center gap-1 hover:text-foreground", tableSort.key === key && "text-foreground")}
        data-testid={`sort-${key}`}
      >
        {label}
        {tableSort.key === key && (tableSort.dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </button>
    </th>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff performance"
        description={`Sales, services and attendance by staff member for ${currentStore.name}`}
        compact
        actions={
          <Button variant="outline" asChild data-testid="button-back-to-customers">
            <Link href="/staffs/performance">
              <ArrowLeft className="h-4 w-4 lg:mr-2" />
              <span className="hidden lg:inline">Customers</span>
            </Link>
          </Button>
        }
      />

      <MetricRow
        metrics={[
          { title: "Revenue", value: formatCurrency(totalRevenue), icon: <Wallet className="h-4 w-4" />, isLoading },
          { title: "Services completed", value: totalServices, icon: <Wrench className="h-4 w-4" />, isLoading },
          { title: "Products sold", value: totalProducts, icon: <ShoppingBag className="h-4 w-4" />, isLoading },
          { title: "Attendance", value: teamAttendance == null ? "–" : `${teamAttendance}%`, icon: <CalendarCheck className="h-4 w-4" />, isLoading },
        ]}
      />

      {/* Ranked bars */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-base">{metricLabel} by staff member</CardTitle>
              <CardDescription>
                {selectedMetric === "attendance"
                  ? "Share of recorded days each person was present"
                  : selectedMetric === "perDay"
                    ? "Revenue divided by days present, so staff with different start dates compare fairly"
                    : "Service and product sales credited to each person"}
              </CardDescription>
            </div>
            <div
              role="tablist"
              aria-label="Metric"
              className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:mx-0 lg:rounded-lg lg:bg-muted lg:p-1 lg:pb-1"
            >
              {METRICS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  role="tab"
                  aria-selected={selectedMetric === m.key}
                  onClick={() => setSelectedMetric(m.key)}
                  data-testid={`metric-${m.key}`}
                  className={cn(
                    "shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors lg:rounded-md lg:border-transparent",
                    selectedMetric === m.key
                      ? "border-primary bg-primary text-primary-foreground lg:bg-background lg:text-foreground lg:shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex h-[200px] items-center justify-center text-sm italic text-muted-foreground">
              No staff data for {periodLabel}.
            </div>
          ) : (
            <>
              <p className="mb-4 text-xs text-muted-foreground">
                {leader
                  ? `Highest: ${leader.name}, ${formatMetric(metricValue(leader, selectedMetric) ?? 0, selectedMetric)}.`
                  : `No ${metricLabel.toLowerCase()} recorded for ${periodLabel}.`}
              </p>
              <ul className="space-y-4">
                {ranked.map((r) => {
                  const v = metricValue(r, selectedMetric);
                  const pct = v && maxValue > 0 ? Math.max((v / maxValue) * 100, 2) : 0;
                  const sample = (selectedMetric === "attendance" || selectedMetric === "perDay") && r.isNew;
                  return (
                    <li key={r.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 lg:grid-cols-[180px_1fr_110px]">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{r.name}</p>
                        {sample && (
                          <p className="text-[11px] text-amber-700 dark:text-amber-400">
                            Joined recently: only {r.recorded} {r.recorded === 1 ? "day" : "days"} on record
                          </p>
                        )}
                      </div>
                      <p className={cn("text-right text-sm font-semibold tabular-nums lg:order-3", !v && "font-medium text-muted-foreground")}>
                        {v ? formatMetric(v, selectedMetric) : emptyLabel(r, selectedMetric)}
                      </p>
                      <div className="col-span-2 h-5 rounded-sm bg-muted/50 lg:col-span-1 lg:order-2" aria-hidden="true">
                        <div className="h-full rounded-sm bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      {/* All metrics side by side */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-base">All metrics side by side</CardTitle>
          <span className="hidden text-xs text-muted-foreground sm:inline">Click a column to sort</span>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-6">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : rows.length === 0 ? null : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 text-left font-medium">Staff</th>
                    {sortHeader("revenue", "Revenue")}
                    {sortHeader("services", "Services")}
                    {sortHeader("products", "Products")}
                    {sortHeader("perDay", "Per day present")}
                    {sortHeader("attendance", "Attendance")}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((r) => (
                    <tr key={r.id} className="border-b last:border-b-0">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8 shrink-0">
                            <AvatarFallback className="bg-blue-100 text-xs font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                              {getCustomerInitials(r.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="font-medium">{r.name}</span>
                              {statusChip(r)}
                            </div>
                            <span className="text-xs capitalize text-muted-foreground">{r.role}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums">{formatCurrency(r.revenue)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{r.services}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{r.products}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(r.perDay)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {r.attendance == null ? (
                          <span className="text-muted-foreground">–</span>
                        ) : (
                          <>
                            <span className={cn("block font-semibold", r.attendance < 60 && "text-amber-700 dark:text-amber-400")}>
                              {r.attendance}%
                            </span>
                            <span className="block text-xs text-muted-foreground">{r.present} of {r.recorded} days</span>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="flex items-center gap-1.5 border-t px-4 py-3 text-xs text-muted-foreground">
            <BarChart3 className="h-3.5 w-3.5 shrink-0" />
            Revenue per day present is revenue divided by days present, so staff with different start dates compare fairly.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
