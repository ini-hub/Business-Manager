-- 0040_retire_payroll_mirror_expense.sql
--
-- Retires the payroll mirror expense row, now that payroll_postings carries the
-- same information properly.
--
-- The mirror row was payroll's only bridge into the books: at mark-paid the
-- module wrote a synthetic row into `expenses` under a system category called
-- 'Payroll'. Every consumer of that table then had to know the row was not a
-- real expense and skip it by string-matching the category NAME — five separate
-- sites, three of them in generated SQL. It also forced payroll to be reported
-- as paid in cash whatever it was actually paid by, because the writer never
-- set a payment method and the column defaults to 'cash'.
--
-- Code has already stopped writing new ones. This retires the historical rows.
--
-- ORDERING MATTERS. Run this only AFTER:
--   1. 0037 and 0039 are applied, and
--   2. `npm run payroll:postings:backfill` has posted every paid period, and
--   3. `npm run payroll:postings:parity` passes.
-- Retiring the rows before the ledger is populated would leave payroll missing
-- from the cash-flow statement for every historical period.
--
-- Soft delete, not DELETE: `expenses.is_deleted` already exists and every
-- reporting query filters on it, so this is reversible by flipping the flag
-- back. These rows are auto-generated duplicates of ledger data, not anything a
-- user typed, but that is not a reason to make the change irreversible.

UPDATE "expenses" e
   SET "is_deleted" = true,
       "deleted_at" = COALESCE(e."deleted_at", now())
  FROM "expense_categories" ec
 WHERE ec."id" = e."category_id"
   AND ec."is_system" = true
   AND ec."name" = 'Payroll'
   AND e."is_auto_generated" = true
   AND e."is_deleted" = false
   -- Only where the ledger has actually taken over for that store, so a
   -- half-migrated database cannot lose payroll from its cash statement.
   AND EXISTS (
     SELECT 1 FROM "payroll_postings" pp
      WHERE pp."store_id" = e."store_id"
        AND pp."account" = 'cash_out'
   );
