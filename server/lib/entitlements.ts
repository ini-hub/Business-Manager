import type { RequestHandler } from "express";
import { sql, eq, and, or, lte, inArray } from "drizzle-orm";
import { db } from "../db";
import { createTtlCache } from "./ttlCache";
import {
  inventory,
  featureCatalog,
  featureDependencies,
  orgFeatureEntitlements,
  featureFlags,
  staff,
  customers,
  stores,
  organisations,
  type FeatureCatalog,
} from "@shared/schema";
import { getOrgLifecycle } from "./trial";
import { getConfiguredGraceDays } from "./platformConfig";
import { FREE_FEATURE_KEYS, getFeatureDef, resolveCountLimit, tiersNotAbove, type LimitTier } from "@shared/features";

/**
 * Pay-per-feature entitlement resolution. Deliberately request-scoped, no
 * cross-request cache: purchases and removals must take effect immediately,
 * and orgs change entitlements rarely enough that a fresh query per gated
 * request is cheap (see SAC-1 in the requirements plan).
 */

type DbOrTx = typeof db;

// The catalog and the flag rows are platform-wide and change only when an admin edits them (or the boot
// sync runs), yet they were re-read on nearly every API request. A short TTL keeps that to a handful of
// reads per window; the admin writers call invalidateFeatureCatalogCache() so their own edits show at once
// (another instance sees them within the TTL). Per-org rows (purchases, lifecycle) are NOT cached: a
// purchase or removal must take effect on the very next request.
const FEATURE_CACHE_TTL_MS = 15_000;
const catalogCache = createTtlCache<"all", FeatureCatalog[]>(FEATURE_CACHE_TTL_MS);
type FlagRow = { key: string; status: string; scopedOrgIds: unknown };
const flagRowsCache = createTtlCache<"all", FlagRow[]>(FEATURE_CACHE_TTL_MS);

/** Call after any write to feature_catalog or feature_flags. */
export function invalidateFeatureCatalogCache(): void {
  catalogCache.invalidate();
  flagRowsCache.invalidate();
}

/** Every catalog row, active or not. Shared (do not mutate). */
function loadAllCatalog(): Promise<FeatureCatalog[]> {
  return catalogCache.get("all", () => db.select().from(featureCatalog));
}

async function loadCatalog(): Promise<FeatureCatalog[]> {
  return (await loadAllCatalog()).filter((f) => f.isActive);
}

/**
 * Guards the trial blanket grant, which is built from this table: an empty
 * catalog means every trialing org is granted nothing and every gated action
 * 402s. That has happened before (migration 0057) because a recorded
 * migration does not prove its seed rows landed, so check the data itself.
 */
export async function checkCatalogHealth(): Promise<{ ok: boolean; activeFeatures: number }> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(featureCatalog)
    .where(eq(featureCatalog.isActive, true));
  const activeFeatures = row?.n ?? 0;
  return { ok: activeFeatures > 0, activeFeatures };
}

/** Logs loudly at boot if the catalog is empty; never throws, so a bad seed can't take the whole app down. */
export async function assertCatalogSeeded(): Promise<void> {
  try {
    const { ok } = await checkCatalogHealth();
    if (!ok) {
      console.error(
        "[entitlements] CRITICAL: feature_catalog has no active rows. Trialing orgs will get no features " +
          "and gated actions will return 402. Run `npm run features:sync` against this database to seed it from shared/features.ts."
      );
    }
  } catch (error) {
    console.error("[entitlements] assertCatalogSeeded failed:", error);
  }
}

/**
 * Lazily flips any org's expired 'pending_removal' entitlements to 'removed'
 * (owner-cancelled past currentPeriodEnd, or a sunset-notice deadline that
 * has passed - see §2.7 of the requirements plan). Same "check on request,
 * no cron" philosophy as maybeProcessDueRenewal in server/lib/billing.ts.
 * Fire-and-forget from getOrgEntitlements: the read below already treats an
 * expired pending_removal row as inactive, so this write never blocks it.
 */
function sweepExpiredEntitlements(organisationId: string): void {
  db.update(orgFeatureEntitlements)
    .set({ status: "removed", updatedAt: new Date() })
    .where(
      and(
        eq(orgFeatureEntitlements.organisationId, organisationId),
        eq(orgFeatureEntitlements.status, "pending_removal"),
        lte(orgFeatureEntitlements.removalEffectiveAt, new Date())
      )
    )
    .catch((error) => console.error(`sweepExpiredEntitlements failed for org ${organisationId}:`, error));
}

/**
 * Feature keys switched off by their flag for this org: status 'off' (platform
 * kill-switch) or 'scoped' with the org outside scopedOrgIds. Off means HIDDEN
 * (client) and unusable (server), distinct from "on but unpaid".
 */
async function loadDisabledFlagKeys(_conn: DbOrTx, organisationId?: string): Promise<Set<string>> {
  const rows = await flagRowsCache.get("all", () =>
    db
      .select({ key: featureCatalog.key, status: featureFlags.status, scopedOrgIds: featureFlags.scopedOrgIds })
      .from(featureCatalog)
      .innerJoin(featureFlags, eq(featureFlags.id, featureCatalog.flagId))
      .where(or(eq(featureFlags.status, "off"), eq(featureFlags.status, "scoped"))),
  );
  return new Set(
    rows
      .filter((r) => {
        if (r.status === "off") return true;
        const ids = Array.isArray(r.scopedOrgIds) ? (r.scopedOrgIds as unknown[]) : [];
        return !organisationId || !ids.includes(organisationId);
      })
      .map((r) => r.key)
  );
}

