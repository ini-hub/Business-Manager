import {
  FilterSheet, FilterSection, ChipOptions, OptionRows, SearchableOptions, SortSheet as SortRadioSheet,
} from "@/components/filter-sheet";
import { DateRangeSection } from "@/components/filter-date-range-section";
import {
  type AuditLogFilterState,
  type AuditLogSortState,
  type AuditStatusFilter,
  ACTION_GROUPS,
  AUDIT_LOG_SORT_OPTIONS,
  EMPTY_AUDIT_LOG_FILTERS,
  STATUS_LABELS,
  auditDateRangeLabel,
  countActiveAuditLogFilters,
  formatAuditText,
} from "@/lib/audit-log-filters";

export function AuditLogFiltersSheet({ filters, onApply, resultCountFor, resources, users, trigger }: {
  filters: AuditLogFilterState;
  onApply: (next: AuditLogFilterState) => void;
  resultCountFor: (draft: AuditLogFilterState) => number;
  /** Resources and users present in the loaded entries. */
  resources: string[];
  users: string[];
  trigger: React.ReactNode;
}) {
  return (
    <FilterSheet
      applied={filters}
      empty={EMPTY_AUDIT_LOG_FILTERS}
      onApply={onApply}
      resultCountFor={resultCountFor}
      noun="entry"
      trigger={trigger}
      activeCount={countActiveAuditLogFilters}
    >
      {({ draft, patch }) => (
        <>
          <DateRangeSection
            from={draft.dateFrom}
            to={draft.dateTo}
            summary={auditDateRangeLabel(draft.dateFrom, draft.dateTo)}
            onChange={(dateFrom, dateTo) => patch({ dateFrom, dateTo })}
          />

          <FilterSection label="Area" defaultOpen summary={draft.groups.join(", ")} onClear={() => patch({ groups: [] })}>
            <ChipOptions
              options={Object.keys(ACTION_GROUPS).map((g) => ({ value: g, label: g, count: resultCountFor({ ...draft, groups: [g] }) }))}
              value={draft.groups}
              onChange={(groups) => patch({ groups })}
            />
          </FilterSection>

          <FilterSection
            label="Outcome"
            summary={draft.status ? STATUS_LABELS[draft.status] : null}
            onClear={() => patch({ status: null })}
          >
            <OptionRows<AuditStatusFilter>
              options={(Object.keys(STATUS_LABELS) as AuditStatusFilter[]).map((v) => ({
                value: v, label: STATUS_LABELS[v], count: resultCountFor({ ...draft, status: v }),
              }))}
              value={draft.status}
              onChange={(status) => patch({ status })}
            />
          </FilterSection>

          {users.length > 0 && (
            <FilterSection label="User" summary={draft.users.join(", ")} onClear={() => patch({ users: [] })}>
              <SearchableOptions
                placeholder="Search users"
                options={users.map((u) => ({ value: u, label: u, count: resultCountFor({ ...draft, users: [u] }) }))}
                value={draft.users}
                onChange={(next) => patch({ users: next })}
              />
            </FilterSection>
          )}

          {resources.length > 0 && (
            <FilterSection label="Resource" summary={draft.resources.map(formatAuditText).join(", ")} onClear={() => patch({ resources: [] })}>
              <SearchableOptions
                placeholder="Search resources"
                options={resources.map((r) => ({ value: r, label: formatAuditText(r), count: resultCountFor({ ...draft, resources: [r] }) }))}
                value={draft.resources}
                onChange={(next) => patch({ resources: next })}
              />
            </FilterSection>
          )}
        </>
      )}
    </FilterSheet>
  );
}

export function AuditLogSortSheet({ sort, onChange, trigger }: {
  sort: AuditLogSortState | null;
  onChange: (next: AuditLogSortState) => void;
  trigger: React.ReactNode;
}) {
  return <SortRadioSheet options={AUDIT_LOG_SORT_OPTIONS} value={sort?.key ?? null} onChange={(key) => onChange({ key })} trigger={trigger} />;
}
