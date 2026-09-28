import { storage } from "../storage";
import { splitNormalizedPhone, normalizePhoneForStorage } from "@shared/phone-utils";
import { splitFullName } from "@shared/name-utils";
import { hrPersonalProfileService } from "./HrPersonalProfileService";

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
 * Call after a staffer edits their own name (Settings → Profile), confirms
 * an email change, or confirms a phone change. Mirrors onto every staff row
 * this account is linked to, not just one — the same person can be staff at
 * more than one store. `phone` is the canonical users.phone form (dial code
 * + local number, no separator - see normalizePhoneForStorage); this splits
 * it back into staff.mobileNumber/staff.countryCode's stored shape rather
 * than writing the combined string into mobileNumber verbatim.
 */
export async function syncUserIdentityToLinkedStaff(
  userId: string,
  fields: { name?: string; email?: string; phone?: string },
): Promise<void> {
  if (fields.name === undefined && fields.email === undefined && fields.phone === undefined) return;

  // users.name is still a single field, so this is the one remaining spot
  // that has to guess a first/last split (see shared/name-utils.ts) - every
  // other creation/edit path (staff-form.tsx, the HR "complete profile"
  // fields) now collects first/last directly. storage.updateStaff
  // recomputes staff.name from these, so passing `name` too would be
  // redundant.
  const staffFields: { firstName?: string; lastName?: string; email?: string; mobileNumber?: string; countryCode?: string } = {};
  if (fields.name !== undefined) {
    const { firstName, lastName } = splitFullName(fields.name);
    staffFields.firstName = firstName;
    staffFields.lastName = lastName;
  }
  if (fields.email !== undefined) staffFields.email = fields.email;
  if (fields.phone !== undefined) {
    const split = splitNormalizedPhone(fields.phone);
    if (split) {
      staffFields.mobileNumber = split.localNumber;
      staffFields.countryCode = split.countryCode;
    } else {
      console.error(`[IdentitySync] could not split phone "${fields.phone}" into a dial code for user ${userId} - skipping mobile sync.`);
    }
  }
  if (Object.keys(staffFields).length === 0) return;

  let linkedStaff;
  try {
    linkedStaff = await storage.getAllStaffByUserId(userId);
  } catch (err) {
    console.error(`[IdentitySync] failed to look up staff rows linked to user ${userId}:`, err);
    return;
  }
  for (const staffRow of linkedStaff) {
    try {
      await storage.updateStaff(staffRow.id, staffFields);
    } catch (err) {
      // Most likely staff_email_unique/staff_store_mobile_unique (storeId,
      // email/mobileNumber) already taken by a different staff row at the
      // same store - a real, if rare, edge case. Best-effort means we skip
      // that one row rather than fail the account holder's own
      // profile/email/phone update over it.
      console.error(`[IdentitySync] failed to mirror user ${userId}'s ${Object.keys(staffFields).join("/")} onto staff ${staffRow.id}:`, err);
    }
  }
}

/**
 * `staff.firstName`/`lastName`/`email`/`mobileNumber` (collected once,
 * compulsory, at staff creation) and the HR "complete profile" personal
 * fields first_name/last_name/work_email/mobile_number (freely editable
 * afterwards, see server/lib/hrDefaults.ts) are a second identity pair that
 * could silently drift the same way staff/users could - these two functions
 * mirror changes across THAT link, same best-effort shape as the pair above.
 * Both sides now store first/last name separately, so this direction is
 * lossless - no splitting or joining a combined name, unlike the users.name
 * pair above.
 *
 * Call syncHrPersonalFieldsToStaff after HrPersonalProfileService.upsertValues
 * saves any of those fields (already wired in there). `mobileNumber` is the
 * canonical dial-code+digits string the HR "phone" fieldType stores (see
 * shared/phone-utils.ts normalizePhoneForStorage) - this splits it back into
 * staff.mobileNumber/countryCode's stored shape.
 */
export async function syncHrPersonalFieldsToStaff(
  staffId: string,
  fields: { firstName?: string; lastName?: string; email?: string; mobileNumber?: string },
): Promise<void> {
  if (!fields.firstName && !fields.lastName && !fields.email && !fields.mobileNumber) return;

  const staffFields: { firstName?: string; lastName?: string; email?: string; mobileNumber?: string; countryCode?: string } = {};
  if (fields.firstName) staffFields.firstName = fields.firstName;
  if (fields.lastName) staffFields.lastName = fields.lastName;
  if (fields.email) staffFields.email = fields.email;
  if (fields.mobileNumber) {
    const split = splitNormalizedPhone(fields.mobileNumber);
    if (split) {
      staffFields.mobileNumber = split.localNumber;
      staffFields.countryCode = split.countryCode;
    } else {
      console.error(`[IdentitySync] could not split HR profile mobile number "${fields.mobileNumber}" for staff ${staffId} - skipping mobile sync.`);
    }
  }
  if (Object.keys(staffFields).length === 0) return;

  try {
    await storage.updateStaff(staffId, staffFields);
  } catch (err) {
    // Most likely staff_email_unique/staff_store_mobile_unique already taken
    // - best-effort means the HR profile save this ran after still succeeds.
    console.error(`[IdentitySync] failed to mirror HR profile ${Object.keys(staffFields).join("/")} onto staff ${staffId}:`, err);
  }
}

/**
 * Call after staff.firstName/lastName/email/mobileNumber changes - at
 * creation (seeds the HR profile's personal fields with what was just
 * collected, so "complete profile" never starts from a blank slate that
 * could diverge on day one) and on every later PATCH /api/staff/:id edit.
 * Lossless in this direction - both sides store first/last name separately,
 * so there's no splitting/guessing (contrast syncUserIdentityToLinkedStaff,
 * which still has to split a single users.name).
 */
export async function syncStaffToHrPersonalFields(
  staffId: string,
  fields: { firstName?: string; lastName?: string; email?: string; mobileNumber?: string; countryCode?: string },
  updatedByUserId: string | undefined,
): Promise<void> {
  if (fields.firstName === undefined && fields.lastName === undefined && fields.email === undefined && fields.mobileNumber === undefined) return;

  try {
    const businessId = await hrPersonalProfileService.getBusinessIdForStaff(staffId);
    if (!businessId) return;

    const values: Record<string, string | null> = {};
    if (fields.firstName !== undefined) values.first_name = fields.firstName || null;
    if (fields.lastName !== undefined) values.last_name = fields.lastName || null;
    if (fields.email !== undefined) values.work_email = fields.email || null;
    if (fields.mobileNumber !== undefined && fields.countryCode !== undefined) {
      values.mobile_number = fields.mobileNumber ? normalizePhoneForStorage(fields.mobileNumber, fields.countryCode) : null;
    }
    if (Object.keys(values).length === 0) return;

    await hrPersonalProfileService.setValuesByFieldKey({ staffId, businessId, section: "personal", updatedByUserId, values });
  } catch (err) {
    console.error(`[IdentitySync] failed to mirror staff ${staffId}'s name/email/mobile onto HR profile fields:`, err);
  }
}
