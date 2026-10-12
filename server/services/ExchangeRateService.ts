import { and, asc, desc, eq, lte } from "drizzle-orm";
import { db } from "../db";
import { exchangeRates, stores, type ExchangeRate } from "@shared/schema";
import {
  MissingRateError, normaliseCurrency, pickRate, roundRate, validateRateInput, type RateRow,
} from "@shared/exchange-rates";

export type SetRateInput = {
  businessId: string;
  from: string;
  to: string;
  rate: number;
  effectiveFrom: string;
  userId?: string;
  source?: "manual" | "feed_accepted";
  note?: string | null;
};

const toRow = (r: ExchangeRate): RateRow => ({
  fromCurrency: r.fromCurrency, toCurrency: r.toCurrency, rate: Number(r.rate), effectiveFrom: r.effectiveFrom,
});

export class ExchangeRateService {
  async list(businessId: string): Promise<ExchangeRate[]> {
    return db.select().from(exchangeRates)
      .where(eq(exchangeRates.businessId, businessId))
      .orderBy(asc(exchangeRates.fromCurrency), asc(exchangeRates.toCurrency), desc(exchangeRates.effectiveFrom));
  }

  /** The currencies this business's stores use: the only ones a rate can be entered for. */
  async businessCurrencies(businessId: string): Promise<string[]> {
    const rows = await db.selectDistinct({ currency: stores.currency }).from(stores).where(eq(stores.businessId, businessId));
    return rows.map((r) => r.currency).filter((c): c is string => !!c).sort();
  }

  /** Creates the rate, or replaces the one already set for the same pair and effective date. */
  async set(input: SetRateInput): Promise<ExchangeRate> {
    const problem = validateRateInput({ from: input.from, to: input.to, rate: input.rate, effectiveFrom: input.effectiveFrom });
    if (problem) throw new Error(problem);
    const from = normaliseCurrency(input.from)!;
    const to = normaliseCurrency(input.to)!;
    const rate = roundRate(input.rate);
    const [row] = await db.insert(exchangeRates).values({
      businessId: input.businessId, fromCurrency: from, toCurrency: to, rate,
      effectiveFrom: input.effectiveFrom, source: input.source ?? "manual", note: input.note ?? null,
      createdByUserId: input.userId ?? null,
    }).onConflictDoUpdate({
      target: [exchangeRates.businessId, exchangeRates.fromCurrency, exchangeRates.toCurrency, exchangeRates.effectiveFrom],
      set: { rate, source: input.source ?? "manual", note: input.note ?? null, createdByUserId: input.userId ?? null, updatedAt: new Date() },
    }).returning();
    return row;
  }

  async remove(businessId: string, id: string): Promise<ExchangeRate | undefined> {
    const [row] = await db.delete(exchangeRates)
      .where(and(eq(exchangeRates.id, id), eq(exchangeRates.businessId, businessId))).returning();
    return row;
  }

  /**
   * The rate for converting `from` into `to` on `onDate`. When `snapshot` is given (an approved or paid
   * period) only those rows are consulted, so later edits cannot change that period.
   */
  async resolve(businessId: string, from: string, to: string, onDate: string, snapshot?: readonly RateRow[] | null): Promise<RateRow | null> {
    if (from === to) return pickRate([], from, to, onDate);
    if (snapshot) return pickRate(snapshot, from, to, onDate);
    const rows = await db.select().from(exchangeRates).where(and(
      eq(exchangeRates.businessId, businessId),
      eq(exchangeRates.fromCurrency, from),
      eq(exchangeRates.toCurrency, to),
      lte(exchangeRates.effectiveFrom, onDate),
    )).orderBy(desc(exchangeRates.effectiveFrom)).limit(1);
    return rows[0] ? toRow(rows[0]) : null;
  }

  /** Like resolve, but a missing rate is an error the caller must surface. */
  async require(businessId: string, from: string, to: string, onDate: string, snapshot?: readonly RateRow[] | null): Promise<RateRow> {
    const found = await this.resolve(businessId, from, to, onDate, snapshot);
    if (!found) throw new MissingRateError(from, to, onDate);
    return found;
  }

  /**
   * Every rate converting into `toCurrency` that could apply to a date up to `asOfDate`. Stored on a
   * payroll period when it is approved: that is what makes the period's conversions immutable.
   * Empty means nothing is stored (the business has no cross-currency rates).
   */
  async snapshotFor(businessId: string, toCurrency: string, asOfDate: string): Promise<RateRow[]> {
    const rows = await db.select().from(exchangeRates).where(and(
      eq(exchangeRates.businessId, businessId),
      eq(exchangeRates.toCurrency, toCurrency),
      lte(exchangeRates.effectiveFrom, asOfDate),
    )).orderBy(asc(exchangeRates.fromCurrency), asc(exchangeRates.effectiveFrom));
    return rows.map(toRow);
  }
}

export const exchangeRateService = new ExchangeRateService();
