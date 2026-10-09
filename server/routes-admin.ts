import { getRevenueAnalytics } from "./lib/adminRevenue";
import { isUniqueViolation } from "./db-errors";
import { getFlaggedTransactions, getFlaggedUsers } from "./lib/adminFlagged";
import { parsePage, pagination } from "./lib/pagination";
import { getOnboardingPipeline } from "./lib/adminOnboarding";
import { getBusinessRosterStats, businessGmvSql } from "./lib/adminBusinesses";
import { getAdminDashboardMetrics } from "./lib/adminDashboard";
import { cachedReport } from "./lib/reportCache";
import { z } from "zod";
import { parseCookies } from "./lib/cookies";
import { invalidateOrgAccess } from "./auth";
import { getOverCapReport } from "./lib/overCapReport";
import type { CountLimitType } from "./lib/entitlements";
import { listApiRoutes } from "./lib/listRoutes";
import { APP_SCREEN_PATHS } from "@shared/screens";
import { validateGateRule } from "@shared/gateRules";
import { FEATURES, checkDisableAllowed, getFeatureDef, PENDING_GATE_KEYS, type FeatureDef } from "@shared/features";
import {
  GateRuleError, computeRuleImpact, listRuleEvents as listGateRuleEvents, listRulesWithFeature, revertEvent as revertGateRuleEvent,
  createRule as createGateRule, updateRule as updateGateRule, enableRule as enableGateRule, disableRule as disableGateRule, deleteRule as deleteGateRule,
} from "./lib/gateRuleAdmin";
import { Router, type Request, type Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { db } from "./db";
import { eq, and, ne, like, desc, sql, gte, lte, count, inArray, or } from "drizzle-orm";
import {
  superAdmins,
  featureFlags,
  announcements,
  superAdminAuditLogs,
  organisations,
  pendingEmails,
  users,
  checkouts,
  staff,
  inventory,
  bookings,
  creditEntries, stores,
  organisationMembers,
  customers,
  subscriptions,
  subscriptionPayments,
  plans,
  supportThreads,
  supportThreadMessages,
  isGenuineSuspensionReason,
  passwordSchema,
  featureCatalog, pricingBundles,
  featureDependencies,
  orgFeatureEntitlements,
  insertFeatureCatalogSchema, platformPaymentCredentials,
  publishLegalDocumentVersionSchema,
  createLegalDocumentSchema
} from "@shared/schema";
import { grantFeatureEntitlement, invalidateFeatureCatalogCache } from "./lib/entitlements";
import { explainVisibility } from "./lib/featureVisibility";
import { flagUpdateProblem } from "./lib/flagRollout";
import { CAPS, CAP_ORDER, isCapType, planThreshold, type CapType, type LadderStep } from "@shared/thresholds";
import { grandfatherApplies, sunsetDateProblem, sunsetTierProblem } from "./lib/publishRules";
import { cancelSunset, getSunsetState, scheduleSunset } from "./lib/featureSunset";
import { dependencyProblem } from "./lib/dependencyGraph";
import { publishFeature } from "./lib/featureSync";
import { listPendingReview } from "./lib/featureReviewNotice";
import { reactivateOrganisation, autoResolveSuspensionThreads } from "./lib/organisations";
import { slugifyBundleKey } from "@shared/bundles";
import { validateBundleMembers } from "./lib/pricing";
import { getExportBranding, getConfiguredTrialDays, getConfiguredGraceDays, setPlatformConfigValue, getPlatformConfigValue, getPhoneChangeOtpViaEmail, getWhatsAppPlatformConfigStatus, setWhatsAppPlatformConfig } from "./lib/platformConfig";
import { encryptSecret } from "./lib/credentialEncryption";
import { legalDocumentService } from "./services/LegalDocumentService";
import { verifyTOTP, generateSecret, getOTPAuthURL } from "./totp";
import { generateAdminToken, isAdminAuthenticated, requireAdminRole } from "./auth-admin";
import { broadcastDataChange, getConnectedClientCount } from "./websocket";
import { getRangeStats, getRouteStats, parseRange, RANGES } from "./lib/healthMetrics";
import { sendOtpEmail, sendPasswordChangedEmail, sendAdminInviteEmail, sendAdminMfaResetEmail } from "./email";
import { generateActivationCode, activationCodeExpiry, normalizeActivationCode } from "./lib/activation-code";
import { checkResendCooldown } from "./lib/otp-cooldown";

const ADMIN_CONSOLE_NAME = "Business Manager Admin Console";

const _JWT_TEMP_SECRET = process.env.JWT_ADMIN_SECRET;
if (!_JWT_TEMP_SECRET) throw new Error("FATAL: JWT_ADMIN_SECRET must be set.");
const JWT_TEMP_SECRET: string = _JWT_TEMP_SECRET;

// Safe user field projection — never returns credentials or OTP secrets
const safeUserFields = {
  id: users.id,
  name: users.name,
  email: users.email,
  phone: users.phone,
  role: users.role,
  status: users.status,
  isVerified: users.isVerified,
  isEmailVerified: users.isEmailVerified,
  isPhoneVerified: users.isPhoneVerified,
  profilePhotoUrl: users.profilePhotoUrl,
  loginAttempts: users.loginAttempts,
  lockedUntil: users.lockedUntil,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
  suspensionReason: users.suspensionReason,
  suspendedAt: users.suspendedAt,
} as const;

export const adminRouter = Router();

// Immutable Audit Log Helper
async function writeAuditLog(req: Request, action: string, target: string, details?: any) {
  const admin = req.admin;
  if (!admin) return;
  try {
    await db.insert(superAdminAuditLogs).values({
      adminId: admin.adminId,
      adminEmail: admin.email,
      adminRole: admin.role,
      action,
      target,
      ipAddress: req.ip || "127.0.0.1",
      details: details ? JSON.stringify(details) : null,
    });
  } catch (error) {
    console.error("Immutable Audit Log write failure:", error);
  }
}

// ----------------------------------------------------
// 1. ADMIN AUTHENTICATION ENDPOINTS
// ----------------------------------------------------

// Admin Login Step 1: Validate password and return MFA requirement status
adminRouter.post("/auth/login", async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  try {
    const [admin] = await db
      .select()
      .from(superAdmins)
      .where(eq(superAdmins.email, email.trim().toLowerCase()))
      .limit(1);

    if (!admin) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    if (admin.status === "invited") {
      return res.status(403).json({ error: "Your account setup isn't complete yet. Check your email for an activation link, or ask a super admin to resend your invite." });
    }
    if (admin.status !== "active") {
      return res.status(403).json({ error: "Administrative account is suspended." });
    }

    const matches = await bcrypt.compare(password, admin.passwordHash);
    if (!matches) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    // Generate short-lived (5 min) temporary token for MFA verification step
    const tempToken = jwt.sign(
      { adminId: admin.id, email: admin.email, action: "mfa_verify" },
      JWT_TEMP_SECRET,
      { expiresIn: "5m" }
    );

    // If MFA is not yet configured, return secret for first-time QR scan pairing
    if (!admin.mfaEnabled || !admin.mfaSecret) {
      const newSecret = admin.mfaSecret || generateSecret();
      if (!admin.mfaSecret) {
        await db.update(superAdmins).set({ mfaSecret: newSecret }).where(eq(superAdmins.id, admin.id));
      }
      const qrUrl = getOTPAuthURL(admin.email, "BusinessManager-Admin", newSecret);
      return res.json({
        mfaRequired: true,
        mfaConfigured: false,
        mfaSecret: newSecret,
        qrUrl,
        tempToken,
      });
    }

    return res.json({
      mfaRequired: true,
      mfaConfigured: true,
      tempToken,
    });
  } catch (error) {
    console.error("Admin Auth Login Step 1 error:", error);
    return res.status(500).json({ error: "Internal server authentication error." });
  }
});

// Admin Login Step 2: Validate 6-digit TOTP token and issue full session cookie
adminRouter.post("/auth/verify-mfa", async (req: Request, res: Response) => {
  const { tempToken, code } = req.body;

  if (!tempToken || !code) {
    return res.status(400).json({ error: "Temporary token and MFA verification code are required." });
  }

  try {
    // Decode temporary token
    let decoded: any;
    try {
      decoded = jwt.verify(tempToken, JWT_TEMP_SECRET);
    } catch (jwtErr) {
      return res.status(401).json({ error: "MFA session expired. Please enter password again." });
    }

    if (decoded.action !== "mfa_verify") {
      return res.status(401).json({ error: "Invalid session action." });
    }

    const [admin] = await db
      .select()
      .from(superAdmins)
      .where(eq(superAdmins.id, decoded.adminId))
      .limit(1);

    if (!admin || admin.status !== "active") {
      return res.status(401).json({ error: "Admin account suspended or deleted." });
    }

    if (!admin.mfaSecret) {
      return res.status(400).json({ error: "MFA pairing secret not found. Re-run login." });
    }

    const isDevBypass = process.env.NODE_ENV !== "production" && code === "000000";
    const isValid = isDevBypass || verifyTOTP(code, admin.mfaSecret);
    if (!isValid) {
      return res.status(401).json({ error: "Invalid 6-digit verification code." });
    }

    // Update status to active MFA and timestamp
    await db
      .update(superAdmins)
      .set({ mfaEnabled: true, lastLoginAt: new Date() })
      .where(eq(superAdmins.id, admin.id));

    // Generate isolated administrative JWT
    const token = generateAdminToken({
      adminId: admin.id,
      email: admin.email,
      role: admin.role,
      name: admin.name,
    });

    // Write session cookie admin_sid
    res.cookie("admin_sid", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 2 * 60 * 60 * 1000, // 2 hours inactivity limit
    });

    // Log in operations ledger
    await db.insert(superAdminAuditLogs).values({
      adminId: admin.id,
      adminEmail: admin.email,
      adminRole: admin.role,
      action: "admin_login",
      target: "Self",
      ipAddress: req.ip || "127.0.0.1",
      details: JSON.stringify({ mfaMethod: "totp" }),
    });

    return res.json({
      success: true,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
      },
    });
  } catch (error) {
    console.error("Admin Verify MFA Step 2 error:", error);
    return res.status(500).json({ error: "Internal server verification error." });
  }
});

// ─── Admin onboarding (invite acceptance / MFA re-pairing) ─────────────────
// Three public (no isAdminAuthenticated) steps, mirroring the staff
// activation flow in server/routes.ts: activate -> [set-password, invite
// flow only] -> verify-mfa-setup. An admin_onboarding_token cookie (1h,
// modeled on generateContractPendingToken's contract_pending_token) scopes
// identity to one adminId across the steps without a full session.


function generateAdminOnboardingToken(adminId: string, needsPassword: boolean): string {
  return jwt.sign({ adminId, needsPassword, action: "admin_onboarding" }, JWT_TEMP_SECRET, { expiresIn: "1h" });
}

function verifyAdminOnboardingToken(token: string): { adminId: string; needsPassword: boolean } | undefined {
  try {
    const decoded = jwt.verify(token, JWT_TEMP_SECRET) as any;
    if (decoded.action !== "admin_onboarding") return undefined;
    return { adminId: decoded.adminId, needsPassword: !!decoded.needsPassword };
  } catch {
    return undefined;
  }
}

// Step 1: validate the emailed activation code (invite, or an MFA-only
// re-pair issued by reset-mfa). Generates the TOTP secret right away and
// returns its QR payload — the only place it's ever shown, to the invitee's
// own browser on their own onboarding page.
adminRouter.post("/auth/activate", async (req: Request, res: Response) => {
  const { email, code } = req.body;
  if (!email || !code) {
    return res.status(400).json({ error: "Email and activation code are required." });
  }

  try {
    const [admin] = await db.select().from(superAdmins).where(eq(superAdmins.email, email.trim().toLowerCase())).limit(1);
    if (!admin) {
      return res.status(400).json({ error: "Invalid activation code." });
    }

    const cleanInput = normalizeActivationCode(code);
    const cleanStored = admin.activationCode ? normalizeActivationCode(admin.activationCode) : "";
    const codeMatch = cleanStored.length > 0 &&
      cleanInput.length === cleanStored.length &&
      crypto.timingSafeEqual(Buffer.from(cleanInput), Buffer.from(cleanStored));
    if (!codeMatch) {
      return res.status(400).json({ error: "Invalid activation code." });
    }
    if (admin.activationCodeUsed) {
      return res.status(400).json({ error: "This code has already been used. Ask a super admin to resend your invite." });
    }
    if (admin.activationCodeExpiry && new Date() > new Date(admin.activationCodeExpiry)) {
      return res.status(400).json({ error: "This activation code has expired. Ask a super admin to resend your invite." });
    }

    const needsPassword = admin.status === "invited";
    const mfaSecret = generateSecret();
    const qrUrl = getOTPAuthURL(admin.email, "BusinessManager-Admin", mfaSecret);

    await db.update(superAdmins).set({ activationCodeUsed: true, mfaSecret }).where(eq(superAdmins.id, admin.id));

    const onboardingToken = generateAdminOnboardingToken(admin.id, needsPassword);
    res.cookie("admin_onboarding_token", onboardingToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 1000,
    });

    return res.json({
      success: true,
      name: admin.name,
      nextStep: needsPassword ? "create-password" : "setup-mfa",
      qrUrl,
    });
  } catch (error) {
    console.error("Admin activate error:", error);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// Step 2 (invite flow only — skipped for an MFA-only re-pair): the invitee
// chooses their own password. No secret changes hands here; the QR from
// step 1 is still what the client renders next.
adminRouter.post("/auth/set-password", async (req: Request, res: Response) => {
  const { password } = req.body;
  const token = parseCookies(req.headers.cookie).admin_onboarding_token;
  const claims = token ? verifyAdminOnboardingToken(token) : undefined;
  if (!claims) {
    return res.status(401).json({ error: "Onboarding session expired. Please use your invitation link again." });
  }
  if (!password) {
    return res.status(400).json({ error: "Password is required." });
  }

  const pwdVal = passwordSchema.safeParse(password);
  if (!pwdVal.success) {
    return res.status(400).json({ error: pwdVal.error.errors[0].message });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    await db.update(superAdmins).set({ passwordHash }).where(eq(superAdmins.id, claims.adminId));

    // Re-issue the cookie with needsPassword now cleared, so verify-mfa-setup
    // below can tell "password step done" apart from "invite flow skipped
    // straight past it" without trusting anything the client sends.
    const refreshedToken = generateAdminOnboardingToken(claims.adminId, false);
    res.cookie("admin_onboarding_token", refreshedToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 1000,
    });

    return res.json({ success: true, nextStep: "setup-mfa" });
  } catch (error) {
    console.error("Admin set-password error:", error);
    return res.status(500).json({ error: "Failed to set password." });
  }
});

// Step 3: verify the first TOTP code against the secret generated in step 1.
// On success this completes onboarding — flips the account active and logs
// the invitee straight in, same as the routine login verify-mfa above.
adminRouter.post("/auth/verify-mfa-setup", async (req: Request, res: Response) => {
  const { code } = req.body;
  const token = parseCookies(req.headers.cookie).admin_onboarding_token;
  const claims = token ? verifyAdminOnboardingToken(token) : undefined;
  if (!claims) {
    return res.status(401).json({ error: "Onboarding session expired. Please use your invitation link again." });
  }
  if (!code) {
    return res.status(400).json({ error: "Verification code is required." });
  }

  try {
    const [admin] = await db.select().from(superAdmins).where(eq(superAdmins.id, claims.adminId)).limit(1);
    if (!admin || !admin.mfaSecret) {
      return res.status(400).json({ error: "No pending MFA pairing found. Please use your invitation link again." });
    }
    if (claims.needsPassword) {
      // Cookie still reflects the pre-set-password state (that endpoint
      // re-issues it with needsPassword: false on success) - guards against
      // skipping straight from activate to verify-mfa-setup on an invite
      // that still has its placeholder password.
      return res.status(400).json({ error: "Please set your password first." });
    }

    const isDevBypass = process.env.NODE_ENV !== "production" && code === "000000";
    const isValid = isDevBypass || verifyTOTP(code, admin.mfaSecret);
    if (!isValid) {
      return res.status(401).json({ error: "Invalid 6-digit verification code." });
    }

    await db
      .update(superAdmins)
      .set({
        mfaEnabled: true,
        status: "active",
        activationCode: null,
        activationCodeExpiry: null,
        resendAttempts: 0,
        resendWindowStart: null,
        lastLoginAt: new Date(),
      })
      .where(eq(superAdmins.id, admin.id));

    res.clearCookie("admin_onboarding_token");

    const sessionToken = generateAdminToken({
      adminId: admin.id,
      email: admin.email,
      role: admin.role,
      name: admin.name,
    });
    res.cookie("admin_sid", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 2 * 60 * 60 * 1000,
    });

    await db.insert(superAdminAuditLogs).values({
      adminId: admin.id,
      adminEmail: admin.email,
      adminRole: admin.role,
      action: "admin_onboarding_completed",
      target: "Self",
      ipAddress: req.ip || "127.0.0.1",
      details: JSON.stringify({ mfaMethod: "totp" }),
    });

    return res.json({
      success: true,
      admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
    });
  } catch (error) {
    console.error("Admin verify-mfa-setup error:", error);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// Admin Forgot Password Step 1: request an email OTP reset code
adminRouter.post("/auth/forgot-password", async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: "Admin email address is required." });
  }

  // Always return this generic response to avoid leaking which emails are registered admins
  const genericResponse = { message: "If an administrative account exists for this email, a reset code has been sent." };

  try {
    const [admin] = await db
      .select()
      .from(superAdmins)
      .where(eq(superAdmins.email, email.trim().toLowerCase()))
      .limit(1);

    if (!admin || admin.status !== "active") {
      return res.json(genericResponse);
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await db
      .update(superAdmins)
      .set({ otpCode: otp, otpExpiry: expiresAt, otpAttempts: 0 })
      .where(eq(superAdmins.id, admin.id));

    await sendOtpEmail(admin.email, admin.name, otp, ADMIN_CONSOLE_NAME);

    return res.json(genericResponse);
  } catch (error) {
    console.error("Admin forgot password error:", error);
    return res.status(500).json({ error: "Failed to process password reset request." });
  }
});

