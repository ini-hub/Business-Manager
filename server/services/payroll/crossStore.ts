import { convertAmount, pickRate, MissingRateError, type RateRow } from "@shared/exchange-rates";

/**
 * Cross-store rules for the payroll engine.
 *
 * A person is paid by their HOME store's payroll for work done at every store they are assigned to. The
 * home store's settings drive commission and rates; sales and attendance come from all assigned stores;
 * money in another store's currency is converted at a stored rate, and a missing rate stops the run
 * (never a guess). Kept pure so the money rules can be tested without a database.
 */

/** Which attendance mark wins when a person has records for the same day at several stores. */
const STATUS_PRECEDENCE = ["present", "leave", "holiday", "off_day", "absent"] as const;

function statusRank(status: string): number {
  const i = (STATUS_PRECEDENCE as readonly string[]).indexOf(status);
  return i === -1 ? STATUS_PRECEDENCE.length : i;
}

export type AttendanceLike = { date: string; staffId: string; status: string; storeId: string };

/**
 * One record per person per day. Present at any store is present; otherwise the first of
 * leave > holiday > off day > absent. Equal ranks keep the home store's record, then the first seen,
 * so the answer never depends on query order.
 */
export function mergeAttendance<T extends AttendanceLike>(records: readonly T[], homeStoreId: string): Map<string, T> {
  const best = new Map<string, T>();
  for (const rec of records) {
    const key = `${rec.staffId}|${rec.date}`;
    const cur = best.get(key);
    if (!cur) { best.set(key, rec); continue; }
    const a = statusRank(rec.status);
    const b = statusRank(cur.status);
    if (a < b || (a === b && rec.storeId === homeStoreId && cur.storeId !== homeStoreId)) best.set(key, rec);
  }
  return best;
}

export type ConversionNote = { from: string; to: string; rate: number; effectiveFrom: string };

export type Converter = {
  /** True when any scoped store sells in a currency other than the payroll currency. */
  crossCurrency: boolean;
  /** Amount in `storeId`'s currency -> the payroll currency, using the rate for `onDate`. */
  convert(storeId: string, onDate: string, amount: number): number;
  /** The rates actually applied so far, for the payslip note. */
  used(): ConversionNote[];
};

export function buildConverter(opts: {
  payrollCurrency: string;
  storeCurrency: ReadonlyMap<string, string>;
  rates: readonly RateRow[];
}): Converter {
  const { payrollCurrency, storeCurrency, rates } = opts;
  const used = new Map<string, ConversionNote>();
  let crossCurrency = false;
  for (const c of Array.from(storeCurrency.values())) if (c !== payrollCurrency) crossCurrency = true;

  return {
    crossCurrency,
    convert(storeId, onDate, amount) {
      const from = storeCurrency.get(storeId) ?? payrollCurrency;
      if (from === payrollCurrency) return amount;
      const row = pickRate(rates, from, payrollCurrency, onDate);
      if (!row) throw new MissingRateError(from, payrollCurrency, onDate);
      const key = `${from}>${row.effectiveFrom}`;
      if (!used.has(key)) used.set(key, { from, to: payrollCurrency, rate: row.rate, effectiveFrom: row.effectiveFrom });
      return convertAmount(amount, row.rate);
    },
    used: () => Array.from(used.values()).sort((a, b) => a.from.localeCompare(b.from) || a.effectiveFrom.localeCompare(b.effectiveFrom)),
  };
}

/** The stores whose sales and attendance feed a home store's payroll: itself plus where its people are assigned. */
export function payrollStoreIds(homeStoreId: string, assignedStoreIds: readonly string[]): string[] {
  return Array.from(new Set([homeStoreId, ...assignedStoreIds]));
}

/** "Sales in GHS were converted to NGN at 1 GHS = 110 NGN (rate from 2026-06-01)." */
export function conversionNote(notes: readonly ConversionNote[]): string | null {
  if (notes.length === 0) return null;
  const parts = notes.map((n) => `1 ${n.from} = ${n.rate} ${n.to} (rate from ${n.effectiveFrom})`);
  return `Sales at stores in another currency were converted to ${notes[0].to}: ${parts.join("; ")}.`;
}
