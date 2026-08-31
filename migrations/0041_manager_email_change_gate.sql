-- 0041_manager_email_change_gate.sql
--
-- Staff invitations are now recoverable: PATCH /api/staff/:id re-points
-- users.email when a manager fixes a typo'd address. For an account that has
-- already been activated that is a direct overwrite, which opens a takeover
-- path -- repoint an active user's email to an address you control, then
-- POST /api/auth/forgot-password at it. This column closes that hole.
--
-- Set on the manager overwrite; cleared when the staff member proves control
-- of the new address via POST /api/auth/verify-manager-email-change. While
-- non-null: forgot-password / resend-otp / reset-password refuse (with the
-- SAME enumeration-safe generic message), and verify-signup-email refuses
-- because it mints a session, which is exactly the capability an attacking
-- manager would be after.
--
-- A timestamp rather than a boolean: it doubles as the audit trail for when
-- the overwrite happened, and lets a post-verification reset cool-off be added
-- later without a second migration.
--
-- Deliberately NOT gated on is_email_verified: many legacy rows have it false
-- and would lose password reset.
ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_email_changed_at TIMESTAMP;

-- Partial index, for ops queries over currently-gated accounts only.
CREATE INDEX IF NOT EXISTS idx_users_manager_email_change_pending
  ON users (manager_email_changed_at)
  WHERE manager_email_changed_at IS NOT NULL;
