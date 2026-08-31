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
    req.path.startsWith("/api/billing/webhook")
  ) {
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
