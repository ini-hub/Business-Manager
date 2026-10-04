/**
 * Pure filter/sort logic for the Payment history Filters + Sort sheets.
 * Framework-free so it can be unit tested without mounting the page.
 */

export type PaymentStatus = "success" | "pending" | "failed";

export const STATUS_LABELS: Record<PaymentStatus, string> = { success: "Paid", pending: "Pending", failed: "Failed" };
export const KIND_LABELS: Record<string, string> = { initial: "New subscription", renewal: "Renewal" };
/** Quick amount ranges (inclusive). Anything else is a custom min/max. */
export const AMOUNT_PRESETS: { value: string; label: string; min: number | null; max: number | null }[] = [
  { value: "low", label: "Up to ₦10,000", min: null, max: 10_000 },
  { value: "mid", label: "₦10,000 to ₦50,000", min: 10_000, max: 50_000 },
  { value: "high", label: "Over ₦50,000", min: 50_000, max: null },
];

export interface FilterablePayment {
  status: string;
  kind: string;
  billingCycle: string | null;
  amount: number | string;
  reference: string;
  createdAt: string | Date;
}

export interface PaymentFilterState {
  status: PaymentStatus | null;
  kind: string | null;
  cycle: string | null;
  /** Inclusive bounds in naira. */
  amountMin: number | null;
  amountMax: number | null;
  /** Inclusive local dates as yyyy-MM-dd. */
  dateFrom: string | null;
  dateTo: string | null;
}

export const EMPTY_PAYMENT_FILTERS: PaymentFilterState = {
  status: null, kind: null, cycle: null, amountMin: null, amountMax: null, dateFrom: null, dateTo: null,
};

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function paymentMatchesFilters(p: FilterablePayment, f: PaymentFilterState): boolean {
  if (f.status && p.status !== f.status) return false;
  if (f.kind && p.kind !== f.kind) return false;
  if (f.cycle && p.billingCycle !== f.cycle) return false;
  const n = Number(p.amount);
  if (f.amountMin !== null && n < f.amountMin) return false;
  if (f.amountMax !== null && n > f.amountMax) return false;
  if (f.dateFrom || f.dateTo) {
    const day = ymd(new Date(p.createdAt));
    if (f.dateFrom && day < f.dateFrom) return false;
    if (f.dateTo && day > f.dateTo) return false;
  }
  return true;
}

export function paymentMatchesSearch(p: FilterablePayment, term: string): boolean {
  const q = term.trim().toLowerCase();
  return !q || `${p.reference} ${KIND_LABELS[p.kind] ?? p.kind}`.toLowerCase().includes(q);
}

export function countActivePaymentFilters(f: PaymentFilterState): number {
  return [f.status, f.kind, f.cycle].filter(Boolean).length + (f.amountMin !== null || f.amountMax !== null ? 1 : 0) + (f.dateFrom || f.dateTo ? 1 : 0);
}

const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function paymentDateRangeLabel(from: string | null, to: string | null): string {
  if (from && to) return from === to ? fmtDay(from) : `${fmtDay(from)} – ${fmtDay(to)}`;
  if (from) return `From ${fmtDay(from)}`;
  return to ? `Until ${fmtDay(to)}` : "";
}

const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;

export function paymentAmountRangeLabel(min: number | null, max: number | null): string {
  const preset = AMOUNT_PRESETS.find((p) => p.min === min && p.max === max);
  if (preset) return preset.label;
  if (min !== null && max !== null) return `${naira(min)} to ${naira(max)}`;
  if (min !== null) return `${naira(min)} and above`;
  return max !== null ? `Up to ${naira(max)}` : "";
}

export const cycleLabel = (c: string) => c.charAt(0).toUpperCase() + c.slice(1);

export interface PaymentFilterChip {
  key: "status" | "kind" | "cycle" | "amountRange" | "dateRange";
  label: string;
}

export function buildPaymentFilterChips(f: PaymentFilterState): PaymentFilterChip[] {
  const chips: PaymentFilterChip[] = [];
  if (f.status) chips.push({ key: "status", label: STATUS_LABELS[f.status] });
  if (f.kind) chips.push({ key: "kind", label: KIND_LABELS[f.kind] ?? f.kind });
  if (f.cycle) chips.push({ key: "cycle", label: cycleLabel(f.cycle) });
  const amount = paymentAmountRangeLabel(f.amountMin, f.amountMax);
  if (amount) chips.push({ key: "amountRange", label: amount });
  const range = paymentDateRangeLabel(f.dateFrom, f.dateTo);
  if (range) chips.push({ key: "dateRange", label: range });
  return chips;
}

export function clearPaymentFilterChip(f: PaymentFilterState, key: PaymentFilterChip["key"]): PaymentFilterState {
  if (key === "dateRange") return { ...f, dateFrom: null, dateTo: null };
  if (key === "amountRange") return { ...f, amountMin: null, amountMax: null };
  return { ...f, [key]: null };
}

export type PaymentSortKey = "newest" | "oldest" | "high" | "low";
export interface PaymentSortState {
  key: PaymentSortKey;
}

export const PAYMENT_SORT_OPTIONS: { value: PaymentSortKey; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "high", label: "Amount, high to low" },
  { value: "low", label: "Amount, low to high" },
];

export function paymentSortLabel(sort: PaymentSortState | null): string {
  return sort ? PAYMENT_SORT_OPTIONS.find((o) => o.value === sort.key)!.label : "Sort";
}

export function sortPayments<T extends FilterablePayment>(rows: T[], sort: PaymentSortState | null): T[] {
  if (!sort) return rows;
  const time = (p: T) => new Date(p.createdAt).getTime();
  return [...rows].sort((a, b) => {
    switch (sort.key) {
      case "newest": return time(b) - time(a);
      case "oldest": return time(a) - time(b);
      case "high": return Number(b.amount) - Number(a.amount);
      case "low": return Number(a.amount) - Number(b.amount);
    }
  });
}
