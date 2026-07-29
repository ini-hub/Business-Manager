import type { Express, Request, Response } from "express";
import { z } from "zod";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import { plans, subscriptions, subscriptionPayments } from "@shared/schema";
import { storage } from "../storage";
import {
  isPaystackConfigured,
  initializeTransaction,
  verifyTransaction,
  verifyWebhookSignature,
} from "../lib/paystack";
import { createPendingPayment, activateSuccessfulPayment, planPrice } from "../lib/billing";

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

  // ========== SUBSCRIBE (start checkout) ==========
  const subscribeSchema = z.object({
    planId: z.string(),
    billingCycle: z.enum(["monthly", "annual"]).default("monthly"),
    provider: z.enum(["paystack", "stripe", "flutterwave"]).default("paystack"),
  });

  app.post("/api/billing/subscribe", requireRole("owner"), async (req, res) => {
    try {
      const data = subscribeSchema.parse(req.body);
      const user = (req as any).user;

      if (data.provider !== "paystack") {
        throw new BillingNotConfiguredError(
          `${data.provider} isn't connected yet. Paystack is the only active payment channel right now.`
        );
      }
      if (!isPaystackConfigured()) {
        throw new BillingNotConfiguredError(
          "Payment processing isn't connected yet for this account. Please contact support to activate your subscription."
        );
      }

      const [plan] = await db.select().from(plans).where(eq(plans.id, data.planId));
      if (!plan || !plan.isActive) {
        return res.status(404).json({ error: "That plan is no longer available." });
      }

      let email = user.email as string | undefined;
      if (!email) {
        const fullUser = await storage.getUser(user.id);
        email = fullUser?.email ?? undefined;
      }
      if (!email) {
        return res.status(400).json({ error: "Add an email address to your account before subscribing." });
      }

      const amount = planPrice(plan, data.billingCycle);
      const payment = await createPendingPayment({
        organisationId: user.businessId,
        planId: plan.id,
        provider: "paystack",
        kind: "initial",
        amount,
        currency: plan.currency,
        billingCycle: data.billingCycle,
        initiatedByUserId: user.id,
      });

      try {
        const { authorizationUrl } = await initializeTransaction({
          email,
          amountKobo: Math.round(amount * 100),
          reference: payment.reference,
          callbackUrl: `${req.protocol}://${req.get("host")}/billing/callback`,
          currency: plan.currency,
          metadata: { organisationId: user.businessId, planId: plan.id, billingCycle: data.billingCycle },
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
      if (!verifyWebhookSignature(rawBody, signature)) {
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
