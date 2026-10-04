import { FilterSheet, FilterSection, OptionRows, SortSheet as SortRadioSheet } from "@/components/filter-sheet";
import {
  type VendorFilterState,
  type VendorSortState,
  type VendorSortKey,
  type VendorBalanceFilter,
  type VendorOrdersFilter,
  type VendorLastOrderFilter,
  BALANCE_LABELS,
  ORDERS_LABELS,
  LAST_ORDER_LABELS,
  EMPTY_VENDOR_FILTERS,
  countActiveVendorFilters,
} from "@/lib/vendor-filters";

export function VendorFiltersSheet({ filters, onApply, resultCountFor, trigger }: {
  filters: VendorFilterState;
  onApply: (next: VendorFilterState) => void;
  resultCountFor: (draft: VendorFilterState) => number;
  trigger: React.ReactNode;
}) {
  return (
    <FilterSheet
      applied={filters}
      empty={EMPTY_VENDOR_FILTERS}
      onApply={onApply}
      resultCountFor={resultCountFor}
      noun="vendor"
      trigger={trigger}
      activeCount={countActiveVendorFilters}
    >
      {({ draft, patch }) => (
        <>
          <FilterSection
            label="Balance"
            defaultOpen
            summary={draft.balance ? BALANCE_LABELS[draft.balance] : null}
            onClear={() => patch({ balance: null })}
          >
            <OptionRows<VendorBalanceFilter>
              options={(Object.keys(BALANCE_LABELS) as VendorBalanceFilter[]).map((v) => ({
                value: v, label: BALANCE_LABELS[v], count: resultCountFor({ ...draft, balance: v }),
              }))}
              value={draft.balance}
              onChange={(balance) => patch({ balance })}
            />
          </FilterSection>
          <FilterSection
            label="Orders"
            summary={draft.orders ? ORDERS_LABELS[draft.orders] : null}
            onClear={() => patch({ orders: null })}
          >
            <OptionRows<VendorOrdersFilter>
              options={(Object.keys(ORDERS_LABELS) as VendorOrdersFilter[]).map((v) => ({
                value: v, label: ORDERS_LABELS[v], count: resultCountFor({ ...draft, orders: v }),
              }))}
              value={draft.orders}
              onChange={(orders) => patch({ orders })}
            />
          </FilterSection>
          <FilterSection
            label="Last order"
            summary={draft.lastOrder ? LAST_ORDER_LABELS[draft.lastOrder] : null}
            onClear={() => patch({ lastOrder: null })}
          >
            <OptionRows<VendorLastOrderFilter>
              options={(Object.keys(LAST_ORDER_LABELS) as VendorLastOrderFilter[]).map((v) => ({
                value: v, label: LAST_ORDER_LABELS[v], count: resultCountFor({ ...draft, lastOrder: v }),
              }))}
              value={draft.lastOrder}
              onChange={(lastOrder) => patch({ lastOrder })}
            />
          </FilterSection>
        </>
      )}
    </FilterSheet>
  );
}

const SORT_OPTIONS: { value: string; label: string; key: VendorSortKey; direction: "asc" | "desc" }[] = [
  { value: "name:asc", label: "Name", key: "name", direction: "asc" },
  { value: "lastOrder:desc", label: "Latest order", key: "lastOrder", direction: "desc" },
  { value: "openOrders:desc", label: "Most open orders", key: "openOrders", direction: "desc" },
  { value: "outstanding:desc", label: "Highest balance", key: "outstanding", direction: "desc" },
];

export function VendorSortSheet({ sort, onChange, nameOnly, trigger }: {
  sort: VendorSortState | null;
  onChange: (next: VendorSortState) => void;
  /** Archived vendors have no order or balance figures to sort by. */
  nameOnly?: boolean;
  trigger: React.ReactNode;
}) {
  const options = nameOnly ? SORT_OPTIONS.filter((o) => o.key === "name") : SORT_OPTIONS;
  return (
    <SortRadioSheet
      options={options.map(({ value, label }) => ({ value, label }))}
      value={sort ? `${sort.key}:${sort.direction}` : null}
      onChange={(v) => {
        const o = SORT_OPTIONS.find((s) => s.value === v)!;
        onChange({ key: o.key, direction: o.direction });
      }}
      trigger={trigger}
    />
  );
}
