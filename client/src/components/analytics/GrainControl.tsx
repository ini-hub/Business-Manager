/**
 * Time grain + comparison period.
 *
 * All eight grains are offered, including the two Postgres `date_trunc` cannot
 * express (bi-weekly and custom-N), which the compiler handles with integer
 * day-division from a stable anchor.
 */

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ComparePeriod, Grain } from "@shared/analytics/model";

const GRAIN_OPTIONS: { value: Grain; label: string }[] = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "biweek", label: "Bi-weekly" },
  { value: "month", label: "Monthly" },
  { value: "quarter", label: "Quarterly (3 months)" },
  { value: "half", label: "Half-yearly (6 months)" },
  { value: "year", label: "Yearly" },
  { value: "custom", label: "Custom…" },
];

const COMPARE_OPTIONS: { value: ComparePeriod; label: string }[] = [
  { value: "none", label: "No comparison" },
  { value: "previous_period", label: "vs previous period" },
  { value: "previous_year", label: "vs same period last year" },
];

interface GrainControlProps {
  grain: Grain;
  customBucketDays?: number;
  compare: ComparePeriod;
  onGrainChange: (grain: Grain, customBucketDays?: number) => void;
  onCompareChange: (compare: ComparePeriod) => void;
}

export function GrainControl({
  grain,
  customBucketDays,
  compare,
  onGrainChange,
  onCompareChange,
}: GrainControlProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={grain}
        onValueChange={(v) =>
          onGrainChange(v as Grain, v === "custom" ? (customBucketDays ?? 10) : undefined)
        }
      >
        <SelectTrigger className="h-8 w-[190px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {GRAIN_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value} className="text-xs">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {grain === "custom" && (
        <div className="flex items-center gap-1.5">
          <Input
            type="number"
            min={1}
            max={365}
            value={customBucketDays ?? 10}
            onChange={(e) => {
              const parsed = Number(e.target.value);
              if (Number.isFinite(parsed)) {
                onGrainChange("custom", Math.min(365, Math.max(1, Math.round(parsed))));
              }
            }}
            className="h-8 w-20 text-xs"
            aria-label="Bucket size in days"
          />
          <span className="text-xs text-muted-foreground">
            day buckets, counted from the range start
          </span>
        </div>
      )}

      <Select value={compare} onValueChange={(v) => onCompareChange(v as ComparePeriod)}>
        <SelectTrigger className="h-8 w-[210px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {COMPARE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value} className="text-xs">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
