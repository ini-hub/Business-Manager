import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import crypto from "crypto";
import { storage } from "./storage";
import { setupAuth, isAuthenticated, generateToken, verifyToken } from "./auth";
import { setupAdminAuth } from "./auth-admin";
import { adminRouter } from "./routes-admin";
import {
  sendActivationEmail,
  sendAddedToOrgEmail,
  sendOtpEmail,
  sendPasswordChangedEmail,
  sendAccountLockedEmail,
  sendSMS,
  sendEmailVerificationOtpEmail
} from "./email";
import rateLimit from "express-rate-limit";
import bcrypt from "bcrypt";
import { serveOgImage } from "./og-image";
import {
  insertBusinessSchema,
  insertStoreSchema,
  insertCustomerSchema,
  insertStaffSchema,
  insertInventorySchema,
  insertPromotionSchema,
  signupSchema,
  loginSchema,
  verifyOtpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  passwordSchema,
  type UserRole,
  orders,
  checkouts,
  promotions,
  transactions,
  customers,
  inventory,
  staff,
  customRoles,
  insertCustomRoleSchema,
  insertStoreIntegrationSchema,
  taxRates,
  repayments,
  expenses,
  cashDrops,
  creditEntries,
  cashRegisterSessions,
  insertExpenseSchema,
} from "@shared/schema";
import { z } from "zod";
import { db } from "./db";
import { eq, and, gte, lte, gt, count, desc } from "drizzle-orm";
import { sanitizeString, sanitizeUUID, sanitizeNumber, sanitizeBoolean, sanitizePhoneNumber, sanitizeStoreCode } from "./sanitize";
import { auditLogger } from "./audit";
import { bulkUploadService } from "./services/BulkUploadService";
import { analyticsService } from "./services/AnalyticsService";
import { initWebSocketServer } from "./websocket";
import { RouterRegistry } from "./controllers/RouterRegistry";
import { AuthController } from "./controllers/AuthController";
import { InventoryController } from "./controllers/InventoryController";
import { ProductController } from "./controllers/ProductController";
import { BookingController } from "./controllers/BookingController";
import { CreditController } from "./controllers/CreditController";
import { registerBusinessRoutes } from "./routes/business.routes";
import { registerCustomerRoutes } from "./routes/customer.routes";
import { registerStaffRoutes } from "./routes/staff.routes";
import { registerInventoryRoutes } from "./routes/inventory.routes";
import { registerTransactionRoutes } from "./routes/transaction.routes";
import { registerSalesRoutes } from "./routes/sales.routes";
import { registerSettingsRoutes } from "./routes/settings.routes";
import { registerPayrollRoutes } from "./routes/payroll.routes";
import { registerReportsRoutes } from "./routes/reports.routes";
import { registerVendorRoutes } from "./routes/vendor.routes";
import { registerPaymentRoutes } from "./routes/payment.routes";
import { registerCashRoutes } from "./routes/cash.routes";

const SALT_ROUNDS = 12;

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

function getUserId(req: Request): string | undefined {
  return (req as any).user?.claims?.sub;
}

