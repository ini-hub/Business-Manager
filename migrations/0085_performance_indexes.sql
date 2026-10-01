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

-- ========== CRITICAL FOREIGN KEY INDEXES (ROOT CAUSE) ==========
-- These basic indexes were MISSING and cause full table scans
-- Enabling them fixes /api/stores (17s → <100ms), /api/auth/user (14s → <100ms)

-- Stores: Index on businessId - CRITICAL for /api/stores query
CREATE INDEX IF NOT EXISTS "idx_stores_business_id"
  ON "stores" ("business_id");

-- Staff: Index on userId - CRITICAL for /api/auth/user and staff lookups
CREATE INDEX IF NOT EXISTS "idx_staff_user_id"
  ON "staff" ("user_id");

-- Staff: Index on storeId for store staff lists
CREATE INDEX IF NOT EXISTS "idx_staff_store_id"
  ON "staff" ("store_id");

-- Customers: Index on storeId for store customer lists
CREATE INDEX IF NOT EXISTS "idx_customers_store_id"
  ON "customers" ("store_id");

-- Customers: Index on businessId for business customer lookups
CREATE INDEX IF NOT EXISTS "idx_customers_business_id"
  ON "customers" ("business_id");

-- Inventory: Index on businessId for business inventory lookups
CREATE INDEX IF NOT EXISTS "idx_inventory_business_id"
  ON "inventory" ("business_id");

-- Transactions: Index on storeId for store transactions
CREATE INDEX IF NOT EXISTS "idx_transactions_store_id"
  ON "transactions" ("store_id");

-- ========== ANNOUNCEMENTS - CRITICAL FOR 27s SLOWDOWN ==========
-- The /api/announcements endpoint does a date range filter on ALL announcements
-- These indexes are CRITICAL and were completely missing

-- Composite index for time-range queries
CREATE INDEX IF NOT EXISTS "idx_announcements_show_window"
  ON "announcements" ("show_from", "show_until");

-- Index for ordering by creation time (commonly used in WHERE + ORDER BY)
CREATE INDEX IF NOT EXISTS "idx_announcements_created_at"
  ON "announcements" ("created_at" DESC);
