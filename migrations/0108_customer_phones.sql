-- customer_phones: every number a customer uses. customers.mobile_number stays and mirrors the primary row.
-- Not unique per store: the create flow lets a user knowingly keep two profiles with one number.
-- Backfills each existing customer's number as their primary. Idempotent.

CREATE TABLE IF NOT EXISTS customer_phones (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id varchar NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  store_id varchar NOT NULL REFERENCES stores(id),
  number text NOT NULL,
  label text,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT customer_phones_customer_number_unique UNIQUE (customer_id, number)
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_phones_one_primary ON customer_phones (customer_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS idx_customer_phones_store_number ON customer_phones (store_id, number);

INSERT INTO customer_phones (customer_id, store_id, number, is_primary)
SELECT id, store_id, mobile_number, true
FROM customers
WHERE mobile_number IS NOT NULL AND mobile_number <> ''
ON CONFLICT DO NOTHING;
