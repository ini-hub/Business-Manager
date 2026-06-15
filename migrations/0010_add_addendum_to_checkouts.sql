ALTER TABLE checkouts
  ADD COLUMN IF NOT EXISTS is_addendum boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS addendum_reason text;