// Admin Forgot Password Step 2: verify the OTP and set a new password
adminRouter.post("/auth/reset-password", async (req: Request, res: Response) => {
  const { email, otp, password } = req.body;
  if (!email || !otp || !password) {
    return res.status(400).json({ error: "Email, reset code, and new password are required." });
  }
  const passwordCheck = passwordSchema.safeParse(password);
  if (!passwordCheck.success) {
    return res.status(400).json({ error: passwordCheck.error.errors[0].message });
  }

  try {
    const [admin] = await db
      .select()
      .from(superAdmins)
      .where(eq(superAdmins.email, email.trim().toLowerCase()))
      .limit(1);

    if (!admin || admin.status !== "active" || !admin.otpCode || !admin.otpExpiry) {
      return res.status(400).json({ error: "Invalid or expired reset code." });
    }

    if (admin.otpAttempts >= 5) {
      return res.status(429).json({ error: "Too many failed attempts. Please request a new reset code." });
    }

    const submittedOtp = String(otp);
    const isDevBypass = process.env.NODE_ENV !== "production" && submittedOtp === "000000";
    const otpMatch =
      isDevBypass ||
      (submittedOtp.length === admin.otpCode.length &&
        crypto.timingSafeEqual(Buffer.from(admin.otpCode), Buffer.from(submittedOtp)));

    if (!otpMatch || (!isDevBypass && new Date() > new Date(admin.otpExpiry))) {
      await db
        .update(superAdmins)
        .set({ otpAttempts: admin.otpAttempts + 1 })
        .where(eq(superAdmins.id, admin.id));
      return res.status(400).json({ error: "Invalid or expired reset code." });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await db
      .update(superAdmins)
      .set({ passwordHash, otpCode: null, otpExpiry: null, otpAttempts: 0 })
      .where(eq(superAdmins.id, admin.id));

    await db.insert(superAdminAuditLogs).values({
      adminId: admin.id,
      adminEmail: admin.email,
      adminRole: admin.role,
      action: "admin_password_reset",
      target: "Self",
      ipAddress: req.ip || "127.0.0.1",
      details: JSON.stringify({ method: "otp_email" }),
    });

    await sendPasswordChangedEmail(admin.email, admin.name, ADMIN_CONSOLE_NAME);

    return res.json({ message: "Password reset successfully. Please log in with your new password." });
  } catch (error) {
    console.error("Admin reset password error:", error);
    return res.status(500).json({ error: "Failed to reset password." });
  }
});

// Admin Profile
adminRouter.get("/auth/me", isAdminAuthenticated, (req: Request, res: Response) => {
  return res.json({ admin: req.admin });
});

// Admin Logout
adminRouter.post("/auth/logout", isAdminAuthenticated, async (req: Request, res: Response) => {
  await writeAuditLog(req, "admin_logout", "Self");
  res.clearCookie("admin_sid");
  return res.json({ success: true });
});

// ----------------------------------------------------
// 2. DASHBOARD OVERVIEW ENDPOINTS
// ----------------------------------------------------

adminRouter.get("/dashboard/metrics", isAdminAuthenticated, async (_req: Request, res: Response) => {
  try {
    // Polled by every open admin tab. The figures are platform-wide and a half-minute old is fine for an
    // operations overview, so one computation serves them all.
    const metrics = await cachedReport({ name: "adminDashboardMetrics", tags: ["admin"] }, () => getAdminDashboardMetrics());
    return res.json(metrics);
  } catch (error) {
    console.error("Dashboard Metrics retrieval error:", error);
    return res.status(500).json({ error: "Failed to compile dashboard operations overview." });
  }
});

// ----------------------------------------------------
// 3. BUSINESS MANAGEMENT ENDPOINTS
// ----------------------------------------------------

// List all businesses with pagination, filters, and searches
adminRouter.get("/businesses", isAdminAuthenticated, async (req: Request, res: Response) => {
  const { search, status, minGMV, maxGMV, page = "1", limit = "15" } = req.query;

  const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 15));
  const offset = (pageNum - 1) * limitNum;

  try {
    let whereClauses = [];

    // Filter status
    if (status) {
      whereClauses.push(eq(organisations.status, status as string));
    }

    // Exclude soft deleted unless queried specifically
    whereClauses.push(sql`${organisations.deletedAt} is null`);

    // Search query: trading name
    if (search) {
      whereClauses.push(like(organisations.name, `%${search}%`));
    }

    // Gross-sales range, applied before paging so the page and the total both respect it (it used to filter the
    // page after the fact, which left short pages and a total that ignored the filter).
    const minGmvValue = minGMV ? parseFloat(minGMV as string) : NaN;
    const maxGmvValue = maxGMV ? parseFloat(maxGMV as string) : NaN;
    if (Number.isFinite(minGmvValue)) whereClauses.push(sql`${businessGmvSql} >= ${minGmvValue}`);
    if (Number.isFinite(maxGmvValue)) whereClauses.push(sql`${businessGmvSql} <= ${maxGmvValue}`);

    const queryWhere = whereClauses.length > 0 ? and(...whereClauses) : undefined;

    // Fetch roster of matching businesses
    const [matchedOrgs, [totalCountResult]] = await Promise.all([
      db.select().from(organisations).where(queryWhere).orderBy(desc(organisations.createdAt)).limit(limitNum).offset(offset),
      db.select({ value: count() }).from(organisations).where(queryWhere),
    ]);
    const totalBusinessesCount = totalCountResult.value;

    // The page's sales, staff and owners come from three queries for the whole page.
    const stats = await getBusinessRosterStats(matchedOrgs.map((o) => o.id));
    const businessesRoster = matchedOrgs.map((org) => {
      const sales = stats.sales.get(org.id);
      const owner = stats.owners.get(org.id);
      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        receiptPrefix: org.receiptPrefix,
        createdAt: org.createdAt,
        status: org.status,
        owner: owner
          ? { name: owner.name || "Owner Account", email: owner.email || owner.phone || "No Email" }
          : { name: "Unconfigured", email: "Unconfigured" },
        location: org.address || "Nigeria",
        staffCount: stats.staff.get(org.id) ?? 0,
        transactionsCount: sales?.txCount ?? 0,
        gmv: sales?.gmv ?? 0,
        lastActive: sales?.latest ?? org.createdAt,
      };
    });

    return res.json({
      businesses: businessesRoster,
      pagination: {
        total: totalBusinessesCount,
        page: pageNum,
        totalPages: Math.ceil(totalBusinessesCount / limitNum),
      },
    });
  } catch (error) {
    console.error("List Businesses retrieval error:", error);
    return res.status(500).json({ error: "Failed to fetch organisations directory." });
  }
});

// Get business details by ID
adminRouter.get("/businesses/:id", isAdminAuthenticated, async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const [org] = await db.select().from(organisations).where(eq(organisations.id, id)).limit(1);
    if (!org) {
      return res.status(404).json({ error: "Business account not found." });
    }

    // Fetch stores
    const orgStores = await db.select().from(stores).where(eq(stores.businessId, org.id));
    const storeIds = orgStores.map(s => s.id);

    // Sum statistics
    let txCount = 0;
    let totalGMV = 0;
    let customerCount = 0;
    let staffCount = 0;
    let inventoryCount = 0;
    let bookingsCount = 0;
    let outstandingCredit = 0;

    let monthlySalesCount = 0;
    let monthlyGMV = 0;
    let monthlyCustomers = 0;
    let activeStaffDays = 30; // mock index

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    if (storeIds.length > 0) {
      // Total Sales & GMV
      const sales = await db
        .select({ totalPrice: checkouts.totalPrice, createdAt: checkouts.createdAt })
        .from(checkouts)
        .where(and(inArray(checkouts.storeId, storeIds), eq(checkouts.isVoided, false)));
      
      txCount = sales.length;
      totalGMV = sales.reduce((sum, item) => sum + (item.totalPrice || 0), 0);

      // Monthly sales
      const monthlySales = sales.filter(s => s.createdAt >= thirtyDaysAgo);
      monthlySalesCount = monthlySales.length;
      monthlyGMV = monthlySales.reduce((sum, item) => sum + (item.totalPrice || 0), 0);

      // Customers
      const [custCount] = await db
        .select({ value: count() })
        .from(customers)
        .where(inArray(customers.storeId, storeIds));
      customerCount = custCount.value;

      const [monthlyCustCount] = await db
        .select({ value: count() })
        .from(customers)
        .where(and(inArray(customers.storeId, storeIds), gte(customers.createdAt, thirtyDaysAgo)));
      monthlyCustomers = monthlyCustCount.value;

      // Staff
      const [stfCount] = await db
        .select({ value: count() })
        .from(staff)
        .where(and(inArray(staff.storeId, storeIds), eq(staff.isArchived, false)));
      staffCount = stfCount.value;

      // Inventory
      const [invCount] = await db
        .select({ value: count() })
        .from(inventory)
        .where(inArray(inventory.storeId, storeIds));
      inventoryCount = invCount.value;

      // Bookings
      const [bookCount] = await db
        .select({ value: count() })
        .from(bookings)
        .where(inArray(bookings.storeId, storeIds));
      bookingsCount = bookCount.value;

      // Credit entries outstanding
      const credits = await db
        .select({ amountRemaining: creditEntries.outstandingBalance })
        .from(creditEntries)
        .where(and(inArray(creditEntries.storeId, storeIds), inArray(creditEntries.status, ["owing", "overdue", "partial"])));
      
      outstandingCredit = credits.reduce((sum, item) => sum + (Number(item.amountRemaining) || 0), 0);
    }

    // Owner info
    const [primaryMember] = await db
      .select()
      .from(organisationMembers)
      .where(and(eq(organisationMembers.organisationId, org.id), eq(organisationMembers.role, "owner")))
      .limit(1);

    let ownerUser = null;
    if (primaryMember) {
      const [userRec] = await db.select(safeUserFields).from(users).where(eq(users.id, primaryMember.userId)).limit(1);
      ownerUser = userRec;
    }

    // Roster of Users
    const memberRoster = await db
      .select({
        member: organisationMembers,
        user: safeUserFields,
      })
      .from(organisationMembers)
      .innerJoin(users, eq(organisationMembers.userId, users.id))
      .where(eq(organisationMembers.organisationId, org.id));

    const usersList = memberRoster.map(row => ({
      id: row.user.id,
      name: row.user.name || "Business User",
      email: row.user.email || row.user.phone || "No Contact",
      role: row.member.role,
      status: row.user.status,
      lastLogin: row.user.lastLoginAt,
    }));

    // Transactions list
    let recentTx: any[] = [];
    if (storeIds.length > 0) {
      recentTx = await db
        .select({
          checkout: checkouts,
        })
        .from(checkouts)
        .where(inArray(checkouts.storeId, storeIds))
        .orderBy(desc(checkouts.createdAt))
        .limit(20);
    }

    // Activity log from audit trail
    const auditLogs = await db
      .select()
      .from(superAdminAuditLogs)
      .where(eq(superAdminAuditLogs.target, org.name))
      .orderBy(desc(superAdminAuditLogs.createdAt))
      .limit(15);

    return res.json({
      profile: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        receiptPrefix: org.receiptPrefix,
        address: org.address,
        phone: org.phone,
        createdAt: org.createdAt,
        status: org.status,
        suspensionReason: org.suspensionReason,
        suspensionNote: org.suspensionNote,
        suspendedAt: org.suspendedAt,
        owner: ownerUser
          ? {
              name: ownerUser.name,
              email: ownerUser.email,
              phone: ownerUser.phone,
            }
          : null,
      },
      usageSummary: {
        allTime: {
          transactions: txCount,
          gmv: totalGMV,
          customers: customerCount,
          staff: staffCount,
          inventoryItems: inventoryCount,
          bookings: bookingsCount,
          outstandingCredit,
        },
        last30Days: {
          transactions: monthlySalesCount,
          gmv: monthlyGMV,
          newCustomers: monthlyCustomers,
          activeStaffDays,
        },
      },
      users: usersList,
      transactions: recentTx.map(r => r.checkout),
      activityLogs: auditLogs,
    });
  } catch (error) {
    console.error("Retrieve Business Details error:", error);
    return res.status(500).json({ error: "Failed to query business details." });
  }
});

// Suspend business
adminRouter.post("/businesses/:id/suspend", isAdminAuthenticated, requireAdminRole(["super_admin", "ops_manager"]), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { reason, note } = req.body;

  if (!reason) {
    return res.status(400).json({ error: "Suspension reason is required." });
  }

  try {
    const [org] = await db.select().from(organisations).where(eq(organisations.id, id)).limit(1);
    if (!org) {
      return res.status(404).json({ error: "Business account not found." });
    }

    // Set suspended in DB
    await db
      .update(organisations)
      .set({
        status: "suspended",
        suspensionReason: reason,
        suspensionNote: note,
        suspendedAt: new Date(),
      })
      .where(eq(organisations.id, org.id));

    invalidateOrgAccess(org.id);
    broadcastDataChange(org.id, "business");

    // Log administrative override in operations ledger
    await writeAuditLog(req, "suspend_business", org.name, { reason, note });

    return res.json({ success: true, message: `Business '${org.name}' successfully suspended.` });
  } catch (error) {
    console.error("Suspend Business error:", error);
    return res.status(500).json({ error: "Failed to execute suspension." });
  }
});

// Reactivating a business (whether via this standalone endpoint or the
// support thread's "Reactivate & Resolve" action) changes organisations.status
// - gated identically wherever it happens, deliberately excluding
// support_agent (see SUPPORT_ROLES below, which does include it for actions
// that never touch business status).
const BUSINESS_STATUS_ROLES = ["super_admin", "ops_manager"] as const;

// Reactivate business
adminRouter.post("/businesses/:id/reactivate", isAdminAuthenticated, requireAdminRole([...BUSINESS_STATUS_ROLES]), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { note } = req.body;

  try {
    const [existing] = await db.select().from(organisations).where(eq(organisations.id, id)).limit(1);
    if (!existing) {
      return res.status(404).json({ error: "Business account not found." });
    }

    const org = await reactivateOrganisation(id, note);

    // Log administrative override
    await writeAuditLog(req, "reactivate_business", org.name, { note });

    // Sweeps any open suspension-reason support thread(s) for this org so a
    // thread never dangles "open" after the business is already active again.
    await autoResolveSuspensionThreads(org.id, req.admin!.adminId);

    return res.json({ success: true, message: `Business '${org.name}' successfully reactivated.` });
  } catch (error) {
    console.error("Reactivate Business error:", error);
    return res.status(500).json({ error: "Failed to restore business account." });
  }
});

// Support inbox: persistent per-user conversations with locked-out owners
// (suspended for policy/fraud/etc, not non-payment) and general Help &
// Support requests - see server/routes/support.routes.ts for the
// tenant-facing side. Unlike the old one-shot version, admins can reply.
const SUPPORT_ROLES = ["super_admin", "ops_manager", "support_agent"] as const;

