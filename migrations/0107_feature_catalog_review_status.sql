-- feature_catalog.review_status: 'pending_review' marks a row the registry sync created that no admin has
-- published yet. It is created inactive (is_active = false), so it is hidden and unpurchasable until a
-- super admin prices it and publishes it from the Feature Catalog. Every row that exists today is
-- already live, so the default is 'published'. Idempotent.

ALTER TABLE feature_catalog ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'published';
