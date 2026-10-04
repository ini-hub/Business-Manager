import { useEffect } from "react";
import { AddButton } from "@/components/add-button";
import { useUrlState } from "@/hooks/use-url-state";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { appendReturnTo } from "@/lib/return-to";
import { format, parseISO } from "date-fns";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Banknote,
  BarChart3,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/page-header";
import { useStore } from "@/lib/store-context";
import { StoreRequiredAlert } from "@/components/store-required-alert";
import { ConsolidatedFallbackAlert } from "@/components/oop-ui/ConsolidatedFallbackAlert";
import { apiRequest } from "@/lib/queryClient";
import type { PayrollPeriod } from "@shared/schema";

const STATUS_CONFIG = {
  pending:  { label: "Open",  color: "text-amber-700 dark:text-amber-400",   bg: "bg-amber-50 dark:bg-amber-950 border-amber-200" },
  approved: { label: "Approved", color: "text-blue-700 dark:text-blue-400",     bg: "bg-blue-50 dark:bg-blue-950 border-blue-200" },
  paid:     { label: "Paid",     color: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950 border-emerald-200" },
};

const PAGE_SIZE = 10;

export default function PayrollPage() {
  const { currentStore } = useStore();
  const [location, setLocation] = useLocation();
  const search = useSearch();

  const [periodsPage, setPeriodsPage] = useUrlState("periodsPage", 1, Number);

  const { data: periodsRaw = [], isLoading: periodsLoading } = useQuery<PayrollPeriod[]>({
    queryKey: ["/api/payroll/periods", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/payroll/periods?storeId=${currentStore?.id}`);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    enabled: !!currentStore?.id && currentStore?.id !== "all",
  });
  const periods = Array.isArray(periodsRaw) ? periodsRaw : [];

  // Reset pagination when currentStore or periods change
  useEffect(() => {
    setPeriodsPage(1);
  }, [currentStore?.id, periods.length]);

  // Coverage gap detection — service transactions not covered by any payroll period
  const { data: coverageGaps = [] } = useQuery<{ staff_id: string; staff_name: string; earliest_date: string; latest_date: string; service_count: number; uncovered_revenue: number }[]>({
    queryKey: ["/api/payroll/coverage-gaps", currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/payroll/coverage-gaps?storeId=${currentStore?.id}`);
      return res.json();
    },
    enabled: !!currentStore?.id && currentStore?.id !== "all",
  });

  if (!currentStore) {
    return (
      <div className="space-y-6">
        <PageHeader title="Payroll" description="Manage staff payroll and commissions" />
        <StoreRequiredAlert title="Store Required for Payroll" />
      </div>
    );
  }

  if (currentStore.id === "all") {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <PageHeader title="Payroll" description="Manage staff payroll and commissions" />
        <ConsolidatedFallbackAlert pageTitle="Staff Payroll" />
      </div>
    );
  }

  const periodLabel = (p: PayrollPeriod) =>
    p.periodType === "monthly"
      ? format(parseISO(p.startDate), "MMMM yyyy")
      : `${format(parseISO(p.startDate), "MMM d")} – ${format(parseISO(p.endDate), "MMM d, yyyy")}`;
  const periodRange = (p: PayrollPeriod) =>
    `${format(parseISO(p.startDate), "d")} to ${format(parseISO(p.endDate), "d MMMM yyyy")}`;

  const totalPages = Math.max(1, Math.ceil(periods.length / PAGE_SIZE));
  const pagePeriods = periods.slice((periodsPage - 1) * PAGE_SIZE, periodsPage * PAGE_SIZE);
  const periodHref = (id: string) => appendReturnTo(`/payroll/${id}`, location, search);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll"
        description={`Staff pay for ${currentStore.name}: salary, transport, commission and deductions`}
        compact
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setLocation("/payroll/advances")}>
              <Banknote className="h-4 w-4 lg:mr-2" />
              <span className="hidden lg:inline">Advances</span>
            </Button>
            <Button variant="outline" onClick={() => setLocation("/payroll/report")}>
              <BarChart3 className="h-4 w-4 lg:mr-2" />
              <span className="hidden lg:inline">Report</span>
            </Button>
            <AddButton label="New pay period" onClick={() => setLocation("/payroll/new")} />
          </div>
        }
      />

      {/* Coverage gap warning */}
      {coverageGaps.length > 0 && (() => {
        const earliest = coverageGaps.reduce((min, g) => g.earliest_date < min ? g.earliest_date : min, coverageGaps[0].earliest_date);
        const latest   = coverageGaps.reduce((max, g) => g.latest_date   > max ? g.latest_date   : max, coverageGaps[0].latest_date);
        const totalServices = coverageGaps.reduce((s, g) => s + Number(g.service_count), 0);
        const staffNames = Array.from(new Set(coverageGaps.map(g => g.staff_name).filter(Boolean))).join(", ");
        return (
          <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-700">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <AlertDescription className="text-amber-800 dark:text-amber-300">
              <span className="font-semibold">{totalServices} service transaction{totalServices !== 1 ? "s" : ""} ({earliest} – {latest}) are not covered by any payroll period</span>
              {staffNames && <span className="text-amber-700 dark:text-amber-400"> · Staff affected: {staffNames}</span>}
              <span className="block mt-1 text-xs">Create payroll periods for those dates to include this revenue in staff earnings. If the business was on a break, no action is needed.</span>
            </AlertDescription>
          </Alert>
        );
      })()}

      {periodsLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : periods.length === 0 ? (
        <Card>
          <CardContent className="pt-6 pb-6 text-center">
            <Calendar className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">No payroll periods yet.</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => setLocation("/payroll/new")}>
              Create first period
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="rounded-xl border bg-card divide-y overflow-hidden">
            {pagePeriods.map(p => {
              const cfg = STATUS_CONFIG[p.status as keyof typeof STATUS_CONFIG];
              return (
                <Link key={p.id} href={periodHref(p.id)} className="flex items-center gap-3 p-4 hover:bg-muted/40">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{periodLabel(p)} payroll</span>
                    <span className="block text-xs text-muted-foreground capitalize">{p.periodType} · {periodRange(p)}</span>
                  </span>
                  <Badge variant="outline" className={`${cfg.color} ${cfg.bg} border`}>{cfg.label}</Badge>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              );
            })}
          </div>

          {periods.length > PAGE_SIZE && (
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={() => setPeriodsPage(prev => Math.max(1, prev - 1))} disabled={periodsPage === 1}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Newer
              </Button>
              <span className="text-xs text-muted-foreground">{periodsPage} of {totalPages}</span>
              <Button variant="ghost" size="sm" onClick={() => setPeriodsPage(prev => Math.min(totalPages, prev + 1))} disabled={periodsPage >= totalPages}>
                Older <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
