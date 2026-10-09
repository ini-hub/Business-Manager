// Pure matching of bank credits to pending transfer legs. A credit confirms a leg only when exactly one
// leg fits, so an ambiguous credit is left for a person rather than confirming the wrong sale.

export type MatchLeg = { id: string; amount: number; createdAt: Date; reference: string | null; senderName: string | null };
export type MatchCredit = { id: string; amount: number; postedAt: Date; narration: string | null };

/** A transfer is normally credited within minutes; the day of slack covers cashiers who log it late. */
export const MATCH_WINDOW_MS = 24 * 60 * 60 * 1000;

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Does the narration mention the leg's reference or the sender's name? Used only to break ties. */
function narrationHints(credit: MatchCredit, leg: MatchLeg): boolean {
  const text = norm(credit.narration);
  if (!text) return false;
  const ref = norm(leg.reference);
  if (ref.length >= 4 && text.includes(ref)) return true;
  // Any name part of 3+ characters appearing in the narration counts ("ADA OBI" vs "TRF FROM OBI A").
  return (leg.senderName ?? "").split(/\s+/).map(norm).some((part) => part.length >= 3 && text.includes(part));
}

export type MatchResult = { creditId: string; legId: string } | { creditId: string; legId: null; reason: "none" | "ambiguous" };

/**
 * Candidates are legs with the same amount (to the kobo) that were recorded no later than the credit
 * plus the window, and no earlier than the window before it. If several fit, narration hints may narrow
 * them to one; otherwise the credit is ambiguous. A leg is never used for two credits in one pass.
 */
export function matchCredits(credits: MatchCredit[], legs: MatchLeg[]): MatchResult[] {
  const taken = new Set<string>();
  const results: MatchResult[] = [];
  for (const credit of [...credits].sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime())) {
    const cents = Math.round(credit.amount * 100);
    const candidates = legs.filter((l) =>
      !taken.has(l.id) &&
      Math.round(l.amount * 100) === cents &&
      Math.abs(credit.postedAt.getTime() - l.createdAt.getTime()) <= MATCH_WINDOW_MS);
    let chosen: MatchLeg | undefined;
    if (candidates.length === 1) chosen = candidates[0];
    else if (candidates.length > 1) {
      const hinted = candidates.filter((l) => narrationHints(credit, l));
      if (hinted.length === 1) chosen = hinted[0];
    }
    if (chosen) {
      taken.add(chosen.id);
      results.push({ creditId: credit.id, legId: chosen.id });
    } else {
      results.push({ creditId: credit.id, legId: null, reason: candidates.length === 0 ? "none" : "ambiguous" });
    }
  }
  return results;
}

export type RefundOut = { id: string; amount: number; createdAt: Date };
export type DebitOut = { id: string; amount: number; postedAt: Date };

/** A refund is normally paid out the same day; two days of slack covers late entry and bank cut-off times. */
export const REFUND_MATCH_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Returns the refunds that no bank debit accounts for. Each debit covers at most one refund, so
 * two identical refunds need two debits. Oldest refunds are paired first, each with its nearest debit.
 */
export function refundsWithoutDebit(refunds: RefundOut[], debits: DebitOut[]): RefundOut[] {
  const used = new Set<string>();
  const missing: RefundOut[] = [];
  for (const r of [...refunds].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const cents = Math.round(r.amount * 100);
    let best: DebitOut | undefined;
    let bestGap = Infinity;
    for (const d of debits) {
      if (used.has(d.id) || Math.round(d.amount * 100) !== cents) continue;
      const gap = Math.abs(d.postedAt.getTime() - r.createdAt.getTime());
      if (gap <= REFUND_MATCH_WINDOW_MS && gap < bestGap) { best = d; bestGap = gap; }
    }
    if (best) used.add(best.id);
    else missing.push(r);
  }
  return missing;
}