adminRouter.get("/support-threads", isAdminAuthenticated, async (req: Request, res: Response) => {
  try {
    const status = (req.query.status as string) || "open";
    const page = parsePage(req.query, { defaultLimit: 50 });
    const statusFilter = status === "all" ? undefined : eq(supportThreads.status, status);
    // Unread for the admin: the last message came from the business, and the admin has not read since.
    const unread = sql`${supportThreads.lastMessageBySenderType} = 'user' AND (${supportThreads.adminLastReadAt} IS NULL OR ${supportThreads.adminLastReadAt} < ${supportThreads.lastMessageAt})`;

    const [rows, [counts]] = await Promise.all([
      db
        .select({
          id: supportThreads.id,
          reason: supportThreads.reason,
          status: supportThreads.status,
          createdAt: supportThreads.createdAt,
          lastMessageAt: supportThreads.lastMessageAt,
          lastMessageBySenderType: supportThreads.lastMessageBySenderType,
          resolvedAt: supportThreads.resolvedAt,
          resolutionOutcome: supportThreads.resolutionOutcome,
          adminLastReadAt: supportThreads.adminLastReadAt,
          organisationId: supportThreads.organisationId,
          organisationName: organisations.name,
          organisationStatus: organisations.status,
          organisationSuspensionReason: organisations.suspensionReason,
          userName: users.name,
          userEmail: users.email,
        })
        .from(supportThreads)
        .innerJoin(organisations, eq(supportThreads.organisationId, organisations.id))
        .innerJoin(users, eq(supportThreads.createdByUserId, users.id))
        .where(statusFilter)
        .orderBy(desc(supportThreads.lastMessageAt), desc(supportThreads.id))
        .limit(page.limit)
        .offset(page.offset),
      // Counted over every matching thread, not just this page, so the inbox's unread badge stays true.
      db
        .select({ total: count(), unread: sql<number>`(count(*) FILTER (WHERE ${unread}))::int` })
        .from(supportThreads)
        .innerJoin(organisations, eq(supportThreads.organisationId, organisations.id))
        .innerJoin(users, eq(supportThreads.createdByUserId, users.id))
        .where(statusFilter),
    ]);

    const withUnread = rows.map((t) => ({
      ...t,
      unreadForAdmin: t.lastMessageBySenderType === "user" && (!t.adminLastReadAt || t.adminLastReadAt < t.lastMessageAt),
    }));

    res.json({ data: withUnread, pagination: pagination(counts.total, page), unreadTotal: Number(counts.unread) });
  } catch (error) {
    console.error("GET /admin/support-threads error:", error);
    res.status(500).json({ error: "Failed to load support threads." });
  }
});

adminRouter.get("/support-threads/:id/messages", isAdminAuthenticated, async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    // The thread and its messages do not depend on each other, so they are read together.
    const [[row], messages] = await Promise.all([
      db
        .select({
          thread: supportThreads,
          organisationName: organisations.name,
          organisationStatus: organisations.status,
          organisationSuspensionReason: organisations.suspensionReason,
          userName: users.name,
          userEmail: users.email,
        })
        .from(supportThreads)
        .innerJoin(organisations, eq(supportThreads.organisationId, organisations.id))
        .innerJoin(users, eq(supportThreads.createdByUserId, users.id))
        .where(eq(supportThreads.id, id))
        .limit(1),
      db.select().from(supportThreadMessages).where(eq(supportThreadMessages.threadId, id)).orderBy(supportThreadMessages.createdAt),
    ]);
    if (!row) {
      return res.status(404).json({ error: "Support thread not found." });
    }
    const thread = {
      ...row.thread,
      organisationName: row.organisationName,
      organisationStatus: row.organisationStatus,
      organisationSuspensionReason: row.organisationSuspensionReason,
      userName: row.userName,
      userEmail: row.userEmail,
    };

    // This is polled every few seconds while a thread is open. Only write "read" when there is something new to
    // mark read, rather than updating the row on every poll.
    const latestMessage = messages.length > 0 ? messages[messages.length - 1].createdAt : null;
    const readAt = row.thread.adminLastReadAt;
    if (!readAt || (latestMessage && latestMessage > readAt)) {
      await db.update(supportThreads).set({ adminLastReadAt: new Date() }).where(eq(supportThreads.id, id));
    }

    res.json({ thread, messages });
  } catch (error) {
    console.error("GET /admin/support-threads/:id/messages error:", error);
    res.status(500).json({ error: "Failed to load support thread." });
  }
});

adminRouter.post("/support-threads/:id/messages", isAdminAuthenticated, requireAdminRole([...SUPPORT_ROLES]), async (req: Request, res: Response) => {
  const { id } = req.params;
  const body = (req.body?.message ?? "").toString().trim();
  try {
    if (!body || body.length > 2000) {
      return res.status(400).json({ error: "Please enter a message (up to 2000 characters)." });
    }

    const [thread] = await db.select().from(supportThreads).where(eq(supportThreads.id, id)).limit(1);
    if (!thread) {
      return res.status(404).json({ error: "Support thread not found." });
    }

    await db.insert(supportThreadMessages).values({
      threadId: id,
      senderType: "admin",
      senderAdminId: req.admin!.adminId,
      body,
    });

    await db
      .update(supportThreads)
      .set({ lastMessageAt: new Date(), lastMessageBySenderType: "admin", adminLastReadAt: new Date() })
      .where(eq(supportThreads.id, id));

    // The admin router has no req.user.businessId (separate auth world), so
    // call the websocket broadcast directly rather than the routes/helpers.ts
    // wrapper - this is what makes a reply show up live on the tenant's screen.
    broadcastDataChange(thread.organisationId, "support");

    await writeAuditLog(req, "reply_support_thread", thread.id, { organisationId: thread.organisationId });

    return res.status(201).json({ success: true });
  } catch (error) {
    console.error("Reply to support thread error:", error);
    return res.status(500).json({ error: "Failed to send reply." });
  }
});

adminRouter.post("/support-threads/:id/resolve", isAdminAuthenticated, requireAdminRole([...SUPPORT_ROLES]), async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const [thread] = await db.select().from(supportThreads).where(eq(supportThreads.id, id)).limit(1);
    if (!thread) {
      return res.status(404).json({ error: "Support thread not found." });
    }

    // A suspension-reason thread can't be waved through as generically
    // "resolved" while the business is still actually suspended - admins must
    // pick one of the two explicit outcomes below instead. Every other
    // thread (general/trial_expired/non_payment, or one whose org is already
    // active again) keeps this plain toggle exactly as before.
    if (isGenuineSuspensionReason(thread.reason)) {
      const [org] = await db.select({ status: organisations.status }).from(organisations).where(eq(organisations.id, thread.organisationId)).limit(1);
      if (org?.status === "suspended") {
        return res.status(400).json({
          error: 'This business is still suspended. Use "Reactivate & Resolve" or "Close — keep suspended" instead.',
        });
      }
    }

    await db
      .update(supportThreads)
      .set({ status: "resolved", resolvedAt: new Date(), resolvedByAdminId: req.admin!.adminId })
      .where(eq(supportThreads.id, id));

    await writeAuditLog(req, "resolve_support_thread", thread.id, { organisationId: thread.organisationId });

    return res.json({ success: true });
  } catch (error) {
    console.error("Resolve support thread error:", error);
    return res.status(500).json({ error: "Failed to resolve support thread." });
  }
});

// Lifts the linked business's suspension and resolves this thread (plus any
// sibling open suspension thread for the same org) in one action. Gated like
// the standalone reactivate endpoint - support_agent can reply and can close
// a thread with the suspension upheld, but can't be the one to unsuspend a
// business.
adminRouter.post("/support-threads/:id/reactivate-and-resolve", isAdminAuthenticated, requireAdminRole([...BUSINESS_STATUS_ROLES]), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { note } = req.body;
  try {
    const [thread] = await db.select().from(supportThreads).where(eq(supportThreads.id, id)).limit(1);
    if (!thread) {
      return res.status(404).json({ error: "Support thread not found." });
    }
    if (!isGenuineSuspensionReason(thread.reason)) {
      return res.status(400).json({ error: "This thread isn't tied to a suspension." });
    }

    const org = await reactivateOrganisation(thread.organisationId, note);
    if (!org) {
      return res.status(404).json({ error: "Business account not found." });
    }

    await writeAuditLog(req, "reactivate_and_resolve_support_thread", thread.id, { organisationId: thread.organisationId, note });

    // Sweeps this thread plus any other open suspension thread for the org,
    // stamping resolutionOutcome 'reactivated' and broadcasting per row.
    await autoResolveSuspensionThreads(org.id, req.admin!.adminId);

    return res.json({ success: true });
  } catch (error) {
    console.error("Reactivate-and-resolve support thread error:", error);
    return res.status(500).json({ error: "Failed to reactivate business and resolve thread." });
  }
});

// Resolves a suspension-reason thread while deliberately leaving the business
// suspended - only reachable once an admin has actually replied, so the
// owner isn't left locked out with no explanation.
adminRouter.post("/support-threads/:id/close-upheld", isAdminAuthenticated, requireAdminRole([...SUPPORT_ROLES]), async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const [thread] = await db.select().from(supportThreads).where(eq(supportThreads.id, id)).limit(1);
    if (!thread) {
      return res.status(404).json({ error: "Support thread not found." });
    }
    if (!isGenuineSuspensionReason(thread.reason)) {
      return res.status(400).json({ error: "This thread isn't tied to a suspension." });
    }

    const [hasAdminReply] = await db
      .select({ id: supportThreadMessages.id })
      .from(supportThreadMessages)
      .where(and(eq(supportThreadMessages.threadId, id), eq(supportThreadMessages.senderType, "admin")))
      .limit(1);
    if (!hasAdminReply) {
      return res.status(400).json({ error: "Reply to the owner with the reason before closing this thread as still suspended." });
    }

    await db
      .update(supportThreads)
      .set({ status: "resolved", resolvedAt: new Date(), resolvedByAdminId: req.admin!.adminId, resolutionOutcome: "suspension_upheld" })
      .where(eq(supportThreads.id, id));

    await writeAuditLog(req, "close_support_thread_suspension_upheld", thread.id, { organisationId: thread.organisationId });

    return res.json({ success: true });
  } catch (error) {
    console.error("Close support thread (suspension upheld) error:", error);
    return res.status(500).json({ error: "Failed to close support thread." });
  }
});

adminRouter.post("/support-threads/:id/reopen", isAdminAuthenticated, requireAdminRole([...SUPPORT_ROLES]), async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const [thread] = await db.select().from(supportThreads).where(eq(supportThreads.id, id)).limit(1);
    if (!thread) {
      return res.status(404).json({ error: "Support thread not found." });
    }

    try {
      // resolutionOutcome is intentionally left as-is here (not reset to
      // null) - it stays visible as history of the last real outcome even
      // across a reopen, and gets overwritten the next time this thread
      // actually resolves.
      await db
        .update(supportThreads)
        .set({ status: "open", resolvedAt: null, resolvedByAdminId: null })
        .where(eq(supportThreads.id, id));
    } catch (err: any) {
      if (isUniqueViolation(err)) {
        return res.status(409).json({ error: "This user already has a newer open conversation." });
      }
      throw err;
    }

    await writeAuditLog(req, "reopen_support_thread", thread.id, { organisationId: thread.organisationId });

    return res.json({ success: true });
  } catch (error) {
    console.error("Reopen support thread error:", error);
    return res.status(500).json({ error: "Failed to reopen support thread." });
  }
});

// Delete business (Soft delete with 30-day grace period)
adminRouter.delete("/businesses/:id", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { reason } = req.body;

  try {
    const [org] = await db.select().from(organisations).where(eq(organisations.id, id)).limit(1);
    if (!org) {
      return res.status(404).json({ error: "Business account not found." });
    }

    // Set deletedAt timestamp for grace period
    await db
      .update(organisations)
      .set({
        deletedAt: new Date(),
        deletionReason: reason || "Administrative soft-delete",
      })
      .where(eq(organisations.id, org.id));

    // Log administrative override
    await writeAuditLog(req, "delete_business_soft", org.name, { reason });

    return res.json({
      success: true,
      message: `Business '${org.name}' marked for deletion. It has entered a 30-day recovery grace period.`,
    });
  } catch (error) {
    console.error("Soft delete business error:", error);
    return res.status(500).json({ error: "Failed to place business in deletion pipeline." });
  }
});

// Cancel business deletion
adminRouter.post("/businesses/:id/cancel-deletion", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const [org] = await db.select().from(organisations).where(eq(organisations.id, id)).limit(1);
    if (!org) {
      return res.status(404).json({ error: "Business account not found." });
    }

    // Reset deletedAt fields
    await db
      .update(organisations)
      .set({
        deletedAt: null,
        deletionReason: null,
      })
      .where(eq(organisations.id, org.id));

    // Log override
    await writeAuditLog(req, "cancel_business_deletion", org.name);

    return res.json({ success: true, message: `Deletion cancelled. '${org.name}' restored to Active status.` });
  } catch (error) {
    console.error("Cancel deletion error:", error);
    return res.status(500).json({ error: "Failed to restore deletion grace state." });
  }
});

// Onboarding Funnel Pipelines
adminRouter.get("/onboarding/pipeline", isAdminAuthenticated, async (_req: Request, res: Response) => {
  try {
    // Exact counts per stage, with each stage's newest businesses (not every business on the platform).
    return res.json(await getOnboardingPipeline());
  } catch (error) {
    console.error("Funnel pipeline query failure:", error);
    return res.status(500).json({ error: "Failed to calculate funnel transitions." });
  }
});

// ----------------------------------------------------
// 4. USER CONTROL ENDPOINTS
// ----------------------------------------------------

// Roster of all users
adminRouter.get("/users", isAdminAuthenticated, async (req: Request, res: Response) => {
  const { role, status, search } = req.query;

  try {
    // Filtered, newest first and paged in the database. This used to select the whole user row (password hash
    // included) for every business membership on the platform, then filter in Node and return all of them.
    const displayName = sql`COALESCE(NULLIF(${users.name}, ''), 'Business User')`;
    const displayEmail = sql`COALESCE(NULLIF(${users.email}, ''), NULLIF(${users.phone}, ''), 'No Contact')`;
    const conditions: any[] = [];
    if (role) conditions.push(eq(organisationMembers.role, role as string));
    if (status) conditions.push(eq(users.status, status as string));
    if (search) {
      const pattern = `%${(search as string).replace(/[\\%_]/g, "\\$&")}%`;
      conditions.push(sql`(${displayName} ILIKE ${pattern} ESCAPE '\\' OR ${displayEmail} ILIKE ${pattern} ESCAPE '\\' OR ${organisations.name} ILIKE ${pattern} ESCAPE '\\')`);
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const page = parsePage(req.query, { defaultLimit: 25 });

    const [rows, [{ value: total }]] = await Promise.all([
      db
        .select({
          id: users.id,
          name: displayName,
          email: displayEmail,
          phone: users.phone,
          role: organisationMembers.role,
          business: organisations.name,
          registered: users.createdAt,
          lastLogin: users.lastLoginAt,
          status: users.status,
        })
        .from(organisationMembers)
        .innerJoin(users, eq(organisationMembers.userId, users.id))
        .innerJoin(organisations, eq(organisationMembers.organisationId, organisations.id))
        .where(where)
        .orderBy(desc(users.createdAt), desc(organisationMembers.id))
        .limit(page.limit)
        .offset(page.offset),
      db
        .select({ value: count() })
        .from(organisationMembers)
        .innerJoin(users, eq(organisationMembers.userId, users.id))
        .innerJoin(organisations, eq(organisationMembers.organisationId, organisations.id))
        .where(where),
    ]);

    return res.json({ users: rows, pagination: pagination(total, page) });
  } catch (error) {
    console.error("List users retrieval error:", error);
    return res.status(500).json({ error: "Failed to list platform accounts." });
  }
});

// Reset user password
adminRouter.post("/users/:id/reset-password", isAdminAuthenticated, requireAdminRole(["super_admin", "ops_manager"]), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { password } = req.body;

  if (!password || password.length < 8) {
    return res.status(400).json({ error: "Valid password of at least 8 characters is required." });
  }

  try {
    const [user] = await db.select(safeUserFields).from(users).where(eq(users.id, id)).limit(1);
    if (!user) {
      return res.status(404).json({ error: "User account not found." });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Update password in DB
    await db
      .update(users)
      .set({
        password: passwordHash, // backward compatibility
        passwordHash,
      })
      .where(eq(users.id, user.id));

    // Log override
    await writeAuditLog(req, "reset_user_password", user.email || user.phone || user.id);

    return res.json({ success: true, message: `Password successfully updated for user account.` });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({ error: "Failed to override account credentials." });
  }
});

// Suspend specific user account
adminRouter.post("/users/:id/suspend", isAdminAuthenticated, requireAdminRole(["super_admin", "ops_manager"]), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { reason } = req.body;

  try {
    const [user] = await db.select(safeUserFields).from(users).where(eq(users.id, id)).limit(1);
    if (!user) {
      return res.status(404).json({ error: "User account not found." });
    }

    const nextStatus = user.status === "deactivated" ? "active" : "deactivated";

    await db
      .update(users)
      .set({
        status: nextStatus,
        suspensionReason: nextStatus === "deactivated" ? reason || "Administrative lock" : null,
        suspendedAt: nextStatus === "deactivated" ? new Date() : null,
      })
      .where(eq(users.id, user.id));

    // Log override
    await writeAuditLog(req, nextStatus === "deactivated" ? "suspend_user" : "reactivate_user", user.email || user.phone || user.id, { reason });

    return res.json({
      success: true,
      message: `User account successfully ${nextStatus === "deactivated" ? "suspended" : "restored"}.`,
    });
  } catch (error) {
    console.error("Toggle user suspend error:", error);
    return res.status(500).json({ error: "Failed to update account suspension state." });
  }
});

// Scan anomalous flagged accounts
adminRouter.get("/users/flagged", isAdminAuthenticated, async (req: Request, res: Response) => {
  try {
    const page = parsePage(req.query, { defaultLimit: 24 });
    const { rows, total } = await getFlaggedUsers(page);
    return res.json({ flagged: rows, pagination: pagination(total, page) });
  } catch (error) {
    console.error("Flagged accounts scan failure:", error);
    return res.status(500).json({ error: "Failed to scan platform anomalies." });
  }
});

