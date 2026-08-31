-- 0037_payroll_postings.sql
--
-- Gives payroll a canonical record in the books.
--
-- Until now payroll cost had none: the P&L, the analytics cube and the
-- cash-flow statement each re-derived it from payroll_entries with a different
-- status predicate and a different date convention, so they disagreed about the
-- same payroll run. The bridge to the books was a mirror row in `expenses` that
-- five separate reader sites had to remember to skip by string-matching the
-- category name 'Payroll'.
--
-- The sharpest symptom: getPaidPayrollExpenses selects periods by an OVERLAP
-- test and then adds the whole period total, with no way to express a partial
-- month. A run from 31 Aug to 13 Sep was therefore reported in full in August
-- and again in full in September.
--
-- A paid period now posts immutable lines here, and consumers read those. Same
-- "one door into the P&L" invariant the Consumables module already runs on.

CREATE TABLE IF NOT EXISTS "payroll_postings" (
  "id"             varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "period_id"      varchar NOT NULL REFERENCES "payroll_periods"("id"),
  "store_id"       varchar NOT NULL REFERENCES "stores"("id"),

  -- 'wage_expense' | 'cash_out' | 'deduction:<type>' | 'carry_forward_deferred'
  "account"        text NOT NULL,

  -- ISO YYYY-MM-DD, text to match every other local-date column in this schema.
  -- wage_expense lines carry the last day of their slice of the period, so a
  -- straddling run lands partly in each month it was earned in; settlement
  -- lines carry the period end date.
  "effective_date" text NOT NULL,

  "amount"         numeric(12,2) NOT NULL,
  "created_at"     timestamp NOT NULL DEFAULT now()
);

-- The reporting read path: one store, one account, a date range.
CREATE INDEX IF NOT EXISTS "idx_payroll_postings_store_account_date"
  ON "payroll_postings" ("store_id", "account", "effective_date");

-- Postings are replaced wholesale per period on (re)post.
CREATE INDEX IF NOT EXISTS "idx_payroll_postings_period"
  ON "payroll_postings" ("period_id");
