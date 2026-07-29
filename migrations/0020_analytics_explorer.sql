-- 0020_analytics_explorer.sql
--
-- Saved views and dashboards for the Analytics Explorer, plus the index set the
-- non-sales cubes need.
--
-- Tenanted by business_id, not store_id: a saved view routinely spans several
-- stores, which is much of the point of it.

CREATE TABLE IF NOT EXISTS analytics_views (
  id            VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   VARCHAR NOT NULL REFERENCES organisations(id),
  owner_user_id VARCHAR NOT NULL REFERENCES users(id),
  name          TEXT NOT NULL,
  description   TEXT,
  spec          JSONB NOT NULL,
  viz_type      TEXT NOT NULL DEFAULT 'line',
  visibility    TEXT NOT NULL DEFAULT 'private',
  store_ids     JSONB NOT NULL DEFAULT '[]'::jsonb,
  spec_version  INTEGER NOT NULL DEFAULT 1,
  is_archived   BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_views_business ON analytics_views (business_id);
CREATE INDEX IF NOT EXISTS idx_analytics_views_owner    ON analytics_views (owner_user_id);

DO $$ BEGIN
  ALTER TABLE analytics_views
    ADD CONSTRAINT analytics_views_owner_name_unique UNIQUE (owner_user_id, name);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS analytics_dashboards (
  id            VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   VARCHAR NOT NULL REFERENCES organisations(id),
  owner_user_id VARCHAR NOT NULL REFERENCES users(id),
  name          TEXT NOT NULL,
  description   TEXT,
  visibility    TEXT NOT NULL DEFAULT 'private',
  is_default    BOOLEAN NOT NULL DEFAULT false,
  is_archived   BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_dashboards_business ON analytics_dashboards (business_id);

DO $$ BEGIN
  ALTER TABLE analytics_dashboards
    ADD CONSTRAINT analytics_dashboards_owner_name_unique UNIQUE (owner_user_id, name);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS analytics_dashboard_tiles (
  id                   VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id         VARCHAR NOT NULL REFERENCES analytics_dashboards(id) ON DELETE CASCADE,
  view_id              VARCHAR REFERENCES analytics_views(id) ON DELETE SET NULL,
  spec                 JSONB,
  title_override       TEXT,
  grid_x               INTEGER NOT NULL DEFAULT 0,
  grid_y               INTEGER NOT NULL DEFAULT 0,
  grid_w               INTEGER NOT NULL DEFAULT 6,
  grid_h               INTEGER NOT NULL DEFAULT 4,
  overrides_date_range BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_tiles_dashboard ON analytics_dashboard_tiles (dashboard_id);

-- A tile points at a saved view OR carries its own inline spec, never both and
-- never neither. Without this a tile can silently render nothing.
DO $$ BEGIN
  ALTER TABLE analytics_dashboard_tiles
    ADD CONSTRAINT analytics_tiles_view_or_spec
    CHECK ((view_id IS NULL) <> (spec IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Index set for the non-sales cubes. Each of these is a (store_id, <time>) range
-- scan on every Explorer query; none of them existed.
--   attendance_records had only (staff_id, date) and the (store_id, staff_id, date)
--   unique — neither serves a store-wide date range.
--   inventory_restock_events and return_logs had no indexes at all.
CREATE INDEX IF NOT EXISTS idx_attendance_store_date        ON attendance_records (store_id, date);
CREATE INDEX IF NOT EXISTS idx_credit_entries_store_created ON credit_entries (store_id, created_at);
CREATE INDEX IF NOT EXISTS idx_restock_events_store_at      ON inventory_restock_events (store_id, restocked_at);
CREATE INDEX IF NOT EXISTS idx_return_logs_store_created    ON return_logs (store_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payroll_periods_store_start  ON payroll_periods (store_id, start_date);
CREATE INDEX IF NOT EXISTS idx_customers_store_created      ON customers (store_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bookings_store_scheduled     ON bookings (store_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_expenses_category            ON expenses (category_id);