// ----------------------------------------------------
// 5. TRANSACTION MONITORING ENDPOINTS
// ----------------------------------------------------

// List all transactions platform-wide
adminRouter.get("/transactions", isAdminAuthenticated, async (req: Request, res: Response) => {
  try {
    const list = await db
      .select({
        checkout: checkouts,
        store: stores,
      })
      .from(checkouts)
      .innerJoin(stores, eq(checkouts.storeId, stores.id))
      .orderBy(desc(checkouts.createdAt))
      .limit(50);

    const formatted = list.map(row => ({
      id: row.checkout.id,
      reference: row.checkout.receiptNumber,
      business: row.store.name,
      date: row.checkout.createdAt,
      total: row.checkout.totalCharged,
      paymentMethod: row.checkout.paymentMethod,
      status: row.checkout.isVoided ? "Void" : row.checkout.paymentStatus,
    }));

    return res.json({ transactions: formatted });
  } catch (error) {
    console.error("Central transaction query error:", error);
    return res.status(500).json({ error: "Failed to fetch platform ledger." });
  }
});

// Filter anomalous flagged transactions
adminRouter.get("/transactions/flagged", isAdminAuthenticated, async (req: Request, res: Response) => {
  try {
    const page = parsePage(req.query, { defaultLimit: 24 });
    const { rows, total } = await getFlaggedTransactions(page);
    return res.json({ flagged: rows, pagination: pagination(total, page) });
  } catch (error) {
    console.error("Flagged transactions query error:", error);
    return res.status(500).json({ error: "Failed to scan platform anomalies." });
  }
});

// Platform Revenue, MRR, ARR, active plans analytics
adminRouter.get("/transactions/analytics", isAdminAuthenticated, async (_req: Request, res: Response) => {
  try {
    // Platform-wide and slow-moving: one computation serves every open admin tab for half a minute.
    return res.json(await cachedReport({ name: "adminRevenueAnalytics", tags: ["admin"] }, () => getRevenueAnalytics()));
  } catch (error) {
    console.error("Platform financials query failure:", error);
    return res.status(500).json({ error: "Failed to calculate revenue aggregates." });
  }
});

// ----------------------------------------------------
// 5b. BILLING PAYMENTS — the ledger a super admin reviews for individual
// payment attempts (subscriptions above only ever holds current state).
// ----------------------------------------------------

adminRouter.get(
  "/billing/payments",
  isAdminAuthenticated,
  requireAdminRole(["super_admin", "ops_manager", "finance_admin"]),
  async (req: Request, res: Response) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || "25"), 10) || 25));
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const provider = typeof req.query.provider === "string" ? req.query.provider : undefined;
      const organisationId = typeof req.query.organisationId === "string" ? req.query.organisationId : undefined;

      const conditions = [];
      if (status) conditions.push(eq(subscriptionPayments.status, status));
      if (provider) conditions.push(eq(subscriptionPayments.provider, provider));
      if (organisationId) conditions.push(eq(subscriptionPayments.organisationId, organisationId));
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [rows, [{ total }]] = await Promise.all([
        db
          .select({
            payment: subscriptionPayments,
            organisationName: organisations.name,
            planName: plans.name,
          })
          .from(subscriptionPayments)
          .leftJoin(organisations, eq(subscriptionPayments.organisationId, organisations.id))
          .leftJoin(plans, eq(subscriptionPayments.planId, plans.id))
          .where(where)
          .orderBy(desc(subscriptionPayments.createdAt))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        db.select({ total: count() }).from(subscriptionPayments).where(where),
      ]);

      res.json({
        payments: rows.map(r => ({ ...r.payment, organisationName: r.organisationName, planName: r.planName })),
        page,
        pageSize,
        total,
      });
    } catch (error) {
      console.error("GET /admin/billing/payments error:", error);
      res.status(500).json({ error: "Failed to load payments." });
    }
  }
);

adminRouter.get(
  "/billing/subscriptions",
  isAdminAuthenticated,
  requireAdminRole(["super_admin", "ops_manager", "finance_admin"]),
  async (req: Request, res: Response) => {
    try {
      // One subscription per business, so this grows with the customer base: newest-updated first, a page at a time.
      const page = parsePage(req.query);
      const [rows, [{ value: total }]] = await Promise.all([
        db
          .select({
            subscription: subscriptions,
            organisationName: organisations.name,
            planName: plans.name,
          })
          .from(subscriptions)
          .leftJoin(organisations, eq(subscriptions.organisationId, organisations.id))
          .leftJoin(plans, eq(subscriptions.planId, plans.id))
          .orderBy(desc(subscriptions.updatedAt), desc(subscriptions.id))
          .limit(page.limit)
          .offset(page.offset),
        db.select({ value: count() }).from(subscriptions),
      ]);

      res.json({
        data: rows.map(r => ({ ...r.subscription, organisationName: r.organisationName, planName: r.planName })),
        pagination: pagination(total, page),
      });
    } catch (error) {
      console.error("GET /admin/billing/subscriptions error:", error);
      res.status(500).json({ error: "Failed to load subscriptions." });
    }
  }
);

// ----------------------------------------------------
// 6. FEATURE FLAGS ENDPOINTS
// ----------------------------------------------------

adminRouter.get("/feature-flags", isAdminAuthenticated, async (req: Request, res: Response) => {
  try {
    const list = await db.select().from(featureFlags).orderBy(featureFlags.name);
    return res.json({ flags: list });
  } catch (error) {
    return res.status(500).json({ error: "Failed to query feature flags." });
  }
});

// Flags are not created by hand: every feature_catalog row owns exactly one
// (created together with it by POST /feature-catalog or the registry sync), so
// a flag can never exist under a name that matches no feature.

adminRouter.put("/feature-flags/:id", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, scopedOrgIds, description } = req.body;

  try {
    const [flag] = await db.select().from(featureFlags).where(eq(featureFlags.id, id)).limit(1);
    if (!flag) {
      return res.status(404).json({ error: "Feature flag not found." });
    }

    const inputProblem = flagUpdateProblem({ status, scopedOrgIds }, flag);
    if (inputProblem) return res.status(400).json({ error: inputProblem });
    if (Array.isArray(scopedOrgIds) && scopedOrgIds.length) {
      const wanted = Array.from(new Set(scopedOrgIds as string[]));
      const found = await db.select({ id: organisations.id }).from(organisations).where(inArray(organisations.id, wanted));
      if (found.length !== wanted.length) return res.status(400).json({ error: "One or more of those businesses no longer exists." });
    }

    // "off" and "scoped" both turn the feature off for businesses outside the list.
    const turnsOff = (status === "off" || status === "scoped") && flag.status !== "off" && flag.status !== "scoped";
    if (turnsOff) {
      const blocked = checkDisableAllowed(flag.name, req.body?.confirmKey);
      if (blocked) return res.status(400).json({ error: blocked });
    }

    const [updatedFlag] = await db
      .update(featureFlags)
      .set({
        status: status !== undefined ? status : flag.status,
        scopedOrgIds: scopedOrgIds !== undefined ? Array.from(new Set(scopedOrgIds as string[])) : flag.scopedOrgIds,
        description: description !== undefined ? description : flag.description,
        updatedAt: new Date(),
        updatedBy: req.admin!.email,
      })
      .where(eq(featureFlags.id, id))
      .returning();
    invalidateFeatureCatalogCache();

    await writeAuditLog(req, "toggle_feature_flag", flag.name, {
      before: { status: flag.status, scopedOrgIds: flag.scopedOrgIds },
      status,
      scopedOrgIds,
    });

    return res.json({ success: true, flag: updatedFlag });
  } catch (error) {
    console.error("Update feature flag error:", error);
    return res.status(500).json({ error: "Failed to modify feature scope." });
  }
});

adminRouter.delete("/feature-flags/:id", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const [flag] = await db.select().from(featureFlags).where(eq(featureFlags.id, id)).limit(1);
    if (!flag) {
      return res.status(404).json({ error: "Feature flag not found." });
    }

    const [owner] = await db.select({ key: featureCatalog.key }).from(featureCatalog).where(eq(featureCatalog.flagId, id)).limit(1);
    if (owner) {
      return res.status(409).json({ error: `This flag belongs to the "${owner.key}" feature and cannot be deleted. Set it to "on" to re-enable the feature.` });
    }

    await db.delete(featureFlags).where(eq(featureFlags.id, id));
    invalidateFeatureCatalogCache();

    await writeAuditLog(req, "delete_feature_flag", flag.name);

    return res.json({ success: true, message: "Feature flag deleted." });
  } catch (error) {
    console.error("Delete feature flag error:", error);
    return res.status(500).json({ error: "Failed to purge feature flag." });
  }
});

// ----------------------------------------------------
// 6b. FEATURE CATALOG ENDPOINTS (pay-per-feature pricing)
// ----------------------------------------------------
// Deliberately separate from featureFlags above: that table is a release
// kill-switch, this one is the monetization catalog super admins price and
// businesses purchase. They compose at read time (server/lib/entitlements.ts
// getOrgEntitlements) rather than merge, since a kill-switch and a price
// list answer different questions - see shared/schema/entitlements.ts.

// Businesses past a free-tier or plan cap (used > limit), with their owner's contact: the list to work from when
// deciding who to approach about seats. Read-only; nothing is sent from here.
adminRouter.get("/over-cap-report", isAdminAuthenticated, requireAdminRole(["super_admin", "finance_admin"]), async (req: Request, res: Response) => {
  const limitType = String(req.query.limitType ?? "staff_seats");
  if (!["staff_seats", "customer_count", "store_count", "item_count"].includes(limitType)) {
    return res.status(400).json({ error: "limitType must be staff_seats, customer_count, store_count or item_count." });
  }
  try {
    const rows = await getOverCapReport(limitType as CountLimitType);
    return res.json({ limitType, count: rows.length, rows });
  } catch (error) {
    console.error("Over-cap report error:", error);
    return res.status(500).json({ error: "Failed to build the over-cap report." });
  }
});

const METERED_LIMIT_TYPES = ["staff_seats", "customer_count", "store_count", "item_count"];

// Tier-specific fields the catalog form can set: a capped add-on needs a limit and the key the
// enforcement code switches on; a bundle child needs a bundle parent to be granted by.
async function tierFieldsProblem(row: { key?: string; tierType: string; freeLimit?: number | null; limitType?: string | null; tierCapacity?: number | null; parentFeatureId?: string | null }, opts: { keepUnlimited?: boolean } = {}): Promise<string | null> {
  if (row.tierType === "paid_metered_limit") {
    if (row.freeLimit == null || row.freeLimit < 0) return "A capped add-on needs a free limit.";
    if (!row.limitType || !METERED_LIMIT_TYPES.includes(row.limitType)) return "A capped add-on needs a limit type.";
    // Unlimited tiers are defined in the registry; the admin can only keep one that already exists.
    if (row.tierCapacity == null) {
      if (!opts.keepUnlimited) return "A capped add-on needs a new limit above its free limit.";
    } else if (row.tierCapacity <= row.freeLimit) {
      return "The new limit must be above the free limit.";
    } else {
      // Two tiers with the same limit would cover each other in the bigger-replaces-smaller logic.
      const sameLimit = [
        eq(featureCatalog.tierType, "paid_metered_limit"),
        eq(featureCatalog.limitType, row.limitType),
        eq(featureCatalog.tierCapacity, row.tierCapacity),
      ];
      if (row.key) sameLimit.push(ne(featureCatalog.key, row.key));
      const [dup] = await db.select({ name: featureCatalog.name }).from(featureCatalog).where(and(...sameLimit)).limit(1);
      if (dup) return `"${dup.name}" already offers a limit of ${row.tierCapacity}. Pick a different limit.`;
    }
  }
  if (row.tierType === "bundle_child") {
    if (!row.parentFeatureId) return "A bundle child needs a parent bundle.";
    const [parent] = await db.select().from(featureCatalog).where(eq(featureCatalog.id, row.parentFeatureId)).limit(1);
    if (!parent || (parent.tierType !== "bundle_parent" && parent.tierType !== "paid_metered_limit")) return "The parent must be a bundle or a capped add-on.";
  }
  return null;
}

adminRouter.get("/feature-catalog", isAdminAuthenticated, async (req: Request, res: Response) => {
  try {
    const list = await db.select().from(featureCatalog).orderBy(featureCatalog.sortOrder);
    return res.json({ features: list });
  } catch (error) {
    return res.status(500).json({ error: "Failed to query the feature catalog." });
  }
});

// ---- Cap thresholds -------------------------------------------------------------------------------------
// A threshold is a paid step above a feature's free cap ("Stores: up to 3"). It is an ordinary capped catalog
// row, so the limit logic and purchase flow treat it like a built-in pack; it starts pending review.

function capLadders(catalog: (typeof featureCatalog.$inferSelect)[]) {
  return CAP_ORDER.flatMap((limitType) => {
    const rows = catalog.filter((f) => f.tierType === "paid_metered_limit" && f.limitType === limitType);
    if (rows.length === 0) return [];
    const template = rows.find((f) => f.tierCapacity == null) ?? rows[0];
    const ladder: LadderStep[] = rows
      .map((f) => ({
        key: f.key,
        name: f.name,
        capacity: f.tierCapacity,
        priceMonthly: f.priceMonthly,
        state: (f.reviewStatus === "pending_review" ? "needs_review" : f.isActive ? "live" : "inactive") as LadderStep["state"],
      }))
      .sort((a, b) => (a.capacity ?? Infinity) - (b.capacity ?? Infinity));
    return [{ limitType, label: CAPS[limitType].label, unit: CAPS[limitType].unit, freeLimit: template.freeLimit ?? 0, ladder, template }];
  });
}

adminRouter.get("/feature-catalog/thresholds", isAdminAuthenticated, async (_req: Request, res: Response) => {
  try {
    const catalog = await db.select().from(featureCatalog);
    return res.json({ caps: capLadders(catalog).map(({ template: _t, ...cap }) => cap) });
  } catch (error) {
    console.error("List thresholds error:", error);
    return res.status(500).json({ error: "Failed to load the cap thresholds." });
  }
});

adminRouter.post("/feature-catalog/thresholds", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  const body = z.object({
    limitType: z.string(),
    limit: z.number(),
    priceMonthly: z.number().nonnegative(),
    priceAnnual: z.number().nonnegative().nullable().optional(),
  }).safeParse(req.body ?? {});
  if (!body.success || !isCapType(body.data.limitType)) return res.status(400).json({ error: "Pick a cap, a limit and a monthly price." });
  const { limitType, limit, priceMonthly, priceAnnual } = body.data as { limitType: CapType; limit: number; priceMonthly: number; priceAnnual?: number | null };
  try {
    const catalog = await db.select().from(featureCatalog);
    const cap = capLadders(catalog).find((c) => c.limitType === limitType);
    if (!cap) return res.status(400).json({ error: "That cap has no add-on to build a threshold from." });

    const plan = planThreshold({ cap: limitType, limit, freeLimit: cap.freeLimit, ladder: cap.ladder, existingKeys: new Set(catalog.map((f) => f.key)) });
    if (plan.problems.length) return res.status(400).json({ error: plan.problems.join(" ") });

    const t = cap.template;
    const created = await db.transaction(async (tx) => {
      const [flag] = await tx.insert(featureFlags).values({ name: plan.key, status: "on", description: plan.name, updatedBy: req.admin!.email }).returning();
      const [row] = await tx.insert(featureCatalog).values({
        key: plan.key,
        name: plan.name,
        description: plan.description,
        category: t.category,
        tierType: "paid_metered_limit",
        limitType,
        freeLimit: t.freeLimit,
        tierCapacity: limit,
        priceMonthly,
        priceAnnual: priceAnnual ?? null,
        currency: t.currency,
        parentFeatureId: t.parentFeatureId,
        groupParentFeatureId: t.groupParentFeatureId,
        permissionModule: t.permissionModule,
        section: t.section,
        sortOrder: Math.min(...catalog.filter((f) => f.limitType === limitType).map((f) => f.sortOrder ?? 9999)) - 1,
        isActive: false,
        reviewStatus: "pending_review",
        flagId: flag.id,
      }).returning();
      return row;
    });
    invalidateFeatureCatalogCache();
    await writeAuditLog(req, "create_feature_threshold", created.key, { limitType, limit, priceMonthly, priceAnnual: priceAnnual ?? null });
    return res.json({ success: true, feature: created });
  } catch (error) {
    if (isUniqueViolation(error)) return res.status(409).json({ error: "A feature with that key already exists." });
    console.error("Create threshold error:", error);
    return res.status(500).json({ error: "Failed to add this threshold." });
  }
});

