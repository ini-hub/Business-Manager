-- Migration: add products table and new inventory columns
-- All statements are idempotent (IF NOT EXISTS / IF EXISTS guards)

-- ── Products table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "products" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id" varchar NOT NULL REFERENCES "stores"("id"),
  "name" text NOT NULL,
  "type" text NOT NULL,
  "category" text,
  "brand" text,
  "description" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "is_deleted" boolean NOT NULL DEFAULT false,
  "deleted_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "products_store_name_unique" UNIQUE("store_id", "name")
);

CREATE INDEX IF NOT EXISTS "idx_products_store" ON "products"("store_id") WHERE "is_deleted" = false;

-- ── New inventory columns ──────────────────────────────────────────────────

-- Product grouping link
ALTER TABLE "inventory" ADD COLUMN IF NOT EXISTS "product_id" varchar REFERENCES "products"("id");

-- Variant attributes stored as JSONB
ALTER TABLE "inventory" ADD COLUMN IF NOT EXISTS "variant_dimensions" jsonb;

-- SKU / barcode
ALTER TABLE "inventory" ADD COLUMN IF NOT EXISTS "sku" text;
ALTER TABLE "inventory" ADD COLUMN IF NOT EXISTS "barcode" text;

-- Bundle support
ALTER TABLE "inventory" ADD COLUMN IF NOT EXISTS "is_bundle" boolean NOT NULL DEFAULT false;
ALTER TABLE "inventory" ADD COLUMN IF NOT EXISTS "parent_inventory_id" varchar;

-- Fractional selling (e.g. sell 0.5 kg)
ALTER TABLE "inventory" ADD COLUMN IF NOT EXISTS "allow_fractional" boolean NOT NULL DEFAULT false;
ALTER TABLE "inventory" ADD COLUMN IF NOT EXISTS "unit" text;

-- Per-item low-stock threshold (null = use global setting)
ALTER TABLE "inventory" ADD COLUMN IF NOT EXISTS "reorder_point" numeric(12, 2);

-- Per-item commission split override
ALTER TABLE "inventory" ADD COLUMN IF NOT EXISTS "commission_split_override" boolean NOT NULL DEFAULT false;
ALTER TABLE "inventory" ADD COLUMN IF NOT EXISTS "commission_split_business_share" integer NOT NULL DEFAULT 80;
ALTER TABLE "inventory" ADD COLUMN IF NOT EXISTS "commission_split_staff_share" integer NOT NULL DEFAULT 20;

-- Upgrade quantity from integer to numeric to support fractional values (e.g. 1.5 kg)
-- Only alters the type if the column is still integer; no-op if already numeric.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory'
      AND column_name = 'quantity'
      AND data_type = 'integer'
  ) THEN
    ALTER TABLE inventory ALTER COLUMN quantity TYPE numeric(12, 2) USING quantity::numeric(12, 2);
  END IF;
END$$;

-- Upgrade cost_price / selling_price from real to numeric for precision
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory'
      AND column_name = 'cost_price'
      AND data_type = 'real'
  ) THEN
    ALTER TABLE inventory ALTER COLUMN cost_price TYPE numeric(12, 2) USING cost_price::numeric(12, 2);
  END IF;
END$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory'
      AND column_name = 'selling_price'
      AND data_type = 'real'
  ) THEN
    ALTER TABLE inventory ALTER COLUMN selling_price TYPE numeric(12, 2) USING selling_price::numeric(12, 2);
  END IF;
END$$;

-- Unique constraint on (store_id, sku) — only non-null skus
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inventory_store_sku_unique'
  ) THEN
    ALTER TABLE "inventory" ADD CONSTRAINT "inventory_store_sku_unique" UNIQUE("store_id", "sku");
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "idx_inventory_store_qty" ON "inventory"("store_id", "quantity");
