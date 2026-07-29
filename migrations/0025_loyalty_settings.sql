-- 0025_loyalty_settings.sql
--
-- Makes the loyalty points program configurable per store instead of the
-- hardcoded "1 point per ₦100 spent, 1 point = ₦10 on redemption" that every
-- store previously shared. Defaults match those existing hardcoded values
-- exactly, so no store's behavior changes until it explicitly reconfigures.

ALTER TABLE settings ADD COLUMN IF NOT EXISTS loyalty_points_per_currency INTEGER NOT NULL DEFAULT 100;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS loyalty_point_value NUMERIC(12, 2) NOT NULL DEFAULT 10;