/**
 * Request-time module integration: a feature is only usable while every
 * feature it dependsOn (shared/features.ts) is also granted, so e.g. the credit
 * reminders follow Credit Sale. Purchase-time validation still exists too.
 */
function applyDependencies(granted: Set<string>): Set<string> {
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of Array.from(granted)) {
      const deps = getFeatureDef(key)?.dependsOn ?? [];
      if (deps.some((d) => !granted.has(d))) {
        granted.delete(key);
        changed = true;
      }
    }
  }
  return granted;
}

/**
 * True only while the org is inside its (admin-configurable) trial window -
 * mirrors client/src/lib/trial.ts's isOrgTrialing. The trial is supposed to
 * mean "everything free for N days" (requirements plan §1), not merely
 * "not locked out" - getOrgEntitlements/checkCountLimit/getCountLimitStatus
 * all short-circuit on this rather than resolving purchases as normal.
 */
async function loadLifecycle(conn: Pick<typeof db, "select">, organisationId: string) {
  const [org] = await conn
    .select({ status: organisations.status, trialEndsAt: organisations.trialEndsAt, graceEndsAt: organisations.graceEndsAt })
    .from(organisations)
    .where(eq(organisations.id, organisationId))
    .limit(1);
  if (!org) return null;
  return { org, ...getOrgLifecycle(org, await getConfiguredGraceDays()) };
}

/**
 * Full access means the blanket grant: inside the trial, or in the grace window
 * right after it. (A failed renewal's grace keeps what the org already paid for
 * but does not blanket-grant everything, see below.)
 */
type Lifecycle = Awaited<ReturnType<typeof loadLifecycle>>;

function trialingFrom(life: Lifecycle): boolean {
  if (!life) return false;
  if (life.state === "trialing") return true;
  return life.state === "grace" && life.org.status === "trialing" && !life.org.graceEndsAt;
}

/** True once a failed renewal's grace has run out: purchased add-ons stop counting until the org pays again. */
function softLockedFrom(life: Lifecycle): boolean {
  return life?.state === "soft_locked" && !!life.org.graceEndsAt;
}

async function isOrgCurrentlyTrialing(organisationId: string): Promise<boolean> {
  return trialingFrom(await loadLifecycle(db, organisationId));
}

async function isRenewalSoftLocked(organisationId: string): Promise<boolean> {
  return softLockedFrom(await loadLifecycle(db, organisationId));
}

async function loadActiveEntitlementRows(organisationId: string) {
  return db
    .select({ featureId: orgFeatureEntitlements.featureId, status: orgFeatureEntitlements.status, removalEffectiveAt: orgFeatureEntitlements.removalEffectiveAt })
    .from(orgFeatureEntitlements)
    .where(and(eq(orgFeatureEntitlements.organisationId, organisationId), or(eq(orgFeatureEntitlements.status, "active"), eq(orgFeatureEntitlements.status, "pending_removal"))));
}

/**
 * The "granted" set built purely from what's actually been bought (plus
 * always-free features) - never inflated by the trial blanket grant. This is
 * what a real "Remove" action operates on, and what the client needs to tell
 * an actually-purchased add-on apart from one that only looks active because
 * the org is still trialing (see purchasedFeatures on GET /api/entitlements).
 */
export function computePurchasedGrant(
  catalog: FeatureCatalog[],
  activeRows: { featureId: string; status: string; removalEffectiveAt: Date | null }[],
  disabledFlags: Set<string>
): Set<string> {
  const now = new Date();

  // A row still usable right now: 'active', or 'pending_removal' whose
  // deadline hasn't passed yet (still inside the grace/paid period).
  const purchasedFeatureIds = new Set(
    activeRows
      .filter((r) => r.status === "active" || !r.removalEffectiveAt || r.removalEffectiveAt > now)
      .map((r) => r.featureId)
  );

  // Free features come from the code registry as well as the catalog, so an
  // empty or half-seeded catalog can never take away what is free by definition.
  const granted = new Set<string>(FREE_FEATURE_KEYS);
  for (const feature of catalog) {
    if (feature.tierType === "free") granted.add(feature.key);
  }
  for (const feature of catalog) {
    if (purchasedFeatureIds.has(feature.id)) {
      granted.add(feature.key);
      // A bundle parent, or a capped add-on that carries children (Additional Store), grants its children.
      if (feature.tierType === "bundle_parent" || feature.tierType === "paid_metered_limit") {
        for (const child of catalog) {
          if (child.parentFeatureId === feature.id) granted.add(child.key);
        }
      }
      // Packs of one limit (up to 3 stores, up to 10, unlimited) all carry what any of them carries: children hang off
      // one tier in the catalog, and holding any tier of that limit grants them.
      if (feature.tierType === "paid_metered_limit" && feature.limitType) {
        const siblingIds = new Set(catalog.filter((t) => t.tierType === "paid_metered_limit" && t.limitType === feature.limitType).map((t) => t.id));
        for (const child of catalog) {
          if (child.parentFeatureId && siblingIds.has(child.parentFeatureId)) granted.add(child.key);
        }
      }
    }
  }

  // Emergency kill-switch beats monetization, never the reverse (§2.5).
  for (const key of Array.from(disabledFlags)) granted.delete(key);

  return applyDependencies(granted);
}

