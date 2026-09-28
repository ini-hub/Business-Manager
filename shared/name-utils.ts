/**
 * Splits a single full-name string into first/last name - the one place
 * this guess is made, for the handful of spots that still only have a
 * single name field to start from (a users row, e.g. an owner signing up
 * before any staff row exists - see server/routes/business.routes.ts
 * addOwnerAsStaff - or a login-name edit arriving via
 * server/services/IdentitySync.ts's syncUserIdentityToLinkedStaff).
 * Lossy for 3+-word names (everything after the first word becomes "last
 * name") - accepted because there is no correct answer without asking the
 * person, and every other creation/edit path (staff-form.tsx, the HR
 * "complete profile" fields) now collects first/last directly instead of
 * a single field, so this only ever runs once per person at the edges.
 */
export function splitFullName(fullName: string | null | undefined): { firstName: string; lastName: string } {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : "",
  };
}

/** The inverse composition, matching StaffRepository's composeFullName rule. */
export function joinFullName(firstName: string | null | undefined, lastName: string | null | undefined): string {
  return [firstName, lastName].filter((p) => p && p.trim()).join(" ").trim();
}
