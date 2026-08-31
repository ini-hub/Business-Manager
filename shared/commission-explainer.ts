/**
 * Why a commission figure is what it is — and, when it is ₦0, which of the
 * several very different reasons applies.
 *
 * A payslip that prints a bare "Gross Commission NGN 0.00" gives the person
 * holding it no way to tell "you earned nothing this period" from "the system
 * is broken". Both look identical, and only one of them is worth a complaint.
 * The commonest cause is the least obvious: under formulas A/B/C the transport
 * already paid out during the period is an advance against commission, so a
 * staff member whose share of service revenue came to less than their transport
 * genuinely earns no commission on top — the figure is correct and needs a
 * sentence, not a fix.
 *
 * Deliberately returns structure, never formatted money. The store's currency
 * lives on the client, and a headline baked server-side would ship the wrong
 * symbol to any store that is not on NGN. Callers render with their own
 * formatter via `commissionHeadline` / `step.format`.
 *
 * Consumed by PayrollService (which snapshots the result onto the entry so a
 * paid period's explanation is frozen with its figures) and by every screen
 * that shows a commission number.
 */

import { round2 } from "./payroll-take-home";

export type CommissionReasonCode =
  /** Non-zero. The derivation steps still explain how it was reached. */
  | "earned"
  /** paymentMethod "fixed" — there is no commission component at all. */
  | "fixed_salary"
  /** No service revenue attributed to this staff member in the period. */
  | "no_services"
  /** The rate (or the flat per-service amount) is configured as zero. */
  | "zero_rate"
  /** Formulas A/B/C: revenue share did not exceed the transport already paid. */
  | "offset_by_transport"
  /** An entry calculated before the snapshot carried enough detail to say. */
  | "unknown";

export type CommissionStepKind = "add" | "less" | "subtotal" | "result";

export interface CommissionStep {
  label: string;
  value: number;
  /** "money" renders through the caller's currency formatter; "count" is a plain integer. */
  format: "money" | "count";
  kind: CommissionStepKind;
}

export interface CommissionExplanation {
  code: CommissionReasonCode;
  grossCommission: number;
  /** Ordered derivation, for the payslip and the drill-down footer. Empty when there is nothing to derive. */
  steps: CommissionStep[];
}

/**
 * The fields of `payroll_entries.calculation_details` this needs. All optional:
 * entries calculated before `commissionFixedAmount` / `serviceCountWorked` were
 * snapshotted still explain correctly on every percentage formula, and degrade
 * to "unknown" only on the flat-per-service one.
 */
export interface CommissionInputs {
  paymentMethod?: string | null;
  commissionFormula?: string | null;
  commissionRate?: number | null;
  commissionFixedAmount?: number | null;
  serviceCountWorked?: number | null;
  totalServiceRevenueContribution?: number | null;
  attendanceDeduction?: number | null;
  commissionableRevenue?: number | null;
  grossCommission?: number | null;
}

export const FORMULA_LABELS: Record<string, string> = {
  formula_a: "Formula A",
  formula_b: "Formula B",
  formula_c: "Formula C",
  formula_d: "Formula D",
  formula_f: "Formula F",
};

export function formulaLabel(formula: string | null | undefined): string {
  return (formula && FORMULA_LABELS[formula]) || "Hybrid Standard";
}

/** Formulas that subtract the attendance transport already paid before applying the rate. */
const OFFSET_FORMULAS = new Set(["formula_a", "formula_b", "formula_c"]);

