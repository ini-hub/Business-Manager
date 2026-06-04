/**
 * Format a quantity for display. Strips trailing zeros up to 2 decimal places.
 * Optionally appends a unit label.
 *
 * Examples:
 *   formatQuantity(1.5, "kg")  → "1.5 kg"
 *   formatQuantity(2)          → "2"
 *   formatQuantity(0.25, "kg") → "0.25 kg"
 */
export function formatQuantity(qty: number | string, unit?: string | null): string {
  const n = typeof qty === "string" ? parseFloat(qty) : qty;
  if (isNaN(n)) return "0";
  const formatted = parseFloat(n.toFixed(2)).toString();
  return unit ? `${formatted} ${unit}` : formatted;
}

/**
 * Parse a quantity input string to a number, respecting fractional mode.
 * Rounds to 2 decimal places. For non-fractional items, snaps to nearest integer.
 */
export function parseQuantityInput(val: string, allowFractional: boolean): number {
  if (val === "" || val === undefined) return allowFractional ? 0 : 1;
  const parsed = parseFloat(val);
  if (isNaN(parsed)) return allowFractional ? 0 : 1;
  if (allowFractional) return Math.max(0, Math.round(parsed * 100) / 100);
  return Math.max(1, Math.round(parsed));
}

/** HTML input step attribute for a quantity field. */
export function quantityStep(allowFractional: boolean): string {
  return allowFractional ? "0.01" : "1";
}

/** Minimum valid quantity for a field. */
export function minQuantity(allowFractional: boolean): number {
  return allowFractional ? 0.01 : 1;
}