// Rate limiting configuration for security
const apiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 500, // 500 requests per 10 min per IP
  message: { error: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 auth attempts per minute per IP
  message: { error: "Too many login attempts, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

function formatZodErrors(errors: z.ZodIssue[]): string {
  const messages = errors.map((err) => {
    const field = err.path[0] || "field";
    const fieldName = String(field).charAt(0).toUpperCase() + String(field).slice(1).replace(/([A-Z])/g, " $1");
    return `${fieldName}: ${err.message}`;
  });
  return messages.join(". ");
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Initialize WebSocket server for live push notifications
  initWebSocketServer(httpServer);

  // Apply rate limiting to all API routes
  app.use("/api/", apiLimiter);

  // Apply stricter rate limiting to auth endpoints
  app.use("/api/auth", authLimiter);

  // Setup authentication
  await setupAuth(app);
  await setupAdminAuth(app);

  // Mount Admin Router
  app.use("/api/admin", adminRouter);

  // Health check endpoint (no auth required, used by hosting providers)
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString(), uptime: process.uptime() });
  });

  // Public: OG social share image — no auth required
  app.get("/og-image.png", serveOgImage);

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
  async function checkStoreAccess(storeId: string, req: Request, res: Response): Promise<boolean> {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: "Authentication required." });
      return false;
    }
    const store = await storage.getStore(storeId);
    if (!store) {
      res.status(404).json({ error: "Store not found." });
      return false;
    }

    // Verify user has direct membership access to the business the store belongs to
    const member = await storage.getOrganisationMember(userId, store.businessId);
    if (!member) {
      res.status(403).json({ error: "Unauthorized access to store data." });
      return false;
    }

    // Staff members are restricted to their own assigned store
    const userRole = (req as any).user?.role;
    if (userRole === "staff") {
      const staffRecord = await storage.getStaffByUserId(userId);
      if (staffRecord && staffRecord.storeId !== storeId) {
        res.status(403).json({ error: "Staff members can only access their assigned store." });
        return false;
      }
    }

    return true;
  }

  async function checkBusinessAccess(businessId: string, req: Request, res: Response): Promise<boolean> {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ error: "Authentication required." });
      return false;
    }
    const member = await storage.getOrganisationMember(userId, businessId);
    if (!member) {
      res.status(403).json({ error: "Unauthorized access to business data." });
      return false;
    }
    return true;
  }

  async function getUserStores(req: Request): Promise<any[]> {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    if (!userId) return [];
    const user = await storage.getUser(userId);
    if (!user || !user.businessId) return [];
    return await storage.getStores(user.businessId);
  }



  // ========== CUSTOM AUTH ROUTES ==========

  const LOCKOUT_TIME_MS = 30 * 60 * 1000;
  const MAX_LOGIN_ATTEMPTS = 5;

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

      // 3. If user is self-registered and email not verified yet -> send OTP and require OTP verification
      if (user.email && !user.isEmailVerified && !user.createdByInvitation) {
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
        await storage.updateUser(user.id, {
          otpCode,
          otpExpiry,
        });

        await sendEmailVerificationOtpEmail(user.email, user.name || user.email, otpCode);

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

      // Check if email already exists
      const existingUser = await storage.getUserByIdentifier(normalizedEmail);
      if (existingUser) {
        return res.status(400).json({ error: "This email address is already registered. Please use a different email or log in." });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(data.password, SALT_ROUNDS);

      // Create organisation
      const organisation = await storage.createOrganisation({
        name: data.businessName,
        slug: data.businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        receiptPrefix: data.businessName.substring(0, 3).toUpperCase(),
      });

      // Generate a 6-digit OTP code for email verification
      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Create platform user in unverified state
      const user = await storage.createUser({
        email: normalizedEmail,
        password: hashedPassword,
        businessId: organisation.id, // For backward compatibility
        role: "owner", // For backward compatibility
        isVerified: false,
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

      // Send the verification OTP email
      await sendEmailVerificationOtpEmail(
        normalizedEmail,
        normalizedEmail,
        otpCode,
        data.businessName
      );

      auditLogger.logAuthAttempt(user.id, getClientIp(req), true, "signup_pending_otp");

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
      
      const errStr = String(error);
      if (errStr.includes("organisations_slug_key") || errStr.includes("duplicate key value violates unique constraint")) {
        return res.status(400).json({ 
          error: "A business with a similar name is already registered. Please choose a slightly different business name to proceed successfully." 
        });
      }
      
      res.status(500).json({ error: String(error) });
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
      const otpMatch = user?.otpCode &&
        otp?.length === user.otpCode.length &&
        crypto.timingSafeEqual(Buffer.from(user.otpCode), Buffer.from(otp));
      if (!user || !otpMatch) {
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
          loginAttempts: 0,
          lockedUntil: null,
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

  // Forgot password
  app.post("/api/auth/forgot-password", async (req: Request, res: Response) => {
    try {
      const { emailOrPhone } = req.body;
      if (!emailOrPhone) {
        return res.status(400).json({ error: "Email or phone number is required." });
      }

      const user = await storage.getUserByIdentifier(emailOrPhone);
      if (!user) {
        // Return success to avoid user enumeration
        return res.json({ message: "If account exists, an OTP code has been sent." });
      }

      // Generate random 6-digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Store in DB user record
      await storage.updateUser(user.id, {
        otpCode: otp,
        otpExpiry: expiresAt,
        otpAttempts: 0,
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
        return res.status(404).json({ error: "Account not found." });
      }

      // Generate random 6-digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Store in DB user record
      await storage.updateUser(user.id, {
        otpCode: otp,
        otpExpiry: expiresAt,
        otpAttempts: 0,
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
          const lockedUntil = new Date(Date.now() + LOCKOUT_TIME_MS);
          await storage.updateUser(user.id, {
            loginAttempts: 0,
            lockedUntil,
          });
          if (user.email) {
            await sendAccountLockedEmail(user.email, user.name || user.email);
          }
          auditLogger.logAuthAttempt(user.id, getClientIp(req), false, "lockout");
          return res.status(423).json({
            error: "Too many failed attempts. Your account has been locked for 30 minutes.",
            lockedUntil,
          });
        } else {
          await storage.updateUser(user.id, { loginAttempts: attempts });
          auditLogger.logAuthAttempt(user.id, getClientIp(req), false, "login");
          return res.status(401).json({ error: `Invalid email/phone or password. ${MAX_LOGIN_ATTEMPTS - attempts} attempts remaining.` });
        }
      }

      // Reset login attempts on success
      await storage.updateUser(user.id, { loginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() });
      auditLogger.logAuthAttempt(user.id, getClientIp(req), true, "login");

      // Block unverified users who try to bypass /continue and call /login directly
      if (user.email && !user.isEmailVerified && !user.createdByInvitation) {
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
        await storage.updateUser(user.id, { otpCode, otpExpiry });
        await sendEmailVerificationOtpEmail(user.email, user.name || user.email, otpCode);
        return res.json({ status: "email_verification_required", email: user.email });
      }

      // Fetch user organizations
      const members = await storage.getOrganisationsByUserId(user.id);
      const activeMembers = members.filter(m => m.status === "active");

      if (activeMembers.length === 0) {
        return res.status(403).json({ error: "Your account is not associated with any active organisation." });
      }

      // If user belongs to multiple organizations, let them choose
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
          userId: user.id,
        });
      }

      // Single organization path - scope JWT immediately
      const activeMember = activeMembers[0];
      const org = await storage.getBusinessById(activeMember.organisationId);
      
      const payload = {
        userId: user.id,
        organisationId: activeMember.organisationId,
        role: activeMember.role,
        staffId: activeMember.staffId || undefined,
        email: user.email || undefined,
      };

      const token = generateToken(payload, data.stayLoggedIn);

      // Set httpOnly cookie
      res.cookie("jwt_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: data.stayLoggedIn ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000,
        sameSite: "lax",
      });

      const sessionUser = {
        id: user.id,
        email: user.email || user.phone || "",
        role: activeMember.role,
        businessId: activeMember.organisationId,
        isVerified: user.isVerified || user.isEmailVerified || user.isPhoneVerified,
      };

      (req as any).user = payload;

      res.json({
        message: "Login successful.",
        user: sessionUser,
        business: org,
      });
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
      const { userId, organisationId, stayLoggedIn } = req.body;
      if (!userId || !organisationId) {
        return res.status(400).json({ error: "User ID and Organisation ID are required." });
      }

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

      const token = generateToken(payload, stayLoggedIn);

      res.cookie("jwt_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: stayLoggedIn ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000,
        sameSite: "lax",
      });

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
      const userId = (req as any).user.userId;

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

      const token = generateToken(payload, false);

      res.cookie("jwt_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: "lax",
      });

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

      const userId = (req as any).user.userId || (req as any).user.id;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User account not found." });
      }

      // Create new organisation
      const nameTrimmed = name.trim();
      const slug = nameTrimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Math.floor(1000 + Math.random() * 9000);
      const organisation = await storage.createOrganisation({
        name: nameTrimmed,
        slug,
        receiptPrefix: nameTrimmed.substring(0, 3).toUpperCase(),
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

      const token = generateToken(payload, false);

      res.cookie("jwt_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: "lax",
      });

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

      // Normalise code (strip hyphens and uppercase)
      const cleanInput = activationCode.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      const cleanStored = user.activationCode ? user.activationCode.replace(/[^A-Za-z0-9]/g, "").toUpperCase() : "";

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
      }

      res.json({
        success: true,
        message: "Activation code verified successfully. Please proceed to create your password.",
        email: user.email,
        phone: user.phone,
        nextStep: "create-password",
      });
    } catch (error) {
      console.error("Activate endpoint error:", error);
      res.status(500).json({ error: "server_error", message: "Something went wrong. Please try again." });
    }
  };

  app.post("/api/auth/verify-activation-code", activateHandler);
  app.post("/api/auth/activate", activateHandler);

  // Resend Activation Code Endpoint
  app.post("/api/auth/resend-activation", async (req: Request, res: Response) => {
    try {
      const { emailOrPhone } = req.body;
      if (!emailOrPhone) {
        return res.status(400).json({ error: "Email or phone number is required." });
      }

      const user = await storage.getUserByIdentifier(emailOrPhone);
      if (!user) {
        return res.status(404).json({ error: "Account not found." });
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

      // Generate a new premium XXXX-XXXX activation code
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      let newCode = "";
      for (let i = 0; i < 4; i++) {
        newCode += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      newCode += "-";
      for (let i = 0; i < 4; i++) {
        newCode += chars.charAt(Math.floor(Math.random() * chars.length));
      }

      await storage.updateUser(user.id, {
        activationCode: newCode,
        activationCodeExpiry: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48 hours
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

      // Fetch and activate workspace membership
      const members = await storage.getOrganisationsByUserId(user.id);
      let targetMember = members.find(m => m.status === "partial") || members.find(m => m.status === "pending") || members.find(m => m.status === "active");
      if (!targetMember) {
        return res.status(400).json({ error: "No workspace association found." });
      }

      if (targetMember.status !== "active") {
        targetMember = await storage.updateOrganisationMemberStatus(targetMember.memberId || targetMember.id, "active", new Date());
      }

      const org = await storage.getBusinessById(targetMember.organisationId);

      // Generate session JWT
      const payload = {
        userId: user.id,
        organisationId: targetMember.organisationId,
        role: targetMember.role,
        staffId: targetMember.staffId || undefined,
        email: user.email || undefined,
      };

      const token = generateToken(payload);

      res.cookie("jwt_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: "lax",
      });

      res.json({
        message: "Password set and logged in successfully.",
        user: {
          id: user.id,
          email: user.email || user.phone || "",
          role: targetMember.role,
          businessId: targetMember.organisationId,
          isVerified: true,
        },
        business: org,
      });
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

      if (!user.isEmailVerified) {
        const verifyMatch = user.otpCode &&
          otp?.length === user.otpCode.length &&
          crypto.timingSafeEqual(Buffer.from(user.otpCode), Buffer.from(otp));
        if (!verifyMatch) {
          return res.status(400).json({ error: "Invalid verification code." });
        }

        if (user.otpExpiry && new Date() > new Date(user.otpExpiry)) {
          return res.status(400).json({ error: "Verification code has expired." });
        }

        // Mark email as verified
        await storage.updateUser(user.id, {
          isEmailVerified: true,
          isVerified: true,
          otpCode: null,
          otpExpiry: null,
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

      let activeMember = members.find(m => m.status === "active");
      if (!activeMember && members.length > 0) {
        const firstMember = members[0];
        await storage.updateOrganisationMemberStatus(firstMember.memberId || firstMember.id, "active", new Date());
        activeMember = { ...firstMember, status: "active", activatedAt: new Date() };
      }

      if (!activeMember) {
        return res.status(400).json({ error: "No active business workspace associated." });
      }

      const org = await storage.getBusinessById(activeMember.organisationId);

      const payload = {
        userId: user.id,
        organisationId: activeMember.organisationId,
        role: activeMember.role,
        staffId: activeMember.staffId || undefined,
        email: user.email || undefined,
      };

      const token = generateToken(payload);

      res.cookie("jwt_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: "lax",
      });

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

      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      await storage.updateUser(user.id, {
        otpCode,
        otpExpiry,
      });

      if (user.email) {
        await sendEmailVerificationOtpEmail(user.email, user.name || user.email, otpCode);
      }

      res.json({
        success: true,
        message: "Verification code resent successfully.",
      });
    } catch (error) {
      console.error("Resend verification OTP error:", error);
      res.status(500).json({ error: "Failed to resend verification code." });
    }
  });

  // Logout
  app.post("/api/auth/logout", (req: Request, res: Response) => {
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
      const requesterId = (req as any).user?.userId || (req as any).user?.id;
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

      console.info(`[Supervisor Override] Authorized by user ${user.id} (${user.role}) from IP ${(req as any).ip}`);

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

      const otpCode = await storage.getValidOtpCode(user.id, data.otp, "password_reset");
      if (!otpCode) {
        auditLogger.logAuthAttempt(user.id, getClientIp(req), false, "reset-password");
        return res.status(400).json({ error: "Invalid or expired OTP code." });
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(data.password, SALT_ROUNDS);

      // Mark OTP as used and update password
      await storage.markOtpCodeAsUsed(otpCode.id);
      await storage.updateUser(user.id, { passwordHash: hashedPassword });

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
          if (orgId) {
            business = await storage.getBusinessById(orgId);
            const member = await storage.getOrganisationMember(user.id, orgId);
            if (member) {
              activeRole = member.role;
            }
          }
          auditLogger.logAuthAttempt(user.id, getClientIp(req), true);
          return res.json({
            ...user,
            id: user.id,
            email: user.email || user.phone || "",
            role: activeRole,
            businessId: orgId,
            business,
            password: undefined,
            passwordHash: undefined,
            otpCode: undefined,
            otpExpiry: undefined,
            activationCode: undefined,
            activationCodeExpiry: undefined,
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
    const role = (req as any).user?.role;
    if (role !== "manager" && role !== "owner") {
      return res.status(403).json({ error: "Only managers and owners can access this feature." });
    }
    next();
  };

  // Helper to verify store belongs to user's business
  const verifyStoreAccess = async (req: any, storeId: string): Promise<boolean> => {
    const user = req.user;
    if (!user?.businessId) return false;

    const store = await storage.getStore(storeId);
    if (!store) return false;
    if (store.businessId !== user.businessId) return false;

    // Strict isolation: if role is staff, restrict to their assigned storeId branch
    if (user.role === "staff") {
      const staffRecord = await storage.getStaffByUserId(user.id);
      if (staffRecord && staffRecord.storeId !== storeId) {
        return false;
      }
    }
    return true;
  };

  // Helper to verify a record's storeId belongs to user's business
  const verifyRecordStoreAccess = async (req: any, recordStoreId: string): Promise<boolean> => {
    return verifyStoreAccess(req, recordStoreId);
  };

  // ─── Register domain-specific route modules ─────────────────────────────
  const routeMiddlewares = {
    isAuthenticated,
    requireRole,
    requireManagerOrOwner,
    checkStoreAccess,
  };

  registerBusinessRoutes(app, routeMiddlewares);
  registerCustomerRoutes(app, routeMiddlewares);
  registerStaffRoutes(app, routeMiddlewares);
  registerInventoryRoutes(app, routeMiddlewares);
  registerTransactionRoutes(app, routeMiddlewares);
  registerSalesRoutes(app, routeMiddlewares);
  registerSettingsRoutes(app, routeMiddlewares);
  registerPayrollRoutes(app, routeMiddlewares);
  registerReportsRoutes(app, routeMiddlewares);
  registerVendorRoutes(app, routeMiddlewares);
  registerPaymentRoutes(app, routeMiddlewares);
  registerCashRoutes(app, routeMiddlewares);


  return httpServer;
}
