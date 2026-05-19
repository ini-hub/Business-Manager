import jwt from "jsonwebtoken";
import type { Express, Request, Response, NextFunction, RequestHandler } from "express";

const JWT_SECRET = process.env.JWT_SECRET || "excellent_bolujo_secret_key";
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
  return jwt.sign(payload, JWT_SECRET, { expiresIn: expiry as any });
}

export function verifyToken(token: string): JWTPayload | undefined {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
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
  app.use((req: Request, res: Response, next: NextFunction) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.jwt_token || req.headers["authorization"]?.replace("Bearer ", "");
    
    if (token) {
      const claims = verifyToken(token);
      if (claims) {
        (req as any).user = {
          ...claims,
          id: claims.userId,
          businessId: claims.organisationId,
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
