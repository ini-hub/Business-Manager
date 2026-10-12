import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { staffStoreAssignments, stores } from "@shared/schema";
import type { RateRow } from "@shared/exchange-rates";
import { exchangeRateService } from "../ExchangeRateService";
import { buildConverter, payrollStoreIds, type Converter } from "./crossStore";

/**
 * Which stores feed a home store's payroll: the home store plus every store its people are actively
 * assigned to. Shared by the payroll calculation and the late-arrival sync so they cannot disagree.
 */
export async function loadScopeStoreIds(homeStoreId: string, homedStaffIds: string[]): Promise<string[]> {
  if (homedStaffIds.length === 0) return [homeStoreId];
  const assigned = await db
    .select({ storeId: staffStoreAssignments.storeId })
    .from(staffStoreAssignments)
    .where(and(inArray(staffStoreAssignments.staffId, homedStaffIds), eq(staffStoreAssignments.isArchived, false)));
  return payrollStoreIds(homeStoreId, assigned.map((a) => a.storeId));
}

/**
 * The stores whose sales and attendance feed this period's payroll, and the converter for their
 * currencies. A person is paid by their HOME store for work at every store they are assigned to, with
 * the home store's settings. A period that has been approved reads the exchange rates frozen onto it,
 * so editing a rate later cannot change it.
 */
export async function loadCrossStoreScope(
  period: { storeId: string; endDate: string; status: string; ratesSnapshot: unknown },
  homeStore: { id: string; businessId: string; currency: string },
  homedStaffIds: string[],
): Promise<{ storeIds: string[]; converter: Converter }> {
  const storeIds = await loadScopeStoreIds(period.storeId, homedStaffIds);

  const storeCurrency = new Map<string, string>([[period.storeId, homeStore.currency]]);
  if (storeIds.length > 1) {
    const rows = await db.select({ id: stores.id, currency: stores.currency }).from(stores).where(inArray(stores.id, storeIds));
    for (const r of rows) storeCurrency.set(r.id, r.currency);
  }

  const crossCurrency = Array.from(storeCurrency.values()).some((c) => c !== homeStore.currency);
  let rates: RateRow[] = [];
  if (crossCurrency) {
    const frozen = period.status !== "pending" && Array.isArray(period.ratesSnapshot)
      ? (period.ratesSnapshot as RateRow[])
      : null;
    rates = frozen ?? await exchangeRateService.snapshotFor(homeStore.businessId, homeStore.currency, period.endDate);
  }
  return { storeIds, converter: buildConverter({ payrollCurrency: homeStore.currency, storeCurrency, rates }) };
}
