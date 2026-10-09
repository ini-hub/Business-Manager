import { getFeatureDef, PENDING_GATE_KEYS } from "@shared/features";

export type FeatureState = "live" | "needs_review" | "inactive";
export type Rollout = "on" | "off" | "scoped";
export type TileKey = "all" | "live" | "needs_review" | "inactive" | "scoped" | "gate_pending";

export const TIER_LABEL: Record<string, string> = {
  free: "Free",
  paid_flat: "Paid",
  paid_metered_limit: "Capped add-on",
  bundle_parent: "Bundle",
  bundle_child: "In bundle",
};

export const TIER_TYPES = ["free", "paid_flat", "paid_metered_limit", "bundle_parent", "bundle_child"] as const;

/** One list row: a catalog row joined to its flag. */
export interface FeatureRow {
  id: string;
  key: string;
  name: string;
  description: string;
  tier: string;
  section: string | null;
  groupParent: string | null;
  sortOrder: number;
  price: number | null;
  currency: string;
  freeLimit: number | null;
  state: FeatureState;
  rollout: Rollout;
  scopedCount: number;
  gatePending: boolean;
  updatedAt: string | null;
  flagId: string | null;
}

/** Features that carry their own price; "in bundle" and free ones do not. */
export const isPriced = (tier: string) => tier !== "free" && tier !== "bundle_child";

function scopedCountOf(raw: unknown): number {
  let v = raw;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { return 0; }
  }
  return Array.isArray(v) ? v.length : 0;
}

/** `by_plan` is legacy and the server treats it as On. */
export function rolloutOf(status: string | undefined): Rollout {
  if (status === "off") return "off";
  if (status === "scoped") return "scoped";
  return "on";
}

export function toFeatureRows(catalog: any[], flags: any[]): FeatureRow[] {
  const flagByName = new Map(flags.map((f) => [f.name as string, f]));
  const keyById = new Map(catalog.map((r) => [r.id as string, r.key as string]));
  return catalog.map((r) => {
    const def = getFeatureDef(r.key);
    const flag = flagByName.get(r.key);
    const pending = r.reviewStatus === "pending_review";
    return {
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description ?? "",
      tier: r.tierType,
      section: r.section ?? def?.section ?? null,
      groupParent: (r.groupParentFeatureId ? keyById.get(r.groupParentFeatureId) : null) ?? def?.groupParent ?? null,
      sortOrder: r.sortOrder ?? def?.sortOrder ?? 9999,
      price: r.priceMonthly != null ? Number(r.priceMonthly) : null,
      currency: r.currency ?? "NGN",
      freeLimit: r.freeLimit ?? null,
      state: pending ? "needs_review" : r.isActive ? "live" : "inactive",
      rollout: rolloutOf(flag?.status),
      scopedCount: flag?.status === "scoped" ? scopedCountOf(flag.scopedOrgIds) : 0,
      gatePending: PENDING_GATE_KEYS.includes(r.key),
      updatedAt: r.updatedAt ?? null,
      flagId: flag?.id ?? null,
    };
  });
}

export function tileCounts(rows: FeatureRow[]): Record<TileKey, number> {
  return {
    all: rows.length,
    live: rows.filter((r) => r.state === "live").length,
    needs_review: rows.filter((r) => r.state === "needs_review").length,
    inactive: rows.filter((r) => r.state === "inactive").length,
    scoped: rows.filter((r) => r.rollout === "scoped").length,
    gate_pending: rows.filter((r) => r.gatePending).length,
  };
}

export function matchesTile(r: FeatureRow, tile: TileKey): boolean {
  switch (tile) {
    case "all": return true;
    case "live": return r.state === "live";
    case "needs_review": return r.state === "needs_review";
    case "inactive": return r.state === "inactive";
    case "scoped": return r.rollout === "scoped";
    case "gate_pending": return r.gatePending;
  }
}

export interface RowFilters {
  q: string;
  tile: TileKey;
  section: string;
  tier: string;
  rollout: string;
}

export function filterRows(rows: FeatureRow[], f: RowFilters): FeatureRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) =>
    matchesTile(r, f.tile) &&
    (f.section === "all" || (r.section ?? "other") === f.section) &&
    (f.tier === "all" || r.tier === f.tier) &&
    (f.rollout === "all" || r.rollout === f.rollout) &&
    (!q || r.key.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)),
  );
}

/** What the Price cell says: a price, "No charge", or why there is none. */
export function priceLabel(r: FeatureRow): string {
  if (r.tier === "bundle_child") return "Priced with its bundle";
  if (r.tier === "free") return "No charge";
  if (r.price == null) return "Not priced yet";
  return `${r.currency === "NGN" ? "₦" : `${r.currency} `}${r.price.toLocaleString()}/mo`;
}
