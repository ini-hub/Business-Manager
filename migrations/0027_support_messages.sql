-- 0027_support_messages.sql
--
-- The channel a locked-out owner uses to reach the platform when there's no
-- "pay to unlock" path available (suspended for a reason other than
-- non-payment - policy violation, fraud, etc). Surfaced to super admins via
-- GET /api/admin/support-messages.

CREATE TABLE IF NOT EXISTS support_messages (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id VARCHAR NOT NULL REFERENCES organisations(id),
  user_id VARCHAR NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  resolved_at TIMESTAMP,
  resolved_by_admin_id VARCHAR REFERENCES super_admins(id)
);

CREATE INDEX IF NOT EXISTS idx_support_messages_status ON support_messages(status);
CREATE INDEX IF NOT EXISTS idx_support_messages_org ON support_messages(organisation_id);
