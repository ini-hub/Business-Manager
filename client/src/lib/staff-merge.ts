// Wording for the staff merge review: the server reports counts by table.column, people read them as things.

/** Plain-language names for the tables a merge moves, so the review reads as people would describe it. */
const TABLE_LABELS: Record<string, string> = {
  checkouts: "sales",
  attendance_records: "attendance days",
  attendance_punches: "clock-ins",
  attendance_retro_requests: "missed clock-in requests",
  payroll_entries: "payroll entries",
  payroll_deductions: "payroll deductions",
  payroll_disbursements: "payroll payments",
  payroll_postings: "payroll postings",
  payslip_records: "payslips",
  salary_advances: "salary advances",
  repayments: "repayments recorded",
  bookings: "bookings",
  customers: "linked customer profiles",
  staff_store_assignments: "store assignments",
  staff_contract_signatures: "contract signatures",
  staff_contracts: "contracts",
};
export const labelFor = (key: string) => {
  const table = key.split(".")[0];
  return TABLE_LABELS[table] ?? table.replace(/^hr_/, "HR ").replace(/_/g, " ");
};
export function summarise(counts: Record<string, number>): Array<{ label: string; n: number }> {
  const byLabel = new Map<string, number>();
  for (const [key, n] of Object.entries(counts)) byLabel.set(labelFor(key), (byLabel.get(labelFor(key)) ?? 0) + n);
  return Array.from(byLabel, ([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n);
}

const PAY_LABELS: Record<string, string> = {
  pay_per_month: "monthly pay",
  payment_method: "payment method",
  commission_rate_override: "commission rate",
};
export const payLabel = (c: string) => PAY_LABELS[c] ?? c.replace(/_/g, " ");
