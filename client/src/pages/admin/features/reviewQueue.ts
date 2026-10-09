import { isPriced } from "./featureRow";

export interface QueueItem {
  id: string;
  name: string;
  tier: string;
  included: boolean;
  monthly: string;
  /** The registry says nothing is gated yet, so the admin has to confirm they checked the gate rules. */
  gatePending: boolean;
  gateChecked: boolean;
}

/** A feature with its own price needs one before it can go live; in-bundle and free ones do not. */
const needsPrice = (tier: string) => isPriced(tier);

/** What still stops this batch from being published, in the order the footer lists it. */
export function missingForPublish(items: QueueItem[]): string[] {
  const out: string[] = [];
  for (const i of items.filter((x) => x.included)) {
    if (needsPrice(i.tier) && (i.monthly.trim() === "" || Number.isNaN(Number(i.monthly)) || Number(i.monthly) < 0)) out.push(`price ${i.name}`);
  }
  for (const i of items.filter((x) => x.included)) {
    if (i.gatePending && !i.gateChecked) out.push(`confirm gating for ${i.name}`);
  }
  return out;
}

/** "To publish, price X, confirm gating for Y." */
export function missingSentence(missing: string[]): string {
  return missing.length ? `To publish, ${missing.join(", ")}.` : "";
}

/** The payload for POST /feature-catalog/publish. */
export function toPublishPayload(items: (QueueItem & { annual: string })[]) {
  return items
    .filter((i) => i.included)
    .map((i) => ({
      id: i.id,
      priceMonthly: needsPrice(i.tier) && i.monthly.trim() !== "" ? Number(i.monthly) : null,
      priceAnnual: needsPrice(i.tier) && i.annual.trim() !== "" ? Number(i.annual) : null,
      gateConfirmed: i.gatePending ? i.gateChecked : true,
    }));
}
