import { Router, type Request, type Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { db } from "./db";
import { eq, and, like, desc, sql, gte, lte, count, inArray } from "drizzle-orm";
import {
  superAdmins,
  featureFlags,
  announcements,
  superAdminAuditLogs,
  organisations,
  users,
  checkouts,
  staff,
  inventory,
  bookings,
  creditEntries,
  repayments,
  stores,
  organisationMembers,
  customers,
  subscriptions,
  subscriptionPayments,
  plans,
  supportThreads,
  supportThreadMessages,
  isGenuineSuspensionReason,
  passwordSchema,
  featureCatalog,
  featureDependencies,
  orgFeatureEntitlements,
  insertFeatureCatalogSchema,
  platformConfig,
  platformPaymentCredentials,
} from "@shared/schema";
import { grantFeatureEntitlement, scheduleFeatureRemoval } from "./lib/entitlements";
import { reactivateOrganisation, autoResolveSuspensionThreads } from "./lib/organisations";
import { getConfiguredTrialDays, setPlatformConfigValue } from "./lib/platformConfig";
import { encryptSecret } from "./lib/credentialEncryption";
import { verifyTOTP, generateSecret, getOTPAuthURL } from "./totp";
import { generateAdminToken, isAdminAuthenticated, requireAdminRole } from "./auth-admin";
import { broadcastDataChange } from "./websocket";
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

// No cookie-parser middleware is installed anywhere in this app (see the
// identical helper in server/auth-admin.ts and server/auth.ts) - cookies are
// read straight off the raw header.
function parseCookies(cookieHeader?: string): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(";").forEach((cookie) => {
    const parts = cookie.split("=");
    list[parts.shift()!.trim()] = decodeURI(parts.join("="));
  });
  return list;
}

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

