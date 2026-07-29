-- 0021_supply_inventory_type.sql
--
-- Introduces the third inventory type, 'supply': back-bar consumables (shampoo,
-- creams, nail supplies) that a salon buys continuously and uses up delivering
-- services.
--
-- The point of making these real inventory rather than a new concept is that the
-- purchasing path already does the right thing. Restock and PO receipt write only
-- inventory.cost_price, inventory_restock_events, and profit_loss.quantity_remaining
-- — no expense row, nothing touching the P&L. So a supply purchase capitalises and
-- is released as cost only when a service consumes it. Double counting is prevented
-- by construction rather than by convention.
--
-- Schema only. No data is moved and no existing row changes meaning: until a row
-- with type='supply' exists, every code path behaves exactly as it did before.

-- ---------------------------------------------------------------------------
-- Name uniqueness must be scoped by type
-- ---------------------------------------------------------------------------
-- A salon that RETAILS "Shampoo" also uses "Shampoo" back-bar, and those are two
-- different items with different costs and different stock. UNIQUE(store_id, name)
-- makes that impossible to express.
--
-- Widening a unique key can never fail on existing data: the old key is strictly
-- narrower, so any set of rows that satisfied it also satisfies this one.

ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_store_name_unique;
DO $$ BEGIN
  ALTER TABLE inventory
    ADD CONSTRAINT inventory_store_type_name_unique UNIQUE (store_id, type, name);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_store_name_unique;
DO $$ BEGIN
  ALTER TABLE products
    ADD CONSTRAINT products_store_type_name_unique UNIQUE (store_id, type, name);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;

-- A supply has no selling price and a service need not carry a fixed cost once its
-- consumables are modelled as a recipe. Defaults let both be omitted on insert;
-- the route layer enforces the per-type rules.
ALTER TABLE inventory ALTER COLUMN cost_price SET DEFAULT 0;
ALTER TABLE inventory ALTER COLUMN selling_price SET DEFAULT 0;

-- ---------------------------------------------------------------------------
-- service_consumables — the recipe
-- ---------------------------------------------------------------------------
-- Grain is the inventory VARIANT, not the product group: "Wash — long hair" and
-- "Wash — short hair" burn different amounts of product, which is the entire point
-- of tracking this at all.
--
-- The consuming side is named inventory_id rather than service_inventory_id because
-- a retail product can consume supplies too (packaging, gift wrap). v1 restricts it
-- to services in the service layer; renaming a column later is not free.
--
-- quantity_per_unit >= 0.01 because inventory.quantity is numeric(12,2). A recipe of
-- 0.005 would round to zero on the stock column, so stock would never move while
-- cost accrued forever — an invisible drift. Supplies should be stocked in their
-- smallest practical unit (ml, g, ea) rather than bottles.
CREATE TABLE IF NOT EXISTS service_consumables (
  id                  VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id            VARCHAR NOT NULL REFERENCES stores(id),
  inventory_id        VARCHAR NOT NULL REFERENCES inventory(id),
  supply_inventory_id VARCHAR NOT NULL REFERENCES inventory(id),
  quantity_per_unit   NUMERIC(12, 4) NOT NULL,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE service_consumables
    ADD CONSTRAINT service_consumables_item_supply_unique UNIQUE (inventory_id, supply_inventory_id);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE service_consumables
    ADD CONSTRAINT service_consumables_min_qty CHECK (quantity_per_unit >= 0.01);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE service_consumables
    ADD CONSTRAINT service_consumables_no_self CHECK (inventory_id <> supply_inventory_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_service_consumables_item
  ON service_consumables (inventory_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_service_consumables_supply
  ON service_consumables (supply_inventory_id);

-- ---------------------------------------------------------------------------
-- order_consumables — the consumption ledger
-- ---------------------------------------------------------------------------
-- Written at checkout, one row per (sale line, supply).
--
-- unit_cost_at_sale is a SNAPSHOT, and that is not optional. Every other COGS path
-- in this codebase multiplies a historical quantity by the item's CURRENT
-- inventory.cost_price. Supply costs move on every weighted-average restock, so
-- without a snapshot, restocking shampoo would silently rewrite last quarter's
-- service costs.
--
-- The table carries no lifecycle state. Whether a row counts is derived by joining
-- orders -> checkouts and filtering payment_status='completed' AND is_voided=false,
-- exactly as getProfitLossSummary already derives revenue. That is what makes void
-- need no ledger write and return need no consumables code at all.
--
-- No date column: the addendum path writes its checkout with the ORIGINAL sale date,
-- so the join-derived date lands in the right period on its own. created_at is for
-- audit only and must never be filtered on.
CREATE TABLE IF NOT EXISTS order_consumables (
  id                  VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id            VARCHAR NOT NULL REFERENCES stores(id),
  order_id            VARCHAR NOT NULL REFERENCES orders(id),
  supply_inventory_id VARCHAR NOT NULL REFERENCES inventory(id),
  quantity_used       NUMERIC(12, 4) NOT NULL,
  unit_cost_at_sale   NUMERIC(12, 2) NOT NULL,
  total_cost          NUMERIC(12, 2) NOT NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE order_consumables
    ADD CONSTRAINT order_consumables_order_supply_unique UNIQUE (order_id, supply_inventory_id);
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_order_consumables_order  ON order_consumables (order_id);
CREATE INDEX IF NOT EXISTS idx_order_consumables_supply ON order_consumables (supply_inventory_id);
CREATE INDEX IF NOT EXISTS idx_order_consumables_store  ON order_consumables (store_id);
