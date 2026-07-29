/**
 * Shared parsing for the global search box (`GET /api/search`).
 *
 * Search is deliberately "free": every token is matched as an infix (`%token%`)
 * so a fragment lifted from the middle of a value is a hit — "uej" finds
 * "Ebolujeo", "234" finds "STORE-TXN-0234". Multiple tokens are ANDed by the
 * caller, so word order does not matter: "ade lag" matches "Adeola / Lagos".
 */

/** Longer queries are rare and each token costs another scan, so cap the count. */
const MAX_TOKENS = 6;

/**
 * Escapes the LIKE metacharacters so a user typing `%` or `_` searches for that
 * literal character instead of matching every row.
 */
export function likeEscape(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

/** Splits a raw query into the infix tokens a record must contain to match. */
export function searchTokens(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean).slice(0, MAX_TOKENS);
}

/** Wraps a token as an infix LIKE pattern, metacharacters escaped. */
export function infix(token: string): string {
  return `%${likeEscape(token)}%`;
}

/**
 * Digits-only form of the query for phone matching, or null if the query does
 * not look like a number. Phone numbers are stored without their country code
 * (that lives in `customers.country_code`) and with inconsistent spacing, so a
 * raw ILIKE on a typed "0801 234" finds nothing. Comparing digits to digits
 * does; the caller normalises the stored side in SQL.
 */
export function searchPhoneDigits(query: string): string | null {
  const digits = query.replace(/\D/g, "");
  // Two digits match nearly every phone number — not worth the extra scan.
  if (digits.length < 3) return null;
  const trimmed = digits.replace(/^(?:234)?0*/, "");
  return trimmed.length >= 3 ? trimmed : digits;
}
