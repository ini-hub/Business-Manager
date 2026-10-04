import type { RequestHandler } from "express";
import { sql, eq, and, or, isNull, lte, inArray } from "drizzle-orm";
import { db } from "../db";
import {
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
import { isOrgTrialing } from "./trial";
import { FREE_FEATURE_KEYS } from "@shared/features";

/**
 * Pay-per-feature entitlement resolution. Deliberately request-scoped, no
 * cross-request cache: purchases and removals must take effect immediately,
 * and orgs change entitlements rarely enough that a fresh query per gated
 * request is cheap (see SAC-1 in the requirements plan).
 */

type DbOrTx = typeof db;

async function loadCatalog(conn: DbOrTx): Promise<FeatureCatalog[]> {
  return conn.select().from(featureCatalog).where(eq(featureCatalog.isActive, true));
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

/** Feature keys currently killed platform-wide: the feature's own flag (feature_catalog.flag_id) has status='off'. */
async function loadDisabledFlagKeys(conn: DbOrTx): Promise<Set<string>> {
  const rows = await conn
    .select({ key: featureCatalog.key })
    .from(featureCatalog)
    .innerJoin(featureFlags, eq(featureFlags.id, featureCatalog.flagId))
    .where(eq(featureFlags.status, "off"));
  return new Set(rows.map((r) => r.key));
}

/**
 * True only while the org is inside its (admin-configurable) trial window -
 * mirrors client/src/lib/trial.ts's isOrgTrialing. The trial is supposed to
 * mean "everything free for N days" (requirements plan §1), not merely
 * "not locked out" - getOrgEntitlements/checkCountLimit/getCountLimitStatus
 * all short-circuit on this rather than resolving purchases as normal.
 */
async function isOrgCurrentlyTrialing(organisationId: string): Promise<boolean> {
  const [org] = await db
    .select({ status: organisations.status, trialEndsAt: organisations.trialEndsAt })
    .from(organisations)
    .where(eq(organisations.id, organisationId))
    .limit(1);
  return org ? isOrgTrialing(org) : false;
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
function computePurchasedGrant(
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
      if (feature.tierType === "bundle_parent") {
        for (const child of catalog) {
          if (child.parentFeatureId === feature.id) granted.add(child.key);
        }
      }
    }
  }

  // Emergency kill-switch beats monetization, never the reverse (§2.5).
  for (const key of Array.from(disabledFlags)) granted.delete(key);

  return granted;
}

export async function getOrgEntitlements(organisationId: string): Promise<Set<string>> {
  sweepExpiredEntitlements(organisationId);

  const [catalog, disabledFlags, activeRows, trialing] = await Promise.all([
    loadCatalog(db),
    loadDisabledFlagKeys(db),
    loadActiveEntitlementRows(organisationId),
    isOrgCurrentlyTrialing(organisationId),
  ]);

  // Blanket grant while trialing: every active catalog feature, full stop -
  // no need to reason about bundles/dependencies/purchases, this isn't a
  // purchase. The kill-switch below still applies even during a trial.
  if (trialing) {
    const granted = new Set([...FREE_FEATURE_KEYS, ...catalog.map((f) => f.key)]);
    for (const key of Array.from(disabledFlags)) granted.delete(key);
    return granted;
  }

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
    loadCatalog(db),
    loadDisabledFlagKeys(db),
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

/** The standard 402 body for a paid feature the org doesn't have. */
export async function featureNotPurchasedBody(featureKey: string) {
  const feature = await getFeatureByKey(featureKey);
  return {
    error: "feature_not_purchased",
    featureKey,
    featureName: feature?.name ?? featureKey,
    message: feature ? `This needs the "${feature.name}" add-on. Add it from Settings > Billing to continue.` : "This feature isn't included in your plan yet.",
  };
}

/**
 * Route-level gate for orgs that already passed enforceOrgAccess (whole-org
 * lock) but haven't purchased this specific add-on. Returns 402, distinct
 * from enforceOrgAccess's 403 {locked:true}, so the client can branch to an
 * in-context upgrade prompt instead of a full paywall screen. Mutating routes
 * are gated by default; GET stays open so data from a since-removed feature
 * stays readable (soft-locked, never deleted) - except where the read IS the
 * feature (see featurePolicy.ts). New gates belong in that table; this stays
 * for handler-level checks that depend on the request body.
 */
function requireFeature(featureKey: string): RequestHandler {
  return async (req, res, next) => {
    const businessId = (req as any).user?.businessId;
    if (!businessId) return res.status(401).json({ error: "Authentication required." });
    try {
      if ((await getRequestEntitlements(res, businessId)).has(featureKey)) return next();
      return res.status(402).json(await featureNotPurchasedBody(featureKey));
    } catch (error) {
      console.error(`requireFeature(${featureKey}) error:`, error);
      return res.status(500).json({ error: "We couldn't verify feature access. Please try again." });
    }
  };
}

export type CountLimitType = "staff_seats" | "customer_count" | "store_count";

const LIMIT_FEATURE_KEY: Record<CountLimitType, string> = {
  staff_seats: "staff_seats_addon",
  customer_count: "customer_capacity_addon",
  store_count: "store_addon",
};

/**
 * Fallback when the catalog row has no freeLimit (seed drift, or an admin
 * clearing the field): the documented free tier, never 0. A 0 would block the
 * very first store/staff/customer and lock a post-trial org out of setup.
 */
const DEFAULT_FREE_LIMIT: Record<CountLimitType, number> = { staff_seats: 1, customer_count: 50, store_count: 1 };

const LIMIT_NOUN: Record<CountLimitType, string> = { staff_seats: "staff member", customer_count: "customer", store_count: "store" };

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
  constructor(readonly limitType: CountLimitType, readonly limit: number, readonly used: number, readonly adding = 1) {
    const noun = LIMIT_NOUN[limitType];
    super(
      adding > 1
        ? `Importing ${adding} ${noun}s would exceed your free-tier limit of ${limit} (${used} in use). Add the ${noun} add-on to import more.`
        : `You're on the free tier of ${limit} ${noun}${limit === 1 ? "" : "s"}. Add the ${noun} add-on to add more.`
    );
    this.name = "CountLimitError";
    this.featureKey = LIMIT_FEATURE_KEY[limitType];
  }
  toBody() {
    return { error: "count_limit_reached", limitType: this.limitType, limit: this.limit, used: this.used, featureKey: this.featureKey, message: this.message };
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

async function evaluateCountLimit(
  tx: Tx,
  organisationId: string,
  limitType: CountLimitType
): Promise<{ limit: number; used: number; unlimited: boolean }> {
  const [org] = await tx
    .select({ status: organisations.status, trialEndsAt: organisations.trialEndsAt })
    .from(organisations)
    .where(eq(organisations.id, organisationId))
    .limit(1);
  if (org && isOrgTrialing(org)) return { limit: Infinity, used: 0, unlimited: true };

  const [feature] = await tx.select().from(featureCatalog).where(eq(featureCatalog.key, LIMIT_FEATURE_KEY[limitType])).limit(1);
  const limit = feature?.freeLimit ?? DEFAULT_FREE_LIMIT[limitType];

  const [entitlement] = feature
    ? await tx
        .select({ id: orgFeatureEntitlements.id })
        .from(orgFeatureEntitlements)
        .where(and(eq(orgFeatureEntitlements.organisationId, organisationId), eq(orgFeatureEntitlements.featureId, feature.id), eq(orgFeatureEntitlements.status, "active")))
        .limit(1)
    : [];
  if (entitlement) return { limit, used: 0, unlimited: true };

  let used = 0;
  if (limitType === "staff_seats") {
    const [row] = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(staff)
      .innerJoin(stores, eq(staff.storeId, stores.id))
      .where(and(eq(stores.businessId, organisationId), eq(staff.isArchived, false)));
    used = row?.c ?? 0;
  } else if (limitType === "customer_count") {
    const [row] = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(customers)
      .innerJoin(stores, eq(customers.storeId, stores.id))
      .where(and(eq(stores.businessId, organisationId), eq(customers.isArchived, false)));
    used = row?.c ?? 0;
  } else {
    const [row] = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(stores)
      .where(and(eq(stores.businessId, organisationId), eq(stores.isActive, true)));
    used = row?.c ?? 0;
  }
  return { limit, used, unlimited: false };
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
export async function assertWithinCountLimit(tx: Tx, organisationId: string, limitType: CountLimitType, adding = 1): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${organisationId + ":" + limitType}))`);
  const { limit, used, unlimited } = await evaluateCountLimit(tx, organisationId, limitType);
  if (!unlimited && used + adding > limit) throw new CountLimitError(limitType, limit, used, adding);
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
  adding = 1
): Promise<{ allowed: boolean; limit: number; used: number }> {
  return db.transaction(async (tx) => {
    const { limit, used, unlimited } = await evaluateCountLimit(tx, organisationId, limitType);
    if (unlimited) return { allowed: true, limit, used };
    return { allowed: used + adding <= limit, limit, used };
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
  const catalog = await loadCatalog(db);
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
  const catalog = await loadCatalog(db);
  const dependents = await db.select().from(featureDependencies).where(eq(featureDependencies.dependsOnFeatureId, feature.id));
  for (const dep of dependents) {
    const dependentFeature = catalog.find((f) => f.id === dep.featureId);
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
export async function getCountLimitStatus(organisationId: string, limitType: CountLimitType): Promise<{ limit: number; used: number; unlimited: boolean }> {
  const feature = await getFeatureByKey(LIMIT_FEATURE_KEY[limitType]);
  const limit = feature?.freeLimit ?? DEFAULT_FREE_LIMIT[limitType];
  // Trialing counts as unlimited too (§1) - getOrgEntitlements already grants
  // the addon key outright while trialing, so this `.has()` check covers both
  // "purchased" and "still inside the trial" without a separate branch here.
  const unlimited = feature ? (await getOrgEntitlements(organisationId)).has(feature.key) : false;

  let used = 0;
  if (limitType === "staff_seats") {
    const [row] = await db.select({ c: sql<number>`count(*)::int` }).from(staff).innerJoin(stores, eq(staff.storeId, stores.id)).where(and(eq(stores.businessId, organisationId), eq(staff.isArchived, false)));
    used = row?.c ?? 0;
  } else if (limitType === "customer_count") {
    const [row] = await db.select({ c: sql<number>`count(*)::int` }).from(customers).innerJoin(stores, eq(customers.storeId, stores.id)).where(and(eq(stores.businessId, organisationId), eq(customers.isArchived, false)));
    used = row?.c ?? 0;
  } else {
    const [row] = await db.select({ c: sql<number>`count(*)::int` }).from(stores).where(and(eq(stores.businessId, organisationId), eq(stores.isActive, true)));
    used = row?.c ?? 0;
  }
  return { limit, used, unlimited };
}

/** Express middleware wrapping checkCountLimit with the standard 402 response shape. */
export function requireCountLimit(limitType: CountLimitType): RequestHandler {
  return async (req, res, next) => {
    const businessId = (req as any).user?.businessId;
    if (!businessId) return res.status(401).json({ error: "Authentication required." });
    try {
      const outcome = await checkCountLimit(businessId, limitType);
      if (outcome.allowed) return next();
      return res.status(402).json(new CountLimitError(limitType, outcome.limit, outcome.used).toBody());
    } catch (error) {
      console.error(`requireCountLimit(${limitType}) error:`, error);
      return res.status(500).json({ error: "We couldn't verify your plan limits. Please try again." });
    }
  };
}
