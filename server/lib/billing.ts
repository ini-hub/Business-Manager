import crypto from "crypto";
import { db } from "../db";
import { eq, and, or, isNull, lt } from "drizzle-orm";
import {
  subscriptions,
  subscriptionPayments,
  organisations,
  organisationMembers,
  users,
  plans,
  type Organisation,
  type Subscription,
  type Plan,
} from "@shared/schema";
import { chargeAuthorization } from "./paystack";
import { grantFeatureEntitlement, getActiveFeaturePricing } from "./entitlements";

/** The account owner's name + email on file for an org - used to attribute renewal charges and send owner-facing notices. */
export async function getOwnerContact(organisationId: string): Promise<{ name: string | null; email: string } | undefined> {
  const [row] = await db
    .select({ name: users.name, email: users.email })
    .from(organisationMembers)
    .innerJoin(users, eq(organisationMembers.userId, users.id))
    .where(and(eq(organisationMembers.organisationId, organisationId), eq(organisationMembers.role, "owner")))
    .limit(1);
  return row?.email ? { name: row.name, email: row.email } : undefined;
}

async function getOwnerEmail(organisationId: string): Promise<string | undefined> {
  const owner = await getOwnerContact(organisationId);
  return owner?.email;
}

/**
 * Platform subscription billing (a business paying THIS app) is deliberately
 * kept separate from server/routes/payment.routes.ts, which handles a tenant
 * business collecting money FROM its own customers via per-store integration
 * credentials. Mixing the two would mean mixing tenant payment credentials
 * with platform billing credentials - a correctness/security risk.
 */

