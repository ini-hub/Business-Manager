// node-postgres attaches unique-violation details to thrown error objects
// as .code ("23505") and .constraint (e.g. "users_email_unique"). Prefer
// these over substring-matching the human-readable error message - message
// text doesn't say which column collided, so signup/staff-invite were
// previously reporting phone collisions with a hardcoded "email"/"business
// name" message regardless of which field actually violated its constraint.
export const PG_UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(error: unknown): error is { code: string; constraint?: string } {
  return typeof error === "object" && error !== null && (error as any).code === PG_UNIQUE_VIOLATION;
}

export function getViolatedConstraint(error: unknown): string | undefined {
  return isUniqueViolation(error) ? (error as any).constraint : undefined;
}
