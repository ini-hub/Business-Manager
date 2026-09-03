-- Track what Resend's own MTA did with a queued email, not just whether the
-- app's send request was accepted. EmailQueue.flush() logging
-- "[EmailQueue] Sent" only ever meant the Resend API returned 2xx - it says
-- nothing about the receiving mailbox, which is exactly the gap that let a
-- malformed Subject header (see server/sanitize.ts sanitizeHeaderValue) sit
-- invisible in logs while the message never arrived. The webhook at
-- server/routes/email-webhooks.routes.ts fills these in after the fact.
ALTER TABLE pending_emails ADD COLUMN IF NOT EXISTS provider_message_id text;
ALTER TABLE pending_emails ADD COLUMN IF NOT EXISTS delivery_status text;
ALTER TABLE pending_emails ADD COLUMN IF NOT EXISTS delivery_status_at timestamp;

CREATE INDEX IF NOT EXISTS idx_pending_emails_provider_message_id ON pending_emails(provider_message_id);