export function generatePaymentReference(organisationId: string): string {
  return `sub-${organisationId}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

export function planPrice(plan: Plan, billingCycle: "monthly" | "annual"): number {
  return Number(billingCycle === "annual" ? plan.priceAnnual : plan.priceMonthly);
}

export async function createPendingPayment(args: {
  organisationId: string;
  planId: string;
  provider: string;
  kind: "initial" | "renewal";
  amount: number;
  currency: string;
  billingCycle: string;
  subscriptionId?: string;
  initiatedByUserId?: string;
  featureKeys?: string[];
  // What this charge actually priced in, frozen at this moment - plans and
  // features can reprice later, but this payment's own record never should.
  // See shared/schema/organisations.ts's subscriptionPayments.planSnapshot.
  planSnapshot?: { name: string; price: number };
  featureBreakdown?: { key: string; name: string; price: number }[];
}) {
  const reference = generatePaymentReference(args.organisationId);
  const [payment] = await db
    .insert(subscriptionPayments)
    .values({
      organisationId: args.organisationId,
      planId: args.planId,
      subscriptionId: args.subscriptionId ?? null,
      provider: args.provider,
      kind: args.kind,
      reference,
      amount: args.amount,
      currency: args.currency,
      billingCycle: args.billingCycle,
      status: "pending",
      initiatedByUserId: args.initiatedByUserId ?? null,
      featureKeys: args.featureKeys && args.featureKeys.length > 0 ? args.featureKeys : null,
      planSnapshot: args.planSnapshot ?? null,
      featureBreakdown: args.featureBreakdown && args.featureBreakdown.length > 0 ? args.featureBreakdown : null,
    })
    .returning();
  return payment;
}

function computePeriodEnd(from: Date, billingCycle: string): Date {
  const end = new Date(from);
  if (billingCycle === "annual") {
    end.setFullYear(end.getFullYear() + 1);
  } else {
    end.setMonth(end.getMonth() + 1);
  }
  return end;
}

/**
 * Marks a payment successful and brings the subscription + organisation in
 * line with it. Idempotent - safe to call from both the client-side verify
 * endpoint (immediate UX right after checkout) and the webhook (source of
 * truth), which will often both fire for the same payment.
 */
export async function activateSuccessfulPayment(
  paymentId: string,
  paystackData: { authorization?: { authorization_code?: string }; customer?: { customer_code?: string } }
): Promise<void> {
  const [payment] = await db.select().from(subscriptionPayments).where(eq(subscriptionPayments.id, paymentId));
  if (!payment || payment.status === "success") return; // already handled

  const now = new Date();
  const authorizationCode = paystackData.authorization?.authorization_code;
  const providerCustomerId = paystackData.customer?.customer_code;

  const [existingSubscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organisationId, payment.organisationId));

  let subscriptionId: string;
  if (existingSubscription) {
    const [updated] = await db
      .update(subscriptions)
      .set({
        planId: payment.planId,
        status: "active",
        billingCycle: payment.billingCycle,
        currentPeriodStart: now,
        currentPeriodEnd: computePeriodEnd(now, payment.billingCycle),
        cancelAtPeriodEnd: false,
        provider: payment.provider,
        providerCustomerId: providerCustomerId ?? existingSubscription.providerCustomerId,
        providerAuthorizationCode: authorizationCode ?? existingSubscription.providerAuthorizationCode,
        renewalAttemptedAt: null,
        updatedAt: now,
      })
      .where(eq(subscriptions.id, existingSubscription.id))
      .returning();
    subscriptionId = updated.id;
  } else {
    const [created] = await db
      .insert(subscriptions)
      .values({
        organisationId: payment.organisationId,
        planId: payment.planId,
        status: "active",
        billingCycle: payment.billingCycle,
        currentPeriodStart: now,
        currentPeriodEnd: computePeriodEnd(now, payment.billingCycle),
        provider: payment.provider,
        providerCustomerId: providerCustomerId ?? null,
        providerAuthorizationCode: authorizationCode ?? null,
      })
      .returning();
    subscriptionId = created.id;
  }

  await db
    .update(subscriptionPayments)
    .set({ status: "success", providerResponse: paystackData, verifiedAt: now, subscriptionId })
    .where(eq(subscriptionPayments.id, paymentId));

  // Grant (or refresh) an entitlement for every add-on this charge covers -
  // one consolidated Paystack charge for base plan + add-ons together (§2.6
  // of the pay-per-feature plan). Idempotent, so the webhook/client-verify
  // double-fire this function already tolerates is safe here too.
  for (const featureKey of payment.featureKeys ?? []) {
    await grantFeatureEntitlement({
      organisationId: payment.organisationId,
      featureKey,
      source: "purchased",
      subscriptionPaymentId: paymentId,
    });
  }

  const [org] = await db.select().from(organisations).where(eq(organisations.id, payment.organisationId));
  if (org) {
    await db
      .update(organisations)
      .set({
        status: "active",
        // Only ever clear a non_payment suspension - never touch other suspension
        // reasons (fraud/ToS/etc), which still require an admin to lift.
        suspensionReason: org.suspensionReason === "non_payment" ? null : org.suspensionReason,
        updatedAt: now,
      })
      .where(eq(organisations.id, org.id));
  }
}

async function markPaymentFailed(paymentId: string, providerResponse: unknown): Promise<void> {
  await db
    .update(subscriptionPayments)
    .set({ status: "failed", providerResponse, verifiedAt: new Date() })
    .where(eq(subscriptionPayments.id, paymentId));
}

const RENEWAL_CLAIM_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Lazily attempts a renewal charge for a subscription whose period has
 * ended, the same "check on request instead of running a cron" philosophy
 * server/lib/trial.ts already uses for trial expiry. Call this fire-and-
 * forget (don't await) from request paths - it's not on the critical path
 * of any single request, the next request just sees the updated state.
 *
 * The renewalAttemptedAt claim is an atomic conditional UPDATE so concurrent
 * requests for the same org can't both win and double-charge the card.
 */
export async function maybeProcessDueRenewal(
  business: Pick<Organisation, "id" | "status">,
  subscription: Subscription | null | undefined
): Promise<void> {
  if (!subscription) return;
  if (subscription.status !== "active") return;
  if (subscription.cancelAtPeriodEnd) return;
  if (!subscription.providerAuthorizationCode) return;
  if (subscription.currentPeriodEnd > new Date()) return;

  const cooldownCutoff = new Date(Date.now() - RENEWAL_CLAIM_COOLDOWN_MS);
  const [claimed] = await db
    .update(subscriptions)
    .set({ renewalAttemptedAt: new Date() })
    .where(
      and(
        eq(subscriptions.id, subscription.id),
        or(isNull(subscriptions.renewalAttemptedAt), lt(subscriptions.renewalAttemptedAt, cooldownCutoff))
      )
    )
    .returning();
  if (!claimed) return; // another request already claimed this attempt

  const [plan] = await db.select().from(plans).where(eq(plans.id, claimed.planId));
  if (!plan) return;

  const [org] = await db.select().from(organisations).where(eq(organisations.id, business.id));
  if (!org) return;

  // Add-ons renew together with the base plan, on its cycle, in one charge -
  // never a separate billing date per feature (§2.6, decision 1).
  const cycle = claimed.billingCycle as "monthly" | "annual";
  const addOns = await getActiveFeaturePricing(claimed.organisationId, cycle);
  const amount = planPrice(plan, cycle) + addOns.reduce((sum, a) => sum + a.price, 0);
  const payment = await createPendingPayment({
    organisationId: claimed.organisationId,
    planId: claimed.planId,
    provider: claimed.provider || "paystack",
    kind: "renewal",
    amount,
    currency: plan.currency,
    billingCycle: claimed.billingCycle,
    subscriptionId: claimed.id,
    featureKeys: addOns.map((a) => a.featureKey),
    planSnapshot: { name: plan.name, price: planPrice(plan, cycle) },
    featureBreakdown: addOns.map((a) => ({ key: a.featureKey, name: a.name, price: a.price })),
  });

  try {
    const email = await getOwnerEmail(claimed.organisationId);
    if (!email) throw new Error("No billing email on file for this organisation.");

    const result = await chargeAuthorization({
      email,
      amountKobo: Math.round(amount * 100),
      reference: payment.reference,
      authorizationCode: claimed.providerAuthorizationCode!,
      currency: plan.currency,
    });

    if (result.success) {
      await activateSuccessfulPayment(payment.id, result.raw);
    } else {
      throw new Error(result.raw?.gateway_response || "Renewal charge was not successful.");
    }
  } catch (error) {
    await markPaymentFailed(payment.id, { error: error instanceof Error ? error.message : String(error) });
    await db
      .update(subscriptions)
      .set({ status: "past_due", updatedAt: new Date() })
      .where(eq(subscriptions.id, claimed.id));
    await db
      .update(organisations)
      .set({
        status: "suspended",
        suspensionReason: "non_payment",
        suspendedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(organisations.id, org.id));
    console.error(`[billing] Renewal charge failed for org ${claimed.organisationId}:`, error);
  }
}
