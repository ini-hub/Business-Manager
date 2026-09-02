import { TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * "Why is my pay this number" — the resolved compensation settings plus the
 * step-by-step math audit trail snapshotted when the period was calculated
 * (`payroll_entries.calculation_details.formulaSteps`).
 */
export function PayrollFormulaBreakdown({
  calculationDetails, fmtCur,
}: {
  calculationDetails: any;
  fmtCur: (v: number) => string;
}) {
  if (!calculationDetails) return null;

  return (
    <Card className="border-indigo-200 bg-indigo-50/10 dark:border-indigo-900/30 dark:bg-indigo-950/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2 text-indigo-950 dark:text-indigo-200">
          <TrendingUp className="h-4 w-4 text-indigo-500" />
          Formula & Calculation Step Breakdown ({calculationDetails.formulaName || calculationDetails.commissionFormula || "Resolved Model"})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4 bg-background p-3 rounded-lg border shadow-sm text-xs">
          <div>
            <span className="text-muted-foreground block mb-0.5 font-medium">Payment Method</span>
            <span className="font-bold capitalize text-primary font-mono text-[13px]">{calculationDetails.paymentMethod}</span>
          </div>
          <div>
            <span className="text-muted-foreground block mb-0.5 font-medium">Base Salary</span>
            <span className="font-bold text-primary font-mono text-[13px]">{fmtCur(calculationDetails.baseSalary || 0)}</span>
          </div>
          <div>
            <span className="text-muted-foreground block mb-0.5 font-medium">Commission Type</span>
            <span className="font-bold text-primary font-mono text-[13px] capitalize">{calculationDetails.commissionType}</span>
          </div>
          <div>
            <span className="text-muted-foreground block mb-0.5 font-medium">Commission Rate</span>
            <span className="font-bold text-primary font-mono text-[13px]">{(calculationDetails.commissionRate * 100).toFixed(0)}%</span>
          </div>
        </div>

        <div className="space-y-2 mt-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Step-by-Step Math Audit Trail</h4>
          <div className="space-y-2.5">
            {(calculationDetails.formulaSteps || []).map((step: string, idx: number) => (
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
  );
}
