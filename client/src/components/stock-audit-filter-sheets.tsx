import { FilterSheet, FilterSection, ChipOptions, OptionRows, SortSheet as SortRadioSheet } from "@/components/filter-sheet";
import {
  type AuditFilterState,
  type AuditSortState,
  type AuditSortKey,
  type AuditStatusFilter,
  type AuditDateFilter,
  STATUS_LABELS,
  DATE_LABELS,
  EMPTY_AUDIT_FILTERS,
  countActiveAuditFilters,
} from "@/lib/stock-audit-filters";

export function AuditFiltersSheet({ filters, onApply, resultCountFor, conductors, trigger }: {
  filters: AuditFilterState;
  onApply: (next: AuditFilterState) => void;
  resultCountFor: (draft: AuditFilterState) => number;
  /** Names of people who have conducted at least one audit. */
  conductors: string[];
  trigger: React.ReactNode;
}) {
  return (
    <FilterSheet
      applied={filters}
      empty={EMPTY_AUDIT_FILTERS}
      onApply={onApply}
      resultCountFor={resultCountFor}
      noun="audit"
      trigger={trigger}
      activeCount={countActiveAuditFilters}
    >
      {({ draft, patch }) => (
        <>
          <FilterSection
            label="Status"
            defaultOpen
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

          {conductors.length > 1 && (
            <FilterSection label="Conducted by" summary={draft.conductedBy.join(", ")} onClear={() => patch({ conductedBy: [] })}>
              <ChipOptions
                options={conductors.map((c) => ({ value: c, label: c, count: resultCountFor({ ...draft, conductedBy: [c] }) }))}
                value={draft.conductedBy}
                onChange={(conductedBy) => patch({ conductedBy })}
              />
            </FilterSection>
          )}

          <FilterSection
            label="Date"
            summary={draft.date ? DATE_LABELS[draft.date] : null}
            onClear={() => patch({ date: null })}
          >
            <OptionRows<AuditDateFilter>
              options={(Object.keys(DATE_LABELS) as AuditDateFilter[]).map((v) => ({
                value: v, label: DATE_LABELS[v], count: resultCountFor({ ...draft, date: v }),
              }))}
              value={draft.date}
              onChange={(date) => patch({ date })}
            />
          </FilterSection>
        </>
      )}
    </FilterSheet>
  );
}

const SORT_OPTIONS: { value: AuditSortKey; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "pending", label: "Pending first" },
];

export function AuditSortSheet({ sort, onChange, trigger }: {
  sort: AuditSortState | null;
  onChange: (next: AuditSortState) => void;
  trigger: React.ReactNode;
}) {
  return (
    <SortRadioSheet
      options={SORT_OPTIONS}
      value={sort?.key ?? null}
      onChange={(key) => onChange({ key })}
      trigger={trigger}
    />
  );
}
