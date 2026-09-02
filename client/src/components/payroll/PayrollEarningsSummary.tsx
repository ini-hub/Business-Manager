import { AlertTriangle, DollarSign, Printer } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/metric-card";
import { MetricGrid } from "@/components/metric-grid";
import type { PayrollEntryWithStaff } from "@shared/schema";

/**
 * The "what did I earn and what am I taking home" block — the metric cards
 * (base salary, attendance days, transport, gross commission) plus the net
 * pay callout with its shortfall warning and payslip download. Shared by the
 * manager drill-down and a staff member's own breakdown so both read off the
 * same figures the same way.
 */
export function PayrollEarningsSummary({
  entry, commissionNote, grossPay, takeHomePay, shortfall, totalDeductions,
  isPeriodOngoing, fmtCur, fmtCompact, onDownloadPayslip, isDownloading,
}: {
  entry: (PayrollEntryWithStaff & { calculationDetails?: any; grossCommission?: number; totalTransport?: number; activeDays?: number; passiveDays?: number }) | null | undefined;
  commissionNote: string;
  grossPay: number;
  takeHomePay: number;
  shortfall: number;
  totalDeductions: number;
  isPeriodOngoing: boolean;
  fmtCur: (v: number) => string;
  fmtCompact: (v: number) => string;
  onDownloadPayslip: () => void;
  isDownloading?: boolean;
}) {
  const hasShortfall = shortfall > 0;

  return (
    <>
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
            // Reason the figure is what it is — above all, why it is zero.
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

      {entry && (
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
              <Button variant="outline" size="sm" onClick={onDownloadPayslip} disabled={isDownloading}>
                <Printer className="mr-2 h-4 w-4" />
                {isDownloading ? "Generating…" : "Download Payslip PDF"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
