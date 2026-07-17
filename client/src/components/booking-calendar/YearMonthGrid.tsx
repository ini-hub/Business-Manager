import { addMonths, format, startOfYear } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/currency-utils";

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

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {months.map((monthDate) => {
        const key = format(monthDate, "yyyy-MM");
        const bucket = bucketByKey.get(key);
        const count = bucket?.count ?? 0;
        const revenue = bucket?.revenue ?? 0;
        return (
          <div
            key={key}
            onClick={() => onSelectMonth(monthDate)}
            className="rounded-xl border border-border/50 bg-background p-4 cursor-pointer hover:border-primary/50 hover:shadow-sm transition-all"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold">{format(monthDate, "MMMM")}</span>
              {count > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 h-5">{count}</Badge>
              )}
            </div>
            <p className="text-lg font-mono font-bold">{formatCurrency(revenue, currency)}</p>
            <p className="text-xs text-muted-foreground">{count} booking{count !== 1 ? "s" : ""}</p>
          </div>
        );
      })}
    </div>
  );
}
