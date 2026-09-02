import { useState } from "react";
import { useRoute, Link, useLocation, useSearch } from "wouter";
import { useReturnTo } from "@/lib/return-to";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowLeft, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import { useStore } from "@/lib/store-context";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient as globalQueryClient } from "@/lib/queryClient";
import { formatCurrency as fmt, formatCurrencyCompact } from "@/lib/currency-utils";
import { splitPay } from "@shared/payroll-take-home";
import { WRITE_OFF_REASONS } from "@shared/schema";
import { explainCommission, commissionHeadline } from "@shared/commission-explainer";
import { PayrollEarningsSummary } from "@/components/payroll/PayrollEarningsSummary";
import { PayrollDeductionsList } from "@/components/payroll/PayrollDeductionsList";
import { PayrollFormulaBreakdown } from "@/components/payroll/PayrollFormulaBreakdown";
import { PayrollDailySummaryTable } from "@/components/payroll/PayrollDailySummaryTable";
import { PayrollTransactionBreakdown } from "@/components/payroll/PayrollTransactionBreakdown";
import { generatePayslipPdf } from "@/lib/generatePayslipPdf";
import type { PayrollPeriod, PayrollEntry, PayrollDrilldown } from "@shared/schema";

export default function PayrollDetailPage() {
  const [, params] = useRoute("/payroll/:periodId/staff/:staffId");
  const periodId = params?.periodId ?? "";
  const staffId = params?.staffId ?? "";
  const { backHref } = useReturnTo("/payroll");
  const [location] = useLocation();
  const search = useSearch();
  const { currentStore, business } = useStore();
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const { toast } = useToast();
  const qc = useQueryClient();
  const currency = currentStore?.currency || "NGN";
  const fmtCur = (v: number) => fmt(v, currency);
  const fmtCompact = (v: number) => formatCurrencyCompact(v, currency);

  const [showTransactions, setShowTransactions] = useState(false);
  const [showAddDeduction, setShowAddDeduction] = useState(false);
  const [dedType, setDedType] = useState("advance_recovery");
  const [dedLabel, setDedLabel] = useState("");
  const [dedAmount, setDedAmount] = useState("");
  const [debtToWriteOff, setDebtToWriteOff] = useState<any>(null);
  const [writeOffReason, setWriteOffReason] = useState("");
  const [debtToRestore, setDebtToRestore] = useState<any>(null);
  const [isGeneratingPayslip, setIsGeneratingPayslip] = useState(false);

  const { data: period, isLoading: periodLoading } = useQuery<PayrollPeriod>({
    queryKey: ["/api/payroll/periods", periodId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/payroll/periods/${periodId}`);
      return res.json();
    },
    enabled: !!periodId,
  });

  const { data: entry } = useQuery<any>({
    queryKey: ["/api/payroll/periods/entries", periodId, staffId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/payroll/periods/${periodId}/entries`);
      const entries = await res.json();
      return entries.find((e: any) => e.staffId === staffId);
    },
    enabled: !!periodId && !!staffId,
  });

  const { data: drilldownData, isLoading: breakdownLoading } = useQuery<PayrollDrilldown>({
    queryKey: ["/api/payroll/drilldown", periodId, staffId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/payroll/periods/${periodId}/entries/${staffId}/drilldown`);
      return res.json();
    },
    enabled: !!periodId && !!staffId,
  });

  const { data: deductions = [], refetch: refetchDeductions } = useQuery<any[]>({
    queryKey: ["/api/payroll/deductions", periodId, staffId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/payroll/periods/${periodId}/deductions?staffId=${staffId}`);
      return res.json();
    },
    enabled: !!periodId && !!staffId,
  });

  const addDeductionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/payroll/periods/${periodId}/deductions`, {
        staffId, type: dedType, label: dedLabel, amount: parseFloat(dedAmount),
      });
      return res.json();
    },
    onSuccess: () => {
      refetchDeductions();
      setShowAddDeduction(false);
      setDedLabel(""); setDedAmount(""); setDedType("advance_recovery");
      toast({ title: "Deduction added" });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const deleteDeductionMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/payroll/periods/${periodId}/deductions/${id}`);
    },
    // A staff-credit line is waived rather than deleted, so the wording has to
    // cover both outcomes — and must not imply the debt itself went away.
    onSuccess: () => { refetchDeductions(); toast({ title: "Deduction removed from this period" }); },
  });

  // Waiving forgives the debt outright: the line is skipped AND the Borrow Book
  // entry is written off as operational bad debt. One-way, hence the dialog.
  const writeOffDebtMutation = useMutation({
    mutationFn: async (deductionId: string) => {
      await apiRequest("POST", `/api/payroll/periods/${periodId}/deductions/${deductionId}/write-off`, {
        reason: writeOffReason,
      });
    },
    onSuccess: () => {
      refetchDeductions();
      qc.invalidateQueries({ queryKey: ["/api/credit/ledger"] });
      setDebtToWriteOff(null);
      setWriteOffReason("");
      toast({ title: "Debt waived and written off as bad debt" });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  // Undoes the write-off above: the debt returns at the balance it had and the
  // waived line is proposed again. Goes to the Borrow Book's own endpoint, which
  // owns the guard about not disturbing an already-reported month.
  const restoreDebtMutation = useMutation({
    mutationFn: async (creditEntryId: string) => {
      await apiRequest("POST", `/api/credit/entries/${creditEntryId}/restore-write-off`);
    },
    onSuccess: () => {
      refetchDeductions();
      qc.invalidateQueries({ queryKey: ["/api/credit/ledger"] });
      setDebtToRestore(null);
      toast({ title: "Debt restored and deduction proposed again" });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const restoreDeductionMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/payroll/periods/${periodId}/deductions/${id}/restore`);
    },
    onSuccess: () => { refetchDeductions(); toast({ title: "Deduction restored" }); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  // Waived lines were explicitly excluded by a manager: they are shown for
  // transparency but never come out of pay.
  const activeDeductions = deductions.filter((d: any) => !d.isWaived);
  const totalDeductions = activeDeductions.reduce((s: number, d: any) => s + Number(d.amount), 0);

  // The entries endpoint already returns this split, but it is re-derived here
  // from the live deductions query so adding or waiving a line updates the
  // headline immediately rather than after the entries query refetches. Same
  // shared function the settlement close and the posting ledger use, so the
  // zero floor is identical everywhere.
  const { grossPay, takeHomePay, shortfall } = splitPay(entry?.netPay || 0, totalDeductions);

  const dailySummary = drilldownData?.dailySummary || [];
  const breakdown = drilldownData?.transactions || [];
  const reconciliation = drilldownData?.reconciliation ?? null;

  // Why the commission is what it is — above all, why it is zero. Prefer the
  // explanation snapshotted when the period was calculated (a paid period keeps
  // the one that matches its figures); fall back to deriving it for entries
  // that predate the snapshot.
  const commissionExplanation = drilldownData?.reconciliation?.explanation
    ?? explainCommission({ ...(entry?.calculationDetails ?? {}), grossCommission: entry?.grossCommission });
  const commissionNote = commissionHeadline(commissionExplanation, fmtCur);

  const isPeriodOngoing = period ? new Date(period.endDate) > new Date() : false;

  const handleDownloadPayslip = async () => {
    if (!entry || !period || !currentStore) return;
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
        <Link href={backHref}>
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
        isOwner={isOwner}
        totalDeductions={totalDeductions}
        fmtCur={fmtCur}
        location={location}
        search={search}
        showAddDeduction={showAddDeduction}
        setShowAddDeduction={setShowAddDeduction}
        dedType={dedType}
        setDedType={setDedType}
        dedLabel={dedLabel}
        setDedLabel={setDedLabel}
        dedAmount={dedAmount}
        setDedAmount={setDedAmount}
        addDeductionMutation={addDeductionMutation}
        deleteDeductionMutation={deleteDeductionMutation}
        restoreDeductionMutation={restoreDeductionMutation}
        setDebtToWriteOff={setDebtToWriteOff}
        setDebtToRestore={setDebtToRestore}
      />

      <PayrollFormulaBreakdown calculationDetails={entry?.calculationDetails} fmtCur={fmtCur} />

      {period?.status === "paid" && (
        <Alert>
          <Lock className="h-4 w-4" />
          <AlertDescription>This payroll period is locked. All records shown are final and immutable based on settings snapshot.</AlertDescription>
        </Alert>
      )}

      <PayrollDailySummaryTable dailySummary={dailySummary} isLoading={breakdownLoading} fmtCur={fmtCur} />

      <PayrollTransactionBreakdown
        breakdown={breakdown}
        isLoading={breakdownLoading}
        reconciliation={reconciliation}
        commissionNote={commissionNote}
        showTransactions={showTransactions}
        onToggle={() => setShowTransactions(!showTransactions)}
        fmtCur={fmtCur}
      />

      <AlertDialog
        open={!!debtToWriteOff}
        onOpenChange={(open) => { if (!open) { setDebtToWriteOff(null); setWriteOffReason(""); } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Waive this debt?</AlertDialogTitle>
            <AlertDialogDescription>
              Write off {entry?.staff?.name ?? "this staff member"}'s balance of{" "}
              {fmtCur(Number(debtToWriteOff?.amount ?? 0))} as unrecoverable operational bad debt expense.
              The deduction is removed from this payroll and the debt is closed in the Borrow Book —
              it will not carry forward.
              <span className="block mt-2">
                To recover it in a later period instead, use <strong>Skip this period</strong>.
                This can be undone from here or the Borrow Book while the period is still open.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="payroll-writeoff-reason" className="text-xs">Reason for Write-Off (Mandatory)</Label>
            <Select value={writeOffReason} onValueChange={setWriteOffReason}>
              <SelectTrigger id="payroll-writeoff-reason" className="h-8 text-xs">
                <SelectValue placeholder="Select a reason…" />
              </SelectTrigger>
              <SelectContent>
                {WRITE_OFF_REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={writeOffDebtMutation.isPending || !writeOffReason.trim()}
              onClick={() => debtToWriteOff && writeOffDebtMutation.mutate(debtToWriteOff.id)}
            >
              {writeOffDebtMutation.isPending ? "Writing off…" : "Waive & write off"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!debtToRestore} onOpenChange={(open) => !open && setDebtToRestore(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this debt?</AlertDialogTitle>
            <AlertDialogDescription>
              {debtToRestore?.creditEntry?.description ?? "This debt"} comes back to the Borrow Book at
              the balance it had before it was written off, and the deduction is proposed against this
              payroll again.
              <span className="block mt-2">
                The bad debt expense is removed from this month's profit &amp; loss.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={restoreDebtMutation.isPending}
              onClick={() => debtToRestore?.creditEntryId && restoreDebtMutation.mutate(debtToRestore.creditEntryId)}
            >
              {restoreDebtMutation.isPending ? "Restoring…" : "Restore debt"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