// What publishing these features would do, before the admin commits: how many businesses get each one free
// (the same rule publishFeature applies), whether its gate rules are confirmed, and what it depends on.
adminRouter.post("/feature-catalog/publish-preview", isAdminAuthenticated, async (req: Request, res: Response) => {
  const body = z.object({ ids: z.array(z.string()).min(1).max(100) }).safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: "Pick at least one feature." });
  try {
    const catalog = await db.select().from(featureCatalog);
    const byKey = new Map(catalog.map((f) => [f.key, f]));
    const [{ n: orgCount }] = await db.select({ n: count() }).from(organisations);
    const items = body.data.ids.flatMap((id) => {
      const row = catalog.find((f) => f.id === id);
      if (!row) return [];
      const def = getFeatureDef(row.key);
      return [{
        id: row.id,
        key: row.key,
        alreadyPublished: row.reviewStatus !== "pending_review",
        grandfathered: grandfatherApplies(def, row.tierType) ? Number(orgCount) : 0,
        gatePending: PENDING_GATE_KEYS.includes(row.key),
        dependsOn: (def?.dependsOn ?? []).map((key) => {
          const dep = byKey.get(key);
          return { key, name: dep?.name ?? key, pending: dep?.reviewStatus === "pending_review", id: dep?.id ?? null };
        }),
      }];
    });
    return res.json({ items });
  } catch (error) {
    console.error("Publish preview error:", error);
    return res.status(500).json({ error: "Failed to preview this publish." });
  }
});

// Publishes several pending features in one go. Each goes through publishFeature (its own transaction), so a
// failure on one never rolls back the others; the response says which succeeded.
adminRouter.post("/feature-catalog/publish", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  const body = z.object({
    items: z.array(z.object({
      id: z.string(),
      priceMonthly: z.number().nonnegative().nullable().optional(),
      priceAnnual: z.number().nonnegative().nullable().optional(),
      gateConfirmed: z.boolean().optional(),
    })).min(1).max(100),
  }).safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: body.error.errors.map((e) => e.message).join(", ") });
  try {
    const catalog = await db.select().from(featureCatalog);
    // Validate everything first so a bad row stops the whole batch before anything goes live.
    const problems: { id: string; error: string }[] = [];
    for (const item of body.data.items) {
      const row = catalog.find((f) => f.id === item.id);
      if (!row) { problems.push({ id: item.id, error: "Feature not found." }); continue; }
      if (row.reviewStatus !== "pending_review") { problems.push({ id: item.id, error: `${row.name} is already published.` }); continue; }
      const price = publishProblem({ ...row, ...(item.priceMonthly !== undefined ? { priceMonthly: item.priceMonthly } : {}) });
      if (price) { problems.push({ id: item.id, error: `${row.name}: ${price}` }); continue; }
      if (PENDING_GATE_KEYS.includes(row.key) && !item.gateConfirmed) problems.push({ id: item.id, error: `${row.name}: confirm its gate rules first.` });
    }
    if (problems.length) return res.status(400).json({ error: problems.map((p) => p.error).join(" "), problems });

    const results: { id: string; key: string; ok: boolean; grandfathered?: number; error?: string }[] = [];
    for (const item of body.data.items) {
      const row = catalog.find((f) => f.id === item.id)!;
      try {
        const result = await publishFeature(item.id, { priceMonthly: item.priceMonthly, priceAnnual: item.priceAnnual });
        if (!result) { results.push({ id: item.id, key: row.key, ok: false, error: "Already published." }); continue; }
        await writeAuditLog(req, "publish_feature_catalog_entry", row.key, {
          price: { priceMonthly: item.priceMonthly, priceAnnual: item.priceAnnual },
          grandfathered: result.grandfathered,
          gateConfirmed: !!item.gateConfirmed,
          bulk: body.data.items.length > 1,
        });
        results.push({ id: item.id, key: row.key, ok: true, grandfathered: result.grandfathered });
      } catch (err) {
        console.error(`Bulk publish failed for ${row.key}:`, err);
        results.push({ id: item.id, key: row.key, ok: false, error: "Failed to publish." });
      }
    }
    const published = results.filter((r) => r.ok);
    return res.status(published.length === results.length ? 200 : 207).json({
      success: published.length === results.length,
      results,
      grandfathered: published.reduce((n, r) => n + (r.grandfathered ?? 0), 0),
    });
  } catch (error) {
    console.error("Bulk publish error:", error);
    return res.status(500).json({ error: "Failed to publish these features." });
  }
});

// One feature with its flag, why it is or is not visible, and the registry facts the detail screen shows.
// Static sub-paths (summary, thresholds, ...) must be registered above this.
adminRouter.get("/feature-catalog/:key", isAdminAuthenticated, async (req: Request, res: Response) => {
  try {
    const catalog = await db.select().from(featureCatalog).orderBy(featureCatalog.sortOrder);
    const feature = catalog.find((f) => f.key === req.params.key);
    if (!feature) return res.status(404).json({ error: "Feature not found." });

    const flags = await db.select().from(featureFlags);
    const flagStatusByKey = new Map(flags.map((f) => [f.name, f.status]));
    const flag = flags.find((f) => f.id === feature.flagId) ?? flags.find((f) => f.name === feature.key) ?? null;

    let scopedIds: string[] = [];
    const rawScoped: unknown = flag?.scopedOrgIds;
    const parsedScoped = typeof rawScoped === "string" ? (() => { try { return JSON.parse(rawScoped); } catch { return []; } })() : rawScoped;
    if (flag?.status === "scoped" && Array.isArray(parsedScoped)) scopedIds = parsedScoped.filter((v): v is string => typeof v === "string");
    const scopedOrgs = scopedIds.length
      ? await db.select({ id: organisations.id, name: organisations.name }).from(organisations).where(inArray(organisations.id, scopedIds))
      : [];

    const visibility = explainVisibility({ feature, catalog, flagStatusByKey, scopedCount: scopedIds.length });
    const def = getFeatureDef(feature.key);
    const parent = feature.parentFeatureId ? catalog.find((f) => f.id === feature.parentFeatureId) : undefined;
    return res.json({
      feature,
      flag,
      scopedOrgs,
      visibility,
      registry: {
        inRegistry: !!def,
        parentKey: parent?.key ?? null,
        dependsOn: def?.dependsOn ?? [],
        gatePending: PENDING_GATE_KEYS.includes(feature.key),
      },
    });
  } catch (error) {
    console.error("Get feature error:", error);
    return res.status(500).json({ error: "Failed to load this feature." });
  }
});

// Lightweight business lookup for the rollout picker (the roster endpoint also computes sales stats).
adminRouter.get("/organisations-search", isAdminAuthenticated, async (req: Request, res: Response) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) return res.json({ organisations: [] });
  try {
    const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
    const rows = await db
      .select({ id: organisations.id, name: organisations.name })
      .from(organisations)
      .where(and(sql`${organisations.deletedAt} is null`, sql`(${organisations.name} ilike ${`%${escaped}%`} or ${organisations.id}::text = ${q})`))
      .orderBy(organisations.name)
      .limit(8);
    return res.json({ organisations: rows });
  } catch (error) {
    console.error("Organisation search error:", error);
    return res.status(500).json({ error: "Failed to search businesses." });
  }
});

adminRouter.post("/feature-catalog", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  const parsed = insertFeatureCatalogSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors.map((e) => e.message).join(", ") });
  }
  const problem = await tierFieldsProblem(parsed.data);
  if (problem) return res.status(400).json({ error: problem });
  try {
    const created = await db.transaction(async (tx) => {
      const [flag] = await tx
        .insert(featureFlags)
        .values({ name: parsed.data.key, status: "on", description: parsed.data.name, updatedBy: req.admin!.email })
        .returning();
      const [row] = await tx.insert(featureCatalog).values({ ...parsed.data, flagId: flag.id }).returning();
      return row;
    });
    invalidateFeatureCatalogCache();
    await writeAuditLog(req, "create_feature_catalog_entry", created.key, { category: created.category, tierType: created.tierType });
    return res.json({ success: true, feature: created });
  } catch (error) {
    console.error("Create feature catalog entry error:", error);
    return res.status(500).json({ error: "Failed to register this feature." });
  }
});

adminRouter.put("/feature-catalog/:id", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const [existing] = await db.select().from(featureCatalog).where(eq(featureCatalog.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: "Feature not found." });

    // The key is also the feature's flag name and what every gate refers to, so it never changes.
    const patch = insertFeatureCatalogSchema.partial().omit({ key: true }).safeParse(req.body);
    if (!patch.success) {
      return res.status(400).json({ error: patch.error.errors.map((e) => e.message).join(", ") });
    }

    const tierProblem = await tierFieldsProblem(
      { ...existing, ...patch.data },
      { keepUnlimited: existing.tierType === "paid_metered_limit" && existing.tierCapacity == null },
    );
    if (tierProblem) return res.status(400).json({ error: tierProblem });

    // Switching a core feature off hits every business at once: refuse it, or ask for the key as confirmation.
    if (patch.data.isActive === false && existing.isActive) {
      const blocked = checkDisableAllowed(existing.key, req.body?.confirmKey);
      if (blocked) return res.status(400).json({ error: blocked });
    }

    // Turning a feature that is pending review on is publishing it: do it through the one path that also
    // clears the review state and runs the grandfathering the sync held back.
    if (patch.data.isActive === true && existing.reviewStatus === "pending_review") {
      const problem = publishProblem({ ...existing, ...patch.data });
      if (problem) return res.status(400).json({ error: problem });
      await publishFeature(id, { priceMonthly: patch.data.priceMonthly, priceAnnual: patch.data.priceAnnual });
    }

    const [updated] = await db
      .update(featureCatalog)
      .set({ ...patch.data, updatedAt: new Date() })
      .where(eq(featureCatalog.id, id))
      .returning();
    invalidateFeatureCatalogCache();

    await writeAuditLog(req, "update_feature_catalog_pricing", existing.key, { before: existing, after: updated, changed: patch.data });
    return res.json({ success: true, feature: updated });
  } catch (error) {
    console.error("Update feature catalog entry error:", error);
    return res.status(500).json({ error: "Failed to update this feature." });
  }
});

/** A priced feature cannot go live without a price. */
function publishProblem(row: { tierType: string; priceMonthly?: number | null }): string | null {
  const priced = row.tierType === "paid_flat" || row.tierType === "paid_metered_limit" || row.tierType === "bundle_parent";
  return priced && row.priceMonthly == null ? "Set a monthly price before publishing." : null;
}

// Takes a feature the registry sync created (pending review, inactive) live: optional price, then active, then
// the free-to-existing-businesses grant the sync held back. Safe to repeat: a published feature returns 409.
adminRouter.post("/feature-catalog/:id/publish", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  const body = z.object({
    priceMonthly: z.number().nonnegative().nullable().optional(),
    priceAnnual: z.number().nonnegative().nullable().optional(),
  }).safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: body.error.errors.map((e) => e.message).join(", ") });
  try {
    const [existing] = await db.select().from(featureCatalog).where(eq(featureCatalog.id, req.params.id)).limit(1);
    if (!existing) return res.status(404).json({ error: "Feature not found." });
    if (existing.reviewStatus !== "pending_review") return res.status(409).json({ error: "This feature is already published." });
    const problem = publishProblem({ ...existing, ...(body.data.priceMonthly !== undefined ? { priceMonthly: body.data.priceMonthly } : {}) });
    if (problem) return res.status(400).json({ error: problem });
    const result = await publishFeature(existing.id, body.data);
    if (!result) return res.status(409).json({ error: "This feature is already published." });
    await writeAuditLog(req, "publish_feature_catalog_entry", existing.key, { price: body.data, grandfathered: result.grandfathered });
    return res.json({ success: true, feature: result.feature, grandfathered: result.grandfathered });
  } catch (error) {
    console.error("Publish feature catalog entry error:", error);
    return res.status(500).json({ error: "Failed to publish this feature." });
  }
});

// Schedules the §2.7 sunset-notice transition: every org that currently has
// this feature for free via the one-time grandfathering backfill (source
// 'grandfathered' - never one that already purchased it, or was comped by an
// admin) moves to source='grandfathered_sunset', status='pending_removal',
// removalEffectiveAt=paywallEffectiveAt. FeatureSunsetReminderService picks
// those rows up and sends the staged 30/7/1-day-and-today notices; the
// existing lazy sweep in getOrgEntitlements enforces the actual cutover once
// the date passes - this endpoint only schedules it.
adminRouter.post("/feature-catalog/:id/schedule-sunset", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  const { date: effectiveAt, error: dateError } = sunsetDateProblem(req.body?.paywallEffectiveAt);
  if (dateError || !effectiveAt) return res.status(400).json({ error: dateError });

  try {
    const [feature] = await db.select().from(featureCatalog).where(eq(featureCatalog.id, req.params.id)).limit(1);
    if (!feature) return res.status(404).json({ error: "Feature not found." });
    const tierProblem = sunsetTierProblem(feature.tierType);
    if (tierProblem) return res.status(400).json({ error: tierProblem });

    const before = await getSunsetState(feature.id);
    const affected = await scheduleSunset(feature.id, effectiveAt);
    await writeAuditLog(req, before.scheduled ? "reschedule_feature_sunset" : "schedule_feature_sunset", feature.key, {
      paywallEffectiveAt: effectiveAt,
      previousEffectiveAt: before.effectiveAt,
      affectedOrgs: affected,
    });
    return res.json({ success: true, affectedOrgs: affected, paywallEffectiveAt: effectiveAt });
  } catch (error) {
    console.error("Schedule feature sunset error:", error);
    return res.status(500).json({ error: "Failed to schedule this transition." });
  }
});

adminRouter.delete("/feature-catalog/:id/schedule-sunset", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  try {
    const [feature] = await db.select().from(featureCatalog).where(eq(featureCatalog.id, req.params.id)).limit(1);
    if (!feature) return res.status(404).json({ error: "Feature not found." });
    const before = await getSunsetState(feature.id);
    if (!before.scheduled) return res.status(409).json({ error: "No sunset is scheduled for this feature." });
    const restored = await cancelSunset(feature.id);
    await writeAuditLog(req, "cancel_feature_sunset", feature.key, { previousEffectiveAt: before.effectiveAt, restoredOrgs: restored });
    return res.json({ success: true, restoredOrgs: restored });
  } catch (error) {
    console.error("Cancel feature sunset error:", error);
    return res.status(500).json({ error: "Failed to cancel this transition." });
  }
});

adminRouter.get("/feature-catalog/:id/sunset", isAdminAuthenticated, async (req: Request, res: Response) => {
  try {
    return res.json(await getSunsetState(req.params.id));
  } catch (error) {
    console.error("Get feature sunset error:", error);
    return res.status(500).json({ error: "Failed to load the sunset state." });
  }
});

// Who has this feature, by how they got it. Counts ignore the search; the rows respect it.
const ENTITLEMENT_SOURCES = ["purchased", "grandfathered", "grandfathered_sunset", "admin_grant"];

adminRouter.get("/feature-catalog/:id/entitlements", isAdminAuthenticated, async (req: Request, res: Response) => {
  try {
    const [feature] = await db.select({ id: featureCatalog.id }).from(featureCatalog).where(eq(featureCatalog.id, req.params.id)).limit(1);
    if (!feature) return res.status(404).json({ error: "Feature not found." });
    const source = typeof req.query.source === "string" && ENTITLEMENT_SOURCES.includes(req.query.source) ? req.query.source : undefined;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const page = parsePage(req.query, { defaultLimit: 25 });
    const held = and(eq(orgFeatureEntitlements.featureId, feature.id), ne(orgFeatureEntitlements.status, "removed"));
    const where = and(
      held,
      source ? eq(orgFeatureEntitlements.source, source) : undefined,
      q ? like(organisations.name, `%${q.replace(/[\\%_]/g, "\\$&")}%`) : undefined,
    );
    const [rows, [total], bySource] = await Promise.all([
      db
        .select({
          organisationId: organisations.id,
          name: organisations.name,
          source: orgFeatureEntitlements.source,
          status: orgFeatureEntitlements.status,
          removalEffectiveAt: orgFeatureEntitlements.removalEffectiveAt,
          since: orgFeatureEntitlements.createdAt,
        })
        .from(orgFeatureEntitlements)
        .innerJoin(organisations, eq(organisations.id, orgFeatureEntitlements.organisationId))
        .where(where)
        .orderBy(organisations.name)
        .limit(page.limit)
        .offset(page.offset),
      db.select({ n: count() }).from(orgFeatureEntitlements).innerJoin(organisations, eq(organisations.id, orgFeatureEntitlements.organisationId)).where(where),
      db.select({ source: orgFeatureEntitlements.source, n: count() }).from(orgFeatureEntitlements).where(held).groupBy(orgFeatureEntitlements.source),
    ]);
    const counts = Object.fromEntries(ENTITLEMENT_SOURCES.map((s) => [s, Number(bySource.find((b) => b.source === s)?.n ?? 0)]));
    return res.json({ data: rows, pagination: pagination(Number(total.n), page), counts });
  } catch (error) {
    console.error("Feature entitlements error:", error);
    return res.status(500).json({ error: "Failed to load who has this feature." });
  }
});

