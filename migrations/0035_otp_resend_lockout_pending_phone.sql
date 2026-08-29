-- 0035_otp_resend_lockout_pending_phone.sql
--
-- Closes three auth gaps found while auditing OTP/lockout behavior:
--
-- 1. resend-otp / forgot-password / resend-verification-otp had no
--    server-side rate limit at all (the client-side 60s countdown was
--    cosmetic only). Add a DB-backed cooldown counter for the shared
--    otp_code/otp_expiry pair, same pattern as resend_attempts /
--    resend_window_start already used for activation codes.
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_resend_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_resend_window_start TIMESTAMP;

-- 2. Login lockout was a flat 30 minutes every time, with no escalation
--    for repeat offenders. Track how many times in a row this account has
--    been locked out so the lockout duration can grow.
ALTER TABLE users ADD COLUMN IF NOT EXISTS lockout_count INTEGER NOT NULL DEFAULT 0;

-- 3. Email-change had no resend cooldown, and phone changes had no OTP
--    verification step at all (a new number was swapped in directly).
--    Add a resend cooldown to the existing pending-email columns, and a
--    full pending-phone staging group that mirrors pending-email.
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email_otp_resend_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email_otp_resend_window_start TIMESTAMP;

ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_phone_otp TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_phone_otp_expiry TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_phone_otp_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_phone_otp_resend_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_phone_otp_resend_window_start TIMESTAMP;
