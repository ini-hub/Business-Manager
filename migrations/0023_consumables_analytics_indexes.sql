-- 0023_consumables_analytics_indexes.sql
--
-- Index set for the Explorer's `consumables` cube, mirroring what 0020 added for
-- the other non-sales cubes. Every Explorer query on this cube is a join from
-- order_consumables out to orders/checkouts, then a store + date range scan.
--
-- idx_order_consumables_* already exist from 0021; this adds the one the cube's
-- own grouping needs (the consuming item) and the expenses cost-class index that
-- 0022 declares, repeated here with IF NOT EXISTS so a partial 0022 cannot leave
-- it missing.

CREATE INDEX IF NOT EXISTS idx_orders_inventory       ON orders (inventory_id);
CREATE INDEX IF NOT EXISTS idx_checkouts_order        ON checkouts (order_id);
CREATE INDEX IF NOT EXISTS idx_expenses_store_costclass ON expenses (store_id, cost_class);