// Every admin action that touched this feature, newest first. Actions record the feature key as their target,
// or (gate rules, dependencies) in details.featureKey.
adminRouter.get("/feature-catalog/:id/history", isAdminAuthenticated, async (req: Request, res: Response) => {
  try {
    const [feature] = await db.select({ key: featureCatalog.key }).from(featureCatalog).where(eq(featureCatalog.id, req.params.id)).limit(1);
    if (!feature) return res.status(404).json({ error: "Feature not found." });
    const page = parsePage(req.query, { defaultLimit: 25 });
    const where = or(
      eq(superAdminAuditLogs.target, feature.key),
      sql`(${superAdminAuditLogs.details} #>> '{}')::jsonb ->> 'featureKey' = ${feature.key}`,
    );
    const [rows, [total]] = await Promise.all([
      db
        .select({ id: superAdminAuditLogs.id, action: superAdminAuditLogs.action, adminEmail: superAdminAuditLogs.adminEmail, createdAt: superAdminAuditLogs.createdAt, details: superAdminAuditLogs.details })
        .from(superAdminAuditLogs)
        .where(where)
        .orderBy(desc(superAdminAuditLogs.createdAt))
        .limit(page.limit)
        .offset(page.offset),
      db.select({ n: count() }).from(superAdminAuditLogs).where(where),
    ]);
    // Details were written as a JSON string; read both that and a plain object.
    const parsed = rows.map((r) => {
      let details: any = r.details;
      if (typeof details === "string") { try { details = JSON.parse(details); } catch { /* leave as is */ } }
      return { ...r, details };
    });
    const orgIds = Array.from(new Set(parsed.map((r) => r.details?.organisationId).filter((v): v is string => typeof v === "string")));
    const orgs = orgIds.length ? await db.select({ id: organisations.id, name: organisations.name }).from(organisations).where(inArray(organisations.id, orgIds)) : [];
    const orgName = new Map(orgs.map((o) => [o.id, o.name]));
    const data = parsed.map((r) => ({ ...r, organisationName: r.details?.organisationId ? orgName.get(r.details.organisationId) ?? null : null }));
    return res.json({ data, pagination: pagination(Number(total.n), page) });
  } catch (error) {
    console.error("Feature history error:", error);
    return res.status(500).json({ error: "Failed to load this feature's history." });
  }
});

adminRouter.get("/feature-catalog/:id/dependencies", isAdminAuthenticated, async (req: Request, res: Response) => {
  try {
    const [feature] = await db.select().from(featureCatalog).where(eq(featureCatalog.id, req.params.id)).limit(1);
    if (!feature) return res.status(404).json({ error: "Feature not found." });
    const edges = await db
      .select()
      .from(featureDependencies)
      .where(or(eq(featureDependencies.featureId, feature.id), eq(featureDependencies.dependsOnFeatureId, feature.id)));
    const ids = Array.from(new Set(edges.flatMap((e) => [e.featureId, e.dependsOnFeatureId])));
    const named = ids.length ? await db.select({ id: featureCatalog.id, key: featureCatalog.key, name: featureCatalog.name }).from(featureCatalog).where(inArray(featureCatalog.id, ids)) : [];
    const byId = new Map(named.map((f) => [f.id, f]));
    const registryNeeds = new Set(getFeatureDef(feature.key)?.dependsOn ?? []);
    const view = (edge: typeof edges[number], otherId: string) => {
      const other = byId.get(otherId);
      return { dependencyId: edge.id, id: otherId, key: other?.key ?? otherId, name: other?.name ?? otherId };
    };
    return res.json({
      dependencies: edges.filter((e) => e.featureId === feature.id),
      // Edges the code registry defines are re-created by every sync, so they are shown but not removable here.
      needs: edges.filter((e) => e.featureId === feature.id).map((e) => ({ ...view(e, e.dependsOnFeatureId), fromRegistry: registryNeeds.has(byId.get(e.dependsOnFeatureId)?.key ?? "") })),
      neededBy: edges.filter((e) => e.dependsOnFeatureId === feature.id).map((e) => view(e, e.featureId)),
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to load dependencies." });
  }
});

adminRouter.post("/feature-catalog/:id/dependencies", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  const { dependsOnFeatureId } = req.body;
  if (!dependsOnFeatureId) return res.status(400).json({ error: "dependsOnFeatureId is required." });
  try {
    const catalog = await db.select({ id: featureCatalog.id, key: featureCatalog.key, name: featureCatalog.name }).from(featureCatalog);
    const feature = catalog.find((f) => f.id === req.params.id);
    const dependency = catalog.find((f) => f.id === dependsOnFeatureId);
    if (!feature) return res.status(404).json({ error: "Feature not found." });
    if (!dependency) return res.status(400).json({ error: "That dependency does not exist." });
    const edges = await db.select().from(featureDependencies);
    const nameOf = (id: string) => catalog.find((f) => f.id === id)?.name ?? id;
    const problem = dependencyProblem(edges, feature.id, dependency.id, nameOf);
    if (problem) return res.status(400).json({ error: problem });
    const [created] = await db
      .insert(featureDependencies)
      .values({ featureId: req.params.id, dependsOnFeatureId })
      .onConflictDoNothing()
      .returning();
    await writeAuditLog(req, "add_feature_dependency", feature.key, { dependsOnFeatureId, dependsOnKey: dependency.key, featureKey: feature.key });
    return res.json({ success: true, dependency: created ?? null });
  } catch (error) {
    console.error("Add feature dependency error:", error);
    return res.status(500).json({ error: "Failed to add this dependency." });
  }
});

adminRouter.delete("/feature-catalog/dependencies/:dependencyId", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  try {
    const [edge] = await db.select().from(featureDependencies).where(eq(featureDependencies.id, req.params.dependencyId)).limit(1);
    if (!edge) return res.status(404).json({ error: "Dependency not found." });
    const named = await db.select({ id: featureCatalog.id, key: featureCatalog.key }).from(featureCatalog).where(inArray(featureCatalog.id, [edge.featureId, edge.dependsOnFeatureId]));
    const featureKey = named.find((f) => f.id === edge.featureId)?.key ?? edge.featureId;
    const dependsOnKey = named.find((f) => f.id === edge.dependsOnFeatureId)?.key ?? edge.dependsOnFeatureId;
    if (getFeatureDef(featureKey)?.dependsOn?.includes(dependsOnKey)) {
      return res.status(409).json({ error: `${featureKey} needs ${dependsOnKey} in the code registry, so this is re-created on every release. Change the registry to remove it.` });
    }
    await db.delete(featureDependencies).where(eq(featureDependencies.id, edge.id));
    await writeAuditLog(req, "remove_feature_dependency", featureKey, { dependsOnKey, featureKey, dependencyId: edge.id });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: "Failed to remove this dependency." });
  }
});

// ----------------------------------------------------
// 6c. GATE RULES (attach an existing route/screen to a paid feature)
// ----------------------------------------------------
// Safeguards live in server/lib/gateRuleAdmin.ts + shared/gateRules.ts: rules
// are validated (protected areas, real routes/screens, paid features only),
// saved as drafts, enabled only after the admin confirms the affected-org
// count, and every change is in an append-only history that can be reverted.

/** Audit entries about a rule name the pattern as their target; the feature key in the details lets History find them. */
async function featureKeyById(id: string): Promise<string | null> {
  const [row] = await db.select({ key: featureCatalog.key }).from(featureCatalog).where(eq(featureCatalog.id, id)).limit(1);
  return row?.key ?? null;
}

const sendGateRuleError = (res: Response, error: unknown, fallback: string) => {
  if (error instanceof GateRuleError) return res.status(error.status).json({ error: error.message, details: error.details });
  console.error("Gate rule error:", error);
  return res.status(500).json({ error: fallback });
};

const gateRulePickerRoutes = (req: Request) => listApiRoutes(req.app).filter((r) => !validateGateRule({ kind: "route", methods: "*", pattern: r.path }));

adminRouter.get("/feature-gate-rules", isAdminAuthenticated, async (req: Request, res: Response) => {
  try {
    const featureId = typeof req.query.featureId === "string" ? req.query.featureId : undefined;
    const rules = (await listRulesWithFeature()).filter((r) => !featureId || r.featureId === featureId);
    const [scopeFeature] = featureId ? await db.select({ key: featureCatalog.key }).from(featureCatalog).where(eq(featureCatalog.id, featureId)).limit(1) : [];
    const baseline = (FEATURES as readonly FeatureDef[]).filter((f) => !featureId || f.key === scopeFeature?.key).flatMap((f) => [
      ...(f.routes ?? []).map((r) => ({ featureKey: f.key, kind: "route", methods: r.methods === "*" ? "*" : r.methods.join(","), pattern: r.path.source })),
      ...(f.gatedScreens ?? []).map((pattern) => ({ featureKey: f.key, kind: "screen", methods: "*", pattern })),
    ]);
    return res.json({ rules, baseline });
  } catch (error) {
    return sendGateRuleError(res, error, "Failed to load gate rules.");
  }
});

adminRouter.get("/feature-gate-rules/picker", isAdminAuthenticated, async (req: Request, res: Response) => {
  const screens = APP_SCREEN_PATHS.filter((p) => !validateGateRule({ kind: "screen", methods: "*", pattern: p }));
  return res.json({ routes: gateRulePickerRoutes(req), screens });
});

adminRouter.post("/feature-gate-rules", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  const { featureId, kind, methods, pattern, note } = req.body ?? {};
  if (!featureId || (kind !== "route" && kind !== "screen") || typeof pattern !== "string") {
    return res.status(400).json({ error: "featureId, kind ('route' or 'screen') and pattern are required." });
  }
  try {
    const rule = await createGateRule(
      { featureId, kind, methods: kind === "screen" ? "*" : String(methods ?? "*"), pattern, note },
      req.admin!.email,
      listApiRoutes(req.app),
    );
    await writeAuditLog(req, "create_gate_rule", rule.pattern, { featureId, featureKey: await featureKeyById(featureId), kind, methods: rule.methods });
    return res.json({ success: true, rule });
  } catch (error) {
    return sendGateRuleError(res, error, "Failed to create this rule.");
  }
});

adminRouter.patch("/feature-gate-rules/:id", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  try {
    const rule = await updateGateRule(req.params.id, req.body ?? {}, req.admin!.email, listApiRoutes(req.app));
    await writeAuditLog(req, "update_gate_rule", rule.pattern, { ...req.body, featureKey: await featureKeyById(rule.featureId) });
    return res.json({ success: true, rule });
  } catch (error) {
    return sendGateRuleError(res, error, "Failed to update this rule.");
  }
});

adminRouter.get("/feature-gate-rules/:id/preview", isAdminAuthenticated, async (req: Request, res: Response) => {
  try {
    return res.json({ impact: await computeRuleImpact(req.params.id) });
  } catch (error) {
    return sendGateRuleError(res, error, "Failed to preview this rule.");
  }
});

adminRouter.post("/feature-gate-rules/:id/enable", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  try {
    const { rule, impact } = await enableGateRule(req.params.id, req.body?.confirmAffectedOrgs, req.admin!.email);
    await writeAuditLog(req, "enable_gate_rule", rule.pattern, { affectedOrgs: impact.wouldLoseAccess, featureKey: await featureKeyById(rule.featureId) });
    return res.json({ success: true, rule, impact });
  } catch (error) {
    return sendGateRuleError(res, error, "Failed to enable this rule.");
  }
});

adminRouter.post("/feature-gate-rules/:id/disable", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  try {
    const rule = await disableGateRule(req.params.id, req.admin!.email);
    await writeAuditLog(req, "disable_gate_rule", rule.pattern, { featureKey: await featureKeyById(rule.featureId) });
    return res.json({ success: true, rule });
  } catch (error) {
    return sendGateRuleError(res, error, "Failed to disable this rule.");
  }
});

adminRouter.delete("/feature-gate-rules/:id", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  try {
    await deleteGateRule(req.params.id, req.admin!.email);
    await writeAuditLog(req, "delete_gate_rule", req.params.id);
    return res.json({ success: true });
  } catch (error) {
    return sendGateRuleError(res, error, "Failed to delete this rule.");
  }
});

adminRouter.get("/feature-gate-rule-events", isAdminAuthenticated, async (req: Request, res: Response) => {
  try {
    const ruleId = typeof req.query.ruleId === "string" ? req.query.ruleId : undefined;
    return res.json({ events: await listGateRuleEvents(ruleId) });
  } catch (error) {
    return sendGateRuleError(res, error, "Failed to load history.");
  }
});

adminRouter.post("/feature-gate-rule-events/:eventId/revert", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  try {
    const result = await revertGateRuleEvent(req.params.eventId, listApiRoutes(req.app), req.admin!.email);
    await writeAuditLog(req, "revert_gate_rule", req.params.eventId, result);
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendGateRuleError(res, error, "Failed to revert this change.");
  }
});

// Per-org manual grant/revoke - support and finance exceptions, comping a
// feature without a real payment (source='admin_grant'). Revocation here is
// immediate, unlike an owner's own removal (scheduleFeatureRemoval), which
// stays usable through the paid cycle - an admin correcting a mistaken grant
// or a fraud case has no reason to honor a grace period it never sold.
adminRouter.get("/organisations/:id/feature-entitlements", isAdminAuthenticated, async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select({ entitlement: orgFeatureEntitlements, feature: featureCatalog })
      .from(orgFeatureEntitlements)
      .innerJoin(featureCatalog, eq(orgFeatureEntitlements.featureId, featureCatalog.id))
      .where(eq(orgFeatureEntitlements.organisationId, req.params.id))
      .orderBy(featureCatalog.sortOrder);
    return res.json({ entitlements: rows.map((r) => ({ ...r.entitlement, feature: r.feature })) });
  } catch (error) {
    return res.status(500).json({ error: "Failed to load this organisation's entitlements." });
  }
});

adminRouter.post(
  "/organisations/:id/feature-entitlements",
  isAdminAuthenticated,
  requireAdminRole(["super_admin", "finance_admin"]),
  async (req: Request, res: Response) => {
    const { featureKey } = req.body;
    if (!featureKey) return res.status(400).json({ error: "featureKey is required." });
    try {
      await grantFeatureEntitlement({
        organisationId: req.params.id,
        featureKey,
        source: "admin_grant",
        grantedByAdminId: req.admin!.adminId,
      });
      await writeAuditLog(req, "admin_grant_feature", featureKey, { organisationId: req.params.id });
      return res.json({ success: true });
    } catch (error) {
      console.error("Admin grant feature error:", error);
      return res.status(500).json({ error: "Failed to grant this feature." });
    }
  }
);

adminRouter.delete(
  "/organisations/:id/feature-entitlements/:featureKey",
  isAdminAuthenticated,
  requireAdminRole(["super_admin", "finance_admin"]),
  async (req: Request, res: Response) => {
    try {
      const [feature] = await db.select().from(featureCatalog).where(eq(featureCatalog.key, req.params.featureKey)).limit(1);
      if (!feature) return res.status(404).json({ error: "Unknown feature." });
      await db
        .update(orgFeatureEntitlements)
        .set({ status: "removed", updatedAt: new Date() })
        .where(and(eq(orgFeatureEntitlements.organisationId, req.params.id), eq(orgFeatureEntitlements.featureId, feature.id), eq(orgFeatureEntitlements.status, "active")));
      await writeAuditLog(req, "admin_revoke_feature", req.params.featureKey, { organisationId: req.params.id, reason: typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) || undefined : undefined });
      return res.json({ success: true });
    } catch (error) {
      console.error("Admin revoke feature error:", error);
      return res.status(500).json({ error: "Failed to revoke this feature." });
    }
  }
);

// ----------------------------------------------------
// 7. ANNOUNCEMENTS ENDPOINTS
// ----------------------------------------------------

adminRouter.get("/announcements", isAdminAuthenticated, async (req: Request, res: Response) => {
  try {
    const list = await db.select().from(announcements).orderBy(desc(announcements.createdAt));
    return res.json({ announcements: list });
  } catch (error) {
    return res.status(500).json({ error: "Failed to list announcements." });
  }
});

adminRouter.post("/announcements", isAdminAuthenticated, requireAdminRole(["super_admin", "ops_manager"]), async (req: Request, res: Response) => {
  const { title, message, type, target, targetOrgId, showFrom, showUntil, dismissible } = req.body;

  if (!title || !message) {
    return res.status(400).json({ error: "Announcement title and message are required." });
  }

  if (title.length > 80) {
    return res.status(400).json({ error: "Title must be 80 characters or fewer." });
  }

  if (message.length > 150) {
    return res.status(400).json({ error: "Message must be 150 characters or fewer." });
  }

  const resolvedTarget = target || "all";
  const resolvedShowFrom = showFrom ? new Date(showFrom) : new Date();
  const resolvedShowUntil = showUntil ? new Date(showUntil) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  try {
    // Only one banner may be live at any given moment - reject any window
    // that overlaps an existing announcement's [showFrom, showUntil] range,
    // regardless of target, so the business app never has to stack banners.
    const [overlapping] = await db
      .select({ title: announcements.title, showFrom: announcements.showFrom, showUntil: announcements.showUntil })
      .from(announcements)
      .where(
        and(
          lte(announcements.showFrom, resolvedShowUntil),
          gte(announcements.showUntil, resolvedShowFrom),
        ),
      )
      .limit(1);

    if (overlapping) {
      return res.status(400).json({
        error: `"${overlapping.title}" is already scheduled from ${overlapping.showFrom.toLocaleDateString()} to ${overlapping.showUntil.toLocaleDateString()}. Retire it or pick a non-overlapping window first.`,
      });
    }

    const [newAnn] = await db
      .insert(announcements)
      .values({
        title,
        message,
        type: type || "info",
        target: resolvedTarget,
        targetOrgId: targetOrgId || null,
        showFrom: resolvedShowFrom,
        showUntil: resolvedShowUntil,
        dismissible: dismissible !== undefined ? dismissible : true,
        createdBy: req.admin!.email,
      })
      .returning();

    await writeAuditLog(req, "create_announcement", title, { target });

    return res.json({ success: true, announcement: newAnn });
  } catch (error) {
    console.error("Create announcement error:", error);
    return res.status(500).json({ error: "Failed to register announcement banner." });
  }
});

