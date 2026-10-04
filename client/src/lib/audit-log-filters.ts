/**
 * Pure filter/sort logic for the Activity Log's Filters + Sort bottom sheets.
 * Framework-free so it can be unit tested without mounting the page.
 */

export const ACTION_GROUPS: Record<string, string[]> = {
  "Sales & Payments": ["CHECKOUT", "PAYMENT", "TRANSACTION_VOID", "PAYMENT_UPDATE", "TRANSACTION_ADDENDUM"],
  "Inventory": ["INVENTORY_UPDATE", "INVENTORY_ARCHIVE", "INVENTORY_DELETE", "INVENTORY_BULK_IMPORT", "INVENTORY_BULK_UPDATE", "INVENTORY_BUNDLE_UPDATE", "INVENTORY_BATCH_CREATE", "CREATE", "CREATE_RESTOCK"],
  "Payroll": ["PAYROLL_PERIOD_CREATE", "PAYROLL_PERIOD_CALCULATE", "PAYROLL_PERIOD_APPROVE", "PAYROLL_PERIOD_MARK_PAID", "PAYROLL_PERIOD_DELETE", "PAYROLL_DEDUCTION_CREATE", "PAYROLL_DEDUCTION_DELETE", "PAYROLL_DISBURSEMENT_CREATE", "SALARY_ADVANCE_CREATE", "SALARY_ADVANCE_APPROVE", "SALARY_ADVANCE_REJECT", "SALARY_ADVANCE_RECOVER", "SALARY_ADVANCE_DELETE", "PAYSLIP_REGISTER"],
  "Expenses": ["EXPENSE_CREATE", "EXPENSE_UPDATE", "EXPENSE_DELETE", "EXPENSE_CATEGORY_CREATE", "EXPENSE_CATEGORY_UPDATE", "EXPENSE_CATEGORY_DELETE"],
  "Cash Register": ["CASH_REGISTER_OPEN", "CASH_DROP", "CASH_REGISTER_CLOSE"],
  "Vendors & Procurement": ["VENDOR_CREATE", "VENDOR_UPDATE", "VENDOR_ARCHIVE", "VENDOR_RESTORE", "VENDOR_DELETE", "VENDOR_BILL_CREATE", "VENDOR_BILL_UPDATE", "VENDOR_BILL_DELETE", "PURCHASE_ORDER_CREATE", "PURCHASE_ORDER_STATUS_UPDATE", "PURCHASE_ORDER_RECEIVE", "PURCHASE_ORDER_DELETE", "STOCK_AUDIT_CREATE", "STOCK_AUDIT_APPROVE", "STOCK_TRANSFER_CREATE", "STOCK_TRANSFER_STATUS_UPDATE", "STOCK_TRANSFER_DELETE", "QUOTE_CREATE", "QUOTE_STATUS_UPDATE", "QUOTE_DELETE", "TAX_RATE_CREATE", "TAX_RATE_UPDATE", "TAX_RATE_DELETE"],
  "Auth": ["AUTH_ATTEMPT", "LOGIN", "SIGNUP", "PASSWORD_RESET"],
  "Settings": ["SETTINGS_UPDATE"],
  "Staff & Customers": ["CREATE", "UPDATE", "DELETE", "ARCHIVE", "RESTORE", "PERMANENT_DELETE", "STAFF_TRANSFER"],
};

export type AuditStatusFilter = "success" | "failed";
export type AuditKind = "created" | "changed" | "removed" | "other";

export interface AuditLogFilterState {
  groups: string[];
  resources: string[];
  users: string[];
  status: AuditStatusFilter | null;
  /** Inclusive local dates as yyyy-MM-dd; sent to the server as the query range. */
  dateFrom: string | null;
  dateTo: string | null;
}

export const EMPTY_AUDIT_LOG_FILTERS: AuditLogFilterState = {
  groups: [], resources: [], users: [], status: null, dateFrom: null, dateTo: null,
};

export interface FilterableAuditLog {
  action: string;
  resource: string;
  status?: string | null;
  userName?: string | null;
  userEmail?: string | null;
  resourceId?: string | null;
  ip?: string | null;
  timestamp: string | Date;
}

export const STATUS_LABELS: Record<AuditStatusFilter, string> = { success: "Succeeded", failed: "Failed" };

export const formatAuditText = (s: string) => s.replace(/_/g, " ");
export const auditUserLabel = (l: Pick<FilterableAuditLog, "userName" | "userEmail">) => l.userName || l.userEmail || "System";

