import jwt from "jsonwebtoken";
import type { Express, Request, Response, NextFunction, RequestHandler } from "express";

import { storage } from "./storage";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { subscriptions } from "@shared/schema";
import { getOrgAccessState } from "./lib/trial";
import { maybeProcessDueRenewal } from "./lib/billing";

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

export function generateToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET_VALUE, { expiresIn: JWT_EXPIRY as any });
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

// Minted instead of the real jwt_token when set-activated-password (or a
// later login) finds a staff member's contract still awaiting a signature.
// Deliberately a distinct cookie name/claim shape verified by its own
// function, never generateToken/verifyToken, so it can never satisfy
// isAuthenticated (or anything downstream of it) even by accident - see
// requireContractPendingToken below. Short-lived: this token only exists to
// get the person from "just set a password" to "signed the contract",
// nothing more.
export function generateContractPendingToken(userId: string, staffContractId: string): string {
  return jwt.sign({ userId, staffContractId, action: "contract_pending" }, JWT_SECRET_VALUE, { expiresIn: "1h" });
}

export function verifyContractPendingToken(token: string): { userId: string; staffContractId: string } | undefined {
  try {
    const decoded = jwt.verify(token, JWT_SECRET_VALUE) as any;
    if (decoded?.action !== "contract_pending" || !decoded.userId || !decoded.staffContractId) return undefined;
    return { userId: decoded.userId, staffContractId: decoded.staffContractId };
  } catch (error) {
    return undefined;
  }
}

// Minted instead of the real jwt_token when login, or first-time staff
// activation (set-activated-password), finds the account hasn't yet
// accepted the current Terms and Conditions / Privacy Policy / Data Usage
// Policy (LegalDocumentService.hasAcceptedCurrentDocuments). Same
// structurally-incapable-of-authenticating design as
// generateContractPendingToken above: a distinct claim shape, verified by
// its own function, that can never satisfy isAuthenticated. `continueTo`
// tells POST /api/legal/consent-pending/accept which flow to resume once
// consent is recorded (server/lib/authFlow.ts).
export function generateLegalConsentPendingToken(userId: string, continueTo: "login" | "staff_activation"): string {
  return jwt.sign({ userId, continueTo, action: "legal_consent_pending" }, JWT_SECRET_VALUE, { expiresIn: "1h" });
}

export function verifyLegalConsentPendingToken(token: string): { userId: string; continueTo: "login" | "staff_activation" } | undefined {
  try {
    const decoded = jwt.verify(token, JWT_SECRET_VALUE) as any;
    if (decoded?.action !== "legal_consent_pending" || !decoded.userId || !decoded.continueTo) return undefined;
    return { userId: decoded.userId, continueTo: decoded.continueTo };
  } catch (error) {
    return undefined;
  }
}

// Minted instead of the real jwt_token when login, or first-time staff
// activation, finds required HR profile sections (personal/emergency/
// guarantor, per hr_section_config) still incomplete - see
// server/lib/hrProfileGate.ts and server/lib/authFlow.ts. Same
// structurally-incapable-of-authenticating design as
// generateContractPendingToken: a distinct claim shape, verified by its own
// function, attached to req.profileSession rather than req.user. The
// contract gate takes priority over this one when both are outstanding
// (see authFlow.ts) - a signature is a legal document, profile fields are
// not.
export function generateProfilePendingToken(userId: string, staffId: string): string {
  return jwt.sign({ userId, staffId, action: "profile_pending" }, JWT_SECRET_VALUE, { expiresIn: "2h" });
}

export function verifyProfilePendingToken(token: string): { userId: string; staffId: string } | undefined {
  try {
    const decoded = jwt.verify(token, JWT_SECRET_VALUE) as any;
    if (decoded?.action !== "profile_pending" || !decoded.userId || !decoded.staffId) return undefined;
    return { userId: decoded.userId, staffId: decoded.staffId };
  } catch (error) {
    return undefined;
  }
}

// Minted when a guarantor form is submitted (status flips to
// pending_signature) so the guarantor - who has no users row and therefore
// can never log in - can reach the signing page via a mailed/shared link
// instead. Scoped to one guarantorFormId, not a userId: verifying this
// token never yields anything resembling a user identity, so like the
// tokens above it can never satisfy isAuthenticated even by accident.
export function generateGuarantorSigningToken(guarantorFormId: string): string {
  return jwt.sign({ guarantorFormId, action: "guarantor_pending" }, JWT_SECRET_VALUE, { expiresIn: "30d" });
}

