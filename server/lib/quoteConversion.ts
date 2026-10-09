// Guard shared by the two ways a quote ends: becoming a booking, or becoming a sale at checkout.
// Pure so both transactions apply the same rules to the row they just locked.

export type QuoteConversionTarget = "sale" | "booking";

export interface QuoteForConversion {
  storeId: string;
  status: string;
  validUntil: Date | string | null;
}

/** Thrown inside a conversion transaction so callers can answer 409 instead of 500. */
export class QuoteConversionError extends Error {}

/** Returns the reason the quote can't convert, or null when it can. */
export function quoteConversionError(
  quote: QuoteForConversion | undefined,
  storeId: string,
  target: QuoteConversionTarget,
  now: Date = new Date(),
): string | null {
  if (!quote || quote.storeId !== storeId) return "Invalid quote ID provided.";
  if (quote.status === "converted") return `This quote has already been converted to a ${target}.`;
  if (quote.status === "declined") return "A declined quote can't be converted.";
  if (quote.status !== "accepted") return "Only an accepted quote can be converted.";
  if (quote.validUntil && new Date(quote.validUntil).getTime() < now.getTime()) {
    return "This quote has expired. Extend its validity before converting.";
  }
  return null;
}
