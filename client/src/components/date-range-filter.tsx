import { useState } from "react";
import { format, subDays, startOfMonth, endOfMonth, startOfYear, startOfDay, endOfDay } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
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
}: DateRangeFilterProps) {
  const [selectedPreset, setSelectedPreset] = useState("all");

  const handlePresetChange = (value: string) => {
    setSelectedPreset(value);
    const today = new Date();
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
        onDateRangeChange({ from: subDays(today, 7), to: today });
        break;
      case "30days":
        onDateRangeChange({ from: subDays(today, 30), to: today });
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

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={selectedPreset} onValueChange={handlePresetChange}>
        <SelectTrigger className="w-[140px]" data-testid="select-date-preset">
          <SelectValue placeholder="Select range" />
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
                  "w-[130px] justify-start text-left font-normal",
                  !dateRange.from && "text-muted-foreground"
                )}
                data-testid="button-date-from"
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateRange.from ? format(dateRange.from, "MMM d, yyyy") : "From"}
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

          <span className="text-muted-foreground">to</span>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-[130px] justify-start text-left font-normal",
                  !dateRange.to && "text-muted-foreground"
                )}
                data-testid="button-date-to"
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateRange.to ? format(dateRange.to, "MMM d, yyyy") : "To"}
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
          size="sm"
          onClick={() => {
            setSelectedPreset("all");
            onDateRangeChange({ from: undefined, to: undefined });
          }}
          data-testid="button-clear-dates"
        >
          Clear
        </Button>
      )}
    </div>
  );
}
