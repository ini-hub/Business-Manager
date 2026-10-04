import { useEffect, useState } from "react";
import { useUrlState } from "@/hooks/use-url-state";
import { useQuery } from "@tanstack/react-query";
import { Users, TrendingUp, TrendingDown, ShoppingBag, Wrench, Wallet, Gauge, BarChart3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { ExportToolbar } from "@/components/export-toolbar";
import { useStore } from "@/lib/store-context";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency-utils";
import { type DateRange } from "@/components/date-range-filter";
import { usePersistedDateRange, readPersistedRange } from "@/hooks/use-persisted-date-range";
import { startOfMonth, startOfDay, endOfDay, format } from "date-fns";
import { Link, useLocation, useSearch } from "wouter";
import { appendReturnTo } from "@/lib/return-to";
import { MetricRow } from "@/components/metric-row";
import { ListControls } from "@/components/list-controls";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { StaffPerformanceFiltersSheet, StaffPerformanceSortSheet } from "@/components/staff-performance-filter-sheets";
import { getCustomerInitials } from "@/lib/customer-detail-utils";
import { getCurrencyByCode } from "@/lib/currency-utils";
import {
  type StaffPerformanceFilterState,
  type StaffPerformanceSortState,
  EMPTY_STAFF_PERFORMANCE_FILTERS,
  avgDailyRevenue,
  performanceTier,
  staffMatchesFilters,
  staffMatchesSearch,
  countActiveStaffPerformanceFilters,
  buildStaffPerformanceFilterChips,
  clearStaffPerformanceFilterChip,
  staffPerformanceSortLabel,
  sortStaffPerformance,
} from "@/lib/staff-performance-filters";

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

  // Old bookmarks of the retired in-page analytics tab land on the standalone analytics page.
  const [legacyTab] = useUrlState<string>("tab", "directory");
  useEffect(() => {
    if (legacyTab === "analytics") setLocation("/staffs/performance/analytics", { replace: true });
  }, [legacyTab, setLocation]);

  const [perfSearch, setPerfSearch] = useState("");
  // The date range is the report's server-side scope and stays persisted (the analytics page reads
  // the same range); the Filters sheet edits it alongside the client-side filters.
  const [otherFilters, setOtherFilters] = useState<StaffPerformanceFilterState>(EMPTY_STAFF_PERFORMANCE_FILTERS);
  const perfFilters: StaffPerformanceFilterState = {
    ...otherFilters,
    dateFrom: dateRange?.from ? format(dateRange.from, "yyyy-MM-dd") : null,
    dateTo: dateRange?.to ? format(dateRange.to, "yyyy-MM-dd") : null,
  };
  const setPerfFilters = (next: StaffPerformanceFilterState) => {
    setOtherFilters(next);
    setDateRange({
      from: next.dateFrom ? startOfDay(new Date(`${next.dateFrom}T00:00:00`)) : undefined,
      to: next.dateTo ? endOfDay(new Date(`${next.dateTo}T00:00:00`)) : undefined,
    });
  };
  const [perfSort, setPerfSort] = useState<StaffPerformanceSortState | null>(null);

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

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader title="Staff Performance Report" />
        <StoreRequiredAlert title="Store Required for Staff Performance" />
      </div>
    );
  }

  const staffCardAvatar = (row: any) => (
    <Avatar className="h-10 w-10">
      <AvatarFallback className="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 text-sm font-semibold">
        {getCustomerInitials(row.name)}
      </AvatarFallback>
    </Avatar>
  );

  const columns = [
    {
      key: "name",
      header: "Staff",
      priority: 1 as const,
      render: (row: any) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.name}</span>
          <span className="text-xs text-muted-foreground capitalize">{row.role}</span>
        </div>
      ),
      cardRender: (row: any) => <span className="truncate">{row.name}</span>,
    },
    {
      key: "totalRevenue",
      header: "Revenue",
      priority: 1 as const,
      render: (row: any) => <span className="text-sm font-medium">{formatCurrency(row.totalRevenue)}</span>,
    },
    {
      key: "servicesCount",
      header: "Services",
      priority: 2 as const,
      render: (row: any) => (
        <div className="flex items-center gap-2">
          <Wrench className="h-3 w-3 text-muted-foreground" />
          <span>{row.servicesCount}</span>
        </div>
      ),
      cardRender: (row: any) => <span>{row.servicesCount} services</span>,
    },
    {
      key: "productsCount",
      header: "Products",
      priority: 3 as const,
      render: (row: any) => (
        <div className="flex items-center gap-2">
          <ShoppingBag className="h-3 w-3 text-muted-foreground" />
          <span>{row.productsCount}</span>
        </div>
      ),
      cardRender: (row: any) => <span>{row.productsCount} products</span>,
    },
    {
      key: "attendance",
      header: "Attendance",
      render: (row: any) => (
        <div className="flex items-center gap-2 text-xs">
          <Badge variant="secondary" className="h-4 px-1 text-[10px]">Present: {row.presentDays}</Badge>
          <Badge variant="outline" className="h-4 px-1 text-[10px] text-red-600">Absent: {row.absentDays}</Badge>
          {row.lateDays > 0 && (
            <Badge variant="outline" className="h-4 px-1 text-[10px] text-amber-600">Late: {row.lateDays}</Badge>
          )}
        </div>
      ),
    },
    {
      key: "score",
      header: "Performance",
      render: (row: any) => (
        <div className="flex items-center gap-2">
          {performanceTier(row) === "above" ? (
            <TrendingUp className="h-4 w-4 text-green-600" />
          ) : (
            <TrendingDown className="h-4 w-4 text-amber-600" />
          )}
          <span className="text-xs font-medium">{formatCurrency(avgDailyRevenue(row))}/day</span>
        </div>
      ),
      cardRender: (row: any) => <span>{formatCurrency(avgDailyRevenue(row))}/day</span>,
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
    { key: "lateDays", header: "Days Late" },
  ];

  type PerfReportRow = {
    name: string;
    role: string;
    servicesCount: number;
    productsCount: number;
    totalRevenue: number;
    presentDays: number;
    absentDays: number;
    lateDays: number;
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
          lateDays: r.lateDays || 0,
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
      { key: "lateDays", header: "Late Days", align: "right" as const },
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

  const currencySymbol = getCurrencyByCode(storeCurrency)?.symbol ?? "₦";
  const roleOptions = Array.from(new Set(performanceData.map((r: any) => r.role as string))).sort();
  const searchedRows = performanceData.filter((r: any) => staffMatchesSearch(r, perfSearch));
  const visibleRows = sortStaffPerformance(
    searchedRows.filter((r: any) => staffMatchesFilters(r, perfFilters)),
    perfSort,
  );

  const totalRevenue = performanceData.reduce((sum: number, r: any) => sum + (r.totalRevenue || 0), 0);
  const totalServices = performanceData.reduce((sum: number, r: any) => sum + (r.servicesCount || 0), 0);
  const totalProducts = performanceData.reduce((sum: number, r: any) => sum + (r.productsCount || 0), 0);
  const totalPresentDays = performanceData.reduce((sum: number, r: any) => sum + (r.presentDays || 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff Performance"
        description="Monitor staff productivity and attendance"
        compact
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setLocation("/staffs/performance/analytics")}
              aria-label="Analytics"
              data-testid="button-staff-analytics"
            >
              <BarChart3 className="h-4 w-4 lg:mr-2" />
              <span className="hidden lg:inline">Analytics</span>
            </Button>
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

      <MetricRow
        metrics={[
          { title: "Staff", value: performanceData.length, icon: <Users className="h-4 w-4" />, isLoading },
          { title: "Revenue", value: formatCurrency(totalRevenue), icon: <Wallet className="h-4 w-4" />, isLoading },
          { title: "Services", value: totalServices, icon: <Wrench className="h-4 w-4" />, isLoading },
          { title: "Products sold", value: totalProducts, icon: <ShoppingBag className="h-4 w-4" />, isLoading },
          { title: "Avg. daily revenue", value: formatCurrency(totalRevenue / (totalPresentDays || 1)), icon: <Gauge className="h-4 w-4" />, isLoading },
        ]}
      />

      <div className="space-y-3">
          <ListControls
            testIdPrefix="staff-performance"
            placeholder="Search staff name or role"
            search={perfSearch}
            onSearchChange={setPerfSearch}
            filterCount={countActiveStaffPerformanceFilters(perfFilters)}
            filters={(trigger) => (
              <StaffPerformanceFiltersSheet
                filters={perfFilters}
                onApply={setPerfFilters}
                currencySymbol={currencySymbol}
                roles={roleOptions}
                resultCountFor={(draft) => searchedRows.filter((r: any) => staffMatchesFilters(r, draft)).length}
                trigger={trigger}
              />
            )}
            sortLabel={staffPerformanceSortLabel(perfSort).replace(/^Sort: /, "")}
            sort={(trigger) => <StaffPerformanceSortSheet sort={perfSort} onChange={setPerfSort} trigger={trigger} />}
            chips={buildStaffPerformanceFilterChips(perfFilters, currencySymbol)}
            onRemoveChip={(key) => setPerfFilters(clearStaffPerformanceFilterChip(perfFilters, key as Parameters<typeof clearStaffPerformanceFilterChip>[1]))}
            hasSort={perfSort !== null}
            onClearAll={() => { setPerfFilters(EMPTY_STAFF_PERFORMANCE_FILTERS); setPerfSort(null); }}
            visibleCount={visibleRows.length}
            noun="staff member"
          />

          <DataTable
            data={visibleRows}
            columns={columns}
            hideToolbar
            isLoading={isLoading}
            emptyIcon={<Users className="h-6 w-6" />}
            emptyTitle="No Staff Data"
            emptyMessage="No data available for the selected period."
            onRowClick={(row: any) => setDrawerStaff({ id: row.id, name: row.name })}
            onVisibleDataChange={setVisiblePerformanceRows}
            urlKey="directory"
            showCardChevron
            cardLayout="compact-grid"
            cardAvatar={staffCardAvatar}
          />
      </div>

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
                  <div className="rounded-md border text-xs overflow-x-auto">
                    <table className="w-full min-w-[480px]">
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
                  <div className="rounded-md border text-xs overflow-x-auto">
                    <table className="w-full min-w-[480px]">
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
