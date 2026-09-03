import type { Express, Request, Response } from "express";
import { z } from "zod";
import { db } from "../db";
import { eq, and, inArray, desc } from "drizzle-orm";
import { plans, subscriptions, subscriptionPayments } from "@shared/schema";
import { storage } from "../storage";
import {
  isPaystackConfigured,
  initializeTransaction,
  verifyTransaction,
  verifyWebhookSignature,
} from "../lib/paystack";
import { createPendingPayment, activateSuccessfulPayment, planPrice } from "../lib/billing";
import { getOrgEntitlements, getOrgPurchasedFeatures, validatePurchaseDependencies, scheduleFeatureRemoval, getFeatureByKey, getCountLimitStatus } from "../lib/entitlements";
import { featureCatalog } from "@shared/schema";

export type RouteMiddlewares = {
  isAuthenticated: any;
  requireRole: (...roles: any[]) => any;
  requireManagerOrOwner: any;
  checkStoreAccess: (storeId: string, req: Request, res: Response) => Promise<boolean>;
};

/**
 * Platform subscription billing is deliberately kept separate from
 * server/routes/payment.routes.ts, which handles a tenant business collecting
 * money FROM its own customers. This file handles the opposite direction: the
 * business paying THIS platform. Mixing the two would mean mixing tenant
 * payment credentials with platform billing credentials, which is a real
 * correctness/security risk, not just a style preference.
 *
 * Paystack is the first live channel. The provider dispatch below stays open
 * for stripe/flutterwave - adding one means a new lib/<provider>.ts client
 * plus a branch here and in maybeProcessDueRenewal, nothing else.
 */

class BillingNotConfiguredError extends Error {}

