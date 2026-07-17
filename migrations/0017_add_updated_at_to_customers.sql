ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();
