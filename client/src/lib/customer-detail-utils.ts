/**
 * Pure helpers for the Customers list card view and the Customer Detail page.
 * Framework-free so they can be unit tested without mounting either page.
 */

export function getCustomerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function formatRelativeDate(date: string | Date | null): string | null {
  if (!date) return null;
  const diffMs = Date.now() - new Date(date).getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} d ago`;
  if (days < 30) return `${Math.floor(days / 7)} wk ago`;
  if (days < 365) return `${Math.floor(days / 30)} mo ago`;
  return `${Math.floor(days / 365)} yr ago`;
}

/** "Today" / "Yesterday" / "Mon DD" — the day-group header used above a transaction list. */
export function dayGroupLabel(date: string | Date, now: Date = new Date()): string {
  const d = new Date(date);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined }).format(d);
}

export interface DayGroup<T> {
  label: string;
  items: T[];
}

/** Groups items (already sorted or not) into day buckets, most recent day first. */
export function groupByDay<T>(items: T[], getDate: (item: T) => string | Date, now: Date = new Date()): DayGroup<T>[] {
  const sorted = [...items].sort((a, b) => new Date(getDate(b)).getTime() - new Date(getDate(a)).getTime());
  const groups: DayGroup<T>[] = [];
  for (const item of sorted) {
    const label = dayGroupLabel(getDate(item), now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.items.push(item);
    } else {
      groups.push({ label, items: [item] });
    }
  }
  return groups;
}

export type TransactionStatusTone = "success" | "warning" | "destructive" | "muted";
export interface TransactionStatus {
  label: string;
  tone: TransactionStatusTone;
}

/**
 * A transaction's payment status for display, preferring the linked credit-ledger
 * entry's status (settled/owing/partial/overdue/written_off — the more precise,
 * already-tracked state) when one exists, and falling back to the checkout's own
 * completed/pending flag for transactions with no credit ledger entry at all.
 */
export function deriveTransactionStatus(
  transactionId: string,
  checkoutPaymentStatus: string | undefined,
  creditEntries: { transactionId?: string | null; status: string }[]
): TransactionStatus {
  const linked = creditEntries.find((e) => e.transactionId === transactionId);
  if (linked) {
    switch (linked.status) {
      case "settled": return { label: "Paid", tone: "success" };
      case "partial": return { label: "Part paid", tone: "warning" };
      case "owing": return { label: "Owing", tone: "warning" };
      case "overdue": return { label: "Overdue", tone: "destructive" };
      case "written_off": return { label: "Written off", tone: "muted" };
      default: return { label: linked.status, tone: "muted" };
    }
  }
  return checkoutPaymentStatus === "completed"
    ? { label: "Paid", tone: "success" }
    : { label: "Pending", tone: "warning" };
}
