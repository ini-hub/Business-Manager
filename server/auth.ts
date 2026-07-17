import jwt from "jsonwebtoken";
import type { Express, Request, Response, NextFunction, RequestHandler } from "express";

import { storage } from "./storage";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("FATAL: JWT_SECRET environment variable must be set.");
}
const JWT_SECRET_VALUE: string = JWT_SECRET;
const JWT_EXPIRY = process.env.JWT_EXPIRY || "24h";

export interface JWTPayload {
  userId: string;
  organisationId?: string;
  role?: string;
  staffId?: string;
  email?: string;
}

export function generateToken(payload: JWTPayload, stayLoggedIn?: boolean): string {
  const expiry = stayLoggedIn ? "30d" : JWT_EXPIRY;
  return jwt.sign(payload, JWT_SECRET_VALUE, { expiresIn: expiry as any });
}

export function verifyToken(token: string): JWTPayload | undefined {
  try {
    return jwt.verify(token, JWT_SECRET_VALUE) as JWTPayload;
  } catch (error) {
    return undefined;
  }
}

// Short-lived token proving the caller just completed password auth as `userId`,
// so the org-select step never has to trust a client-supplied userId.
export function generateOrgSelectToken(userId: string): string {
  return jwt.sign({ userId, action: "org_select" }, JWT_SECRET_VALUE, { expiresIn: "10m" });
}

export function verifyOrgSelectToken(token: string): { userId: string } | undefined {
  try {
    const decoded = jwt.verify(token, JWT_SECRET_VALUE) as any;
    if (decoded?.action !== "org_select" || !decoded.userId) return undefined;
    return { userId: decoded.userId };
  } catch (error) {
    return undefined;
  }
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(";").forEach((cookie) => {
    const parts = cookie.split("=");
    list[parts.shift()!.trim()] = decodeURI(parts.join("="));
  });
  return list;
}

export async function setupAuth(app: Express) {
  // Setup JWT middleware to parse httpOnly cookie 'jwt_token'
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.jwt_token || req.headers["authorization"]?.replace("Bearer ", "");
    
    if (token) {
      const claims = verifyToken(token);
      if (claims) {
        let businessId = claims.organisationId;
        if (!businessId && claims.userId) {
          try {
            const userRecord = await storage.getUser(claims.userId);
            if (userRecord?.businessId) {
              businessId = userRecord.businessId;
            }
          } catch (dbError) {
            console.error("Auth middleware DB user lookup error:", dbError);
          }
        }

        (req as any).user = {
          ...claims,
          id: claims.userId,
          businessId,
        };
      }
    }
    
    // BACKWARD COMPATIBILITY: polyfill req.isAuthenticated(), req.login(), req.logout()
    (req as any).isAuthenticated = function() {
      return !!this.user;
    };
    (req as any).login = function(user: any, cb?: (err: any) => void) {
      this.user = user;
      if (cb) cb(null);
    };
    (req as any).logout = function(cb?: (err: any) => void) {
      this.user = undefined;
      if (cb) cb(null);
    };
    next();
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  if (!(req as any).isAuthenticated()) {
    return res.status(401).json({ error: "Unauthorized. Please log in first." });
  }
  return next();
};
