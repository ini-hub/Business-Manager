import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterSheet, FilterSection, ChipOptions, SwitchRows } from "@/components/filter-sheet";
import { cn } from "@/lib/utils";
import {
  type CalendarBooking,
  type CalendarFilterState,
  EMPTY_CALENDAR_FILTERS,
  calendarMatchesFilters,
  countActiveCalendarFilters,
} from "./calendar-utils";

const STAGES = [
  { value: "upcoming", label: "Upcoming" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

export function BookingCalendarFilters({ filters, onApply, bookings, staff }: {
  filters: CalendarFilterState;
  onApply: (next: CalendarFilterState) => void;
  bookings: CalendarBooking[];
  staff: { id: string; name: string }[];
}) {
  const count = countActiveCalendarFilters(filters);
  const resultCountFor = (draft: CalendarFilterState) => bookings.filter((b) => calendarMatchesFilters(b, draft)).length;
  return (
    <FilterSheet
      applied={filters}
      empty={EMPTY_CALENDAR_FILTERS}
      onApply={onApply}
      resultCountFor={resultCountFor}
      noun="booking"
      activeCount={countActiveCalendarFilters}
      trigger={
        <Button
          variant="outline"
          data-testid="calendar-filters"
          className={cn("h-11 gap-2 rounded-xl px-4 font-semibold", count > 0 && "border-primary bg-primary/10 text-primary hover:bg-primary/15")}
        >
          <SlidersHorizontal className="h-4 w-4" />
          {count > 0 ? `Filters · ${count}` : "Filters"}
        </Button>
      }
    >
      {({ draft, patch }) => (
        <>
          <FilterSection label="Status" defaultOpen summary={draft.stages.join(", ")} onClear={() => patch({ stages: [] })}>
            <ChipOptions
              options={STAGES.map((s) => ({ ...s, count: resultCountFor({ ...draft, stages: [s.value as CalendarFilterState["stages"][number]] }) }))}
              value={draft.stages}
              onChange={(stages) => patch({ stages: stages as CalendarFilterState["stages"] })}
            />
          </FilterSection>
          {staff.length > 0 && (
            <FilterSection
              label="Staff"
              summary={draft.staff.map((id) => staff.find((s) => s.id === id)?.name).filter(Boolean).join(", ")}
              onClear={() => patch({ staff: [] })}
            >
              <ChipOptions
                options={staff.map((s) => ({ value: s.id, label: s.name, count: resultCountFor({ ...draft, staff: [s.id] }) }))}
                value={draft.staff}
                onChange={(next) => patch({ staff: next })}
              />
            </FilterSection>
          )}
          <FilterSection label="Start time" summary={draft.noTimeOnly ? "Without a start time" : null} onClear={() => patch({ noTimeOnly: false })}>
            <SwitchRows
              rows={[{ label: "Without a start time", checked: draft.noTimeOnly, onChange: (v) => patch({ noTimeOnly: v }), count: resultCountFor({ ...draft, noTimeOnly: true }) }]}
            />
          </FilterSection>
        </>
      )}
    </FilterSheet>
  );
}
