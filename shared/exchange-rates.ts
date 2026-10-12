// Currency conversion rules shared by the server (payroll) and the client (the owner's rate screen).
// Money is never added across currencies without a stored rate: a missing rate is an error, not a guess.

export type RateRow = {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  /** YYYY-MM-DD */
  effectiveFrom: string;
};

export const MAX_RATE = 10_000_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "ngn" -> "NGN"; anything that is not a three-letter code -> null. */
export function normaliseCurrency(code: unknown): string | null {
  if (typeof code !== "string") return null;
  const upper = code.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(upper) ? upper : null;
}

/** Rates are stored to 8 decimal places. */
export function roundRate(rate: number): number {
  return Math.round(rate * 1e8) / 1e8;
}

/** An error message, or null when the input is a usable rate. */
export function validateRateInput(input: { from: unknown; to: unknown; rate: unknown; effectiveFrom: unknown }): string | null {
  const from = normaliseCurrency(input.from);
  const to = normaliseCurrency(input.to);
  if (!from || !to) return "Choose two currencies.";
  if (from === to) return "A rate needs two different currencies.";
  if (typeof input.rate !== "number" || !Number.isFinite(input.rate) || input.rate <= 0) return "The rate must be a number greater than zero.";
  if (roundRate(input.rate) <= 0) return "That rate is too small to store.";
  if (input.rate > MAX_RATE) return "That rate is too large.";
  if (typeof input.effectiveFrom !== "string" || !ISO_DATE.test(input.effectiveFrom)) return "Choose the date the rate applies from.";
  const d = new Date(`${input.effectiveFrom}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== input.effectiveFrom) return "That date is not valid.";
  return null;
}

/**
 * The rate to use for converting `from` into `to` on `onDate` (YYYY-MM-DD): the latest row whose
 * effectiveFrom is on or before that date. The same currency converts at 1. No row means null: the
 * caller must stop, not guess.
 */
export function pickRate(rows: readonly RateRow[], from: string, to: string, onDate: string): RateRow | null {
  if (from === to) return { fromCurrency: from, toCurrency: to, rate: 1, effectiveFrom: onDate };
  let best: RateRow | null = null;
  for (const r of rows) {
    if (r.fromCurrency !== from || r.toCurrency !== to) continue;
    if (r.effectiveFrom > onDate) continue;
    if (!best || r.effectiveFrom > best.effectiveFrom) best = r;
  }
  return best;
}

/** Converts an amount, rounding half away from zero to 2 decimal places. */
export function convertAmount(amount: number, rate: number): number {
  const raw = amount * rate;
  const cents = Math.round(Math.abs(raw) * 100 + 1e-9);
  return (raw < 0 ? -cents : cents) / 100;
}

/** Raised when a conversion is needed and no rate has been entered for that pair and date. */
export class MissingRateError extends Error {
  constructor(public readonly from: string, public readonly to: string, public readonly onDate: string) {
    super(
      `No exchange rate from ${from} to ${to} is set on or before ${onDate}. ` +
      `Ask the business owner to add one under Settings > Business > Exchange rates.`,
    );
    this.name = "MissingRateError";
  }
}
