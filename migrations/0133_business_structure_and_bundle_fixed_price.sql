-- Business structure (solo / with staff / multi-store) and per-bundle fixed price.
--
-- organisations.business_structure: asked at signup and workspace creation, so that when the trial
-- ends the checkout can preselect the bundle recommended for that kind of business. Nullable: every
-- existing business stays unset and keeps seeing today's checkout unchanged.
--
-- pricing_bundles.business_structure: which structure the bundle is the recommended one for. At most
-- one ACTIVE bundle per structure (enforced by the partial unique index below and by the admin API).
--
-- pricing_bundles.fixed_price_monthly / fixed_price_annual: an optional admin override of the sum of
-- the members' catalog prices while all members are held (see shared/bundles.ts priceSelection). Null
-- means "use discount_pct" for that billing cycle, so existing bundles are unaffected.
--
-- Idempotent.

ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "business_structure" text;
ALTER TABLE "pricing_bundles" ADD COLUMN IF NOT EXISTS "business_structure" text;
ALTER TABLE "pricing_bundles" ADD COLUMN IF NOT EXISTS "fixed_price_monthly" numeric(12,2);
ALTER TABLE "pricing_bundles" ADD COLUMN IF NOT EXISTS "fixed_price_annual" numeric(12,2);

CREATE UNIQUE INDEX IF NOT EXISTS "pricing_bundles_structure_active_unique"
  ON "pricing_bundles" ("business_structure")
  WHERE "business_structure" IS NOT NULL AND "is_active" = true;