export async function getOrgEntitlements(organisationId: string): Promise<Set<string>> {
  sweepExpiredEntitlements(organisationId);

  const [catalog, disabledFlags, loadedRows, life] = await Promise.all([
    loadCatalog(),
    loadDisabledFlagKeys(db, organisationId),
    loadActiveEntitlementRows(organisationId),
    loadLifecycle(db, organisationId), // once: trialing and soft-locked are both read off the same row
  ]);
  const trialing = trialingFrom(life);
  const renewalLocked = softLockedFrom(life);

  // Blanket grant while trialing: every active catalog feature, full stop -
  // no need to reason about bundles/dependencies/purchases, this isn't a
  // purchase. The kill-switch below still applies even during a trial.
  if (trialing) {
    const granted = new Set([...FREE_FEATURE_KEYS, ...catalog.map((f) => f.key)]);
    for (const key of Array.from(disabledFlags)) granted.delete(key);
    return applyDependencies(granted);
  }

  // Soft lock after a failed renewal: nothing is deleted, but until the org pays again it has the free tier.
  const activeRows = renewalLocked ? [] : loadedRows;
  return computePurchasedGrant(catalog, activeRows, disabledFlags);
}

/**
 * Same feature keys as getOrgEntitlements, but never inflated by the trial
 * blanket grant - the set an org has actually bought (or gets for free).
 * Feeds GET /api/entitlements' purchasedFeatures so the billing UI can tell
 * "active because you're trialing" apart from "active because you paid",
 * and only offer Remove / hide the buy checkbox for the latter.
 */
export async function getOrgPurchasedFeatures(organisationId: string): Promise<Set<string>> {
  const [catalog, disabledFlags, activeRows] = await Promise.all([
    loadCatalog(),
    loadDisabledFlagKeys(db, organisationId),
    loadActiveEntitlementRows(organisationId),
  ]);
  return computePurchasedGrant(catalog, activeRows, disabledFlags);
}

export async function hasFeature(organisationId: string, featureKey: string): Promise<boolean> {
  const granted = await getOrgEntitlements(organisationId);
  return granted.has(featureKey);
}

/**
 * Entitlements resolved at most once per request. The central policy
 * middleware (featurePolicy.ts) and any per-route requireFeature share it via
 * res.locals, so gating adds no extra queries. Request-scoped on purpose: a
 * purchase or removal still takes effect on the very next request.
 */
export function getRequestEntitlements(res: { locals: Record<string, any> }, organisationId: string): Promise<Set<string>> {
  if (!res.locals.__orgEntitlements) res.locals.__orgEntitlements = getOrgEntitlements(organisationId);
  return res.locals.__orgEntitlements;
}

export type FeaturePrice = { name: string; monthly: number | null; annual: number | null; currency: string; viaFeatureKey?: string };

function priceOf(row: FeatureCatalog): { monthly: number | null; annual: number | null } {
  const m = row.priceMonthly == null ? null : Number(row.priceMonthly);
  const a = row.priceAnnual == null ? null : Number(row.priceAnnual);
  return { monthly: Number.isFinite(m as number) ? m : null, annual: Number.isFinite(a as number) ? a : null };
}

/** "₦2,000/month" (or null when the feature has no price yet). */
export function formatFeaturePrice(price: { monthly: number | null; currency: string }): string | null {
  if (price.monthly == null) return null;
  const symbol = price.currency === "NGN" ? "₦" : `${price.currency} `;
  return `${symbol}${price.monthly.toLocaleString("en-NG")}/month`;
}

/** What a bundle child costs is its parent's price (it is only sold through the parent). */
export function resolveFeaturePrice(feature: FeatureCatalog, catalog: FeatureCatalog[]): FeaturePrice {
  const parent = feature.parentFeatureId ? catalog.find((c) => c.id === feature.parentFeatureId) : undefined;
  let source = parent ?? feature;
  // A child of a capped add-on comes with every pack of that limit, so quote the cheapest pack that includes it.
  if (parent?.tierType === "paid_metered_limit" && parent.limitType) {
    const packs = catalog.filter((c) => c.isActive && c.tierType === "paid_metered_limit" && c.limitType === parent.limitType && priceOf(c).monthly != null);
    const cheapest = packs.sort((a, b) => (priceOf(a).monthly ?? Infinity) - (priceOf(b).monthly ?? Infinity))[0];
    if (cheapest) source = cheapest;
  }
  return { name: feature.name, ...priceOf(source), currency: source.currency, viaFeatureKey: source === feature ? undefined : source.key };
}

/**
 * The standard 402 body for a feature the org can't use: "<Name> costs
 * ₦X/month" when it is on but unpaid, "feature_disabled" when its flag is off.
 */
