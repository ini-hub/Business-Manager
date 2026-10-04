/**
 * Pure filter/sort logic for the Quotes list's Filters + Sort bottom sheets.
 * Framework-free so it can be unit tested without mounting the page.
 */

export type QuoteStatusFilter = "draft" | "sent" | "accepted" | "declined" | "converted";
export type QuoteCreatedFilter = "7d" | "30d" | "90d";
export type QuoteExpiryFilter = "expired" | "week" | "none";

export interface QuoteFilterState {
  status: QuoteStatusFilter | null;
  created: QuoteCreatedFilter | null;
  expiry: QuoteExpiryFilter | null;
  valueMin: number | null;
  valueMax: number | null;
}

export const EMPTY_QUOTE_FILTERS: QuoteFilterState = { status: null, created: null, expiry: null, valueMin: null, valueMax: null };

export type QuoteSortKey = "newest" | "oldest" | "valueHigh" | "valueLow" | "expiring";
export interface QuoteSortState {
  key: QuoteSortKey;
}

export interface FilterableQuote {
  quoteRef: string;
  notes?: string | null;
  status: string;
  totalPrice: number;
  createdAt: string | Date;
  validUntil?: string | Date | null;
  customer?: { name?: string | null } | null;
}

export const STATUS_LABELS: Record<QuoteStatusFilter, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  converted: "Converted",
};
export const CREATED_LABELS: Record<QuoteCreatedFilter, string> = {
  "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days",
};
export const EXPIRY_LABELS: Record<QuoteExpiryFilter, string> = {
  expired: "Expired",
  week: "Expires in the next 7 days",
  none: "No expiry",
};

const DAY = 86_400_000;
const CREATED_DAYS: Record<QuoteCreatedFilter, number> = { "7d": 7, "30d": 30, "90d": 90 };

export function quoteMatchesFilters<T extends FilterableQuote>(q: T, f: QuoteFilterState, now = new Date()): boolean {
  if (f.status && q.status.toLowerCase() !== f.status) return false;
  if (f.created && (now.getTime() - new Date(q.createdAt).getTime()) / DAY > CREATED_DAYS[f.created]) return false;
  if (f.expiry) {
    if (f.expiry === "none") {
      if (q.validUntil) return false;
    } else {
      if (!q.validUntil) return false;
      const ms = new Date(q.validUntil).getTime() - now.getTime();
      if (f.expiry === "expired" && ms >= 0) return false;
      if (f.expiry === "week" && (ms < 0 || ms > 7 * DAY)) return false;
    }
  }
  if (f.valueMin != null && q.totalPrice < f.valueMin) return false;
  if (f.valueMax != null && q.totalPrice > f.valueMax) return false;
  return true;
}

export function quoteMatchesSearch(q: FilterableQuote, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  return (
    q.quoteRef.toLowerCase().includes(t) ||
    (q.notes ?? "").toLowerCase().includes(t) ||
    (q.customer?.name ?? "").toLowerCase().includes(t)
  );
}

export function countActiveQuoteFilters(f: QuoteFilterState): number {
  return (f.status ? 1 : 0) + (f.created ? 1 : 0) + (f.expiry ? 1 : 0) + (f.valueMin != null || f.valueMax != null ? 1 : 0);
}

export function valueSummary(f: Pick<QuoteFilterState, "valueMin" | "valueMax">, symbol: string): string | null {
  const m = (n: number) => `${symbol}${n.toLocaleString()}`;
  if (f.valueMin != null && f.valueMax != null) return `${m(f.valueMin)} to ${m(f.valueMax)}`;
  if (f.valueMin != null) return `${m(f.valueMin)} or more`;
  if (f.valueMax != null) return `Up to ${m(f.valueMax)}`;
  return null;
}

export interface QuoteFilterChip {
  key: "status" | "created" | "expiry" | "value";
  label: string;
}

export function buildQuoteFilterChips(f: QuoteFilterState, symbol: string): QuoteFilterChip[] {
  const chips: QuoteFilterChip[] = [];
  if (f.status) chips.push({ key: "status", label: STATUS_LABELS[f.status] });
  if (f.created) chips.push({ key: "created", label: `Created: ${CREATED_LABELS[f.created].toLowerCase()}` });
  if (f.expiry) chips.push({ key: "expiry", label: EXPIRY_LABELS[f.expiry] });
  const value = valueSummary(f, symbol);
  if (value) chips.push({ key: "value", label: value });
  return chips;
}

export function clearQuoteFilterChip(f: QuoteFilterState, key: QuoteFilterChip["key"]): QuoteFilterState {
  switch (key) {
    case "status": return { ...f, status: null };
    case "created": return { ...f, created: null };
    case "expiry": return { ...f, expiry: null };
    case "value": return { ...f, valueMin: null, valueMax: null };
  }
}

export function quoteSortLabel(sort: QuoteSortState | null): string {
  if (!sort) return "Sort";
  return {
    newest: "Sort: Newest", oldest: "Sort: Oldest", valueHigh: "Sort: Highest value",
    valueLow: "Sort: Lowest value", expiring: "Sort: Expiring soonest",
  }[sort.key];
}

export function sortQuotes<T extends FilterableQuote>(rows: T[], sort: QuoteSortState | null): T[] {
  if (!sort) return rows;
  const created = (q: T) => new Date(q.createdAt).getTime();
  // Quotes with no expiry sort last when ordering by expiry.
  const expiry = (q: T) => (q.validUntil ? new Date(q.validUntil).getTime() : Number.POSITIVE_INFINITY);
  return [...rows].sort((a, b) => {
    switch (sort.key) {
      case "newest": return created(b) - created(a);
      case "oldest": return created(a) - created(b);
      case "valueHigh": return b.totalPrice - a.totalPrice;
      case "valueLow": return a.totalPrice - b.totalPrice;
      case "expiring": return expiry(a) === expiry(b) ? 0 : expiry(a) < expiry(b) ? -1 : 1;
    }
  });
}
