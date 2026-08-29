// Shared DB-backed OTP resend cooldown (max N sends per rolling window).
// Same pattern originally used only for activation-code resends
// (users.resend_attempts / resend_window_start) - generalized here so
// every OTP-issuing endpoint (login/signup OTP, forgot-password,
// email-change, phone-change) enforces the same rate limit instead of
// relying on the client-side countdown alone.
export const OTP_RESEND_MAX = 3;
export const OTP_RESEND_WINDOW_MS = 60 * 60 * 1000; // 1 hour
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
