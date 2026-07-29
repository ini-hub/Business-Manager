/**
 * Maps an Explorer result envelope onto the shapes export-utils already speaks,
 * so analytics exports get the same branded PDF masthead, KPI strip, grouped
 * subtotals and Naira-capable font as every other report in the app.
 */

import type { MeasureDef, ResultColumn, ResultRow } from "@shared/analytics/model";
import type { ReportColumn, ReportKpi, ReportPdfOptions } from "@/lib/export-utils";
import { formatBucket, formatValue } from "@/lib/analytics/format";

export interface ExportContext {
  businessName: string;
  storeName: string;
  periodLabel: string;
  grain: string;
  currencyCode: string;
  /** Renders a dimension member key as its human label (store id -> store name). */
  labelFor?: (columnRef: string, value: string) => string;
}

/** Flat rows with member keys resolved to labels, ready for CSV or PDF. */
export function buildExportRows(
  columns: ResultColumn[],
  rows: ResultRow[],
  context: ExportContext,
): Record<string, string | number | null>[] {
  return rows.map((row) => {
    const out: Record<string, string | number | null> = {};
    for (const column of columns) {
      const value = row[column.ref];
      if (column.kind === "dimension") {
        const raw = value === null || value === undefined ? "" : String(value);
        out[column.ref] =
          column.ref === "date"
            ? formatBucket(raw, context.grain)
            : (context.labelFor?.(column.ref, raw) ?? raw);
      } else {
        // Numbers stay numeric so the PDF can compute subtotals and the CSV
        // opens as a number rather than a formatted string.
        out[column.ref] = typeof value === "number" ? value : null;
      }
    }
    return out;
  });
}

/** CSV column descriptors — `header` is what export-utils writes to the file. */
export function buildExportColumns(
  columns: ResultColumn[],
): { key: string; header: string }[] {
  return columns.map((column) => ({ key: column.ref, header: column.label }));
}

/**
 * The branded PDF descriptor.
 *
 * Groups by the first non-date dimension when there is one, so a per-store or
 * per-category breakdown gets subtotals; a pure time series stays flat.
 */
export function buildPdfReport(
  columns: ResultColumn[],
  rows: Record<string, string | number | null>[],
  measures: MeasureDef[],
  totals: Record<string, number | null>,
  context: ExportContext,
): ReportPdfOptions<Record<string, string | number | null>> {
  const groupDimension = columns.find(
    (c) => c.kind === "dimension" && c.ref !== "date",
  );
  const firstCurrency = columns.find(
    (c) => c.kind === "measure" && c.format === "currency",
  );

  const kpis: ReportKpi[] = measures.slice(0, 4).map((measure) => ({
    label: measure.label,
    value: formatValue(totals[measure.id], measure.format, {
      currencyCode: context.currencyCode,
      compact: true,
    }),
  }));

  // `format` receives the whole row, not the cell value.
  const reportColumns: ReportColumn<Record<string, string | number | null>>[] = columns.map(
    (column) => ({
      key: column.ref,
      header: column.label,
      align: column.kind === "dimension" ? "left" : "right",
      format: (row) =>
        column.kind === "dimension"
          ? String(row[column.ref] ?? "—")
          : formatValue(row[column.ref] as number | null, column.format, {
              currencyCode: context.currencyCode,
            }),
    }),
  );

  return {
    filename: `analytics-${context.periodLabel.replace(/\s+/g, "-").toLowerCase()}`,
    title: "Analytics",
    businessName: context.businessName,
    storeName: context.storeName,
    periodLabel: context.periodLabel,
    kpis,
    columns: reportColumns,
    rows,
    // Landscape once the table is wide enough that portrait would squeeze it.
    orientation: columns.length > 6 ? "landscape" : "portrait",
    // Subtotals only make sense when consecutive rows share a group, which the
    // executor guarantees by sorting on the dimension after the bucket.
    ...(groupDimension
      ? { groupBy: (row: Record<string, string | number | null>) => String(row[groupDimension.ref] ?? "") }
      : {}),
    ...(firstCurrency
      ? {
          amountKey: firstCurrency.ref,
          formatAmount: (value: number) =>
            formatValue(value, "currency", { currencyCode: context.currencyCode }),
        }
      : {}),
    unitLabel: "rows",
  };
}
