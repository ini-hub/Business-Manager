-- Per-route request telemetry for the super-admin System Health "Slowest endpoints" table. One row per
-- (hour, server instance, route template). latency_hist uses the same fixed buckets as
-- health_metrics_hourly so percentiles merge across instances; total_ms and total_queries give the mean
-- time and the mean DB statements per request (the number that exposes N+1 handlers). Idempotent.

CREATE TABLE IF NOT EXISTS health_route_metrics_hourly (
  hour timestamp NOT NULL,
  instance_id text NOT NULL,
  route text NOT NULL,
  requests integer NOT NULL DEFAULT 0,
  server_errors integer NOT NULL DEFAULT 0,
  total_ms bigint NOT NULL DEFAULT 0,
  total_queries bigint NOT NULL DEFAULT 0,
  latency_hist jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (hour, instance_id, route)
);
