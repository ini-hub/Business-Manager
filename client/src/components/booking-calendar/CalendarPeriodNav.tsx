import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type CalendarPeriod = "day" | "month" | "year";

interface CalendarPeriodNavProps {
  period: CalendarPeriod;
  onPeriodChange: (period: CalendarPeriod) => void;
  label: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}

export function CalendarPeriodNav({ period, onPeriodChange, label, onPrev, onNext, onToday }: CalendarPeriodNavProps) {
  const resetLabel = period === "day" ? "Today" : period === "month" ? "This Month" : "This Year";

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">{label}</h2>
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={onToday}>{resetLabel}</Button>
        <div className="flex items-center rounded-md border [border-color:var(--button-outline)] overflow-hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={onPrev}
            className="h-8 w-8 rounded-none border-0 border-r [border-color:var(--button-outline)]"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onNext} className="h-8 w-8 rounded-none border-0">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Tabs value={period} onValueChange={(v) => onPeriodChange(v as CalendarPeriod)}>
          <TabsList className="grid grid-cols-3 w-full sm:w-auto">
            <TabsTrigger value="day">Day</TabsTrigger>
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="year">Year</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}
