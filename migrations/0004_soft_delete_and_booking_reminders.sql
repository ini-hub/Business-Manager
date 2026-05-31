-- Migration: soft delete columns + booking reminder timestamp

-- inventory
ALTER TABLE "inventory" ADD COLUMN IF NOT EXISTS "is_deleted" boolean NOT NULL DEFAULT false;
ALTER TABLE "inventory" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;

-- bookings
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "reminder_sent_at" timestamp;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "is_deleted" boolean NOT NULL DEFAULT false;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;

-- promotions
ALTER TABLE "promotions" ADD COLUMN IF NOT EXISTS "is_deleted" boolean NOT NULL DEFAULT false;
ALTER TABLE "promotions" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;

-- custom_roles
ALTER TABLE "custom_roles" ADD COLUMN IF NOT EXISTS "is_deleted" boolean NOT NULL DEFAULT false;
ALTER TABLE "custom_roles" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;

-- expenses
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "is_deleted" boolean NOT NULL DEFAULT false;
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;

-- Indexes for soft-delete filter performance
CREATE INDEX IF NOT EXISTS "idx_inventory_not_deleted" ON "inventory" ("store_id") WHERE "is_deleted" = false;
CREATE INDEX IF NOT EXISTS "idx_bookings_not_deleted" ON "bookings" ("store_id") WHERE "is_deleted" = false;
CREATE INDEX IF NOT EXISTS "idx_expenses_not_deleted" ON "expenses" ("store_id") WHERE "is_deleted" = false;
CREATE INDEX IF NOT EXISTS "idx_bookings_reminder" ON "bookings" ("scheduled_at") WHERE "reminder_sent_at" IS NULL AND "is_deleted" = false;
