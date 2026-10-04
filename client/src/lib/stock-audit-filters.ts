/**
 * Pure filter/sort logic for the Stock Audit list's Filters + Sort bottom sheets.
 * Framework-free so it can be unit tested without mounting the page.
 */

export type AuditStatusFilter = "draft" | "approved";
export type AuditDateFilter = "7d" | "30d" | "90d";

export interface AuditFilterState {
  status: AuditStatusFilter | null;
  /** Names of the people who conducted the count. */
  conductedBy: string[];
  date: AuditDateFilter | null;
}

export const EMPTY_AUDIT_FILTERS: AuditFilterState = { status: null, conductedBy: [], date: null };

export type AuditSortKey = "newest" | "oldest" | "pending";
export interface AuditSortState {
  key: AuditSortKey;
}

export interface FilterableAudit {
  id: string;
  status: string;
  createdAt: string | Date;
  notes?: string | null;
  conductorName: string;
}

export const STATUS_LABELS: Record<AuditStatusFilter, string> = { draft: "Pending approval", approved: "Approved" };
export const DATE_LABELS: Record<AuditDateFilter, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};
const DATE_DAYS: Record<AuditDateFilter, number> = { "7d": 7, "30d": 30, "90d": 90 };

export function auditMatchesFilters<T extends FilterableAudit>(a: T, f: AuditFilterState, now = new Date()): boolean {
  if (f.status && a.status !== f.status) return false;
  if (f.conductedBy.length > 0 && !f.conductedBy.includes(a.conductorName)) return false;
  if (f.date) {
    const ageDays = (now.getTime() - new Date(a.createdAt).getTime()) / 86_400_000;
    if (ageDays > DATE_DAYS[f.date]) return false;
  }
  return true;
}

export function auditMatchesSearch(a: FilterableAudit, term: string): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  return (
    a.id.substring(0, 8).toLowerCase().includes(q) ||
    a.conductorName.toLowerCase().includes(q) ||
    (a.notes ?? "").toLowerCase().includes(q)
  );
}

export function countActiveAuditFilters(f: AuditFilterState): number {
  return (f.status ? 1 : 0) + (f.conductedBy.length > 0 ? 1 : 0) + (f.date ? 1 : 0);
}

export interface AuditFilterChip {
  key: keyof AuditFilterState;
  label: string;
}

export function buildAuditFilterChips(f: AuditFilterState): AuditFilterChip[] {
  const chips: AuditFilterChip[] = [];
  if (f.status) chips.push({ key: "status", label: STATUS_LABELS[f.status] });
  if (f.conductedBy.length > 0) chips.push({ key: "conductedBy", label: `By ${f.conductedBy.join(", ")}` });
  if (f.date) chips.push({ key: "date", label: DATE_LABELS[f.date] });
  return chips;
}

export function clearAuditFilterChip(f: AuditFilterState, key: AuditFilterChip["key"]): AuditFilterState {
  return { ...f, [key]: EMPTY_AUDIT_FILTERS[key] };
}

export function auditSortLabel(sort: AuditSortState | null): string {
  if (!sort) return "Sort";
  return { newest: "Sort: Newest", oldest: "Sort: Oldest", pending: "Sort: Pending first" }[sort.key];
}

export function sortAudits<T extends FilterableAudit>(rows: T[], sort: AuditSortState | null): T[] {
  if (!sort) return rows;
  const time = (a: T) => new Date(a.createdAt).getTime();
  return [...rows].sort((a, b) => {
    switch (sort.key) {
      case "newest": return time(b) - time(a);
      case "oldest": return time(a) - time(b);
      case "pending": return (Number(b.status === "draft") - Number(a.status === "draft")) || time(b) - time(a);
    }
  });
}
