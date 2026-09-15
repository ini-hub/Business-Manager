import { useState } from "react";
import { format, subDays, startOfMonth, endOfMonth, startOfYear, startOfDay, endOfDay } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface DateRange {
  from: Date | undefined;
  to: Date | undefined;
}

interface DateRangeFilterProps {
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
  defaultPreset?: string;
  timezone?: string;
  /** Renders the preset trigger as a small rounded pill (icon + label) instead of a full-width select box. */
  compact?: boolean;
}

const presets = [
  { label: "All Time", value: "all" },
  { label: "Today", value: "today" },
  { label: "Last 7 Days", value: "7days" },
  { label: "Last 30 Days", value: "30days" },
  { label: "This Month", value: "thisMonth" },
  { label: "This Year", value: "thisYear" },
  { label: "Custom", value: "custom" },
];

export function DateRangeFilter({
  dateRange,
  onDateRangeChange,
  defaultPreset = "today",
  timezone,
  compact = false,
}: DateRangeFilterProps) {
  const [selectedPreset, setSelectedPreset] = useState(defaultPreset);

  const handlePresetChange = (value: string) => {
    setSelectedPreset(value);
    // Use store timezone for preset boundaries so all users see the same date ranges
    const rawNow = new Date();
    const today = timezone ? toZonedTime(rawNow, timezone) : rawNow;
    today.setHours(23, 59, 59, 999);

    switch (value) {
      case "all":
        onDateRangeChange({ from: undefined, to: undefined });
        break;
      case "today":
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        onDateRangeChange({ from: startOfToday, to: today });
        break;
      case "7days":
        onDateRangeChange({ from: startOfDay(subDays(today, 6)), to: today });
        break;
      case "30days":
        onDateRangeChange({ from: startOfDay(subDays(today, 29)), to: today });
        break;
      case "thisMonth":
        onDateRangeChange({ from: startOfMonth(today), to: endOfMonth(today) });
        break;
      case "thisYear":
        onDateRangeChange({ from: startOfYear(today), to: today });
        break;
      default:
        break;
    }
  };

  const activePreset = presets.find((p) => p.value === selectedPreset);

  return (
    <div className={cn(compact ? "flex flex-row items-center gap-2" : "flex flex-col sm:flex-row items-stretch sm:items-center gap-2")}>
      <Select value={selectedPreset} onValueChange={handlePresetChange}>
        <SelectTrigger
          className={cn(
            compact
              ? "h-8 w-auto min-w-0 gap-1.5 rounded-full border-input px-3 text-xs [&>svg]:h-3.5 [&>svg]:w-3.5"
              : "h-9 min-w-[120px] flex-1 sm:flex-initial",
          )}
          data-testid="select-date-preset"
        >
          {compact ? (
            <span className="!flex items-center gap-1.5 shrink-0">
              <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
              {activePreset?.label ?? "Select range"}
            </span>
          ) : (
            <SelectValue placeholder="Select range" />
          )}
        </SelectTrigger>
        <SelectContent>
          {presets.map((preset) => (
            <SelectItem key={preset.value} value={preset.value}>
              {preset.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedPreset === "custom" && (
        <>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "h-9 justify-start text-left font-normal min-w-[110px] flex-1 sm:flex-initial",
                  !dateRange.from && "text-muted-foreground"
                )}
                data-testid="button-date-from"
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateRange.from ? format(dateRange.from, "MMM d") : "From"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={dateRange.from}
                onSelect={(date) =>
                  onDateRangeChange({ ...dateRange, from: date ? startOfDay(date) : undefined })
                }
                initialFocus
              />
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "h-9 justify-start text-left font-normal min-w-[110px] flex-1 sm:flex-initial",
                  !dateRange.to && "text-muted-foreground"
                )}
                data-testid="button-date-to"
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateRange.to ? format(dateRange.to, "MMM d") : "To"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={dateRange.to}
                onSelect={(date) =>
                  onDateRangeChange({ ...dateRange, to: date ? endOfDay(date) : undefined })
                }
                disabled={(date) =>
                  dateRange.from ? date < dateRange.from : false
                }
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </>
      )}

      {(dateRange.from || dateRange.to) && selectedPreset !== "all" && (
        <Button
          variant="ghost"
          size="icon"
          className={compact ? "h-8 w-8" : "h-9 w-9"}
          onClick={() => {
            setSelectedPreset("all");
            onDateRangeChange({ from: undefined, to: undefined });
          }}
          data-testid="button-clear-dates"
          title="Clear dates"
        >
          <X className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        </Button>
      )}
    </div>
  );
}
