import { storage } from "../storage";

/**
 * `staff` (the per-store HR record) and `users` (the platform login
 * identity) are deliberately separate tables joined by `staff.userId` — a
 * staff row can exist before anyone has a login, and one login can be linked
 * to staff rows at more than one store/business. But once that link exists,
 * name/email edits on either side used to write straight to that one table
 * and never tell the other, so the two could silently drift apart (a manager
 * renaming a staff record, or a staffer self-servicing their own login
 * email, each left the other side stale forever). These two functions are
 * the single place that mirrors a change across the link.
 *
 * Both are best-effort: a failure here is logged and swallowed rather than
 * thrown, so a missing link, an edge-case constraint collision, or any other
 * failure on the mirrored write never breaks the caller's own update.
 */

/** Call after a manager edits staff.name via PATCH /api/staff/:id. */
export async function syncStaffNameToLinkedUser(
  staffId: string,
  userId: string | null | undefined,
  name: string,
): Promise<void> {
  if (!userId) return;
  try {
    await storage.updateUser(userId, { name });
  } catch (err) {
    console.error(`[IdentitySync] failed to mirror staff ${staffId}'s name onto user ${userId}:`, err);
  }
}

/**
 * Call after a staffer edits their own name (Settings → Profile) or confirms
 * an email change. Mirrors onto every staff row this account is linked to,
 * not just one — the same person can be staff at more than one store.
 */
export async function syncUserIdentityToLinkedStaff(
  userId: string,
  fields: { name?: string; email?: string },
): Promise<void> {
  if (fields.name === undefined && fields.email === undefined) return;
  let linkedStaff;
  try {
    linkedStaff = await storage.getAllStaffByUserId(userId);
  } catch (err) {
    console.error(`[IdentitySync] failed to look up staff rows linked to user ${userId}:`, err);
    return;
  }
  for (const staffRow of linkedStaff) {
    try {
      await storage.updateStaff(staffRow.id, fields);
    } catch (err) {
      // Most likely staff_email_unique (storeId, email) already taken by a
      // different staff row at the same store - a real, if rare, edge case.
      // Best-effort means we skip that one row rather than fail the
      // account holder's own profile/email update over it.
      console.error(`[IdentitySync] failed to mirror user ${userId}'s ${Object.keys(fields).join("/")} onto staff ${staffRow.id}:`, err);
    }
  }
}
