-- 0043_salary_advance_partial_recovery.sql
--
-- Gives salary_advances a running balance, the same shape credit_entries
-- already has, so partial recovery is a real persisted state instead of an
-- inference from a generic, untyped payroll_entries.carry_forward_amount.
--
-- Before this migration, SalaryAdvanceDeductionService always proposed an
-- advance's full amount uncapped: if a period's pay couldn't cover it, the
-- excess spilled into the same generic shortfall mechanism tax/penalty use,
-- and the advance itself got marked fully isRecovered = true regardless —
-- correct in total-cash terms, but it meant the advance's own record could
-- never again say how much of THAT SPECIFIC advance was actually collected.
--
-- From this migration on, advance_recovery self-caps against available pay
-- (mirroring staff_credit's allocateAgainstPay) and never touches
-- carry_forward_amount. "unrecovered" / "partial" / "recovered" become
-- queryable states on the advance itself.

-- The advance's remaining claim. Starts equal to `amount`, decrements by
-- however much was actually collectible each time payroll settles it.
ALTER TABLE "salary_advances"
  ADD COLUMN IF NOT EXISTS "outstanding_balance" numeric(12, 2);

UPDATE "salary_advances" SET "outstanding_balance" = "amount"
  WHERE "outstanding_balance" IS NULL;

ALTER TABLE "salary_advances"
  ALTER COLUMN "outstanding_balance" SET NOT NULL;

-- Mirrors credit_entries.status in spirit, scoped to just the recovery
-- lifecycle (the existing `status` column already means something else on
-- this table — the pending/approved/rejected approval workflow). Kept
-- alongside `is_recovered` rather than replacing it: `is_recovered` stays the
-- single source every existing read (client included) already checks, and is
-- defined as exactly (recovery_status = 'recovered').
ALTER TABLE "salary_advances"
  ADD COLUMN IF NOT EXISTS "recovery_status" text NOT NULL DEFAULT 'unrecovered';

UPDATE "salary_advances" SET "recovery_status" =
  CASE WHEN "is_recovered" THEN 'recovered' ELSE 'unrecovered' END;
