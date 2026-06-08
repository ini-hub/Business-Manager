-- Add rate-limit columns to users table that were added to schema but never migrated
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "resend_attempts" integer NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "resend_window_start" timestamp;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "supervisor_attempts" integer NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "supervisor_locked_until" timestamp;
