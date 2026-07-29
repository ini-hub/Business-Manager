/**
 * Quantity display and input helpers.
 *
 * Everything here takes a `maxDp` that DEFAULTS TO 2, so every existing caller
 * behaves exactly as it did. Supplies pass 4: a back-bar recipe can legitimately
 * be a few ten-thousandths of a unit (a bottle covering 300 services is 0.0033
 * each), and rounding that to 2dp is what used to make stock never move.
 *
 * Trailing zeros are always stripped, so widening the column does not turn "5"
 * into "5.0000" anywhere.
 */

/** Stock is stored as numeric(14,4); nothing should ask for more than 4dp. */
export const MAX_QUANTITY_DP = 4;

/** Decimal places to use for an inventory item — supplies need the full 4. */
export function quantityDp(type?: string | null): number {
  return type === "supply" ? MAX_QUANTITY_DP : 2;
}

/**
 * Format a quantity for display. Strips trailing zeros up to `maxDp` places.
 * Optionally appends a unit label.
 *
 * Examples:
 *   formatQuantity(1.5, "kg")        → "1.5 kg"
 *   formatQuantity(2)                → "2"
 *   formatQuantity(0.25, "kg")       → "0.25 kg"
 *   formatQuantity(0.0033, "ea", 4)  → "0.0033 ea"
 *   formatQuantity(5.0000)           → "5"
 */
export function formatQuantity(qty: number | string, unit?: string | null, maxDp = 2): string {
  const n = typeof qty === "string" ? parseFloat(qty) : qty;
  if (isNaN(n)) return "0";
  const dp = Math.min(Math.max(maxDp, 0), MAX_QUANTITY_DP);
  const formatted = parseFloat(n.toFixed(dp)).toString();
  return unit ? `${formatted} ${unit}` : formatted;
}

/**
 * Parse a quantity input string to a number, respecting fractional mode.
 * Rounds to `maxDp` places. For non-fractional items, snaps to nearest integer.
 */
export function parseQuantityInput(val: string, allowFractional: boolean, maxDp = 2): number {
  if (val === "" || val === undefined) return allowFractional ? 0 : 1;
  const parsed = parseFloat(val);
  if (isNaN(parsed)) return allowFractional ? 0 : 1;
  if (allowFractional) {
    const factor = Math.pow(10, Math.min(Math.max(maxDp, 0), MAX_QUANTITY_DP));
    return Math.max(0, Math.round(parsed * factor) / factor);
  }
  return Math.max(1, Math.round(parsed));
}

/** HTML input step attribute for a quantity field. */
export function quantityStep(allowFractional: boolean, maxDp = 2): string {
  if (!allowFractional) return "1";
  return (1 / Math.pow(10, Math.min(Math.max(maxDp, 1), MAX_QUANTITY_DP))).toFixed(
    Math.min(Math.max(maxDp, 1), MAX_QUANTITY_DP),
  );
}

/** Minimum valid quantity for a field. */
export function minQuantity(allowFractional: boolean, maxDp = 2): number {
  if (!allowFractional) return 1;
  return 1 / Math.pow(10, Math.min(Math.max(maxDp, 1), MAX_QUANTITY_DP));
}
