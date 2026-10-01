-- Migration: Performance indexes for critical queries

-- Bookings: Index for reminder service queries (scheduled_at + status filter)
CREATE INDEX IF NOT EXISTS "idx_bookings_reminder_with_status"
  ON "bookings" ("scheduled_at", "status")
  WHERE "reminder_sent_at" IS NULL AND "is_deleted" = false;

-- Bookings: Index for store-based queries
CREATE INDEX IF NOT EXISTS "idx_bookings_store_status"
  ON "bookings" ("store_id", "status")
  WHERE "is_deleted" = false;

-- Bookings: Index for customer-based queries
CREATE INDEX IF NOT EXISTS "idx_bookings_customer_id"
  ON "bookings" ("customer_id")
  WHERE "is_deleted" = false;

-- Promotions: Index for store queries
CREATE INDEX IF NOT EXISTS "idx_promotions_store_id"
  ON "promotions" ("store_id")
  WHERE "is_deleted" = false;

-- Inventory: Index for store queries (used in sales checkouts)
CREATE INDEX IF NOT EXISTS "idx_inventory_store_id"
  ON "inventory" ("store_id")
  WHERE "is_deleted" = false;

-- Payroll entries: Index for period queries
CREATE INDEX IF NOT EXISTS "idx_payroll_entries_period_staff"
  ON "payroll_entries" ("period_id", "staff_id");

-- Payroll deductions: Index for period and staff queries
CREATE INDEX IF NOT EXISTS "idx_payroll_deductions_period_staff"
  ON "payroll_deductions" ("period_id", "staff_id");
