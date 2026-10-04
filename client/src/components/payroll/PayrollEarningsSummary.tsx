import { AlertTriangle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PayrollEntryWithStaff } from "@shared/schema";

/**
 * The "what did I earn and what am I taking home" block: take-home as the
 * headline, then the sum that produced it (base + attendance pay + commission =
 * gross, less deductions = net). Shared by the manager drill-down and a staff
 * member's own breakdown so both read off the same figures the same way.
 *
 * Wide screens lay the sum out as a row of tiles; phones get the same figures
 * as a ledger, which reads top to bottom without sideways scrolling.
 */
export function PayrollEarningsSummary({
  entry, commissionNote, grossPay, takeHomePay, shortfall, totalDeductions, deductionsCount,
  isPeriodOngoing, fmtCur, onDownloadPayslip, isDownloading,
}: {
  entry: (PayrollEntryWithStaff & { calculationDetails?: any; grossCommission?: number; totalTransport?: number; activeDays?: number; passiveDays?: number }) | null | undefined;
  commissionNote: string;
  grossPay: number;
  takeHomePay: number;
  shortfall: number;
  totalDeductions: number;
  /** Active (not waived) deduction lines, for the "N items" caption. */
  deductionsCount?: number;
  isPeriodOngoing: boolean;
  fmtCur: (v: number) => string;
  /** Omit when the page already has its own download action. */
  onDownloadPayslip?: () => void;
  isDownloading?: boolean;
  /** Kept so existing callers still type-check; the figures are formatted in full. */
  fmtCompact?: (v: number) => string;
}) {
  if (!entry) return null;

  const hasShortfall = shortfall > 0;
  const details = entry.calculationDetails ?? {};
  const isFixed = details.paymentMethod === "fixed";
  const baseSalary = Number(details.baseSalary || 0);
  const commission = Number(entry.grossCommission || 0);
  // Gross minus the other two parts, so the tiles always add up to the gross
  // shown even when attendance pay is stored under transport.
  const attendancePay = Math.max(0, Number(entry.totalTransport || 0));
  const itemsNote = deductionsCount != null
    ? `${deductionsCount} item${deductionsCount === 1 ? "" : "s"}, see below`
    : "see below";

  const parts = [
    { label: "Base salary", value: baseSalary, sub: isFixed ? "Fixed salary (flat)" : "Monthly base for the period" },
    {
      label: "Attendance pay", value: attendancePay,
      sub: isFixed ? "Not applicable, fixed salary" : `${(entry.activeDays || 0) + (entry.passiveDays || 0)} days present`,
    },
    { label: "Commission", value: commission, sub: commissionNote },
  ];

  return (
    <section className={`rounded-xl border bg-card p-4 md:p-5 ${hasShortfall ? "border-destructive/40" : ""}`} aria-label="Take-home pay">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Take-home pay</p>
          <p className={`mt-1 text-3xl md:text-4xl font-bold tabular-nums tracking-tight ${hasShortfall ? "text-destructive" : "text-primary"}`}>
            {fmtCur(takeHomePay)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground md:hidden">
            {fmtCur(grossPay)} gross − {fmtCur(totalDeductions)} deductions
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {isPeriodOngoing && <p className="text-xs font-medium text-amber-600 dark:text-amber-400">Period still open, figures may change</p>}
          {onDownloadPayslip && (
            <Button variant="outline" size="sm" onClick={onDownloadPayslip} disabled={isDownloading}>
              <Download className="mr-2 h-4 w-4" />
              {isDownloading ? "Generating…" : "Download payslip"}
            </Button>
          )}
        </div>
      </div>

      {hasShortfall && (
        <p className="mt-3 flex items-start gap-2 text-sm font-medium text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {fmtCur(shortfall)} could not be recovered and carries forward to the next period.
        </p>
      )}

      {/* Wide: the sum as tiles */}
      <div className="mt-5 hidden md:flex items-stretch gap-2">
        {parts.map((p, i) => (
          <div key={p.label} className="flex flex-1 items-stretch gap-2">
            <div className="flex-1 rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">{p.label}</p>
              <p className="mt-1 text-lg font-bold tabular-nums">{fmtCur(p.value)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{p.sub}</p>
            </div>
            <span className="self-center text-muted-foreground" aria-hidden>{i < parts.length - 1 ? "+" : "="}</span>
          </div>
        ))}
        <div className="flex flex-1 items-stretch gap-2">
          <div className="flex-1 rounded-lg bg-muted/60 p-3">
            <p className="text-xs text-muted-foreground">Gross pay</p>
            <p className="mt-1 text-lg font-bold tabular-nums">{fmtCur(grossPay)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Before deductions</p>
          </div>
          <span className="self-center text-muted-foreground" aria-hidden>−</span>
        </div>
        <div className="flex flex-1 items-stretch gap-2">
          <div className="flex-1 rounded-lg bg-muted/60 p-3">
            <p className="text-xs text-muted-foreground">Deductions</p>
            <p className={`mt-1 text-lg font-bold tabular-nums ${totalDeductions > 0 ? "text-destructive" : ""}`}>{fmtCur(totalDeductions)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{itemsNote}</p>
          </div>
          <span className="self-center text-muted-foreground" aria-hidden>=</span>
        </div>
        <div className="flex-1 rounded-lg bg-primary p-3 text-primary-foreground">
          <p className="text-xs opacity-80">Net pay</p>
          <p className="mt-1 text-lg font-bold tabular-nums">{fmtCur(takeHomePay)}</p>
          <p className="mt-0.5 text-xs opacity-80">Take-home</p>
        </div>
      </div>

      {/* Narrow: the sum as a ledger */}
      <dl className="mt-4 md:hidden divide-y text-sm">
        {parts.map(p => (
          <div key={p.label} className="flex items-start justify-between gap-3 py-2.5">
            <div><dt className="font-medium">{p.label}</dt><dd className="text-xs text-muted-foreground">{p.sub}</dd></div>
            <dd className="font-semibold tabular-nums">{fmtCur(p.value)}</dd>
          </div>
        ))}
        <div className="flex items-start justify-between gap-3 py-2.5">
          <div><dt className="font-semibold">Gross pay</dt><dd className="text-xs text-muted-foreground">Before deductions</dd></div>
          <dd className="font-bold tabular-nums">{fmtCur(grossPay)}</dd>
        </div>
        <div className="flex items-start justify-between gap-3 py-2.5">
          <div><dt className="font-medium">Deductions</dt><dd className="text-xs text-muted-foreground">{itemsNote}</dd></div>
          <dd className={`font-semibold tabular-nums ${totalDeductions > 0 ? "text-destructive" : ""}`}>{totalDeductions > 0 ? "−" : ""}{fmtCur(totalDeductions)}</dd>
        </div>
        <div className="flex items-center justify-between gap-3 py-2.5">
          <dt className="font-bold">Net pay</dt>
          <dd className="font-bold tabular-nums text-primary">{fmtCur(takeHomePay)}</dd>
        </div>
      </dl>
    </section>
  );
}
