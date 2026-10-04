import {
  FilterSheet, FilterSection, ChipOptions, MoneyRange, OptionRows, SearchableOptions, SortSheet as SortRadioSheet,
} from "@/components/filter-sheet";
import { DateRangeSection } from "@/components/filter-date-range-section";
import {
  expenseDateRangeLabel,
  type ExpenseFilterState,
  type ExpenseSortState,
  type ExpenseSortKey,
  type ExpenseKindFilter,
  type ExpenseSourceFilter,
  type ExpensePaymentFilter,
  KIND_LABELS,
  SOURCE_LABELS,
  PAYMENT_LABELS,
  EMPTY_EXPENSE_FILTERS,
  amountSummary,
  countActiveExpenseFilters,
} from "@/lib/expense-filters";

export function ExpenseFiltersSheet({ filters, onApply, resultCountFor, currencySymbol, categories, trigger }: {
  filters: ExpenseFilterState;
  onApply: (next: ExpenseFilterState) => void;
  resultCountFor: (draft: ExpenseFilterState) => number;
  currencySymbol: string;
  /** Category names present in the loaded expenses. */
  categories: string[];
  trigger: React.ReactNode;
}) {
  const categoryOptions = (draft: ExpenseFilterState) =>
    categories.map((c) => ({ value: c, label: c, count: resultCountFor({ ...draft, categories: [c] }) }));
  return (
    <FilterSheet
      applied={filters}
      empty={EMPTY_EXPENSE_FILTERS}
      onApply={onApply}
      resultCountFor={resultCountFor}
      noun="expense"
      trigger={trigger}
      activeCount={countActiveExpenseFilters}
    >
      {({ draft, patch }) => (
        <>
          <DateRangeSection
            from={draft.dateFrom}
            to={draft.dateTo}
            summary={expenseDateRangeLabel(draft.dateFrom, draft.dateTo)}
            onChange={(dateFrom, dateTo) => patch({ dateFrom, dateTo })}
          />

          <FilterSection
            label="Type"
            defaultOpen
            summary={draft.kind ? KIND_LABELS[draft.kind] : null}
            onClear={() => patch({ kind: null })}
          >
            <OptionRows<ExpenseKindFilter>
              options={(Object.keys(KIND_LABELS) as ExpenseKindFilter[]).map((v) => ({
                value: v, label: KIND_LABELS[v], count: resultCountFor({ ...draft, kind: v }),
              }))}
              value={draft.kind}
              onChange={(kind) => patch({ kind })}
            />
          </FilterSection>

          {categories.length > 0 && (
            <FilterSection label="Category" summary={draft.categories.join(", ")} onClear={() => patch({ categories: [] })}>
              {categories.length > 6 ? (
                <SearchableOptions
                  placeholder="Search categories"
                  options={categoryOptions(draft)}
                  value={draft.categories}
                  onChange={(categories) => patch({ categories })}
                />
              ) : (
                <ChipOptions
                  options={categoryOptions(draft)}
                  value={draft.categories}
                  onChange={(categories) => patch({ categories })}
                />
              )}
            </FilterSection>
          )}

          <FilterSection
            label="Payment method"
            summary={draft.payment ? PAYMENT_LABELS[draft.payment] : null}
            onClear={() => patch({ payment: null })}
          >
            <OptionRows<ExpensePaymentFilter>
              options={(Object.keys(PAYMENT_LABELS) as ExpensePaymentFilter[]).map((v) => ({
                value: v, label: PAYMENT_LABELS[v], count: resultCountFor({ ...draft, payment: v }),
              }))}
              value={draft.payment}
              onChange={(payment) => patch({ payment })}
            />
          </FilterSection>

          <FilterSection
            label="Logged by"
            summary={draft.source ? SOURCE_LABELS[draft.source] : null}
            onClear={() => patch({ source: null })}
          >
            <OptionRows<ExpenseSourceFilter>
              options={(Object.keys(SOURCE_LABELS) as ExpenseSourceFilter[]).map((v) => ({
                value: v, label: SOURCE_LABELS[v], count: resultCountFor({ ...draft, source: v }),
              }))}
              value={draft.source}
              onChange={(source) => patch({ source })}
            />
          </FilterSection>

          <FilterSection
            label="Amount"
            summary={amountSummary(draft, currencySymbol)}
            onClear={() => patch({ amountMin: null, amountMax: null })}
          >
            <MoneyRange
              label="Amount"
              symbol={currencySymbol}
              min={draft.amountMin}
              max={draft.amountMax}
              onChange={(amountMin, amountMax) => patch({ amountMin, amountMax })}
            />
          </FilterSection>
        </>
      )}
    </FilterSheet>
  );
}

const SORT_OPTIONS: { value: ExpenseSortKey; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "amountHigh", label: "Highest amount" },
  { value: "amountLow", label: "Lowest amount" },
];

export function ExpenseSortSheet({ sort, onChange, trigger }: {
  sort: ExpenseSortState | null;
  onChange: (next: ExpenseSortState) => void;
  trigger: React.ReactNode;
}) {
  return <SortRadioSheet options={SORT_OPTIONS} value={sort?.key ?? null} onChange={(key) => onChange({ key })} trigger={trigger} />;
}
