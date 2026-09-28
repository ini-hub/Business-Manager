-- Adds a real "main store" designation for a business, replacing the
-- cosmetic "Main Store" name that had no backing data (server/routes/
-- business.routes.ts createDefaultStore). Onboarding now gates on this
-- flag instead of "any store exists".

ALTER TABLE stores ADD COLUMN IF NOT EXISTS is_main boolean NOT NULL DEFAULT false;

-- Backfill: mark each business's oldest store as main so existing
-- businesses aren't left without one.
UPDATE stores s SET is_main = true
WHERE s.is_main = false
  AND s.id = (
    SELECT id FROM stores s2 WHERE s2.business_id = s.business_id ORDER BY s2.created_at ASC LIMIT 1
  );

-- At most one main store per business - guards against two rows both
-- claiming it (see BusinessRepository.setMainStore, which flips the old
-- main off before flipping the new one on to satisfy this atomically).
CREATE UNIQUE INDEX IF NOT EXISTS uq_stores_single_main_per_business
  ON stores (business_id) WHERE is_main = true;