export async function featureNotPurchasedBody(featureKey: string, organisationId?: string) {
  const catalog = await loadAllCatalog();
  const feature = catalog.find((f) => f.key === featureKey);
  if (!feature) return { error: "feature_not_purchased", featureKey, featureName: featureKey, message: "This feature isn't included in your plan yet." };

  if (!feature.isActive || (await loadDisabledFlagKeys(db, organisationId)).has(featureKey)) {
    return { error: "feature_disabled", featureKey, featureName: feature.name, message: `${feature.name} isn't available right now.` };
  }
  const price = resolveFeaturePrice(feature, catalog);
  const label = formatFeaturePrice(price);
  const via = price.viaFeatureKey ? catalog.find((c) => c.key === price.viaFeatureKey)?.name : undefined;
  return {
    error: "feature_not_purchased",
    featureKey,
    featureName: feature.name,
    priceMonthly: price.monthly,
    priceAnnual: price.annual,
    currency: price.currency,
    message: label
      ? `${feature.name} costs ${label}${via ? ` (included in ${via})` : ""}. Add it from Settings > Billing to continue.`
      : `This needs the "${feature.name}" add-on. Add it from Settings > Billing to continue.`,
  };
}

/**
 * For an inline gate: true when the org holds the feature; otherwise sends the
 * standard 402 and returns false, so the caller just `return`s.
 */
export async function ensureFeatureOrReply(
  res: { locals: Record<string, any>; status(code: number): { json(body: unknown): unknown } },
  organisationId: string | undefined,
  featureKey: string,
): Promise<boolean> {
  if (!organisationId) { res.status(401).json({ error: "Authentication required." }); return false; }
  if ((await getRequestEntitlements(res, organisationId)).has(featureKey)) return true;
  res.status(402).json(await featureNotPurchasedBody(featureKey, organisationId));
  return false;
}

/**
 * Per-org picture for the client: which features are HIDDEN (flag off,
 * deactivated, or a dependency/bundle parent hidden) and what each locked
 * (visible, unpaid) feature costs.
 */
/** Trial/grace/soft-lock state for the banner and usage meters. */
export async function getOrgLifecycleView(organisationId: string): Promise<{ state: string; graceEndsAt: string | null; trialEndsAt: string | null; graceDays: number }> {
  const life = await loadLifecycle(db, organisationId);
  const graceDays = await getConfiguredGraceDays();
  if (!life) return { state: "ok", graceEndsAt: null, trialEndsAt: null, graceDays };
  return { state: life.state, graceEndsAt: life.graceEndsAt?.toISOString() ?? null, trialEndsAt: life.org.trialEndsAt ? new Date(life.org.trialEndsAt).toISOString() : null, graceDays };
}

/** Hidden features: flag off, deactivated, or whose bundle parent / dependency is hidden. */
function computeDisabledKeys(catalog: FeatureCatalog[], flagOff: Set<string>): Set<string> {
  const byId = new Map(catalog.map((f) => [f.id, f]));
  const disabled = new Set<string>(flagOff);
  for (const f of catalog) if (!f.isActive) disabled.add(f.key);
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of catalog) {
      if (disabled.has(f.key)) continue;
      const parent = f.parentFeatureId ? byId.get(f.parentFeatureId) : undefined;
      const deps = getFeatureDef(f.key)?.dependsOn ?? [];
      if ((parent && disabled.has(parent.key)) || deps.some((d) => disabled.has(d))) {
        disabled.add(f.key);
        changed = true;
      }
    }
  }
  return disabled;
}

/** Request-scoped, like getRequestEntitlements: the hidden features for this org, queried at most once per request. */
export function getRequestDisabledFeatures(res: { locals: Record<string, any> }, organisationId: string): Promise<Set<string>> {
  if (!res.locals.__orgDisabledFeatures) {
    res.locals.__orgDisabledFeatures = Promise.all([loadAllCatalog(), loadDisabledFlagKeys(db, organisationId)]).then(([catalog, flagOff]) =>
      computeDisabledKeys(catalog, flagOff),
    );
  }
  return res.locals.__orgDisabledFeatures;
}

export async function getOrgFeatureView(organisationId: string): Promise<{ disabled: string[]; prices: Record<string, FeaturePrice> }> {
  const [catalog, flagOff, granted] = await Promise.all([
    loadAllCatalog(),
    loadDisabledFlagKeys(db, organisationId),
    getOrgEntitlements(organisationId),
  ]);
  const disabled = computeDisabledKeys(catalog, flagOff);
  const prices: Record<string, FeaturePrice> = {};
  for (const f of catalog) {
    if (f.tierType === "free" || granted.has(f.key) || disabled.has(f.key)) continue;
    prices[f.key] = resolveFeaturePrice(f, catalog);
  }
  return { disabled: Array.from(disabled), prices };
}

export type CountLimitType = "staff_seats" | "customer_count" | "store_count" | "item_count";

const LIMIT_FEATURE_KEY: Record<CountLimitType, string> = {
  staff_seats: "staff_seats_addon",
  customer_count: "customer_capacity_addon",
  store_count: "store_addon",
  item_count: "item_capacity_addon",
};

