-- 0044_salary_advance_disbursement_and_restore.sql
--
-- Two more gaps in the salary-advance recovery feature (0042/0043), found in
-- a follow-up audit and closed together since both extend the same tables.

-- ── Restore a mistaken manual recovery ──────────────────────────────────────
-- Doubles as the existence check for "was this manually recovered" (a
-- payroll-settled recovery never sets it) and the anchor for
-- canRestoreManualRecovery's same-month restriction, mirroring
-- credit_entries' write-off/restore pair.
ALTER TABLE "salary_advances"
  ADD COLUMN IF NOT EXISTS "manual_recovered_at" timestamp;

-- ── Book the advance disbursement ───────────────────────────────────────────
--
-- Until now, handing a staff member a salary advance had no accounting entry
-- anywhere: expenses got no row, payroll_postings' own cash_out only ever
-- reflected what was disbursed AT SETTLEMENT, and deduction:advance_recovery
-- reduces that settlement cash_out for money that, as far as the books were
-- concerned, never left in the first place. Every consumer of getCashOut
-- therefore understated total cash paid to staff by however much of an
-- advance payroll went on to recover.
--
-- A plain new `expenses` row was considered and rejected: wage_expense
-- already recognises the FULL gross pay at settlement regardless of any
-- advance taken during the period, so a separate expense row for the
-- disbursement would double-count that cost in the P&L — the same failure
-- mode 0040_retire_payroll_mirror_expense.sql already tore out once (a
-- synthetic expenses row five report call-sites had to remember to skip).
--
-- Instead this extends payroll_postings — the existing "one door into the
-- P&L" — with a pre-period posting. period_id has to become nullable because
-- an advance is disbursed before any payroll period exists to attach it to.

ALTER TABLE "payroll_postings"
  ALTER COLUMN "period_id" DROP NOT NULL;

-- The advance this posting records. Its presence is what lets
-- storage.deleteSalaryAdvance / a rejection find and reverse exactly this
-- posting, rather than guessing by staffId + date + amount. Also the
-- idempotency guard: at most one disbursement posting per advance.
ALTER TABLE "payroll_postings"
  ADD COLUMN IF NOT EXISTS "salary_advance_id" varchar REFERENCES "salary_advances"("id");

CREATE UNIQUE INDEX IF NOT EXISTS "payroll_posting_salary_advance_unique"
  ON "payroll_postings" ("salary_advance_id");
