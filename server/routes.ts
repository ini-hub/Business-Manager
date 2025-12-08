import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import crypto from "crypto";
import { storage } from "./storage";
import { setupAuth, isAuthenticated, getSession } from "./replitAuth";
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
  type UserRole,
} from "@shared/schema";
import { z } from "zod";
import { sanitizeString, sanitizeUUID, sanitizeNumber, sanitizeBoolean, sanitizePhoneNumber, sanitizeStoreCode } from "./sanitize";
import { auditLogger } from "./audit";
import passport from "passport";

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
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { error: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 auth attempts per windowMs
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
  // Apply rate limiting to all API routes
  app.use("/api/", apiLimiter);
  
  // Apply stricter rate limiting to auth endpoints
  app.use("/api/auth", authLimiter);

  // Setup authentication
  await setupAuth(app);

  // ========== CUSTOM AUTH ROUTES ==========
  
  // Signup - Create business and user account
  app.post("/api/auth/signup", async (req: Request, res: Response) => {
    try {
      const data = signupSchema.parse(req.body);
      const normalizedEmail = data.email.toLowerCase();
      
      // Check if email already exists
      const existingUser = await storage.getUserByEmail(normalizedEmail);
      if (existingUser) {
        return res.status(400).json({ error: "This email address is already registered as a business owner. Please use a different email or login to your existing account." });
      }
      
      // Hash password
      const hashedPassword = await bcrypt.hash(data.password, SALT_ROUNDS);
      
      // Create business first
      const business = await storage.createBusiness({
        name: data.businessName,
        address: data.address || "",
        phone: data.phone || "",
        phoneCountryCode: data.phoneCountryCode,
        email: normalizedEmail,
      });
      
      // Create user with business association
      const user = await storage.createUser({
        email: normalizedEmail,
        password: hashedPassword,
        businessId: business.id,
        role: "owner",
      });
      
      // Create OTP code for verification
      const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
      await storage.createOtpCode({
        userId: user.id,
        code: DEFAULT_OTP,
        type: "signup",
        expiresAt,
      });
      
      auditLogger.logAuthAttempt(user.id, getClientIp(req), true, "signup");
      
      // Return masked email for OTP screen
      const maskedEmail = normalizedEmail.replace(/(.{2})(.*)(@.*)/, "$1***$3");
      res.status(201).json({ 
        message: "Account created. Please verify your email.",
        email: normalizedEmail,
        maskedEmail,
        userId: user.id,
      });
    } catch (error) {
      console.error("Signup error:", error);
      auditLogger.logAuthAttempt(undefined, getClientIp(req), false, "signup");
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "We couldn't create your account. Please try again." });
    }
  });
  
  // Verify OTP - Confirm email verification
  app.post("/api/auth/verify-otp", async (req: Request, res: Response) => {
    try {
      const data = verifyOtpSchema.parse(req.body);
      
      const user = await storage.getUserByEmail(data.email);
      if (!user) {
        return res.status(404).json({ error: "Account not found." });
      }
      
      const otpCode = await storage.getValidOtpCode(user.id, data.otp, "signup");
      if (!otpCode) {
        auditLogger.logAuthAttempt(user.id, getClientIp(req), false, "verify-otp");
        return res.status(400).json({ error: "Invalid or expired OTP code." });
      }
      
      // Mark OTP as used and verify user
      await storage.markOtpCodeAsUsed(otpCode.id);
      await storage.updateUser(user.id, { isVerified: true });
      
      auditLogger.logAuthAttempt(user.id, getClientIp(req), true, "verify-otp");
      
      // Log user in by setting session
      const sessionUser = {
        id: user.id,
        email: user.email,
        role: user.role,
        businessId: user.businessId,
        isVerified: true,
      };
      (req as any).login(sessionUser, (err: any) => {
        if (err) {
          console.error("Session login error:", err);
          return res.status(500).json({ error: "Verification successful but login failed." });
        }
        res.json({ message: "Email verified successfully.", user: sessionUser });
      });
    } catch (error) {
      console.error("Verify OTP error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "Verification failed. Please try again." });
    }
  });
  
  // Resend OTP
  app.post("/api/auth/resend-otp", async (req: Request, res: Response) => {
    try {
      const { email, type = "signup" } = req.body;
      
      if (!email) {
        return res.status(400).json({ error: "Email is required." });
      }
      
      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(404).json({ error: "Account not found." });
      }
      
      // Create new OTP code
      const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
      await storage.createOtpCode({
        userId: user.id,
        code: DEFAULT_OTP,
        type,
        expiresAt,
      });
      
      const maskedEmail = email.replace(/(.{2})(.*)(@.*)/, "$1***$3");
      res.json({ 
        message: `OTP has been sent to ${maskedEmail}`,
        maskedEmail,
      });
    } catch (error) {
      console.error("Resend OTP error:", error);
      res.status(500).json({ error: "Failed to resend OTP. Please try again." });
    }
  });
  
  // Login - Email and password authentication
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const data = loginSchema.parse(req.body);
      
      const user = await storage.getUserByEmail(data.email);
      if (!user) {
        auditLogger.logAuthAttempt(undefined, getClientIp(req), false, "login");
        return res.status(401).json({ error: "Invalid email or password." });
      }
      
      // Check if user has a password (custom auth) or uses Replit Auth
      if (!user.password) {
        return res.status(400).json({ error: "Please use the 'Login with Replit' option." });
      }
      
      // Verify password
      const passwordMatch = await bcrypt.compare(data.password, user.password);
      if (!passwordMatch) {
        auditLogger.logAuthAttempt(user.id, getClientIp(req), false, "login");
        return res.status(401).json({ error: "Invalid email or password." });
      }
      
      // Check if email is verified
      if (!user.isVerified) {
        return res.status(403).json({ 
          error: "Please verify your email first.",
          requiresVerification: true,
          email: user.email,
        });
      }
      
      auditLogger.logAuthAttempt(user.id, getClientIp(req), true, "login");
      
      // Get business info
      const business = user.businessId ? await storage.getBusinessByUserId(user.id) : null;
      
      // Log user in by setting session
      const sessionUser = {
        id: user.id,
        email: user.email,
        role: user.role,
        businessId: user.businessId,
        isVerified: user.isVerified,
      };
      
      (req as any).login(sessionUser, (err: any) => {
        if (err) {
          console.error("Session login error:", err);
          return res.status(500).json({ error: "Login failed. Please try again." });
        }
        res.json({ 
          message: "Login successful.",
          user: sessionUser,
          business,
        });
      });
    } catch (error) {
      console.error("Login error:", error);
      auditLogger.logAuthAttempt(undefined, getClientIp(req), false, "login");
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "Login failed. Please try again." });
    }
  });
  
  // Forgot Password - Request password reset (also handles staff first-time login)
  app.post("/api/auth/forgot-password", async (req: Request, res: Response) => {
    try {
      const data = forgotPasswordSchema.parse(req.body);
      const normalizedEmail = data.email.toLowerCase(); // Normalize email at start
      
      let user = await storage.getUserByEmail(normalizedEmail);
      
      // If no user found, check if email belongs to a staff member
      if (!user) {
        const staffMember = await storage.getStaffByEmail(normalizedEmail);
        
        if (staffMember) {
          // Check if staff already has a linked user account
          if (staffMember.userId) {
            // Get the existing user account
            user = await storage.getUser(staffMember.userId);
          }
          
          // If still no user, double-check by email (in case userId link was lost)
          if (!user) {
            user = await storage.getUserByEmail(normalizedEmail);
          }
          
          // If still no user, create one for the staff member
          if (!user) {
            const placeholderPassword = await bcrypt.hash(crypto.randomUUID(), SALT_ROUNDS);
            
            // Get the business ID from the store
            const store = staffMember.store;
            
            // Create a new user account for the staff member
            user = await storage.createUser({
              email: normalizedEmail,
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
      
      if (!user) {
        // Don't reveal if email exists for security
        const maskedEmail = normalizedEmail.replace(/(.{2})(.*)(@.*)/, "$1***$3");
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
      
      const maskedEmail = normalizedEmail.replace(/(.{2})(.*)(@.*)/, "$1***$3");
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
      
      const user = await storage.getUserByEmail(data.email);
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
  
  // Get current user (supports both Replit Auth and custom auth)
  app.get("/api/auth/user", async (req: any, res) => {
    try {
      // Check for custom auth session first
      if (req.user && req.user.id) {
        const user = await storage.getUser(req.user.id);
        if (user) {
          const business = user.businessId ? await storage.getBusinessByUserId(user.id) : null;
          auditLogger.logAuthAttempt(user.id, getClientIp(req), true);
          return res.json({ 
            ...user, 
            business,
            password: undefined, // Never send password
          });
        }
      }
      
      // Check for Replit Auth session
      if (req.user?.claims?.sub) {
        const userId = req.user.claims.sub;
        const user = await storage.getUser(userId);
        auditLogger.logAuthAttempt(userId, getClientIp(req), true);
        return res.json(user);
      }
      
      res.status(401).json({ message: "Not authenticated" });
    } catch (error) {
      console.error("Error fetching user:", error);
      auditLogger.logAuthAttempt(undefined, getClientIp(req), false);
      res.status(500).json({ message: "Failed to fetch user" });
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
        // Check Replit Auth - default to owner for backward compatibility
        else if (req.user?.claims?.sub) {
          userRole = "owner";
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

  // ========== BUSINESS ==========
  app.get("/api/business", async (req, res) => {
    try {
      const business = await storage.getBusiness();
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
      const businessId = req.query.businessId as string;
      if (!businessId) {
        return res.status(400).json({ error: "Please select a business first." });
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
      res.json(store);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load store information. Please try again." });
    }
  });

  app.post("/api/stores", async (req, res) => {
    try {
      const data = insertStoreSchema.parse(req.body);
      const store = await storage.createStore(data);
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
      const data = insertStoreSchema.partial().parse(req.body);
      const store = await storage.updateStore(req.params.id, data);
      if (!store) {
        return res.status(404).json({ error: "Store not found." });
      }
      res.json(store);
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
      const sanitizedBody = {
        ...req.body,
        name: req.body.name ? sanitizeString(req.body.name) : undefined,
        mobileNumber: req.body.mobileNumber ? sanitizePhoneNumber(req.body.mobileNumber) : undefined,
        address: req.body.address ? sanitizeString(req.body.address) : undefined,
      };
      const data = insertCustomerSchema.partial().parse(sanitizedBody);
      const customer = await storage.updateCustomer(req.params.id, data);
      if (!customer) {
        return res.status(404).json({ error: "This customer no longer exists. It may have been deleted." });
      }
      auditLogger.logDataModification("customer", req.params.id, getUserId(req), "UPDATE", true);
      res.json(customer);
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
      const staffMember = await storage.createStaff(data);
      auditLogger.logDataModification("staff", staffMember.id, getUserId(req), "CREATE", true);
      res.status(201).json(staffMember);
    } catch (error) {
      auditLogger.logDataModification("staff", undefined, getUserId(req), "CREATE", false, (error as Error).message);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "We couldn't add this staff member right now. Please try again." });
    }
  });

  app.patch("/api/staff/:id", async (req, res) => {
    try {
      const sanitizedBody = {
        ...req.body,
        ...(req.body.name && { name: sanitizeString(req.body.name) }),
        ...(req.body.email && { email: sanitizeString(req.body.email)?.toLowerCase() }),
        ...(req.body.mobileNumber && { mobileNumber: sanitizePhoneNumber(req.body.mobileNumber) }),
        ...(req.body.payPerMonth !== undefined && { payPerMonth: sanitizeNumber(req.body.payPerMonth) }),
        ...(req.body.signedContract !== undefined && { signedContract: sanitizeBoolean(req.body.signedContract) }),
      };
      const data = insertStaffSchema.partial().parse(sanitizedBody);
      const staffMember = await storage.updateStaff(req.params.id, data);
      if (!staffMember) {
        return res.status(404).json({ error: "This staff member no longer exists. They may have been removed." });
      }
      res.json(staffMember);
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

  app.patch("/api/inventory/:id", async (req, res) => {
    try {
      const data = insertInventorySchema.partial().parse(req.body);
      const item = await storage.updateInventoryItem(req.params.id, data);
      if (!item) {
        return res.status(404).json({ error: "This item no longer exists. It may have been deleted." });
      }
      res.json(item);
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

  // ========== PROFIT & LOSS ==========
  app.get("/api/profit-loss", async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return res.status(400).json({ error: "Please select a store first." });
      }
      const plData = await storage.getProfitLoss(storeId);
      res.json(plData);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load profit/loss data. Please try again." });
    }
  });

  // ========== DASHBOARD STATS ==========
  app.get("/api/dashboard/stats", async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return res.status(400).json({ error: "Please select a store first." });
      }
      const stats = await storage.getDashboardStats(storeId);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load dashboard statistics. Please try again." });
    }
  });

  // ========== CHART DATA ==========
  app.get("/api/charts/sales-trends", async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return res.status(400).json({ error: "Please select a store first." });
      }
      const data = await storage.getSalesTrends(storeId);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load sales trends. Please try again." });
    }
  });

  app.get("/api/charts/revenue-by-type", async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return res.status(400).json({ error: "Please select a store first." });
      }
      const data = await storage.getRevenueByType(storeId);
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
      })
    ),
    paymentMethod: z.enum(["cash", "transfer", "flutterwave"]).default("cash"),
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
      });

      if (!result.success) {
        auditLogger.logDataModification("checkout", undefined, getUserId(req), "CHECKOUT", false, result.message);
        return res.status(400).json({ error: result.message });
      }

      auditLogger.logDataModification("checkout", result.checkoutIds?.[0], getUserId(req), "CHECKOUT", true);
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

  return httpServer;
}
