import type { Request } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { subscriptions } from "@shared/schema";
import { withPublicLogo } from "./businessLogo";
import { isTrialExpired } from "./trial";
import { getMaskPolicy } from "./dataMasking";
import { listScreenGates } from "./gateRules";
import { getSidebarLayout } from "./platformConfig";
import { getUserPermissions } from "./roles";
import {
  getOrgEntitlements,
  getOrgPurchasedFeatures,
  getCountLimitStatus,
  getOrgFeatureView,
  getOrgLifecycleView,
  loadOrgEntitlementInputs,
} from "./entitlements";

// The data the app shell needs before it can paint. Each loader is the single implementation behind both
// its legacy endpoint (/api/auth/user, /api/business, /api/stores, /api/entitlements) and GET /api/bootstrap,
// so the two can never drift. The bootstrap exists because a page load used to fire these as separate
// requests, some of them waiting on others; for a user far from the server each wait is a full round trip.

type AuthedReq = Request & { user?: any };

/** The signed-in user as /api/auth/user returns it, or null when the session has no user record. */
export async function loadAuthUser(req: AuthedReq): Promise<Record<string, unknown> | null> {
  const userId = req.user?.userId || req.user?.id;
  if (!userId) return null;
  const user = await storage.getUser(userId);
  if (!user) return null;

  const orgId = req.user.organisationId || user.businessId;
  let business = null;
  let activeRole = user.role;
  let ownStaffRecord = null;

  if (orgId) {
    const [fetchedBusiness, member, staffRecord] = await Promise.all([
      storage.getBusinessById(orgId),
      storage.getOrganisationMember(user.id, orgId),
      storage.getStaffByUserId(user.id),
    ]);
    business = fetchedBusiness;
    ownStaffRecord = staffRecord;
    if (member) activeRole = member.role;
  } else {
    ownStaffRecord = await storage.getStaffByUserId(user.id);
  }

  return {
    ...user,
    id: user.id,
    email: user.email || user.phone || "",
    role: activeRole,
    businessId: orgId,
    business,
    staffId: ownStaffRecord?.id ?? null,
    impersonating: req.user.impersonatedBy ? true : undefined,
    password: undefined,
    passwordHash: undefined,
    otpCode: undefined,
    otpExpiry: undefined,
    activationCode: undefined,
    activationCodeExpiry: undefined,
    pendingEmailOtp: undefined,
    pendingEmailOtpExpiry: undefined,
    pendingPhoneOtp: undefined,
    pendingPhoneOtpExpiry: undefined,
  };
}

/** The active business as /api/business returns it (with the viewer's mask policy), or null. */
export async function loadActiveBusiness(req: AuthedReq): Promise<Record<string, unknown> | null> {
  const user = req.user;
  // 1. The business on the session; 2. the user record's default; 3. the first organisation they belong to.
  let activeBusinessId = user.businessId;
  if (!activeBusinessId) {
    const userRecord = await storage.getUser(user.id);
    activeBusinessId = userRecord?.businessId;
  }
  if (!activeBusinessId) {
    const userOrgs = await storage.getOrganisationsByUserId(user.id);
    if (userOrgs.length > 0) {
      activeBusinessId = userOrgs[0].id;
      await storage.updateUser(user.id, { businessId: activeBusinessId });
    }
  }
  if (!activeBusinessId) return null;

  let business = await storage.getBusinessById(activeBusinessId);

  // Lazy trial-expiry flip: an org only reaches this branch if signup created it "trialing", so a
  // pre-existing organisation (all "active") is never touched.
  if (business && isTrialExpired(business)) {
    const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.organisationId, business.id));
    if (subscription?.status === "active") {
      business = (await storage.updateBusiness(business.id, { status: "active" })) || business;
    }
  }
  if (!business) return null;

  // Tells the client how this viewer's data is masked; the server has already masked the data itself.
  const viewerMask = await getMaskPolicy(req);
  return { ...withPublicLogo(business), viewerMask };
}

export type StoresResult = { ok: true; data: unknown[] } | { ok: false; status: number; error: string };

/** The stores this viewer may see, as /api/stores returns them. */
export async function loadVisibleStores(req: AuthedReq, requestedBusinessId?: string): Promise<StoresResult> {
  const userId = req.user?.userId || req.user?.id;
  if (!userId) return { ok: false, status: 401, error: "Please log in to access stores." };

  const businessId = requestedBusinessId || req.user?.businessId;
  if (!businessId) return { ok: false, status: 400, error: "Please select a business first." };

  const member = await storage.getOrganisationMember(userId, businessId);
  if (!member) return { ok: false, status: 403, error: "Unauthorized access to business data." };

  let storeList = await storage.getStores(businessId);
  // Staff only see the store(s) they are assigned to.
  if (req.user?.role === "staff") {
    const assigned = new Set((await storage.getAllStaffByUserId(userId)).map((st) => st.storeId));
    storeList = storeList.filter((st) => assigned.has(st.id));
  }
  return { ok: true, data: storeList };
}

/** Everything GET /api/entitlements returns for `user`, from one lifecycle read and one entitlement resolution. */
export async function loadEntitlementsPayload(user: any, storeId?: string) {
  // The org's lifecycle row and entitlement rows are read once and shared by every view below.
  const inputs = await loadOrgEntitlementInputs(user.businessId);
  const { life } = inputs;
  const [granted, purchased, staffSeats, customerCount, storeCount, itemCount, rawScreenGates, sidebarLayout, permissions, lifecycle] =
    await Promise.all([
      getOrgEntitlements(user.businessId, inputs),
      getOrgPurchasedFeatures(user.businessId, inputs),
      getCountLimitStatus(user.businessId, "staff_seats", storeId, life),
      getCountLimitStatus(user.businessId, "customer_count", undefined, life),
      getCountLimitStatus(user.businessId, "store_count", undefined, life),
      getCountLimitStatus(user.businessId, "item_count", undefined, life),
      listScreenGates(),
      getSidebarLayout(),
      getUserPermissions(user),
      getOrgLifecycleView(user.businessId, life),
    ]);
  const featureView = await getOrgFeatureView(user.businessId, granted);
  const screenGates = rawScreenGates.map(({ pattern, featureKey, module, source }) => ({ pattern, featureKey, module, source }));

  return {
    features: Array.from(granted),
    // Client screens that need a feature (code baseline + admin-defined rules), so the sidebar and router
    // lock them from the same data the server enforces.
    screenGates,
    // The super-admin sidebar layout, or null for the built-in default (shared/sidebarLayout.ts).
    sidebarLayout,
    // The pages this person's role may use (shared/permissions.ts); the sidebar shows only these.
    permissions: Array.from(permissions),
    // Subset of `features` that's actually been purchased (or is free), never inflated by the trial grant.
    purchasedFeatures: Array.from(purchased),
    // Flag off / deactivated: the client HIDES these. Everything else not in `features` is on-but-unpaid:
    // shown locked, priced via featurePrices.
    lifecycle,
    disabledFeatures: featureView.disabled,
    featurePrices: featureView.prices,
    limits: { staff_seats: staffSeats, customer_count: customerCount, store_count: storeCount, item_count: itemCount },
  };
}
