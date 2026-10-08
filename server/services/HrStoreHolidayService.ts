import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { hrStoreHolidays, type HrStoreHoliday, type CreateHrStoreHolidaysInput } from "@shared/schema";
import { getPublicHolidays } from "../lib/publicHolidays";

export interface UpcomingStoreHoliday {
  id: string;
  name: string;
  date: string; // next occurrence, yyyy-mm-dd
  recursYearly: boolean;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Next date a holiday falls on: its own date, or the next anniversary if it recurs. */
function nextOccurrence(row: HrStoreHoliday, today: string): string | null {
  if (row.holidayDate >= today) return row.holidayDate;
  if (!row.recursYearly) return null;
  const [, mm, dd] = row.holidayDate.split("-");
  const year = Number(today.slice(0, 4));
  const thisYear = `${year}-${mm}-${dd}`;
  return thisYear >= today ? thisYear : `${year + 1}-${mm}-${dd}`;
}

class HrStoreHolidayService {
  async listUpcoming(storeId: string): Promise<UpcomingStoreHoliday[]> {
    const today = todayIso();
    const rows = await db.select().from(hrStoreHolidays).where(eq(hrStoreHolidays.storeId, storeId));
    return rows
      .map((r) => ({ id: r.id, name: r.name, date: nextOccurrence(r, today), recursYearly: r.recursYearly }))
      .filter((r): r is UpcomingStoreHoliday => r.date !== null)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async add(storeId: string, userId: string, input: CreateHrStoreHolidaysInput): Promise<HrStoreHoliday[]> {
    return db.insert(hrStoreHolidays)
      .values(input.holidays.map((h) => ({ storeId, createdByUserId: userId, name: h.name, holidayDate: h.holidayDate, recursYearly: h.recursYearly })))
      .onConflictDoNothing()
      .returning();
  }

  async remove(storeId: string, id: string): Promise<boolean> {
    const deleted = await db.delete(hrStoreHolidays)
      .where(and(eq(hrStoreHolidays.id, id), eq(hrStoreHolidays.storeId, storeId)))
      .returning({ id: hrStoreHolidays.id });
    return deleted.length > 0;
  }

  /** National holidays for the store's country that the store hasn't adopted yet - a starting point, never shown to staff. */
  async suggestions(storeId: string, country: string): Promise<Array<{ name: string; holidayDate: string; recursYearly: true }>> {
    const existing = await db.select().from(hrStoreHolidays).where(eq(hrStoreHolidays.storeId, storeId));
    const taken = new Set(existing.map((r) => `${r.holidayDate.slice(5)}|${r.name.toLowerCase()}`));
    return getPublicHolidays(country)
      .filter((h) => !taken.has(`${h.date.slice(5)}|${h.name.toLowerCase()}`))
      .map((h) => ({ name: h.name, holidayDate: h.date, recursYearly: true as const }));
  }
}

export const hrStoreHolidayService = new HrStoreHolidayService();