function num(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Trailing zeros off a percentage: 0.3 → "30", 0.125 → "12.5". */
function ratePercent(rate: number): string {
  return String(round2(rate * 100));
}

export function explainCommission(d: CommissionInputs): CommissionExplanation {
  const gross = round2(num(d.grossCommission) ?? 0);
  const formula = d.commissionFormula ?? null;
  const isFlatPerService = formula === "formula_f";

  // Fixed salary short-circuits everything: the engine never computes a
  // commission for these staff, so there is no derivation to show and "0.00"
  // would misrepresent it as an amount that was calculated and came to nothing.
  if (d.paymentMethod === "fixed") {
    return { code: "fixed_salary", grossCommission: 0, steps: [] };
  }

  const steps = isFlatPerService ? flatSteps(d, gross) : percentageSteps(d, gross);

  if (gross > 0) return { code: "earned", grossCommission: gross, steps };

  return { code: zeroReason(d, isFlatPerService), grossCommission: gross, steps };
}

function zeroReason(d: CommissionInputs, isFlatPerService: boolean): CommissionReasonCode {
  const count = num(d.serviceCountWorked);
  const rate = num(d.commissionRate);
  const revenue = num(d.totalServiceRevenueContribution);
  const deduction = num(d.attendanceDeduction) ?? 0;

  if (count === 0) return "no_services";

  if (isFlatPerService) {
    // Pre-snapshot entries carry neither the count nor the flat amount, so
    // there is nothing left to distinguish the cases on.
    return num(d.commissionFixedAmount) === 0 ? "zero_rate" : "unknown";
  }

  if (revenue === null) return "unknown";
  // Zero revenue covers both "worked no services" and "every service came to
  // nothing after discounts" — neither leaves anything to take a percentage of.
  if (revenue === 0) return "no_services";
  if (rate === 0) return "zero_rate";
  if (OFFSET_FORMULAS.has(d.commissionFormula ?? "") && deduction > 0 && revenue <= deduction) {
    return "offset_by_transport";
  }
  return "unknown";
}

function percentageSteps(d: CommissionInputs, gross: number): CommissionStep[] {
  const revenue = num(d.totalServiceRevenueContribution);
  const rate = num(d.commissionRate);
  if (revenue === null || rate === null) return [];

  const deduction = round2(num(d.attendanceDeduction) ?? 0);
  // Trust the stored commissionable figure when present; it is what the rate
  // was actually applied to. Re-derive only for entries that predate it.
  const commissionable = round2(num(d.commissionableRevenue) ?? revenue - deduction);
  const floored = commissionable < 0;

  const steps: CommissionStep[] = [
    { label: "Service revenue share", value: round2(revenue), format: "money", kind: "add" },
  ];

  if (deduction > 0) {
    steps.push({ label: "Less transport already paid", value: deduction, format: "money", kind: "less" });
  }

  steps.push({
    label: floored ? "Commissionable revenue (floored at zero)" : "Commissionable revenue",
    value: floored ? 0 : commissionable,
    format: "money",
    kind: "subtotal",
  });

  steps.push({
    label: `Gross commission @ ${ratePercent(rate)}%`,
    value: gross,
    format: "money",
    kind: "result",
  });

  return steps;
}

function flatSteps(d: CommissionInputs, gross: number): CommissionStep[] {
  const count = num(d.serviceCountWorked);
  const flat = num(d.commissionFixedAmount);
  if (count === null || flat === null) return [];

  return [
    { label: "Services worked", value: count, format: "count", kind: "add" },
    { label: "Flat amount per service", value: round2(flat), format: "money", kind: "add" },
    { label: "Gross commission", value: gross, format: "money", kind: "result" },
  ];
}

/**
 * One sentence for a metric-card subtitle, a CSV cell or a tooltip.
 *
 * `formatMoney` is the caller's currency formatter — the store's currency is
 * not knowable here.
 */
export function commissionHeadline(
  explanation: CommissionExplanation,
  formatMoney: (value: number) => string,
): string {
  const { code, steps } = explanation;
  const stepValue = (label: string) => steps.find(s => s.label.startsWith(label))?.value ?? 0;

  switch (code) {
    case "fixed_salary":
      return "Not applicable — this staff member is on a fixed salary.";
    case "no_services":
      return "No service revenue was recorded for this staff member in this period.";
    case "zero_rate":
      return "The commission rate for this staff member is set to zero.";
    case "offset_by_transport":
      return `Service revenue share of ${formatMoney(stepValue("Service revenue share"))} did not exceed the ${formatMoney(stepValue("Less transport already paid"))} of transport already paid, so there was nothing commissionable.`;
    case "earned":
      return "Share of service revenue, after the transport already paid.";
    default:
      return "This period was calculated before the breakdown was recorded. Recalculate the period to see the derivation.";
  }
}

/** Whether the figure warrants an explanation rather than standing on its own. */
export function needsExplanation(explanation: CommissionExplanation): boolean {
  return explanation.code !== "earned";
}
