/**
 * A manager has repointed this account's email (PATCH /api/staff/:id) and the
 * account holder has not yet proved they can read the new address.
 *
 * While this is true, no password-reset OTP may be issued and no session may be
 * minted from an email OTP - otherwise a manager could set the address to one
 * they control and reset their way into an active account. Cleared by
 * POST /api/auth/verify-manager-email-change.
 *
 * Deliberately keyed on managerEmailChangedAt alone and NOT on isEmailVerified:
 * plenty of legacy rows have that false, and gating on it would quietly take
 * password reset away from all of them.
 */
export function isManagerEmailChangePending(
  user: { managerEmailChangedAt?: Date | string | null },
): boolean {
  return !!user.managerEmailChangedAt;
}