/**
 * Fallback when the catalog row has no freeLimit (seed drift, or an admin
 * clearing the field): the documented free tier, never 0. A 0 would block the
 * very first store/staff/customer and lock a post-trial org out of setup.
 */
const DEFAULT_FREE_LIMIT: Record<CountLimitType, number> = { staff_seats: 2, customer_count: 30, store_count: 1, item_count: 50 };

const LIMIT_NOUN: Record<CountLimitType, string> = { staff_seats: "staff member", customer_count: "customer", store_count: "store", item_count: "item" };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Thrown by the storage layer (create/restore/bulk paths) when a free-tier
 * count cap would be exceeded. Carries everything the 402 body needs so any
 * route - or the global error handler - can map it with sendPlanLimitError.
 * Existing rows are never touched: an org already over its cap keeps its
 * data and is only blocked from adding more.
 */
export class CountLimitError extends Error {
  readonly status = 402;
  readonly code = "count_limit_reached";
  readonly featureKey: string;
  constructor(readonly limitType: CountLimitType, readonly limit: number, readonly used: number, readonly adding = 1, readonly tiered = false, readonly trial = false) {
    // Seats are per store and never include the owner, so say so wherever the number is quoted.
    const noun = LIMIT_NOUN[limitType];
    const scope = limitType === "staff_seats" ? " per store (the owner doesn't count)" : "";
    super(
      trial
        ? adding > 1
          ? `You're on the free trial, which includes ${limit} ${noun}s${scope} (${used} in use). Importing ${adding} more would go over it - upgrade to get more.`
          : `You're on the free trial, which includes ${limit} ${noun}${limit === 1 ? "" : "s"}${scope}. Upgrade to get more.`
        : tiered
        ? adding > 1
          ? `Importing ${adding} ${noun}s would exceed the ${limit}${scope} your plan covers (${used} in use). Move up to a bigger plan to import more.`
          : `Your plan covers up to ${limit} ${noun}${limit === 1 ? "" : "s"}${scope}. Move up to a bigger plan to add more.`
        : adding > 1
        ? `Importing ${adding} ${noun}s would exceed your free-tier limit of ${limit}${scope} (${used} in use). Add the ${noun} add-on to import more.`
        : `You're on the free tier of ${limit} ${noun}${limit === 1 ? "" : "s"}${scope}. Add the ${noun} add-on to add more.`
    );
    this.name = "CountLimitError";
    this.featureKey = LIMIT_FEATURE_KEY[limitType];
  }
  toBody() {
    return { error: "count_limit_reached", limitType: this.limitType, limit: this.limit, used: this.used, featureKey: this.featureKey, tiered: this.tiered, trial: this.trial, message: this.message };
  }
}

/**
 * Maps a CountLimitError to the standard 402 response. Returns true when it
 * handled the error, so a route's catch block can do
 * `if (sendPlanLimitError(res, error)) return;` before its generic 500.
 */
export function sendPlanLimitError(res: { status(code: number): { json(body: unknown): unknown } }, error: unknown): boolean {
  if (!(error instanceof CountLimitError)) return false;
  res.status(402).json(error.toBody());
  return true;
}

type CountConn = Pick<typeof db, "select">;

/**
 * Live usage for one cap. Only live records count: archived staff/customers, inactive stores and deleted items don't.
 * Two rules treat "the same person" once:
 *  - staff are counted per store and never include the owner, so an owner who has a record in each store (one
 *    staff code per store) uses no seat, and a team's seats don't pool across branches;
 *  - customers are counted per person across the business: profiles sharing a global id or phone number in
 *    several stores are one customer, not several.
 * For staff, `storeId` picks the store to count; without it the busiest store is returned.
 */
async function countUsed(conn: CountConn, organisationId: string, limitType: CountLimitType, storeId?: string): Promise<number> {
  if (limitType === "staff_seats") {
    const perStore = await staffUsedByStore(conn, organisationId);
    if (storeId) return perStore.get(storeId) ?? 0;
    return Math.max(0, ...Array.from(perStore.values()));
  }
  if (limitType === "customer_count") {
    const [row] = await conn
      .select({ c: sql<number>`count(distinct coalesce(${customers.globalCustomerId}, nullif(${customers.mobileNumber}, ''), ${customers.id}))::int` })
      .from(customers)
      .innerJoin(stores, eq(customers.storeId, stores.id))
      .where(and(eq(customers.isArchived, false), eq(stores.businessId, organisationId)));
    return row?.c ?? 0;
  }
  if (limitType === "item_count") {
    // Sellable items only: back-bar supplies (type 'supply') are consumables, not catalogue items.
    const [row] = await conn.select({ c: sql<number>`count(*)::int` }).from(inventory).innerJoin(stores, eq(inventory.storeId, stores.id)).where(and(eq(stores.businessId, organisationId), eq(inventory.isDeleted, false), sql`${inventory.type} in ('product','service')`));
    return row?.c ?? 0;
  }
  const [row] = await conn.select({ c: sql<number>`count(*)::int` }).from(stores).where(and(eq(stores.businessId, organisationId), eq(stores.isActive, true)));
  return row?.c ?? 0;
}

