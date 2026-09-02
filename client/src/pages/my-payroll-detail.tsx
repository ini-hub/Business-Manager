import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowLeft, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useStore } from "@/lib/store-context";
import { apiRequest } from "@/lib/queryClient";
import { formatCurrency as fmt, formatCurrencyCompact } from "@/lib/currency-utils";
import { commissionHeadline } from "@shared/commission-explainer";
import { PayrollEarningsSummary } from "@/components/payroll/PayrollEarningsSummary";
import { PayrollDeductionsList } from "@/components/payroll/PayrollDeductionsList";
import { PayrollFormulaBreakdown } from "@/components/payroll/PayrollFormulaBreakdown";
import { PayrollDailySummaryTable } from "@/components/payroll/PayrollDailySummaryTable";
import { PayrollTransactionBreakdown } from "@/components/payroll/PayrollTransactionBreakdown";
import { generatePayslipPdf } from "@/lib/generatePayslipPdf";
import type { PayrollDrilldown, PayrollPeriod } from "@shared/schema";

type MyBreakdown = {
  period: PayrollPeriod & { label: string };
  entry: any;
  deductions: any[];
  drilldown: PayrollDrilldown;
  commissionExplanation: any;
  grossPay: number;
  deductionsTotal: number;
  takeHomePay: number;
  shortfall: number;
};

/**
 * The staff-facing mirror of payroll-detail.tsx: the same breakdown a
 * manager sees at /payroll/:periodId/staff/:staffId, scoped server-side to
 * the caller's own staff record and rendered read-only — no deduction
 * management, just the reasoning behind the pay.
 */
export default function MyPayrollDetailPage() {
  const [, params] = useRoute("/staff/payroll/:periodId");
  const periodId = params?.periodId ?? "";
  const { currentStore, business } = useStore();
  const currency = currentStore?.currency || "NGN";
  const fmtCur = (v: number) => fmt(v, currency);
  const fmtCompact = (v: number) => formatCurrencyCompact(v, currency);

  const [showTransactions, setShowTransactions] = useState(false);
  const [isGeneratingPayslip, setIsGeneratingPayslip] = useState(false);

  const { data, isLoading } = useQuery<MyBreakdown>({
    queryKey: ["/api/payroll/my-breakdown", periodId, currentStore?.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/payroll/my-breakdown/${periodId}?storeId=${currentStore?.id}`);
      return res.json();
    },
    enabled: !!periodId && !!currentStore?.id,
  });

  const { period, entry, deductions = [], drilldown, commissionExplanation } = data ?? {};
  const grossPay = data?.grossPay ?? 0;
  const takeHomePay = data?.takeHomePay ?? 0;
  const shortfall = data?.shortfall ?? 0;
  const totalDeductions = data?.deductionsTotal ?? 0;
  const activeDeductions = deductions.filter((d: any) => !d.isWaived);

  const commissionNote = commissionExplanation ? commissionHeadline(commissionExplanation, fmtCur) : "";

  const isPeriodOngoing = period ? new Date(period.endDate) > new Date() : false;

  const handleDownloadPayslip = async () => {
    if (!entry || !period || !currentStore || !commissionExplanation) return;
    setIsGeneratingPayslip(true);
    try {
      await generatePayslipPdf({
        entry, period, activeDeductions, grossPay, takeHomePay, shortfall,
        currency, bizName: business?.name || "Business", storeName: currentStore?.name || "",
        commissionExplanation, isPeriodOngoing,
      });
    } finally {
      setIsGeneratingPayslip(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/staff/payroll">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to My Payroll
          </Button>
        </Link>
      </div>

      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold">My Payroll Breakdown</h1>
          <p className="text-muted-foreground mt-0.5">
            {period && (
              <>{format(parseISO(period.startDate), "MMM d")} – {format(parseISO(period.endDate), "MMM d, yyyy")}</>
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

      <PayrollEarningsSummary
        entry={entry}
        commissionNote={commissionNote}
        grossPay={grossPay}
        takeHomePay={takeHomePay}
        shortfall={shortfall}
        totalDeductions={totalDeductions}
        isPeriodOngoing={isPeriodOngoing}
        fmtCur={fmtCur}
        fmtCompact={fmtCompact}
        onDownloadPayslip={handleDownloadPayslip}
        isDownloading={isGeneratingPayslip}
      />

      <PayrollDeductionsList
        deductions={deductions}
        periodStatus={period?.status}
        isOwner={false}
        totalDeductions={totalDeductions}
        fmtCur={fmtCur}
        readOnly
      />

      <PayrollFormulaBreakdown calculationDetails={entry?.calculationDetails} fmtCur={fmtCur} />

      {period?.status === "paid" && (
        <Alert>
          <Lock className="h-4 w-4" />
          <AlertDescription>This payroll period is locked. All records shown are final.</AlertDescription>
        </Alert>
      )}

      <PayrollDailySummaryTable dailySummary={drilldown?.dailySummary ?? []} isLoading={isLoading} fmtCur={fmtCur} />

      <PayrollTransactionBreakdown
        breakdown={drilldown?.transactions ?? []}
        isLoading={isLoading}
        reconciliation={drilldown?.reconciliation ?? null}
        commissionNote={commissionNote}
        showTransactions={showTransactions}
        onToggle={() => setShowTransactions(!showTransactions)}
        fmtCur={fmtCur}
      />
    </div>
  );
}
