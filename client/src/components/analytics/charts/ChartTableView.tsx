/**
 * The table twin every chart ships with.
 *
 * Two jobs: it is the accessibility relief channel (four light-mode palette slots
 * sit under 3:1 contrast against the card surface, which is only acceptable
 * because the numbers are also readable as text), and it is the source array for
 * CSV export, so it costs nothing extra.
 */

import { useStore } from "@/lib/store-context";
import type { ResultColumn, ResultRow } from "@shared/analytics/model";
import { formatBucket, formatValue } from "@/lib/analytics/format";
import { cn } from "@/lib/utils";

interface ChartTableViewProps {
  columns: ResultColumn[];
  rows: ResultRow[];
  totals?: Record<string, number | null>;
  grain?: string;
  /** Renders a dimension member key as its human label. */
  labelFor?: (columnRef: string, value: string) => string;
  className?: string;
}

export function ChartTableView({
  columns,
  rows,
  totals,
  grain = "day",
  labelFor,
  className,
}: ChartTableViewProps) {
  const { currentStore } = useStore();
  const currencyCode = currentStore?.currency ?? "NGN";

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No data for this selection.
      </p>
    );
  }

  const renderCell = (column: ResultColumn, row: ResultRow) => {
    const value = row[column.ref];
    if (column.kind === "dimension") {
      const raw = value === null || value === undefined ? "—" : String(value);
      if (column.ref === "date") return formatBucket(raw, grain);
      return labelFor ? labelFor(column.ref, raw) : raw;
    }
    return formatValue(value as number | null, column.format, { currencyCode });
  };

  return (
    // Wide results scroll inside their own container so the page body never does.
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b">
            {columns.map((column) => (
              <th
                key={column.ref}
                scope="col"
                className={cn(
                  "py-2 px-3 font-medium text-muted-foreground whitespace-nowrap",
                  column.kind === "dimension" ? "text-left" : "text-right",
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border/50 last:border-0">
              {columns.map((column) => (
                <td
                  key={column.ref}
                  className={cn(
                    "py-2 px-3 whitespace-nowrap",
                    column.kind === "dimension"
                      ? "text-left"
                      : "text-right tabular-nums",
                  )}
                >
                  {renderCell(column, row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr className="border-t-2 font-semibold">
              {columns.map((column, i) => (
                <td
                  key={column.ref}
                  className={cn(
                    "py-2 px-3 whitespace-nowrap",
                    column.kind === "dimension"
                      ? "text-left"
                      : "text-right tabular-nums",
                  )}
                >
                  {column.kind === "dimension"
                    ? i === 0
                      ? "Total"
                      : ""
                    : formatValue(totals[column.ref], column.format, { currencyCode })}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
