import { checkCatalogHealth } from "./lib/entitlements";
import { checkStoreAccessHelper, getClientIp, formatZodErrors } from "./routes/helpers";
import type { Express, Request, Response, NextFunction } from "express";
import { type Server } from "http";
import crypto from "crypto";
import { storage } from "./storage";
import { enforceFeaturePolicy } from "./lib/featurePolicy";
import { setupAuth, verifyToken, isAuthenticated, enforceOrgAccess, generateOrgSelectToken, verifyOrgSelectToken, generateLegalConsentPendingToken } from "./auth";
import { issueSession, revokeSession, revokeAllUserSessions } from "./lib/authSessions";
import { legalDocumentService } from "./services/LegalDocumentService";
import { completeLoginForUser, completeStaffActivation } from "./lib/authFlow";
import { registerContractRoutes } from "./routes/contract.routes";
import { registerProfileCompletionRoutes } from "./routes/profile-completion.routes";
import { registerGuarantorRoutes } from "./routes/guarantor.routes";
import { registerLegalRoutes } from "./routes/legal.routes";
import { registerEmailWebhookRoutes } from "./routes/email-webhooks.routes";
import { registerWhatsAppWebhookRoutes } from "./routes/whatsapp-webhooks.routes";
import { registerCustomerBookingRoutes } from "./routes/customer-booking.routes";
import { registerBroadcastRoutes } from "./routes/broadcast.routes";
import { registerAccountingRoutes } from "./routes/accounting.routes";
import { registerWhatsAppNumberRoutes } from "./routes/whatsapp-number.routes";
import { registerWhatsAppTemplateRoutes } from "./routes/whatsapp-template.routes";
import { setupAdminAuth } from "./auth-admin";
import { adminRouter } from "./routes-admin";
import {
  sendActivationEmail, sendOtpEmail,
  sendPasswordChangedEmail,
  sendAccountLockedEmail,
  sendSMS,
  sendEmailVerificationOtpEmail
} from "./email";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { parseCookies } from "./lib/cookies";
import bcrypt from "bcrypt";
import {
  signupSchema,
  loginSchema, resetPasswordSchema,
  passwordSchema,
  type UserRole
} from "@shared/schema";
import { z } from "zod";
import { normalizePhoneForStorage } from "@shared/phone-utils";
import { isUniqueViolation, getViolatedConstraint } from "./db-errors";
import { auditLogger } from "./audit";
import { computeTrialEndsAt } from "./lib/trial";
import { getConfiguredTrialDays, getSmsConfig, getExportBranding } from "./lib/platformConfig";
import { logFunnelEvent } from "./lib/funnel";
import { checkResendCooldown, checkSubmittedOtp, resendWaitSeconds, MAX_OTP_ATTEMPTS, OTP_TTL_MS, OTP_RESEND_MIN_GAP_MS } from "./lib/otp-cooldown";
import { generateActivationCode, activationCodeExpiry, normalizeActivationCode } from "./lib/activation-code";
import { isManagerEmailChangePending } from "./lib/email-change-gate";
import { checkSignupEmailChange } from "./lib/signup-email-change";
import { initWebSocketServer, broadcastDataChange } from "./websocket";
import { RouterRegistry } from "./controllers/RouterRegistry";
import { AuthController } from "./controllers/AuthController";
import { InventoryController } from "./controllers/InventoryController";
import { ProductController } from "./controllers/ProductController";
import { BookingController } from "./controllers/BookingController";
import { CreditController } from "./controllers/CreditController";
import { registerBusinessRoutes } from "./routes/business.routes";
import { registerCustomerRoutes } from "./routes/customer.routes";
import { registerStaffRoutes } from "./routes/staff.routes";
import { registerHrRoutes } from "./routes/hr.routes";
import { adminHrRouter } from "./routes/admin-hr.routes";
import { registerInventoryRoutes } from "./routes/inventory.routes";
import { registerInventoryDraftRoutes } from "./routes/inventory-drafts.routes";
import { registerStockTransferDraftRoutes } from "./routes/stock-transfer-drafts.routes";
import { registerConsumablesRoutes } from "./routes/consumables.routes";
import { registerTransactionRoutes } from "./routes/transaction.routes";
import { registerSalesRoutes } from "./routes/sales.routes";
import { registerGamificationRoutes } from "./routes/gamification.routes";
import { registerSettingsRoutes } from "./routes/settings.routes";
import { registerPayrollRoutes } from "./routes/payroll.routes";
import { registerReportsRoutes } from "./routes/reports.routes";
import { registerVendorRoutes } from "./routes/vendor.routes";
import { registerPartnerRoutes } from "./routes/partner.routes";
import { registerPaymentRoutes } from "./routes/payment.routes";
import { registerBillingRoutes } from "./routes/billing.routes";
import { registerSupportRoutes } from "./routes/support.routes";
import { registerCashRoutes } from "./routes/cash.routes";
import { registerPaymentAccountRoutes } from "./routes/payment-accounts.routes";
import { registerBankConnectionRoutes } from "./routes/bank-connections.routes";
import { registerAuditLogRoutes } from "./routes/audit-logs.routes";
import { registerAnalyticsRoutes } from "./routes/analytics.routes";
import { registerAnalyticsViewRoutes } from "./routes/analytics-views.routes";
import { assertBindingsComplete } from "./analytics/sql";

const SALT_ROUNDS = 12;

function getUserAgent(req: Request): string {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" ? ua : "unknown";
}

// Rate limiting. Many users can share one egress IP (corporate proxies such as Netskope, office NAT,
// mobile carrier NAT), so an authenticated caller is bucketed by user, not by IP. The limiters run
// before the auth middleware, so the key reads the JWT itself. A forged or expired token fails
// verifyToken and falls back to the IP bucket, so it cannot be used to dodge the limit.
function limiterKey(req: Request): string {
  const token = parseCookies(req.headers.cookie).jwt_token || req.headers["authorization"]?.replace("Bearer ", "");
  const claims = token ? verifyToken(token) : undefined;
  if (claims?.userId) return `u:${claims.userId}`;
  return `ip:${ipKeyGenerator(req.ip ?? "")}`;
}

const apiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 500, // 500 requests per 10 min per user (per IP when unauthenticated)
  keyGenerator: limiterKey,
  message: { error: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limiting for auth endpoints. Unauthenticated attempts are bucketed by IP + email, so
// one office sharing an IP does not lock itself out, while a single account still cannot be hammered.
const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 auth attempts per minute per user, or per IP + email
  keyGenerator: (req) => {
    const key = limiterKey(req);
    if (key.startsWith("u:")) return key;
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase().slice(0, 254) : "";
    return email ? `${key}|${email}` : key;
  },
  message: { error: "Too many login attempts, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Backstop for the per-email bucket above: credential stuffing rotates emails from one IP, so cap the
// unauthenticated auth volume per IP too, well above what a shared office needs.
const authIpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
  skip: (req) => limiterKey(req).startsWith("u:"),
  message: { error: "Too many login attempts, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Initialize WebSocket server for live push notifications
  initWebSocketServer(httpServer);

  // Apply rate limiting to all API routes
  app.use("/api/", apiLimiter);

  // Apply stricter rate limiting to auth endpoints
  app.use("/api/auth", authIpLimiter, authLimiter);

  // Setup authentication
  await setupAuth(app);
  await setupAdminAuth(app);

  // Mount Admin Router
  app.use("/api/admin", adminRouter);
  app.use("/api/admin", adminHrRouter);

  // Health check endpoint (no auth required, used by hosting providers)
  // A hosting health probe must not restart-loop over bad seed data, so an
  // empty catalog reports "degraded" with a 200 rather than failing the check.
  app.get("/api/health", async (_req, res) => {
    const catalog = await checkCatalogHealth().catch(() => ({ ok: false, activeFeatures: 0 }));
    res.json({
      status: catalog.ok ? "ok" : "degraded",
      catalog,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // Blocks API access for suspended/trial-expired orgs, not just the SPA
  // shell's paywall screen — see server/auth.ts for the exempt paths.
  app.use("/api", enforceOrgAccess);
  // Deny-by-default paid-feature gate (see server/lib/featurePolicy.ts). Count caps
  // (staff/customers/stores) are enforced in the storage layer instead.
  app.use("/api", enforceFeaturePolicy);

  // Initialize dynamic OOP Router Registry
  const registry = new RouterRegistry([
    new AuthController(),
    new InventoryController(),
    new ProductController(),
    new BookingController(),
    new CreditController(),
  ]);
  app.use("/api", registry.registerAll());

  // ========== MULTI-TENANCY HELPERS ==========
  function checkStoreAccess(storeId: string, req: Request, res: Response): Promise<boolean> {
    return checkStoreAccessHelper(storeId, req, res);
  }





  // ========== CUSTOM AUTH ROUTES ==========

  const LOCKOUT_TIME_MS = 30 * 60 * 1000;
  const LOCKOUT_MAX_MS = 24 * 60 * 60 * 1000; // escalation cap
  const MAX_LOGIN_ATTEMPTS = 5;

  // Escalating lockout duration: 30m, 1h, 2h, 4h, ... capped at 24h.
  function nextLockoutDurationMs(priorLockoutCount: number): number {
    return Math.min(LOCKOUT_TIME_MS * Math.pow(2, priorLockoutCount), LOCKOUT_MAX_MS);
  }

  // Single Entry point continue route
  app.post("/api/auth/continue", async (req: Request, res: Response) => {
    try {
      const { emailOrPhone } = req.body;
      if (!emailOrPhone) {
        return res.status(400).json({ error: "Email or phone number is required." });
      }

      const user = await storage.getUserByIdentifier(emailOrPhone);
      if (!user) {
        return res.json({ status: "not_found" });
      }

      // Check lockout status
      if (user.lockedUntil && new Date() < new Date(user.lockedUntil)) {
        const remainingMinutes = Math.ceil((new Date(user.lockedUntil).getTime() - Date.now()) / 60000);
        return res.status(423).json({
          status: "locked",
          error: `Account is locked. Try again in ${remainingMinutes} minutes.`,
          lockedUntil: user.lockedUntil,
        });
      }

      const members = await storage.getOrganisationsByUserId(user.id);
      const isPending = members.some(m => m.status === "pending");
      const isPartial = members.some(m => m.status === "partial");

      // 1. If invited staff in partial status (code verified but password not yet set) -> direct to set password
      if (isPartial) {
        return res.json({
          status: "create_password_required",
          email: user.email,
          phone: user.phone,
          name: user.name,
          message: "You have already verified your activation code. Please create your password to continue."
        });
      }

      // 2. If invited staff (status pending or code not yet used) -> show activation screen without auto-generating/sending code
      if (isPending || (user.createdByInvitation && !user.activationCodeUsed)) {
        return res.json({
          status: "pending_activation",
          email: user.email,
          phone: user.phone,
          message: "Please enter your activation code.",
        });
      }

      // A manager changed this account's email and it has not been confirmed
      // yet. Checked before the generic unverified-email branch below, which
      // would otherwise send a signup-style OTP down a path whose verify
      // endpoint hands out a session.
      if (isManagerEmailChangePending(user)) {
        return res.json({ status: "email_change_verification_required", email: user.email });
      }

      // 3. If the account has no verified contact channel at all -> send OTP
      // and require email OTP verification. This must NOT be scoped to "only
      // when logging in with the email identifier" - phone is optional and
      // never verified at signup, so gating on the identifier used would let
      // an account log in indefinitely via phone while its (possibly
      // unowned) email is never verified.
      const hasVerifiedPhone = !!(user.phone && user.isPhoneVerified);
      if (user.email && !user.isEmailVerified && !hasVerifiedPhone && !user.createdByInvitation) {
        // Only mint + send a fresh OTP if we're not on cooldown - repeatedly
        // hitting /continue must not be a way to bypass the resend-otp rate
        // limit. If on cooldown, fall through with whatever code is already
        // pending (the user can use "Resend" once the cooldown clears).
        // A code that is still live (unexpired, not locked) is reused: logging in
        // again before activating must not mail another one. Only an expired or
        // locked code is replaced.
        const cooldown = checkResendCooldown(user.otpResendAttempts, user.otpResendWindowStart);
        const hasLiveOtp = !!user.otpCode && !!user.otpExpiry &&
          new Date(user.otpExpiry).getTime() > Date.now() &&
          (user.otpAttempts ?? 0) < MAX_OTP_ATTEMPTS;
        if (cooldown.allowed && !hasLiveOtp) {
          const otpCode = crypto.randomInt(100000, 1000000).toString();
          const otpExpiry = new Date(Date.now() + OTP_TTL_MS);
          await storage.updateUser(user.id, {
            otpCode,
            otpExpiry,
            otpAttempts: 0,
            otpResendAttempts: cooldown.nextAttempts,
            otpResendWindowStart: cooldown.nextWindowStart,
          });

          await sendEmailVerificationOtpEmail(user.email, user.name || user.email, otpCode);
        }

        return res.json({
          status: "email_verification_required",
          email: user.email,
        });
      }

      // 4. Default: Account is active, has password set -> prompt password
      return res.json({
        status: "password_required",
        email: user.email,
        phone: user.phone,
      });
    } catch (error) {
      console.error("Continue endpoint error:", error);
      res.status(500).json({ error: "Could not proceed. Please try again." });
    }
  });

  // Signup - Create business/organisation and user account
  app.post("/api/auth/signup", async (req: Request, res: Response) => {
    try {
      const data = signupSchema.parse(req.body);
      const normalizedEmail = data.email.toLowerCase();

      // Fail fast, before creating anything, if the legal documents the
      // client actually rendered/checked don't exactly match what's current
      // right now - a super admin archiving, reactivating, or adding a
      // section between this form loading and being submitted must never
      // result in recording acceptance of something the user never saw (or
      // silently skipping something newly required). See
      // LegalDocumentService.recordAcceptance for the full rationale; this
      // is the same check run again there as a second guard.
      const currentDocumentTypesAtSubmit = await legalDocumentService.getCurrentDocumentTypes();
      const providedDocumentTypes = Array.from(new Set(data.acceptedDocumentTypes)).sort();
      const legalDocumentsCurrent = providedDocumentTypes.length === currentDocumentTypesAtSubmit.length
        && providedDocumentTypes.every((t, i) => t === currentDocumentTypesAtSubmit[i]);
      if (!legalDocumentsCurrent) {
        return res.status(409).json({
          error: {
            message: "Our legal documents changed while you were filling this out. Please refresh the page and accept the current versions to continue.",
            code: "LEGAL_DOCUMENTS_STALE",
          },
        });
      }

      // Check if email already exists
      const existingUser = await storage.getUserByIdentifier(normalizedEmail);
      if (existingUser) {
        return res.status(400).json({ error: "This email address is already registered. Please use a different email or log in." });
      }

      // Check if phone already exists - normalize first so this matches
      // what will actually be stored below.
      let normalizedPhone: string | undefined;
      if (data.phone) {
        normalizedPhone = normalizePhoneForStorage(data.phone, data.phoneCountryCode);
        const existingPhoneUser = await storage.getUserByIdentifier(normalizedPhone);
        if (existingPhoneUser) {
          return res.status(400).json({ error: "This phone number is already registered. Please use a different number or log in." });
        }
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(data.password, SALT_ROUNDS);

      // Create organisation - starts a free trial immediately, no card required.
      // Trial length is admin-configurable (Super Admin > Platform Settings);
      // this only affects new signups, never recalculated for an org already
      // mid-trial (requirements plan §2).
      const trialDays = await getConfiguredTrialDays();
      const organisation = await storage.createOrganisation({
        name: data.businessName,
        slug: data.businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        receiptPrefix: data.businessName.substring(0, 3).toUpperCase(),
        status: "trialing",
        trialEndsAt: computeTrialEndsAt(new Date(), trialDays),
      });

      // Generate a 6-digit OTP code for email verification
      const otpCode = crypto.randomInt(100000, 1000000).toString();
      const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Create platform user in unverified state
      const user = await storage.createUser({
        email: normalizedEmail,
        password: hashedPassword,
        businessId: organisation.id, // For backward compatibility
        role: "owner", // For backward compatibility
        isVerified: false,
        name: data.ownerName,
        phone: normalizedPhone,
      });

      // Update remaining fields on the user
      await storage.updateUser(user.id, {
        passwordHash: hashedPassword,
        isEmailVerified: false,
        otpCode,
        otpExpiry,
      });

      // Create organisation member record
      await storage.createOrganisationMember({
        userId: user.id,
        organisationId: organisation.id,
        role: "owner",
        status: "active",
        activatedAt: new Date(),
      });

      // Record acceptance of every currently-active legal document - the
      // pre-check above already confirmed data.acceptedDocumentTypes
      // matches what's current; this call re-validates the same thing right
      // before writing (the account rows above take a few DB round trips,
      // so it's a second guard against the same admin-toggles-a-section
      // race, not just trusting time has stood still since the pre-check).
      // If it somehow comes back stale anyway, the account is already
      // created at this point - log it rather than leaving a half-created
      // account with no way to complete signup.
      const acceptanceOutcome = await legalDocumentService.recordAcceptance({
        userId: user.id,
        organisationId: organisation.id,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
        acceptedDocumentTypes: data.acceptedDocumentTypes,
      });
      if (acceptanceOutcome.kind === "stale") {
        console.error(`Signup ${user.id}: legal documents changed between pre-check and write - no acceptance recorded. Current: ${acceptanceOutcome.currentDocumentTypes.join(", ")}`);
      }

      // Send the verification OTP email
      await sendEmailVerificationOtpEmail(
        normalizedEmail,
        data.ownerName || normalizedEmail,
        otpCode,
        data.businessName
      );

      auditLogger.logAuthAttempt(user.id, getClientIp(req), true, "signup_pending_otp");
      logFunnelEvent(organisation.id, "signup_completed");

      res.status(201).json({
        status: "email_verification_required",
        message: "Account created. Please verify your email with the 6-digit OTP sent to your inbox.",
        email: normalizedEmail,
      });
    } catch (error) {
      console.error("Signup error:", error);
      auditLogger.logAuthAttempt(undefined, getClientIp(req), false, "signup");
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }

      const constraint = getViolatedConstraint(error);
      if (constraint === "users_email_unique") {
        return res.status(400).json({ error: "This email address is already registered. Please use a different email or log in." });
      }
      if (constraint === "users_phone_unique") {
        return res.status(400).json({ error: "This phone number is already registered. Please use a different number or log in." });
      }
      if (constraint === "organisations_slug_key" || isUniqueViolation(error)) {
        return res.status(400).json({
          error: "A business with a similar name is already registered. Please choose a slightly different business name to proceed successfully."
        });
      }

      res.status(500).json({ error: "Registration failed. Please try again." });
    }
  });

  // Verify OTP - Confirm OTP code
  app.post("/api/auth/verify-otp", async (req: Request, res: Response) => {
    try {
      const { emailOrPhone, otp, newPassword } = req.body;
      if (!emailOrPhone || !otp) {
        return res.status(400).json({ error: "Email/phone and OTP are required." });
      }

      const user = await storage.getUserByIdentifier(emailOrPhone);
      if (!user || !user.otpCode) {
        return res.status(400).json({ error: "Invalid or expired OTP code." });
      }

      if ((user.otpAttempts ?? 0) >= MAX_OTP_ATTEMPTS) {
        return res.status(429).json({ error: "Too many incorrect attempts. Please request a new code." });
      }

      const otpMatch = otp?.length === user.otpCode.length &&
        crypto.timingSafeEqual(Buffer.from(user.otpCode), Buffer.from(otp));
      if (!otpMatch) {
        await storage.updateUser(user.id, { otpAttempts: (user.otpAttempts ?? 0) + 1 });
        return res.status(400).json({ error: "Invalid or expired OTP code." });
      }

      if (user.otpExpiry && new Date() > new Date(user.otpExpiry)) {
        return res.status(400).json({ error: "OTP has expired." });
      }

      // If newPassword is provided, reset it immediately!
      if (newPassword) {
        const pwdVal = passwordSchema.safeParse(newPassword);
        if (!pwdVal.success) {
          return res.status(400).json({ error: pwdVal.error.errors[0].message });
        }

        const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
        await storage.updateUser(user.id, {
          passwordHash: hashedPassword,
          otpCode: null,
          otpExpiry: null,
          otpAttempts: 0,
          loginAttempts: 0,
          lockedUntil: null,
          lockoutCount: 0,
        });

        if (user.email) {
          await sendPasswordChangedEmail(user.email, user.name || user.email);
        }

        return res.json({ message: "Password reset successfully. You can now log in." });
      }

      // Just verification
      res.json({ message: "OTP verified successfully. You can now set your new password." });
    } catch (error) {
      console.error("Verify OTP error:", error);
      res.status(500).json({ error: "Verification failed." });
    }
  });

  // Get SMS/WhatsApp configuration (public endpoint)
  app.get("/api/auth/platform-sms-config", async (req: Request, res: Response) => {
    try {
      const config = await getSmsConfig();
      return res.json(config);
    } catch (error) {
      console.error("Get SMS config error:", error);
      return res.status(500).json({ error: "Failed to load SMS configuration." });
    }
  });

  // "Powered by" line for exported documents (public: needed by client-side PDF/print)
  app.get("/api/export-branding", async (_req: Request, res: Response) => {
    try {
      return res.json(await getExportBranding());
    } catch (error) {
      console.error("Get export branding error:", error);
      return res.status(500).json({ error: "Failed to load export branding." });
    }
  });

  // Forgot password
  app.post("/api/auth/forgot-password", async (req: Request, res: Response) => {
    try {
      const { email, phone, countryCode, channel = "email" } = req.body;

      // Support legacy emailOrPhone format for backward compatibility
      let identifier = req.body.emailOrPhone;
      let selectedChannel = channel;

      if (email && !identifier) {
        identifier = email;
        selectedChannel = "email";
      } else if (phone && !identifier) {
        identifier = `${countryCode || ""}${phone}`.trim();
        selectedChannel = channel;
      }

      if (!identifier) {
        return res.status(400).json({ error: "Email or phone number is required." });
      }

      // Check if requested channel is configured
      if (selectedChannel !== "email") {
        const smsConfig = await getSmsConfig();
        if (selectedChannel === "sms" && !smsConfig.smsEnabled) {
          return res.status(400).json({ error: "SMS is not configured." });
        }
        if (selectedChannel === "whatsapp" && !smsConfig.whatsappEnabled) {
          return res.status(400).json({ error: "WhatsApp is not configured." });
        }
      }

      const user = await storage.getUserByIdentifier(identifier);
      if (!user) {
        // Return success to avoid user enumeration
        return res.json({ message: "If account exists, an OTP code has been sent." });
      }

      // Byte-identical to the branches above and below on purpose: a distinct
      // response here would tell an attacker exactly which accounts are mid
      // manager-email-change, which is the set they'd most want to find.
      if (isManagerEmailChangePending(user)) {
        return res.json({ message: "If account exists, an OTP code has been sent." });
      }

      // Enforce the minimum gap server-side, with the same generic body.
      if (resendWaitSeconds(user) > 0) {
        return res.json({ message: "If account exists, an OTP code has been sent." });
      }

      const cooldown = checkResendCooldown(user.otpResendAttempts, user.otpResendWindowStart);
      if (!cooldown.allowed) {
        // Same generic response as the "no such account" branch above - a
        // distinct rate-limit response here would be a user-enumeration
        // oracle (only real accounts can accumulate cooldown state).
        return res.json({ message: "If account exists, an OTP code has been sent." });
      }

      // Generate random 6-digit OTP
      const otp = crypto.randomInt(100000, 1000000).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Store in DB user record
      await storage.updateUser(user.id, {
        otpCode: otp,
        otpExpiry: expiresAt,
        otpAttempts: 0,
        otpResendAttempts: cooldown.nextAttempts,
        otpResendWindowStart: cooldown.nextWindowStart,
      });

      // Send via selected channel
      if (selectedChannel === "email") {
        if (user.email) {
          await sendOtpEmail(user.email, user.name || user.email, otp);
        }
      } else if (selectedChannel === "sms" || selectedChannel === "whatsapp") {
        if (user.phone) {
          const msgPrefix = selectedChannel === "whatsapp" ? "WhatsApp: " : "";
          await sendSMS(user.phone, `${msgPrefix}Your password reset code is: ${otp}. Valid for 10 minutes.`);
        }
      }

      const maskedIdentifier = email || (user.email && user.email.replace(/(.{2})(.*)(@.*)/, "$1***$3"))
        ? email ? email.replace(/(.{2})(.*)(@.*)/, "$1***$3") : user.email!.replace(/(.{2})(.*)(@.*)/, "$1***$3")
        : user.phone?.replace(/(.{3})(.*)(.{3})/, "$1***$3");

      res.json({
        message: "If account exists, an OTP code has been sent.",
        maskedIdentifier
      });
    } catch (error) {
      console.error("Forgot password error:", error);
      res.status(500).json({ error: "Failed to request password reset code." });
    }
  });

  // Resend OTP
  app.post("/api/auth/resend-otp", async (req: Request, res: Response) => {
    try {
      const { emailOrPhone } = req.body;
      if (!emailOrPhone) {
        return res.status(400).json({ error: "Email or phone number is required." });
      }

      const user = await storage.getUserByIdentifier(emailOrPhone);
      if (!user) {
        return res.json({ message: "If account exists, an OTP code has been sent." });
      }

      // See the same gate in /forgot-password: same generic body, deliberately.
      if (isManagerEmailChangePending(user)) {
        return res.json({ message: "If account exists, an OTP code has been sent." });
      }

      // Enforce the minimum gap server-side, with the same generic body.
      if (resendWaitSeconds(user) > 0) {
        return res.json({ message: "If account exists, an OTP code has been sent." });
      }

      const cooldown = checkResendCooldown(user.otpResendAttempts, user.otpResendWindowStart);
      if (!cooldown.allowed) {
        // Same generic response as the "no such account" branch above - a
        // distinct rate-limit response here would be a user-enumeration
        // oracle (only real accounts can accumulate cooldown state).
        return res.json({ message: "If account exists, an OTP code has been sent." });
      }

      // Generate random 6-digit OTP
      const otp = crypto.randomInt(100000, 1000000).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Store in DB user record
      await storage.updateUser(user.id, {
        otpCode: otp,
        otpExpiry: expiresAt,
        otpAttempts: 0,
        otpResendAttempts: cooldown.nextAttempts,
        otpResendWindowStart: cooldown.nextWindowStart,
      });

      // Send via email or phone
      if (user.email) {
        await sendOtpEmail(user.email, user.name || user.email, otp);
      } else if (user.phone) {
        await sendSMS(user.phone, `Your password reset code is: ${otp}. Valid for 10 minutes.`);
      }

      const maskedIdentifier = user.email
        ? user.email.replace(/(.{2})(.*)(@.*)/, "$1***$3")
        : user.phone?.replace(/(.{3})(.*)(.{3})/, "$1***$3");

      res.json({
        message: "OTP resent successfully.",
        maskedIdentifier
      });
    } catch (error) {
      console.error("Resend OTP error:", error);
      res.status(500).json({ error: "Failed to resend OTP." });
    }
  });

  // Login - Email/Phone and password authentication
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const data = loginSchema.parse(req.body);
      const user = await storage.getUserByIdentifier(data.emailOrPhone);

      if (!user) {
        auditLogger.logAuthAttempt(undefined, getClientIp(req), false, "login");
        return res.status(401).json({ error: "Invalid email/phone or password." });
      }

      // Check lockouts
      if (user.lockedUntil && new Date() < new Date(user.lockedUntil)) {
        const remainingMinutes = Math.ceil((new Date(user.lockedUntil).getTime() - Date.now()) / 60000);
        return res.status(423).json({
          error: `Account is locked. Try again in ${remainingMinutes} minutes.`,
          lockedUntil: user.lockedUntil,
        });
      }

      // Check if user has password
      const userPassword = user.passwordHash || user.password;
      if (!userPassword) {
        return res.status(400).json({ error: "Password not set for this account. Please activate." });
      }

      // Verify password
      const passwordMatch = await bcrypt.compare(data.password, userPassword);
      if (!passwordMatch) {
        const attempts = (user.loginAttempts || 0) + 1;
        if (attempts >= MAX_LOGIN_ATTEMPTS) {
          const priorLockoutCount = user.lockoutCount || 0;
          const durationMs = nextLockoutDurationMs(priorLockoutCount);
          const lockedUntil = new Date(Date.now() + durationMs);
          await storage.updateUser(user.id, {
            loginAttempts: 0,
            lockedUntil,
            lockoutCount: priorLockoutCount + 1,
          });
          if (user.email) {
            await sendAccountLockedEmail(user.email, user.name || user.email);
          }
          auditLogger.logAuthAttempt(user.id, getClientIp(req), false, "lockout");
          const durationMinutes = Math.round(durationMs / 60000);
          const durationLabel = durationMinutes >= 60
            ? `${Math.round(durationMinutes / 60)} hour(s)`
            : `${durationMinutes} minutes`;
          return res.status(423).json({
            error: `Too many failed attempts. Your account has been locked for ${durationLabel}.`,
            lockedUntil,
          });
        } else {
          await storage.updateUser(user.id, { loginAttempts: attempts });
          auditLogger.logAuthAttempt(user.id, getClientIp(req), false, "login");
          return res.status(401).json({ error: `Invalid email/phone or password. ${MAX_LOGIN_ATTEMPTS - attempts} attempts remaining.` });
        }
      }

      // Reset login attempts and lockout escalation on success
      await storage.updateUser(user.id, { loginAttempts: 0, lockedUntil: null, lockoutCount: 0, lastLoginAt: new Date() });
      auditLogger.logAuthAttempt(user.id, getClientIp(req), true, "login");

      // Placed after password verification so it leaks nothing to an
      // unauthenticated caller: only someone who already knows the password
      // learns that a change is pending.
      if (isManagerEmailChangePending(user)) {
        return res.json({ status: "email_change_verification_required", email: user.email });
      }

      // Block unverified users who try to bypass /continue and call /login directly.
      // Applies regardless of which identifier was used to log in - phone is
      // never verified at signup, so scoping this to "only when logging in
      // with the email itself" would let an account log in indefinitely via
      // phone while its email is never verified.
      const hasVerifiedPhone = !!(user.phone && user.isPhoneVerified);
      if (user.email && !user.isEmailVerified && !hasVerifiedPhone && !user.createdByInvitation) {
        // Same cooldown as /continue - repeated login attempts must not
        // bypass the resend-otp rate limit.
        const cooldown = checkResendCooldown(user.otpResendAttempts, user.otpResendWindowStart);
        if (cooldown.allowed) {
          const otpCode = crypto.randomInt(100000, 1000000).toString();
          const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
          await storage.updateUser(user.id, {
            otpCode,
            otpExpiry,
            otpAttempts: 0,
            otpResendAttempts: cooldown.nextAttempts,
            otpResendWindowStart: cooldown.nextWindowStart,
          });
          await sendEmailVerificationOtpEmail(user.email, user.name || user.email, otpCode);
        }
        return res.json({ status: "email_verification_required", email: user.email });
      }

      // Legal-document consent gate - checked once the account is known
      // genuinely reachable (password ok, email verified) but before any
      // org-membership resolution, so it applies uniformly regardless of
      // how many orgs this user belongs to. Covers both a brand-new-feature
      // backfill (every account that predates this shipping) and a stale
      // acceptance (a super admin published a new document version since
      // this user last consented) - hasAcceptedCurrentDocuments treats both
      // identically. See server/lib/authFlow.ts for the rest of login once
      // this passes.
      if (!(await legalDocumentService.hasAcceptedCurrentDocuments(user.id))) {
        const pendingToken = generateLegalConsentPendingToken(user.id, "login");
        res.cookie("legal_consent_pending_token", pendingToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          maxAge: 60 * 60 * 1000,
          sameSite: "lax",
        });
        return res.json({
          status: "legal_consent_required",
          nextStep: "legal-consent",
          message: "Please review and accept our current legal documents to continue.",
        });
      }

      await completeLoginForUser(user, req, res);
    } catch (error) {
      console.error("Login endpoint error:", error);
      auditLogger.logAuthAttempt(undefined, getClientIp(req), false, "login");
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "Login failed. Please try again." });
    }
  });

  // Organisation select endpoint for multiple workspaces
  app.post("/api/auth/organisation/select", async (req: Request, res: Response) => {
    try {
      const { orgSelectToken, organisationId } = req.body;
      if (!orgSelectToken || !organisationId) {
        return res.status(400).json({ error: "Organisation selection session and Organisation ID are required." });
      }

      const decoded = verifyOrgSelectToken(orgSelectToken);
      if (!decoded) {
        return res.status(401).json({ error: "Organisation selection session expired. Please log in again." });
      }
      const userId = decoded.userId;

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found." });
      }

      const member = await storage.getOrganisationMember(userId, organisationId);
      if (!member || member.status !== "active") {
        return res.status(403).json({ error: "Access denied to this organisation." });
      }

      const org = await storage.getBusinessById(organisationId);

      const payload = {
        userId: user.id,
        organisationId: organisationId,
        role: member.role,
        staffId: member.staffId || undefined,
        email: user.email || undefined,
      };

      await issueSession(req, res, payload);

      const sessionUser = {
        id: user.id,
        email: user.email || user.phone || "",
        role: member.role,
        businessId: organisationId,
        isVerified: user.isVerified || user.isEmailVerified || user.isPhoneVerified,
      };

      res.json({
        message: "Login successful.",
        user: sessionUser,
        business: org,
      });
    } catch (error) {
      console.error("Organisation selection error:", error);
      res.status(500).json({ error: "Failed to set organization context." });
    }
  });

  // Switch organisation workspace
  app.post("/api/auth/organisation/switch", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { organisationId } = req.body;
      const userId = req.user!.userId;

      if (!organisationId) {
        return res.status(400).json({ error: "Organisation ID is required." });
      }

      const member = await storage.getOrganisationMember(userId, organisationId);
      if (!member || member.status !== "active") {
        return res.status(403).json({ error: "You are not an active member of this organisation." });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found." });
      }

      const org = await storage.getBusinessById(organisationId);

      const payload = {
        userId: userId,
        organisationId: organisationId,
        role: member.role,
        staffId: member.staffId || undefined,
        email: user.email || undefined,
      };

      await issueSession(req, res, payload);

      const sessionUser = {
        id: user.id,
        email: user.email || user.phone || "",
        role: member.role,
        businessId: organisationId,
        isVerified: user.isVerified || user.isEmailVerified || user.isPhoneVerified,
      };

      res.json({
        message: "Switched workspace successfully.",
        user: sessionUser,
        business: org,
      });
    } catch (error) {
      console.error("Organisation switch error:", error);
      res.status(500).json({ error: "Failed to switch organization workspace." });
    }
  });

  // Create a brand new business workspace under current active user
  app.post("/api/auth/organisation/create", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "Business name is required." });
      }

      const userId = req.user!.userId;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User account not found." });
      }

      // Create new organisation
      const nameTrimmed = name.trim();
      const slug = nameTrimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Math.floor(1000 + Math.random() * 9000);
      // A new workspace is a new business, so it gets the same free trial as signup.
      const trialDays = await getConfiguredTrialDays();
      const organisation = await storage.createOrganisation({
        name: nameTrimmed,
        slug,
        receiptPrefix: nameTrimmed.substring(0, 3).toUpperCase(),
        status: "trialing",
        trialEndsAt: computeTrialEndsAt(new Date(), trialDays),
      });

      // Add user as the active Owner of this new organisation
      await storage.createOrganisationMember({
        userId: user.id,
        organisationId: organisation.id,
        role: "owner",
        status: "active",
        activatedAt: new Date(),
      });

      // Update the user's default businessId for backward-compatibility if not set
      if (!user.businessId) {
        await storage.updateUser(user.id, { businessId: organisation.id });
      }

      // Audit log the creation
      auditLogger.logDataModification("organisation", organisation.id, user.id, "CREATE", true);

      // Generate updated JWT session token scoped to the newly created organisation
      const payload = {
        userId: user.id,
        organisationId: organisation.id,
        role: "owner",
        email: user.email || undefined,
      };

      await issueSession(req, res, payload);

      const sessionUser = {
        id: user.id,
        email: user.email || user.phone || "",
        role: "owner",
        businessId: organisation.id,
        isVerified: user.isVerified || user.isEmailVerified || user.isPhoneVerified,
      };

      res.json({
        message: "Business workspace created successfully.",
        user: sessionUser,
        business: organisation,
      });
    } catch (error) {
      console.error("Organisation creation error:", error);
      res.status(500).json({ error: "Failed to create new business workspace." });
    }
  });

  // Legacy activation route has been refactored below to activateHandler at lines 813-872 to allow high-fidelity verification checks.

  // Activation Code Validation Endpoint (supports both /api/auth/activate and /api/auth/verify-activation-code)
  const activateHandler = async (req: Request, res: Response) => {
    try {
      const { emailOrPhone, activationCode } = req.body;
      if (!emailOrPhone) {
        return res.status(400).json({ error: "invalid_code", message: "Email or phone number is required." });
      }
      if (!activationCode) {
        return res.status(400).json({ error: "invalid_code", message: "Activation code is required." });
      }

      const user = await storage.getUserByIdentifier(emailOrPhone);
      if (!user) {
        return res.status(400).json({ error: "invalid_code", message: "Invalid activation code. Please check the code in your email and try again." });
      }

      // Normalise code (strip hyphens and uppercase) - shared with the
      // generator so both ends agree on one canonical form.
      const cleanInput = normalizeActivationCode(activationCode);
      const cleanStored = user.activationCode ? normalizeActivationCode(user.activationCode) : "";

      const codeMatch = cleanStored &&
        cleanInput.length === cleanStored.length &&
        crypto.timingSafeEqual(Buffer.from(cleanInput), Buffer.from(cleanStored));
      if (!codeMatch) {
        return res.status(400).json({ error: "invalid_code", message: "Invalid activation code. Please check the code in your email and try again." });
      }

      if (user.activationCodeUsed) {
        return res.status(400).json({ error: "used_code", message: "This code has already been used. If you have not yet created your password, tap 'Resend Activation Code' to get a new one." });
      }

      if (user.activationCodeExpiry && new Date() > new Date(user.activationCodeExpiry)) {
        return res.status(400).json({ error: "expired_code", message: "This activation code has expired. Request a new one below." });
      }

      // Mark code as used in database immediately and clear code/expiry
      await storage.updateUser(user.id, {
        activationCodeUsed: true,
        activationCode: null,
        activationCodeExpiry: null,
        isEmailVerified: user.email ? true : user.isEmailVerified,
        isPhoneVerified: user.phone ? true : user.isPhoneVerified,
      });

      // Update workspace membership status to partial
      const members = await storage.getOrganisationsByUserId(user.id);
      const pendingMember = members.find(m => m.status === "pending");
      if (pendingMember) {
        await storage.updateOrganisationMemberStatus(pendingMember.memberId || pendingMember.id, "partial");
        // Not authenticated yet at this point (no req.user), so broadcastChange's
        // req-based businessId lookup would no-op - go straight to broadcastDataChange
        // with the membership's own organisationId instead.
        const activatingStaff = await storage.getStaffByUserId(user.id);
        broadcastDataChange(pendingMember.organisationId, "staff", activatingStaff?.storeId, "updated");
      }

      res.json({
        success: true,
        message: "Activation code verified successfully. Please proceed to create your password.",
        email: user.email,
        phone: user.phone,
        // Seeded from staff.name by StaffInviteService at invite time - shown
        // read-only on the create-password screen instead of asking the
        // person to (re)type it, so staff.name stays exclusively
        // manager/owner-controlled (see set-activated-password below).
        name: user.name,
        nextStep: "create-password",
      });
    } catch (error) {
      console.error("Activate endpoint error:", error);
      res.status(500).json({ error: "server_error", message: "Something went wrong. Please try again." });
    }
  };

  app.post("/api/auth/verify-activation-code", activateHandler);
  app.post("/api/auth/activate", activateHandler);

  // Clears the manager-email-change gate. Reached from /continue and /login,
  // which return status "email_change_verification_required" for a gated
  // account.
  app.post("/api/auth/verify-manager-email-change", async (req: Request, res: Response) => {
    try {
      const { emailOrPhone, otp } = req.body;
      if (!emailOrPhone || !otp) {
        return res.status(400).json({ error: "Identifier and verification code are required." });
      }

      const user = await storage.getUserByIdentifier(emailOrPhone);
      if (!user || !user.managerEmailChangedAt) {
        return res.status(400).json({ error: "No email change is pending for this account." });
      }
      if ((user.otpAttempts ?? 0) >= MAX_OTP_ATTEMPTS) {
        return res.status(429).json({ error: "Too many incorrect attempts. Please ask your manager to resend the code." });
      }
      if (!user.otpCode) {
        return res.status(400).json({ error: "Invalid or expired verification code." });
      }

      const otpMatch = otp.length === user.otpCode.length &&
        crypto.timingSafeEqual(Buffer.from(user.otpCode), Buffer.from(otp));
      if (!otpMatch) {
        await storage.updateUser(user.id, { otpAttempts: (user.otpAttempts ?? 0) + 1 });
        return res.status(400).json({ error: "Invalid verification code." });
      }
      if (user.otpExpiry && new Date() > new Date(user.otpExpiry)) {
        return res.status(400).json({ error: "This code has expired. Ask your manager to resend it." });
      }

      await storage.updateUser(user.id, {
        isEmailVerified: true,
        managerEmailChangedAt: null,
        otpCode: null,
        otpExpiry: null,
        otpAttempts: 0,
      });
      auditLogger.logAuthAttempt(user.id, getClientIp(req), true, "manager_email_change_verified");

      // Deliberately NO jwt_token cookie here, and do not add one later.
      // Reading the new mailbox proves the address works; it does not prove the
      // holder is the staff member. Requiring the password afterwards is the
      // whole reason a manager who repointed the address at themselves still
      // cannot get in.
      res.json({
        success: true,
        nextStep: "password",
        message: "Email verified. Please sign in with your password.",
      });
    } catch (error) {
      console.error("Verify manager email change error:", error);
      res.status(500).json({ error: "Could not verify this email change." });
    }
  });

  // Resend Activation Code Endpoint
  app.post("/api/auth/resend-activation", async (req: Request, res: Response) => {
    try {
      const { emailOrPhone } = req.body;
      if (!emailOrPhone) {
        return res.status(400).json({ error: "Email or phone number is required." });
      }

      const user = await storage.getUserByIdentifier(emailOrPhone);
      if (!user) {
        return res.json({ message: "If account exists, an activation code has been sent." });
      }

      // Verify that the membership is actually pending or partial
      const members = await storage.getOrganisationsByUserId(user.id);
      const isPending = members.some(m => m.status === "pending");
      const isPartial = members.some(m => m.status === "partial");
      const hasNoPassword = !user.passwordHash && !user.password;

      // Self-healing: if code is already verified/activated but password is not set, direct straight to password set
      if (!isPending && !isPartial && hasNoPassword) {
        return res.json({
          success: true,
          nextStep: "create-password",
          name: user.name,
          message: "Your activation code was already verified. Let's create your password to complete setup.",
        });
      }

      if (!isPending && !isPartial) {
        return res.status(400).json({ error: "Account is not pending activation." });
      }

      // If in partial status, revert organization membership status back to pending
      if (isPartial) {
        const partialMember = members.find(m => m.status === "partial");
        if (partialMember) {
          await storage.updateOrganisationMemberStatus(partialMember.memberId || partialMember.id, "pending");
        }
      }

      // DB-backed rate limit: max 3 resends per 1-hour window
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const windowStart = user.resendWindowStart ? new Date(user.resendWindowStart) : null;
      const currentAttempts = (windowStart && windowStart > oneHourAgo) ? (user.resendAttempts || 0) : 0;

      if (currentAttempts >= 3) {
        return res.status(429).json({ error: "too_many_attempts", message: "Too many resend attempts. Contact your manager to reset your activation code." });
      }

      const newCode = generateActivationCode();

      await storage.updateUser(user.id, {
        activationCode: newCode,
        activationCodeExpiry: activationCodeExpiry(),
        activationCodeUsed: false,
        resendAttempts: currentAttempts + 1,
        resendWindowStart: windowStart && windowStart > oneHourAgo ? windowStart : now,
      });

      // Fetch business details to send clean activation email
      const businessId = user.businessId || members[0]?.organisationId;
      const business = businessId ? await storage.getBusinessById(businessId) : null;
      const businessName = business?.name || "Business Manager";
      const role = members[0]?.role || "staff";

      if (user.email) {
        await sendActivationEmail(
          user.email,
          user.name || user.email,
          businessName,
          role,
          newCode
        );
      }

      res.json({ message: "Activation code sent successfully." });
    } catch (error) {
      console.error("Resend activation error:", error);
      res.status(500).json({ error: "Failed to resend activation code." });
    }
  });

  // Set password for activated staff
  app.post("/api/auth/set-activated-password", async (req: Request, res: Response) => {
    try {
      const { emailOrPhone, password } = req.body;
      if (!emailOrPhone || !password) {
        return res.status(400).json({ error: "Identifier and password are required." });
      }

      const user = await storage.getUserByIdentifier(emailOrPhone);
      if (!user) {
        return res.status(400).json({ error: "User not found." });
      }

      if (!user.activationCodeUsed) {
        return res.status(400).json({ error: "Please verify your activation code first." });
      }

      // Check password complexity
      const pwdVal = passwordSchema.safeParse(password);
      if (!pwdVal.success) {
        return res.status(400).json({ error: pwdVal.error.errors[0].message });
      }

      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
      await storage.updateUser(user.id, { passwordHash: hashedPassword });

      // Fetch workspace membership
      const members = await storage.getOrganisationsByUserId(user.id);
      const targetMember = members.find(m => m.status === "partial") || members.find(m => m.status === "pending")
        || members.find(m => m.status === "contract_pending") || members.find(m => m.status === "active");
      if (!targetMember) {
        return res.status(400).json({ error: "No workspace association found." });
      }

      // First-time activation (targetMember has never been "active" before)
      // also requires accepting the current Terms and Conditions, Privacy
      // Policy, and Data Usage Policy once - checked here, ahead of the
      // contract check in completeStaffActivation, so a staff member with
      // both a pending contract and outstanding legal consent sees the
      // legal-consent step first, then sign_contract. Password is set
      // (above) regardless of what happens next; only the SESSION is gated.
      if (targetMember.status !== "active" && !(await legalDocumentService.hasAcceptedCurrentDocuments(user.id))) {
        const pendingToken = generateLegalConsentPendingToken(user.id, "staff_activation");
        res.cookie("legal_consent_pending_token", pendingToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          maxAge: 60 * 60 * 1000,
          sameSite: "lax",
        });
        return res.json({
          message: "Password set. Please review and accept our current legal documents to continue.",
          nextStep: "legal-consent",
        });
      }

      // Contract check, workspace activation, and jwt issuance all live in
      // completeStaffActivation (server/lib/authFlow.ts) - reused verbatim
      // by POST /api/legal/consent-pending/accept once a first-time
      // activation with both gates pending clears the legal-consent step.
      await completeStaffActivation(user, req, res);
    } catch (error) {
      console.error("Set activated password error:", error);
      res.status(500).json({ error: "Failed to set password." });
    }
  });

  // Verify signup / owner email OTP
  app.post("/api/auth/verify-signup-email", async (req: Request, res: Response) => {
    try {
      const { emailOrPhone, otp } = req.body;
      if (!emailOrPhone || !otp) {
        return res.status(400).json({ error: "Identifier and verification code are required." });
      }

      const user = await storage.getUserByIdentifier(emailOrPhone);
      if (!user) {
        return res.status(400).json({ error: "User not found." });
      }

      if (user.createdByInvitation) {
        return res.status(400).json({
          error: "This account uses an activation code, not a verification code. Please use the activation code sent to your email."
        });
      }

      // This endpoint mints a session further down. Letting whoever holds the
      // OTP through while a manager-initiated email change is unverified would
      // BE the takeover, so route them to the dedicated endpoint instead - it
      // clears the flag without handing out a session.
      if (isManagerEmailChangePending(user)) {
        return res.status(400).json({
          error: "Please confirm this address using the code we emailed you, then sign in with your password.",
          nextStep: "verify_email_change",
        });
      }

      if (!user.isEmailVerified) {
        const matches = typeof otp === "string" && !!user.otpCode && otp.length === user.otpCode.length &&
          crypto.timingSafeEqual(Buffer.from(user.otpCode), Buffer.from(otp));
        const check = checkSubmittedOtp(user, String(otp), matches);
        if (!check.ok) {
          if (check.code === "OTP_INVALID" || (check.code === "OTP_LOCKED" && (user.otpAttempts ?? 0) < MAX_OTP_ATTEMPTS)) {
            await storage.updateUser(user.id, { otpAttempts: (user.otpAttempts ?? 0) + 1 });
          }
          const messages = {
            OTP_INVALID: "Invalid verification code.",
            OTP_EXPIRED: "Verification code has expired.",
            OTP_LOCKED: "Too many incorrect attempts. Please request a new code.",
          } as const;
          return res.status(check.code === "OTP_LOCKED" ? 429 : 400).json({
            error: { message: messages[check.code], code: check.code, attemptsLeft: check.attemptsLeft },
          });
        }

        // Mark email as verified
        await storage.updateUser(user.id, {
          isEmailVerified: true,
          isVerified: true,
          otpCode: null,
          otpExpiry: null,
          otpAttempts: 0,
        });
      }

      // Log success and log user in automatically
      auditLogger.logAuthAttempt(user.id, getClientIp(req), true, "email_verified");

      let members = await storage.getOrganisationsByUserId(user.id);

      // Auto-create workspace member if missing but businessId is present
      if (members.length === 0 && user.businessId) {
        const newMember = await storage.createOrganisationMember({
          userId: user.id,
          organisationId: user.businessId,
          role: user.role || "owner",
          status: "active",
          activatedAt: new Date(),
        });
        members = [newMember];
      }

      let activeMembers = members.filter(m => m.status === "active");

      // Brand-new signup: no membership has been activated yet, activate the first one
      if (activeMembers.length === 0 && members.length > 0) {
        const firstMember = members[0];
        await storage.updateOrganisationMemberStatus(firstMember.memberId || firstMember.id, "active", new Date());
        activeMembers = [{ ...firstMember, status: "active", activatedAt: new Date() }];
      }

      if (activeMembers.length === 0) {
        return res.status(400).json({ error: "No active business workspace associated." });
      }

      // Existing user with multiple workspaces - let them choose, same as password login
      if (activeMembers.length > 1) {
        const orgIds = activeMembers.map(m => m.organisationId);
        const orgs = await storage.getBusinessesByIds(orgIds);
        const orgMap = new Map(orgs.map(o => [o.id, o]));
        const orgList = activeMembers
          .map(m => {
            const org = orgMap.get(m.organisationId);
            if (!org) return null;
            return { id: org.id, name: org.name, slug: org.slug, role: m.role };
          })
          .filter(Boolean);
        return res.json({
          requiresOrganisationSelection: true,
          organisations: orgList,
          orgSelectToken: generateOrgSelectToken(user.id),
        });
      }

      const activeMember = activeMembers[0];
      const org = await storage.getBusinessById(activeMember.organisationId);

      const payload = {
        userId: user.id,
        organisationId: activeMember.organisationId,
        role: activeMember.role,
        staffId: activeMember.staffId || undefined,
        email: user.email || undefined,
      };

      await issueSession(req, res, payload);

      res.json({
        message: "Email verified and logged in successfully.",
        user: {
          id: user.id,
          email: user.email || user.phone || "",
          role: activeMember.role,
          businessId: activeMember.organisationId,
          isVerified: true,
        },
        business: org,
      });
    } catch (error) {
      console.error("Verify signup email error:", error);
      res.status(500).json({ error: "Failed to verify email address." });
    }
  });

  // Resend owner email verification OTP
  app.post("/api/auth/resend-verification-otp", async (req: Request, res: Response) => {
    try {
      const { emailOrPhone } = req.body;
      if (!emailOrPhone) {
        return res.status(400).json({ error: "Identifier is required." });
      }

      const user = await storage.getUserByIdentifier(emailOrPhone);
      if (!user) {
        return res.status(400).json({ error: "User not found." });
      }

      const wait = resendWaitSeconds(user);
      if (wait > 0) {
        return res.status(429).json({
          error: { message: `Please wait ${wait} seconds before requesting another code.`, code: "OTP_RESEND_TOO_SOON", retryAfterSeconds: wait },
        });
      }

      const cooldown = checkResendCooldown(user.otpResendAttempts, user.otpResendWindowStart);
      if (!cooldown.allowed) {
        return res.status(429).json({
          error: `Too many resend requests. Please try again in ${cooldown.retryAfterMinutes} minutes.`,
        });
      }

      const otpCode = crypto.randomInt(100000, 1000000).toString();
      const otpExpiry = new Date(Date.now() + OTP_TTL_MS);

      await storage.updateUser(user.id, {
        otpCode,
        otpExpiry,
        otpAttempts: 0,
        otpResendAttempts: cooldown.nextAttempts,
        otpResendWindowStart: cooldown.nextWindowStart,
      });

      if (user.email) {
        await sendEmailVerificationOtpEmail(user.email, user.name || user.email, otpCode);
      }

      res.json({
        success: true,
        message: "Verification code resent successfully.",
        expiresInSeconds: OTP_TTL_MS / 1000,
        retryAfterSeconds: OTP_RESEND_MIN_GAP_MS / 1000,
      });
    } catch (error) {
      console.error("Resend verification OTP error:", error);
      res.status(500).json({ error: "Failed to resend verification code." });
    }
  });

  // Owner onboarding: fix a mistyped email before it has been verified. There is
  // no session yet, so the account password stands in for one. Sends a fresh code
  // to the new address and spends one of the hourly resend allowances.
  app.post("/api/auth/change-signup-email", async (req: Request, res: Response) => {
    try {
      const parsed = z.object({
        currentEmail: z.string().email(),
        newEmail: z.string().email(),
        password: z.string().min(1),
      }).safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: { message: "Enter a valid email address.", code: "INVALID_EMAIL" } });
      }
      const currentEmail = parsed.data.currentEmail.toLowerCase();
      const newEmail = parsed.data.newEmail.toLowerCase();

      const user = await storage.getUserByIdentifier(currentEmail);
      const verdict = checkSignupEmailChange(user, currentEmail, newEmail);
      if (verdict === "same_email") {
        return res.status(400).json({ error: { message: "That is the email we already have. Enter a different one.", code: "SAME_EMAIL" } });
      }
      if (verdict !== "ok" || !user) {
        return res.status(400).json({ error: { message: "This email cannot be changed here. Log in instead.", code: "NOT_ELIGIBLE" } });
      }

      const hash = user.passwordHash ?? user.password;
      if (!hash || !(await bcrypt.compare(parsed.data.password, hash))) {
        auditLogger.logAuthAttempt(user.id, getClientIp(req), false, "signup_email_change_bad_password");
        return res.status(401).json({ error: { message: "Incorrect password.", code: "INVALID_PASSWORD" } });
      }

      if (await storage.getUserByIdentifier(newEmail)) {
        return res.status(409).json({ error: { message: "That email is already registered. Use a different one or log in.", code: "EMAIL_TAKEN" } });
      }

      const cooldown = checkResendCooldown(user.otpResendAttempts, user.otpResendWindowStart);
      if (!cooldown.allowed) {
        return res.status(429).json({
          error: { message: `Too many requests. Please try again in ${cooldown.retryAfterMinutes} minutes.`, code: "OTP_RESEND_LIMIT" },
        });
      }

      const otpCode = crypto.randomInt(100000, 1000000).toString();
      await storage.updateUser(user.id, {
        email: newEmail,
        isEmailVerified: false,
        otpCode,
        otpExpiry: new Date(Date.now() + OTP_TTL_MS),
        otpAttempts: 0,
        otpResendAttempts: cooldown.nextAttempts,
        otpResendWindowStart: cooldown.nextWindowStart,
      });
      await sendEmailVerificationOtpEmail(newEmail, user.name || newEmail, otpCode);
      auditLogger.logAuthAttempt(user.id, getClientIp(req), true, "signup_email_changed");

      res.json({ success: true, email: newEmail, expiresInSeconds: OTP_TTL_MS / 1000 });
    } catch (error) {
      console.error("Change signup email error:", error);
      res.status(500).json({ error: "Failed to change email." });
    }
  });

  // Logout
  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    // Revoke server-side too, or a copied cookie/Bearer token would outlive logout.
    // Works without isAuthenticated so an already-expired client can still clear its cookie.
    const claims = req.user;
    if (claims?.sid) {
      try {
        await revokeSession(claims.sid, "logout");
      } catch (error) {
        console.error("Logout session revoke error:", error);
      }
    }
    res.clearCookie("jwt_token");
    res.json({ message: "Logged out successfully." });
  });

  // Supervisor override credentials authentication (DB-backed rate limiting — restart-safe)
  app.post("/api/auth/supervisor-override", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required." });
      }

      const normEmail = email.toLowerCase().trim();
      const user = await storage.getUserByEmail(normEmail);

      if (!user) {
        return res.status(401).json({ error: "Invalid email or password." });
      }

      // Supervisor must belong to the same business as the requester
      const requesterId = req.user?.userId;
      if (!requesterId) {
        return res.status(401).json({ error: "Authentication required." });
      }
      const requester = await storage.getUser(requesterId);
      if (!requester || user.businessId !== requester.businessId) {
        return res.status(403).json({ error: "Supervisor must belong to the same business." });
      }

      // Check DB-persisted supervisor lockout
      if (user.supervisorLockedUntil && new Date() < new Date(user.supervisorLockedUntil)) {
        const remainingMinutes = Math.ceil((new Date(user.supervisorLockedUntil).getTime() - Date.now()) / (60 * 1000));
        return res.status(429).json({
          error: "account_locked",
          message: `Too many failed attempts. This supervisor account is temporarily locked. Try again in ${remainingMinutes} minutes.`,
        });
      }

      const userPassword = user.passwordHash || user.password;
      if (!userPassword) {
        return res.status(400).json({ error: "Password not set for this supervisor." });
      }

      const passwordMatch = await bcrypt.compare(password, userPassword);
      if (!passwordMatch) {
        const currentAttempts = (user.supervisorAttempts || 0) + 1;
        if (currentAttempts >= 5) {
          await storage.updateUser(user.id, {
            supervisorAttempts: currentAttempts,
            supervisorLockedUntil: new Date(Date.now() + 30 * 60 * 1000),
          });
          return res.status(429).json({
            error: "account_locked",
            message: "Too many failed attempts. This supervisor account is now locked for 30 minutes.",
          });
        } else {
          await storage.updateUser(user.id, { supervisorAttempts: currentAttempts });
          return res.status(401).json({
            error: "invalid_credentials",
            message: `Invalid email or password. ${5 - currentAttempts} attempts remaining before lockout.`,
          });
        }
      }

      if (user.role !== "owner" && user.role !== "manager") {
        return res.status(403).json({ error: "Only managers or owners can authorize overrides." });
      }

      // Success: clear lockout
      await storage.updateUser(user.id, { supervisorAttempts: 0, supervisorLockedUntil: null });

      console.info(`[Supervisor Override] Authorized by user ${user.id} (${user.role}) from IP ${req.ip}`);

      res.json({
        success: true,
        supervisorId: user.id,
        role: user.role,
      });
    } catch (error) {
      console.error("Supervisor override error:", error);
      res.status(500).json({ error: "Could not authenticate supervisor." });
    }
  });

  // Reset Password - Set new password with OTP verification
  app.post("/api/auth/reset-password", async (req: Request, res: Response) => {
    try {
      const data = resetPasswordSchema.parse(req.body);

      const user = await storage.getUserByIdentifier(data.emailOrPhone);
      if (!user) {
        return res.status(404).json({ error: "Account not found." });
      }

      // Defence in depth. The manager overwrite clears otpCode and the two
      // OTP-issuing endpoints already refuse while the gate is set, so nothing
      // resettable should exist here - but if a code were minted in the same
      // instant, this is where it would otherwise be spendable.
      if (isManagerEmailChangePending(user)) {
        auditLogger.logAuthAttempt(user.id, getClientIp(req), false, "reset-password");
        return res.status(400).json({ error: "Invalid or expired OTP code." });
      }

      // NOTE: forgot-password/resend-otp write the OTP to user.otpCode/
      // otpExpiry (not the separate otp_codes table), so this must check
      // the same place or a valid code would always be rejected here.
      if (!user.otpCode) {
        auditLogger.logAuthAttempt(user.id, getClientIp(req), false, "reset-password");
        return res.status(400).json({ error: "Invalid or expired OTP code." });
      }

      if ((user.otpAttempts ?? 0) >= MAX_OTP_ATTEMPTS) {
        return res.status(429).json({ error: "Too many incorrect attempts. Please request a new code." });
      }

      const otpMatch = data.otp.length === user.otpCode.length &&
        crypto.timingSafeEqual(Buffer.from(user.otpCode), Buffer.from(data.otp));
      if (!otpMatch) {
        await storage.updateUser(user.id, { otpAttempts: (user.otpAttempts ?? 0) + 1 });
        auditLogger.logAuthAttempt(user.id, getClientIp(req), false, "reset-password");
        return res.status(400).json({ error: "Invalid or expired OTP code." });
      }

      if (user.otpExpiry && new Date() > new Date(user.otpExpiry)) {
        return res.status(400).json({ error: "OTP has expired." });
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(data.password, SALT_ROUNDS);

      await storage.updateUser(user.id, {
        passwordHash: hashedPassword,
        otpCode: null,
        otpExpiry: null,
        otpAttempts: 0,
        loginAttempts: 0,
        lockedUntil: null,
        lockoutCount: 0,
      });

      await revokeAllUserSessions(user.id, "password_reset");

      if (user.email) {
        await sendPasswordChangedEmail(user.email, user.name || user.email);
      }

      auditLogger.logAuthAttempt(user.id, getClientIp(req), true, "reset-password");

      res.json({ message: "Password reset successfully. Please login with your new password." });
    } catch (error) {
      console.error("Reset password error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "Failed to reset password. Please try again." });
    }
  });

  // Get current user
  app.get("/api/auth/user", async (req: any, res) => {
    try {
      const userId = req.user?.userId || req.user?.id;
      if (userId) {
        const user = await storage.getUser(userId);
        if (user) {
          const orgId = req.user.organisationId || user.businessId;
          let business = null;
          let activeRole = user.role;
          let ownStaffRecord = null;

          if (orgId) {
            // Parallelize business + member + staff lookups instead of sequential
            const [fetchedBusiness, member, staffRecord] = await Promise.all([
              storage.getBusinessById(orgId),
              storage.getOrganisationMember(user.id, orgId),
              storage.getStaffByUserId(user.id),
            ]);
            business = fetchedBusiness;
            ownStaffRecord = staffRecord;
            if (member) {
              activeRole = member.role;
            }
          } else {
            // Even if no org, fetch staff record in parallel
            ownStaffRecord = await storage.getStaffByUserId(user.id);
          }

          auditLogger.logAuthAttempt(user.id, getClientIp(req), true);
          return res.json({
            ...user,
            id: user.id,
            email: user.email || user.phone || "",
            role: activeRole,
            businessId: orgId,
            business,
            staffId: ownStaffRecord?.id ?? null,
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
          });
        }
      }

      res.status(401).json({ message: "Not authenticated" });
    } catch (error) {
      console.error("Error fetching user:", error);
      auditLogger.logAuthAttempt(undefined, getClientIp(req), false);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Get user's active organisations
  app.get("/api/auth/organisations", async (req: any, res) => {
    try {
      const userId = req.user?.userId || req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const orgs = await storage.getOrganisationsByUserId(userId);
      res.json(orgs);
    } catch (error) {
      console.error("Error fetching user organisations:", error);
      res.status(500).json({ message: "Failed to fetch organisations" });
    }
  });

  // ========== RBAC MIDDLEWARE ==========
  const requireRole = (...allowedRoles: UserRole[]) => {
    return async (req: any, res: Response, next: NextFunction) => {
      try {
        let userRole: string | undefined;

        // Check custom auth session
        if (req.user?.role) {
          userRole = req.user.role;
        }

        if (!userRole) {
          return res.status(401).json({ error: "Authentication required." });
        }

        if (!allowedRoles.includes(userRole as UserRole)) {
          return res.status(403).json({ error: "You don't have permission to access this resource." });
        }

        next();
      } catch (error) {
        console.error("RBAC middleware error:", error);
        res.status(500).json({ error: "Authorization check failed." });
      }
    };
  };

  const requireManagerOrOwner = (req: Request, res: Response, next: NextFunction) => {
    const role = req.user?.role;
    if (role !== "manager" && role !== "owner") {
      return res.status(403).json({ error: "Only managers and owners can access this feature." });
    }
    next();
  };





  // ─── Register domain-specific route modules ─────────────────────────────
  const routeMiddlewares = {
    isAuthenticated,
    requireRole,
    requireManagerOrOwner,
    checkStoreAccess,
  };

  // Self-service contract review/sign/decline - gated by its own
  // contract_pending_token, not the normal auth middlewares, so it is
  // registered standalone rather than through routeMiddlewares.
  registerContractRoutes(app);
  // Self-service HR profile completion + the guarantor's own sign/decline -
  // gated by their own pending tokens, same reasoning as registerContractRoutes.
  registerProfileCompletionRoutes(app);
  registerGuarantorRoutes(app);
  registerLegalRoutes(app);

  // Resend delivery webhook - signature-verified, not session-based, so it
  // is registered standalone like registerContractRoutes above.
  registerEmailWebhookRoutes(app);

  // WhatsApp Cloud API webhook (inbound messages + delivery-status callbacks)
  // - signature-verified, not session-based, registered standalone as above.
  registerWhatsAppWebhookRoutes(app);

  // Public magic-link booking view/cancel (token-scoped, no session) - see
  // csrf.ts's /api/my-booking exemption.
  registerCustomerBookingRoutes(app);

  registerBroadcastRoutes(app, routeMiddlewares);
  registerAccountingRoutes(app, routeMiddlewares);
  registerWhatsAppNumberRoutes(app, routeMiddlewares);
  registerWhatsAppTemplateRoutes(app, routeMiddlewares);
  registerBusinessRoutes(app, routeMiddlewares);
  registerCustomerRoutes(app, routeMiddlewares);
  registerStaffRoutes(app, routeMiddlewares);
  registerHrRoutes(app, routeMiddlewares);
  registerInventoryRoutes(app, routeMiddlewares);
  registerInventoryDraftRoutes(app, routeMiddlewares);
  registerStockTransferDraftRoutes(app, routeMiddlewares);
  registerConsumablesRoutes(app, routeMiddlewares);
  registerTransactionRoutes(app, routeMiddlewares);
  registerSalesRoutes(app, routeMiddlewares);
  registerGamificationRoutes(app, routeMiddlewares);
  registerSettingsRoutes(app, routeMiddlewares);
  registerPayrollRoutes(app, routeMiddlewares);
  registerReportsRoutes(app, routeMiddlewares);
  registerVendorRoutes(app, routeMiddlewares);
  registerPartnerRoutes(app, routeMiddlewares);
  registerPaymentRoutes(app, routeMiddlewares);
  registerBillingRoutes(app, routeMiddlewares);
  registerSupportRoutes(app, routeMiddlewares);
  registerCashRoutes(app, routeMiddlewares);
  registerPaymentAccountRoutes(app, routeMiddlewares);
  registerBankConnectionRoutes(app, routeMiddlewares);
  registerAuditLogRoutes(app, routeMiddlewares);

  // Fails fast if the analytics catalog and its SQL bindings have drifted apart.
  assertBindingsComplete();
  registerAnalyticsRoutes(app, routeMiddlewares);
  registerAnalyticsViewRoutes(app, routeMiddlewares);

  return httpServer;
}
