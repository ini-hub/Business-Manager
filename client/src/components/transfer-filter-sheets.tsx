import { FilterSheet, FilterSection, ChipOptions, OptionRows, SortSheet as SortRadioSheet } from "@/components/filter-sheet";
import {
  type TransferFilterState,
  type TransferSortState,
  type TransferSortKey,
  type TransferDirection,
  type TransferStage,
  STAGE_LABELS,
  type TransferDateFilter,
  DIRECTION_LABELS,
  DATE_LABELS,
  EMPTY_TRANSFER_FILTERS,
  countActiveTransferFilters,
} from "@/lib/transfer-filters";

export function TransferFiltersSheet({ filters, onApply, resultCountFor, branches, trigger }: {
  filters: TransferFilterState;
  onApply: (next: TransferFilterState) => void;
  resultCountFor: (draft: TransferFilterState) => number;
  /** Branch names that appear in the registry. */
  branches: string[];
  trigger: React.ReactNode;
}) {
  return (
    <FilterSheet
      applied={filters}
      empty={EMPTY_TRANSFER_FILTERS}
      onApply={onApply}
      resultCountFor={resultCountFor}
      noun="transfer"
      trigger={trigger}
      activeCount={countActiveTransferFilters}
    >
      {({ draft, patch }) => (
        <>
          <FilterSection
            label="Status"
            defaultOpen
            summary={draft.stage ? STAGE_LABELS[draft.stage] : null}
            onClear={() => patch({ stage: null })}
          >
            <OptionRows<TransferStage>
              options={(Object.keys(STAGE_LABELS) as TransferStage[]).map((v) => ({
                value: v, label: STAGE_LABELS[v], count: resultCountFor({ ...draft, stage: v }),
              }))}
              value={draft.stage}
              onChange={(stage) => patch({ stage })}
            />
          </FilterSection>

          <FilterSection
            label="Direction"
            summary={draft.direction ? DIRECTION_LABELS[draft.direction] : null}
            onClear={() => patch({ direction: null })}
          >
            <OptionRows<TransferDirection>
              options={(Object.keys(DIRECTION_LABELS) as TransferDirection[]).map((v) => ({
                value: v, label: DIRECTION_LABELS[v], count: resultCountFor({ ...draft, direction: v }),
              }))}
              value={draft.direction}
              onChange={(direction) => patch({ direction })}
            />
          </FilterSection>

          {branches.length > 1 && (
            <>
              <FilterSection label="Origin branch" summary={draft.from.join(", ")} onClear={() => patch({ from: [] })}>
                <ChipOptions
                  options={branches.map((b) => ({ value: b, label: b, count: resultCountFor({ ...draft, from: [b] }) }))}
                  value={draft.from}
                  onChange={(from) => patch({ from })}
                />
              </FilterSection>
              <FilterSection label="Destination branch" summary={draft.to.join(", ")} onClear={() => patch({ to: [] })}>
                <ChipOptions
                  options={branches.map((b) => ({ value: b, label: b, count: resultCountFor({ ...draft, to: [b] }) }))}
                  value={draft.to}
                  onChange={(to) => patch({ to })}
                />
              </FilterSection>
            </>
          )}

          <FilterSection
            label="Date"
            summary={draft.date ? DATE_LABELS[draft.date] : null}
            onClear={() => patch({ date: null })}
          >
            <OptionRows<TransferDateFilter>
              options={(Object.keys(DATE_LABELS) as TransferDateFilter[]).map((v) => ({
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

const SORT_OPTIONS: { value: TransferSortKey; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "route", label: "Route" },
];

export function TransferSortSheet({ sort, onChange, trigger }: {
  sort: TransferSortState | null;
  onChange: (next: TransferSortState) => void;
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
