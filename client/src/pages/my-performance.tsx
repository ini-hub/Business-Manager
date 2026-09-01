import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricCard } from "@/components/metric-card";
import { MetricGrid } from "@/components/metric-grid";
import { ExportToolbar } from "@/components/export-toolbar";
import { useStore } from "@/lib/store-context";
import { formatCurrency as formatCurrencyUtil } from "@/lib/currency-utils";
import { DateRangeFilter, type DateRange } from "@/components/date-range-filter";
import { usePersistedDateRange, readPersistedRange } from "@/hooks/use-persisted-date-range";
import { startOfMonth, endOfDay, format } from "date-fns";
import { Wrench, ShoppingBag, DollarSign, CalendarCheck, CalendarX, TriangleAlert } from "lucide-react";

type PerformanceSummary = {
  id: string;
  name: string;
  role: string;
  totalRevenue: number;
  servicesCount: number;
  productsCount: number;
  presentDays: number;
  absentDays: number;
  lateDays: number;
};

type BreakdownEntry = {
  inventoryName: string;
  receiptNumber: string;
  date: string;
  revenue: number;
  role?: string;
  quantity?: number;
};

/**
 * A staff member's own performance — their personal record. Read-only: the
 * numbers behind it (services, products, revenue share, attendance) come
 * from the same source the manager-facing Staff Performance report uses,
 * scoped server-side to this one person.
 */
