import {
  ChipOptions, FilterSheet, FilterSection, MoneyRange, OptionRows, SearchableOptions, SortSheet as SortRadioSheet, WindowRows,
} from "@/components/filter-sheet";
import {
  EMPTY_PO_FILTERS,
  PO_SORT_LABELS,
  PO_STATUS_LABELS,
  countActivePoFilters,
  expectedLabel,
  type PoExpectedFilter,
  type PoFilterState,
  type PoSort,
  type PoStatusFilter,
} from "@/lib/po-filters";

const EXPECTED: PoExpectedFilter[] = ["overdue", "today", "week", "none"];
const money = (n: number, s: string) => `${s}${n.toLocaleString()}`;

interface Props {
  filters: PoFilterState;
  vendors: { id: string; name: string }[];
  currencySymbol: string;
  /** How many orders the draft filters would show, so the button can say so before applying. */
  resultCountFor: (draft: PoFilterState) => number;
  onApply: (filters: PoFilterState) => void;
  trigger: React.ReactNode;
}

export function PoFilterSheet({ filters, vendors, currencySymbol, resultCountFor, onApply, trigger }: Props) {
  return (
    <FilterSheet
      applied={filters}
      empty={EMPTY_PO_FILTERS}
      onApply={onApply}
      resultCountFor={resultCountFor}
      noun="order"
      trigger={trigger}
      activeCount={countActivePoFilters}
    >
      {({ draft, patch }) => {
        const range = draft.expectedRange;
        const expectedSummary = range?.from || range?.to
          ? `${range.from ?? "…"} to ${range.to ?? "…"}`
          : draft.expected ? expectedLabel(draft.expected) : null;
        const vendorOptions = vendors.map((v) => ({
          value: v.id,
          label: v.name,
          count: resultCountFor({ ...draft, vendorIds: [v.id] }),
        }));
        const vendorSummary = draft.vendorIds.length === 0 ? null
          : draft.vendorIds.length === 1 ? vendors.find((v) => v.id === draft.vendorIds[0])?.name ?? "1 selected"
          : `${draft.vendorIds.length} selected`;
        const totalSummary = draft.totalMin !== null && draft.totalMax !== null
          ? `${money(draft.totalMin, currencySymbol)} to ${money(draft.totalMax, currencySymbol)}`
          : draft.totalMin !== null ? `${money(draft.totalMin, currencySymbol)} or more`
          : draft.totalMax !== null ? `Up to ${money(draft.totalMax, currencySymbol)}` : null;

        return (
          <>
            <FilterSection
              label="Status"
              defaultOpen
              summary={draft.status ? PO_STATUS_LABELS[draft.status] : null}
              onClear={() => patch({ status: null })}
            >
              <OptionRows<PoStatusFilter>
                options={(Object.keys(PO_STATUS_LABELS) as PoStatusFilter[]).map((v) => ({
                  value: v, label: PO_STATUS_LABELS[v], count: resultCountFor({ ...draft, status: v }),
                }))}
                value={draft.status}
                onChange={(status) => patch({ status })}
              />
            </FilterSection>

            <FilterSection
              label="Expected arrival"
              summary={expectedSummary}
              onClear={() => patch({ expected: null, expectedRange: null })}
            >
              <WindowRows
                options={EXPECTED.map((e) => ({
                  value: e,
                  label: expectedLabel(e),
                  count: resultCountFor({ ...draft, expected: e, expectedRange: null }),
                }))}
                value={draft.expected}
                onChange={(v) => patch({ expected: v })}
                custom={draft.expectedRange}
                onCustomChange={(r) => patch({ expectedRange: r, ...(r ? { expected: null } : {}) })}
              />
            </FilterSection>

            {vendors.length > 0 && (
              <FilterSection label="Vendor" summary={vendorSummary} onClear={() => patch({ vendorIds: [] })}>
                {vendors.length > 6 ? (
                  <SearchableOptions options={vendorOptions} value={draft.vendorIds} onChange={(v) => patch({ vendorIds: v })} placeholder="Search vendors" />
                ) : (
                  <ChipOptions options={vendorOptions} value={draft.vendorIds} onChange={(v) => patch({ vendorIds: v })} />
                )}
              </FilterSection>
            )}

            <FilterSection label="Order total" summary={totalSummary} onClear={() => patch({ totalMin: null, totalMax: null })}>
              <MoneyRange
                label="Order total"
                symbol={currencySymbol}
                min={draft.totalMin}
                max={draft.totalMax}
                onChange={(min, max) => patch({ totalMin: min, totalMax: max })}
              />
            </FilterSection>
          </>
        );
      }}
    </FilterSheet>
  );
}

const SORT_OPTIONS = (Object.keys(PO_SORT_LABELS) as PoSort[]).map((value) => ({ value, label: PO_SORT_LABELS[value] }));

/** Sort lives in its own sheet and applies instantly; it never sits behind "Show N orders". */
export function PoSortSheet({ sort, onChange, trigger }: { sort: PoSort | null; onChange: (s: PoSort | null) => void; trigger: React.ReactNode }) {
  return (
    <SortRadioSheet
      options={SORT_OPTIONS}
      value={sort ?? "newest"}
      onChange={(v) => onChange(v === "newest" ? null : v)}
      trigger={trigger}
    />
  );
}
