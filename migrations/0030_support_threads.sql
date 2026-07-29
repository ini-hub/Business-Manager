-- 0030_support_threads.sql
--
-- Upgrades the one-shot support_messages feature (single message, single
-- resolve action) into a persistent, per-user, two-way conversation with
-- Support - "start a chat", "continue an existing chat if unresolved",
-- shared between the paywall lockout screen and a general Help & Support
-- page. No production data exists in support_messages yet (it shipped this
-- same development cycle), so it's dropped and replaced outright rather
-- than migrated forward.

DROP TABLE IF EXISTS support_messages;

CREATE TABLE IF NOT EXISTS support_threads (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id VARCHAR NOT NULL REFERENCES organisations(id),
  created_by_user_id VARCHAR NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  last_message_at TIMESTAMP NOT NULL DEFAULT now(),
  last_message_by_sender_type TEXT NOT NULL DEFAULT 'user',
  resolved_at TIMESTAMP,
  resolved_by_admin_id VARCHAR REFERENCES super_admins(id),
  user_last_read_at TIMESTAMP NOT NULL DEFAULT now(),
  admin_last_read_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_support_threads_status ON support_threads(status);
CREATE INDEX IF NOT EXISTS idx_support_threads_org ON support_threads(organisation_id);

-- One open thread per user, enforced at the DB layer: this is what makes
-- "continue if unresolved, else start new" a guarantee rather than app-level
-- best-effort.
CREATE UNIQUE INDEX IF NOT EXISTS uq_support_threads_one_open_per_user
  ON support_threads(created_by_user_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS support_thread_messages (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id VARCHAR NOT NULL REFERENCES support_threads(id),
  sender_type TEXT NOT NULL,
  sender_user_id VARCHAR REFERENCES users(id),
  sender_admin_id VARCHAR REFERENCES super_admins(id),
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_thread_messages_thread ON support_thread_messages(thread_id, created_at);

-- Lets a support-request email set replyTo to the tenant's own address, so a
-- human agent can just hit reply in their inbox.
ALTER TABLE pending_emails ADD COLUMN IF NOT EXISTS reply_to TEXT;
