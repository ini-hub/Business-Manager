import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowLeft, Lock, TrendingUp, Calendar, ChevronDown, ChevronUp, Bus, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useStore } from "@/lib/store-context";
import { apiRequest } from "@/lib/queryClient";
import { formatCurrency as fmt } from "@/lib/currency-utils";
import type { PayrollPeriod, PayrollEntry, CommissionBreakdown, DailySummaryLine } from "@shared/schema";

const ROLE_CONFIG = {
  lead:        { label: "Lead",      color: "text-primary bg-primary/10 border-primary/20" },
  assistant_1: { label: "Asst. #1",  color: "text-blue-700 bg-blue-50 dark:bg-blue-950 border-blue-200" },
  assistant_2: { label: "Asst. #2",  color: "text-purple-700 bg-purple-50 dark:bg-purple-950 border-purple-200" },
};

export default function PayrollDetailPage() {
  const [, params] = useRoute("/payroll/:periodId/staff/:staffId");
  const periodId = params?.periodId ?? "";
  const staffId = params?.staffId ?? "";
  const { currentStore } = useStore();
  const currency = currentStore?.currency || "NGN";
  const fmtCur = (v: number) => fmt(v, currency);

  const [showTransactions, setShowTransactions] = useState(false);

  const { data: period, isLoading: periodLoading } = useQuery<PayrollPeriod>({
    queryKey: ["/api/payroll/periods", periodId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/payroll/periods/${periodId}`);
      return res.json();
    },
    enabled: !!periodId,
  });

  const { data: entry } = useQuery<any>({
    queryKey: ["/api/payroll/periods/entries", periodId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/payroll/periods/${periodId}/entries`);
      const entries = await res.json();
      return entries.find((e: any) => e.staffId === staffId);
    },
    enabled: !!periodId && !!staffId,
  });

  const { data: drilldownData, isLoading: breakdownLoading } = useQuery<{ dailySummary: DailySummaryLine[]; transactions: CommissionBreakdown[] }>({
    queryKey: ["/api/payroll/drilldown", periodId, staffId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/payroll/periods/${periodId}/entries/${staffId}/drilldown`);
      return res.json();
    },
    enabled: !!periodId && !!staffId,
  });

  const dailySummary = drilldownData?.dailySummary || [];
  const breakdown = drilldownData?.transactions || [];

  const totalEarned = breakdown.reduce((sum, b) => sum + b.earned, 0);

  if (periodLoading) {
    return (
      <div className="space-y-4 p-6">
        {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back navigation */}
      <div className="flex items-center gap-3">
        <Link href="/payroll">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Payroll
          </Button>
        </Link>
      </div>

      {/* Staff + period header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {entry?.staff?.name ?? "Staff Member"}
          </h1>
          <p className="text-muted-foreground mt-0.5">
            Hybrid Drill-Down Dashboard
            {period && (
              <> · {format(parseISO(period.startDate), "MMM d")} – {format(parseISO(period.endDate), "MMM d, yyyy")}</>
            )}
          </p>
        </div>
        {period?.status === "paid" && (
          <Badge variant="outline" className="text-emerald-700 bg-emerald-50 dark:bg-emerald-950 border-emerald-200 gap-1.5">
            <Lock className="h-3 w-3" />
            Paid & Locked
          </Badge>
        )}
      </div>

      {/* Summary cards */}
      {entry && (
        <div className="grid gap-4 sm:grid-cols-4">
          {[
            { label: "Active Days", value: `${entry.activeDays || 0} days`, sub: "Assigned to services" },
            { label: "Passive Days", value: `${entry.passiveDays || 0} days`, sub: "Present, no service" },
            { label: "Total Transport", value: fmtCur(entry.totalTransport || 0), sub: "Daily transport allowances" },
            { label: "Gross Commission", value: fmtCur(entry.grossCommission || 0), sub: "Proportional split pools" },
          ].map(card => (
            <Card key={card.label}>
              <CardContent className="pt-5">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{card.label}</p>
                <p className="text-xl font-bold mt-1 font-mono text-primary">{card.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{card.sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Final Net Pay Callout */}
      {entry && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex items-center justify-between py-4 flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <DollarSign className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Final Net Pay</p>
                <p className="text-2xl font-bold font-mono text-primary">{fmtCur(entry.netPay || 0)}</p>
              </div>
            </div>
            <div className="text-xs text-muted-foreground text-right sm:text-left">
              Sum of Total Transport + Gross Commission earned for this period.
            </div>
          </CardContent>
        </Card>
      )}

      {period?.status === "paid" && (
        <Alert>
          <Lock className="h-4 w-4" />
          <AlertDescription>This payroll period is locked. All records shown are final and immutable based on settings snapshot.</AlertDescription>
        </Alert>
      )}

      {/* Daily Summary Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Daily Summary Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          {breakdownLoading ? (
            <div className="space-y-2">
              {[1,2,3].map(i => <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />)}
            </div>
          ) : dailySummary.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">No daily summary records found for this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground font-medium">
                    <th className="text-left py-2 pr-4">Date</th>
                    <th className="text-center py-2 px-3">Day Type</th>
                    <th className="text-right py-2 px-3">Transport</th>
                    <th className="text-left py-2 px-3">Services Rendered</th>
                    <th className="text-right py-2 px-3">Commission Earned</th>
                    <th className="text-right py-2 pl-3">Daily Total</th>
                  </tr>
                </thead>
                <tbody>
                  {dailySummary.map((d, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="py-2.5 pr-4 whitespace-nowrap text-xs text-muted-foreground font-medium">
                        {format(parseISO(d.date), "EEE, MMM d, yyyy")}
                      </td>
                      <td className="text-center py-2.5 px-3 whitespace-nowrap">
                        <Badge variant="outline" className={
                          d.dayType === "Active" 
                            ? "text-emerald-700 bg-emerald-50 dark:bg-emerald-950 border-emerald-200" 
                            : "text-amber-700 bg-amber-50 dark:bg-amber-950 border-amber-200"
                        }>
                          {d.dayType}
                        </Badge>
                      </td>
                      <td className="text-right py-2.5 px-3 font-mono text-xs">{fmtCur(d.transport)}</td>
                      <td className="text-left py-2.5 px-3 text-xs max-w-xs truncate" title={d.servicesWorked}>
                        {d.servicesWorked}
                      </td>
                      <td className="text-right py-2.5 px-3 font-mono text-xs font-semibold">{fmtCur(d.commissionEarned)}</td>
                      <td className="text-right py-2.5 pl-3 font-mono text-xs font-bold text-primary">{fmtCur(d.dailyTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Expandable detailed transaction breakdown */}
      <Card>
        <CardHeader className="pb-2 cursor-pointer select-none hover:bg-muted/10 transition-colors rounded-t-lg" onClick={() => setShowTransactions(!showTransactions)}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Detailed Transaction Commission Breakdown ({breakdown.length})
            </CardTitle>
            <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs">
              {showTransactions ? (
                <>Hide Details <ChevronUp className="h-3 w-3" /></>
              ) : (
                <>Show Details <ChevronDown className="h-3 w-3" /></>
              )}
            </Button>
          </div>
        </CardHeader>
        {showTransactions && (
          <>
            <Separator />
            <CardContent className="pt-4">
              {breakdownLoading ? (
                <div className="space-y-2">
                  {[1,2,3].map(i => <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />)}
                </div>
              ) : breakdown.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-8">No service commissions found for this staff member in this period.</p>
              ) : (
                <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <div className="min-w-[800px]">
                    {/* Header */}
                    <div className="grid grid-cols-12 gap-2 text-xs text-muted-foreground font-medium py-2 border-b">
                      <div className="col-span-2">Date</div>
                      <div className="col-span-1 text-center">Receipt</div>
                      <div className="col-span-3">Service</div>
                      <div className="col-span-2 text-center">Role</div>
                      <div className="col-span-1 text-right">Price</div>
                      <div className="col-span-1 text-right">Pool</div>
                      <div className="col-span-1 text-right">Share</div>
                      <div className="col-span-1 text-right">Earned</div>
                    </div>

                    {/* Rows */}
                    {breakdown.map((b, i) => {
                      const roleCfg = ROLE_CONFIG[b.role];
                      return (
                        <div
                          key={`${b.checkoutId}-${i}`}
                          className="grid grid-cols-12 gap-2 py-2.5 border-b last:border-0 text-sm hover:bg-muted/20 rounded-md px-1 transition-colors"
                        >
                          <div className="col-span-2 text-xs text-muted-foreground self-center">
                            {format(parseISO(b.transactionDate), "MMM d")}
                          </div>
                          <div className="col-span-1 text-xs font-mono text-muted-foreground self-center truncate">
                            {b.receiptNumber.split("-").slice(-1)[0]}
                          </div>
                          <div className="col-span-3 font-medium self-center truncate text-xs" title={b.inventoryName}>
                            {b.inventoryName}
                          </div>
                          <div className="col-span-2 text-center self-center">
                            <Badge variant="outline" className={`text-xs ${roleCfg.color} border`}>
                              {roleCfg.label}
                            </Badge>
                          </div>
                          <div className="col-span-1 text-right font-mono text-xs self-center">{fmtCur(b.serviceAmount)}</div>
                          <div className="col-span-1 text-right font-mono text-xs text-muted-foreground self-center">{fmtCur(b.commissionPool)}</div>
                          <div className="col-span-1 text-right text-xs text-muted-foreground self-center">{(b.share * 100).toFixed(0)}%</div>
                          <div className="col-span-1 text-right font-semibold font-mono text-xs self-center">{fmtCur(b.earned)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
            {breakdown.length > 0 && (
              <>
                <Separator />
                <CardFooter className="justify-between pt-4">
                  <span className="text-sm font-semibold">Total Transaction Commission</span>
                  <span className="text-lg font-bold font-mono text-primary">{fmtCur(totalEarned)}</span>
                </CardFooter>
              </>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
