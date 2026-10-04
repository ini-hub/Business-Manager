import {
  FilterSheet, FilterSection, MoneyRange, OptionRows, SearchableOptions, SortSheet as SortRadioSheet,
} from "@/components/filter-sheet";
import {
  type CreditFilterState,
  type CreditSortState,
  type CreditSortKey,
  type CreditDueFilter,
  type CreditStage,
  STAGE_LABELS,
  DUE_LABELS,
  EMPTY_CREDIT_FILTERS,
  balanceSummary,
  countActiveCreditFilters,
} from "@/lib/credit-filters";

export function CreditFiltersSheet({ filters, onApply, resultCountFor, currencySymbol, customers, trigger }: {
  filters: CreditFilterState;
  onApply: (next: CreditFilterState) => void;
  resultCountFor: (draft: CreditFilterState) => number;
  currencySymbol: string;
  /** Customer names that have an entry in the ledger. */
  customers: string[];
  trigger: React.ReactNode;
}) {
  return (
    <FilterSheet
      applied={filters}
      empty={EMPTY_CREDIT_FILTERS}
      onApply={onApply}
      resultCountFor={resultCountFor}
      noun="entry"
      plural="entries"
      trigger={trigger}
      activeCount={countActiveCreditFilters}
    >
      {({ draft, patch }) => (
        <>
          <FilterSection
            label="Status"
            defaultOpen
            summary={draft.stage ? STAGE_LABELS[draft.stage] : null}
            onClear={() => patch({ stage: null })}
          >
            <OptionRows<CreditStage>
              options={(Object.keys(STAGE_LABELS) as CreditStage[]).map((v) => ({
                value: v, label: STAGE_LABELS[v], count: resultCountFor({ ...draft, stage: v }),
              }))}
              value={draft.stage}
              onChange={(stage) => patch({ stage })}
            />
          </FilterSection>

          <FilterSection
            label="Due date"
            summary={draft.due ? DUE_LABELS[draft.due] : null}
            onClear={() => patch({ due: null })}
          >
            <OptionRows<CreditDueFilter>
              options={(Object.keys(DUE_LABELS) as CreditDueFilter[]).map((v) => ({
                value: v, label: DUE_LABELS[v], count: resultCountFor({ ...draft, due: v }),
              }))}
              value={draft.due}
              onChange={(due) => patch({ due })}
            />
          </FilterSection>

          <FilterSection
            label="Outstanding balance"
            summary={balanceSummary(draft, currencySymbol)}
            onClear={() => patch({ balanceMin: null, balanceMax: null })}
          >
            <MoneyRange
              label="Outstanding balance"
              symbol={currencySymbol}
              min={draft.balanceMin}
              max={draft.balanceMax}
              onChange={(balanceMin, balanceMax) => patch({ balanceMin, balanceMax })}
            />
          </FilterSection>

          {customers.length > 0 && (
            <FilterSection label="Customer" summary={draft.customers.join(", ")} onClear={() => patch({ customers: [] })}>
              <SearchableOptions
                placeholder="Search customers"
                options={customers.map((c) => ({ value: c, label: c, count: resultCountFor({ ...draft, customers: [c] }) }))}
                value={draft.customers}
                onChange={(customers) => patch({ customers })}
              />
            </FilterSection>
          )}
        </>
      )}
    </FilterSheet>
  );
}

const SORT_OPTIONS: { value: CreditSortKey; label: string }[] = [
  { value: "dueSoonest", label: "Due soonest" },
  { value: "balanceHigh", label: "Balance: high to low" },
  { value: "balanceLow", label: "Balance: low to high" },
];

export function CreditSortSheet({ sort, onChange, trigger }: {
  sort: CreditSortState | null;
  onChange: (next: CreditSortState) => void;
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
