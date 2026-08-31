import { useState } from "react";
import { useRoute, Link, useLocation, useSearch } from "wouter";
import { useReturnTo, appendReturnTo } from "@/lib/return-to";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowLeft, Lock, TrendingUp, Calendar, ChevronDown, ChevronUp, DollarSign, Printer, Minus, Plus, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
import { MetricCard } from "@/components/metric-card";
import { MetricGrid } from "@/components/metric-grid";
import { splitPay } from "@shared/payroll-take-home";
import { WRITE_OFF_REASONS } from "@shared/schema";
import { explainCommission, commissionHeadline, needsExplanation } from "@shared/commission-explainer";
import type { PayrollPeriod, PayrollEntry, PayrollDrilldown } from "@shared/schema";

const ROLE_CONFIG = {
  lead:        { label: "Lead",      color: "text-primary bg-primary/10 border-primary/20" },
  assistant_1: { label: "Asst. #1",  color: "text-blue-700 bg-blue-50 dark:bg-blue-950 border-blue-200" },
  assistant_2: { label: "Asst. #2",  color: "text-purple-700 bg-purple-50 dark:bg-purple-950 border-purple-200" },
};

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

  const totalRevenueShare = breakdown.reduce((sum, b) => sum + b.revenueShare, 0);
  const reconciliation = drilldownData?.reconciliation ?? null;

  // Why the commission is what it is — above all, why it is zero. Prefer the
  // explanation snapshotted when the period was calculated (a paid period keeps
  // the one that matches its figures); fall back to deriving it for entries
  // that predate the snapshot.
  const commissionExplanation = drilldownData?.reconciliation?.explanation
    ?? explainCommission({ ...(entry?.calculationDetails ?? {}), grossCommission: entry?.grossCommission });
  const commissionNote = commissionHeadline(commissionExplanation, fmtCur);

  const isPeriodOngoing = period ? new Date(period.endDate) > new Date() : false;

  const printPayslip = async () => {
    if (!entry || !period || !currentStore) return;
    const { jsPDF } = await import("jspdf");
    const QRCode = (await import("qrcode")).default;
    const doc = new jsPDF({ unit: "mm", format: "a5" });

    // ₦ (U+20A6) is outside Latin-1 — jsPDF built-in fonts silently degrade it
    const pdfFmt = (v: number) => fmtCur(v).replace(/₦/g, "NGN ");

    // Layout
    const W = 148;
    const L = 14;
    const R = 134;
    const C = (L + R) / 2;

    // Palette
    const NAVY:  [number,number,number] = [26,  35,  79];
    const WHITE: [number,number,number] = [255, 255, 255];
    const STRIPE:[number,number,number] = [245, 246, 250];
    const LABEL: [number,number,number] = [110, 115, 135];
    const BODY:  [number,number,number] = [35,  40,  58];
    const GREEN: [number,number,number] = [21,  128, 61];
    const RED:   [number,number,number] = [180, 35,  35];

    const gross     = grossPay;
    const net       = takeHomePay;
    const bizName   = business?.name || "Business";
    const storeName = currentStore?.name || "";
    const per       = `${format(parseISO(period.startDate), "MMM d")} – ${format(parseISO(period.endDate), "MMM d, yyyy")}`;

    // Register with backend to get a verifiable document ID
    let docId: string | null = null;
    try {
      const res = await fetch("/api/payroll/payslips/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ storeId: currentStore.id, periodId: period.id, staffId: entry.staffId, grossPay: gross, netPay: net }),
      });
      if (res.ok) {
        const record = await res.json();
        docId = record.id;
      }
    } catch { /* non-blocking — PDF still generates without a doc ID */ }

    // Pre-render QR code as a data URL (points to the public verify page)
    let qrDataUrl: string | null = null;
    if (docId) {
      try {
        const verifyUrl = `${window.location.origin}/verify/payslip/${docId}`;
        qrDataUrl = await QRCode.toDataURL(verifyUrl, { width: 80, margin: 1, color: { dark: "#1a2350", light: "#ffffff" } });
      } catch { /* skip QR on failure */ }
    }

    // ── Header band ───────────────────────────────────────────────────────────
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, W, 32, "F");

    doc.setTextColor(...WHITE);
    doc.setFontSize(20); doc.setFont("helvetica", "bold");
    doc.text("PAYSLIP", L, 16);

    doc.setFontSize(9); doc.setFont("helvetica", "bold");
    doc.text(bizName, R, 10, { align: "right" });
    doc.setFontSize(8); doc.setFont("helvetica", "normal");
    if (storeName) doc.text(storeName, R, 17, { align: "right" });
    doc.setFontSize(7.5);
    doc.text(`Period: ${per}`, R, storeName ? 24 : 18, { align: "right" });

    // ── Staff info block ──────────────────────────────────────────────────────
    doc.setTextColor(...NAVY);
    doc.setFontSize(13); doc.setFont("helvetica", "bold");
    doc.text(entry.staff?.name || "Staff", L, 44);

    doc.setFontSize(8); doc.setFont("helvetica", "normal");
    doc.setTextColor(...LABEL);
    doc.text(`Staff #: ${entry.staff?.staffNumber || "—"}`, L, 51);
    if (entry.staff?.role) {
      doc.text(entry.staff.role.toUpperCase(), R, 51, { align: "right" });
    }

    doc.setDrawColor(210, 213, 225);
    doc.setLineWidth(0.3);
    doc.line(L, 55, R, 55);

    /**
     * The commission derivation, indented under the Gross Commission row.
     *
     * Silent when the figure needs no defending. Otherwise: the reason in
     * words, then the arithmetic that produced it — so a staff member holding
     * a slip that reads NGN 0.00 can see the transport offset that consumed it
     * rather than assuming the system lost their money.
     */
    const writeCommissionNote = (yStart: number): number => {
      if (!needsExplanation(commissionExplanation)) return yStart;

      let ny = yStart;
      doc.setFontSize(6.5); doc.setFont("helvetica", "italic");
      doc.setTextColor(...LABEL);
      for (const line of doc.splitTextToSize(commissionNote, R - L - 6) as string[]) {
        doc.text(line, L + 4, ny);
        ny += 3.6;
      }

      doc.setFont("helvetica", "normal");
      for (const step of commissionExplanation.steps) {
        const amount = step.format === "count" ? String(step.value) : pdfFmt(step.value);
        doc.text(step.label, L + 6, ny);
        doc.text(step.kind === "less" ? `- ${amount}` : amount, R - 2, ny, { align: "right" });
        ny += 3.6;
      }

      return ny + 2.5;
    };

    // ── Earnings ──────────────────────────────────────────────────────────────
    let y = 63;

    doc.setFontSize(7); doc.setFont("helvetica", "bold");
    doc.setTextColor(...LABEL);
    doc.text("EARNINGS", L, y);
    y += 5;

    // Only what actually went into `gross`. A fixed-salary staff member is paid
    // the base and nothing else, and a commission-only one gets no base — the
    // slip used to print all three lines regardless, so the earnings did not
    // add up to the total printed directly beneath them.
    const paymentMethod = entry.calculationDetails?.paymentMethod;
    const earningsRows: { label: string; value: number | null; note?: string }[] = [];

    if (paymentMethod !== "commission") {
      earningsRows.push({ label: "Base Salary", value: entry.calculationDetails?.baseSalary || 0 });
    }
    if (paymentMethod !== "fixed") {
      earningsRows.push({ label: "Transport Allowance", value: entry.totalTransport || 0 });
      earningsRows.push(
        commissionExplanation.code === "fixed_salary"
          ? { label: "Gross Commission", value: null, note: commissionNote }
          : { label: "Gross Commission", value: entry.grossCommission || 0 },
      );
      if ((entry.leavePay   || 0) > 0) earningsRows.push({ label: "Leave Pay",   value: entry.leavePay });
      if ((entry.holidayPay || 0) > 0) earningsRows.push({ label: "Holiday Pay", value: entry.holidayPay });
      if ((entry.offDayPay  || 0) > 0) earningsRows.push({ label: "Off-Day Pay", value: entry.offDayPay });
    }

    earningsRows.forEach((row, i) => {
      if (i % 2 === 0) {
        doc.setFillColor(...STRIPE);
        doc.rect(L - 2, y - 4.5, R - L + 4, 7, "F");
      }
      doc.setFontSize(8.5); doc.setFont("helvetica", "normal");
      doc.setTextColor(...BODY);
      doc.text(row.label, L + 2, y);
      doc.text(row.value === null ? "—" : pdfFmt(row.value), R - 2, y, { align: "right" });
      y += 7;

      // The reason the figure is what it is, indented beneath it. Without this
      // a correct "NGN 0.00" is indistinguishable from a broken one.
      if (row.label === "Gross Commission") {
        y = writeCommissionNote(y);
      }
    });

    // Gross pay subtotal row. `gross` is pre-deduction — the rows above sum to it.
    y += 1;
    doc.setFillColor(228, 231, 244);
    doc.rect(L - 2, y - 1, R - L + 4, 8, "F");
    doc.setFontSize(9); doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY);
    doc.text("Gross Pay (before deductions)", L + 2, y + 5);
    doc.text(pdfFmt(gross), R - 2, y + 5, { align: "right" });
    y += 13;

    // ── Deductions ────────────────────────────────────────────────────────────
    if (activeDeductions.length > 0) {
      doc.setFontSize(7); doc.setFont("helvetica", "bold");
      doc.setTextColor(...LABEL);
      doc.text("DEDUCTIONS", L, y);
      y += 5;

      activeDeductions.forEach((d: any, i: number) => {
        if (i % 2 === 0) {
          doc.setFillColor(...STRIPE);
          doc.rect(L - 2, y - 4.5, R - L + 4, 7, "F");
        }
        doc.setFontSize(8.5); doc.setFont("helvetica", "normal");
        doc.setTextColor(...BODY);
        doc.text(d.label, L + 2, y);
        doc.setTextColor(...RED);
        doc.text(`- ${pdfFmt(Number(d.amount))}`, R - 2, y, { align: "right" });
        y += 7;
      });
      y += 3;
    }

    // ── Net pay band ──────────────────────────────────────────────────────────
    // `net` is floored at zero — it is the amount actually handed over, never a
    // negative. Deductions the pay could not cover show as the shortfall below.
    const isDeficit = shortfall > 0;
    doc.setFillColor(...(isDeficit ? RED : GREEN));
    doc.rect(L - 2, y, R - L + 4, 11, "F");
    doc.setFontSize(11); doc.setFont("helvetica", "bold");
    doc.setTextColor(...WHITE);
    doc.text("NET PAY", L + 2, y + 7.5);
    doc.text(pdfFmt(net), R - 2, y + 7.5, { align: "right" });
    y += 14;

    if (isDeficit) {
      doc.setFontSize(7); doc.setFont("helvetica", "italic");
      doc.setTextColor(...RED);
      doc.text(`* ${pdfFmt(shortfall)} could not be recovered and carries forward to the next payroll period`, C, y, { align: "center" });
      y += 6;
    } else {
      y += 3;
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    // Thin separator
    doc.setDrawColor(210, 213, 225);
    doc.setLineWidth(0.2);
    doc.line(L, y, R, y);
    y += 5;

    if (isPeriodOngoing) {
      doc.setFontSize(7); doc.setFont("helvetica", "normal");
      doc.setTextColor(200, 100, 0);
      doc.text("* Period not yet closed - figures may change", C, y, { align: "center" });
      y += 5;
    }

    // QR code + doc ID (left), generation date (right)
    const qrSize = 18;
    if (qrDataUrl) {
      doc.addImage(qrDataUrl, "PNG", L, y - 1, qrSize, qrSize);
      doc.setFontSize(6); doc.setFont("helvetica", "bold");
      doc.setTextColor(...NAVY);
      doc.text("ORIGINAL COPY", L + qrSize + 2, y + 4);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...LABEL);
      doc.setFontSize(5.5);
      doc.text(`Doc ID: ${docId}`, L + qrSize + 2, y + 8);
      doc.text("Scan QR to verify authenticity", L + qrSize + 2, y + 12);
    }

    doc.setFontSize(6.5); doc.setFont("helvetica", "normal");
    doc.setTextColor(...LABEL);
    doc.text(`Generated on ${format(new Date(), "MMM d, yyyy")}`, R, y + (qrDataUrl ? 4 : 0), { align: "right" });

    doc.save(`payslip-${entry.staff?.name || staffId}-${period.startDate}.pdf`);
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

      {/* Summary cards */}
      {entry && (
        <MetricGrid>
          {[
            {
              label: "Base Salary",
              value: fmtCur(entry.calculationDetails?.baseSalary || 0),
              compact: fmtCompact(entry.calculationDetails?.baseSalary || 0),
              sub: entry.calculationDetails?.paymentMethod === "fixed"
                ? "Fixed salary (flat)"
                : "Prorated monthly base",
            },
            { label: "Active Days",      value: `${entry.activeDays || 0} days`,    sub: "Assigned to services" },
            { label: "Passive Days",     value: `${entry.passiveDays || 0} days`,   sub: "Present, no service" },
            { label: "Total Transport",  value: fmtCur(entry.totalTransport || 0),  compact: fmtCompact(entry.totalTransport || 0),  sub: entry.calculationDetails?.paymentMethod === "fixed" ? "N/A — fixed salary" : "Daily transport allowances" },
            // `sub` used to read "Proportional split pools", describing a
            // commission model no formula here uses. It now carries the reason
            // this particular figure came out the way it did.
            { label: "Gross Commission", value: fmtCur(entry.grossCommission || 0), compact: fmtCompact(entry.grossCommission || 0), sub: commissionNote },
          ].map(card => (
            <MetricCard
              key={card.label}
              title={card.label}
              value={card.value}
              compactValue={card.compact}
              description={card.sub}
              valueClassName="text-primary"
            />
          ))}
        </MetricGrid>
      )}

      {/* Net Pay Callout — the headline is what actually gets handed over */}
      {entry && (() => {
        const hasShortfall = shortfall > 0;
        return (
        <Card className={hasShortfall ? "border-destructive/40 bg-destructive/5" : "border-primary/20 bg-primary/5"}>
          <CardContent className="flex items-center justify-between py-4 flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className={`h-10 w-10 rounded-full flex items-center justify-center ${hasShortfall ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
                {hasShortfall ? <AlertTriangle className="h-5 w-5" /> : <DollarSign className="h-5 w-5" />}
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Net Pay (Take-Home)</p>
                <p className={`text-2xl font-bold font-mono ${hasShortfall ? "text-destructive" : "text-primary"}`}>{fmtCur(takeHomePay)}</p>
                <p className="text-xs mt-0.5 font-medium text-muted-foreground">
                  Gross {fmtCur(grossPay)}
                  {totalDeductions > 0 && <> − deductions {fmtCur(totalDeductions)}</>}
                </p>
                {hasShortfall && (
                  <p className="text-xs mt-0.5 font-medium text-destructive">
                    {fmtCur(shortfall)} could not be recovered and carries forward to the next period
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              {isPeriodOngoing && (
                <p className="text-[11px] text-amber-600 font-medium">
                  ⚠ Period still open — figures may change
                </p>
              )}
              <Button variant="outline" size="sm" onClick={printPayslip}>
                <Printer className="mr-2 h-4 w-4" />
                Download Payslip PDF
              </Button>
            </div>
          </CardContent>
        </Card>
        );
      })()}

      {/* Deductions Panel */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Minus className="h-4 w-4 text-destructive" />
              Deductions{activeDeductions.length > 0 ? ` (${activeDeductions.length})` : ""}
            </CardTitle>
            {period?.status !== "paid" && (
              <Button variant="outline" size="sm" onClick={() => setShowAddDeduction(v => !v)}>
                <Plus className="h-3 w-3 mr-1" />
                Add
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {showAddDeduction && (
            <div className="rounded-lg border p-4 bg-muted/20 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Type</Label>
                  <Select value={dedType} onValueChange={setDedType}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="advance_recovery">Advance Recovery</SelectItem>
                      <SelectItem value="tax">Tax</SelectItem>
                      <SelectItem value="penalty">Penalty</SelectItem>
                      <SelectItem value="insurance">Insurance</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Amount</Label>
                  <Input className="h-8 text-xs" type="number" min="0" step="0.01" value={dedAmount} onChange={e => setDedAmount(e.target.value)} placeholder="0.00" />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Label (shown on payslip)</Label>
                <Input className="h-8 text-xs" value={dedLabel} onChange={e => setDedLabel(e.target.value)} placeholder="e.g. March advance recovery" />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setShowAddDeduction(false)}>Cancel</Button>
                <Button size="sm" disabled={!dedLabel || !dedAmount || addDeductionMutation.isPending}
                  onClick={() => addDeductionMutation.mutate()}>
                  Add Deduction
                </Button>
              </div>
            </div>
          )}
          {deductions.length === 0 && !showAddDeduction && (
            <p className="text-xs text-muted-foreground py-2 text-center">No deductions for this period.</p>
          )}
          {deductions.map((d: any) => {
            const isStaffCredit = d.type === "staff_credit";
            // System-proposed only — a manager's own free-text "Advance
            // Recovery" line (no salaryAdvanceId) behaves like any other
            // manual deduction: plain badge, plain delete.
            const isAdvanceRecovery = d.type === "advance_recovery" && !!d.salaryAdvanceId;
            // Waived AND forgiven: the Borrow Book entry behind this line was
            // written off, so undoing it has to restore the debt, not just the
            // deduction.
            const isWrittenOff = d.creditEntry?.status === "written_off";
            // What the debt still carries beyond what this period recovers —
            // the manager's cue that recovery was capped by available pay.
            const remainder = isStaffCredit && d.creditEntry && !d.repaymentId
              ? Number(d.creditEntry.outstandingBalance) - Number(d.amount)
              : 0;
            // Same idea for an advance: outstandingBalance already reflects
            // post-settle state once settledAt is set, so only subtract this
            // line's own amount while the proposal is still open (it hasn't
            // been applied to the balance yet).
            const advanceRemainder = isAdvanceRecovery && d.salaryAdvance
              ? Math.max(0, Number(d.salaryAdvance.outstandingBalance) - (d.settledAt ? 0 : Number(d.amount)))
              : 0;
            return (
              <div key={d.id} className={`flex items-center justify-between text-sm border rounded-lg px-3 py-2 ${d.isWaived ? "bg-muted/30 opacity-60" : "bg-muted/10"}`}>
                <div className="min-w-0">
                  {/* The label already reads "Staff credit — Checkout Receipt
                      #1042", so it IS the receipt reference: make it the link
                      rather than repeating the number in a separate chip. */}
                  {d.transactionId ? (
                    <Link href={appendReturnTo(`/transactions/${d.transactionId}`, location, search)}>
                      <span className={`font-medium text-primary cursor-pointer hover:underline ${d.isWaived ? "line-through" : ""}`}>
                        {d.label}
                      </span>
                    </Link>
                  ) : (
                    <span className={`font-medium ${d.isWaived ? "line-through" : ""}`}>{d.label}</span>
                  )}
                  {/* Staff-credit and advance-recovery labels already begin
                      "Staff credit — " / "Advance recovery — ", so the type
                      badge would only say it twice. Other types carry free
                      text and still need it. */}
                  {!isStaffCredit && !isAdvanceRecovery && (
                    <Badge variant="outline" className="ml-2 text-[10px] h-4">{d.type.replace(/_/g, " ")}</Badge>
                  )}
                  {d.isWaived && (
                    <Badge variant="outline" className="ml-1 text-[10px] h-4 text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300">waived</Badge>
                  )}
                  {isStaffCredit && !d.isWaived && remainder > 0 && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Capped at available pay — {fmtCur(remainder)} stays owing and carries to the next period.
                    </p>
                  )}
                  {isAdvanceRecovery && !d.isWaived && advanceRemainder > 0 && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Capped at available pay — {fmtCur(advanceRemainder)} of this advance stays outstanding and carries to the next period.
                    </p>
                  )}
                  {d.repayment && (
                    <p className="text-[11px] text-sky-600 dark:text-sky-400 mt-0.5">
                      Recovered from payroll on {format(new Date(d.repayment.createdAt), "MMM d, yyyy")} — the debt is settled in the Borrow Book.
                    </p>
                  )}
                  {isAdvanceRecovery && d.settledAt && (
                    <p className="text-[11px] text-sky-600 dark:text-sky-400 mt-0.5">
                      Recovered from payroll on {format(new Date(d.settledAt), "MMM d, yyyy")}
                      {advanceRemainder > 0
                        ? ` — ${fmtCur(advanceRemainder)} of the advance is still outstanding.`
                        : " — the advance is fully recovered."}
                    </p>
                  )}
                  {isStaffCredit && d.isWaived && !d.repayment && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Excluded from this payroll. The debt stays open in the Borrow Book.
                    </p>
                  )}
                  {isAdvanceRecovery && d.isWaived && !d.settledAt && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Excluded from this payroll. The advance stays open and will be proposed again next period.
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`font-mono text-sm font-semibold ${d.isWaived ? "text-muted-foreground line-through" : "text-destructive"}`}>
                    -{fmtCur(Number(d.amount))}
                  </span>
                  {period?.status !== "paid" && (
                    d.isWaived ? (
                      // A waived line whose debt was also written off needs the
                      // debt back before the deduction means anything, so it
                      // gets the restore that reverses both. Owner-only, since
                      // only an owner could have written it off.
                      isWrittenOff ? (
                        isOwner && (
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                            disabled={!d.creditEntry?.canRestore && !!d.creditEntry?.restoreBlockedReason}
                            title={d.creditEntry?.restoreBlockedReason ?? undefined}
                            onClick={() => setDebtToRestore(d)}>
                            Restore debt
                          </Button>
                        )
                      ) : (
                        <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                          onClick={() => restoreDeductionMutation.mutate(d.id)}>
                          Restore
                        </Button>
                      )
                    ) : isStaffCredit ? (
                      <>
                        {/* Two different decisions, deliberately not one button:
                            skipping defers the debt to the next period, waiving
                            forgives it outright. Only an owner can forgive. */}
                        <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                          onClick={() => deleteDeductionMutation.mutate(d.id)}>
                          Skip this period
                        </Button>
                        {isOwner && (
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                            onClick={() => setDebtToWriteOff(d)}>
                            Waive
                          </Button>
                        )}
                      </>
                    ) : isAdvanceRecovery ? (
                      // No forgive option here — there's no write-off concept
                      // for a salary advance the way there is for shop credit.
                      // Skipping just defers it to the next period, same as
                      // waiving does for staff credit's "skip" half.
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                        onClick={() => deleteDeductionMutation.mutate(d.id)}>
                        Skip this period
                      </Button>
                    ) : (
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteDeductionMutation.mutate(d.id)}>
                        <Minus className="h-3 w-3" />
                      </Button>
                    )
                  )}
                </div>
              </div>
            );
          })}
          {totalDeductions > 0 && (
            <div className="flex justify-between text-sm font-semibold border-t pt-2">
              <span>Total Deductions</span>
              <span className="font-mono text-destructive">-{fmtCur(totalDeductions)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Formula & Calculation Steps Breakdown */}
      {entry?.calculationDetails && (
        <Card className="border-indigo-200 bg-indigo-50/10 dark:border-indigo-900/30 dark:bg-indigo-950/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-indigo-950 dark:text-indigo-200">
              <TrendingUp className="h-4 w-4 text-indigo-500" />
              Formula & Calculation Step Breakdown ({entry.calculationDetails.formulaName || entry.calculationDetails.commissionFormula || "Resolved Model"})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4 bg-background p-3 rounded-lg border shadow-sm text-xs">
              <div>
                <span className="text-muted-foreground block mb-0.5 font-medium">Payment Method</span>
                <span className="font-bold capitalize text-primary font-mono text-[13px]">{entry.calculationDetails.paymentMethod}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-0.5 font-medium">Base Salary</span>
                <span className="font-bold text-primary font-mono text-[13px]">{fmtCur(entry.calculationDetails.baseSalary || 0)}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-0.5 font-medium">Commission Type</span>
                <span className="font-bold text-primary font-mono text-[13px] capitalize">{entry.calculationDetails.commissionType}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-0.5 font-medium">Commission Rate</span>
                <span className="font-bold text-primary font-mono text-[13px]">{(entry.calculationDetails.commissionRate * 100).toFixed(0)}%</span>
              </div>
            </div>
            
            <div className="space-y-2 mt-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Step-by-Step Math Audit Trail</h4>
              <div className="space-y-2.5">
                {(entry.calculationDetails.formulaSteps || []).map((step: string, idx: number) => (
                  <div key={idx} className="flex gap-3 text-xs leading-relaxed items-start">
                    <span className="flex-shrink-0 h-5 w-5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 flex items-center justify-center font-bold font-mono text-[11px] mt-0.5">
                      {idx + 1}
                    </span>
                    <span className="text-zinc-700 dark:text-zinc-300 font-medium">{step}</span>
                  </div>
                ))}
              </div>
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
          <p className="text-xs text-muted-foreground">
            Revenue share is this staff member's slice of each service price — the base the
            commission formula runs on, not commission itself.
          </p>
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
                    <th className="text-right py-2 pl-3">Revenue Share</th>
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
                      <td className="text-right py-2.5 pl-3 font-mono text-xs font-semibold">{fmtCur(d.revenueShare)}</td>
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
              Service Revenue Share by Transaction ({breakdown.length})
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
                      <div className="col-span-3 text-center">Role</div>
                      <div className="col-span-1 text-right">Price</div>
                      <div className="col-span-1 text-right">Share</div>
                      <div className="col-span-1 text-right">Revenue Share</div>
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
                          <div className="col-span-3 text-center self-center">
                            <Badge variant="outline" className={`text-xs ${roleCfg.color} border`}>
                              {roleCfg.label}
                            </Badge>
                          </div>
                          <div className="col-span-1 text-right font-mono text-xs self-center">{fmtCur(b.serviceAmount)}</div>
                          <div className="col-span-1 text-right text-xs text-muted-foreground self-center">{(b.share * 100).toFixed(0)}%</div>
                          <div className="col-span-1 text-right font-semibold font-mono text-xs self-center">{fmtCur(b.revenueShare)}</div>
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
                {/* How these rows become the commission that was actually paid.
                    This footer used to show a rival total computed from a
                    different model, which disagreed with the Gross Commission
                    card above it by 3-5x. */}
                <CardFooter className="flex-col items-stretch gap-1.5 pt-4 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Total revenue share ({breakdown.length} service{breakdown.length === 1 ? "" : "s"})</span>
                    <span className="font-mono">{fmtCur(totalRevenueShare)}</span>
                  </div>
                  {reconciliation ? (
                    <>
                      {reconciliation.attendanceDeduction > 0 && (
                        <div className="flex justify-between text-muted-foreground">
                          <span>Less transport already paid</span>
                          <span className="font-mono">-{fmtCur(reconciliation.attendanceDeduction)}</span>
                        </div>
                      )}
                      <div className="flex justify-between border-t pt-1.5">
                        <span>
                          Commissionable revenue
                          {reconciliation.commissionableRevenue < 0 && " (floored at zero)"}
                        </span>
                        <span className="font-mono">{fmtCur(Math.max(0, reconciliation.commissionableRevenue))}</span>
                      </div>
                      <div className="flex justify-between border-t pt-1.5 font-semibold">
                        <span>Gross commission @ {+(reconciliation.commissionRate * 100).toFixed(2)}% · {reconciliation.formulaName}</span>
                        <span className="text-lg font-bold font-mono text-primary">{fmtCur(reconciliation.grossCommission)}</span>
                      </div>
                      {needsExplanation(reconciliation.explanation) && (
                        <p className="text-xs text-muted-foreground pt-0.5">{commissionNote}</p>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground pt-1">
                      This period has not been calculated yet, so there is no commission to reconcile against.
                    </p>
                  )}
                </CardFooter>
              </>
            )}
          </>
        )}
      </Card>

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
