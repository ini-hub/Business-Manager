-- 0045_staff_mobile_uniqueness.sql
--
-- Adds the (store_id, mobile_number) unique constraint that
-- shared/schema/staff.ts now declares, mirroring staff_email_unique. A
-- staff row's mobileNumber becomes users.phone — a login credential,
-- globally unique on that table — the moment the staff member is invited
-- (see StaffInviteService.createInvitedUser), so two staff sharing a
-- number within the same store is a login conflict waiting to happen, not
-- just a display-distinguishing annoyance.
--
-- Guarded like 0034 (users_phone_unique): to_regclass covers both "never
-- created" and "already created out-of-band by a drizzle-kit push", so this
-- is safe to rerun.
--
-- Checked before writing this migration: no existing (store_id,
-- mobile_number) duplicates in the current database. If a target database
-- does have duplicates, this ALTER fails loudly (as it should) — resolve
-- the conflicting staff rows first rather than silently skipping the
-- constraint.
DO $$
BEGIN
  IF to_regclass('staff_store_mobile_unique') IS NULL THEN
    ALTER TABLE staff ADD CONSTRAINT staff_store_mobile_unique UNIQUE (store_id, mobile_number);
  END IF;
END $$;