export function verifyGuarantorSigningToken(token: string): { guarantorFormId: string } | undefined {
  try {
    const decoded = jwt.verify(token, JWT_SECRET_VALUE) as any;
    if (decoded?.action !== "guarantor_pending" || !decoded.guarantorFormId) return undefined;
    return { guarantorFormId: decoded.guarantorFormId };
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

// Gates the self-service contract review/sign/decline routes
// (server/routes/contract.routes.ts). Reads the contract_pending_token
// cookie set by set-activated-password / login when a signature is
// outstanding, and attaches req.contractSession - never req.user. That is
// the whole point: this token must stay structurally incapable of passing
// isAuthenticated or any business-route access check, even by accident.
export const requireContractPendingToken: RequestHandler = async (req, res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.contract_pending_token;
  const claims = token ? verifyContractPendingToken(token) : undefined;
  if (!claims) {
    return res.status(401).json({ error: "Your session to review this contract has expired. Please log in again." });
  }
  (req as any).contractSession = claims;
  return next();
};

// Gates the self-service profile-completion routes
// (server/routes/profile-completion.routes.ts). Reads the
// profile_pending_token cookie set by login / set-activated-password when
// required HR sections are outstanding, and attaches req.profileSession -
// never req.user, for the same reason requireContractPendingToken above
// never sets it.
export const requireProfilePendingToken: RequestHandler = async (req, res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.profile_pending_token;
  const claims = token ? verifyProfilePendingToken(token) : undefined;
  if (!claims) {
    return res.status(401).json({ error: "Your session to complete your profile has expired. Please log in again." });
  }
  (req as any).profileSession = claims;
  return next();
};

// Gates the guarantor's own signing/decline routes
// (server/routes/guarantor.routes.ts /api/guarantor/*). The guarantor has
// no users row, so this never sets req.user and is reached via a mailed/
// shared link rather than a login.
export const requireGuarantorSigningToken: RequestHandler = async (req, res, next) => {
  const token = typeof req.query.token === "string" ? req.query.token : req.body?.token;
  const claims = token ? verifyGuarantorSigningToken(token) : undefined;
  if (!claims) {
    return res.status(401).json({ error: "This signing link is invalid or has expired." });
  }
  (req as any).guarantorSession = claims;
  return next();
};

// Gates POST /api/legal/consent-pending/accept (server/routes/legal.routes.ts).
// Reads the legal_consent_pending_token cookie set by login / set-activated-
// password when consent is outstanding, and attaches req.legalConsentSession
// - never req.user, for the same reason requireContractPendingToken above
// never sets it.
export const requireLegalConsentPendingToken: RequestHandler = async (req, res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.legal_consent_pending_token;
  const claims = token ? verifyLegalConsentPendingToken(token) : undefined;
  if (!claims) {
    return res.status(401).json({ error: "Your session to accept these documents has expired. Please log in again." });
  }
  (req as any).legalConsentSession = claims;
  return next();
};

// Paths that must stay reachable even for a locked org: /api/auth (so login,
// logout, and switching to a different, unlocked business keep working),
// /api/billing (plans/subscribe/cancel, so an owner can actually pay to
// unlock), /api/support (so a locked-out owner can still reach the platform
// when there's no pay-to-unlock path - see server/routes/support.routes.ts),
// /api/business (so the client can fetch the record that tells it the org
// is locked and render the paywall/paused screen in the first place), and
// /api/admin (a wholly separate operator auth system that never sets
// req.user.businessId, kept here only as defense in depth). /api/legal (the
// public legal-document reads and the consent-pending accept endpoint) must
// stay reachable for the same reason /api/business does - a locked org's
// owner still needs to be able to read/accept these. /api/contract
// (self-service contract review/sign/decline) never sets req.user at all
// (see requireContractPendingToken above), so this is belt-and-suspenders
// rather than load-bearing, but keeps the exemption list an honest map of
// every pre-full-auth route family.
const ORG_LOCK_EXEMPT_PREFIXES = ["/api/auth", "/api/billing", "/api/support", "/api/admin", "/api/contract", "/api/legal", "/api/profile-completion", "/api/guarantor"];
const ORG_LOCK_EXEMPT_PATHS = new Set(["/api/business", "/api/health"]);

function isOrgLockExempt(path: string): boolean {
  if (ORG_LOCK_EXEMPT_PATHS.has(path)) return true;
  return ORG_LOCK_EXEMPT_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix + "/"));
}

/**
 * Closes the gap where a suspended or trial-expired business could keep
 * hitting the API directly even though the SPA would show them the
 * paywall/paused screen. getOrgAccessState is the same check the trial/
 * suspension flow already computes client-side (client/src/lib/trial.ts) -
 * this just enforces it server-side, since a valid JWT alone used to be
 * enough to keep transacting after suspension.
 */
export const enforceOrgAccess: RequestHandler = async (req, res, next) => {
  const user = (req as any).user;
  // req.path is relative to this middleware's mount point ("/api"), so
  // "/api/auth/continue" shows up here as "/auth/continue" - originalUrl
  // keeps the full path the exempt list is actually written against.
  const fullPath = req.originalUrl.split("?")[0];
  if (!user?.businessId || isOrgLockExempt(fullPath)) {
    return next();
  }

  try {
    const business = await storage.getBusinessById(user.businessId);
    if (!business) return next();

    const [subscription] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.organisationId, business.id));

    // Lazy renewal charge, same "check on request, no cron" philosophy as
    // trial expiry above. Fire-and-forget: never delays this request, the
    // next request just observes the renewed (or, on failure, locked) state.
    maybeProcessDueRenewal(business, subscription ?? null).catch((error) => {
      console.error(`enforceOrgAccess: renewal check failed for org ${business.id}:`, error);
    });

    if (getOrgAccessState(business, subscription ?? null) === "locked") {
      return res.status(403).json({
        error: "This business account is locked. An owner needs to resolve billing or contact support if it was suspended.",
        locked: true,
      });
    }
  } catch (error) {
    console.error("enforceOrgAccess error:", error);
  }

  return next();
};
