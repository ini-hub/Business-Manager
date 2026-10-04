import { FilterSheet, FilterSection, ChipOptions, OptionRows, SortSheet as SortRadioSheet } from "@/components/filter-sheet";
import {
  type BookingFilterState,
  type BookingSortState,
  type BookingSortKey,
  type BookingStage,
  type BookingDateFilter,
  STAGE_LABELS,
  DATE_LABELS,
  EMPTY_BOOKING_FILTERS,
  countActiveBookingFilters,
} from "@/lib/booking-filters";

export function BookingFiltersSheet({ filters, onApply, resultCountFor, staff, types, trigger }: {
  filters: BookingFilterState;
  onApply: (next: BookingFilterState) => void;
  resultCountFor: (draft: BookingFilterState) => number;
  /** Staff names on bookings; empty when viewing all stores. */
  staff: string[];
  types: string[];
  trigger: React.ReactNode;
}) {
  return (
    <FilterSheet
      applied={filters}
      empty={EMPTY_BOOKING_FILTERS}
      onApply={onApply}
      resultCountFor={resultCountFor}
      noun="booking"
      trigger={trigger}
      activeCount={countActiveBookingFilters}
    >
      {({ draft, patch }) => (
        <>
          <FilterSection
            label="Status"
            defaultOpen
            summary={draft.stage ? STAGE_LABELS[draft.stage] : null}
            onClear={() => patch({ stage: null })}
          >
            <OptionRows<BookingStage>
              options={(Object.keys(STAGE_LABELS) as BookingStage[]).map((v) => ({
                value: v, label: STAGE_LABELS[v], count: resultCountFor({ ...draft, stage: v }),
              }))}
              value={draft.stage}
              onChange={(stage) => patch({ stage })}
            />
          </FilterSection>

          <FilterSection
            label="Date"
            summary={draft.date ? DATE_LABELS[draft.date] : null}
            onClear={() => patch({ date: null })}
          >
            <OptionRows<BookingDateFilter>
              options={(Object.keys(DATE_LABELS) as BookingDateFilter[]).map((v) => ({
                value: v, label: DATE_LABELS[v], count: resultCountFor({ ...draft, date: v }),
              }))}
              value={draft.date}
              onChange={(date) => patch({ date })}
            />
          </FilterSection>

          {staff.length > 0 && (
            <FilterSection label="Staff" summary={draft.staff.join(", ")} onClear={() => patch({ staff: [] })}>
              <ChipOptions
                options={staff.map((s) => ({ value: s, label: s, count: resultCountFor({ ...draft, staff: [s] }) }))}
                value={draft.staff}
                onChange={(staff) => patch({ staff })}
              />
            </FilterSection>
          )}

          {types.length > 1 && (
            <FilterSection label="Service type" summary={draft.types.join(", ")} onClear={() => patch({ types: [] })}>
              <ChipOptions
                options={types.map((t) => ({ value: t, label: t, count: resultCountFor({ ...draft, types: [t] }) }))}
                value={draft.types}
                onChange={(types) => patch({ types })}
              />
            </FilterSection>
          )}
        </>
      )}
    </FilterSheet>
  );
}

const SORT_OPTIONS: { value: BookingSortKey; label: string }[] = [
  { value: "soonest", label: "Soonest" },
  { value: "latest", label: "Latest first" },
  { value: "customer", label: "Customer" },
];

export function BookingSortSheet({ sort, onChange, trigger }: {
  sort: BookingSortState | null;
  onChange: (next: BookingSortState) => void;
  trigger: React.ReactNode;
}) {
  return <SortRadioSheet options={SORT_OPTIONS} value={sort?.key ?? null} onChange={(key) => onChange({ key })} trigger={trigger} />;
}
