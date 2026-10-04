import { useState } from "react";
import { formulaLabel, type CommissionExplanation } from "@shared/commission-explainer";

/**
 * "How commission was worked out": the derivation steps as a short ledger,
 * with the full step-by-step audit trail snapshotted at calculation
 * (`payroll_entries.calculation_details.formulaSteps`) one click away.
 */
export function PayrollFormulaBreakdown({
  calculationDetails, explanation, fmtCur,
}: {
  calculationDetails: any;
  explanation?: CommissionExplanation | null;
  fmtCur: (v: number) => string;
}) {
  const [showLog, setShowLog] = useState(false);
  if (!calculationDetails) return null;

  const steps = explanation?.steps ?? [];
  const logSteps: string[] = calculationDetails.formulaSteps || [];
  const rate = Number(calculationDetails.commissionRate ?? 0) * 100;
  const formula = calculationDetails.formulaName || formulaLabel(calculationDetails.commissionFormula);
  const method = calculationDetails.paymentMethod === "fixed" ? "Fixed salary" : "Hybrid";

  return (
    <section className="rounded-xl border bg-card p-4 md:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">How commission was worked out</h2>
        <span className="text-xs text-muted-foreground">{method} · {formula}</span>
      </div>

      {steps.length > 0 ? (
        <ul className="mt-3 divide-y">
          {steps.map((s, i) => {
            const value = s.format === "count" ? String(s.value) : fmtCur(s.value);
            const strong = s.kind === "result" || s.kind === "subtotal";
            return (
              <li key={i} className="flex items-center justify-between gap-3 py-3 text-sm">
                <span className={strong ? "font-semibold" : ""}>{s.label}</span>
                <span className={`tabular-nums ${strong ? "font-bold" : "font-medium"}`}>{s.kind === "less" ? "−" : ""}{value}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          {calculationDetails.paymentMethod === "fixed" ? "Fixed salary: there is no commission component." : `Commission rate is ${+rate.toFixed(2)}%.`}
        </p>
      )}

      {logSteps.length > 0 && (
        <div className="mt-2">
          <button type="button" className="text-sm font-medium text-primary hover:underline" aria-expanded={showLog} onClick={() => setShowLog(v => !v)}>
            {showLog ? "Hide calculation log" : "Show calculation log"}
          </button>
          {showLog && (
            <ol className="mt-3 space-y-3">
              {logSteps.map((step, idx) => (
                <li key={idx} className="flex items-start gap-3 text-xs leading-relaxed">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[11px] font-bold">{idx + 1}</span>
                  <span className="text-muted-foreground">{step}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