export function registerBillingRoutes(app: Express, { requireRole }: RouteMiddlewares): void {
  // ========== PLANS ==========
  // Deliberately public (no isAuthenticated) - the marketing landing page's
  // pricing section reads from here too, so pricing only ever needs updating
  // in one place (the plans table).
  app.get("/api/billing/plans", async (_req, res) => {
    try {
      const activePlans = await db.select().from(plans).where(eq(plans.isActive, true));
      res.json(activePlans);
    } catch (error) {
      console.error("GET /api/billing/plans error:", error);
      res.status(500).json({ error: "We couldn't load plans. Please try again." });
    }
  });

  // ========== FEATURE CATALOG (what a business can add on) ==========
  // Business-authenticated, not owner-only - a manager can browse what's
  // available even though only an owner can check out (UAC-2), same as
  // reading /api/billing/subscription today.
  app.get("/api/billing/feature-catalog", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user?.businessId) return res.status(401).json({ error: "Authentication required." });
      const list = await db.select().from(featureCatalog).where(eq(featureCatalog.isActive, true)).orderBy(featureCatalog.sortOrder);
      res.json(list);
    } catch (error) {
      console.error("GET /api/billing/feature-catalog error:", error);
      res.status(500).json({ error: "We couldn't load available add-ons. Please try again." });
    }
  });

  // ========== CURRENT SUBSCRIPTION ==========
  app.get("/api/billing/subscription", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user?.businessId) return res.status(401).json({ error: "Authentication required." });

      const [subscription] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.organisationId, user.businessId));

      res.json(subscription || null);
    } catch (error) {
      console.error("GET /api/billing/subscription error:", error);
      res.status(500).json({ error: "We couldn't load your subscription. Please try again." });
    }
  });

  // ========== PAYMENT HISTORY (business-end billing review, New-FAC-6) ==========
  // Read-only, business-authenticated (not owner-only) - a manager can audit
  // spend without needing to touch checkout, same access level as reading
  // /api/entitlements and /api/billing/subscription today.
  app.get("/api/billing/payments", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user?.businessId) return res.status(401).json({ error: "Authentication required." });

      const payments = await db
        .select()
        .from(subscriptionPayments)
        .where(eq(subscriptionPayments.organisationId, user.businessId))
        .orderBy(desc(subscriptionPayments.createdAt));

      res.json(payments);
    } catch (error) {
      console.error("GET /api/billing/payments error:", error);
      res.status(500).json({ error: "We couldn't load your payment history. Please try again." });
    }
  });

  // ========== SUBSCRIBE (start checkout) ==========
  // featureKeys rides on the same checkout as the base plan (§2.6, decision
  // 1: consolidated billing) - one Paystack charge for base + every selected
  // add-on, never a second checkout flow for add-ons (FAC-4).
  //
  // planId is optional: the app no longer asks anyone to choose a plan tier
  // (requirements plan §4) - the feature catalog is the only checkout
  // surface now, so an omitted planId resolves to the one implicit ₦0
  // "default" plan server-side, purely to satisfy subscriptions.planId's FK.
  const subscribeSchema = z.object({
    planId: z.string().optional(),
    billingCycle: z.enum(["monthly", "annual"]).default("monthly"),
    provider: z.enum(["paystack", "stripe", "flutterwave"]).default("paystack"),
    featureKeys: z.array(z.string()).optional().default([]),
    // Where to send the user back to after Paystack, success or failure -
    // see billing-callback.tsx. Validated below: must be a same-origin
    // relative path, never an absolute/protocol-relative URL (open-redirect
    // risk riding on a payment callback).
    returnTo: z.string().optional(),
  });

  function sanitizeReturnTo(returnTo: string | undefined): string | undefined {
    if (!returnTo) return undefined;
    if (!returnTo.startsWith("/")) return undefined;
    if (returnTo.startsWith("//")) return undefined;
    if (returnTo.includes("://")) return undefined;
    return returnTo;
  }

  app.post("/api/billing/subscribe", requireRole("owner"), async (req, res) => {
    try {
      const data = subscribeSchema.parse(req.body);
      const user = (req as any).user;

      if (data.provider !== "paystack") {
        throw new BillingNotConfiguredError(
          `${data.provider} isn't connected yet. Paystack is the only active payment channel right now.`
        );
      }
      if (!(await isPaystackConfigured())) {
        throw new BillingNotConfiguredError(
          "Payment processing isn't connected yet for this account. Please contact support to activate your subscription."
        );
      }

      const [plan] = data.planId
        ? await db.select().from(plans).where(eq(plans.id, data.planId))
        : await db.select().from(plans).where(eq(plans.isDefault, true));
      if (!plan || !plan.isActive) {
        return res.status(404).json({ error: data.planId ? "That plan is no longer available." : "No default plan is configured. Please contact support." });
      }

      let email = user.email as string | undefined;
      if (!email) {
        const fullUser = await storage.getUser(user.id);
        email = fullUser?.email ?? undefined;
      }
      if (!email) {
        return res.status(400).json({ error: "Add an email address to your account before subscribing." });
      }

      let addOnTotal = 0;
      const featureBreakdown: { key: string; name: string; price: number }[] = [];
      if (data.featureKeys.length > 0) {
        const depsCheck = await validatePurchaseDependencies(user.businessId, data.featureKeys);
        if (!depsCheck.ok) return res.status(400).json({ error: depsCheck.message });

        const rows = await db.select().from(featureCatalog).where(inArray(featureCatalog.key, data.featureKeys));
        if (rows.length !== data.featureKeys.length) {
          return res.status(404).json({ error: "One or more selected features are no longer available." });
        }
        for (const row of rows) {
          if (row.tierType === "bundle_child") {
            return res.status(400).json({ error: `"${row.name}" is only available as part of its bundle - purchase the bundle instead.` });
          }
          if (!row.isActive) return res.status(404).json({ error: `"${row.name}" isn't available for purchase right now.` });
          const price = Number(data.billingCycle === "annual" ? row.priceAnnual : row.priceMonthly) || 0;
          addOnTotal += price;
          featureBreakdown.push({ key: row.key, name: row.name, price });
        }
      }

      const amount = planPrice(plan, data.billingCycle) + addOnTotal;
      const payment = await createPendingPayment({
        organisationId: user.businessId,
        planId: plan.id,
        provider: "paystack",
        kind: "initial",
        amount,
        currency: plan.currency,
        billingCycle: data.billingCycle,
        initiatedByUserId: user.id,
        featureKeys: data.featureKeys,
        planSnapshot: { name: plan.name, price: planPrice(plan, data.billingCycle) },
        featureBreakdown,
      });

      try {
        const returnTo = sanitizeReturnTo(data.returnTo);
        const callbackUrl = `${req.protocol}://${req.get("host")}/billing/callback${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`;
        const { authorizationUrl } = await initializeTransaction({
          email,
          amountKobo: Math.round(amount * 100),
          reference: payment.reference,
          callbackUrl,
          currency: plan.currency,
          metadata: { organisationId: user.businessId, planId: plan.id, billingCycle: data.billingCycle, featureKeys: data.featureKeys },
        });
        res.json({ authorizationUrl, reference: payment.reference });
      } catch (providerError) {
        await db
          .update(subscriptionPayments)
          .set({ status: "failed", providerResponse: { error: String(providerError) } })
          .where(eq(subscriptionPayments.id, payment.id));
        throw providerError;
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors.map(e => e.message).join(", ") });
      }
      if (error instanceof BillingNotConfiguredError) {
        return res.status(501).json({ error: error.message });
      }
      console.error("POST /api/billing/subscribe error:", error);
      res.status(500).json({ error: "We couldn't start checkout. Please try again." });
    }
  });

  // ========== VERIFY (client lands here right after Paystack checkout) ==========
  app.get("/api/billing/verify", requireRole("owner"), async (req, res) => {
    try {
      const user = (req as any).user;
      const reference = String(req.query.reference || "");
      if (!reference) return res.status(400).json({ error: "Missing payment reference." });

      const [payment] = await db
        .select()
        .from(subscriptionPayments)
        .where(and(eq(subscriptionPayments.reference, reference), eq(subscriptionPayments.organisationId, user.businessId)));
      if (!payment) return res.status(404).json({ error: "We couldn't find that payment." });

      if (payment.status !== "success") {
        const result = await verifyTransaction(reference);
        if (result.success) {
          await activateSuccessfulPayment(payment.id, result.raw);
        } else {
          await db
            .update(subscriptionPayments)
            .set({ status: "failed", providerResponse: result.raw, verifiedAt: new Date() })
            .where(eq(subscriptionPayments.id, payment.id));
        }
      }

      const [refreshedPayment] = await db.select().from(subscriptionPayments).where(eq(subscriptionPayments.id, payment.id));
      const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.organisationId, user.businessId));
      res.json({ status: refreshedPayment.status, subscription: subscription || null });
    } catch (error) {
      console.error("GET /api/billing/verify error:", error);
      res.status(500).json({ error: "We couldn't confirm your payment. Please contact support." });
    }
  });

  // ========== ENTITLEMENTS (which features + limits this org has) ==========
  // Sibling of /subscription rather than its own route file - entitlements
  // are a billing concern (§2.4). Drives client/src/hooks/useEntitlements.ts.
  app.get("/api/entitlements", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user?.businessId) return res.status(401).json({ error: "Authentication required." });

      const [granted, purchased, staffSeats, customerCount, storeCount] = await Promise.all([
        getOrgEntitlements(user.businessId),
        getOrgPurchasedFeatures(user.businessId),
        getCountLimitStatus(user.businessId, "staff_seats"),
        getCountLimitStatus(user.businessId, "customer_count"),
        getCountLimitStatus(user.businessId, "store_count"),
      ]);

      res.json({
        features: Array.from(granted),
        // Subset of `features` that's actually been purchased (or is free),
        // never inflated by the trial blanket grant - see getOrgPurchasedFeatures.
        purchasedFeatures: Array.from(purchased),
        limits: { staff_seats: staffSeats, customer_count: customerCount, store_count: storeCount },
      });
    } catch (error) {
      console.error("GET /api/entitlements error:", error);
      res.status(500).json({ error: "We couldn't load your plan's features. Please try again." });
    }
  });

  // ========== REMOVE A FEATURE (owner-initiated downgrade) ==========
  // Mirrors /cancel below: stays usable through the current paid cycle
  // (FAC-8), not an instant cutoff.
  app.post("/api/billing/features/:featureKey/remove", requireRole("owner"), async (req, res) => {
    try {
      const user = (req as any).user;
      const feature = await getFeatureByKey(req.params.featureKey);
      if (!feature) return res.status(404).json({ error: "Unknown feature." });

      const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.organisationId, user.businessId));
      const removalEffectiveAt = subscription?.currentPeriodEnd ?? new Date();

      const outcome = await scheduleFeatureRemoval(user.businessId, req.params.featureKey, removalEffectiveAt);
      if (!outcome.ok) return res.status(400).json({ error: outcome.message });

      res.json({ success: true, featureKey: req.params.featureKey, usableUntil: removalEffectiveAt });
    } catch (error) {
      console.error("POST /api/billing/features/:featureKey/remove error:", error);
      res.status(500).json({ error: "We couldn't remove this feature. Please try again." });
    }
  });

  // ========== CANCEL ==========
  app.post("/api/billing/cancel", requireRole("owner"), async (req, res) => {
    try {
      const user = (req as any).user;
      const [subscription] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.organisationId, user.businessId));

      if (!subscription) {
        return res.status(400).json({ error: "There's no active subscription to cancel." });
      }

      const [updated] = await db
        .update(subscriptions)
        .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
        .where(eq(subscriptions.id, subscription.id))
        .returning();

      res.json(updated);
    } catch (error) {
      console.error("POST /api/billing/cancel error:", error);
      res.status(500).json({ error: "We couldn't cancel your subscription. Please try again." });
    }
  });

  // ========== PROVIDER WEBHOOK ==========
  app.post("/api/billing/webhook/:provider", async (req, res) => {
    const provider = req.params.provider;
    if (provider !== "paystack") {
      // No other provider is configured yet - ack so the sender doesn't retry forever.
      return res.status(200).json({ received: true });
    }

    try {
      const signature = req.headers["x-paystack-signature"] as string | undefined;
      const rawBody = (req as any).rawBody as Buffer;
      if (!(await verifyWebhookSignature(rawBody, signature))) {
        console.warn("[Billing webhook] Invalid Paystack signature - rejecting.");
        return res.status(401).json({ error: "Invalid signature" });
      }

      const { event, data } = req.body;
      if (event === "charge.success" && data?.reference) {
        const [payment] = await db
          .select()
          .from(subscriptionPayments)
          .where(eq(subscriptionPayments.reference, data.reference));
        if (payment && payment.status !== "success") {
          await activateSuccessfulPayment(payment.id, data);
        }
      }

      res.status(200).json({ received: true });
    } catch (error) {
      console.error("[Billing webhook] processing error:", error);
      // Still 200 - Paystack retries on non-2xx, and the client-side /verify
      // call is a second, independent path to the same activation logic.
      res.status(200).json({ received: true });
    }
  });
}