/** Active non-owner staff per store for one business: the seats each store is using. */
export async function staffUsedByStore(conn: CountConn, organisationId: string): Promise<Map<string, number>> {
  const rows = await conn
    .select({ storeId: staff.storeId, c: sql<number>`count(*)::int` })
    .from(staff)
    .innerJoin(stores, eq(staff.storeId, stores.id))
    .where(and(eq(stores.businessId, organisationId), eq(staff.isArchived, false), sql`${staff.role} <> 'owner'`))
    .groupBy(staff.storeId);
  const out = new Map<string, number>(rows.map((r) => [r.storeId, r.c]));
  // A store with no counted staff still has a (zero) entry, so "no store given" is the max over real stores.
  const all = await conn.select({ id: stores.id }).from(stores).where(eq(stores.businessId, organisationId));
  for (const st of all) if (!out.has(st.id)) out.set(st.id, 0);
  return out;
}


/** Every limit tier in the catalog (built-in and admin-created), for the tier-capacity logic in shared/features.ts. */
export async function loadLimitTiers(conn: DbOrTx | Tx = db): Promise<LimitTier[]> {
  const rows = await conn
    .select({ key: featureCatalog.key, tierType: featureCatalog.tierType, limitType: featureCatalog.limitType, tierCapacity: featureCatalog.tierCapacity })
    .from(featureCatalog)
    .where(eq(featureCatalog.tierType, "paid_metered_limit"));
  return rows;
}

/** Keys of the active limit tiers (seat packs, capacity add-ons) an org holds for one limit type. */
async function loadOwnedTierKeys(conn: DbOrTx | Tx, organisationId: string, limitType: CountLimitType): Promise<string[]> {
  const rows = await conn
    .select({ key: featureCatalog.key })
    .from(orgFeatureEntitlements)
    .innerJoin(featureCatalog, eq(orgFeatureEntitlements.featureId, featureCatalog.id))
    .where(and(eq(orgFeatureEntitlements.organisationId, organisationId), eq(orgFeatureEntitlements.status, "active"), eq(featureCatalog.limitType, limitType)));
  return rows.map((r) => r.key);
}

async function evaluateCountLimit(
  tx: Tx,
  organisationId: string,
  limitType: CountLimitType,
  storeId?: string
): Promise<{ limit: number; used: number; unlimited: boolean; tiered: boolean; trial: boolean }> {
  // A trial gets the free amount, not unlimited: the cap is the same as the free tier, and packs bought during it still count.
  const trial = await isOrgCurrentlyTrialing(organisationId);
  // Stores are the exception: a trial can open extra branches to try multi-store out (the store form promises
  // "free during your trial"). When it ends, the owner chooses which stores stay active - see choose-active.
  if (trial && limitType === "store_count") return { limit: Infinity, used: 0, unlimited: true, tiered: false, trial: false };

  const [feature] = await tx.select().from(featureCatalog).where(eq(featureCatalog.key, LIMIT_FEATURE_KEY[limitType])).limit(1);
  const freeLimit = feature?.freeLimit ?? DEFAULT_FREE_LIMIT[limitType];

  // A failed renewal drops the org back to the free tier; otherwise the cap is the biggest tier it owns.
  const owned = (await isRenewalSoftLocked(organisationId)) ? [] : await loadOwnedTierKeys(tx, organisationId, limitType);
  const resolved = resolveCountLimit(limitType, freeLimit, owned, await loadLimitTiers(tx));
  if (resolved.unlimited) return { limit: freeLimit, used: 0, unlimited: true, tiered: false, trial: false };
  const limit = resolved.limit;
  const used = await countUsed(tx, organisationId, limitType, storeId);
  return { limit, used, unlimited: false, tiered: limit > freeLimit, trial: trial && limit === freeLimit };
}

/**
 * Race-safe gate for the hard-blocked free-tier caps (1 staff, 50 customers,
 * 1 store). MUST be called inside the same transaction as the insert/restore
 * it protects: it takes a transaction-scoped Postgres advisory lock keyed to
 * (organisationId, limitType), counts, and throws CountLimitError when
 * `used + adding` would exceed the cap. Because the lock is held until the
 * caller's transaction commits, two concurrent creates can't both read
 * "under the limit" - the second waits, then sees the first's row. Lives in
 * the storage layer (not per route) so bulk import, restore, link-customer,
 * WhatsApp and onboarding paths are all covered by construction.
 */
