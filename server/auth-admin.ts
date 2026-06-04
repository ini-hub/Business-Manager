import jwt from "jsonwebtoken";
import type { Express, Request, Response, NextFunction, RequestHandler } from "express";
import { db } from "./db";
import { superAdmins } from "@shared/schema";
import { eq } from "drizzle-orm";

const JWT_ADMIN_SECRET = process.env.JWT_ADMIN_SECRET;
if (!JWT_ADMIN_SECRET) {
  throw new Error("FATAL: JWT_ADMIN_SECRET environment variable must be set.");
}
const JWT_ADMIN_SECRET_VALUE: string = JWT_ADMIN_SECRET;
const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours in milliseconds

export interface AdminJWTPayload {
  adminId: string;
  email: string;
  role: string;
  name: string;
  lastActivity: number; // Timestamp of last request to enforce inactivity timeout
}

// Generate secure JWT token for Admin Session
export function generateAdminToken(payload: Omit<AdminJWTPayload, "lastActivity">): string {
  const fullPayload: AdminJWTPayload = {
    ...payload,
    lastActivity: Date.now(),
  };
  // Token expires in 2 hours but we also renew it dynamically in middleware
  return jwt.sign(fullPayload, JWT_ADMIN_SECRET_VALUE, { expiresIn: "2h" });
}

// Verify secure JWT token
export function verifyAdminToken(token: string): AdminJWTPayload | undefined {
  try {
    const decoded = jwt.verify(token, JWT_ADMIN_SECRET_VALUE) as AdminJWTPayload;
    return decoded;
  } catch (error) {
    return undefined;
  }
}

// Parse cookies helper
function parseCookies(cookieHeader?: string): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(";").forEach((cookie) => {
    const parts = cookie.split("=");
    list[parts.shift()!.trim()] = decodeURI(parts.join("="));
  });
  return list;
}

// Setup Admin Authentication Middleware
export async function setupAdminAuth(app: Express) {
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    // Only process admin auth if route is prefixed with /api/admin
    if (!req.path.startsWith("/api/admin")) {
      return next();
    }

    // Skip auth check for login and initialization endpoints
    if (req.path === "/api/admin/auth/login" || req.path === "/api/admin/auth/setup-mfa" || req.path === "/api/admin/auth/verify-mfa") {
      return next();
    }

    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.admin_sid || req.headers["x-admin-authorization"]?.toString().replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({ error: "Unauthorized. Admin session missing." });
    }

    const claims = verifyAdminToken(token);
    if (!claims) {
      return res.status(401).json({ error: "Unauthorized. Admin session expired or invalid." });
    }

    // Enforce 2-hour inactivity timeout
    const now = Date.now();
    const timeSinceLastActivity = now - claims.lastActivity;
    if (timeSinceLastActivity > SESSION_TIMEOUT_MS) {
      res.clearCookie("admin_sid");
      return res.status(401).json({ error: "Session expired due to inactivity. Please log in again." });
    }

    // Verify admin account is active in the database
    try {
      const [admin] = await db
        .select()
        .from(superAdmins)
        .where(eq(superAdmins.id, claims.adminId))
        .limit(1);

      if (!admin) {
        res.clearCookie("admin_sid");
        return res.status(401).json({ error: "Admin account not found." });
      }

      if (admin.status !== "active") {
        res.clearCookie("admin_sid");
        return res.status(403).json({ error: "Admin account is suspended." });
      }

      // Attach admin to request
      (req as any).admin = {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
        mfaEnabled: admin.mfaEnabled,
      };

      // Dynamic session renewal: if 5 minutes have elapsed since lastActivity, issue a fresh token to slide the 2-hour expiration window
      if (timeSinceLastActivity > 5 * 60 * 1000) {
        const renewedToken = generateAdminToken({
          adminId: admin.id,
          email: admin.email,
          role: admin.role,
          name: admin.name,
        });
        res.cookie("admin_sid", renewedToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          maxAge: SESSION_TIMEOUT_MS,
        });
      }
    } catch (dbError) {
      console.error("Admin Auth database validation error:", dbError);
      return res.status(500).json({ error: "Internal security validation error." });
    }

    next();
  });
}

// Request Handler Guards for Admin API Routers
export const isAdminAuthenticated: RequestHandler = (req, res, next) => {
  if (!(req as any).admin) {
    return res.status(401).json({ error: "Unauthorized. Administrative privileges required." });
  }
  next();
};

// Role Authorization check against Permissions Grid
export function requireAdminRole(allowedRoles: string[]): RequestHandler {
  return (req, res, next) => {
    const admin = (req as any).admin;
    if (!admin) {
      return res.status(401).json({ error: "Unauthorized. Administrative privileges required." });
    }

    if (!allowedRoles.includes(admin.role)) {
      return res.status(403).json({
        error: `Forbidden. Role '${admin.role}' does not possess permissions for this operation.`,
      });
    }
    next();
  };
}
