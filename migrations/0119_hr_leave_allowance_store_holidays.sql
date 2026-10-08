-- Per-store observed public holidays. A business picks which holidays each
-- store observes; staff only ever see their own store's list. Idempotent.
CREATE TABLE IF NOT EXISTS hr_store_holidays (
  id                 VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id           VARCHAR NOT NULL REFERENCES stores(id),
  name               TEXT NOT NULL,
  holiday_date       DATE NOT NULL,
  recurs_yearly      BOOLEAN NOT NULL DEFAULT false,
  created_by_user_id VARCHAR REFERENCES users(id),
  created_at         TIMESTAMP NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_store_holidays_store_date_name
  ON hr_store_holidays (store_id, holiday_date, lower(name));
CREATE INDEX IF NOT EXISTS idx_hr_store_holidays_store ON hr_store_holidays (store_id, holiday_date);
