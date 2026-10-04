import { DateRangeSection } from "@/components/filter-date-range-section";
import {
  ChipOptions, FilterSheet, FilterSection, MoneyRange, OptionRows, SearchableOptions, SortSheet as SortRadioSheet, SwitchRows,
} from "@/components/filter-sheet";
import {
  type SaleFilterState,
  type SaleItemType,
  type SaleSortState,
  type SaleSortKey,
  type SaleSortDirection,
  EMPTY_SALE_FILTERS,
  countActiveSaleFilters,
  saleDateRangeLabel,
} from "@/lib/sale-filters";

interface SaleFiltersSheetProps {
  filters: SaleFilterState;
  onApply: (next: SaleFilterState) => void;
  resultCountFor: (draft: SaleFilterState) => number;
  currencySymbol: string;
  paymentMethods: string[];
  staffOptions: { id: string; name: string }[];
  trigger: React.ReactNode;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const money = (n: number, s: string) => `${s}${n.toLocaleString()}`;

export function SaleFiltersSheet({ filters, onApply, resultCountFor, currencySymbol, paymentMethods, staffOptions, trigger }: SaleFiltersSheetProps) {
  return (
    <FilterSheet
      applied={filters}
      empty={EMPTY_SALE_FILTERS}
      onApply={onApply}
      resultCountFor={resultCountFor}
      noun="sale"
      trigger={trigger}
      activeCount={countActiveSaleFilters}
    >
      {({ draft, patch }) => {
        const amountSummary = draft.amountMin != null && draft.amountMax != null
          ? `${money(draft.amountMin, currencySymbol)} to ${money(draft.amountMax, currencySymbol)}`
          : draft.amountMin != null ? `${money(draft.amountMin, currencySymbol)} or more`
          : draft.amountMax != null ? `Up to ${money(draft.amountMax, currencySymbol)}` : null;
        const staffName = staffOptions.find((s) => s.id === draft.staffId)?.name;
        const saleTypes = [draft.returnsOnly && "Returns", draft.creditOnly && "Credit", draft.staffPurchasesOnly && "Staff purchases"].filter(Boolean) as string[];
        return (
          <>
            <DateRangeSection from={draft.dateFrom} to={draft.dateTo} summary={saleDateRangeLabel(draft.dateFrom, draft.dateTo)} onChange={(dateFrom, dateTo) => patch({ dateFrom, dateTo })} />

            <FilterSection
              label="Sale type"
              defaultOpen
              summary={saleTypes.join(", ")}
              onClear={() => patch({ returnsOnly: false, creditOnly: false, staffPurchasesOnly: false })}
            >
              <SwitchRows
                rows={[
                  { label: "Returns", checked: draft.returnsOnly, onChange: (v) => patch({ returnsOnly: v }), count: resultCountFor({ ...draft, returnsOnly: true }) },
                  { label: "Credit sales", checked: draft.creditOnly, onChange: (v) => patch({ creditOnly: v }), count: resultCountFor({ ...draft, creditOnly: true }) },
                  { label: "Staff purchases", checked: draft.staffPurchasesOnly, onChange: (v) => patch({ staffPurchasesOnly: v }), count: resultCountFor({ ...draft, staffPurchasesOnly: true }) },
                ]}
              />
            </FilterSection>

            <FilterSection label="Payment method" summary={draft.paymentMethod ? cap(draft.paymentMethod) : null} onClear={() => patch({ paymentMethod: null })}>
              <OptionRows
                options={paymentMethods.map((m) => ({ value: m, label: cap(m), count: resultCountFor({ ...draft, paymentMethod: m }) }))}
                value={draft.paymentMethod}
                onChange={(v) => patch({ paymentMethod: v })}
              />
            </FilterSection>

            <FilterSection label="Amount" summary={amountSummary} onClear={() => patch({ amountMin: null, amountMax: null })}>
              <MoneyRange label="Amount" symbol={currencySymbol} min={draft.amountMin} max={draft.amountMax} onChange={(min, max) => patch({ amountMin: min, amountMax: max })} />
            </FilterSection>

            {staffOptions.length > 0 && (
              <FilterSection label="Staff" summary={staffName} onClear={() => patch({ staffId: null })}>
                {staffOptions.length > 6 ? (
                  <SearchableOptions
                    options={staffOptions.map((s) => ({ value: s.id, label: s.name, count: resultCountFor({ ...draft, staffId: s.id }) }))}
                    value={draft.staffId ? [draft.staffId] : []}
                    onChange={(v) => patch({ staffId: v[v.length - 1] ?? null })}
                    placeholder="Search staff"
                  />
                ) : (
                  <OptionRows
                    options={staffOptions.map((s) => ({ value: s.id, label: s.name, count: resultCountFor({ ...draft, staffId: s.id }) }))}
                    value={draft.staffId}
                    onChange={(v) => patch({ staffId: v })}
                  />
                )}
              </FilterSection>
            )}

            <FilterSection label="Item type" summary={draft.itemType ? cap(draft.itemType) : null} onClear={() => patch({ itemType: null })}>
              <ChipOptions
                options={(["service", "product", "mixed"] as SaleItemType[]).map((t) => ({ value: t, label: cap(t), count: resultCountFor({ ...draft, itemType: t }) }))}
                value={draft.itemType ? [draft.itemType] : []}
                onChange={(v) => patch({ itemType: (v[v.length - 1] as SaleItemType | undefined) ?? null })}
              />
            </FilterSection>
          </>
        );
      }}
    </FilterSheet>
  );
}

const SORT_OPTIONS: { value: string; label: string; key: SaleSortKey; direction: SaleSortDirection }[] = [
  { value: "date:desc", label: "Newest", key: "date", direction: "desc" },
  { value: "amount:desc", label: "Amount: high to low", key: "amount", direction: "desc" },
  { value: "amount:asc", label: "Amount: low to high", key: "amount", direction: "asc" },
];

/** Sort lives in its own sheet and applies instantly; it never sits behind "Show N sales". */
export function SaleSortSheet({ sort, onChange, trigger }: { sort: SaleSortState | null; onChange: (s: SaleSortState | null) => void; trigger: React.ReactNode }) {
  return (
    <SortRadioSheet
      options={SORT_OPTIONS.map(({ value, label }) => ({ value, label }))}
      value={sort ? `${sort.key}:${sort.direction}` : "date:desc"}
      onChange={(v) => {
        const o = SORT_OPTIONS.find((s) => s.value === v)!;
        onChange(o.key === "date" ? null : { key: o.key, direction: o.direction });
      }}
      trigger={trigger}
    />
  );
}

export const saleSortButtonLabel = (sort: SaleSortState | null) =>
  `Sort: ${SORT_OPTIONS.find((o) => o.value === (sort ? `${sort.key}:${sort.direction}` : "date:desc"))?.label ?? "Newest"}`;
