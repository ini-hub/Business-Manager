/**
 * Analytics Explorer — value formatting.
 *
 * One formatter per ValueFormat so a measure's declared format decides how it is
 * rendered everywhere: axis, tooltip, table cell and export all agree.
 */

import type { ValueFormat } from "@shared/analytics/model";
import { compactNumber, formatCurrency, getCurrencySymbol } from "@/lib/currency-utils";

export interface FormatOptions {
  currencyCode?: string;
  /** Axis ticks and KPI values want compact; tables and tooltips want full precision. */
  compact?: boolean;
}

const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const integerFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function formatValue(
  value: number | string | null | undefined,
  format: ValueFormat,
  options: FormatOptions = {},
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  if (!Number.isFinite(value)) return "—";

  const { currencyCode = "NGN", compact = false } = options;

  switch (format) {
    case "currency":
      return compact
        ? `${getCurrencySymbol(currencyCode)}${compactNumber(value)}`
        : formatCurrency(value, currencyCode);
    case "percent":
      return `${numberFormatter.format(value)}%`;
    case "ratio":
      return value.toFixed(2);
    case "integer":
      return compact ? compactNumber(value) : integerFormatter.format(value);
    case "days":
      return `${numberFormatter.format(value)}d`;
    case "number":
    default:
      return compact ? compactNumber(value) : numberFormatter.format(value);
  }
}

/** Signed delta for a KPI tile. Always shows the sign so direction is unambiguous. */
export function formatDelta(
  current: number | null,
  previous: number | null,
): { text: string; direction: "up" | "down" | "flat" } | null {
  if (current === null || previous === null) return null;
  // A percentage change from zero is undefined, not infinite — say nothing.
  if (previous === 0) return null;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const direction = pct > 0.05 ? "up" : pct < -0.05 ? "down" : "flat";
  const sign = pct > 0 ? "+" : "";
  return { text: `${sign}${pct.toFixed(1)}%`, direction };
}

/**
 * Tone for a delta, from the measure's polarity.
 *
 * Expenses going up is not good news, so direction alone cannot pick the colour.
 */
export function deltaTone(
  direction: "up" | "down" | "flat",
  polarity: "higher_is_better" | "lower_is_better" | "neutral",
): "positive" | "negative" | "neutral" {
  if (direction === "flat" || polarity === "neutral") return "neutral";
  const good = polarity === "higher_is_better" ? "up" : "down";
  return direction === good ? "positive" : "negative";
}

/** Human bucket label for a date key at a given grain. */
export function formatBucket(dateKey: string, grain: string): string {
  const d = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateKey;

  switch (grain) {
    case "year":
      return String(d.getFullYear());
    case "half":
      return `H${d.getMonth() < 6 ? 1 : 2} ${d.getFullYear()}`;
    case "quarter":
      return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
    case "month":
      return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
    case "week":
    case "biweek":
    case "custom":
      // Labelled by the bucket's first day — the axis title carries the width.
      return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    case "day":
    default:
      return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }
}