export function auditKind(action: string): AuditKind {
  if (/DELETE|VOID|ARCHIVE|REJECT/.test(action)) return "removed";
  if (/CREATE|OPEN|REGISTER|RESTORE/.test(action)) return "created";
  if (/UPDATE|APPROVE|MARK_PAID|RECOVER|TRANSFER/.test(action)) return "changed";
  return "other";
}

export function isFailed(l: Pick<FilterableAuditLog, "status">): boolean {
  return l.status != null && l.status !== "success";
}

export function auditMatchesFilters(l: FilterableAuditLog, f: AuditLogFilterState): boolean {
  if (f.groups.length > 0 && !f.groups.some((g) => ACTION_GROUPS[g]?.includes(l.action))) return false;
  if (f.resources.length > 0 && !f.resources.includes(l.resource)) return false;
  if (f.users.length > 0 && !f.users.includes(auditUserLabel(l))) return false;
  if (f.status === "failed" && !isFailed(l)) return false;
  if (f.status === "success" && isFailed(l)) return false;
  return true;
}

export function auditMatchesSearch(l: FilterableAuditLog, term: string): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  return [l.action, l.resource, l.userEmail, l.userName, l.resourceId, l.ip].some((v) => v?.toLowerCase().includes(q));
}

export function countActiveAuditLogFilters(f: AuditLogFilterState): number {
  return (
    (f.groups.length > 0 ? 1 : 0) +
    (f.resources.length > 0 ? 1 : 0) +
    (f.users.length > 0 ? 1 : 0) +
    (f.status ? 1 : 0) +
    (f.dateFrom || f.dateTo ? 1 : 0)
  );
}

const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function auditDateRangeLabel(from: string | null, to: string | null): string {
  if (from && to) return from === to ? fmtDay(from) : `${fmtDay(from)} – ${fmtDay(to)}`;
  if (from) return `From ${fmtDay(from)}`;
  return to ? `Until ${fmtDay(to)}` : "";
}

export interface AuditLogFilterChip {
  key: "groups" | "resources" | "users" | "status" | "dateRange";
  label: string;
}

export function buildAuditLogFilterChips(f: AuditLogFilterState): AuditLogFilterChip[] {
  const chips: AuditLogFilterChip[] = [];
  if (f.groups.length > 0) chips.push({ key: "groups", label: f.groups.join(", ") });
  if (f.resources.length > 0) chips.push({ key: "resources", label: f.resources.map(formatAuditText).join(", ") });
  if (f.users.length > 0) chips.push({ key: "users", label: f.users.join(", ") });
  if (f.status) chips.push({ key: "status", label: STATUS_LABELS[f.status] });
  const range = auditDateRangeLabel(f.dateFrom, f.dateTo);
  if (range) chips.push({ key: "dateRange", label: range });
  return chips;
}

export function clearAuditLogFilterChip(f: AuditLogFilterState, key: AuditLogFilterChip["key"]): AuditLogFilterState {
  switch (key) {
    case "groups": return { ...f, groups: [] };
    case "resources": return { ...f, resources: [] };
    case "users": return { ...f, users: [] };
    case "status": return { ...f, status: null };
    case "dateRange": return { ...f, dateFrom: null, dateTo: null };
  }
}

export type AuditLogSortKey = "newest" | "oldest" | "user" | "action";
export interface AuditLogSortState {
  key: AuditLogSortKey;
}

export const AUDIT_LOG_SORT_OPTIONS: { value: AuditLogSortKey; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "user", label: "User (A–Z)" },
  { value: "action", label: "Action (A–Z)" },
];

export function auditLogSortLabel(sort: AuditLogSortState | null): string {
  if (!sort) return "Sort";
  return `Sort: ${AUDIT_LOG_SORT_OPTIONS.find((o) => o.value === sort.key)!.label}`;
}

export function sortAuditLogs<T extends FilterableAuditLog>(rows: T[], sort: AuditLogSortState | null): T[] {
  if (!sort) return rows;
  const time = (l: T) => new Date(l.timestamp).getTime();
  return [...rows].sort((a, b) => {
    switch (sort.key) {
      case "newest": return time(b) - time(a);
      case "oldest": return time(a) - time(b);
      case "user": return auditUserLabel(a).localeCompare(auditUserLabel(b));
      case "action": return a.action.localeCompare(b.action);
    }
  });
}
