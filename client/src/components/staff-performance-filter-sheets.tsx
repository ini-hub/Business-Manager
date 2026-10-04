import {
  FilterSheet, FilterSection, ChipOptions, MoneyRange, OptionRows, SortSheet as SortRadioSheet, SwitchRows,
} from "@/components/filter-sheet";
import { DateRangeSection } from "@/components/filter-date-range-section";
import {
  staffPerformanceDateRangeLabel,
  type StaffPerformanceFilterState,
  type StaffPerformanceSortState,
  type PerformanceTier,
  EMPTY_STAFF_PERFORMANCE_FILTERS,
  PERFORMANCE_LABELS,
  STAFF_PERFORMANCE_SORT_OPTIONS,
  countActiveStaffPerformanceFilters,
  revenueSummary,
} from "@/lib/staff-performance-filters";

export function StaffPerformanceFiltersSheet({ filters, onApply, resultCountFor, currencySymbol, roles, trigger }: {
  filters: StaffPerformanceFilterState;
  onApply: (next: StaffPerformanceFilterState) => void;
  resultCountFor: (draft: StaffPerformanceFilterState) => number;
  currencySymbol: string;
  roles: string[];
  trigger: React.ReactNode;
}) {
  return (
    <FilterSheet
      applied={filters}
      empty={EMPTY_STAFF_PERFORMANCE_FILTERS}
      onApply={onApply}
      resultCountFor={resultCountFor}
      noun="staff member"
      trigger={trigger}
      activeCount={countActiveStaffPerformanceFilters}
    >
      {({ draft, patch }) => {
        const attention = [draft.withAbsences && "Has absences", draft.withLate && "Has late days", draft.noSales && "No sales"].filter(Boolean) as string[];
        return (
          <>
            <DateRangeSection
              from={draft.dateFrom}
              to={draft.dateTo}
              summary={staffPerformanceDateRangeLabel(draft.dateFrom, draft.dateTo)}
              onChange={(dateFrom, dateTo) => patch({ dateFrom, dateTo })}
            />

            <FilterSection
              label="Performance"
              summary={draft.performance ? PERFORMANCE_LABELS[draft.performance] : null}
              onClear={() => patch({ performance: null })}
            >
              <OptionRows<PerformanceTier>
                options={(Object.keys(PERFORMANCE_LABELS) as PerformanceTier[]).map((v) => ({
                  value: v, label: PERFORMANCE_LABELS[v], count: resultCountFor({ ...draft, performance: v }),
                }))}
                value={draft.performance}
                onChange={(performance) => patch({ performance })}
              />
            </FilterSection>

            {roles.length > 0 && (
              <FilterSection label="Role" summary={draft.roles.join(", ")} onClear={() => patch({ roles: [] })}>
                <ChipOptions
                  options={roles.map((r) => ({
                    value: r,
                    label: r.charAt(0).toUpperCase() + r.slice(1),
                    count: resultCountFor({ ...draft, roles: [r] }),
                  }))}
                  value={draft.roles}
                  onChange={(next) => patch({ roles: next })}
                />
              </FilterSection>
            )}

            <FilterSection
              label="Needs attention"
              summary={attention.join(", ")}
              onClear={() => patch({ withAbsences: false, withLate: false, noSales: false })}
            >
              <SwitchRows
                rows={[
                  { label: "Has absences", checked: draft.withAbsences, onChange: (v) => patch({ withAbsences: v }), count: resultCountFor({ ...draft, withAbsences: true }) },
                  { label: "Has late days", checked: draft.withLate, onChange: (v) => patch({ withLate: v }), count: resultCountFor({ ...draft, withLate: true }) },
                  { label: "No sales", checked: draft.noSales, onChange: (v) => patch({ noSales: v }), count: resultCountFor({ ...draft, noSales: true }) },
                ]}
              />
            </FilterSection>

            <FilterSection
              label="Revenue"
              summary={revenueSummary(draft, currencySymbol)}
              onClear={() => patch({ revenueMin: null, revenueMax: null })}
            >
              <MoneyRange
                label="Revenue"
                symbol={currencySymbol}
                min={draft.revenueMin}
                max={draft.revenueMax}
                onChange={(revenueMin, revenueMax) => patch({ revenueMin, revenueMax })}
              />
            </FilterSection>
          </>
        );
      }}
    </FilterSheet>
  );
}

export function StaffPerformanceSortSheet({ sort, onChange, trigger }: {
  sort: StaffPerformanceSortState | null;
  onChange: (next: StaffPerformanceSortState) => void;
  trigger: React.ReactNode;
}) {
  return (
    <SortRadioSheet
      options={STAFF_PERFORMANCE_SORT_OPTIONS.map(({ value, label }) => ({ value, label }))}
      value={sort ? `${sort.key}:${sort.direction}` : null}
      onChange={(v) => {
        const o = STAFF_PERFORMANCE_SORT_OPTIONS.find((s) => s.value === v)!;
        onChange({ key: o.key, direction: o.direction });
      }}
      trigger={trigger}
    />
  );
}
