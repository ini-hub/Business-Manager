/**
 * A source of *suggested* exchange rates. A suggestion never changes money by itself: the owner has to
 * accept it, which writes an ordinary owner-entered rate (source "feed_accepted"). That is deliberate, so
 * an outage or a bad feed can never alter payroll.
 *
 * DECISION (2026-10-12): no provider is chosen yet, so the only implementation is NullRateFeed. When one is
 * picked, add a class implementing RateFeedProvider and return it from getRateFeed(); nothing else changes.
 * The provider's key goes in env vars, never in code or the database.
 */
export type RateSuggestion = {
  rate: number;
  /** YYYY-MM-DD the provider quotes the rate for. */
  asOf: string;
  provider: string;
};

export interface RateFeedProvider {
  readonly name: string;
  isConfigured(): boolean;
  /** null when the provider has no quote for the pair/date (or is unreachable); never throws. */
  suggest(from: string, to: string, onDate: string): Promise<RateSuggestion | null>;
}

export class NullRateFeed implements RateFeedProvider {
  readonly name = "none";
  isConfigured() { return false; }
  async suggest(): Promise<RateSuggestion | null> { return null; }
}

const feed: RateFeedProvider = new NullRateFeed();

export function getRateFeed(): RateFeedProvider {
  return feed;
}