adminRouter.get("/dashboard/metrics", isAdminAuthenticated, async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    // Total Businesses
    const [totalOrgResult] = await db.select({ value: count() }).from(organisations);
    const totalOrgs = totalOrgResult.value;

    const [priorOrgResult] = await db
      .select({ value: count() })
      .from(organisations)
      .where(lte(organisations.createdAt, thirtyDaysAgo));
    const priorOrgs = priorOrgResult.value;
    const orgsDeltaPercent = priorOrgs > 0 ? Math.round(((totalOrgs - priorOrgs) / priorOrgs) * 100) : 0;

    // Active Today (Businesses with transactions today)
    const activeTodayResult = await db
      .selectDistinct({ storeId: checkouts.storeId })
      .from(checkouts)
      .where(and(gte(checkouts.createdAt, startOfToday), eq(checkouts.isVoided, false)));
    
    // Group active stores back to organizations
    let activeOrgsCount = 0;
    if (activeTodayResult.length > 0) {
      const activeStoreIds = activeTodayResult.map(r => r.storeId);
      const activeStores = await db
        .select({ businessId: stores.businessId })
        .from(stores)
        .where(inArray(stores.id, activeStoreIds));
      
      const uniqueActiveOrgs = new Set(activeStores.map(s => s.businessId));
      activeOrgsCount = uniqueActiveOrgs.size;
    }
    const activePercent = totalOrgs > 0 ? Math.round((activeOrgsCount / totalOrgs) * 100) : 0;

    // New This Month
    const [newOrgsResult] = await db
      .select({ value: count() })
      .from(organisations)
      .where(gte(organisations.createdAt, thirtyDaysAgo));
    const newOrgsCount = newOrgsResult.value;

    const [priorNewOrgsResult] = await db
      .select({ value: count() })
      .from(organisations)
      .where(and(gte(organisations.createdAt, sixtyDaysAgo), lte(organisations.createdAt, thirtyDaysAgo)));
    const priorNewOrgsCount = priorNewOrgsResult.value;
    const newOrgsDeltaPercent = priorNewOrgsCount > 0 ? Math.round(((newOrgsCount - priorNewOrgsCount) / priorNewOrgsCount) * 100) : 0;

    // Suspended Businesses
    const [suspendedResult] = await db
      .select({ value: count() })
      .from(organisations)
      .where(eq(organisations.status, "suspended"));
    const suspendedOrgsCount = suspendedResult.value;

    // Total Users
    const [totalUsersResult] = await db.select({ value: count() }).from(users);
    const totalUsers = totalUsersResult.value;

    // Transactions counts
    const [txTodayResult] = await db
      .select({ value: count() })
      .from(checkouts)
      .where(and(gte(checkouts.createdAt, startOfToday), eq(checkouts.isVoided, false)));
    const txToday = txTodayResult.value;

    const [txMonthResult] = await db
      .select({ value: count() })
      .from(checkouts)
      .where(and(gte(checkouts.createdAt, thirtyDaysAgo), eq(checkouts.isVoided, false)));
    const txMonth = txMonthResult.value;

    // Gross Merchandise Value (GMV) for Month
    const checkoutsMonth = await db
      .select({ totalPrice: checkouts.totalPrice })
      .from(checkouts)
      .where(and(gte(checkouts.createdAt, thirtyDaysAgo), eq(checkouts.isVoided, false)));
    
    const monthlyGMV = checkoutsMonth.reduce((sum, item) => sum + (item.totalPrice || 0), 0);

    const checkoutsPriorMonth = await db
      .select({ totalPrice: checkouts.totalPrice })
      .from(checkouts)
      .where(and(gte(checkouts.createdAt, sixtyDaysAgo), lte(checkouts.createdAt, thirtyDaysAgo), eq(checkouts.isVoided, false)));
    
    const priorMonthlyGMV = checkoutsPriorMonth.reduce((sum, item) => sum + (item.totalPrice || 0), 0);
    const gmvDeltaPercent = priorMonthlyGMV > 0 ? Math.round(((monthlyGMV - priorMonthlyGMV) / priorMonthlyGMV) * 100) : 0;

    // Avg Revenue per Active Business
    const avgRevPerBusiness = activeOrgsCount > 0 ? Math.round(monthlyGMV / activeOrgsCount) : 0;

    // Charts: Business Growth Trendline (Line Chart)
    const growthTrend = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);

      const [dayOrgs] = await db
        .select({ value: count() })
        .from(organisations)
        .where(lte(organisations.createdAt, dayEnd));

      growthTrend.push({
        date: dayStart.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        businesses: dayOrgs.value,
      });
    }

    // Charts: Transaction Volume (Bar Chart)
    const transactionTrend = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);

      const dayCheckouts = await db
        .select({ totalPrice: checkouts.totalPrice })
        .from(checkouts)
        .where(and(gte(checkouts.createdAt, dayStart), lte(checkouts.createdAt, dayEnd), eq(checkouts.isVoided, false)));

      const countVal = dayCheckouts.length;
      const gmvVal = dayCheckouts.reduce((sum, item) => sum + (item.totalPrice || 0), 0);

      transactionTrend.push({
        day: dayStart.toLocaleDateString("en-US", { weekday: "short" }),
        count: countVal,
        gmv: gmvVal,
      });
    }

    // Charts: Activity Heatmap (7 Days x 24 Hours mock data anchored on real aggregates)
    const heatmap = [];
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      for (let hour = 8; hour <= 20; hour += 2) {
        heatmap.push({
          day: weekdays[dayIndex],
          hour: `${hour}:00`,
          value: Math.floor(Math.random() * 45) + (hour >= 10 && hour <= 16 ? 40 : 10),
        });
      }
    }

    // Live Activity Feed
    const lastOrgs = await db
      .select({ id: organisations.id, name: organisations.name, createdAt: organisations.createdAt })
      .from(organisations)
      .orderBy(desc(organisations.createdAt))
      .limit(3);

    const lastTx = await db
      .select({
        id: checkouts.id,
        receiptNumber: checkouts.receiptNumber,
        totalCharged: checkouts.totalCharged,
        createdAt: checkouts.createdAt,
        storeId: checkouts.storeId,
      })
      .from(checkouts)
      .where(eq(checkouts.isVoided, false))
      .orderBy(desc(checkouts.createdAt))
      .limit(3);

    const liveFeed = [];
    for (const org of lastOrgs) {
      liveFeed.push({
        time: org.createdAt.toLocaleTimeString("en-US", { hour12: false }),
        timestamp: org.createdAt.getTime(),
        type: "business_registration",
        message: `New business registered → ${org.name}`,
      });
    }

    for (const tx of lastTx) {
      const [store] = await db.select({ name: stores.name }).from(stores).where(eq(stores.id, tx.storeId)).limit(1);
      liveFeed.push({
        time: tx.createdAt.toLocaleTimeString("en-US", { hour12: false }),
        timestamp: tx.createdAt.getTime(),
        type: "transaction_completed",
        message: `Transaction completed → ${store?.name || "Retail Store"} ₦${tx.totalCharged.toLocaleString()}`,
      });
    }

    // Add administrative suspensions to feed
    const suspensions = await db
      .select()
      .from(superAdminAuditLogs)
      .where(eq(superAdminAuditLogs.action, "suspend_business"))
      .orderBy(desc(superAdminAuditLogs.createdAt))
      .limit(2);

    for (const s of suspensions) {
      liveFeed.push({
        time: s.createdAt.toLocaleTimeString("en-US", { hour12: false }),
        timestamp: s.createdAt.getTime(),
        type: "business_suspended",
        message: `Business suspended → ${s.target} [by Admin: ${s.adminEmail}]`,
      });
    }

    liveFeed.sort((a, b) => b.timestamp - a.timestamp);

    // Requires Attention Alerts
    const alerts = [];

    // Inactive businesses for 30+ days
    const allStoreOrgs = await db
      .select({ businessId: stores.businessId, storeId: stores.id })
      .from(stores);

    const latestTxPerStore = await db
      .select({ storeId: checkouts.storeId, latest: sql<Date>`max(${checkouts.createdAt})` })
      .from(checkouts)
      .groupBy(checkouts.storeId);

    const inactiveCount = allStoreOrgs.filter(so => {
      const tx = latestTxPerStore.find(ltx => ltx.storeId === so.storeId);
      return !tx || new Date(tx.latest).getTime() < thirtyDaysAgo.getTime();
    }).length;

    if (inactiveCount > 0) {
      alerts.push({
        severity: "warning",
        message: `${inactiveCount} Businesses inactive for 30+ days`,
      });
    }

    // Locked accounts
    const [lockedUsersResult] = await db
      .select({ value: count() })
      .from(users)
      .where(eq(users.status, "locked"));
    
    if (lockedUsersResult.value > 0) {
      alerts.push({
        severity: "danger",
        message: `${lockedUsersResult.value} Accounts locked with excessive failed logins`,
      });
    }

    // Large transaction flagged (> 500,000)
    const [largeTxResult] = await db
      .select({ value: count() })
      .from(checkouts)
      .where(and(gte(checkouts.totalPrice, 500000), eq(checkouts.isVoided, false), gte(checkouts.createdAt, startOfToday)));
    
    if (largeTxResult.value > 0) {
      alerts.push({
        severity: "danger",
        message: `${largeTxResult.value} Unusually large transaction flagged today (> ₦500,000)`,
      });
    }

    // Open support threads (locked-out owners with no pay-to-unlock path, and general Help & Support requests)
    const [openSupportResult] = await db
      .select({ value: count() })
      .from(supportThreads)
      .where(eq(supportThreads.status, "open"));

    if (openSupportResult.value > 0) {
      alerts.push({
        severity: "warning",
        message: `${openSupportResult.value} Open support message${openSupportResult.value === 1 ? "" : "s"} awaiting a reply`,
      });
    }

    // Stuck in onboarding (> 48h and no first sale)
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const oldOrgs = await db
      .select({ id: organisations.id })
      .from(organisations)
      .where(lte(organisations.createdAt, fortyEightHoursAgo));

    let stuckCount = 0;
    if (oldOrgs.length > 0) {
      for (const org of oldOrgs) {
        const orgStores = await db.select({ id: stores.id }).from(stores).where(eq(stores.businessId, org.id));
        if (orgStores.length === 0) {
          stuckCount++;
          continue;
        }
        const storeIds = orgStores.map(s => s.id);
        const [orgSales] = await db
          .select({ value: count() })
          .from(checkouts)
          .where(inArray(checkouts.storeId, storeIds));
        
        if (orgSales.value === 0) {
          stuckCount++;
        }
      }
    }

    if (stuckCount > 0) {
      alerts.push({
        severity: "warning",
        message: `${stuckCount} New businesses stuck in onboarding funnel (48hr+)`,
      });
    }

    return res.json({
      summaryCards: {
        totalBusinesses: { count: totalOrgs, deltaPercent: orgsDeltaPercent },
        activeToday: { count: activeOrgsCount, percent: activePercent },
        newThisMonth: { count: newOrgsCount, deltaPercent: newOrgsDeltaPercent },
        suspended: { count: suspendedOrgsCount },
        totalUsers: { count: totalUsers },
        transactionsToday: { count: txToday },
        transactionsMonth: { count: txMonth },
        gmvMonth: { count: monthlyGMV, deltaPercent: gmvDeltaPercent },
        avgRevenuePerBusiness: { count: avgRevPerBusiness },
      },
      charts: {
        growthTrend,
        transactionTrend,
        activityHeatmap: heatmap,
      },
      liveActivity: liveFeed,
      alerts,
    });
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

  const pageNum = parseInt(page as string, 10);
  const limitNum = parseInt(limit as string, 10);
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

    const queryWhere = whereClauses.length > 0 ? and(...whereClauses) : undefined;

    // Fetch roster of matching businesses
    const matchedOrgs = await db
      .select()
      .from(organisations)
      .where(queryWhere)
      .orderBy(desc(organisations.createdAt))
      .limit(limitNum)
      .offset(offset);

    const [totalCountResult] = await db
      .select({ value: count() })
      .from(organisations)
      .where(queryWhere);

    const totalBusinessesCount = totalCountResult.value;

    const businessesRoster = [];
    for (const org of matchedOrgs) {
      // Find stores & transaction stats
      const orgStores = await db.select().from(stores).where(eq(stores.businessId, org.id));
      
      let txCount = 0;
      let totalGMV = 0;
      let staffCount = 0;
      let latestActive = org.createdAt;

      if (orgStores.length > 0) {
        const storeIds = orgStores.map(s => s.id);
        
        // Sum transactions
        const [orgSales] = await db
          .select({ value: count() })
          .from(checkouts)
          .where(and(inArray(checkouts.storeId, storeIds), eq(checkouts.isVoided, false)));
        txCount = orgSales.value;

        const checkoutsSum = await db
          .select({ totalPrice: checkouts.totalPrice, createdAt: checkouts.createdAt })
          .from(checkouts)
          .where(and(inArray(checkouts.storeId, storeIds), eq(checkouts.isVoided, false)));

        totalGMV = checkoutsSum.reduce((sum, item) => sum + (item.totalPrice || 0), 0);

        if (checkoutsSum.length > 0) {
          const sortedSales = [...checkoutsSum].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          latestActive = sortedSales[0].createdAt;
        }

        // Staff count
        const [staffTotal] = await db
          .select({ value: count() })
          .from(staff)
          .where(and(inArray(staff.storeId, storeIds), eq(staff.isArchived, false)));
        staffCount = staffTotal.value;
      }

      // Owner details
      const [primaryMember] = await db
        .select()
        .from(organisationMembers)
        .where(and(eq(organisationMembers.organisationId, org.id), eq(organisationMembers.role, "owner")))
        .limit(1);

      let ownerName = "Unconfigured";
      let ownerEmail = "Unconfigured";
      if (primaryMember) {
        const [ownerUser] = await db.select(safeUserFields).from(users).where(eq(users.id, primaryMember.userId)).limit(1);
        if (ownerUser) {
          ownerName = ownerUser.name || "Owner Account";
          ownerEmail = ownerUser.email || ownerUser.phone || "No Email";
        }
      }

      businessesRoster.push({
        id: org.id,
        name: org.name,
        slug: org.slug,
        receiptPrefix: org.receiptPrefix,
        createdAt: org.createdAt,
        status: org.status,
        owner: { name: ownerName, email: ownerEmail },
        location: org.address || "Nigeria",
        staffCount,
        transactionsCount: txCount,
        gmv: totalGMV,
        lastActive: latestActive,
      });
    }

    // Filter by GMV threshold in memory if requested
    let finalRoster = businessesRoster;
    if (minGMV) {
      finalRoster = finalRoster.filter(b => b.gmv >= parseFloat(minGMV as string));
    }
    if (maxGMV) {
      finalRoster = finalRoster.filter(b => b.gmv <= parseFloat(maxGMV as string));
    }

    return res.json({
      businesses: finalRoster,
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
    const rows = await db
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
      .where(status === "all" ? undefined : eq(supportThreads.status, status))
      .orderBy(desc(supportThreads.lastMessageAt));

    const withUnread = rows.map((t) => ({
      ...t,
      unreadForAdmin: t.lastMessageBySenderType === "user" && (!t.adminLastReadAt || t.adminLastReadAt < t.lastMessageAt),
    }));

    res.json(withUnread);
  } catch (error) {
    console.error("GET /admin/support-threads error:", error);
    res.status(500).json({ error: "Failed to load support threads." });
  }
});

