-- 0026_supply_settlement.sql
--
-- Makes a shared supply costable when nobody knows the per-service rate.
--
-- The recipe shipped in 0021 asks an unanswerable question — "how many ml of
-- shampoo per wash?" Nobody measures that. The resolution is that the recipe is
-- NOT the source of truth: it is an estimate that spreads a known cost across the
-- period and attributes it to services. What is actually known is what was bought
-- (exact, from restock) and what is left (countable). Consumed = opening +
-- purchases - closing, and the periodic stock count settles the difference.
--
-- This migration lays the groundwork: a per-supply costing mode, and enough
-- numeric precision for a rate small enough to be realistic.

-- ---------------------------------------------------------------------------
-- Costing mode, per supply
-- ---------------------------------------------------------------------------
-- 'expensed' — buying it posts the cost straight to Direct Supplies. Stock is
--              still tracked so low-stock alerts fire; it is simply not metered
--              per service. Zero ongoing effort, and the honest default for a
--              cheap consumable nobody wants to count.
-- 'metered'  — purchases capitalise into stock and cost is released as services
--              consume it, with a periodic count settling the difference.
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS costing_mode TEXT NOT NULL DEFAULT 'expensed';

-- Preserve behaviour for supplies already being metered. A supply that carries a
-- recipe must stay 'metered' or its purchases would hit the P&L on top of the
-- recipe releasing them — the double count this whole design exists to prevent.
--
-- A supply with NO recipe is deliberately left 'expensed'. Under the old model its
-- cost capitalised on purchase and was never released, so it sat in the asset
-- forever; moving it to 'expensed' fixes that going forward rather than changing
-- anything already reported.
UPDATE inventory i
   SET costing_mode = 'metered'
 WHERE i.type = 'supply'
   AND EXISTS (
     SELECT 1 FROM service_consumables sc
      WHERE sc.supply_inventory_id = i.id AND sc.is_active
   );

CREATE INDEX IF NOT EXISTS idx_inventory_store_costing_mode
  ON inventory (store_id, costing_mode) WHERE type = 'supply';

-- ---------------------------------------------------------------------------
-- Precision
-- ---------------------------------------------------------------------------
-- A bottle covering 300 services needs a rate of 0.0033. At numeric(12,2) that
-- rounds to 0.00 on deduction: stock never moves, and 100% of the cost drifts
-- until the next count catches it. Widening removes the drift at source.
--
-- Safe widening — precision 14 scale 4 holds the same 10 integer digits as
-- precision 12 scale 2, so no existing value can fail to fit.
ALTER TABLE inventory
  ALTER COLUMN quantity TYPE numeric(14, 4) USING quantity::numeric(14, 4);

ALTER TABLE stock_audit_items
  ALTER COLUMN system_quantity   TYPE numeric(14, 4) USING system_quantity::numeric(14, 4),
  ALTER COLUMN physical_quantity TYPE numeric(14, 4) USING physical_quantity::numeric(14, 4),
  ALTER COLUMN variance          TYPE numeric(14, 4) USING variance::numeric(14, 4);

-- The 0.01 floor existed only because stock could not represent anything smaller.
-- With 4dp stock it can, so lower it to the scale limit of quantity_per_unit.
DO $$ BEGIN
  ALTER TABLE service_consumables DROP CONSTRAINT IF EXISTS service_consumables_min_qty;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE service_consumables
    ADD CONSTRAINT service_consumables_min_qty CHECK (quantity_per_unit >= 0.0001);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
