-- Per-business data masking for non-owner/manager roles.
--
-- mask_contact_roles: role keys (req.user.role: "staff" or a custom role's lower-cased
-- name) that see customer / vendor / colleague contact details masked.
-- mask_figures_roles: role keys that see sensitive figures (revenue, profit, cost
-- prices, balances, debts) masked.
-- Both default to empty, so nothing is masked until the owner opts in. Owner and
-- manager are never masked regardless of these lists.
--
-- Idempotent, with a check that RAISEs if the columns did not land (see 0057).

ALTER TABLE organisations ADD COLUMN IF NOT EXISTS mask_contact_roles text[] NOT NULL DEFAULT '{}';
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS mask_figures_roles text[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF (
    SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'organisations'
      AND column_name IN ('mask_contact_roles', 'mask_figures_roles')
  ) <> 2 THEN
    RAISE EXCEPTION '0128: organisations.mask_contact_roles / mask_figures_roles were not added';
  END IF;
END $$;