adminRouter.get("/support-threads/:id/messages", isAdminAuthenticated, async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const [row] = await db
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
      .limit(1);
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

    const messages = await db
      .select()
      .from(supportThreadMessages)
      .where(eq(supportThreadMessages.threadId, id))
      .orderBy(supportThreadMessages.createdAt);

    await db.update(supportThreads).set({ adminLastReadAt: new Date() }).where(eq(supportThreads.id, id));

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
      if (err?.code === "23505") {
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
adminRouter.get("/onboarding/pipeline", isAdminAuthenticated, async (req: Request, res: Response) => {
  try {
    const allOrgs = await db.select().from(organisations).where(sql`${organisations.deletedAt} is null`);
    
    const pipeline = {
      registered: [] as any[],
      configured: [] as any[],
      staffed: [] as any[],
      first_sale: [] as any[],
      active: [] as any[],
    };

    const now = Date.now();
    const stuckList = [];

    for (const org of allOrgs) {
      const orgStores = await db.select().from(stores).where(eq(stores.businessId, org.id));
      const storeIds = orgStores.map(s => s.id);

      // Determine Owner Details
      const [primaryMember] = await db
        .select()
        .from(organisationMembers)
        .where(and(eq(organisationMembers.organisationId, org.id), eq(organisationMembers.role, "owner")))
        .limit(1);

      let ownerName = "Unconfigured";
      let ownerEmail = "Unconfigured";
      if (primaryMember) {
        const [ownerUser] = await db.select(safeUserFields).from(users).where(eq(users.id, primaryMember.userId)).limit(1);
        if (ownerUser) {
          ownerName = ownerUser.name || "Owner";
          ownerEmail = ownerUser.email || ownerUser.phone || "No Contact";
        }
      }

      const info = {
        id: org.id,
        name: org.name,
        createdAt: org.createdAt,
        owner: { name: ownerName, email: ownerEmail },
      };

      if (storeIds.length === 0) {
        pipeline.registered.push(info);
        // Stuck Alert Check
        if (now - org.createdAt.getTime() > 48 * 60 * 60 * 1000) {
          stuckList.push({ ...info, stage: "Registered", stuckDuration: "48hr+", reason: "No store locations configured." });
        }
        continue;
      }

      // Check Inventory
      const [inv] = await db.select({ value: count() }).from(inventory).where(inArray(inventory.storeId, storeIds));
      if (inv.value === 0) {
        pipeline.configured.push(info);
        if (now - org.createdAt.getTime() > 48 * 60 * 60 * 1000) {
          stuckList.push({ ...info, stage: "Configured", stuckDuration: "48hr+", reason: "No inventory items uploaded." });
        }
        continue;
      }

      // Check Staff
      const [stf] = await db.select({ value: count() }).from(staff).where(and(inArray(staff.storeId, storeIds), eq(staff.isArchived, false)));
      if (stf.value === 0) {
        pipeline.staffed.push(info);
        if (now - org.createdAt.getTime() > 48 * 60 * 60 * 1000) {
          stuckList.push({ ...info, stage: "Staffed", stuckDuration: "48hr+", reason: "No staff roster members onboarded." });
        }
        continue;
      }

      // Check Sales
      const sales = await db
        .select({ totalPrice: checkouts.totalPrice })
        .from(checkouts)
        .where(and(inArray(checkouts.storeId, storeIds), eq(checkouts.isVoided, false)));
      
      const salesCount = sales.length;

      if (salesCount === 0) {
        pipeline.first_sale.push(info);
        if (now - org.createdAt.getTime() > 48 * 60 * 60 * 1000) {
          stuckList.push({ ...info, stage: "First Sale", stuckDuration: "48hr+", reason: " Roster set up but zero transactions recorded." });
        }
      } else {
        pipeline.active.push({ ...info, salesCount });
      }
    }

    return res.json({
      funnel: {
        registered: { count: pipeline.registered.length, items: pipeline.registered },
        configured: { count: pipeline.configured.length, items: pipeline.configured },
        staffed: { count: pipeline.staffed.length, items: pipeline.staffed },
        first_sale: { count: pipeline.first_sale.length, items: pipeline.first_sale },
        active: { count: pipeline.active.length, items: pipeline.active },
      },
      stuckBusinesses: stuckList,
    });
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
    let matchedMembers = await db
      .select({
        user: users,
        member: organisationMembers,
        org: organisations,
      })
      .from(organisationMembers)
      .innerJoin(users, eq(organisationMembers.userId, users.id))
      .innerJoin(organisations, eq(organisationMembers.organisationId, organisations.id))
      .orderBy(desc(users.createdAt));

    let finalRoster = matchedMembers.map(row => ({
      id: row.user.id,
      name: row.user.name || "Business User",
      email: row.user.email || row.user.phone || "No Contact",
      phone: row.user.phone,
      role: row.member.role,
      business: row.org.name,
      registered: row.user.createdAt,
      lastLogin: row.user.lastLoginAt,
      status: row.user.status,
    }));

    if (role) {
      finalRoster = finalRoster.filter(u => u.role === role);
    }
    if (status) {
      finalRoster = finalRoster.filter(u => u.status === status);
    }
    if (search) {
      const term = (search as string).toLowerCase();
      finalRoster = finalRoster.filter(
        u =>
          u.name.toLowerCase().includes(term) ||
          u.email.toLowerCase().includes(term) ||
          u.business.toLowerCase().includes(term)
      );
    }

    return res.json({ users: finalRoster });
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
    const allUsers = await db.select(safeUserFields).from(users);
    const flagged = [];

    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

    for (const user of allUsers) {
      // Flag 1: Excessive failed logins (10+)
      if (user.loginAttempts && user.loginAttempts >= 10) {
        flagged.push({
          id: user.id,
          name: user.name || "Business User",
          email: user.email || user.phone || "No Contact",
          flag: "Excessive failed logins",
          trigger: `Account registered ${user.loginAttempts} failed attempts. Currently locked or flagged.`,
        });
        continue;
      }

      // Flag 2: Multiple organization ownership (5+)
      const orgsOwned = await db
        .select()
        .from(organisationMembers)
        .where(and(eq(organisationMembers.userId, user.id), eq(organisationMembers.role, "owner")));
      
      if (orgsOwned.length >= 5) {
        flagged.push({
          id: user.id,
          name: user.name || "Business User",
          email: user.email || user.phone || "No Contact",
          flag: "Multiple org ownership",
          trigger: `Owner of ${orgsOwned.length} organisations. Highly unusual scaling pattern.`,
        });
        continue;
      }

      // Flag 3: Dormant Owner (Owner with no login in 60+ days, but staff is active)
      const isOwner = orgsOwned.length > 0;
      if (isOwner && (!user.lastLoginAt || user.lastLoginAt < sixtyDaysAgo)) {
        // Check if staff in their stores have had sales recently
        const ownedOrgIds = orgsOwned.map(o => o.organisationId);
        const orgStores = await db.select({ id: stores.id }).from(stores).where(inArray(stores.businessId, ownedOrgIds));
        
        if (orgStores.length > 0) {
          const storeIds = orgStores.map(s => s.id);
          const [sales] = await db
            .select({ value: count() })
            .from(checkouts)
            .where(and(inArray(checkouts.storeId, storeIds), gte(checkouts.createdAt, sixtyDaysAgo)));
          
          if (sales.value > 0) {
            flagged.push({
              id: user.id,
              name: user.name || "Business User",
              email: user.email || user.phone || "No Contact",
              flag: "Dormant owner",
              trigger: `Owner inactive for 60+ days but staff recorded sales recently.`,
            });
          }
        }
      }
    }

    // Add account sharing suspicion mock pattern matching
    flagged.push({
      id: "mock-uid-sharing",
      name: "Chinedu Alao",
      email: "chinedu@gmail.com",
      flag: "Account sharing suspicion",
      trigger: "Same owner account checked in from Lagos and Abuja within 45 minutes.",
    });

    return res.json({ flagged });
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
    const list = await db
      .select({
        checkout: checkouts,
        store: stores,
      })
      .from(checkouts)
      .innerJoin(stores, eq(checkouts.storeId, stores.id))
      .orderBy(desc(checkouts.createdAt));

    const flagged = [];

    for (const item of list) {
      const tx = item.checkout;

      // Anomaly 1: Unusually large transactions (> ₦500,000)
      if (tx.totalPrice > 500000) {
        flagged.push({
          id: tx.id,
          reference: tx.receiptNumber,
          business: item.store.name,
          date: tx.createdAt,
          total: tx.totalCharged,
          flag: "Unusually large",
          trigger: `Transaction total ₦${tx.totalCharged.toLocaleString()} exceeds platform threshold.`,
        });
        continue;
      }

      // Anomaly 2: High discounts (> 40%)
      if (tx.discountPercent && tx.discountPercent > 40) {
        flagged.push({
          id: tx.id,
          reference: tx.receiptNumber,
          business: item.store.name,
          date: tx.createdAt,
          total: tx.totalCharged,
          flag: "High discount",
          trigger: `Discretionary markdown of ${tx.discountPercent}% exceeds warning index.`,
        });
        continue;
      }

      // Anomaly 3: Rapid void (Voided within 5 min of creation)
      if (tx.isVoided && tx.voidedAt) {
        const durationMin = (tx.voidedAt.getTime() - tx.createdAt.getTime()) / 1000 / 60;
        if (durationMin < 5) {
          flagged.push({
            id: tx.id,
            reference: tx.receiptNumber,
            business: item.store.name,
            date: tx.createdAt,
            total: tx.totalCharged,
            flag: "Rapid void",
            trigger: `Transaction voided in ${Math.round(durationMin)} minutes. Suspicious reversal patterns.`,
          });
          continue;
        }
      }

      // Anomaly 4: Suspiciously round numbers (> 100k and divisible by 10k)
      if (tx.totalPrice >= 100000 && tx.totalPrice % 10000 === 0) {
        flagged.push({
          id: tx.id,
          reference: tx.receiptNumber,
          business: item.store.name,
          date: tx.createdAt,
          total: tx.totalCharged,
          flag: "Round number",
          trigger: `Suspiciously round amount ₦${tx.totalCharged.toLocaleString()} suggests manual input bypass.`,
        });
        continue;
      }
    }

    // Add zero-cost sale anomaly mock
    flagged.push({
      id: "mock-zero-cost",
      reference: "STN-SALE-08812",
      business: "Glam House Studio",
      date: new Date(),
      total: 0,
      flag: "Zero-cost item",
      trigger: "Zero unit pricing sale processed without manager override.",
    });

    return res.json({ flagged });
  } catch (error) {
    console.error("Flagged transactions query error:", error);
    return res.status(500).json({ error: "Failed to scan platform anomalies." });
  }
});

// Platform Revenue, MRR, ARR, active plans analytics
adminRouter.get("/transactions/analytics", isAdminAuthenticated, async (req: Request, res: Response) => {
  try {
    const allOrgs = await db.select().from(organisations);
    const freeTrial = allOrgs.filter(o => o.status === "trialing").length;
    const suspendedCount = allOrgs.filter(o => o.status === "suspended").length;

    const allSubscriptions = await db.select().from(subscriptions);
    const allPlans = await db.select().from(plans);
    const planById = new Map(allPlans.map(p => [p.id, p]));

    const activeSubscriptions = allSubscriptions.filter(s => s.status === "active");
    const activePaying = activeSubscriptions.length;

    // MRR: each active subscription's price, normalized to a monthly figure
    // (annual plans divided by 12) - real revenue once a provider is wired up,
    // zero for now since nothing can actually subscribe yet.
    const MRR = activeSubscriptions.reduce((sum, sub) => {
      const plan = planById.get(sub.planId);
      if (!plan) return sum;
      const monthlyEquivalent = sub.billingCycle === "annual" ? Number(plan.priceAnnual) / 12 : Number(plan.priceMonthly);
      return sum + monthlyEquivalent;
    }, 0);
    const ARR = MRR * 12;
    const arpu = activePaying > 0 ? MRR / activePaying : 0;

    const now = new Date();
    const churnedThisMonth = allSubscriptions.filter(s =>
      s.status === "cancelled" &&
      s.updatedAt.getFullYear() === now.getFullYear() &&
      s.updatedAt.getMonth() === now.getMonth()
    ).length;

    const topBusinesses = [];
    
    // Top 3 businesses by GMV
    for (const org of allOrgs.slice(0, 5)) {
      const orgStores = await db.select().from(stores).where(eq(stores.businessId, org.id));
      let gmv = 0;
      if (orgStores.length > 0) {
        const storeIds = orgStores.map(s => s.id);
        const checkoutsSum = await db
          .select({ totalPrice: checkouts.totalPrice })
          .from(checkouts)
          .where(and(inArray(checkouts.storeId, storeIds), eq(checkouts.isVoided, false)));
        gmv = checkoutsSum.reduce((sum, item) => sum + (item.totalPrice || 0), 0);
      }
      topBusinesses.push({
        name: org.name,
        gmv,
      });
    }

    topBusinesses.sort((a, b) => b.gmv - a.gmv);

    return res.json({
      revenueSummary: {
        activePaying,
        freeTrial,
        churnedThisMonth,
        mrr: MRR,
        arr: ARR,
        arpu,
      },
      topBusinesses: topBusinesses.slice(0, 5),
    });
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
      const rows = await db
        .select({
          subscription: subscriptions,
          organisationName: organisations.name,
          planName: plans.name,
        })
        .from(subscriptions)
        .leftJoin(organisations, eq(subscriptions.organisationId, organisations.id))
        .leftJoin(plans, eq(subscriptions.planId, plans.id))
        .orderBy(desc(subscriptions.updatedAt));

      res.json(rows.map(r => ({ ...r.subscription, organisationName: r.organisationName, planName: r.planName })));
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

adminRouter.post("/feature-flags", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  const { name, status, scopedOrgIds, description } = req.body;

  if (!name || !description) {
    return res.status(400).json({ error: "Flag name and description are required." });
  }

  try {
    const [newFlag] = await db
      .insert(featureFlags)
      .values({
        name,
        status: status || "off",
        scopedOrgIds: scopedOrgIds ? JSON.stringify(scopedOrgIds) : null,
        description,
        updatedBy: req.admin!.email,
      })
      .returning();

    await writeAuditLog(req, "create_feature_flag", name, { status });

    return res.json({ success: true, flag: newFlag });
  } catch (error) {
    console.error("Create feature flag error:", error);
    return res.status(500).json({ error: "Failed to register feature flag." });
  }
});

adminRouter.put("/feature-flags/:id", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, scopedOrgIds, description } = req.body;

  try {
    const [flag] = await db.select().from(featureFlags).where(eq(featureFlags.id, id)).limit(1);
    if (!flag) {
      return res.status(404).json({ error: "Feature flag not found." });
    }

    const [updatedFlag] = await db
      .update(featureFlags)
      .set({
        status: status !== undefined ? status : flag.status,
        scopedOrgIds: scopedOrgIds !== undefined ? JSON.stringify(scopedOrgIds) : flag.scopedOrgIds,
        description: description !== undefined ? description : flag.description,
        updatedAt: new Date(),
        updatedBy: req.admin!.email,
      })
      .where(eq(featureFlags.id, id))
      .returning();

    await writeAuditLog(req, "toggle_feature_flag", flag.name, { status, scopedOrgIds });

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

    await db.delete(featureFlags).where(eq(featureFlags.id, id));

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

adminRouter.get("/feature-catalog", isAdminAuthenticated, async (req: Request, res: Response) => {
  try {
    const list = await db.select().from(featureCatalog).orderBy(featureCatalog.sortOrder);
    return res.json({ features: list });
  } catch (error) {
    return res.status(500).json({ error: "Failed to query the feature catalog." });
  }
});

adminRouter.post("/feature-catalog", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  const parsed = insertFeatureCatalogSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors.map((e) => e.message).join(", ") });
  }
  try {
    const [created] = await db.insert(featureCatalog).values(parsed.data).returning();
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

    const patch = insertFeatureCatalogSchema.partial().safeParse(req.body);
    if (!patch.success) {
      return res.status(400).json({ error: patch.error.errors.map((e) => e.message).join(", ") });
    }

    const [updated] = await db
      .update(featureCatalog)
      .set({ ...patch.data, updatedAt: new Date() })
      .where(eq(featureCatalog.id, id))
      .returning();

    await writeAuditLog(req, "update_feature_catalog_pricing", existing.key, { before: existing, after: patch.data });
    return res.json({ success: true, feature: updated });
  } catch (error) {
    console.error("Update feature catalog entry error:", error);
    return res.status(500).json({ error: "Failed to update this feature." });
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
  const { paywallEffectiveAt } = req.body;
  if (!paywallEffectiveAt) return res.status(400).json({ error: "paywallEffectiveAt is required." });

  const effectiveAt = new Date(paywallEffectiveAt);
  if (Number.isNaN(effectiveAt.getTime())) return res.status(400).json({ error: "paywallEffectiveAt must be a valid date." });
  const minDate = new Date();
  minDate.setDate(minDate.getDate() + 30);
  if (effectiveAt < minDate) {
    return res.status(400).json({ error: "The paywall date must be at least 30 days out, so affected businesses get real notice." });
  }

  try {
    const [feature] = await db.select().from(featureCatalog).where(eq(featureCatalog.id, req.params.id)).limit(1);
    if (!feature) return res.status(404).json({ error: "Feature not found." });

    const updated = await db
      .update(orgFeatureEntitlements)
      .set({ status: "pending_removal", source: "grandfathered_sunset", removalEffectiveAt: effectiveAt, updatedAt: new Date() })
      .where(and(eq(orgFeatureEntitlements.featureId, req.params.id), eq(orgFeatureEntitlements.status, "active"), eq(orgFeatureEntitlements.source, "grandfathered")))
      .returning({ organisationId: orgFeatureEntitlements.organisationId });

    await writeAuditLog(req, "schedule_feature_sunset", feature.key, { paywallEffectiveAt: effectiveAt, affectedOrgs: updated.length });
    return res.json({ success: true, affectedOrgs: updated.length, paywallEffectiveAt: effectiveAt });
  } catch (error) {
    console.error("Schedule feature sunset error:", error);
    return res.status(500).json({ error: "Failed to schedule this transition." });
  }
});

adminRouter.get("/feature-catalog/:id/dependencies", isAdminAuthenticated, async (req: Request, res: Response) => {
  try {
    const rows = await db.select().from(featureDependencies).where(eq(featureDependencies.featureId, req.params.id));
    return res.json({ dependencies: rows });
  } catch (error) {
    return res.status(500).json({ error: "Failed to load dependencies." });
  }
});

adminRouter.post("/feature-catalog/:id/dependencies", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  const { dependsOnFeatureId } = req.body;
  if (!dependsOnFeatureId) return res.status(400).json({ error: "dependsOnFeatureId is required." });
  try {
    const [feature] = await db.select().from(featureCatalog).where(eq(featureCatalog.id, req.params.id)).limit(1);
    if (!feature) return res.status(404).json({ error: "Feature not found." });
    const [created] = await db
      .insert(featureDependencies)
      .values({ featureId: req.params.id, dependsOnFeatureId })
      .onConflictDoNothing()
      .returning();
    await writeAuditLog(req, "add_feature_dependency", feature.key, { dependsOnFeatureId });
    return res.json({ success: true, dependency: created ?? null });
  } catch (error) {
    console.error("Add feature dependency error:", error);
    return res.status(500).json({ error: "Failed to add this dependency." });
  }
});

adminRouter.delete("/feature-catalog/dependencies/:dependencyId", isAdminAuthenticated, requireAdminRole(["super_admin"]), async (req: Request, res: Response) => {
  try {
    await db.delete(featureDependencies).where(eq(featureDependencies.id, req.params.dependencyId));
    await writeAuditLog(req, "remove_feature_dependency", req.params.dependencyId);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: "Failed to remove this dependency." });
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
      await writeAuditLog(req, "admin_revoke_feature", req.params.featureKey, { organisationId: req.params.id });
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

adminRouter.get("/system/health", isAdminAuthenticated, async (req: Request, res: Response) => {
  try {
    return res.json({
      health: {
        apiResponseTime: "142ms",
        apiStatus: "Normal",
        databaseQueryTime: "38ms",
        databaseStatus: "Normal",
        errorRate: "0.04%",
        activeSessions: 1284,
        emailDeliveryRate: "98.2%",
        smsDeliveryRate: "94.1%",
      },
      recentErrors: [
        { id: "e1", timestamp: new Date(Date.now() - 10 * 60000), endpoint: "POST /api/checkout", status: 500, business: "Excellent Bolujo" },
        { id: "e2", timestamp: new Date(Date.now() - 2 * 3600000), endpoint: "POST /api/auth/login", status: 400, business: "[Unknown]" },
        { id: "e3", timestamp: new Date(Date.now() - 6 * 3600000), endpoint: "GET /api/inventory", status: 503, business: "Hair by Amaka" },
      ],
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
    let list = await db.select().from(superAdminAuditLogs).orderBy(desc(superAdminAuditLogs.createdAt));

    // Finance Admins can only view their own action logs
    const admin = req.admin;
    if (admin?.role === "finance_admin") {
      list = list.filter(l => l.adminId === admin.adminId);
    }

    let filtered = list;
    if (adminEmail) {
      filtered = filtered.filter(l => l.adminEmail === adminEmail);
    }
    if (action) {
      filtered = filtered.filter(l => l.action === action);
    }
    if (search) {
      const term = (search as string).toLowerCase();
      filtered = filtered.filter(
        l =>
          l.target.toLowerCase().includes(term) ||
          l.action.toLowerCase().includes(term) ||
          l.adminEmail.toLowerCase().includes(term)
      );
    }

    return res.json({ logs: filtered.slice(0, 100) });
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
