import { useState } from "react";
import { Input } from "@/components/ui/input";
import { FilterSheet, FilterSection, ChipOptions, OptionRows, SortSheet as SortRadioSheet } from "@/components/filter-sheet";
import { DateRangeSection } from "@/components/filter-date-range-section";
import {
  type PaymentFilterState,
  type PaymentSortState,
  type PaymentStatus,
  AMOUNT_PRESETS,
  EMPTY_PAYMENT_FILTERS,
  KIND_LABELS,
  PAYMENT_SORT_OPTIONS,
  STATUS_LABELS,
  countActivePaymentFilters,
  cycleLabel,
  paymentAmountRangeLabel,
  paymentDateRangeLabel,
} from "@/lib/payment-history-filters";

const toNumber = (v: string) => (v === "" || Number.isNaN(Number(v)) ? null : Math.max(0, Number(v)));

/** Quick ranges plus a Custom min/max, mirroring the date range section. */
function AmountRangeSection({ min, max, onChange }: { min: number | null; max: number | null; onChange: (min: number | null, max: number | null) => void }) {
  const matched = AMOUNT_PRESETS.find((p) => p.min === min && p.max === max)?.value ?? null;
  const hasValue = min !== null || max !== null;
  const [customOpen, setCustomOpen] = useState(hasValue && !matched);
  const showCustom = customOpen || (hasValue && !matched);
  const selected = showCustom ? "custom" : matched;

  return (
    <FilterSection
      label="Amount"
      summary={paymentAmountRangeLabel(min, max) || null}
      onClear={() => { setCustomOpen(false); onChange(null, null); }}
    >
      <div className="space-y-3">
        <ChipOptions
          options={[...AMOUNT_PRESETS.map(({ value, label }) => ({ value, label })), { value: "custom", label: "Custom" }]}
          value={selected ? [selected] : []}
          onChange={(v) => {
            const next = v[v.length - 1];
            if (!next) { setCustomOpen(false); onChange(null, null); return; }
            if (next === "custom") { setCustomOpen(true); return; }
            setCustomOpen(false);
            const preset = AMOUNT_PRESETS.find((p) => p.value === next)!;
            onChange(preset.min, preset.max);
          }}
        />
        {showCustom && (
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-xs text-muted-foreground">
              Min (₦)
              <Input type="number" inputMode="numeric" min={0} placeholder="0" value={min ?? ""} onChange={(e) => onChange(toNumber(e.target.value), max)} />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Max (₦)
              <Input type="number" inputMode="numeric" min={0} placeholder="No limit" value={max ?? ""} onChange={(e) => onChange(min, toNumber(e.target.value))} />
            </label>
          </div>
        )}
      </div>
    </FilterSection>
  );
}

export function PaymentFiltersSheet({ filters, onApply, resultCountFor, cycles, trigger }: {
  filters: PaymentFilterState;
  onApply: (next: PaymentFilterState) => void;
  resultCountFor: (draft: PaymentFilterState) => number;
  /** Billing cycles present in the loaded payments; the section is hidden when there is only one. */
  cycles: string[];
  trigger: React.ReactNode;
}) {
  return (
    <FilterSheet
      applied={filters}
      empty={EMPTY_PAYMENT_FILTERS}
      onApply={onApply}
      resultCountFor={resultCountFor}
      noun="payment"
      trigger={trigger}
      activeCount={countActivePaymentFilters}
    >
      {({ draft, patch }) => (
        <>
          <DateRangeSection
            from={draft.dateFrom}
            to={draft.dateTo}
            summary={paymentDateRangeLabel(draft.dateFrom, draft.dateTo)}
            onChange={(dateFrom, dateTo) => patch({ dateFrom, dateTo })}
          />

          <FilterSection label="Status" summary={draft.status ? STATUS_LABELS[draft.status] : null} onClear={() => patch({ status: null })}>
            <OptionRows<PaymentStatus>
              options={(Object.keys(STATUS_LABELS) as PaymentStatus[]).map((v) => ({
                value: v, label: STATUS_LABELS[v], count: resultCountFor({ ...draft, status: v }),
              }))}
              value={draft.status}
              onChange={(status) => patch({ status })}
            />
          </FilterSection>

          <FilterSection label="Type" summary={draft.kind ? KIND_LABELS[draft.kind] ?? draft.kind : null} onClear={() => patch({ kind: null })}>
            <OptionRows<string>
              options={Object.keys(KIND_LABELS).map((v) => ({ value: v, label: KIND_LABELS[v], count: resultCountFor({ ...draft, kind: v }) }))}
              value={draft.kind}
              onChange={(kind) => patch({ kind })}
            />
          </FilterSection>

          {cycles.length > 1 && (
            <FilterSection label="Billing cycle" summary={draft.cycle ? cycleLabel(draft.cycle) : null} onClear={() => patch({ cycle: null })}>
              <OptionRows<string>
                options={cycles.map((c) => ({ value: c, label: cycleLabel(c), count: resultCountFor({ ...draft, cycle: c }) }))}
                value={draft.cycle}
                onChange={(cycle) => patch({ cycle })}
              />
            </FilterSection>
          )}

          <AmountRangeSection
            min={draft.amountMin}
            max={draft.amountMax}
            onChange={(amountMin, amountMax) => patch({ amountMin, amountMax })}
          />
        </>
      )}
    </FilterSheet>
  );
}

export function PaymentSortSheet({ sort, onChange, trigger }: {
  sort: PaymentSortState | null;
  onChange: (next: PaymentSortState) => void;
  trigger: React.ReactNode;
}) {
  return <SortRadioSheet options={PAYMENT_SORT_OPTIONS} value={sort?.key ?? null} onChange={(key) => onChange({ key })} trigger={trigger} />;
}
