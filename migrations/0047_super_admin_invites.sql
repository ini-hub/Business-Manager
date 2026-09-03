-- 0047_super_admin_invites.sql
--
-- Super admin invite-email onboarding. Provisioning a super admin used to
-- require the provisioning admin to invent a temporary password and relay it
-- out-of-band, with the new admin's MFA secret then shown to whoever
-- happened to be looking (the provisioning admin's create-account response,
-- or the qrserver.com third-party image call at first login). This makes
-- super admin invites use the same activation-code pattern already proven
-- for staff (see users.activation_code* in shared/schema/auth.ts and
-- StaffInviteService): the provisioning admin supplies only name/email/role,
-- the invitee sets their own password and pairs their own TOTP secret, and
-- nobody else ever sees either.
--
-- super_admins.status gains a third value alongside the existing
-- 'active'/'suspended' (no DB check constraint - same free-text convention
-- as organisation_members.status, enforced in application code only):
--
--   'invited' - account created, invite email sent, onboarding not yet
--   complete. Set on POST /super-admins, cleared to 'active' only once the
--   invitee has both set a password and verified their first TOTP code
--   (see POST /super-admin/auth/verify-mfa-setup in server/routes-admin.ts).

ALTER TABLE super_admins
  ADD COLUMN IF NOT EXISTS activation_code TEXT,
  ADD COLUMN IF NOT EXISTS activation_code_expiry TIMESTAMP,
  ADD COLUMN IF NOT EXISTS activation_code_used BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resend_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resend_window_start TIMESTAMP;
