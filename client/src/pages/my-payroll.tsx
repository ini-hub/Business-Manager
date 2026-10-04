import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { format, parseISO } from "date-fns";
import { Wallet, TrendingUp, Clock, ChevronRight, History, AlertCircle, CalendarCheck, Download, Filter } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/icon-button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MetricCard } from "@/components/metric-card";
import { MetricGrid } from "@/components/metric-grid";
import { Skeleton } from "@/components/ui/skeleton";
import { useStore } from "@/lib/store-context";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatCurrency as formatCurrencyUtil, formatCurrencyCompact } from "@/lib/currency-utils";
import { commissionHeadline } from "@shared/commission-explainer";
import { generatePayslipPdf } from "@/lib/generatePayslipPdf";
import { PeriodFilter, usePeriodFilter } from "@/components/period-filter";
import { useAttendanceTracked } from "@/hooks/useAttendanceTracked";
import { overlapsRange } from "@/lib/period-range";

const PERIOD_TYPE_LABELS: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
};

/**
 * The staff self-service payroll module's home: current-period summary plus
 * filterable paid history, each row downloadable on the spot or linking into
 * the full breakdown at /staff/payroll/:periodId (my-payroll-detail.tsx).
 * Self-scoped mirror of the admin /payroll list.
 */
export default function MyPayrollPage() {
  const { currentStore, business } = useStore();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const currency = currentStore?.currency || "NGN";
  const formatCurrency = (val: number) => formatCurrencyUtil(val, currency);
  const formatCompact = (val: number) => formatCurrencyCompact(val, currency);

  // Paid history defaults to the whole year: the open period isn't paid yet, so
  // defaulting to it would open on an empty list.
  const filter = usePeriodFilter("year");
  const { tracked: attendanceTracked } = useAttendanceTracked();
  const [typeFilter, setTypeFilter] = useState("all");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const { data: summary, isLoading: isSummaryLoading } = useQuery<any>({
    queryKey: ["/api/payroll/my-summary", currentStore?.id],
    enabled: !!currentStore?.id,
  });

  const { data: history = [], isLoading: isHistoryLoading } = useQuery<any[]>({
    queryKey: ["/api/payroll/my-history", currentStore?.id],
    enabled: !!currentStore?.id,
  });

  // Newest first — paidAt is when the money actually moved, so that's what
  // "recent" means here rather than the period's own date range.
  const sortedHistory = useMemo(
    () => [...history].sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime()),
    [history],
  );

  const periodTypes = useMemo(
    () => Array.from(new Set(sortedHistory.map((h: any) => h.periodType).filter(Boolean))),
    [sortedHistory],
  );

  const filteredHistory = useMemo(() => sortedHistory.filter((h: any) =>
    overlapsRange(h, filter.range) &&
    (typeFilter === "all" || h.periodType === typeFilter)
  ), [sortedHistory, filter.range, typeFilter]);

  const totals = useMemo(() => filteredHistory.reduce(
    (t: any, h: any) => ({
      takeHome: t.takeHome + (h.takeHomePay ?? h.netPay ?? 0),
      gross: t.gross + (h.grossPay ?? h.netPay ?? 0),
      deductions: t.deductions + (h.deductionsTotal ?? 0),
    }),
    { takeHome: 0, gross: 0, deductions: 0 },
  ), [filteredHistory]);

  // Pulls the same breakdown the detail page renders, then builds the PDF —
  // so a payslip can be pulled straight from the list without opening a
  // period first. Used for both a history row and the current period.
  const handleDownload = async (periodId: string) => {
    if (!currentStore) return;
    setDownloadingId(periodId);
    try {
      const res = await apiRequest("GET", `/api/payroll/my-breakdown/${periodId}?storeId=${currentStore.id}`);
      const data = await res.json();
      const { entry, deductions = [], period, commissionExplanation, grossPay, takeHomePay, shortfall } = data;
      if (!entry || !period) {
        toast({ title: "Nothing to download for this period yet", variant: "destructive" });
        return;
      }
      const activeDeductions = deductions.filter((d: any) => !d.isWaived);
      const isPeriodOngoing = new Date(period.endDate) > new Date();
      await generatePayslipPdf({
        entry, period, activeDeductions, grossPay, takeHomePay, shortfall,
        currency, bizName: business?.name || "Business", storeName: currentStore?.name || "",
        commissionExplanation, isPeriodOngoing,
      });
    } catch {
      toast({ title: "Could not generate payslip", variant: "destructive" });
    } finally {
      setDownloadingId(null);
    }
  };

  if (isSummaryLoading) {
    return <div className="p-8 space-y-6"><Skeleton className="h-40 w-full" /><MetricGrid><Skeleton className="h-24 sm:h-32" /><Skeleton className="h-24 sm:h-32" /></MetricGrid></div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="My Payroll" description="Your earnings, deductions, and the breakdown behind each figure" compact />

      <MetricGrid>
        <MetricCard
          title="Est. Take-Home Pay"
          value={formatCurrency(summary?.takeHomePay ?? summary?.earnings ?? 0)}
          compactValue={formatCompact(summary?.takeHomePay ?? summary?.earnings ?? 0)}
          icon={<Wallet className="h-4 w-4 opacity-70" />}
          description={
            (summary?.deductionsTotal ?? 0) > 0
              ? `Gross ${formatCurrency(summary.grossPay)} − deductions ${formatCurrency(summary.deductionsTotal)} · ${summary?.period?.label || "None"}`
              : `Current Period: ${summary?.period?.label || "None"}`
          }
          className="bg-primary text-primary-foreground [&_p]:text-primary-foreground/70 [&_.text-muted-foreground]:text-primary-foreground/70"
          href={summary?.period?.id ? `/staff/payroll/${summary.period.id}` : undefined}
        />
        <MetricCard
          title="Commission Earned"
          value={formatCurrency(summary?.commission || 0)}
          compactValue={formatCompact(summary?.commission || 0)}
          icon={<TrendingUp className="h-4 w-4" />}
          description={
            summary?.commissionExplanation
              ? commissionHeadline(summary.commissionExplanation, formatCurrency)
              : "From services rendered"
          }
        />
        <MetricCard
          title="Transport Allowance"
          value={formatCurrency(summary?.transport || 0)}
          compactValue={formatCompact(summary?.transport || 0)}
          icon={<Clock className="h-4 w-4" />}
          description="Based on present days"
        />
        {attendanceTracked && (
          <MetricCard
            title="Attendance (Present)"
            value={summary?.attendance?.present || 0}
            icon={<CalendarCheck className="h-4 w-4" />}
            description={`${summary?.attendance?.absent || 0} absent this period`}
          />
        )}
      </MetricGrid>

      {summary?.period?.id && (
        <div className="flex items-center justify-end gap-4">
          <Button
            variant="ghost" size="sm" className="h-8 text-xs gap-2"
            disabled={downloadingId === summary.period.id}
            onClick={() => handleDownload(summary.period.id)}
          >
            <Download className="h-3.5 w-3.5" />
            {downloadingId === summary.period.id ? "Generating…" : "Download current payslip"}
          </Button>
          <Link href={`/staff/payroll/${summary.period.id}`} className="text-sm font-medium text-primary hover:underline flex items-center gap-1">
            View full breakdown <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Payment History
              </CardTitle>
              <CardDescription>Your past paid salaries — pick a period, tap for a breakdown, or download a payslip</CardDescription>
            </div>
          </div>
          <PeriodFilter filter={filter} />
          {periodTypes.length > 1 && (
            <div className="flex items-center gap-2 flex-wrap">
              <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue placeholder="Period type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All period types</SelectItem>
                  {periodTypes.map(t => <SelectItem key={t} value={t}>{PERIOD_TYPE_LABELS[t] || t}</SelectItem>)}
                </SelectContent>
              </Select>
              {typeFilter !== "all" && (
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setTypeFilter("all")}>
                  Clear
                </Button>
              )}
            </div>
          )}
          {!isHistoryLoading && sortedHistory.length > 0 && (
            <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-3 text-center" data-testid="payroll-totals">
              <div>
                <p className="text-[11px] text-muted-foreground">Paid out</p>
                <p className="font-mono text-sm font-bold md:text-base">{formatCurrency(totals.takeHome)}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Gross</p>
                <p className="font-mono text-sm font-bold md:text-base">{formatCurrency(totals.gross)}</p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Deductions</p>
                <p className="font-mono text-sm font-bold md:text-base">{formatCurrency(totals.deductions)}</p>
              </div>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isHistoryLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : sortedHistory.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-20" />
              <p>No payment records found yet.</p>
            </div>
          ) : filteredHistory.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-20" />
              <p>No payments in this period.</p>
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => { filter.setKey("year"); setTypeFilter("all"); }}>Show this year</Button>
            </div>
          ) : (
            <div className="divide-y">
              {filteredHistory.map((item: any) => (
                <div
                  key={item.id}
                  className="py-4 flex items-center justify-between group hover:bg-muted/50 transition-colors px-2 rounded-lg cursor-pointer"
                  onClick={() => navigate(`/staff/payroll/${item.id}`)}
                >
                  <div className="flex flex-col min-w-0">
                    <span className="font-semibold text-sm">{item.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {format(parseISO(item.startDate), "MMM d")} - {format(parseISO(item.endDate), "MMM d, yyyy")}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      {/* What was actually paid out on the day. */}
                      <div className="font-bold text-sm">{formatCurrency(item.takeHomePay ?? item.netPay)}</div>
                      {(item.deductionsTotal ?? 0) > 0 && (
                        <div className="text-[11px] text-muted-foreground">
                          gross {formatCurrency(item.grossPay ?? item.netPay)} − {formatCurrency(item.deductionsTotal)}
                        </div>
                      )}
                      <span className="text-[11px] text-green-600 font-medium">PAID</span>
                    </div>
                    <IconButton
                      label="Download payslip PDF"
                      variant="ghost" className="h-8 w-8 shrink-0"
                      disabled={downloadingId === item.id}
                      onClick={(e) => { e.stopPropagation(); handleDownload(item.id); }}
                    >
                      <Download className={`h-4 w-4 ${downloadingId === item.id ? "animate-pulse" : ""}`} />
                    </IconButton>
                    <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
