// Shared DB-backed OTP resend cooldown (max N sends per rolling window).
// Same pattern originally used only for activation-code resends
// (users.resend_attempts / resend_window_start) - generalized here so
// every OTP-issuing endpoint (login/signup OTP, forgot-password,
// email-change, phone-change) enforces the same rate limit instead of
// relying on the client-side countdown alone.
const OTP_RESEND_MAX = 3;
const OTP_RESEND_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const MAX_OTP_ATTEMPTS = 5;

export type ResendCooldownResult =
  | { allowed: true; nextAttempts: number; nextWindowStart: Date }
  | { allowed: false; retryAfterMinutes: number };

export function checkResendCooldown(
  attempts: number | null | undefined,
  windowStart: Date | string | null | undefined
): ResendCooldownResult {
  const now = new Date();
  const windowStartDate = windowStart ? new Date(windowStart) : null;
  const windowExpired = !windowStartDate || now.getTime() - windowStartDate.getTime() > OTP_RESEND_WINDOW_MS;
  const currentAttempts = windowExpired ? 0 : attempts || 0;

  if (currentAttempts >= OTP_RESEND_MAX) {
    const retryAfterMs = OTP_RESEND_WINDOW_MS - (now.getTime() - (windowStartDate as Date).getTime());
    return { allowed: false, retryAfterMinutes: Math.max(1, Math.ceil(retryAfterMs / 60000)) };
  }
  return {
    allowed: true,
    nextAttempts: currentAttempts + 1,
    nextWindowStart: windowExpired ? now : (windowStartDate as Date),
  };
}

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_RESEND_MIN_GAP_MS = 45 * 1000;

export type OtpCheck =
  | { ok: true }
  | { ok: false; code: "OTP_EXPIRED" | "OTP_LOCKED" | "OTP_INVALID"; attemptsLeft: number };

/**
 * Decides what a submitted code means, without touching storage. Order matters:
 * locked first (so a brute-forcer gets no further signal), then expiry (an
 * expired code is never compared and never costs a try), then the match.
 * A missing code or missing expiry fails closed as expired.
 * On OTP_INVALID the caller must persist otpAttempts + 1; attemptsLeft already
 * accounts for that try, and reaching 0 reports OTP_LOCKED.
 */
export function checkSubmittedOtp(
  user: { otpCode?: string | null; otpExpiry?: Date | string | null; otpAttempts?: number | null },
  submitted: string,
  matches: boolean,
  now: Date = new Date(),
): OtpCheck {
  const used = user.otpAttempts ?? 0;
  if (used >= MAX_OTP_ATTEMPTS) return { ok: false, code: "OTP_LOCKED", attemptsLeft: 0 };
  if (!user.otpCode || !user.otpExpiry || now > new Date(user.otpExpiry)) {
    return { ok: false, code: "OTP_EXPIRED", attemptsLeft: MAX_OTP_ATTEMPTS - used };
  }
  if (!submitted || !matches) {
    const left = MAX_OTP_ATTEMPTS - (used + 1);
    return { ok: false, code: left <= 0 ? "OTP_LOCKED" : "OTP_INVALID", attemptsLeft: Math.max(0, left) };
  }
  return { ok: true };
}

/** Seconds a user must still wait before a fresh code may be sent, or 0. A code that is
 *  expired or locked can always be replaced straight away. */
export function resendWaitSeconds(
  user: { otpCode?: string | null; otpExpiry?: Date | string | null; otpAttempts?: number | null },
  now: Date = new Date(),
): number {
  if (!user.otpCode || !user.otpExpiry) return 0;
  if ((user.otpAttempts ?? 0) >= MAX_OTP_ATTEMPTS) return 0;
  const expiry = new Date(user.otpExpiry).getTime();
  if (now.getTime() >= expiry) return 0;
  const sentAt = expiry - OTP_TTL_MS;
  const wait = OTP_RESEND_MIN_GAP_MS - (now.getTime() - sentAt);
  return wait > 0 ? Math.ceil(wait / 1000) : 0;
}
