-- Converts audit_logs into a table partitioned by month (RANGE on `timestamp`).
-- Postgres cannot ALTER an existing table into a partitioned one in place, so this
-- rebuilds the table: rename old -> audit_logs_legacy, create the new partitioned
-- table with the same shape, copy all rows across, then leave the legacy table in
-- place (renamed, not dropped) for manual verification before it's dropped.
--
-- Run this AFTER 0014 (columns) and the business_id/store_id backfill script, and
-- BEFORE 0016 (append-only trigger) — the trigger must be installed on the final
-- partitioned table, not the pre-rebuild one.
--
-- Retention: partitions stay hot/queryable for 24 months; ops should detach and
-- archive (pg_dump the partition, then DETACH PARTITION + DROP) partitions older
-- than that on a monthly cadence. audit_log_batches is NOT partitioned — it grows
-- one row per bulk action, not per record, so volume stays low.
--
-- IMPORTANT: this is the highest-risk migration in this set (a full table rebuild).
-- Take a backup of audit_logs before running in any environment with real data, and
-- verify row counts match (`SELECT count(*) FROM audit_logs_legacy` vs
-- `SELECT count(*) FROM audit_logs`) before dropping audit_logs_legacy.

BEGIN;

ALTER TABLE audit_logs RENAME TO audit_logs_legacy;

CREATE TABLE audit_logs (
  id varchar NOT NULL DEFAULT gen_random_uuid(),
  "timestamp" timestamp NOT NULL DEFAULT now(),
  action text NOT NULL,
  resource text NOT NULL,
  resource_id text,
  user_id text,
  ip text,
  status text NOT NULL,
  error_message text,
  details jsonb,
  actor_role text,
  actor_name text,
  actor_email text,
  business_id text,
  store_id text,
  previous_values jsonb,
  new_values jsonb,
  changed_fields text[],
  user_agent text,
  channel text NOT NULL DEFAULT 'web',
  batch_id varchar,
  redacted_at timestamp,
  redacted_by_user_id text,
  PRIMARY KEY (id, "timestamp")
) PARTITION BY RANGE ("timestamp");

-- Catch-all partition: holds all pre-partitioning legacy rows (arbitrary past
-- timestamps) plus anything outside the explicit monthly partitions created below.
CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT;

-- Create explicit monthly partitions for the previous month, current month, and
-- next 3 months (relative to whenever this migration runs), so new writes land in
-- a dedicated partition rather than the default one from day one. A monthly job
-- (see audit_logs_create_next_partition() below) should keep creating future
-- partitions ahead of time; anything it misses safely falls into the default
-- partition instead of failing.
DO $$
DECLARE
  month_start date;
  month_end date;
  partition_name text;
  i int;
BEGIN
  FOR i IN -1..3 LOOP
    month_start := date_trunc('month', CURRENT_DATE) + (i || ' months')::interval;
    month_end := month_start + interval '1 month';
    partition_name := 'audit_logs_' || to_char(month_start, 'YYYY_MM');

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
      partition_name, month_start, month_end
    );
  END LOOP;
END $$;

INSERT INTO audit_logs
SELECT
  id, "timestamp", action, resource, resource_id, user_id, ip, status, error_message,
  details, actor_role, actor_name, actor_email, business_id, store_id, previous_values,
  new_values, changed_fields, user_agent, channel, batch_id, redacted_at, redacted_by_user_id
FROM audit_logs_legacy;

CREATE INDEX IF NOT EXISTS audit_logs_business_id_idx ON audit_logs (business_id);
CREATE INDEX IF NOT EXISTS audit_logs_store_id_idx ON audit_logs (store_id);
CREATE INDEX IF NOT EXISTS audit_logs_batch_id_idx ON audit_logs (batch_id);
CREATE INDEX IF NOT EXISTS audit_logs_resource_resource_id_idx ON audit_logs (resource, resource_id);

-- Reusable helper for the monthly partition-maintenance job/runbook: creates the
-- partition for `months_ahead` months from now if it doesn't already exist.
CREATE OR REPLACE FUNCTION audit_logs_create_next_partition(months_ahead int DEFAULT 1)
RETURNS void AS $$
DECLARE
  month_start date := date_trunc('month', CURRENT_DATE) + (months_ahead || ' months')::interval;
  month_end date := month_start + interval '1 month';
  partition_name text := 'audit_logs_' || to_char(month_start, 'YYYY_MM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
    partition_name, month_start, month_end
  );
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- Not dropped automatically — verify row counts match, then run manually:
--   DROP TABLE audit_logs_legacy;
