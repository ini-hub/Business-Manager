import {
  FilterSheet, FilterSection, ChipOptions, MoneyRange, SearchableOptions, SortSheet as SortRadioSheet,
} from "@/components/filter-sheet";
import {
  type InventoryFilterState,
  type InventorySortState,
  type InventorySortKey,
  type InventoryItemType,
  type InventoryStockStatus,
  TYPE_LABELS,
  STOCK_LABELS,
  EMPTY_INVENTORY_FILTERS,
  countActiveInventoryFilters,
  rangeSummary,
} from "@/lib/inventory-filters";

export function InventoryFiltersSheet({ filters, onApply, resultCountFor, currencySymbol, categories, trigger }: {
  filters: InventoryFilterState;
  onApply: (next: InventoryFilterState) => void;
  resultCountFor: (draft: InventoryFilterState) => number;
  currencySymbol: string;
  categories: string[];
  trigger: React.ReactNode;
}) {
  const categoryOptions = (draft: InventoryFilterState) =>
    categories.map((c) => ({ value: c, label: c, count: resultCountFor({ ...draft, categories: [c] }) }));
  return (
    <FilterSheet
      applied={filters}
      empty={EMPTY_INVENTORY_FILTERS}
      onApply={onApply}
      resultCountFor={resultCountFor}
      noun="item"
      trigger={trigger}
      activeCount={countActiveInventoryFilters}
    >
      {({ draft, patch }) => (
        <>
          <FilterSection
            label="Type"
            defaultOpen
            summary={draft.types.map((t) => TYPE_LABELS[t]).join(", ")}
            onClear={() => patch({ types: [] })}
          >
            <ChipOptions
              options={(Object.keys(TYPE_LABELS) as InventoryItemType[]).map((v) => ({
                value: v, label: TYPE_LABELS[v], count: resultCountFor({ ...draft, types: [v] }),
              }))}
              value={draft.types}
              onChange={(types) => patch({ types: types as InventoryItemType[] })}
            />
          </FilterSection>

          <FilterSection
            label="Stock status"
            defaultOpen
            summary={draft.stock.map((s) => STOCK_LABELS[s]).join(", ")}
            onClear={() => patch({ stock: [] })}
          >
            <ChipOptions
              options={(Object.keys(STOCK_LABELS) as InventoryStockStatus[]).map((v) => ({
                value: v, label: STOCK_LABELS[v], count: resultCountFor({ ...draft, stock: [v] }),
              }))}
              value={draft.stock}
              onChange={(stock) => patch({ stock: stock as InventoryStockStatus[] })}
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
                <ChipOptions options={categoryOptions(draft)} value={draft.categories} onChange={(categories) => patch({ categories })} />
              )}
            </FilterSection>
          )}

          <FilterSection
            label="Price"
            summary={rangeSummary(draft.priceMin, draft.priceMax, (n) => `${currencySymbol}${n.toLocaleString()}`)}
            onClear={() => patch({ priceMin: null, priceMax: null })}
          >
            <MoneyRange
              label="Price"
              symbol={currencySymbol}
              min={draft.priceMin}
              max={draft.priceMax}
              onChange={(priceMin, priceMax) => patch({ priceMin, priceMax })}
            />
          </FilterSection>

          <FilterSection
            label="Margin"
            summary={rangeSummary(draft.marginMin, draft.marginMax, (n) => `${n}%`)}
            onClear={() => patch({ marginMin: null, marginMax: null })}
          >
            <MoneyRange
              label="Margin"
              symbol="%"
              min={draft.marginMin}
              max={draft.marginMax}
              onChange={(marginMin, marginMax) => patch({ marginMin, marginMax })}
            />
          </FilterSection>
        </>
      )}
    </FilterSheet>
  );
}

const SORT_OPTIONS: { value: InventorySortKey; label: string }[] = [
  { value: "lowestStock", label: "Lowest stock" },
  { value: "margin", label: "Highest margin" },
  { value: "newest", label: "Newest" },
  { value: "name", label: "Name" },
];

export function InventorySortSheet({ sort, onChange, trigger }: {
  sort: InventorySortState | null;
  onChange: (next: InventorySortState) => void;
  trigger: React.ReactNode;
}) {
  return <SortRadioSheet options={SORT_OPTIONS} value={sort?.key ?? null} onChange={(key) => onChange({ key })} trigger={trigger} />;
}