export default function MyPerformancePage() {
  const { currentStore } = useStore();
  const storeCurrency = currentStore?.currency || "NGN";
  const formatCurrency = (value: number) => formatCurrencyUtil(value, storeCurrency);

  const [dateRange, setDateRange] = usePersistedDateRange<DateRange>(
    "my_performance_date_range",
    () =>
      readPersistedRange("my_performance_date_range") ?? {
        from: startOfMonth(new Date()),
        to: endOfDay(new Date()),
      },
  );

  // storeId is required, not a courtesy: the same login can be linked to a
  // staff row in more than one store (an owner/manager who is "the manager"
  // at several branches), so the server needs to know which one to answer
  // for — see server/routes/reports.routes.ts's getStaffByUserId usage.
  const rangeParams = () => {
    const params = new URLSearchParams();
    if (dateRange?.from) params.append("startDate", format(dateRange.from, "yyyy-MM-dd"));
    if (dateRange?.to) params.append("endDate", format(dateRange.to, "yyyy-MM-dd"));
    if (currentStore?.id) params.append("storeId", currentStore.id);
    return params.toString();
  };

  const { data: summary, isLoading, isError, error } = useQuery<PerformanceSummary>({
    queryKey: ["/api/reports/my-performance", currentStore?.id, dateRange?.from?.toISOString(), dateRange?.to?.toISOString()],
    queryFn: async () => {
      const res = await fetch(`/api/reports/my-performance?${rangeParams()}`, { credentials: "include" });
      if (!res.ok) {
        // A manager/owner without a linked staff record at this store gets a
        // 404 here with a useful message ("Staff record not found for this
        // user.") — surface it instead of the generic fallback, which reads
        // as "something broke."
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Failed to fetch your performance data");
      }
      return res.json();
    },
    enabled: !!currentStore?.id,
  });

  const { data: breakdown, isLoading: breakdownLoading } = useQuery<{ services: BreakdownEntry[]; products: BreakdownEntry[] }>({
    queryKey: ["/api/reports/my-performance/breakdown", currentStore?.id, dateRange?.from?.toISOString(), dateRange?.to?.toISOString()],
    queryFn: async () => {
      const res = await fetch(`/api/reports/my-performance/breakdown?${rangeParams()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch your performance breakdown");
      return res.json();
    },
    enabled: !!currentStore?.id,
  });

  const avgDailyRevenue = summary ? (summary.totalRevenue || 0) / (summary.presentDays || 1) : 0;

  const periodLabel = dateRange?.from
    ? !dateRange.to || format(dateRange.to, "yyyy-MM-dd") === format(dateRange.from, "yyyy-MM-dd")
      ? format(dateRange.from, "d MMM yyyy")
      : `${format(dateRange.from, "d MMM")} – ${format(dateRange.to, "d MMM yyyy")}`
    : undefined;

  const exportRows = summary
    ? [
        {
          period: periodLabel,
          servicesCount: summary.servicesCount,
          productsCount: summary.productsCount,
          totalRevenue: summary.totalRevenue,
          presentDays: summary.presentDays,
          absentDays: summary.absentDays,
          lateDays: summary.lateDays,
        },
      ]
    : [];

  const exportColumns = [
    { key: "period", header: "Period" },
    { key: "servicesCount", header: "Services Performed" },
    { key: "productsCount", header: "Products Sold" },
    { key: "totalRevenue", header: "Revenue Share" },
    { key: "presentDays", header: "Days Present" },
    { key: "absentDays", header: "Days Absent" },
    { key: "lateDays", header: "Days Late" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Performance"
        description="Your own productivity and attendance record — for your reference"
        actions={
          <div className="flex flex-col sm:flex-row gap-2 items-center">
            <DateRangeFilter
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              defaultPreset="thisMonth"
              timezone={currentStore?.timezone}
            />
            <ExportToolbar
              data={exportRows}
              columns={exportColumns}
              filename={`my-performance-${format(new Date(), "yyyy-MM-dd")}`}
              title="My Performance Record"
              disabled={isLoading}
            />
          </div>
        }
      />

      {isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <TriangleAlert className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm font-medium">{(error as Error)?.message || "Couldn't load your performance data."}</p>
            <p className="text-xs text-muted-foreground">
              If you're a manager or owner, this page needs a staff record linked to your account — ask another owner to link it in Staff settings.
            </p>
          </CardContent>
        </Card>
      ) : (
      <>
      {isLoading ? (
        <MetricGrid>
          <Skeleton className="h-24 sm:h-32" />
          <Skeleton className="h-24 sm:h-32" />
          <Skeleton className="h-24 sm:h-32" />
          <Skeleton className="h-24 sm:h-32" />
        </MetricGrid>
      ) : (
        <MetricGrid>
          <MetricCard
            title="Revenue Share"
            value={formatCurrency(summary?.totalRevenue || 0)}
            icon={<DollarSign className="h-4 w-4" />}
            description={`${formatCurrency(avgDailyRevenue)}/day present`}
          />
          <MetricCard
            title="Services Performed"
            value={summary?.servicesCount || 0}
            icon={<Wrench className="h-4 w-4" />}
            description="In the selected period"
          />
          <MetricCard
            title="Products Sold"
            value={summary?.productsCount || 0}
            icon={<ShoppingBag className="h-4 w-4" />}
            description="In the selected period"
          />
          <MetricCard
            title="Attendance"
            value={summary?.presentDays || 0}
            icon={<CalendarCheck className="h-4 w-4" />}
            description={`${summary?.absentDays || 0} absent · ${summary?.lateDays || 0} late`}
          />
        </MetricGrid>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wrench className="h-4 w-4 text-muted-foreground" />
              Services Performed
              {!breakdownLoading && <Badge variant="secondary">{breakdown?.services.length ?? 0}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {breakdownLoading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-8 bg-muted animate-pulse rounded" />
                ))}
              </div>
            ) : !breakdown || breakdown.services.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No services recorded in this period.</p>
            ) : (
              <div className="rounded-md border text-xs overflow-x-auto">
                <table className="w-full min-w-[400px]">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Service</th>
                      <th className="text-left px-3 py-2 font-medium">Date</th>
                      <th className="text-right px-3 py-2 font-medium">Revenue</th>
                      <th className="text-center px-3 py-2 font-medium">Role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdown.services.map((s, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-2">{s.inventoryName}</td>
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
                      <td colSpan={2} className="px-3 py-2">Total</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {formatCurrency(breakdown.services.reduce((sum, r) => sum + r.revenue, 0))}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShoppingBag className="h-4 w-4 text-muted-foreground" />
              Products Sold
              {!breakdownLoading && <Badge variant="secondary">{breakdown?.products.length ?? 0}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {breakdownLoading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-8 bg-muted animate-pulse rounded" />
                ))}
              </div>
            ) : !breakdown || breakdown.products.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No products sold in this period.</p>
            ) : (
              <div className="rounded-md border text-xs overflow-x-auto">
                <table className="w-full min-w-[400px]">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Product</th>
                      <th className="text-left px-3 py-2 font-medium">Date</th>
                      <th className="text-center px-3 py-2 font-medium">Qty</th>
                      <th className="text-right px-3 py-2 font-medium">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdown.products.map((p, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-2">{p.inventoryName}</td>
                        <td className="px-3 py-2 text-muted-foreground">{format(new Date(p.date), "dd MMM")}</td>
                        <td className="px-3 py-2 text-center">{p.quantity}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatCurrency(p.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/30 border-t font-semibold">
                    <tr>
                      <td colSpan={3} className="px-3 py-2">Total</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {formatCurrency(breakdown.products.reduce((sum, r) => sum + r.revenue, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {!isLoading && summary && (summary.absentDays > 0 || summary.lateDays > 0) && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CalendarX className="h-3.5 w-3.5" />
          Attendance is marked by your manager. Contact them if a day looks wrong.
        </div>
      )}
      </>
      )}
    </div>
  );
}
