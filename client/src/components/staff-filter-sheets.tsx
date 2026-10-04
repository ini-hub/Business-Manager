import {
  FilterSheet, FilterSection, ChipOptions, OptionRows, SortSheet as SortRadioSheet,
} from "@/components/filter-sheet";
import {
  type StaffFilterState,
  type StaffSortState,
  type StaffSortKey,
  type StaffSortDirection,
  type StaffAccountStatus,
  type StaffContractFilter,
  ACCOUNT_LABELS,
  CONTRACT_LABELS,
  EMPTY_STAFF_FILTERS,
  countActiveStaffFilters,
} from "@/lib/staff-filters";

interface FiltersSheetProps {
  filters: StaffFilterState;
  onApply: (next: StaffFilterState) => void;
  resultCountFor: (draft: StaffFilterState) => number;
  /** Roles present in the list, e.g. ["manager", "staff"]. */
  roles: string[];
  /** Branch names present in the list; empty unless viewing all stores. */
  branches: string[];
  trigger: React.ReactNode;
}

const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

export function StaffFiltersSheet({ filters, onApply, resultCountFor, roles, branches, trigger }: FiltersSheetProps) {
  return (
    <FilterSheet
      applied={filters}
      empty={EMPTY_STAFF_FILTERS}
      onApply={onApply}
      resultCountFor={resultCountFor}
      noun="staff member"
      plural="staff members"
      trigger={trigger}
      activeCount={countActiveStaffFilters}
    >
      {({ draft, patch }) => (
        <>
          {roles.length > 0 && (
            <FilterSection
              label="Role"
              defaultOpen
              summary={draft.roles.map(cap).join(", ")}
              onClear={() => patch({ roles: [] })}
            >
              <ChipOptions
                options={roles.map((r) => ({
                  value: r,
                  label: cap(r),
                  count: resultCountFor({ ...draft, roles: [r] }),
                }))}
                value={draft.roles}
                onChange={(roles) => patch({ roles })}
              />
            </FilterSection>
          )}

          {branches.length > 0 && (
            <FilterSection
              label="Branch"
              summary={draft.branches.join(", ")}
              onClear={() => patch({ branches: [] })}
            >
              <ChipOptions
                options={branches.map((b) => ({
                  value: b,
                  label: b,
                  count: resultCountFor({ ...draft, branches: [b] }),
                }))}
                value={draft.branches}
                onChange={(branches) => patch({ branches })}
              />
            </FilterSection>
          )}

          <FilterSection
            label="Account"
            defaultOpen={roles.length === 0}
            summary={draft.account ? ACCOUNT_LABELS[draft.account] : null}
            onClear={() => patch({ account: null })}
          >
            <OptionRows<StaffAccountStatus>
              options={(Object.keys(ACCOUNT_LABELS) as StaffAccountStatus[]).map((v) => ({
                value: v,
                label: ACCOUNT_LABELS[v],
                count: resultCountFor({ ...draft, account: v }),
              }))}
              value={draft.account}
              onChange={(account) => patch({ account })}
            />
          </FilterSection>

          <FilterSection
            label="Contract"
            summary={draft.contract ? CONTRACT_LABELS[draft.contract] : null}
            onClear={() => patch({ contract: null })}
          >
            <OptionRows<StaffContractFilter>
              options={(Object.keys(CONTRACT_LABELS) as StaffContractFilter[]).map((v) => ({
                value: v,
                label: CONTRACT_LABELS[v],
                count: resultCountFor({ ...draft, contract: v }),
              }))}
              value={draft.contract}
              onChange={(contract) => patch({ contract })}
            />
          </FilterSection>
        </>
      )}
    </FilterSheet>
  );
}

const SORT_OPTIONS: { value: string; label: string; key: StaffSortKey; direction: StaffSortDirection }[] = [
  { value: "name:asc", label: "Name", key: "name", direction: "asc" },
  { value: "role:asc", label: "Role", key: "role", direction: "asc" },
  { value: "dateAdded:desc", label: "Newest", key: "dateAdded", direction: "desc" },
];

export function StaffSortSheet({ sort, onChange, trigger }: {
  sort: StaffSortState | null;
  onChange: (next: StaffSortState) => void;
  trigger: React.ReactNode;
}) {
  return (
    <SortRadioSheet
      options={SORT_OPTIONS.map(({ value, label }) => ({ value, label }))}
      value={sort ? `${sort.key}:${sort.direction}` : null}
      onChange={(v) => {
        const o = SORT_OPTIONS.find((s) => s.value === v)!;
        onChange({ key: o.key, direction: o.direction });
      }}
      trigger={trigger}
    />
  );
}
