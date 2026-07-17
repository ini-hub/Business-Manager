-- Phase 1 foundation for auditability redesign: extend audit_logs with actor/scope/
-- diff/origin/correlation columns, add audit_log_batches for bulk/import correlation,
-- and add the salary_advances approval workflow columns. All additive/nullable —
-- no existing data or call site breaks until later phases opt in.

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS actor_role text,
  ADD COLUMN IF NOT EXISTS actor_name text,
  ADD COLUMN IF NOT EXISTS actor_email text,
  ADD COLUMN IF NOT EXISTS business_id text,
  ADD COLUMN IF NOT EXISTS store_id text,
  ADD COLUMN IF NOT EXISTS previous_values jsonb,
  ADD COLUMN IF NOT EXISTS new_values jsonb,
  ADD COLUMN IF NOT EXISTS changed_fields text[],
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS batch_id varchar,
  ADD COLUMN IF NOT EXISTS redacted_at timestamp,
  ADD COLUMN IF NOT EXISTS redacted_by_user_id text;

CREATE INDEX IF NOT EXISTS audit_logs_business_id_idx ON audit_logs (business_id);
CREATE INDEX IF NOT EXISTS audit_logs_store_id_idx ON audit_logs (store_id);
CREATE INDEX IF NOT EXISTS audit_logs_batch_id_idx ON audit_logs (batch_id);
CREATE INDEX IF NOT EXISTS audit_logs_resource_resource_id_idx ON audit_logs (resource, resource_id);

CREATE TABLE IF NOT EXISTS audit_log_batches (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id text NOT NULL,
  initiated_by text,
  kind text NOT NULL,
  label text,
  total_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  details jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  completed_at timestamp
);

CREATE INDEX IF NOT EXISTS audit_log_batches_business_id_idx ON audit_log_batches (business_id);

ALTER TABLE salary_advances
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approved_by_user_id varchar REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamp,
  ADD COLUMN IF NOT EXISTS rejection_reason text;
