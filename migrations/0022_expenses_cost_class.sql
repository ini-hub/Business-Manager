-- 0022_expenses_cost_class.sql
--
-- Gives every expense a cost CLASS, and with it a single, declared door into the
-- Profit & Loss statement.
--
-- Until now the P&L read only "general" expenses — those with no inventory_id and
-- no expense_linked_items row. Linking an expense to an item therefore deleted it
-- from the income statement entirely. That was a workaround for a double-counting
-- fear, and it traded a small error for a total one: measured against live data,
-- 1,007 of 1,012 naira of non-payroll expenses in the active store never reached
-- the statement.
--
-- The replacement rule is that a cost's door is decided by what the cost IS, never
-- by what it is linked to:
--     overhead       -> Operating Expenses
--     direct_supply  -> Direct Supplies & Consumables
-- Linking becomes pure attribution: it decides which item a cost is reported
-- against, never whether it is counted.

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS cost_class TEXT NOT NULL DEFAULT 'overhead';

-- Marks rows this migration reclassified, so the backfill is auditable and can be
-- reversed without guessing. Drop it in a later release once the numbers are
-- confirmed against the pre-migration statements.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS backfilled_cost_class BOOLEAN NOT NULL DEFAULT false;

-- An expense linked to an item was, by construction, a consumable or other
-- item-specific cost — those are exactly the rows the old "general" filter dropped.
-- Everything else stays an overhead, which is the column default.
--
-- THIS CHANGES HISTORICAL REPORTS. Costs that were invisible become visible, so
-- operating profit falls for every period containing a linked expense. Run this
-- against a snapshot and diff twelve months before shipping it.
UPDATE expenses e
   SET cost_class = 'direct_supply',
       backfilled_cost_class = true
 WHERE e.cost_class = 'overhead'
   AND (
        e.inventory_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM expense_linked_items eli WHERE eli.expense_id = e.id)
   );

CREATE INDEX IF NOT EXISTS idx_expenses_store_costclass ON expenses (store_id, cost_class);
