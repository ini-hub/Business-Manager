-- Makes audit_logs genuinely append-only at the database level, with one narrow
-- exception: a PII redaction that touches only actor_name/actor_email/ip/user_agent/
-- previous_values/new_values/details, and must set redacted_at + redacted_by_user_id.
-- Every other column (action, resource, resource_id, timestamp, status, user_id,
-- changed_fields, channel, batch_id, business_id, store_id, ...) can never change once
-- written, and rows can never be deleted. Run this only after 0014 has landed and any
-- historical backfill (0016) is complete, since the trigger would otherwise block the
-- backfill's UPDATE of business_id/store_id.

CREATE OR REPLACE FUNCTION audit_logs_prevent_mutation() RETURNS trigger AS $$
DECLARE
  allowed_keys text[] := ARRAY[
    'actor_name', 'actor_email', 'ip', 'user_agent',
    'previous_values', 'new_values', 'details', 'error_message',
    'redacted_at', 'redacted_by_user_id'
  ];
  changed_keys text[];
  k text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_logs is append-only: DELETE is not permitted (id=%)', OLD.id;
  END IF;

  -- TG_OP = 'UPDATE': permitted only as a redaction
  IF NEW.redacted_at IS NULL OR NEW.redacted_by_user_id IS NULL THEN
    RAISE EXCEPTION 'audit_logs is append-only: UPDATE is only permitted as a redaction (must set redacted_at and redacted_by_user_id) (id=%)', OLD.id;
  END IF;

  SELECT array_agg(n.key) INTO changed_keys
  FROM jsonb_each(to_jsonb(NEW)) n
  JOIN jsonb_each(to_jsonb(OLD)) o USING (key)
  WHERE n.value IS DISTINCT FROM o.value;

  IF changed_keys IS NOT NULL THEN
    FOREACH k IN ARRAY changed_keys LOOP
      IF NOT (k = ANY(allowed_keys)) THEN
        RAISE EXCEPTION 'audit_logs is append-only: column "%" cannot be modified, even during redaction (id=%)', k, OLD.id;
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_prevent_mutation_trigger ON audit_logs;
CREATE TRIGGER audit_logs_prevent_mutation_trigger
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_prevent_mutation();