adminRouter.delete("/announcements/:id", isAdminAuthenticated, requireAdminRole(["super_admin", "ops_manager"]), async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const [ann] = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1);
    if (!ann) {
      return res.status(404).json({ error: "Announcement not found." });
    }

    await db.delete(announcements).where(eq(announcements.id, id));

    await writeAuditLog(req, "delete_announcement", ann.title);

    return res.json({ success: true, message: "Announcement retired." });
  } catch (error) {
    console.error("Delete announcement error:", error);
    return res.status(500).json({ error: "Failed to retire announcement." });
  }
});

// Simulate/Log email broadcast targeting
adminRouter.post("/announcements/broadcast-email", isAdminAuthenticated, requireAdminRole(["super_admin", "ops_manager"]), async (req: Request, res: Response) => {
  const { target, subject, body } = req.body;

  if (!subject || !body) {
    return res.status(400).json({ error: "Email subject and body are required." });
  }

  try {
    // Audit log
    await writeAuditLog(req, "email_broadcast", subject, { target });

    return res.json({
      success: true,
      message: `Email broadcast successfully dispatched to segment '${target || "All Owners"}'.`,
      recipientsCount: target === "trial" ? 356 : 892,
    });
  } catch (error) {
    console.error("Broadcast email simulate error:", error);
    return res.status(500).json({ error: "Failed to broadcast email." });
  }
});

// ----------------------------------------------------
// 8. SYSTEM HEALTH ENDPOINTS
// ----------------------------------------------------

const fmtMs = (ms: number) => `${Math.round(ms)}ms`;

// Slowest endpoints: per-route latency, error count and mean DB statements per request, heaviest first.
adminRouter.get("/system/endpoints", isAdminAuthenticated, async (req: Request, res: Response) => {
  try {
    const range = parseRange(req.query.range);
    return res.json({ range, endpoints: await getRouteStats(range) });
  } catch (error) {
    console.error("System endpoints error:", error);
    return res.status(500).json({ error: "We couldn't load endpoint timings. Please try again." });
  }
});

adminRouter.get("/system/health", isAdminAuthenticated, async (req: Request, res: Response) => {
  try {
    const now = Date.now();
    const range = parseRange(req.query.range);
    const since = new Date(now - RANGES[range]);

    // Time a real round-trip to the database.
    const dbStart = process.hrtime.bigint();
    let dbOk = true;
    try {
      await db.execute(sql`SELECT 1`);
    } catch {
      dbOk = false;
    }
    const dbMs = Number(process.hrtime.bigint() - dbStart) / 1e6;

    const stats = await getRangeStats(range, now);
    const errorRatePct = stats.total > 0 ? (stats.serverErrors / stats.total) * 100 : null;

    const emailRows = await db
      .select({ status: pendingEmails.status, n: count() })
      .from(pendingEmails)
      .where(gte(pendingEmails.createdAt, since))
      .groupBy(pendingEmails.status);
    const emailCount = (st: string) => Number(emailRows.find((r) => r.status === st)?.n ?? 0);
    const emailSent = emailCount("sent");
    const emailFailed = emailCount("failed");
    const emailRate =
      emailSent + emailFailed > 0 ? (emailSent / (emailSent + emailFailed)) * 100 : null;

    const errorBusinessIds = Array.from(
      new Set(stats.recentErrors.map((e) => e.businessId).filter((id): id is string => !!id)),
    );
    const nameRows = errorBusinessIds.length
      ? await db
          .select({ id: organisations.id, name: organisations.name })
          .from(organisations)
          .where(inArray(organisations.id, errorBusinessIds))
      : [];
    const names = new Map(nameRows.map((r) => [r.id, r.name]));

    const pendingFeatures = await listPendingReview();

    const apiStatus = stats.total === 0 ? "No Data" : stats.p95 > 1500 ? "Degraded" : "Normal";
    const databaseStatus = !dbOk ? "Down" : dbMs > 500 ? "Degraded" : "Normal";

    return res.json({
      health: {
        apiResponseTime: stats.total ? fmtMs(stats.p50) : null,
        apiStatus,
        databaseQueryTime: dbOk ? fmtMs(dbMs) : null,
        databaseStatus,
        errorRate: errorRatePct === null ? null : `${errorRatePct.toFixed(2)}%`,
        errorRateStatus:
          errorRatePct === null ? "No Data" : errorRatePct >= 5 ? "Critical" : errorRatePct >= 1 ? "Elevated" : "Within Bound",
        requestCount: stats.total,
        activeSessions: getConnectedClientCount(),
        emailDeliveryRate: emailRate === null ? null : `${emailRate.toFixed(1)}%`,
        emailsSent: emailSent,
        emailsFailed: emailFailed,
        // No SMS provider is integrated (see sendSMS in email.ts).
        smsDeliveryRate: null,
        range,
      },
      featureReview: { pending: pendingFeatures.length, features: pendingFeatures },
      latencyTimeline: stats.timeline,
      latencyApproximate: true,
      recentErrors: stats.recentErrors.map((e, i) => ({
        id: `${e.at}-${i}`,
        timestamp: new Date(e.at),
        endpoint: `${e.method} ${e.path}`,
        status: e.status,
        business: e.businessId ? names.get(e.businessId) ?? "[Unknown]" : "[Unauthenticated]",
      })),
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch health check metrics." });
  }
});

// ----------------------------------------------------
// 9. AUDIT LOGS ENDPOINTS
// ----------------------------------------------------

adminRouter.get("/system/audit-logs", isAdminAuthenticated, requireAdminRole(["super_admin", "ops_manager", "finance_admin"]), async (req: Request, res: Response) => {
  const { adminEmail, action, search } = req.query;

  try {
    // Filtered, newest first and paged in the database. This used to read the whole ledger (which only grows)
    // into Node and filter and slice it there, and it silently cut the list at 100 entries.
    const conditions: any[] = [];
    // Finance Admins can only view their own action logs
    const admin = req.admin;
    if (admin?.role === "finance_admin") conditions.push(eq(superAdminAuditLogs.adminId, admin.adminId));
    if (adminEmail) conditions.push(eq(superAdminAuditLogs.adminEmail, adminEmail as string));
    if (action) conditions.push(eq(superAdminAuditLogs.action, action as string));
    if (search) {
      const pattern = `%${(search as string).replace(/[\\%_]/g, "\\$&")}%`;
      conditions.push(sql`(${superAdminAuditLogs.target} ILIKE ${pattern} ESCAPE '\\' OR ${superAdminAuditLogs.action} ILIKE ${pattern} ESCAPE '\\' OR ${superAdminAuditLogs.adminEmail} ILIKE ${pattern} ESCAPE '\\')`);
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const page = parsePage(req.query, { defaultLimit: 100 });
    const [logs, [{ value: total }]] = await Promise.all([
      db.select().from(superAdminAuditLogs).where(where).orderBy(desc(superAdminAuditLogs.createdAt), desc(superAdminAuditLogs.id)).limit(page.limit).offset(page.offset),
      db.select({ value: count() }).from(superAdminAuditLogs).where(where),
    ]);

    return res.json({ logs, pagination: pagination(total, page) });
  } catch (error) {
    return res.status(500).json({ error: "Failed to retrieve immutable operations ledger." });
  }
});

// ----------------------------------------------------
// 10. SUPER ADMIN ACCOUNT MANAGEMENT ENDPOINTS
// ----------------------------------------------------

adminRouter.get("/super-admins", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  try {
    const list = await db
      .select({
        id: superAdmins.id,
        name: superAdmins.name,
        email: superAdmins.email,
        role: superAdmins.role,
        status: superAdmins.status,
        mfaEnabled: superAdmins.mfaEnabled,
        createdAt: superAdmins.createdAt,
        lastLoginAt: superAdmins.lastLoginAt,
      })
      .from(superAdmins)
      .orderBy(desc(superAdmins.createdAt));

    return res.json({ admins: list });
  } catch (error) {
    return res.status(500).json({ error: "Failed to query admin roster." });
  }
});

// Invite a new internal admin account. No password, no MFA secret is ever
// generated or returned here - the invitee sets their own password and
// pairs their own authenticator via /auth/activate -> /auth/set-password ->
// /auth/verify-mfa-setup below, so nobody but them ever sees either. See
// migrations/0047_super_admin_invites.sql.
adminRouter.post("/super-admins", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  const { name, email, role } = req.body;

  if (!name || !email || !role) {
    return res.status(400).json({ error: "Name, email and security clearance role are required." });
  }

  try {
    const emailLower = email.trim().toLowerCase();
    const [existing] = await db.select().from(superAdmins).where(eq(superAdmins.email, emailLower)).limit(1);
    if (existing) {
      return res.status(400).json({ error: "Administrative email already exists." });
    }

    // Placeholder, unusable hash - same trick as StaffInviteService's
    // createInvitedUser: no login is possible until set-password below
    // overwrites it, and a null here would read as "no password set" to
    // anything checking for that instead of "invite not yet accepted".
    const placeholderHash = await bcrypt.hash(crypto.randomUUID(), 10);
    const activationCode = generateActivationCode();

    const [newAdmin] = await db
      .insert(superAdmins)
      .values({
        name,
        email: emailLower,
        passwordHash: placeholderHash,
        mfaSecret: null,
        mfaEnabled: false,
        role,
        status: "invited",
        activationCode,
        activationCodeExpiry: activationCodeExpiry(),
        activationCodeUsed: false,
      })
      .returning();

    await sendAdminInviteEmail(emailLower, name, role, activationCode);
    await writeAuditLog(req, "invite_admin_account", newAdmin.email, { role: newAdmin.role });

    return res.json({
      success: true,
      admin: {
        id: newAdmin.id,
        name: newAdmin.name,
        email: newAdmin.email,
        role: newAdmin.role,
      },
    });
  } catch (error) {
    console.error("Invite internal admin error:", error);
    return res.status(500).json({ error: "Failed to invite internal admin account." });
  }
});

// Resend a pending admin invite (expired/lost email). 3/hour, same cooldown
// as staff resend - see server/routes/staff.routes.ts.
adminRouter.post("/super-admins/:id/resend-invite", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const [admin] = await db.select().from(superAdmins).where(eq(superAdmins.id, id)).limit(1);
    if (!admin) {
      return res.status(404).json({ error: "Admin account not found." });
    }
    if (admin.status !== "invited") {
      return res.status(409).json({ error: "This admin has already completed account setup." });
    }

    const cooldown = checkResendCooldown(admin.resendAttempts, admin.resendWindowStart);
    if (!cooldown.allowed) {
      return res.status(429).json({
        error: `Too many invitations sent to this address. Please try again in ${cooldown.retryAfterMinutes} minutes.`,
        retryAfterMinutes: cooldown.retryAfterMinutes,
      });
    }

    const activationCode = generateActivationCode();
    await db
      .update(superAdmins)
      .set({
        activationCode,
        activationCodeExpiry: activationCodeExpiry(),
        activationCodeUsed: false,
        resendAttempts: cooldown.nextAttempts,
        resendWindowStart: cooldown.nextWindowStart,
      })
      .where(eq(superAdmins.id, id));

    await sendAdminInviteEmail(admin.email, admin.name, admin.role, activationCode);
    await writeAuditLog(req, "resend_admin_invite", admin.email);

    return res.json({ success: true, message: "Invitation resent." });
  } catch (error) {
    console.error("Resend admin invite error:", error);
    return res.status(500).json({ error: "Failed to resend invitation." });
  }
});

// Reset admin MFA. Emails the target admin a fresh re-pairing link instead
// of returning the secret/QR directly to whoever clicked "reset" - the
// resetting admin has no legitimate need to see another admin's TOTP secret.
adminRouter.post("/super-admins/:id/reset-mfa", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const [admin] = await db.select().from(superAdmins).where(eq(superAdmins.id, id)).limit(1);
    if (!admin) {
      return res.status(404).json({ error: "Admin account not found." });
    }

    const activationCode = generateActivationCode();

    await db
      .update(superAdmins)
      .set({
        mfaSecret: null,
        mfaEnabled: false, // Forces re-pairing before next login
        activationCode,
        activationCodeExpiry: activationCodeExpiry(),
        activationCodeUsed: false,
      })
      .where(eq(superAdmins.id, id));

    await sendAdminMfaResetEmail(admin.email, admin.name, activationCode);
    await writeAuditLog(req, "reset_admin_mfa", admin.email);

    return res.json({
      success: true,
      message: `MFA pairing reset. A re-pairing link was emailed to ${admin.email}.`,
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to reset MFA configurations." });
  }
});

// Suspend/Deactivate admin account
adminRouter.delete("/super-admins/:id", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  const { id } = req.params;
  const currentAdmin = req.admin;

  if (id === currentAdmin?.adminId) {
    return res.status(400).json({ error: "You cannot deactivate your own account. Ask another Super Admin." });
  }

  try {
    const [admin] = await db.select().from(superAdmins).where(eq(superAdmins.id, id)).limit(1);
    if (!admin) {
      return res.status(404).json({ error: "Admin account not found." });
    }

    const nextStatus = admin.status === "suspended" ? "active" : "suspended";

    await db
      .update(superAdmins)
      .set({ status: nextStatus })
      .where(eq(superAdmins.id, id));

    await writeAuditLog(req, nextStatus === "suspended" ? "deactivate_admin" : "reactivate_admin", admin.email);

    return res.json({
      success: true,
      message: `Admin account successfully ${nextStatus === "suspended" ? "suspended" : "reactivated"}.`,
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to toggle admin status." });
  }
});

// ----------------------------------------------------
// 11. PLATFORM SETTINGS ENDPOINTS (trial length, platform payment credentials)
// ----------------------------------------------------
// Two previously-missing "spot to configure X" gaps: trial length was a
// hardcoded constant, and the platform's own Paystack keys (used to charge
// every business - distinct from a tenant's own storeIntegrations
// credentials) could only be rotated by editing .env and redeploying. See
// shared/schema/platform.ts, server/lib/platformConfig.ts,
// server/lib/credentialEncryption.ts.

const MASK = "••••••••••••••••";

adminRouter.get("/platform-config/trial-days", isAdminAuthenticated, async (req: Request, res: Response) => {
  try {
    const days = await getConfiguredTrialDays();
    return res.json({ trialDays: days });
  } catch (error) {
    return res.status(500).json({ error: "Failed to load trial length." });
  }
});

adminRouter.put("/platform-config/trial-days", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  const { trialDays } = req.body;
  const days = Number(trialDays);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return res.status(400).json({ error: "Trial length must be a whole number of days between 1 and 365." });
  }

  try {
    await setPlatformConfigValue("trial_days", days, req.admin!.email);
    await writeAuditLog(req, "update_trial_days", "platform_config", { trialDays: days });
    return res.json({ success: true, trialDays: days });
  } catch (error) {
    console.error("Update trial-days error:", error);
    return res.status(500).json({ error: "Failed to update trial length." });
  }
});

adminRouter.get("/platform-config/grace-days", isAdminAuthenticated, async (_req: Request, res: Response) => {
  try {
    return res.json({ graceDays: await getConfiguredGraceDays() });
  } catch {
    return res.status(500).json({ error: "Failed to load grace period." });
  }
});

adminRouter.put("/platform-config/grace-days", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  const days = Number(req.body?.graceDays);
  if (!Number.isInteger(days) || days < 0 || days > 90) {
    return res.status(400).json({ error: "Grace period must be a whole number of days between 0 and 90." });
  }
  try {
    await setPlatformConfigValue("grace_days", days, req.admin!.email);
    await writeAuditLog(req, "update_grace_days", "platform_config", { graceDays: days });
    return res.json({ success: true, graceDays: days });
  } catch (error) {
    console.error("Update grace-days error:", error);
    return res.status(500).json({ error: "Failed to update grace period." });
  }
});

adminRouter.get("/platform-config/export-branding", isAdminAuthenticated, async (_req: Request, res: Response) => {
  try {
    return res.json(await getExportBranding());
  } catch {
    return res.status(500).json({ error: "Failed to load export branding." });
  }
});

adminRouter.put("/platform-config/export-branding", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  const enabled = req.body?.enabled;
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled must be true or false." });
  if (enabled && (!text || text.length > 80)) return res.status(400).json({ error: "Text is required and must be 80 characters or fewer." });
  try {
    const value = { enabled, text: text.slice(0, 80) };
    await setPlatformConfigValue("export_branding", value, req.admin!.email);
    await writeAuditLog(req, "update_export_branding", "platform_config", value);
    return res.json({ success: true, ...(await getExportBranding()) });
  } catch (error) {
    console.error("Update export-branding error:", error);
    return res.status(500).json({ error: "Failed to update export branding." });
  }
});

