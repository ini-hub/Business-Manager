export interface StoreRef {
  id: string;
  isMain: boolean;
}

export type StoreChoicePlan = { ok: true; archiveIds: string[]; newMainId: string | null } | { ok: false; error: string };

/**
 * When a trial ends with more active stores than the plan covers, the owner picks which to keep. This validates
 * the pick and works out what changes: the stores to archive (nothing is deleted) and, if the main store isn't
 * kept, which kept store becomes main.
 */
export function planStoreChoice(active: readonly StoreRef[], keepIds: readonly string[], limit: number): StoreChoicePlan {
  const keep = Array.from(new Set(keepIds));
  const activeIds = new Set(active.map((s) => s.id));
  if (active.length <= limit) return { ok: false, error: "All your active stores are already covered by your plan." };
  if (keep.length === 0) return { ok: false, error: "Keep at least one store." };
  if (keep.some((id) => !activeIds.has(id))) return { ok: false, error: "You can only keep stores that are currently active." };
  if (keep.length > limit) return { ok: false, error: `Your plan covers ${limit} store${limit === 1 ? "" : "s"}, so you can keep up to ${limit}.` };

  const main = active.find((s) => s.isMain);
  return {
    ok: true,
    archiveIds: active.filter((s) => !keep.includes(s.id)).map((s) => s.id),
    // A main store that isn't kept hands over to the first one that is.
    newMainId: main && keep.includes(main.id) ? null : keep[0],
  };
}
