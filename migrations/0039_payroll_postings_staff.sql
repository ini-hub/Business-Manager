-- 0039_payroll_postings_staff.sql
--
-- Adds the staff dimension to the payroll ledger.
--
-- 0037 posted one line per account per period. That is enough for the P&L and
-- the cash-flow statement, which only ever want a store-level total, but the
-- analytics Explorer's payroll cube exposes a `sales.staff` dimension — so
-- pointing it at store-level postings would have silently dropped the ability
-- to ask what any individual was paid.
--
-- Posting per staff also makes the ledger answer the question a manager
-- actually asks ("what did we pay Ada in August, and why was it less than her
-- gross?") without re-deriving anything from payroll_entries.
--
-- Nullable rather than NOT NULL: rows written by 0037 predate the column, and a
-- backfill re-post replaces them anyway.

ALTER TABLE "payroll_postings"
  ADD COLUMN IF NOT EXISTS "staff_id" varchar REFERENCES "staff"("id");

CREATE INDEX IF NOT EXISTS "idx_payroll_postings_staff"
  ON "payroll_postings" ("staff_id", "account", "effective_date")
  WHERE "staff_id" IS NOT NULL;
