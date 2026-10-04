import { FilterSheet, FilterSection, MoneyRange, OptionRows, SortSheet as SortRadioSheet } from "@/components/filter-sheet";
import {
  type QuoteFilterState,
  type QuoteSortState,
  type QuoteSortKey,
  type QuoteStatusFilter,
  type QuoteCreatedFilter,
  type QuoteExpiryFilter,
  STATUS_LABELS,
  CREATED_LABELS,
  EXPIRY_LABELS,
  EMPTY_QUOTE_FILTERS,
  countActiveQuoteFilters,
  valueSummary,
} from "@/lib/quote-filters";

export function QuoteFiltersSheet({ filters, onApply, resultCountFor, currencySymbol, trigger }: {
  filters: QuoteFilterState;
  onApply: (next: QuoteFilterState) => void;
  resultCountFor: (draft: QuoteFilterState) => number;
  currencySymbol: string;
  trigger: React.ReactNode;
}) {
  return (
    <FilterSheet
      applied={filters}
      empty={EMPTY_QUOTE_FILTERS}
      onApply={onApply}
      resultCountFor={resultCountFor}
      noun="quote"
      trigger={trigger}
      activeCount={countActiveQuoteFilters}
    >
      {({ draft, patch }) => (
        <>
          <FilterSection
            label="Status"
            defaultOpen
            summary={draft.status ? STATUS_LABELS[draft.status] : null}
            onClear={() => patch({ status: null })}
          >
            <OptionRows<QuoteStatusFilter>
              options={(Object.keys(STATUS_LABELS) as QuoteStatusFilter[]).map((v) => ({
                value: v, label: STATUS_LABELS[v], count: resultCountFor({ ...draft, status: v }),
              }))}
              value={draft.status}
              onChange={(status) => patch({ status })}
            />
          </FilterSection>

          <FilterSection
            label="Created"
            summary={draft.created ? CREATED_LABELS[draft.created] : null}
            onClear={() => patch({ created: null })}
          >
            <OptionRows<QuoteCreatedFilter>
              options={(Object.keys(CREATED_LABELS) as QuoteCreatedFilter[]).map((v) => ({
                value: v, label: CREATED_LABELS[v], count: resultCountFor({ ...draft, created: v }),
              }))}
              value={draft.created}
              onChange={(created) => patch({ created })}
            />
          </FilterSection>

          <FilterSection
            label="Expiry"
            summary={draft.expiry ? EXPIRY_LABELS[draft.expiry] : null}
            onClear={() => patch({ expiry: null })}
          >
            <OptionRows<QuoteExpiryFilter>
              options={(Object.keys(EXPIRY_LABELS) as QuoteExpiryFilter[]).map((v) => ({
                value: v, label: EXPIRY_LABELS[v], count: resultCountFor({ ...draft, expiry: v }),
              }))}
              value={draft.expiry}
              onChange={(expiry) => patch({ expiry })}
            />
          </FilterSection>

          <FilterSection
            label="Estimated value"
            summary={valueSummary(draft, currencySymbol)}
            onClear={() => patch({ valueMin: null, valueMax: null })}
          >
            <MoneyRange
              label="Estimated value"
              symbol={currencySymbol}
              min={draft.valueMin}
              max={draft.valueMax}
              onChange={(valueMin, valueMax) => patch({ valueMin, valueMax })}
            />
          </FilterSection>
        </>
      )}
    </FilterSheet>
  );
}

const SORT_OPTIONS: { value: QuoteSortKey; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "valueHigh", label: "Highest value" },
  { value: "valueLow", label: "Lowest value" },
  { value: "expiring", label: "Expiring soonest" },
];

export function QuoteSortSheet({ sort, onChange, trigger }: {
  sort: QuoteSortState | null;
  onChange: (next: QuoteSortState) => void;
  trigger: React.ReactNode;
}) {
  return <SortRadioSheet options={SORT_OPTIONS} value={sort?.key ?? null} onChange={(key) => onChange({ key })} trigger={trigger} />;
}
