-- 0028_admin_password_reset.sql
--
-- Adds a "forgot password" flow for super admins. Mirrors the OTP fields
-- already used on the regular users table (otp_code / otp_expiry /
-- otp_attempts) so admins can self-recover without a support ticket.

ALTER TABLE super_admins ADD COLUMN IF NOT EXISTS otp_code TEXT;
ALTER TABLE super_admins ADD COLUMN IF NOT EXISTS otp_expiry TIMESTAMP;
ALTER TABLE super_admins ADD COLUMN IF NOT EXISTS otp_attempts INTEGER NOT NULL DEFAULT 0;
