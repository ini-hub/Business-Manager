-- 0036_staff_credit_payroll_deduction.sql
--
-- Links the Borrow Book to Payroll.
--
-- Staff members are often also customers. When they take a service they
-- usually don't pay at the counter -- the understanding is that it comes out
-- of their salary -- so the sale is checked out as Credit (Owe) against their
-- linked customer profile. Until now nothing recovered that debt: the credit
-- entry sat in the Borrow Book forever, and a manager who wanted to deduct it
-- had to retype the amount as a free-text payroll deduction with no link back
-- to the debt and no settlement of the credit entry.
--
-- These columns turn a payroll deduction into a first-class recovery of a
-- specific credit entry.

-- The debt this deduction recovers. NULL for ordinary deductions (tax,
-- penalty, carry_forward, ...), set for type = 'staff_credit'.
ALTER TABLE "payroll_deductions"
  ADD COLUMN IF NOT EXISTS "credit_entry_id" varchar REFERENCES "credit_entries"("id");

-- The repayment row written when the period was marked paid. NULL until
-- settlement; its presence is the idempotency guard that stops a retried
-- mark-paid from recovering the same debt twice.
ALTER TABLE "payroll_deductions"
  ADD COLUMN IF NOT EXISTS "repayment_id" varchar REFERENCES "repayments"("id");

-- A manager excluding a line (disputed charge, staff wants to settle in cash).
-- This has to be a flag rather than a DELETE: triggerAutoRecalculate re-runs
-- the payroll calculation on every sale, so a hard-deleted proposal would be
-- re-inserted within minutes and the manager's decision silently undone.
ALTER TABLE "payroll_deductions"
  ADD COLUMN IF NOT EXISTS "is_waived" boolean NOT NULL DEFAULT false;

ALTER TABLE "payroll_deductions"
  ADD COLUMN IF NOT EXISTS "waived_by_user_id" varchar REFERENCES "users"("id");

ALTER TABLE "payroll_deductions"
  ADD COLUMN IF NOT EXISTS "waived_at" timestamp;

-- One proposal row per debt per period. This is what makes the periodic
-- re-sync an idempotent upsert rather than a delete-and-recreate.
CREATE UNIQUE INDEX IF NOT EXISTS "payroll_deduction_period_credit_unique"
  ON "payroll_deductions" ("period_id", "credit_entry_id")
  WHERE "credit_entry_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_payroll_deductions_period_staff"
  ON "payroll_deductions" ("period_id", "staff_id");

-- customers.staff_id was added bare in 0008_staff_customer_link.sql (no index,
-- no FK). The payroll sweep now queries it once per period, per store.
CREATE INDEX IF NOT EXISTS "idx_customers_staff_id"
  ON "customers" ("staff_id")
  WHERE "staff_id" IS NOT NULL;

-- The sweep filters open debt by customer + status + outstanding balance.
CREATE INDEX IF NOT EXISTS "idx_credit_entries_customer_status"
  ON "credit_entries" ("customer_id", "status");
