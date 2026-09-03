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

/** Feature keys currently killed platform-wide via the featureFlags release switch (status='off'). */
async function loadDisabledFlagKeys(conn: DbOrTx): Promise<Set<string>> {
  const rows = await conn.select({ name: featureFlags.name }).from(featureFlags).where(eq(featureFlags.status, "off"));
  return new Set(rows.map((r) => r.name));
}

/**
 * True only while the org is inside its (admin-configurable) trial window -
 * mirrors client/src/lib/trial.ts's isOrgTrialing. The trial is supposed to
 * mean "everything free for N days" (requirements plan §1), not merely
 * "not locked out" - getOrgEntitlements/checkCountLimit/getCountLimitStatus
 * all short-circuit on this rather than resolving purchases as normal.
 */
export async function isOrgCurrentlyTrialing(organisationId: string): Promise<boolean> {
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

  const granted = new Set<string>();
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
    const granted = new Set(catalog.map((f) => f.key));
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
 * Route-level gate for orgs that already passed enforceOrgAccess (whole-org
 * lock) but haven't purchased this specific add-on. Returns 402, distinct
 * from enforceOrgAccess's 403 {locked:true}, so the client can branch to an
 * in-context upgrade prompt instead of a full paywall screen. Only wire this
 * onto mutating routes - GET stays open so data from a since-removed feature
 * stays readable (soft-locked, never deleted).
 */
export function requireFeature(featureKey: string): RequestHandler {
  return async (req, res, next) => {
    const businessId = (req as any).user?.businessId;
    if (!businessId) return res.status(401).json({ error: "Authentication required." });
    try {
      if (await hasFeature(businessId, featureKey)) return next();
      const [feature] = await db.select().from(featureCatalog).where(eq(featureCatalog.key, featureKey)).limit(1);
      return res.status(402).json({
        error: "feature_not_purchased",
        featureKey,
        featureName: feature?.name ?? featureKey,
        message: feature ? `This needs the "${feature.name}" add-on. Add it from Settings > Billing to continue.` : "This feature isn't included in your plan yet.",
      });
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
 * Race-safe gate for the two hard-blocked free-tier limits (1 staff, 50
 * customers - FAC-6). Holds a Postgres transaction-scoped advisory lock
 * keyed to (organisationId, limitType) so two concurrent creates can't both
 * read "under the limit" and both insert - no denormalized counter to drift
 * against archive/restore/bulk-import paths, and nothing to clean up on
 * crash (pg_advisory_xact_lock releases automatically at commit/rollback),
 * mirroring the atomic-claim idiom in maybeProcessDueRenewal
 * (server/lib/billing.ts).
 *
 * `getCurrentCount` runs inside the locked transaction. `create` does NOT -
 * it calls back out to the existing storage.createStaff/createCustomer,
 * which use the shared pooled connection, not this transaction. That leaves
 * a narrow window between this check committing and that insert completing
 * where two near-simultaneous requests could both be told "allowed". Fully
 * closing it means threading a `tx` parameter through StaffRepository /
 * the customer insert path - a larger change tracked as follow-up, not
 * attempted here to avoid a hand-rolled connection-locking scheme (session
 * advisory locks held across a manually checked-out pool client) that risks
 * leaking a lock if the release path is ever missed.
 */
export async function checkCountLimit(
  organisationId: string,
  limitType: CountLimitType
): Promise<{ allowed: boolean; limit: number; used: number }> {
  if (await isOrgCurrentlyTrialing(organisationId)) {
    return { allowed: true, limit: Infinity, used: 0 };
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${organisationId + ":" + limitType}))`);

    const [feature] = await tx.select().from(featureCatalog).where(eq(featureCatalog.key, LIMIT_FEATURE_KEY[limitType])).limit(1);
    const limit = feature?.freeLimit ?? 0;

    const [entitlement] = feature
      ? await tx
          .select({ id: orgFeatureEntitlements.id })
          .from(orgFeatureEntitlements)
          .where(and(eq(orgFeatureEntitlements.organisationId, organisationId), eq(orgFeatureEntitlements.featureId, feature.id), eq(orgFeatureEntitlements.status, "active")))
          .limit(1)
      : [];
    if (entitlement) return { allowed: true, limit, used: 0 };

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

    return { allowed: used < limit, limit, used };
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
  const limit = feature?.freeLimit ?? 0;
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
  const nounFor: Record<CountLimitType, string> = { staff_seats: "staff member", customer_count: "customer", store_count: "store" };
  return async (req, res, next) => {
    const businessId = (req as any).user?.businessId;
    if (!businessId) return res.status(401).json({ error: "Authentication required." });
    try {
      const outcome = await checkCountLimit(businessId, limitType);
      if (outcome.allowed) return next();
      const noun = nounFor[limitType];
      const addon = LIMIT_FEATURE_KEY[limitType];
      return res.status(402).json({
        error: "count_limit_reached",
        limitType,
        limit: outcome.limit,
        used: outcome.used,
        featureKey: addon,
        message: `You're on the free tier of ${outcome.limit} ${noun}${outcome.limit === 1 ? "" : "s"}. Add the ${noun} add-on to add more.`,
      });
    } catch (error) {
      console.error(`requireCountLimit(${limitType}) error:`, error);
      return res.status(500).json({ error: "We couldn't verify your plan limits. Please try again." });
    }
  };
}
