-- Per-instance hourly request telemetry for the super-admin System Health page, so the page can be
-- filtered over 6h/24h/7d/30d and survive restarts. latency_hist holds counts per fixed latency bucket
-- (bounds in server/lib/healthMetrics.ts) so percentiles can be merged across instances. Idempotent.

CREATE TABLE IF NOT EXISTS health_metrics_hourly (
  hour timestamp NOT NULL,
  instance_id text NOT NULL,
  requests integer NOT NULL DEFAULT 0,
  server_errors integer NOT NULL DEFAULT 0,
  latency_hist jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (hour, instance_id)
);