export async function assertWithinCountLimit(tx: Tx, organisationId: string, limitType: CountLimitType, adding = 1, storeId?: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${organisationId + ":" + limitType}))`);
  const { limit, used, unlimited, tiered, trial } = await evaluateCountLimit(tx, organisationId, limitType, storeId);
  if (!unlimited && used + adding > limit) throw new CountLimitError(limitType, limit, used, adding, tiered, trial);
}

/** Resolves the owning organisation of a store inside a transaction (undefined if the store doesn't exist). */
export async function getBusinessIdForStore(tx: Tx, storeId: string): Promise<string | undefined> {
  const [row] = await tx.select({ businessId: stores.businessId }).from(stores).where(eq(stores.id, storeId)).limit(1);
  return row?.businessId ?? undefined;
}

/**
 * Non-throwing pre-flight (route middleware fast-fail and bulk pre-checks).
 * The authoritative check is assertWithinCountLimit inside the storage
 * transaction; this just lets a route reject early with the right numbers.
 */
export async function checkCountLimit(
  organisationId: string,
  limitType: CountLimitType,
  adding = 1,
  storeId?: string
): Promise<{ allowed: boolean; limit: number; used: number; tiered: boolean; trial: boolean }> {
  return db.transaction(async (tx) => {
    const { limit, used, unlimited, tiered, trial } = await evaluateCountLimit(tx, organisationId, limitType, storeId);
    if (unlimited) return { allowed: true, limit, used, tiered, trial };
    return { allowed: used + adding <= limit, limit, used, tiered, trial };
  });
}

export async function getFeatureByKey(featureKey: string): Promise<FeatureCatalog | undefined> {
  const [feature] = await db.select().from(featureCatalog).where(eq(featureCatalog.key, featureKey)).limit(1);
  return feature;
}

/**
 * Checks that every prerequisite in featureDependencies for each requested
 * key is already active for the org OR also present in this same request -
 * the purchase-time enforcement point for edges like self_check_in ->
 * attendance_management (FAC-2). Never re-checked per request afterward.
 */
export async function validatePurchaseDependencies(
  organisationId: string,
  featureKeys: string[]
): Promise<{ ok: true } | { ok: false; message: string }> {
  const catalog = await loadCatalog();
  const byKey = new Map(catalog.map((f) => [f.key, f]));
  const alreadyGranted = await getOrgEntitlements(organisationId);
  const requestedSet = new Set(featureKeys);

  for (const key of featureKeys) {
    const feature = byKey.get(key);
    if (!feature) return { ok: false, message: `Unknown feature: ${key}.` };
    const deps = await db.select().from(featureDependencies).where(eq(featureDependencies.featureId, feature.id));
    for (const dep of deps) {
      const depFeature = catalog.find((f) => f.id === dep.dependsOnFeatureId);
      if (!depFeature) continue;
      if (alreadyGranted.has(depFeature.key) || requestedSet.has(depFeature.key)) continue;
      return { ok: false, message: `"${feature.name}" requires "${depFeature.name}" first.` };
    }
  }
  return { ok: true };
}

/**
 * Grants (or refreshes) one active entitlement. Used by the purchase flow
 * (server/lib/billing.ts activateSuccessfulPayment), the sunset-notice grace
 * window's "pay before the deadline" path, and the super-admin manual
 * grant endpoint (server/routes-admin.ts). Idempotent: re-granting an
 * already-active entitlement just clears any scheduled removal.
 */
export async function grantFeatureEntitlement(args: {
  organisationId: string;
  featureKey: string;
  source: "purchased" | "grandfathered" | "grandfathered_sunset" | "admin_grant";
  subscriptionPaymentId?: string | null;
  grantedByAdminId?: string | null;
}): Promise<void> {
  const feature = await getFeatureByKey(args.featureKey);
  if (!feature) return;

  const [existing] = await db
    .select()
    .from(orgFeatureEntitlements)
    .where(and(eq(orgFeatureEntitlements.organisationId, args.organisationId), eq(orgFeatureEntitlements.featureId, feature.id), or(eq(orgFeatureEntitlements.status, "active"), eq(orgFeatureEntitlements.status, "pending_removal"))))
    .limit(1);

  if (existing) {
    await db
      .update(orgFeatureEntitlements)
      .set({
        status: "active",
        source: args.source,
        removalEffectiveAt: null,
        subscriptionPaymentId: args.subscriptionPaymentId ?? existing.subscriptionPaymentId,
        grantedByAdminId: args.grantedByAdminId ?? existing.grantedByAdminId,
        updatedAt: new Date(),
      })
      .where(eq(orgFeatureEntitlements.id, existing.id));
  } else {
    await db.insert(orgFeatureEntitlements).values({
      organisationId: args.organisationId,
      featureId: feature.id,
      status: "active",
      source: args.source,
      subscriptionPaymentId: args.subscriptionPaymentId ?? null,
      grantedByAdminId: args.grantedByAdminId ?? null,
    });
  }

  // A bigger seat/limit pack replaces the smaller ones, so renewal bills only the tier the org is on.
  const replaced = tiersNotAbove(args.featureKey, await loadLimitTiers());
  if (replaced.length) {
    const replacedRows = await db.select({ id: featureCatalog.id }).from(featureCatalog).where(inArray(featureCatalog.key, replaced));
    if (replacedRows.length) {
      await db
        .update(orgFeatureEntitlements)
        .set({ status: "removed", updatedAt: new Date() })
        .where(and(
          eq(orgFeatureEntitlements.organisationId, args.organisationId),
          inArray(orgFeatureEntitlements.featureId, replacedRows.map((r) => r.id)),
          or(eq(orgFeatureEntitlements.status, "active"), eq(orgFeatureEntitlements.status, "pending_removal")),
        ));
    }
  }
}

/**
 * Owner-initiated (or admin-revoked) removal: stays usable through
 * removalEffectiveAt (FAC-8), same shape as subscriptions.cancelAtPeriodEnd.
 * Blocked if another still-active feature depends on this one.
 */
export async function scheduleFeatureRemoval(
  organisationId: string,
  featureKey: string,
  removalEffectiveAt: Date
): Promise<{ ok: true } | { ok: false; message: string }> {
  const feature = await getFeatureByKey(featureKey);
  if (!feature) return { ok: false, message: "Unknown feature." };

  const granted = await getOrgEntitlements(organisationId);
  const catalog = await loadCatalog();
  const dependents = await db.select().from(featureDependencies).where(eq(featureDependencies.dependsOnFeatureId, feature.id));
  for (const dep of dependents) {
    const dependentFeature = catalog.find((f) => f.id === dep.featureId);
    // A bundled child (Stock Transfers under Additional Store) goes with its parent, so it never blocks removing it.
    if (dependentFeature?.parentFeatureId === feature.id) continue;
    if (dependentFeature && granted.has(dependentFeature.key)) {
      return { ok: false, message: `Remove "${dependentFeature.name}" first - it requires "${feature.name}".` };
    }
  }

  await db
    .update(orgFeatureEntitlements)
    .set({ status: "pending_removal", removalEffectiveAt, updatedAt: new Date() })
    .where(and(eq(orgFeatureEntitlements.organisationId, organisationId), eq(orgFeatureEntitlements.featureId, feature.id), eq(orgFeatureEntitlements.status, "active")));
  return { ok: true };
}

/** Active (or still-in-grace pending_removal) paid entitlements, priced at one billing cycle - the add-on portion of a checkout total or renewal charge. */
export async function getActiveFeaturePricing(
  organisationId: string,
  billingCycle: "monthly" | "annual"
): Promise<{ featureKey: string; name: string; price: number }[]> {
  const rows = await db
    .select({ feature: featureCatalog, status: orgFeatureEntitlements.status, removalEffectiveAt: orgFeatureEntitlements.removalEffectiveAt })
    .from(orgFeatureEntitlements)
    .innerJoin(featureCatalog, eq(orgFeatureEntitlements.featureId, featureCatalog.id))
    .where(and(eq(orgFeatureEntitlements.organisationId, organisationId), or(eq(orgFeatureEntitlements.status, "active"), eq(orgFeatureEntitlements.status, "pending_removal"))));

  const now = new Date();
  return rows
    .filter((r) => r.status === "active" || !r.removalEffectiveAt || r.removalEffectiveAt > now)
    .map((r) => ({
      featureKey: r.feature.key,
      name: r.feature.name,
      price: Number(billingCycle === "annual" ? r.feature.priceAnnual : r.feature.priceMonthly) || 0,
    }));
}

/** Read-only limit status for GET /api/entitlements - no advisory lock needed, this never gates a write. */
export async function getCountLimitStatus(
  organisationId: string,
  limitType: CountLimitType,
  storeId?: string
): Promise<{ limit: number; used: number; unlimited: boolean; tiered: boolean; trial: boolean; usedByStore?: Record<string, number> }> {
  const feature = await getFeatureByKey(LIMIT_FEATURE_KEY[limitType]);
  const freeLimit = feature?.freeLimit ?? DEFAULT_FREE_LIMIT[limitType];
  // Same rule as evaluateCountLimit: a trial gets the free amount; otherwise the cap is the biggest tier owned.
  const trialing = await isOrgCurrentlyTrialing(organisationId);
  const owned = (await isRenewalSoftLocked(organisationId)) ? [] : await loadOwnedTierKeys(db, organisationId, limitType);
  const resolved = resolveCountLimit(limitType, freeLimit, owned, await loadLimitTiers());

  const used = await countUsed(db, organisationId, limitType, storeId);
  // A trial may open extra stores (see evaluateCountLimit); the cap applies once it ends.
  if (trialing && limitType === "store_count") return { limit: freeLimit, used, unlimited: true, tiered: false, trial: false };
  // Staff seats are per store, so the client also gets every store's count to pick the one in view.
  const usedByStore = limitType === "staff_seats" ? Object.fromEntries(await staffUsedByStore(db, organisationId)) : undefined;
  if (resolved.unlimited) return { limit: freeLimit, used, unlimited: true, tiered: false, trial: false, usedByStore };
  return { limit: resolved.limit, used, unlimited: false, tiered: resolved.limit > freeLimit, trial: trialing && resolved.limit === freeLimit, usedByStore };
}

/** Express middleware wrapping checkCountLimit with the standard 402 response shape. */
export function requireCountLimit(limitType: CountLimitType): RequestHandler {
  return async (req, res, next) => {
    const businessId = (req as any).user?.businessId;
    if (!businessId) return res.status(401).json({ error: "Authentication required." });
    try {
      // Staff seats are per store: the new member's store is in the body.
      const storeId = limitType === "staff_seats" && typeof req.body?.storeId === "string" ? req.body.storeId : undefined;
      const outcome = await checkCountLimit(businessId, limitType, 1, storeId);
      if (outcome.allowed) return next();
      return res.status(402).json(new CountLimitError(limitType, outcome.limit, outcome.used, 1, outcome.tiered, outcome.trial).toBody());
    } catch (error) {
      console.error(`requireCountLimit(${limitType}) error:`, error);
      return res.status(500).json({ error: "We couldn't verify your plan limits. Please try again." });
    }
  };
}
