-- 0042_salary_advance_payroll_deduction.sql
--
-- Links salary advances to Payroll, the same way 0036 linked the Borrow Book.
--
-- Until now a salary advance's recovery was two disconnected manual steps: a
-- manager typed a free-text 'advance_recovery' deduction with no link back to
-- the advance, and separately called POST /advances/:id/recover to flip
-- salary_advances.is_recovered -- nothing enforced the two ever agreed, or
-- that both happened at all. An advance could be marked recovered with no
-- deduction ever taken, or deducted with the advance never marked recovered.
--
-- These columns turn a payroll deduction into a first-class recovery of a
-- specific advance, proposed and settled by SalaryAdvanceDeductionService the
-- same way StaffCreditDeductionService already does for shop credit.

-- The advance this deduction recovers. NULL for an ordinary/manual
-- 'advance_recovery' line (an advance predating this feature, or one tracked
-- outside salary_advances) -- those stay free-text and hand-deletable exactly
-- as before.
ALTER TABLE "payroll_deductions"
  ADD COLUMN IF NOT EXISTS "salary_advance_id" varchar REFERENCES "salary_advances"("id");

-- Stamped when the period is marked paid and the advance is actually
-- recovered. Its presence is the idempotency guard that stops a retried
-- mark-paid from recovering the same advance twice -- the same role
-- payroll_deductions.repayment_id plays for staff_credit, just without a
-- second ledger row to point to (an advance has no repayments-table entry).
ALTER TABLE "payroll_deductions"
  ADD COLUMN IF NOT EXISTS "settled_at" timestamp;

-- One proposal row per advance per period -- makes the periodic re-sync an
-- idempotent upsert rather than a delete-and-recreate, same as the credit
-- entry index below it.
CREATE UNIQUE INDEX IF NOT EXISTS "payroll_deduction_period_advance_unique"
  ON "payroll_deductions" ("period_id", "salary_advance_id")
  WHERE "salary_advance_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_payroll_deductions_salary_advance"
  ON "payroll_deductions" ("salary_advance_id")
  WHERE "salary_advance_id" IS NOT NULL;

-- The sweep queries open advances by store + staff + status + is_recovered.
CREATE INDEX IF NOT EXISTS "idx_salary_advances_staff_status"
  ON "salary_advances" ("staff_id", "status", "is_recovered");

-- Persisted reason for the narrowed manual-override path on
-- POST /api/payroll/advances/:id/recover -- now only for an advance repaid or
-- written off outside payroll entirely (the normal path settles
-- automatically at mark-paid). Kept alongside the audit log the same way
-- credit_entries.write_off_reason is, so the reason survives independent of
-- audit-log retention.
ALTER TABLE "salary_advances"
  ADD COLUMN IF NOT EXISTS "manual_recovery_reason" text;
