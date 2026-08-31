import { describe, it, expect } from "vitest";
import {
  explainCommission,
  commissionHeadline,
  needsExplanation,
  formulaLabel,
  type CommissionInputs,
} from "./commission-explainer";

/** Plain NGN formatter, so the assertions read like the payslip. */
const money = (v: number) =>
  `₦${v.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A hybrid Formula B staff member — the store default. */
const formulaB = (over: Partial<CommissionInputs> = {}): CommissionInputs => ({
  paymentMethod: "hybrid",
  commissionFormula: "formula_b",
  commissionRate: 0.3,
  ...over,
});

describe("explainCommission", () => {
  // The case that prompted all of this: a real payslip printing NGN 0.00 for a
  // staff member who did sell a service. Store G.R.A. Branch, 26–31 Aug 2026.
  it("attributes a zero to the transport offset when revenue fell short of it", () => {
    const e = explainCommission(formulaB({
      totalServiceRevenueContribution: 1000,
      attendanceDeduction: 2000,
      commissionableRevenue: -1000,
      grossCommission: 0,
      serviceCountWorked: 1,
    }));

    expect(e.code).toBe("offset_by_transport");
    expect(e.grossCommission).toBe(0);
    expect(e.steps).toEqual([
      { label: "Service revenue share", value: 1000, format: "money", kind: "add" },
      { label: "Less transport already paid", value: 2000, format: "money", kind: "less" },
      { label: "Commissionable revenue (floored at zero)", value: 0, format: "money", kind: "subtotal" },
      { label: "Gross commission @ 30%", value: 0, format: "money", kind: "result" },
    ]);
    expect(commissionHeadline(e, money)).toBe(
      "Service revenue share of ₦1,000.00 did not exceed the ₦2,000.00 of transport already paid, so there was nothing commissionable.",
    );
  });

  // Same store, the paid 1–25 Aug period, where the same formula does pay out.
  it("explains a non-zero commission with the same derivation", () => {
    const e = explainCommission(formulaB({
      totalServiceRevenueContribution: 5000,
      attendanceDeduction: 4000,
      commissionableRevenue: 1000,
      grossCommission: 300,
      serviceCountWorked: 4,
    }));

    expect(e.code).toBe("earned");
    expect(needsExplanation(e)).toBe(false);
    expect(e.steps.map(s => [s.label, s.value])).toEqual([
      ["Service revenue share", 5000],
      ["Less transport already paid", 4000],
      ["Commissionable revenue", 1000],
      ["Gross commission @ 30%", 300],
    ]);
  });

  it("reports a fixed-salary staff member as not applicable, with no derivation", () => {
    const e = explainCommission({
      paymentMethod: "fixed",
      commissionFormula: "formula_b",
      // The engine hard-zeroes commission for these staff even when they led
      // services, so revenue being present must not produce a derivation.
      totalServiceRevenueContribution: 15000,
      grossCommission: 0,
    });

    expect(e.code).toBe("fixed_salary");
    expect(e.steps).toEqual([]);
    expect(commissionHeadline(e, money)).toBe("Not applicable — this staff member is on a fixed salary.");
  });

  it("distinguishes no services from an offset", () => {
    const e = explainCommission(formulaB({
      totalServiceRevenueContribution: 0,
      attendanceDeduction: 2000,
      commissionableRevenue: -2000,
      grossCommission: 0,
      serviceCountWorked: 0,
    }));

    expect(e.code).toBe("no_services");
    expect(commissionHeadline(e, money)).toBe(
      "No service revenue was recorded for this staff member in this period.",
    );
  });

  it("distinguishes a zero rate from an offset", () => {
    const e = explainCommission(formulaB({
      commissionRate: 0,
      totalServiceRevenueContribution: 5000,
      attendanceDeduction: 1000,
      commissionableRevenue: 4000,
      grossCommission: 0,
      serviceCountWorked: 3,
    }));

    expect(e.code).toBe("zero_rate");
  });

  // Formula D takes no attendance deduction, so the payslip must not print a
  // "less transport" line that would imply one was applied.
  it("omits the transport line for the pure-commission formula", () => {
    const e = explainCommission({
      paymentMethod: "commission",
      commissionFormula: "formula_d",
      commissionRate: 0.3,
      totalServiceRevenueContribution: 10000,
      attendanceDeduction: 0,
      commissionableRevenue: 10000,
      grossCommission: 3000,
      serviceCountWorked: 2,
    });

    expect(e.steps.map(s => s.label)).toEqual([
      "Service revenue share",
      "Commissionable revenue",
      "Gross commission @ 30%",
    ]);
  });

  it("derives the flat-per-service formula from the count, not a rate", () => {
    const e = explainCommission({
      paymentMethod: "commission",
      commissionFormula: "formula_f",
      commissionFixedAmount: 500,
      serviceCountWorked: 6,
      grossCommission: 3000,
    });

    expect(e.code).toBe("earned");
    expect(e.steps).toEqual([
      { label: "Services worked", value: 6, format: "count", kind: "add" },
      { label: "Flat amount per service", value: 500, format: "money", kind: "add" },
      { label: "Gross commission", value: 3000, format: "money", kind: "result" },
    ]);
  });

  it("blames the flat amount when it is the thing set to zero", () => {
    const e = explainCommission({
      paymentMethod: "commission",
      commissionFormula: "formula_f",
      commissionFixedAmount: 0,
      serviceCountWorked: 6,
      grossCommission: 0,
    });

    expect(e.code).toBe("zero_rate");
  });

  // Entries calculated before the snapshot carried these fields must not be
  // given a confident wrong reason.
  it("degrades to unknown rather than guessing on a pre-snapshot entry", () => {
    const e = explainCommission({ paymentMethod: "hybrid", commissionFormula: "formula_b", grossCommission: 0 });

    expect(e.code).toBe("unknown");
    expect(e.steps).toEqual([]);
    expect(commissionHeadline(e, money)).toContain("Recalculate the period");
  });

  it("renders a fractional rate without trailing noise", () => {
    const e = explainCommission(formulaB({
      commissionRate: 0.125,
      totalServiceRevenueContribution: 8000,
      attendanceDeduction: 0,
      commissionableRevenue: 8000,
      grossCommission: 1000,
      serviceCountWorked: 1,
    }));

    expect(e.steps.at(-1)!.label).toBe("Gross commission @ 12.5%");
  });
});

describe("formulaLabel", () => {
  it("names the known formulas and falls back for anything else", () => {
    expect(formulaLabel("formula_b")).toBe("Formula B");
    expect(formulaLabel("formula_f")).toBe("Formula F");
    expect(formulaLabel(null)).toBe("Hybrid Standard");
    expect(formulaLabel("formula_z")).toBe("Hybrid Standard");
  });
});
