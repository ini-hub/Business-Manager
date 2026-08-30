-- 0034_users_phone_uniqueness_and_pending_email.sql
--
-- Add the users.phone unique constraint that shared/schema.ts has always
-- declared (`.unique()`) but was never actually applied to the database -
-- confirmed via direct inspection that only users_email_unique exists today.
-- No existing duplicate phone values (checked), safe to add directly.
--
-- Guarded rather than a bare ADD CONSTRAINT: on any database where a
-- `drizzle-kit push` created this constraint out-of-band (it is declared
-- `.unique()` in shared/schema/auth.ts), the bare form fails with
-- "relation users_phone_unique already exists" and, because this file has
-- no _migrations row there, it fails again on every single boot.
-- to_regclass covers both cases - a unique constraint always has a backing
-- index of the same name, so a non-NULL result means either already exists.
DO $$
BEGIN
  IF to_regclass('users_phone_unique') IS NULL THEN
    ALTER TABLE users ADD CONSTRAINT users_phone_unique UNIQUE (phone);
  END IF;
END $$;

-- Staging area for the email-change flow: the new email sits in
-- pending_email until its own OTP is confirmed. Dedicated OTP columns
-- (not the existing otp_code/otp_expiry) because those are already "live"
-- for concurrent login/password-reset OTP flows on the same row - sharing
-- them would let an in-flight email-change OTP be invalidated by an
-- unrelated login attempt, or let a login OTP be replayed to confirm an
-- email change.
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email_otp TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email_otp_expiry TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email_otp_attempts INTEGER NOT NULL DEFAULT 0;
