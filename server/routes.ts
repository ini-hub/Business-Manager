import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import crypto from "crypto";
import { storage } from "./storage";
import { setupAuth, isAuthenticated, generateToken, verifyToken } from "./auth";
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
import {
  insertBusinessSchema,
  insertStoreSchema,
  insertCustomerSchema,
  insertStaffSchema,
  insertInventorySchema,
  signupSchema,
  loginSchema,
  verifyOtpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  passwordSchema,
  type UserRole,
} from "@shared/schema";
import { z } from "zod";
import { sanitizeString, sanitizeUUID, sanitizeNumber, sanitizeBoolean, sanitizePhoneNumber, sanitizeStoreCode } from "./sanitize";
import { auditLogger } from "./audit";
import passport from "passport";
import { initWebSocketServer } from "./websocket";

// Default OTP code for development (no email integration)
const DEFAULT_OTP = "123456";
const OTP_EXPIRY_MINUTES = 10;
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

  // ========== USER PROFILE ==========
  app.patch("/api/auth/user/profile", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      const { name, profilePhotoUrl } = req.body;
      const updated = await storage.updateUser(userId, { name, profilePhotoUrl });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Could not update profile." });
    }
  });

  app.post("/api/auth/user/change-password", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      const { currentPassword, newPassword } = req.body;
      
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ error: "User not found." });

      const isMatch = user.password ? await bcrypt.compare(currentPassword, user.password) : false;
      if (!isMatch) return res.status(400).json({ error: "Incorrect current password." });

      const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
      await storage.updateUser(userId, { password: hashedPassword });
      
      res.json({ message: "Password updated successfully." });
    } catch (error) {
      res.status(500).json({ error: "Could not change password." });
    }
  });


  // ========== MULTI-TENANCY HELPERS ==========
  async function checkStoreAccess(storeId: string, req: Request, res: Response): Promise<boolean> {
    const userBusinessId = (req as any).user?.businessId;
    if (!userBusinessId) {
      res.status(401).json({ error: "Authentication required." });
      return false;
    }
    const store = await storage.getStore(storeId);
    if (!store) {
      res.status(404).json({ error: "Store not found." });
      return false;
    }
    if (store.businessId !== userBusinessId) {
      res.status(403).json({ error: "Unauthorized access to store data." });
      return false;
    }
    return true;
  }
  // ========== HEALTH CHECK ==========
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

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
      if (isPartial || (user.createdByInvitation && user.activationCodeUsed && !user.password && !user.passwordHash)) {
        return res.json({
          status: "create_password_required",
          email: user.email,
          phone: user.phone,
          message: "You have already verified your activation code. Please create your password to continue."
        });
      }

      // 2. If invited staff (status pending or code not yet used) -> show activation screen without auto-generating/sending code
      if (isPending || (!user.activationCodeUsed && user.activationCode) || user.createdByInvitation) {
        // Otherwise show activation screen. Do NOT generate new code, do NOT send email.
        return res.json({
          status: "pending_activation",
          email: user.email,
          phone: user.phone,
          message: "Please enter your activation code.",
        });
      }

      // 2. If user is self-registered and email not verified yet -> send OTP and require OTP verification
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

      // 3. Fallback: if somehow user.activationCodeUsed is true but no password set (e.g. stopped flow)
      if (user.activationCodeUsed && !user.password && !user.passwordHash) {
        return res.json({
          status: "create_password_required",
          email: user.email,
          phone: user.phone,
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
      if (!user || !user.otpCode || user.otpCode !== otp) {
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
          password: hashedPassword,
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
      const userPassword = user.password || user.passwordHash;
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

      // Check if email is verified. If not, trigger OTP validation
      if (user.email && !user.isEmailVerified) {
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

      // Fetch user organizations
      const members = await storage.getOrganisationsByUserId(user.id);
      const activeMembers = members.filter(m => m.status === "active");

      if (activeMembers.length === 0) {
        return res.status(403).json({ error: "Your account is not associated with any active organisation." });
      }

      // If user belongs to multiple organizations, let them choose
      if (activeMembers.length > 1) {
        const orgList = [];
        for (const m of activeMembers) {
          const org = await storage.getBusinessById(m.organisationId);
          if (org) {
            orgList.push({
              id: org.id,
              name: org.name,
              slug: org.slug,
              role: m.role,
            });
          }
        }
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

  // Legacy activation route has been refactored below to activateHandler at lines 813-872 to allow high-fidelity verification checks.

  // Global memory rate limit map for resending activation code
  const resendLimitMap = new Map<string, number[]>();

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

      if (!cleanStored || cleanInput !== cleanStored) {
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
        await storage.updateOrganisationMemberStatus(pendingMember.id, "partial");
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
      const hasNoPassword = !user.password && !user.passwordHash;

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
          await storage.updateOrganisationMemberStatus(partialMember.id, "pending");
        }
      }

      // Rate limit check: max 3 per hour
      const now = Date.now();
      const userKey = user.id;
      let attempts = resendLimitMap.get(userKey) || [];
      // Filter out attempts older than 1 hour
      attempts = attempts.filter(ts => now - ts < 60 * 60 * 1000);
      if (attempts.length >= 3) {
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
      });

      // Save attempts
      attempts.push(now);
      resendLimitMap.set(userKey, attempts);

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

      await storage.updateUser(user.id, {
        password: hashedPassword,
        passwordHash: hashedPassword,
      });

      // Fetch and activate workspace membership
      const members = await storage.getOrganisationsByUserId(user.id);
      let targetMember = members.find(m => m.status === "partial") || members.find(m => m.status === "pending") || members.find(m => m.status === "active");
      if (!targetMember) {
        return res.status(400).json({ error: "No workspace association found." });
      }

      if (targetMember.status !== "active") {
        targetMember = await storage.updateOrganisationMemberStatus(targetMember.id, "active", new Date());
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
        if (user.otpCode !== otp) {
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
        await storage.updateOrganisationMemberStatus(firstMember.id, "active", new Date());
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
  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    res.clearCookie("jwt_token");
    res.json({ message: "Logged out successfully." });
  });

  // Supervisor override credentials authentication
  app.post("/api/auth/supervisor-override", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required." });
      }

      const user = await storage.getUserByEmail(email.toLowerCase().trim());
      if (!user) {
        return res.status(401).json({ error: "Invalid email or password." });
      }

      if (!user.password) {
        return res.status(400).json({ error: "Password not set for this supervisor." });
      }

      const passwordMatch = await bcrypt.compare(password, user.password);
      if (!passwordMatch) {
        return res.status(401).json({ error: "Invalid email or password." });
      }

      if (user.role !== "owner" && user.role !== "manager") {
        return res.status(403).json({ error: "Only managers or owners can authorize overrides." });
      }

      res.json({
        success: true,
        supervisor: {
          id: user.id,
          name: user.name || user.email,
          role: user.role,
        }
      });
    } catch (error) {
      console.error("Supervisor override error:", error);
      res.status(500).json({ error: "Could not authenticate supervisor." });
    }
  });

  // Forgot Password - Request password reset (also handles staff first-time login)
  app.post("/api/auth/forgot-password", async (req: Request, res: Response) => {
    try {
      const data = forgotPasswordSchema.parse(req.body);
      const identifier = data.emailOrPhone.trim().toLowerCase();

      let user = await storage.getUserByIdentifier(identifier);

      // If no user found, check if email belongs to a staff member
      if (!user && identifier.includes("@")) {
        const staffMember = await storage.getStaffByEmail(identifier);

        if (staffMember) {
          // Check if staff already has a linked user account
          if (staffMember.userId) {
            // Get the existing user account
            user = await storage.getUser(staffMember.userId);
          }

          // If still no user, double-check by email (in case userId link was lost)
          if (!user) {
            user = await storage.getUserByEmail(identifier);
          }

          // If still no user, create one for the staff member
          if (!user) {
            const placeholderPassword = await bcrypt.hash(crypto.randomUUID(), SALT_ROUNDS);

            // Get the business ID from the store
            const store = staffMember.store;

            // Create a new user account for the staff member
            user = await storage.createUser({
              email: identifier,
              password: placeholderPassword,
              businessId: store.businessId,
              role: staffMember.role as "manager" | "staff",
              isVerified: true, // Staff accounts are pre-verified by owner
            });
          }

          // Link the staff record to the user account if not already linked
          if (!staffMember.userId && user) {
            await storage.updateStaff(staffMember.id, { userId: user.id });
          }
        }
      }

      const isEmail = identifier.includes("@");
      const maskedEmail = isEmail
        ? identifier.replace(/(.{2})(.*)(@.*)/, "$1***$3")
        : identifier.replace(/(.{3})(.*)(.{3})/, "$1***$3");

      if (!user) {
        // Don't reveal if email exists for security
        return res.json({
          message: `If an account exists, an OTP has been sent to ${maskedEmail}`,
          maskedEmail,
          emailExists: false,
        });
      }

      // Create OTP code for password reset
      const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
      await storage.createOtpCode({
        userId: user.id,
        code: DEFAULT_OTP,
        type: "password_reset",
        expiresAt,
      });

      res.json({
        message: `OTP has been sent to ${maskedEmail}`,
        maskedEmail,
        emailExists: true,
      });
    } catch (error) {
      console.error("Forgot password error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "Failed to process request. Please try again." });
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
      await storage.updateUser(user.id, { password: hashedPassword });

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

  // Custom logout
  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.logout((err) => {
      if (err) {
        console.error("Logout error:", err);
        return res.status(500).json({ error: "Logout failed." });
      }
      res.json({ message: "Logged out successfully." });
    });
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

    return store.businessId === user.businessId;
  };

  // Helper to verify a record's storeId belongs to user's business
  const verifyRecordStoreAccess = async (req: any, recordStoreId: string): Promise<boolean> => {
    return verifyStoreAccess(req, recordStoreId);
  };

  // ========== BUSINESS ==========
  app.get("/api/business", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required." });
      }
      const business = await storage.getBusinessByUserId(userId);
      res.json(business || null);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load business information. Please try again." });
    }
  });

  app.post("/api/business", async (req, res) => {
    try {
      const data = insertBusinessSchema.parse(req.body);
      const business = await storage.createBusiness(data);
      res.status(201).json(business);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "We couldn't create the business. Please try again." });
    }
  });

  app.patch("/api/business/:id", async (req, res) => {
    try {
      if (req.params.id !== (req as any).user?.businessId) {
        return res.status(403).json({ error: "Unauthorized access to business data." });
      }
      const data = insertBusinessSchema.partial().parse(req.body);
      const business = await storage.updateBusiness(req.params.id, data);
      if (!business) {
        return res.status(404).json({ error: "Business not found." });
      }
      res.json(business);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "We couldn't update the business information. Please try again." });
    }
  });

  // ========== STORES ==========
  app.get("/api/stores", async (req, res) => {
    try {
      const userBusinessId = (req as any).user?.businessId;
      let businessId = req.query.businessId as string;

      if (businessId && businessId !== userBusinessId) {
        return res.status(403).json({ error: "Unauthorized access to business data." });
      }
      businessId = businessId || userBusinessId;

      if (!businessId) {
        return res.status(400).json({ error: "Please select a business first." });
      }

      // Verify user is authenticated with a business and has access
      const user = req.user as any;
      if (!user?.businessId) {
        return res.status(401).json({ error: "Please log in to access stores." });
      }
      if (user.businessId !== businessId) {
        return res.status(403).json({ error: "You don't have access to this business." });
      }

      const storeList = await storage.getStores(businessId);
      res.json(storeList);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load your stores. Please try again." });
    }
  });

  app.get("/api/stores/:id", async (req, res) => {
    try {
      const store = await storage.getStore(req.params.id);
      if (!store) {
        return res.status(404).json({ error: "Store not found." });
      }
      if (store.businessId !== (req as any).user?.businessId) {
        return res.status(403).json({ error: "Unauthorized access to store data." });
      }
      if (store.businessId !== (req as any).user?.businessId) {
        return res.status(403).json({ error: "Unauthorized access to store data." });
      }
      res.json(store);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load store information. Please try again." });
    }
  });

  app.post("/api/stores", async (req, res) => {
    try {
      const userBusinessId = (req as any).user?.businessId;
      if (!userBusinessId) {
        return res.status(401).json({ error: "Authentication required." });
      }

      // Force the businessId to be the user's business ID
      req.body.businessId = userBusinessId;
      const data = insertStoreSchema.parse(req.body);

      const store = await storage.createStore(data);

      // Automatically add the owner to the staff list of their new store
      try {
        const user = (req as any).user;
        if (user && user.id) {
          const business = await storage.getBusinessByUserId(user.id);
          await storage.createStaff({
            storeId: store.id,
            userId: user.id,
            name: business?.name ? `${business.name} Owner` : "Business Owner",
            email: user.email || "owner@example.com",
            mobileNumber: user.phone || "0000000000",
            countryCode: "+234",
            role: "manager", // Best role mapping for the owner until an explicit 'owner' role is needed
            payPerMonth: 0,
            signedContract: true,
            staffNumber: "",
            paymentMethod: "hybrid"
          });
        }
      } catch (err) {
        console.error("Failed to auto-create owner staff record:", err);
      }

      res.status(201).json(store);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "We couldn't create the store. Please try again." });
    }
  });

  app.patch("/api/stores/:id", async (req, res) => {
    try {
      const existingStore = await storage.getStore(req.params.id);
      if (!existingStore || existingStore.businessId !== (req as any).user?.businessId) {
        return res.status(403).json({ error: "Unauthorized access to store data." });
      }
      // Remove businessId to prevent cross-business reassignment
      const updateBody = { ...req.body };
      delete updateBody.businessId;

      const data = insertStoreSchema.partial().parse(updateBody);
      const updatedStore = await storage.updateStore(req.params.id, data);

      if (!updatedStore) {
        return res.status(404).json({ error: "Store not found." });
      }
      res.json(updatedStore);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "We couldn't update the store. Please try again." });
    }
  });

  app.delete("/api/stores/:id", async (req, res) => {
    try {
      const store = await storage.getStore(req.params.id);
      if (!store) {
        return res.status(404).json({ error: "Store not found." });
      }
      if (store.businessId !== (req as any).user?.businessId) {
        return res.status(403).json({ error: "Unauthorized access to store data." });
      }

      const hasData = await storage.hasStoreData(req.params.id);
      if (hasData) {
        return res.status(400).json({
          error: "This store has customers, staff, or inventory. Please remove them first before deleting the store."
        });
      }

      const deleted = await storage.deleteStore(req.params.id);
      if (!deleted) {
        return res.status(500).json({ error: "We couldn't delete the store. Please try again." });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "We couldn't delete the store. Please try again." });
    }
  });

  // ========== CUSTOMERS ==========
  app.get("/api/customers", async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return res.status(400).json({ error: "Please select a store first." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      // Support both paginated and non-paginated queries
      const page = parseInt(req.query.page as string) || 0;
      const limit = parseInt(req.query.limit as string) || 0;

      if (page > 0 && limit > 0) {
        const search = req.query.search as string;
        const includeArchived = req.query.includeArchived === 'true';
        const result = await storage.getCustomersPaginated(storeId, { page, limit, search, includeArchived });
        return res.json(result);
      }

      const customerList = await storage.getCustomers(storeId);
      res.json(customerList);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load your customers. Please try again." });
    }
  });

  app.get("/api/customers/:id", async (req, res) => {
    try {
      const customer = await storage.getCustomer(req.params.id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found." });
      }

      // Verify user has access to this customer's store
      if (!await verifyRecordStoreAccess(req, customer.storeId)) {
        return res.status(403).json({ error: "You don't have access to this customer." });
      }

      res.json(customer);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load customer information. Please try again." });
    }
  });

  app.post("/api/customers", async (req, res) => {
    try {
      const sanitizedBody = {
        ...req.body,
        name: sanitizeString(req.body.name),
        mobileNumber: sanitizePhoneNumber(req.body.mobileNumber),
        address: sanitizeString(req.body.address),
      };
      const data = insertCustomerSchema.parse(sanitizedBody);
      if (data.storeId && !(await checkStoreAccess(data.storeId, req, res))) return;
      const customer = await storage.createCustomer(data);
      auditLogger.logDataModification("customer", customer.id, getUserId(req), "CREATE", true);
      res.status(201).json(customer);
    } catch (error) {
      auditLogger.logDataModification("customer", undefined, getUserId(req), "CREATE", false, (error as Error).message);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "We couldn't add this customer right now. Please try again." });
    }
  });

  app.patch("/api/customers/:id", async (req, res) => {
    try {
      const customer = await storage.getCustomer(req.params.id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found." });
      }

      // Verify user has access to this customer's store
      if (!await verifyRecordStoreAccess(req, customer.storeId)) {
        return res.status(403).json({ error: "You don't have access to this customer." });
      }

      const sanitizedBody = {
        ...req.body,
        name: req.body.name ? sanitizeString(req.body.name) : undefined,
        mobileNumber: req.body.mobileNumber ? sanitizePhoneNumber(req.body.mobileNumber) : undefined,
        address: req.body.address ? sanitizeString(req.body.address) : undefined,
      };
      // Remove storeId to prevent cross-store migration via PATCH
      delete sanitizedBody.storeId;
      const data = insertCustomerSchema.partial().parse(sanitizedBody);
      const updatedCustomer = await storage.updateCustomer(req.params.id, data);
      if (!updatedCustomer) {
        return res.status(404).json({ error: "This customer no longer exists. It may have been deleted." });
      }
      auditLogger.logDataModification("customer", req.params.id, getUserId(req), "UPDATE", true);
      res.json(updatedCustomer);
    } catch (error) {
      auditLogger.logDataModification("customer", req.params.id, getUserId(req), "UPDATE", false, (error as Error).message);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "We couldn't update this customer right now. Please try again." });
    }
  });

  app.delete("/api/customers/:id", async (req, res) => {
    try {
      const customer = await storage.getCustomer(req.params.id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found." });
      }

      // Verify user has access to this customer's store
      if (!await verifyRecordStoreAccess(req, customer.storeId)) {
        return res.status(403).json({ error: "You don't have access to this customer." });
      }

      // Archive instead of delete (soft delete)
      const archived = await storage.archiveCustomer(req.params.id);
      if (!archived) {
        return res.status(500).json({ error: "We couldn't archive this customer. Please try again." });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "We couldn't archive this customer. Please try again." });
    }
  });

  // Restore archived customer
  app.post("/api/customers/:id/restore", async (req, res) => {
    try {
      const customer = await storage.getCustomer(req.params.id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found." });
      }

      // Verify user has access to this customer's store
      if (!await verifyRecordStoreAccess(req, customer.storeId)) {
        return res.status(403).json({ error: "You don't have access to this customer." });
      }

      const restored = await storage.restoreCustomer(req.params.id);
      if (!restored) {
        return res.status(500).json({ error: "We couldn't restore this customer. Please try again." });
      }
      res.json(restored);
    } catch (error) {
      res.status(500).json({ error: "We couldn't restore this customer. Please try again." });
    }
  });

  // Permanently delete archived customer
  app.delete("/api/customers/:id/permanent", async (req, res) => {
    try {
      const customer = await storage.getCustomer(req.params.id);
      if (!customer) {
        return res.status(404).json({ error: "Customer not found." });
      }

      // Verify user has access to this customer's store
      if (!await verifyRecordStoreAccess(req, customer.storeId)) {
        return res.status(403).json({ error: "You don't have access to this customer." });
      }

      if (!customer.isArchived) {
        return res.status(400).json({ error: "Only archived customers can be permanently deleted." });
      }

      const hasTransactions = await storage.hasCustomerTransactions(req.params.id);
      if (hasTransactions) {
        return res.status(400).json({
          error: "Cannot permanently delete customer with existing transactions. This customer has purchase history that must be preserved for your records."
        });
      }

      const deleted = await storage.deleteCustomer(req.params.id);
      if (!deleted) {
        return res.status(500).json({ error: "We couldn't delete this customer. Please try again." });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "We couldn't delete this customer. Please try again." });
    }
  });

  // Bulk import customers
  app.post("/api/customers/bulk", async (req, res) => {
    try {
      const { data, storeId } = req.body;
      if (!Array.isArray(data) || !storeId) {
        return res.status(400).json({ error: "Invalid data format or missing store." });
      }

      // Verify user has access to this store
      if (!await verifyStoreAccess(req, storeId)) {
        return res.status(403).json({ error: "You don't have access to this store." });
      }

      const result = { success: 0, failed: 0, errors: [] as { row: number; message: string }[] };

      for (let i = 0; i < data.length; i++) {
        try {
          const row = data[i];
          const parsed = insertCustomerSchema.parse({
            storeId,
            name: row.name,
            customerNumber: "",
            mobileNumber: row.mobileNumber,
            address: row.address,
          });
          if (parsed.storeId && !(await checkStoreAccess(parsed.storeId, req, res))) { throw new Error("Unauthorized store"); }
          await storage.createCustomer(parsed);
          result.success++;
        } catch (error) {
          result.failed++;
          const message = error instanceof z.ZodError
            ? error.errors.map(e => e.message).join(", ")
            : "Invalid data";
          result.errors.push({ row: i + 2, message });
        }
      }

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "We couldn't import your customers. Please try again." });
    }
  });

  // ========== STAFF ==========
  app.get("/api/staff", async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return res.status(400).json({ error: "Please select a store first." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      // Support both paginated and non-paginated queries
      const page = parseInt(req.query.page as string) || 0;
      const limit = parseInt(req.query.limit as string) || 0;

      if (page > 0 && limit > 0) {
        const search = req.query.search as string;
        const includeArchived = req.query.includeArchived === 'true';
        const result = await storage.getStaffPaginated(storeId, { page, limit, search, includeArchived });
        return res.json(result);
      }

      const staffList = await storage.getStaffList(storeId);
      res.json(staffList);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load your staff members. Please try again." });
    }
  });

  app.get("/api/staff/:id", async (req, res) => {
    try {
      const staffMember = await storage.getStaff(req.params.id);
      if (!staffMember) {
        return res.status(404).json({ error: "Staff member not found." });
      }

      // Verify user has access to this staff member's store
      if (!await verifyRecordStoreAccess(req, staffMember.storeId)) {
        return res.status(403).json({ error: "You don't have access to this staff member." });
      }

      res.json(staffMember);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load staff information. Please try again." });
    }
  });

  app.post("/api/staff", async (req, res) => {
    try {
      const sanitizedBody = {
        ...req.body,
        name: sanitizeString(req.body.name),
        email: sanitizeString(req.body.email)?.toLowerCase(),
        mobileNumber: sanitizePhoneNumber(req.body.mobileNumber),
        payPerMonth: sanitizeNumber(req.body.payPerMonth),
        signedContract: sanitizeBoolean(req.body.signedContract),
        role: req.body.role || "staff",
      };
      const data = insertStaffSchema.parse(sanitizedBody);
      if (data.storeId && !(await checkStoreAccess(data.storeId, req, res))) return;
      const staffMember = await storage.createStaff(data);
      auditLogger.logDataModification("staff", staffMember.id, getUserId(req), "CREATE", true);

      // Staff invitation and activation email flow
      try {
        const store = data.storeId ? await storage.getStore(data.storeId) : null;
        const resolvedBusinessId = store?.businessId || (req as any).user?.organisationId || (req as any).user?.businessId;
        const business = resolvedBusinessId ? await storage.getBusinessById(resolvedBusinessId) : null;
        const businessName = business ? business.name : "Business Workspace";

        if (resolvedBusinessId && data.email) {
          const emailLower = data.email.toLowerCase();
          let user = await storage.getUserByIdentifier(emailLower);

          if (user) {
            // Existing platform user: add them to the business organisation if not already member
            const member = await storage.getOrganisationMember(user.id, resolvedBusinessId);
            if (!member) {
              await storage.createOrganisationMember({
                userId: user.id,
                organisationId: resolvedBusinessId,
                role: data.role || "staff",
                staffId: staffMember.staffNumber,
                status: "active",
                activatedAt: new Date(),
              });
            }

            // Link the staff record to the existing user
            await storage.updateStaff(staffMember.id, { userId: user.id });

            // Send notification email that they were added
            const inviterName = (req as any).user?.name || "The Business Owner";
            await sendAddedToOrgEmail(
              emailLower,
              staffMember.name,
              businessName,
              data.role || "staff",
              inviterName
            );
          } else {
            // New user account: generate a premium XXXX-XXXX activation code
            const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
            let activationCode = "";
            for (let i = 0; i < 4; i++) {
              activationCode += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            activationCode += "-";
            for (let i = 0; i < 4; i++) {
              activationCode += chars.charAt(Math.floor(Math.random() * chars.length));
            }

            const placeholderPassword = await bcrypt.hash(crypto.randomUUID(), SALT_ROUNDS);

            // Create new platform user as pre-verified
            const newUser = await storage.createUser({
              email: emailLower,
              password: placeholderPassword,
              businessId: resolvedBusinessId,
              role: data.role as "manager" | "staff",
              isVerified: true,
              activationCode,
              activationCodeExpiry: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48 hours
              activationCodeUsed: false,
              createdByInvitation: true,
            });

            await storage.updateUser(newUser.id, {
              passwordHash: placeholderPassword,
            });

            // Create pending organization membership record
            await storage.createOrganisationMember({
              userId: newUser.id,
              organisationId: resolvedBusinessId,
              role: data.role || "staff",
              staffId: staffMember.staffNumber,
              status: "pending",
            });

            // Link the staff record to the new user
            await storage.updateStaff(staffMember.id, { userId: newUser.id });

            // Send the activation email
            await sendActivationEmail(
              emailLower,
              staffMember.name,
              businessName,
              data.role || "staff",
              activationCode
            );
          }
        }
      } catch (inviteError) {
        console.error("Failed to process invite/activation email for staff member:", inviteError);
      }

      res.status(201).json(staffMember);
    } catch (error) {
      auditLogger.logDataModification("staff", undefined, getUserId(req), "CREATE", false, (error as Error).message);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      // Check for duplicate email constraint error
      const errorMessage = (error as Error).message || "";
      if (errorMessage.includes("unique") || errorMessage.includes("duplicate") || errorMessage.includes("email")) {
        return res.status(409).json({
          error: "This email address is already assigned to another staff member. Please use a different email."
        });
      }
      res.status(500).json({ error: "We couldn't add this staff member right now. Please try again." });
    }
  });

  app.patch("/api/staff/:id", async (req, res) => {
    try {
      const staffMember = await storage.getStaff(req.params.id);
      if (!staffMember) {
        return res.status(404).json({ error: "Staff member not found." });
      }

      // Verify user has access to this staff member's store
      if (!await verifyRecordStoreAccess(req, staffMember.storeId)) {
        return res.status(403).json({ error: "You don't have access to this staff member." });
      }

      const sanitizedBody = {
        ...req.body,
        ...(req.body.name && { name: sanitizeString(req.body.name) }),
        ...(req.body.email && { email: sanitizeString(req.body.email)?.toLowerCase() }),
        ...(req.body.mobileNumber && { mobileNumber: sanitizePhoneNumber(req.body.mobileNumber) }),
        ...(req.body.payPerMonth !== undefined && { payPerMonth: sanitizeNumber(req.body.payPerMonth) }),
        ...(req.body.signedContract !== undefined && { signedContract: sanitizeBoolean(req.body.signedContract) }),
      };
      // Remove storeId to prevent cross-store migration via PATCH (use transfer endpoint instead)
      delete sanitizedBody.storeId;
      const data = insertStaffSchema.partial().parse(sanitizedBody);
      const updatedStaffMember = await storage.updateStaff(req.params.id, data);
      if (!updatedStaffMember) {
        return res.status(404).json({ error: "This staff member no longer exists. They may have been removed." });
      }
      res.json(updatedStaffMember);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "We couldn't update this staff member right now. Please try again." });
    }
  });

  app.delete("/api/staff/:id", async (req, res) => {
    try {
      const staffMember = await storage.getStaff(req.params.id);
      if (!staffMember) {
        return res.status(404).json({ error: "Staff member not found." });
      }

      // Verify user has access to this staff member's store
      if (!await verifyRecordStoreAccess(req, staffMember.storeId)) {
        return res.status(403).json({ error: "You don't have access to this staff member." });
      }

      // Archive instead of delete (soft delete)
      const archived = await storage.archiveStaff(req.params.id);
      if (!archived) {
        return res.status(500).json({ error: "We couldn't archive this staff member. Please try again." });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "We couldn't archive this staff member. Please try again." });
    }
  });

  // Restore archived staff
  app.post("/api/staff/:id/restore", async (req, res) => {
    try {
      const staffMember = await storage.getStaff(req.params.id);
      if (!staffMember) {
        return res.status(404).json({ error: "Staff member not found." });
      }

      // Verify user has access to this staff member's store
      if (!await verifyRecordStoreAccess(req, staffMember.storeId)) {
        return res.status(403).json({ error: "You don't have access to this staff member." });
      }

      const restored = await storage.restoreStaff(req.params.id);
      if (!restored) {
        return res.status(500).json({ error: "We couldn't restore this staff member. Please try again." });
      }
      res.json(restored);
    } catch (error) {
      res.status(500).json({ error: "We couldn't restore this staff member. Please try again." });
    }
  });

  // Transfer staff to another store
  app.post("/api/staff/:id/transfer", async (req, res) => {
    try {
      const { targetStoreId } = req.body;
      if (!targetStoreId) {
        return res.status(400).json({ error: "Please select a store to transfer to." });
      }

      const staffMember = await storage.getStaff(req.params.id);
      if (!staffMember) {
        return res.status(404).json({ error: "Staff member not found." });
      }

      // Verify user has access to this staff member's store
      if (!await verifyRecordStoreAccess(req, staffMember.storeId)) {
        return res.status(403).json({ error: "You don't have access to this staff member." });
      }

      // Verify user has access to the target store
      if (!await verifyStoreAccess(req, targetStoreId)) {
        return res.status(403).json({ error: "You don't have access to the target store." });
      }

      // Get the source store's business
      const sourceStore = await storage.getStore(staffMember.storeId);
      if (!sourceStore) {
        return res.status(404).json({ error: "Source store not found." });
      }

      // Get the target store and verify it belongs to the same business
      const targetStore = await storage.getStore(targetStoreId);
      if (!targetStore) {
        return res.status(404).json({ error: "Target store not found." });
      }

      if (sourceStore.businessId !== targetStore.businessId) {
        return res.status(403).json({ error: "Staff can only be transferred to stores within the same business." });
      }

      if (staffMember.storeId === targetStoreId) {
        return res.status(400).json({ error: "Staff member is already in this store." });
      }

      // Use the storage method to transfer staff with auto-generated staff number
      const updated = await storage.transferStaff(req.params.id, targetStoreId);

      if (!updated) {
        return res.status(500).json({ error: "We couldn't transfer this staff member. Please try again." });
      }

      res.json(updated);
    } catch (error) {
      console.error("Staff transfer error:", error);
      res.status(500).json({ error: "We couldn't transfer this staff member. Please try again." });
    }
  });

  // Permanently delete archived staff
  app.delete("/api/staff/:id/permanent", async (req, res) => {
    try {
      const staffMember = await storage.getStaff(req.params.id);
      if (!staffMember) {
        return res.status(404).json({ error: "Staff member not found." });
      }

      // Verify user has access to this staff member's store
      if (!await verifyRecordStoreAccess(req, staffMember.storeId)) {
        return res.status(403).json({ error: "You don't have access to this staff member." });
      }

      if (!staffMember.isArchived) {
        return res.status(400).json({ error: "Only archived staff can be permanently deleted." });
      }

      const hasCheckouts = await storage.hasStaffCheckouts(req.params.id);
      if (hasCheckouts) {
        return res.status(400).json({
          error: "Cannot permanently delete staff member with existing sales records. This staff member has processed sales that must be preserved for your records."
        });
      }

      const deleted = await storage.deleteStaff(req.params.id);
      if (!deleted) {
        return res.status(500).json({ error: "We couldn't delete this staff member. Please try again." });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Permanent delete staff error:", error);
      res.status(500).json({ error: "We couldn't delete this staff member. Please try again." });
    }
  });

  // Bulk import staff
  app.post("/api/staff/bulk", async (req, res) => {
    try {
      const { data, storeId } = req.body;
      if (!Array.isArray(data) || !storeId) {
        return res.status(400).json({ error: "Invalid data format or missing store." });
      }

      // Verify user has access to this store
      if (!await verifyStoreAccess(req, storeId)) {
        return res.status(403).json({ error: "You don't have access to this store." });
      }

      const result = { success: 0, failed: 0, errors: [] as { row: number; message: string }[] };

      for (let i = 0; i < data.length; i++) {
        try {
          const row = data[i];
          const parsed = insertStaffSchema.parse({
            storeId,
            name: row.name,
            staffNumber: row.staffNumber,
            mobileNumber: row.mobileNumber,
            payPerMonth: parseFloat(row.payPerMonth) || 0,
            signedContract: row.signedContract === "true" || row.signedContract === true,
          });
          await storage.createStaff(parsed);
          result.success++;
        } catch (error) {
          result.failed++;
          const message = error instanceof z.ZodError
            ? error.errors.map(e => e.message).join(", ")
            : "Invalid data";
          result.errors.push({ row: i + 2, message });
        }
      }

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "We couldn't import your staff. Please try again." });
    }
  });

  // ========== INVENTORY ==========
  app.get("/api/inventory", async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return res.status(400).json({ error: "Please select a store first." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      // Support both paginated and non-paginated queries
      const page = parseInt(req.query.page as string) || 0;
      const limit = parseInt(req.query.limit as string) || 0;

      if (page > 0 && limit > 0) {
        const search = req.query.search as string;
        const result = await storage.getInventoryPaginated(storeId, { page, limit, search });
        return res.json(result);
      }

      const items = await storage.getInventory(storeId);
      res.json(items);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load your inventory. Please try again." });
    }
  });

  app.get("/api/inventory/:id", async (req, res) => {
    try {
      const item = await storage.getInventoryItem(req.params.id);
      if (!item) {
        return res.status(404).json({ error: "Inventory item not found." });
      }

      // Verify user has access to this item's store
      if (!await verifyRecordStoreAccess(req, item.storeId)) {
        return res.status(403).json({ error: "You don't have access to this inventory item." });
      }

      res.json(item);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load item information. Please try again." });
    }
  });

  app.post("/api/inventory", async (req, res) => {
    try {
      const sanitizedBody = {
        ...req.body,
        name: sanitizeString(req.body.name),
        type: sanitizeString(req.body.type),
        costPrice: sanitizeNumber(req.body.costPrice),
        sellingPrice: sanitizeNumber(req.body.sellingPrice),
        quantity: sanitizeNumber(req.body.quantity),
      };
      const data = insertInventorySchema.parse(sanitizedBody);
      if (data.storeId && !(await checkStoreAccess(data.storeId, req, res))) return;
      
      const existingItem = await storage.getInventoryItemByName(data.storeId, data.name);
      if (existingItem) {
        return res.status(409).json({
          error: "duplicate_name",
          message: `Product name "${data.name}" already exists.`,
          existingItem,
        });
      }

      const item = await storage.createInventoryItem(data);
      auditLogger.logDataModification("inventory", item.id, getUserId(req), "CREATE", true);
      res.status(201).json(item);
    } catch (error) {
      auditLogger.logDataModification("inventory", undefined, getUserId(req), "CREATE", false, (error as Error).message);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "We couldn't add this item right now. Please try again." });
    }
  });

  app.post("/api/inventory/bulk-import", requireManagerOrOwner, async (req, res) => {
    try {
      const { storeId, items } = req.body;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });
      if (!Array.isArray(items)) return res.status(400).json({ error: "Items must be an array." });

      const results = { success: 0, failed: 0, errors: [] as string[] };

      for (const item of items) {
        try {
          if (!item.name || !item.type) {
             results.failed++;
             results.errors.push(`Missing name or type for item: ${JSON.stringify(item)}`);
             continue;
          }

          await storage.createInventoryItem({
            ...item,
            storeId,
            quantity: Number(item.quantity) || 0,
            costPrice: Number(item.costPrice) || 0,
            sellingPrice: Number(item.sellingPrice) || 0,
            lowStockThreshold: Number(item.lowStockThreshold) || 5,
          });
          results.success++;
        } catch (err: any) {
          results.failed++;
          results.errors.push(`${item.name}: ${err.message}`);
        }
      }

      res.json(results);
    } catch (error) {
      res.status(500).json({ error: "Bulk import failed." });
    }
  });

  app.patch("/api/inventory/:id", async (req, res) => {
    try {
      const item = await storage.getInventoryItem(req.params.id);
      if (!item) {
        return res.status(404).json({ error: "Inventory item not found." });
      }

      // Verify user has access to this item's store
      if (!await verifyRecordStoreAccess(req, item.storeId)) {
        return res.status(403).json({ error: "You don't have access to this inventory item." });
      }

      // Remove storeId to prevent cross-store migration via PATCH
      const updateBody = { ...req.body };
      delete updateBody.storeId;
      const data = insertInventorySchema.partial().parse(updateBody);
      const updatedItem = await storage.updateInventoryItem(req.params.id, data);
      if (!updatedItem) {
        return res.status(404).json({ error: "This item no longer exists. It may have been deleted." });
      }
      res.json(updatedItem);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "We couldn't update this item right now. Please try again." });
    }
  });

  app.delete("/api/inventory/:id", async (req, res) => {
    try {
      const item = await storage.getInventoryItem(req.params.id);
      if (!item) {
        return res.status(404).json({ error: "Inventory item not found." });
      }

      // Verify user has access to this item's store
      if (!await verifyRecordStoreAccess(req, item.storeId)) {
        return res.status(403).json({ error: "You don't have access to this inventory item." });
      }

      const hasTransactions = await storage.hasInventoryTransactions(req.params.id);
      if (hasTransactions) {
        return res.status(400).json({
          error: "Cannot delete inventory item with existing sales records. This item has sales history that must be preserved for your records."
        });
      }

      const deleted = await storage.deleteInventoryItem(req.params.id);
      if (!deleted) {
        return res.status(500).json({ error: "We couldn't delete this item. Please try again." });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "We couldn't delete this item. Please try again." });
    }
  });

  // Bulk import inventory
  app.post("/api/inventory/bulk", async (req, res) => {
    try {
      const { data, storeId } = req.body;
      if (!Array.isArray(data) || !storeId) {
        return res.status(400).json({ error: "Invalid data format or missing store." });
      }

      // Verify user has access to this store
      if (!await verifyStoreAccess(req, storeId)) {
        return res.status(403).json({ error: "You don't have access to this store." });
      }

      const result = { success: 0, failed: 0, errors: [] as { row: number; message: string }[] };

      for (let i = 0; i < data.length; i++) {
        try {
          const row = data[i];
          const itemType = row.type?.toLowerCase();
          if (itemType !== "product" && itemType !== "service") {
            throw new Error("Type must be 'product' or 'service'");
          }
          const parsed = insertInventorySchema.parse({
            storeId,
            name: row.name,
            type: itemType,
            costPrice: parseFloat(row.costPrice) || 0,
            sellingPrice: parseFloat(row.sellingPrice) || 0,
            quantity: itemType === "product" ? (parseInt(row.quantity) || 0) : 0,
          });
          await storage.createInventoryItem(parsed);
          result.success++;
        } catch (error) {
          result.failed++;
          const message = error instanceof z.ZodError
            ? error.errors.map(e => e.message).join(", ")
            : error instanceof Error ? error.message : "Invalid data";
          result.errors.push({ row: i + 2, message });
        }
      }

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "We couldn't import your inventory. Please try again." });
    }
  });

  // ========== INVENTORY RESTOCK ==========
  app.get("/api/inventory/:id/restock-history", async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 0;
      const limit = parseInt(req.query.limit as string) || 0;

      if (page > 0 && limit > 0) {
        const result = await storage.getRestockEventsPaginated(req.params.id, { page, limit });
        return res.json(result);
      }

      const events = await storage.getRestockEvents(req.params.id);
      res.json(events);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load restock history. Please try again." });
    }
  });

  app.post("/api/inventory/:id/restock", async (req, res) => {
    try {
      const inventoryId = req.params.id;
      const item = await storage.getInventoryItem(inventoryId);
      if (!item) {
        return res.status(404).json({ error: "Inventory item not found." });
      }

      // Verify user has access to this item's store
      if (!await verifyRecordStoreAccess(req, item.storeId)) {
        return res.status(403).json({ error: "You don't have access to this inventory item." });
      }

      if (item.type !== "product") {
        return res.status(400).json({ error: "Only products can be restocked. Services don't have inventory quantities." });
      }

      const { quantityAdded, unitCost, costStrategy, newSellingPrice, notes, staffId } = req.body;

      if (!quantityAdded || quantityAdded < 1) {
        return res.status(400).json({ error: "Please enter a valid quantity (at least 1)." });
      }
      if (unitCost === undefined || unitCost < 0) {
        return res.status(400).json({ error: "Please enter a valid unit cost." });
      }
      if (!["keep", "last", "weighted", "override"].includes(costStrategy)) {
        return res.status(400).json({ error: "Invalid cost strategy selected." });
      }

      const userId = (req as any).user?.id || (req as any).user?.claims?.sub || null;

      const result = await storage.createRestockEvent({
        storeId: item.storeId,
        inventoryId,
        staffId: staffId || null,
        userId,
        quantityAdded: Number(quantityAdded),
        unitCost: Number(unitCost),
        costStrategy,
        newSellingPrice: newSellingPrice !== undefined ? Number(newSellingPrice) : undefined,
        notes: notes || undefined,
      });

      auditLogger.logDataModification(
        'inventory_restock',
        inventoryId,
        userId || 'system',
        'CREATE_RESTOCK',
        true
      );

      res.status(201).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "We couldn't complete the restock. Please try again.";
      res.status(500).json({ error: message });
    }
  });

  // ========== TRANSACTIONS ==========
  app.get("/api/transactions", async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return res.status(400).json({ error: "Please select a store first." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      // Support both paginated and non-paginated queries
      const page = parseInt(req.query.page as string) || 0;
      const limit = parseInt(req.query.limit as string) || 0;

      if (page > 0 && limit > 0) {
        const search = req.query.search as string;
        const result = await storage.getTransactionsPaginated(storeId, { page, limit, search });
        return res.json(result);
      }

      const txs = await storage.getTransactions(storeId);
      res.json(txs);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load your transactions. Please try again." });
    }
  });

  app.get("/api/customers/:id/transactions", async (req, res) => {
    try {
      const txs = await storage.getTransactionsByCustomer(req.params.id);
      res.json(txs);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load customer transactions. Please try again." });
    }
  });

  // ─── GET receipt payload ─────────────────────────────────────────────────
  app.get("/api/transactions/:checkoutId/receipt", async (req: any, res) => {
    try {
      const { checkoutId } = req.params;
      const payload = await storage.getReceiptPayload(checkoutId);
      if (!payload) return res.status(404).json({ error: "Transaction not found." });
      res.json(payload);
    } catch (error) {
      console.error("Receipt API Error:", error);
      res.status(500).json({ error: "Could not load receipt data." });
    }
  });

  // ─── Void a transaction ──────────────────────────────────────────────────
  app.post("/api/transactions/:checkoutId/void", requireRole("owner", "manager"), async (req: any, res) => {
    try {
      const { checkoutId } = req.params;
      const { reason } = req.body;
      if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
        return res.status(400).json({ error: "A void reason is required." });
      }
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized." });

      const result = await storage.voidCheckout(checkoutId, reason.trim(), userId);
      if (!result.success) return res.status(400).json({ error: result.message });
      res.json({ success: true, message: result.message });
    } catch (error) {
      res.status(500).json({ error: "Could not void transaction." });
    }
  });

  // ─── Update payment method/status ────────────────────────────────────────
  app.patch("/api/transactions/:checkoutId/payment-status", requireRole("owner", "manager"), async (req: any, res) => {
    try {
      const { checkoutId } = req.params;
      const { paymentMethod, paymentStatus } = req.body;
      const validMethods = ["cash", "transfer", "pos", "flutterwave"];
      const validStatuses = ["completed", "pending"];
      if (!validMethods.includes(paymentMethod)) return res.status(400).json({ error: "Invalid payment method." });
      if (!validStatuses.includes(paymentStatus)) return res.status(400).json({ error: "Invalid payment status." });
      const ok = await storage.updateCheckoutPaymentMethod(checkoutId, paymentMethod, paymentStatus);
      if (!ok) return res.status(404).json({ error: "Transaction not found." });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Could not update payment status." });
    }
  });

  // ========== PROFIT & LOSS ==========

  app.get("/api/profit-loss", async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return res.status(400).json({ error: "Please select a store first." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;
      const plData = await storage.getProfitLoss(storeId);
      res.json(plData);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load profit/loss data. Please try again." });
    }
  });

  app.get("/api/profit-loss/summary", requireRole("owner"), async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;

      if (!storeId) return res.status(400).json({ error: "Please select a store first." });
      if (!(await checkStoreAccess(storeId, req, res))) return;

      // Get revenue/COGS via a proper join: orders → checkouts (date+status filter) → inventory (type+cost)
      const { serviceRevenue, productRevenue, totalRevenue, costOfGoodsSold, grossProfit, discountsGiven, discountsList } =
        await storage.getProfitLossSummary(storeId, startDate, endDate);

      const expenseList = await storage.getExpenses(storeId, startDate, endDate);

      let totalOperationalExpenses = 0;
      const expensesByCategory: Record<string, number> = {};

      expenseList.forEach(e => {
        // Exclude system Payroll category if it exists, as we will calculate it precisely below
        if (e.category?.isSystem && e.category?.name === "Payroll") return;
        
        totalOperationalExpenses += e.amount;
        const catName = e.category?.name || "Uncategorized";
        expensesByCategory[catName] = (expensesByCategory[catName] || 0) + e.amount;
      });

      const expensesGrouped = Object.entries(expensesByCategory).map(([category, amount]) => ({ category, amount }));

      // Fetch overlapping paid payroll periods via storage
      const payrollDetails = await storage.getPaidPayrollExpenses(storeId, startDate, endDate);
      const totalPayrollExpenses = payrollDetails.reduce((sum, p) => sum + p.amount, 0);

      const totalExpenses = totalOperationalExpenses + totalPayrollExpenses + discountsGiven;
      const operatingProfit = grossProfit - totalExpenses;

      res.json({
        serviceRevenue,
        productRevenue,
        totalRevenue,
        costOfGoodsSold,
        grossProfit,
        discountsGiven,
        discountsList,
        totalOperationalExpenses,
        totalPayrollExpenses,
        totalExpenses,
        operatingProfit,
        expensesGrouped,
        payrollDetails,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Could not calculate profit/loss summary." });
    }
  });

  // ========== STAFF SELF-SERVICE ==========
  app.get("/api/payroll/my-summary", isAuthenticated, async (req, res) => {
    try {
      const user = (req as any).user;
      const staff = await storage.getStaffByUserId(user.id);
      if (!staff) return res.status(404).json({ error: "Staff record not found for this user." });

      const storeId = staff.storeId;
      // Get latest approved payroll period
      const periods = await storage.getPayrollPeriods(storeId);
      const activePeriod = periods.find(p => p.status === "approved" || p.status === "pending");
      
      if (!activePeriod) {
        return res.json({ earnings: 0, attendance: { present: 0, absent: 0 } });
      }

      const entries = await storage.getPayrollEntries(activePeriod.id);
      const entry = entries.find(e => e.staffId === staff.id);
      const attendance = await storage.getAttendanceRecords(storeId, { 
        staffId: staff.id, 
        startDate: activePeriod.startDate, 
        endDate: activePeriod.endDate 
      });

      const present = attendance.filter(r => r.status === "active" || r.status === "passive").length;
      const absent = attendance.filter(r => r.status === "absent").length;

      res.json({
        period: {
          ...activePeriod,
          label: `${activePeriod.startDate} to ${activePeriod.endDate} (${activePeriod.periodType})`
        },
        earnings: entry?.netPay || 0,
        transport: entry?.totalTransport || 0,
        commission: entry?.grossCommission || 0,
        attendance: { present, absent }
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Could not fetch summary." });
    }
  });

  app.get("/api/payroll/my-history", isAuthenticated, async (req, res) => {
    try {
      const user = (req as any).user;
      const staff = await storage.getStaffByUserId(user.id);
      if (!staff) return res.status(404).json({ error: "Staff record not found for this user." });

      const periods = await storage.getPayrollPeriods(staff.storeId);
      const paidPeriods = periods.filter(p => p.status === "paid");
      
      const history = await Promise.all(paidPeriods.map(async p => {
        const entries = await storage.getPayrollEntries(p.id);
        const entry = entries.find(e => e.staffId === staff.id);
        return {
          id: p.id,
          label: `${p.startDate} to ${p.endDate} (${p.periodType})`,
          startDate: p.startDate,
          endDate: p.endDate,
          netPay: entry?.netPay || 0,
          paidAt: p.paidAt || p.createdAt
        };
      }));

      res.json(history.filter(h => h.netPay > 0));
    } catch (error) {
      res.status(500).json({ error: "Could not fetch history." });
    }
  });

  // ========== DASHBOARD STATS ==========
  app.get("/api/dashboard/stats", async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;

      if (!storeId) {
        return res.status(400).json({ error: "Please select a store first." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;
      
      const stats = await storage.getDashboardStats(storeId, from, to);
      res.json(stats);
    } catch (error) {
      console.error("Dashboard Stats Error:", error);
      res.status(500).json({ error: "We couldn't load dashboard statistics. Please try again." });
    }
  });

  // ========== CHART DATA ==========
  app.get("/api/charts/sales-trends", async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;

      if (!storeId) {
        return res.status(400).json({ error: "Please select a store first." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;
      const data = await storage.getSalesTrends(storeId, from, to);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load sales trends. Please try again." });
    }
  });

  app.get("/api/charts/revenue-by-type", async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;

      if (!storeId) {
        return res.status(400).json({ error: "Please select a store first." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;
      const data = await storage.getRevenueByType(storeId, from, to);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load revenue data. Please try again." });
    }
  });

  // ========== SALES CHECKOUT ==========
  const checkoutSchema = z.object({
    storeId: z.string(),
    customerId: z.string(),
    staffId: z.string(),
    items: z.array(
      z.object({
        inventoryId: z.string(),
        quantity: z.number().min(1),
        customPrice: z.number().min(0).optional(),
        leadStaffId: z.string().optional().nullable(),
        assistingStaff1Id: z.string().optional().nullable(),
        assistingStaff2Id: z.string().optional().nullable(),
        commissionSplit: z.enum(["standard", "equal"]).optional().default("standard"),
      })
    ),
    paymentMethod: z.enum(["cash", "transfer", "flutterwave"]).default("cash"),
    discountAmount: z.number().min(0).optional(),
    discountPercent: z.number().min(0).optional(),
    discountReason: z.string().optional(),
    discountApprovedBy: z.string().optional(),
    effectiveDate: z.string().optional(),
  });

  app.post("/api/sales/checkout", async (req, res) => {
    try {
      const data = checkoutSchema.parse(req.body);

      // Use transactional checkout for atomicity (all-or-nothing)
      const result = await storage.processCheckout({
        storeId: data.storeId,
        customerId: data.customerId,
        staffId: data.staffId,
        items: data.items,
        paymentMethod: data.paymentMethod,
        discountAmount: data.discountAmount,
        discountPercent: data.discountPercent,
        discountReason: data.discountReason,
        discountApprovedBy: data.discountApprovedBy,
        effectiveDate: data.effectiveDate,
      });

      if (!result.success) {
        auditLogger.logDataModification("checkout", undefined, getUserId(req), "CHECKOUT", false, result.message);
        return res.status(400).json({ error: result.message });
      }

      auditLogger.logDataModification("checkout", result.checkoutIds?.[0], getUserId(req), "CHECKOUT", true);
      
      // Auto-recalculate open payroll periods covering today's checkout date
      const todayStr = new Date().toISOString().split("T")[0];
      triggerAutoRecalculate(data.storeId, todayStr).catch(console.error);

      res.status(201).json({
        success: true,
        message: result.message,
        checkoutIds: result.checkoutIds
      });
    } catch (error) {
      auditLogger.logDataModification("checkout", undefined, getUserId(req), "CHECKOUT", false, (error as Error).message);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      console.error("Checkout error:", error);
      res.status(500).json({ error: "We couldn't complete this sale right now. Please try again." });
    }
  });

  // Helper to automatically recalculate any open pending payroll periods when source records are modified
  async function triggerAutoRecalculate(storeId: string, dateStr: string) {
    try {
      const periods = await storage.getPayrollPeriods(storeId);
      const pendingPeriod = periods.find(p => p.status === "pending" && p.startDate <= dateStr && p.endDate >= dateStr);
      if (pendingPeriod) {
        await storage.calculatePayrollForPeriod(pendingPeriod.id);
        console.log(`Auto-recalculated pending payroll period ${pendingPeriod.id} due to data change on ${dateStr}`);
      }
    } catch (err) {
      console.error("Auto-recalculate error:", err);
    }
  }

  app.get("/api/reports/top-customers", requireManagerOrOwner, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });
      const results = await storage.getTopCustomers(storeId);
      res.json(results);
    } catch (error) {
      res.status(500).json({ error: "Could not load top customers report." });
    }
  });

  // ========== SETTINGS ==========
  app.get("/api/settings", async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;
      const settings = await storage.getSettings(storeId);
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: "Could not load settings." });
    }
  });

  app.put("/api/settings", async (req, res) => {
    try {
      const { storeId, ...data } = req.body;
      if (!storeId) return res.status(400).json({ error: "storeId is required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;

      // Only owner/manager can edit settings
      const role = (req as any).user?.role;
      if (role !== "manager" && role !== "owner") {
        return res.status(403).json({ error: "Only managers and owners can modify settings." });
      }

      const updated = await storage.upsertSettings(storeId, data);
      
      // Auto-recalculate any active period to immediately reflect updated default rates
      const todayStr = new Date().toISOString().split("T")[0];
      triggerAutoRecalculate(storeId, todayStr).catch(console.error);

      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Could not update settings." });
    }
  });

  // ========== SEARCH ==========
  app.get("/api/search", isAuthenticated, async (req, res) => {
    try {
      const q = req.query.q as string;
      const storeId = req.query.storeId as string;
      if (!q || q.length < 2) return res.json({ results: [] });
      if (!storeId) return res.status(400).json({ error: "Store ID required." });

      const [customersRes, inventoryRes, transactionsRes] = await Promise.all([
        storage.searchCustomers(storeId, q),
        storage.searchInventory(storeId, q),
        storage.searchTransactions(storeId, q)
      ]);

      res.json({
        customers: customersRes,
        inventory: inventoryRes,
        transactions: transactionsRes,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Search failed." });
    }
  });

  // ========== NOTIFICATIONS ==========
  app.get("/api/notifications", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      const notifications = await storage.getNotifications(userId);
      res.json(notifications);
    } catch (error) {
      console.error("Error loading notifications:", error);
      res.status(500).json({ error: "Could not load notifications." });
    }
  });

  app.patch("/api/notifications/:id/read", isAuthenticated, async (req, res) => {
    try {
      await storage.markNotificationAsRead(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error marking notification as read:", error);
      res.status(500).json({ error: "Could not mark notification as read." });
    }
  });

  app.post("/api/notifications/read-all", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      await storage.markAllNotificationsAsRead(userId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error marking all notifications as read:", error);
      res.status(500).json({ error: "Could not mark all notifications as read." });
    }
  });

  // ========== REPORTS ==========
  app.get("/api/reports/staff-performance", requireManagerOrOwner, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;

      if (!storeId) return res.status(400).json({ error: "Please select a store first." });
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const data = await storage.getStaffPerformance(storeId, startDate, endDate);
      res.json(data);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Could not fetch staff performance data." });
    }
  });

  // Get attendance records
  app.get("/api/attendance", async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const records = await storage.getAttendanceRecords(storeId, {
        staffId: req.query.staffId as string | undefined,
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
      });
      res.json(records);
    } catch (error) {
      res.status(500).json({ error: "Could not load attendance records." });
    }
  });

  // Upsert a single attendance record
  app.post("/api/attendance", requireManagerOrOwner, async (req, res) => {
    try {
      const { storeId, staffId, date, status, notes } = req.body;
      if (!storeId || !staffId || !date || !status) {
        return res.status(400).json({ error: "storeId, staffId, date and status are required." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const userId = (req as any).user?.id;
      const record = await storage.upsertAttendanceRecord({ storeId, staffId, date, status, notes, markedByUserId: userId });
      
      triggerAutoRecalculate(storeId, date).catch(console.error);

      res.status(200).json(record);
    } catch (error) {
      res.status(500).json({ error: "Could not save attendance record." });
    }
  });

  // Bulk mark attendance for a day
  app.post("/api/attendance/bulk", requireManagerOrOwner, async (req, res) => {
    try {
      const { storeId, date, status, staffIds } = req.body;
      if (!storeId || !date || !status || !Array.isArray(staffIds)) {
        return res.status(400).json({ error: "storeId, date, status and staffIds array are required." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const userId = (req as any).user?.id;
      const records = await storage.bulkMarkAttendance(storeId, date, status, staffIds, userId);
      
      triggerAutoRecalculate(storeId, date).catch(console.error);

      res.json(records);
    } catch (error) {
      res.status(500).json({ error: "Could not bulk mark attendance." });
    }
  });

  // Attendance summary for a staff member in a date range
  app.get("/api/attendance/summary", async (req, res) => {
    try {
      const { storeId, staffId, startDate, endDate } = req.query as Record<string, string>;
      if (!storeId || !staffId || !startDate || !endDate) {
        return res.status(400).json({ error: "storeId, staffId, startDate, and endDate are required." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;
      const summary = await storage.getAttendanceSummary(storeId, staffId, startDate, endDate);
      res.json(summary);
    } catch (error) {
      res.status(500).json({ error: "Could not load attendance summary." });
    }
  });

  app.post("/api/expenses/bulk", requireManagerOrOwner, async (req, res) => {
    try {
      const { storeId, expenses } = req.body;
      if (!storeId) return res.status(400).json({ error: "Store ID is required." });
      if (!Array.isArray(expenses)) return res.status(400).json({ error: "Expenses must be an array." });

      const results = { success: 0, failed: 0, errors: [] as string[] };

      for (const expense of expenses) {
        try {
          if (!expense.description || !expense.amount || !expense.categoryId) {
             results.failed++;
             results.errors.push(`Missing data for: ${JSON.stringify(expense)}`);
             continue;
          }

          await storage.createExpense({
            ...expense,
            storeId,
            amount: Number(expense.amount),
            date: expense.date ? new Date(expense.date) : new Date(),
          });
          results.success++;
        } catch (err: any) {
          results.failed++;
          results.errors.push(`${expense.description}: ${err.message}`);
        }
      }

      res.json(results);
    } catch (error) {
      res.status(500).json({ error: "Bulk expense import failed." });
    }
  });

  // ========== PAYROLL ==========

  // List payroll periods for a store
  app.get("/api/payroll/periods", requireManagerOrOwner, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;
      const periods = await storage.getPayrollPeriods(storeId);
      res.json(periods);
    } catch (error) {
      res.status(500).json({ error: "Could not load payroll periods." });
    }
  });

  // Create a new payroll period
  app.post("/api/payroll/periods", requireManagerOrOwner, async (req, res) => {
    try {
      const { storeId, periodType, startDate, endDate } = req.body;
      if (!storeId || !startDate || !endDate) {
        return res.status(400).json({ error: "storeId, startDate, and endDate are required." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;
      const period = await storage.createPayrollPeriod({ storeId, periodType: periodType || "monthly", startDate, endDate, status: "pending" });
      res.status(201).json(period);
    } catch (error) {
      res.status(500).json({ error: "Could not create payroll period." });
    }
  });

  // Get a single payroll period
  app.get("/api/payroll/periods/:id", requireManagerOrOwner, async (req, res) => {
    try {
      const period = await storage.getPayrollPeriod(req.params.id);
      if (!period) return res.status(404).json({ error: "Payroll period not found." });
      if (!(await checkStoreAccess(period.storeId, req, res))) return;
      res.json(period);
    } catch (error) {
      res.status(500).json({ error: "Could not load payroll period." });
    }
  });

  // Calculate (or recalculate) payroll for a period
  app.post("/api/payroll/periods/:id/calculate", requireManagerOrOwner, async (req, res) => {
    try {
      const period = await storage.getPayrollPeriod(req.params.id);
      if (!period) return res.status(404).json({ error: "Payroll period not found." });
      if (!(await checkStoreAccess(period.storeId, req, res))) return;
      const entries = await storage.calculatePayrollForPeriod(req.params.id);
      res.json(entries);
    } catch (error) {
      console.error("Calculation error:", error);
      const message = (error as Error).message;
      if (message.includes("column") && message.includes("does not exist")) {
        res.status(500).json({ error: "System configuration error: A required database column is missing. Please run migrations." });
      } else {
        res.status(400).json({ error: error instanceof Error ? error.message : "Error calculating payroll" });
      }
    }
  });

  // Approve a payroll period
  app.post("/api/payroll/periods/:id/approve", requireManagerOrOwner, async (req, res) => {
    try {
      const period = await storage.getPayrollPeriod(req.params.id);
      if (!period) return res.status(404).json({ error: "Payroll period not found." });
      if (!(await checkStoreAccess(period.storeId, req, res))) return;
      const userId = (req as any).user?.id;
      const updated = await storage.updatePayrollPeriodStatus(req.params.id, "approved", userId);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Could not approve payroll period." });
    }
  });

  // Mark a payroll period as paid (locks it)
  app.post("/api/payroll/periods/:id/mark-paid", requireManagerOrOwner, async (req, res) => {
    try {
      const period = await storage.getPayrollPeriod(req.params.id);
      if (!period) return res.status(404).json({ error: "Payroll period not found." });
      if (!(await checkStoreAccess(period.storeId, req, res))) return;
      const entries = await storage.getPayrollEntries(period.id);
      const totalAmount = entries.reduce((sum, entry) => sum + (entry.netPay || 0), 0);
      const userId = (req as any).user?.id;

      const updated = await storage.updatePayrollPeriodStatus(req.params.id, "paid", userId);

      // Auto-generate Expense for the paid payroll
      try {
        const categories = await storage.getExpenseCategories(period.storeId);
        let payrollCat = categories.find(c => c.isSystem && c.name === "Payroll");
        if (!payrollCat) {
          payrollCat = await storage.createExpenseCategory({ storeId: period.storeId, name: "Payroll", isSystem: true });
        }
          await storage.createExpense({
            storeId: period.storeId,
            categoryId: payrollCat.id,
            title: `Payroll — ${period.startDate} to ${period.endDate}`,
            amount: totalAmount,
            date: new Date().toISOString().split("T")[0],
          });
      } catch (e) {
        console.error("Failed to auto-generate payroll expense:", e);
      }

      res.json(updated);
    } catch (error) {
      console.error("Mark paid error:", error);
      const message = (error as Error).message;
      if (message.includes("overlaps") || message.includes("pg_catalog.overlaps")) {
        res.status(400).json({ error: "This payroll period overlaps with another one that is already marked as Paid. Please check your dates." });
      } else {
        res.status(500).json({ error: error instanceof Error ? error.message : "Error marking payroll as paid" });
      }
    }
  });

  app.delete("/api/payroll/periods/:id", requireRole("owner"), async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.deletePayrollPeriod(id);
      if (!success) return res.status(404).json({ error: "Payroll period not found." });
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  // Get payroll entries (per-staff breakdown) for a period
  app.get("/api/payroll/periods/:id/entries", requireManagerOrOwner, async (req, res) => {
    try {
      const period = await storage.getPayrollPeriod(req.params.id);
      if (!period) return res.status(404).json({ error: "Payroll period not found." });
      if (!(await checkStoreAccess(period.storeId, req, res))) return;
      const entries = await storage.getPayrollEntries(req.params.id);
      res.json(entries);
    } catch (error) {
      res.status(500).json({ error: "Could not load payroll entries." });
    }
  });

  // Commission drill-down for one staff member in a period
  app.get("/api/payroll/periods/:id/entries/:staffId/drilldown", requireManagerOrOwner, async (req, res) => {
    try {
      const period = await storage.getPayrollPeriod(req.params.id);
      if (!period) return res.status(404).json({ error: "Payroll period not found." });
      if (!(await checkStoreAccess(period.storeId, req, res))) return;
      const breakdown = await storage.getPayrollDrillDown(req.params.id, req.params.staffId);
      res.json(breakdown);
    } catch (error) {
      res.status(500).json({ error: "Could not load commission breakdown." });
    }
  });

  // ========== FLUTTERWAVE PAYMENT LINK ==========
  const paymentLinkSchema = z.object({
    amount: z.number().positive(),
    currency: z.string().default("NGN"),
    customerName: z.string(),
    customerEmail: z.string().email(),
    customerPhone: z.string().optional(),
    description: z.string(),
    redirectUrl: z.string().url().optional(),
  });

  app.post("/api/payments/flutterwave/link", async (req, res) => {
    try {
      const data = paymentLinkSchema.parse(req.body);

      const flutterwaveSecretKey = process.env.FLUTTERWAVE_SECRET_KEY;
      if (!flutterwaveSecretKey) {
        return res.status(500).json({
          error: "Flutterwave is not configured. Please add your Flutterwave secret key in settings."
        });
      }

      const txRef = `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const response = await fetch("https://api.flutterwave.com/v3/payments", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${flutterwaveSecretKey}`,
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
        res.json({
          success: true,
          paymentLink: result.data.link,
          txRef,
        });
      } else {
        res.status(400).json({
          error: result.message || "Failed to generate payment link"
        });
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      console.error("Flutterwave error:", error);
      res.status(500).json({ error: "Failed to generate payment link. Please try again." });
    }
  });

  // Flutterwave webhook for payment verification
  app.post("/api/payments/flutterwave/webhook", async (req, res) => {
    try {
      const secretHash = process.env.FLUTTERWAVE_SECRET_HASH;
      const signature = req.headers["verif-hash"];

      if (!secretHash || signature !== secretHash) {
        auditLogger.logSecurityEvent("flutterwave_webhook_invalid_signature", undefined, getClientIp(req), { signature });
        return res.status(401).json({ error: "Invalid signature" });
      }

      const { event, data } = req.body;

      if (event === "charge.completed" && data.status === "successful") {
        const txRef = data.tx_ref;
        const amount = data.amount;
        auditLogger.logPayment(txRef, data.customer?.email || "unknown", amount, "flutterwave", "success");

        // Update checkout payment status if tx_ref contains checkout IDs
        if (txRef && txRef.includes("-checkout-")) {
          const checkoutId = txRef.split("-checkout-")[1]?.split("-")[0];
          if (checkoutId) {
            await storage.updateCheckoutPaymentStatus(checkoutId, "completed");
          }
        }
      } else if (event === "charge.completed" && data.status === "failed") {
        auditLogger.logPayment(data.tx_ref, data.customer?.email || "unknown", data.amount, "flutterwave", "failure", "Payment failed");
      }

      res.status(200).json({ received: true });
    } catch (error) {
      console.error("Webhook error:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  // ==========================================
  // EXPENSES MODULE
  // ==========================================

  app.get("/api/expense-categories", requireManagerOrOwner, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const categories = await storage.getExpenseCategories(storeId);
      res.json(categories);
    } catch (error) {
      res.status(500).json({ error: "Could not fetch expense categories." });
    }
  });

  app.post("/api/expense-categories", requireRole("owner"), async (req, res) => {
    try {
      const { storeId, name } = req.body;
      if (!storeId || !name) return res.status(400).json({ error: "Store ID and name required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const category = await storage.createExpenseCategory({ storeId, name, isSystem: false });
      res.status(201).json(category);
    } catch (error) {
      res.status(500).json({ error: "Could not create expense category." });
    }
  });

  app.delete("/api/expense-categories/:id", requireRole("owner"), async (req, res) => {
    try {
      await storage.deleteExpenseCategory(req.params.id);
      res.status(204).end();
    } catch (error) {
      res.status(500).json({ error: "Could not delete expense category. It may be in use." });
    }
  });

  app.get("/api/expenses", requireManagerOrOwner, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;

      if (!storeId) return res.status(400).json({ error: "Store ID required." });
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const expenses = await storage.getExpenses(storeId, startDate, endDate);
      res.json(expenses);
    } catch (error) {
      res.status(500).json({ error: "Could not fetch expenses." });
    }
  });

  app.post("/api/expenses", requireManagerOrOwner, async (req, res) => {
    try {
      const { storeId, title, amount, categoryId, date, notes, receiptUrl } = req.body;
      if (!storeId || !title || amount === undefined || !categoryId || !date) {
        return res.status(400).json({ error: "Missing required fields." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const expense = await storage.createExpense({
        storeId, title, amount: Number(amount), categoryId, date, notes, receiptUrl
      });
      res.status(201).json(expense);
    } catch (error) {
      res.status(500).json({ error: "Could not create expense." });
    }
  });


  app.delete("/api/expenses/:id", requireRole("owner"), async (req, res) => {
    try {
      await storage.deleteExpense(req.params.id);
      res.status(204).end();
    } catch (error) {
      res.status(500).json({ error: "Could not delete expense." });
    }
  });

  return httpServer;
}