// ========== PRICING BUNDLES ==========
// A bundle is a named set of catalog features, discounted while a business holds
// all of it (shared/bundles.ts). It owns no entitlement, so creating, editing or
// deleting one never changes anyone's access - only the price a full set costs,
// at the next checkout or renewal, and what the landing page shows.
const bundleInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(60),
  tagline: z.string().trim().max(120).default(""),
  featureKeys: z.array(z.string()).max(100),
  discountPct: z.coerce.number().min(0, "Discount must be 0-90.").max(90, "Discount must be 0-90."),
  bullets: z.array(z.string().trim().max(120)).max(8).default([]),
  featured: z.boolean().default(false),
  showOnLanding: z.boolean().default(true),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
});

adminRouter.get("/bundles", isAdminAuthenticated, async (_req: Request, res: Response) => {
  try {
    const list = await db.select().from(pricingBundles).orderBy(pricingBundles.sortOrder);
    return res.json({ bundles: list });
  } catch {
    return res.status(500).json({ error: "Failed to load bundles." });
  }
});

adminRouter.post("/bundles", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  const parsed = bundleInputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors.map((e) => e.message).join(", ") });
  const data = parsed.data;
  try {
    const key = slugifyBundleKey(data.name);
    if (!key) return res.status(400).json({ error: "Name must contain letters or numbers." });
    const [existing] = await db.select().from(pricingBundles).where(eq(pricingBundles.key, key));
    if (existing) return res.status(409).json({ error: `A bundle called "${existing.name}" already exists.` });
    const problems = await validateBundleMembers(data.featureKeys);
    if (problems.length > 0) return res.status(400).json({ error: problems.join(" ") });

    const [row] = await db.transaction(async (tx) => {
      if (data.featured) await tx.update(pricingBundles).set({ featured: false });
      return tx.insert(pricingBundles).values({ ...data, key }).returning();
    });
    await writeAuditLog(req, "create_bundle", row.key, { featureKeys: data.featureKeys, discountPct: data.discountPct });
    return res.json({ success: true, bundle: row });
  } catch (error) {
    console.error("Create bundle error:", error);
    return res.status(500).json({ error: "Failed to create the bundle." });
  }
});

adminRouter.put("/bundles/:id", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  const parsed = bundleInputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors.map((e) => e.message).join(", ") });
  const data = parsed.data;
  try {
    const [before] = await db.select().from(pricingBundles).where(eq(pricingBundles.id, req.params.id));
    if (!before) return res.status(404).json({ error: "Bundle not found." });
    const problems = await validateBundleMembers(data.featureKeys);
    if (problems.length > 0) return res.status(400).json({ error: problems.join(" ") });

    // The key stays put on rename: people may have it saved from the landing page.
    const [row] = await db.transaction(async (tx) => {
      if (data.featured) await tx.update(pricingBundles).set({ featured: false });
      return tx.update(pricingBundles).set({ ...data, updatedAt: new Date() }).where(eq(pricingBundles.id, before.id)).returning();
    });
    await writeAuditLog(req, "update_bundle", before.key, {
      before: { featureKeys: before.featureKeys, discountPct: Number(before.discountPct), isActive: before.isActive },
      after: { featureKeys: data.featureKeys, discountPct: data.discountPct, isActive: data.isActive },
    });
    return res.json({ success: true, bundle: row });
  } catch (error) {
    console.error("Update bundle error:", error);
    return res.status(500).json({ error: "Failed to update the bundle." });
  }
});

adminRouter.delete("/bundles/:id", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  try {
    const [row] = await db.delete(pricingBundles).where(eq(pricingBundles.id, req.params.id)).returning();
    if (!row) return res.status(404).json({ error: "Bundle not found." });
    await writeAuditLog(req, "delete_bundle", row.key, { name: row.name, featureKeys: row.featureKeys });
    return res.json({ success: true });
  } catch (error) {
    console.error("Delete bundle error:", error);
    return res.status(500).json({ error: "Failed to delete the bundle." });
  }
});

// SMS/WhatsApp configuration
adminRouter.get("/platform-config/sms", isAdminAuthenticated, async (req: Request, res: Response) => {
  try {
    const smsEnabled = await getPlatformConfigValue<boolean>("sms_enabled");
    const whatsappEnabled = await getPlatformConfigValue<boolean>("whatsapp_enabled");
    const phoneChangeOtpViaEmail = await getPhoneChangeOtpViaEmail();
    return res.json({ smsEnabled: smsEnabled === true, whatsappEnabled: whatsappEnabled === true, phoneChangeOtpViaEmail });
  } catch (error) {
    return res.status(500).json({ error: "Failed to load SMS configuration." });
  }
});

adminRouter.put("/platform-config/sms", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  const { smsEnabled, whatsappEnabled, phoneChangeOtpViaEmail } = req.body;

  if (typeof smsEnabled !== "boolean" || typeof whatsappEnabled !== "boolean") {
    return res.status(400).json({ error: "smsEnabled and whatsappEnabled must be booleans." });
  }
  if (phoneChangeOtpViaEmail !== undefined && typeof phoneChangeOtpViaEmail !== "boolean") {
    return res.status(400).json({ error: "phoneChangeOtpViaEmail must be a boolean." });
  }

  try {
    await setPlatformConfigValue("sms_enabled", smsEnabled, req.admin!.email);
    await setPlatformConfigValue("whatsapp_enabled", whatsappEnabled, req.admin!.email);
    if (typeof phoneChangeOtpViaEmail === "boolean") {
      await setPlatformConfigValue("phone_change_otp_via_email", phoneChangeOtpViaEmail, req.admin!.email);
    }
    await writeAuditLog(req, "update_sms_config", "platform_config", { smsEnabled, whatsappEnabled, phoneChangeOtpViaEmail });
    return res.json({ success: true, smsEnabled, whatsappEnabled, phoneChangeOtpViaEmail: await getPhoneChangeOtpViaEmail() });
  } catch (error) {
    console.error("Update SMS config error:", error);
    return res.status(500).json({ error: "Failed to update SMS configuration." });
  }
});

// WhatsApp Business Platform (Cloud API) - the ONE Meta Tech Provider app
// this whole platform uses to receive webhooks for every connected
// business's WhatsApp number (see shared/schema/whatsapp.ts's whatsappNumbers
// for the separate, per-store credentials). Not to be confused with the
// "SMS & WhatsApp" toggle above, which gates the password-reset OTP channel.
adminRouter.get("/platform-config/whatsapp", isAdminAuthenticated, async (req: Request, res: Response) => {
  try {
    const status = await getWhatsAppPlatformConfigStatus();
    return res.json(status);
  } catch (error) {
    return res.status(500).json({ error: "Failed to load WhatsApp platform configuration." });
  }
});

adminRouter.put(
  "/platform-config/whatsapp",
  isAdminAuthenticated,
  requireAdminRole(["super_admin"]),
  async (req: Request, res: Response) => {
    const { isActive, appSecret, verifyToken } = req.body;
    if (typeof isActive !== "boolean") {
      return res.status(400).json({ error: "isActive must be a boolean." });
    }

    try {
      // Sentinel-compare-on-write, same convention as the payment-credentials
      // form above: MASK means "unchanged", an actually-blank field clears it.
      const values: { isActive: boolean; appSecret?: string; verifyToken?: string } = { isActive };
      if (typeof appSecret === "string" && appSecret !== MASK) values.appSecret = appSecret;
      if (typeof verifyToken === "string" && verifyToken !== MASK) values.verifyToken = verifyToken;

      await setWhatsAppPlatformConfig(values, req.admin!.email);
      await writeAuditLog(req, "update_whatsapp_platform_config", "platform_config", {
        isActive,
        appSecretChanged: typeof values.appSecret === "string",
        verifyTokenChanged: typeof values.verifyToken === "string",
      });

      const status = await getWhatsAppPlatformConfigStatus();
      return res.json({ success: true, ...status });
    } catch (error) {
      console.error("Update WhatsApp platform config error:", error);
      return res.status(500).json({ error: "Failed to update WhatsApp platform configuration." });
    }
  },
);

// ─── Legal Documents (Terms and Conditions / Privacy Policy / Data Usage) ───
// Versioned, super-admin-authored content - see shared/schema/legal-documents.ts
// and server/services/LegalDocumentService.ts. Publishing a new version here
// automatically makes every user's prior acceptance stale (no separate
// "require re-consent" toggle needed - see hasAcceptedCurrentDocuments).
// Not limited to the three seeded defaults - createDocument below lets a
// super admin add further sections, which every consent screen picks up
// automatically since none of them hardcode a fixed set of types.

adminRouter.get("/legal-documents", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  try {
    // listAllForAdmin, not listAllCurrent - this view also shows archived
    // sections (with a Reactivate action), unlike every user-facing read.
    const current = await legalDocumentService.listAllForAdmin();
    return res.json({
      documents: current.map(c => ({
        documentType: c.document.documentType,
        title: c.document.title,
        contentMarkdown: c.version.contentMarkdown,
        versionNumber: c.version.versionNumber,
        publishedAt: c.version.createdAt,
        publishedByAdminId: c.version.createdByAdminId,
        archivedAt: c.document.archivedAt,
      })),
    });
  } catch (error) {
    console.error("List legal documents error:", error);
    return res.status(500).json({ error: "Failed to load legal documents." });
  }
});

adminRouter.post("/legal-documents", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  const parsed = createLegalDocumentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid submission." });
  }

  try {
    const outcome = await legalDocumentService.createDocument({
      documentType: parsed.data.documentType,
      title: parsed.data.title,
      contentMarkdown: parsed.data.contentMarkdown,
      adminId: req.admin!.adminId,
    });
    if (outcome.kind === "duplicate_type") {
      return res.status(409).json({ error: `A document with type "${parsed.data.documentType}" already exists.` });
    }
    await writeAuditLog(req, "create_legal_document", "legal_document", {
      documentType: outcome.document.documentType,
    });
    return res.status(201).json({
      documentType: outcome.document.documentType,
      title: outcome.document.title,
      versionNumber: outcome.version.versionNumber,
      publishedAt: outcome.version.createdAt,
    });
  } catch (error) {
    console.error("Create legal document error:", error);
    return res.status(500).json({ error: "Failed to create new section." });
  }
});

adminRouter.post("/legal-documents/:type/archive", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  try {
    const document = await legalDocumentService.archiveDocument(req.params.type);
    if (!document) {
      return res.status(404).json({ error: "Unknown legal document type." });
    }
    await writeAuditLog(req, "archive_legal_document", "legal_document", { documentType: req.params.type });
    return res.json({ documentType: document.documentType, archivedAt: document.archivedAt });
  } catch (error) {
    console.error("Archive legal document error:", error);
    return res.status(500).json({ error: "Failed to deactivate this section." });
  }
});

adminRouter.post("/legal-documents/:type/reactivate", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  try {
    const document = await legalDocumentService.reactivateDocument(req.params.type);
    if (!document) {
      return res.status(404).json({ error: "Unknown legal document type." });
    }
    await writeAuditLog(req, "reactivate_legal_document", "legal_document", { documentType: req.params.type });
    return res.json({ documentType: document.documentType, archivedAt: document.archivedAt });
  } catch (error) {
    console.error("Reactivate legal document error:", error);
    return res.status(500).json({ error: "Failed to reactivate this section." });
  }
});

// Hard delete - only succeeds for a document nobody has ever accepted (see
// LegalDocumentService.deleteDocument). Anything a real user has consented
// to must be deactivated via /archive instead, which keeps the audit trail.
adminRouter.delete("/legal-documents/:type", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  try {
    const outcome = await legalDocumentService.deleteDocument(req.params.type);
    if (outcome.kind === "not_found") {
      return res.status(404).json({ error: "Unknown legal document type." });
    }
    if (outcome.kind === "has_acceptances") {
      return res.status(409).json({
        error: `${outcome.acceptanceCount} user(s) have already accepted this document, so it can't be deleted - deactivate it instead.`,
      });
    }
    await writeAuditLog(req, "delete_legal_document", "legal_document", { documentType: req.params.type });
    return res.json({ success: true });
  } catch (error) {
    console.error("Delete legal document error:", error);
    return res.status(500).json({ error: "Failed to delete this section." });
  }
});

adminRouter.get("/legal-documents/:type/versions", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  const documentType = req.params.type;
  try {
    const versions = await legalDocumentService.getVersionHistory(documentType);
    if (versions.length === 0) {
      return res.status(404).json({ error: "Unknown legal document type." });
    }
    return res.json({ versions });
  } catch (error) {
    console.error("Get legal document versions error:", error);
    return res.status(500).json({ error: "Failed to load version history." });
  }
});

adminRouter.put("/legal-documents/:type", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  const documentType = req.params.type;
  const parsed = publishLegalDocumentVersionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid submission." });
  }

  try {
    const { document, version } = await legalDocumentService.publishNewVersion({
      documentType,
      title: parsed.data.title,
      contentMarkdown: parsed.data.contentMarkdown,
      adminId: req.admin!.adminId,
    });
    await writeAuditLog(req, "publish_legal_document_version", "legal_document", {
      documentType,
      versionNumber: version.versionNumber,
    });
    return res.json({
      documentType: document.documentType,
      title: document.title,
      versionNumber: version.versionNumber,
      publishedAt: version.createdAt,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Unknown legal document type")) {
      return res.status(404).json({ error: "Unknown legal document type." });
    }
    console.error("Publish legal document version error:", error);
    return res.status(500).json({ error: "Failed to publish new version." });
  }
});

// Any admin can view (masked) which providers are configured; only
// super_admin can change them - the same asymmetry as feature-catalog
// pricing edits above, since these directly control money movement.
adminRouter.get("/platform-payment-credentials", isAdminAuthenticated, async (req: Request, res: Response) => {
  try {
    const rows = await db.select().from(platformPaymentCredentials);
    const masked = rows.map((row) => ({
      provider: row.provider,
      isActive: row.isActive,
      publicKey: row.publicKey,
      secretKeySet: !!row.secretKeyEncrypted,
      webhookSecretSet: !!row.webhookSecretEncrypted,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
    }));
    return res.json({ credentials: masked });
  } catch (error) {
    return res.status(500).json({ error: "Failed to load platform payment credentials." });
  }
});

adminRouter.put(
  "/platform-payment-credentials/:provider",
  isAdminAuthenticated,
  requireAdminRole(["super_admin"]),
  async (req: Request, res: Response) => {
    const { provider } = req.params;
    if (!["paystack", "stripe", "flutterwave"].includes(provider)) {
      return res.status(400).json({ error: "Unknown payment provider." });
    }

    const { isActive, publicKey, secretKey, webhookSecret } = req.body;

    try {
      const [existing] = await db
        .select()
        .from(platformPaymentCredentials)
        .where(eq(platformPaymentCredentials.provider, provider))
        .limit(1);

      // Sentinel-compare-on-write, same convention as the tenant
      // storeIntegrations form (client/src/pages/settings/components/
      // store-integrations.tsx): the masked bullet value means "unchanged",
      // never overwrite with it. An actually-blank field clears the secret.
      let secretKeyEncrypted = existing?.secretKeyEncrypted ?? null;
      if (typeof secretKey === "string" && secretKey !== MASK) {
        secretKeyEncrypted = secretKey ? encryptSecret(secretKey) : null;
      }
      let webhookSecretEncrypted = existing?.webhookSecretEncrypted ?? null;
      if (typeof webhookSecret === "string" && webhookSecret !== MASK) {
        webhookSecretEncrypted = webhookSecret ? encryptSecret(webhookSecret) : null;
      }

      const values = {
        provider,
        isActive: typeof isActive === "boolean" ? isActive : (existing?.isActive ?? false),
        publicKey: typeof publicKey === "string" ? publicKey : (existing?.publicKey ?? null),
        secretKeyEncrypted,
        webhookSecretEncrypted,
        updatedAt: new Date(),
        updatedBy: req.admin!.email,
      };

      const [saved] = existing
        ? await db
            .update(platformPaymentCredentials)
            .set(values)
            .where(eq(platformPaymentCredentials.id, existing.id))
            .returning()
        : await db.insert(platformPaymentCredentials).values(values).returning();

      await writeAuditLog(req, "update_platform_payment_credentials", provider, {
        isActive: values.isActive,
        secretKeyChanged: secretKeyEncrypted !== (existing?.secretKeyEncrypted ?? null),
        webhookSecretChanged: webhookSecretEncrypted !== (existing?.webhookSecretEncrypted ?? null),
      });

      return res.json({
        success: true,
        credential: {
          provider: saved.provider,
          isActive: saved.isActive,
          publicKey: saved.publicKey,
          secretKeySet: !!saved.secretKeyEncrypted,
          webhookSecretSet: !!saved.webhookSecretEncrypted,
          updatedAt: saved.updatedAt,
        },
      });
    } catch (error) {
      console.error("Update platform payment credentials error:", error);
      const message = error instanceof Error && error.message.includes("PLATFORM_CREDENTIALS_ENCRYPTION_KEY")
        ? error.message
        : "Failed to update platform payment credentials.";
      return res.status(500).json({ error: message });
    }
  }
);
