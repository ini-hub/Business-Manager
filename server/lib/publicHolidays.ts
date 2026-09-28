// Small static per-country public holiday table for the "upcoming time off"
// widget on a staff member's Time Off tab. Deliberately not DB-driven or
// admin-configurable - building a generic calendar system is out of scope
// for this feature; this can grow into one later if the need shows up.
// Dates are MM-DD (recur every year); a fuller/regional calendar can be
// swapped in per country without changing the caller's shape.
const HOLIDAYS_BY_COUNTRY: Record<string, Array<{ date: string; name: string }>> = {
  NG: [
    { date: "01-01", name: "New Year's Day" },
    { date: "05-01", name: "Workers' Day" },
    { date: "06-12", name: "Democracy Day" },
    { date: "10-01", name: "Independence Day" },
    { date: "12-25", name: "Christmas Day" },
    { date: "12-26", name: "Boxing Day" },
  ],
  US: [
    { date: "01-01", name: "New Year's Day" },
    { date: "07-04", name: "Independence Day" },
    { date: "11-11", name: "Veterans Day" },
    { date: "12-25", name: "Christmas Day" },
  ],
  GB: [
    { date: "01-01", name: "New Year's Day" },
    { date: "12-25", name: "Christmas Day" },
    { date: "12-26", name: "Boxing Day" },
  ],
};

export interface UpcomingHoliday {
  date: string; // ISO yyyy-mm-dd, this year or next
  name: string;
}

/** Every configured holiday for `countryCode`, projected onto the next occurrence from today. */
export function getPublicHolidays(countryCode: string): UpcomingHoliday[] {
  const holidays = HOLIDAYS_BY_COUNTRY[countryCode.toUpperCase()] ?? HOLIDAYS_BY_COUNTRY.NG;
  const today = new Date();
  const currentYear = today.getFullYear();

  return holidays
    .map(({ date, name }) => {
      const [month, day] = date.split("-").map(Number);
      let occurrence = new Date(currentYear, month - 1, day);
      if (occurrence < today) {
        occurrence = new Date(currentYear + 1, month - 1, day);
      }
      return { date: occurrence.toISOString().slice(0, 10), name };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}
