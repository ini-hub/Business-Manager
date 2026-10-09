// node-postgres attaches unique-violation details to thrown error objects
// as .code ("23505") and .constraint (e.g. "users_email_unique"). Prefer
// these over substring-matching the human-readable error message - message
// text doesn't say which column collided, so signup/staff-invite were
// previously reporting phone collisions with a hardcoded "email"/"business
// name" message regardless of which field actually violated its constraint.
//
// drizzle-orm (0.45) wraps a failed query in a DrizzleQueryError whose message is the SQL and whose `.cause` is
// the driver's error, so the code lives one (or more) levels down. Every check here follows the cause chain;
// reading `error.code` directly misses the wrapped form and lets a duplicate surface as a 500.
const PG_UNIQUE_VIOLATION = "23505";

type PgErrorLike = { code: string; constraint?: string };

/** The driver error behind `error`, looking through any wrapper's `.cause` chain. */
export function findPgError(error: unknown): PgErrorLike | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth++) {
    if (typeof (current as any).code === "string") return current as PgErrorLike;
    current = (current as any).cause;
  }
  return undefined;
}

export function isUniqueViolation(error: unknown): error is { code: string; constraint?: string } {
  return findPgError(error)?.code === PG_UNIQUE_VIOLATION;
}

export function getViolatedConstraint(error: unknown): string | undefined {
  return isUniqueViolation(error) ? findPgError(error)?.constraint : undefined;
}
