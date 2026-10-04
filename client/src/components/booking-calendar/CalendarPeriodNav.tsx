import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/icon-button";
import { cn } from "@/lib/utils";

export type CalendarPeriod = "day" | "week" | "month" | "year";

interface CalendarPeriodNavProps {
  period: CalendarPeriod;
  onPeriodChange: (period: CalendarPeriod) => void;
  label: string;
  filters?: ReactNode;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}

const PERIODS: { value: CalendarPeriod; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];

export function CalendarPeriodNav({ period, onPeriodChange, label, filters, onPrev, onNext, onToday }: CalendarPeriodNavProps) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div role="tablist" aria-label="Calendar view" className="grid grid-cols-4 gap-1 rounded-xl bg-muted p-1 lg:inline-grid">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            role="tab"
            type="button"
            aria-selected={period === p.value}
            onClick={() => onPeriodChange(p.value)}
            data-testid={`calendar-period-${p.value}`}
            className={cn(
              "h-10 rounded-lg px-5 text-sm font-medium transition-colors",
              period === p.value ? "bg-background text-foreground shadow-sm font-semibold" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        {filters}
        {filters && <div className="mx-1 hidden h-6 w-px bg-border lg:block" />}
        <IconButton variant="outline" label="Previous period" onClick={onPrev} className="h-11 w-11 shrink-0 rounded-xl">
          <ChevronLeft className="h-4 w-4" />
        </IconButton>
        <h2 className="min-w-0 flex-1 truncate text-center text-base font-semibold lg:w-44 lg:flex-none">{label}</h2>
        <IconButton variant="outline" label="Next period" onClick={onNext} className="h-11 w-11 shrink-0 rounded-xl">
          <ChevronRight className="h-4 w-4" />
        </IconButton>
        <Button variant="ghost" onClick={onToday} className="h-11 shrink-0 px-3 font-semibold text-primary hover:text-primary" data-testid="calendar-today">
          Today
        </Button>
      </div>
    </div>
  );
}
