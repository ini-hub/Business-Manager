import type { Express, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import { isAuthenticated } from "../auth";
import {
  insertBusinessSchema,
  insertStoreSchema,
  insertCustomerSchema,
  insertStaffSchema,
  insertInventorySchema,
  insertPromotionSchema,
  insertCustomRoleSchema,
  insertStoreIntegrationSchema,
  insertExpenseSchema,
  type UserRole,
  orders,
  checkouts,
  promotions,
  transactions,
  customers,
  inventory,
  staff,
  customRoles,
  taxRates,
  repayments,
  expenses,
  cashDrops,
  creditEntries,
  cashRegisterSessions,
} from "@shared/schema";
import { z } from "zod";
import { db } from "../db";
import { eq, and, gte, lte, gt, count, desc } from "drizzle-orm";
import { sanitizeString, sanitizeUUID, sanitizeNumber, sanitizeBoolean, sanitizePhoneNumber, sanitizeStoreCode } from "../sanitize";
import { auditLogger } from "../audit";
import { bulkUploadService } from "../services/BulkUploadService";
import { analyticsService } from "../services/AnalyticsService";
import { getUserId, getClientIp, formatZodErrors, checkBusinessAccess, getUserStores, verifyStoreAccess, verifyRecordStoreAccess, triggerAutoRecalculate } from './helpers';

export type RouteMiddlewares = {
  isAuthenticated: any;
  requireRole: (...roles: any[]) => any;
  requireManagerOrOwner: any;
  checkStoreAccess: (storeId: string, req: Request, res: Response) => Promise<boolean>;
};

export function registerPaymentRoutes(app: Express, { isAuthenticated, requireRole, requireManagerOrOwner, checkStoreAccess }: RouteMiddlewares): void {
  // ========== DYNAMIC MULTI-TENANT PAYMENT STRATEGY ROUTER ==========
  const paymentLinkSchema = z.object({
    storeId: z.string(),
    customerEmail: z.string().email(),
    customerName: z.string(),
    customerPhone: z.string().optional(),
    amount: z.number().positive(),
    currency: z.string().default("NGN"),
    description: z.string(),
    redirectUrl: z.string().url().optional(),
    provider: z.enum(["flutterwave", "stripe", "paystack"]).default("flutterwave"),
  });

  app.post("/api/payments/create-link", async (req, res) => {
    try {
      const data = paymentLinkSchema.parse(req.body);
      const storeId = data.storeId;

      // 1. Fetch the merchant's custom store integration credentials from DB
      const integration = await storage.getStoreIntegrationByProvider(storeId, data.provider);
      if (!integration || !integration.isActive || !integration.secretKey) {
        return res.status(400).json({
          error: `${data.provider.toUpperCase()} payment gateway is not active or configured for this store. Please complete setups in settings.`
        });
      }

      const checkoutSuffix = req.body.checkoutId ? `-checkout-${req.body.checkoutId}` : "";
      const txRef = `tx-${storeId}${checkoutSuffix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const secretKey = integration.secretKey;

      // 2. Offline Sandbox Simulation for Developers and Testing
      if (secretKey.startsWith("FLWSECK_TEST") || secretKey.startsWith("sk_test_stripe") || secretKey.startsWith("sk_test_paystack")) {
        return res.json({
          success: true,
          paymentLink: `https://checkout.sandbox.com/pay/${data.provider}/${txRef}`,
          txRef
        });
      }

      // 3. Strategy Router based on Selected Payment Provider
      if (data.provider === "flutterwave") {
        const response = await fetch("https://api.flutterwave.com/v3/payments", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${secretKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tx_ref: txRef,
            amount: data.amount,
            currency: data.currency,
            redirect_url: data.redirectUrl || `${req.protocol}://${req.get('host')}/payment-complete`,
            customer: {
              email: data.customerEmail,
              name: data.customerName,
              phonenumber: data.customerPhone,
            },
            customizations: {
              title: "Business Payment",
              description: data.description,
            },
          }),
        });

        const result = await response.json();
        if (result.status === "success") {
          return res.json({ success: true, paymentLink: result.data.link, txRef });
        } else {
          return res.status(400).json({ error: result.message || "Failed to generate Flutterwave checkout link." });
        }
      } 
      
      else if (data.provider === "stripe") {
        const params = new URLSearchParams();
        params.append("payment_method_types[0]", "card");
        params.append("line_items[0][price_data][currency]", data.currency.toLowerCase());
        params.append("line_items[0][price_data][product_data][name]", data.description);
        params.append("line_items[0][price_data][unit_amount]", Math.round(data.amount * 100).toString()); // in Cents
        params.append("line_items[0][quantity]", "1");
        params.append("mode", "payment");
        params.append("success_url", data.redirectUrl || `${req.protocol}://${req.get('host')}/payment-complete?ref=${txRef}`);
        params.append("customer_email", data.customerEmail);
        params.append("client_reference_id", txRef);

        const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${secretKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params.toString(),
        });

        const result = await response.json();
        if (result.url) {
          return res.json({ success: true, paymentLink: result.url, txRef });
        } else {
          return res.status(400).json({ error: result.error?.message || "Failed to generate Stripe checkout session." });
        }
      } 
      
      else if (data.provider === "paystack") {
        const response = await fetch("https://api.paystack.co/transaction/initialize", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${secretKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: data.customerEmail,
            amount: Math.round(data.amount * 100), // in Kobo
            reference: txRef,
            callback_url: data.redirectUrl || `${req.protocol}://${req.get('host')}/payment-complete`,
            currency: data.currency,
          }),
        });

        const result = await response.json();
        if (result.status) {
          return res.json({ success: true, paymentLink: result.data.authorization_url, txRef });
        } else {
          return res.status(400).json({ error: result.message || "Failed to initialize Paystack transaction." });
        }
      }

      res.status(400).json({ error: "Unsupported payment provider." });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      console.error("Payment Link Generation error:", error);
      res.status(500).json({ error: "Failed to generate payment link. Please try again." });
    }
  });

  app.post("/api/payments/webhook/:provider", async (req, res) => {
    try {
      const provider = req.params.provider;
      let txRef = "";
      let amount = 0;
      let email = "unknown";
      let isSuccess = false;
      let storeId = "";

      if (provider === "flutterwave") {
        const { event, data } = req.body;
        txRef = data?.tx_ref || "";
        
        if (txRef && txRef.startsWith("tx-")) {
          storeId = txRef.split("-")[1];
        }

        if (storeId) {
          const integration = await storage.getStoreIntegrationByProvider(storeId, "flutterwave");
          const signature = req.headers["verif-hash"];
          const webhookSecret = integration?.webhookSecret || "";

          if (webhookSecret && signature !== webhookSecret) {
            auditLogger.logSecurityEvent("flutterwave_webhook_invalid_signature", undefined, getClientIp(req), { signature });
            return res.status(401).json({ error: "Invalid signature" });
          }
        }

        if (event === "charge.completed" && data.status === "successful") {
          amount = data.amount;
          email = data.customer?.email || "unknown";
          isSuccess = true;
        }
      } 
      
      else if (provider === "stripe") {
        const { type, data } = req.body;
        const session = data?.object;
        txRef = session?.client_reference_id || "";
        
        if (txRef && txRef.startsWith("tx-")) {
          storeId = txRef.split("-")[1];
        }

        if (type === "checkout.session.completed") {
          amount = (session.amount_total || 0) / 100;
          email = session.customer_details?.email || "unknown";
          isSuccess = true;
        }
      } 
      
      else if (provider === "paystack") {
        const { event, data } = req.body;
        txRef = data?.reference || "";

        if (txRef && txRef.startsWith("tx-")) {
          storeId = txRef.split("-")[1];
        }

        if (storeId) {
          const integration = await storage.getStoreIntegrationByProvider(storeId, "paystack");
          const signature = req.headers["x-paystack-signature"];
          const secretKey = integration?.secretKey || "";
          
          if (secretKey) {
            const crypto = require("crypto");
            const hash = crypto.createHmac("sha512", secretKey).update(JSON.stringify(req.body)).digest("hex");
            if (signature !== hash) {
              auditLogger.logSecurityEvent("paystack_webhook_invalid_signature", undefined, getClientIp(req), { signature });
              return res.status(401).json({ error: "Invalid signature" });
            }
          }
        }

        if (event === "charge.success") {
          amount = (data.amount || 0) / 100;
          email = data.customer?.email || "unknown";
          isSuccess = true;
        }
      }

      if (isSuccess && txRef) {
        auditLogger.logPayment(txRef, email, amount, provider, "success");

        if (txRef.includes("-checkout-")) {
          const checkoutId = txRef.split("-checkout-")[1]?.split("-")[0];
          if (checkoutId) {
            await storage.updateCheckoutPaymentStatus(checkoutId, "completed");
          }
        }
      }

      res.status(200).json({ received: true });
    } catch (error) {
      console.error("Webhook processing error:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

}
