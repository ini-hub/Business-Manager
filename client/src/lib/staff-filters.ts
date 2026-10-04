/**
 * Pure filter/sort logic for the Staff list's Filters + Sort bottom sheets.
 * Framework-free so it can be unit tested without mounting the page.
 */

export type StaffAccountStatus = "active" | "invited" | "not-invited";
export type StaffContractFilter = "signed" | "pending";

export interface StaffFilterState {
  roles: string[];
  branches: string[];
  account: StaffAccountStatus | null;
  contract: StaffContractFilter | null;
}

export const EMPTY_STAFF_FILTERS: StaffFilterState = {
  roles: [],
  branches: [],
  account: null,
  contract: null,
};

export type StaffSortKey = "name" | "role" | "dateAdded";
export type StaffSortDirection = "asc" | "desc";
export interface StaffSortState {
  key: StaffSortKey;
  direction: StaffSortDirection;
}

export interface FilterableStaff {
  name: string;
  role?: string | null;
  storeName?: string;
  inviteStatus?: string;
  contractStatus?: string;
  createdAt?: string | Date | null;
}

/** Collapses the server's invite states into the three the manager cares about. */
export function accountStatusOf(s: { inviteStatus?: string }): StaffAccountStatus {
  if (s.inviteStatus === "active") return "active";
  if (s.inviteStatus === "pending" || s.inviteStatus === "partial") return "invited";
  return "not-invited";
}

export function staffMatchesFilters<T extends FilterableStaff>(s: T, f: StaffFilterState): boolean {
  if (f.roles.length > 0 && !f.roles.includes(s.role || "staff")) return false;
  if (f.branches.length > 0 && !f.branches.includes(s.storeName || "Global")) return false;
  if (f.account && accountStatusOf(s) !== f.account) return false;
  if (f.contract === "signed" && s.contractStatus !== "signed") return false;
  if (f.contract === "pending" && s.contractStatus === "signed") return false;
  return true;
}

export function countActiveStaffFilters(f: StaffFilterState): number {
  return (f.roles.length > 0 ? 1 : 0) + (f.branches.length > 0 ? 1 : 0) + (f.account ? 1 : 0) + (f.contract ? 1 : 0);
}

export const ACCOUNT_LABELS: Record<StaffAccountStatus, string> = {
  active: "Account active",
  invited: "Invite pending",
  "not-invited": "Not invited",
};

export const CONTRACT_LABELS: Record<StaffContractFilter, string> = {
  signed: "Contract signed",
  pending: "Contract pending",
};

const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

export interface StaffFilterChip {
  key: "roles" | "branches" | "account" | "contract";
  label: string;
}

export function buildStaffFilterChips(f: StaffFilterState): StaffFilterChip[] {
  const chips: StaffFilterChip[] = [];
  if (f.roles.length > 0) chips.push({ key: "roles", label: f.roles.map(cap).join(", ") });
  if (f.branches.length > 0) chips.push({ key: "branches", label: f.branches.join(", ") });
  if (f.account) chips.push({ key: "account", label: ACCOUNT_LABELS[f.account] });
  if (f.contract) chips.push({ key: "contract", label: CONTRACT_LABELS[f.contract] });
  return chips;
}

export function clearStaffFilterChip(f: StaffFilterState, key: StaffFilterChip["key"]): StaffFilterState {
  switch (key) {
    case "roles": return { ...f, roles: [] };
    case "branches": return { ...f, branches: [] };
    case "account": return { ...f, account: null };
    case "contract": return { ...f, contract: null };
  }
}

export function staffSortLabel(sort: StaffSortState | null): string {
  if (!sort) return "Sort";
  switch (sort.key) {
    case "name": return "Sort: Name";
    case "role": return "Sort: Role";
    case "dateAdded": return "Sort: Newest";
  }
}

export function sortStaff<T extends FilterableStaff>(rows: T[], sort: StaffSortState | null): T[] {
  if (!sort) return rows;
  const dir = sort.direction === "asc" ? 1 : -1;
  const time = (r: T) => (r.createdAt ? new Date(r.createdAt).getTime() : 0);
  return [...rows].sort((a, b) => {
    switch (sort.key) {
      case "name": return a.name.localeCompare(b.name) * dir;
      case "role": return (a.role || "staff").localeCompare(b.role || "staff") * dir || a.name.localeCompare(b.name);
      case "dateAdded": return (time(a) - time(b)) * dir;
    }
  });
}
