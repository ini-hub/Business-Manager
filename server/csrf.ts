import { type Request, type Response, type NextFunction } from "express";
import crypto from "crypto";

// Safe methods that do not modify state and are exempt from CSRF checks
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Routes exempt from CSRF checks (e.g. login/signup, external webhooks)
const EXEMPT_ROUTES = new Set([
  "/api/auth/login",
  "/api/auth/signup",
  "/api/auth/verify-signup-email",
  "/api/auth/verify-activation-code",
  "/api/auth/activate",
  "/api/auth/resend-activation",
  "/api/auth/resend-verification-otp",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/set-activated-password",
  // Reached pre-session, from the /continue and /login gate responses.
  "/api/auth/verify-manager-email-change",
]);

// Helper to parse cookies from headers
function getCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const cookies = cookieHeader.split(";");
  for (const cookie of cookies) {
    const [key, val] = cookie.trim().split("=");
    if (key === name) return val;
  }
  return undefined;
}

export function csrfMiddleware(req: Request, res: Response, next: NextFunction) {
  const method = req.method.toUpperCase();
  const isSafe = SAFE_METHODS.has(method);

  // Parse existing CSRF cookie
  let csrfCookie = getCookie(req.headers.cookie, "_csrf");

  // 1. Generate CSRF token if missing on GET requests
  if (isSafe) {
    if (!csrfCookie) {
      csrfCookie = crypto.randomUUID();
      res.cookie("_csrf", csrfCookie, {
        httpOnly: false, // Must be readable by client JS to send in header
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      });
    }
    return next();
  }

  // 2. Exempt external or auth initialization routes
  if (
    EXEMPT_ROUTES.has(req.path) ||
    req.path.startsWith("/api/webhooks") ||
    req.path.startsWith("/api/billing/webhook") ||
    // Public magic-link booking actions (server/routes/customer-booking.routes.ts) -
    // reached by a customer with no session/cookie, so there's no CSRF cookie to check.
    // The token itself (unguessable, scoped to one booking) is the access control.
    req.path.startsWith("/api/my-booking/")
  ) {
    return next();
  }

  // Bearer-authenticated clients (the mobile app) carry no browser cookie jar,
  // so a forged cross-site request can't ride their session - there's nothing
  // for CSRF to protect against. But server/auth.ts resolves the session as
  // `cookies.jwt_token || authorization header`, so a request that presents
  // BOTH is still cookie-authenticated (the cookie wins there) and must go
  // through the CSRF check below. Exempting on bearer-presence alone, without
  // requiring the cookie's absence, would let an attacker's cross-site form
  // ride the victim's jwt_token cookie past this middleware by simply adding
  // an (attacker-controlled, unused) Authorization header - a full CSRF
  // bypass on every state-mutating route.
  const hasBearer = Boolean(req.headers["authorization"]);
  const hasAuthCookie = Boolean(getCookie(req.headers.cookie, "jwt_token"));
  if (hasBearer && !hasAuthCookie) {
    return next();
  }

  // 3. Enforce CSRF token match for non-safe methods (POST, PUT, DELETE, PATCH)
  const csrfHeader = req.headers["x-csrf-token"] as string;

  if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
    console.warn(`[CSRF Alert] Blocked request from IP ${req.ip} targeting ${req.path}. Header: ${csrfHeader ? "present" : "missing"}, Cookie: ${csrfCookie ? "present" : "missing"}`);
    return res.status(403).json({
      error: "invalid_csrf_token",
      message: "Security check failed: Invalid or missing CSRF token. Please refresh the page.",
    });
  }

  next();
}
