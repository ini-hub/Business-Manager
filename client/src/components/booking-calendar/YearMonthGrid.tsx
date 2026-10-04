import { addMonths, format, startOfYear, isSameMonth } from "date-fns";
import { formatCurrencyCompact } from "@/lib/currency-utils";
import { cn } from "@/lib/utils";

interface SummaryBucket {
  bucket: string;
  count: number;
  revenue: number;
}

interface YearMonthGridProps {
  anchorDate: Date;
  buckets: SummaryBucket[];
  currency: string;
  onSelectMonth: (monthDate: Date) => void;
}

export function YearMonthGrid({ anchorDate, buckets, currency, onSelectMonth }: YearMonthGridProps) {
  const bucketByKey = new Map(buckets.map((b) => [b.bucket, b]));
  const yearStart = startOfYear(anchorDate);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(yearStart, i));
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const now = new Date();

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {months.map((monthDate) => {
        const key = format(monthDate, "yyyy-MM");
        const bucket = bucketByKey.get(key);
        const count = bucket?.count ?? 0;
        const revenue = bucket?.revenue ?? 0;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onSelectMonth(monthDate)}
            data-testid={`calendar-month-${key}`}
            className={cn(
              "rounded-2xl border bg-card p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isSameMonth(monthDate, now) ? "border-primary" : "border-border",
            )}
          >
            <p className="text-sm font-semibold">{format(monthDate, "MMMM")}</p>
            <p className="mt-1 text-lg font-bold tabular-nums">{count} <span className="text-xs font-normal text-muted-foreground">booking{count === 1 ? "" : "s"}</span></p>
            <p className="text-xs text-muted-foreground tabular-nums">{formatCurrencyCompact(revenue, currency)}</p>
            <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary" style={{ width: `${(count / max) * 100}%` }} />
            </div>
          </button>
        );
      })}
    </div>
  );
}
