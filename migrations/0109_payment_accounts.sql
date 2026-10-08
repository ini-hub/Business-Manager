-- Store payment accounts, receipt-level payment legs, loss-sale flags.
-- Idempotent.

CREATE TABLE IF NOT EXISTS store_payment_accounts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id varchar NOT NULL REFERENCES stores(id),
  label text NOT NULL,
  kind text NOT NULL DEFAULT 'bank',
  bank_name text,
  account_number text,
  account_name text,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_store_payment_accounts_store ON store_payment_accounts (store_id);
CREATE UNIQUE INDEX IF NOT EXISTS store_payment_accounts_one_default ON store_payment_accounts (store_id) WHERE is_default AND is_active;

CREATE TABLE IF NOT EXISTS sale_payment_legs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id varchar NOT NULL REFERENCES stores(id),
  receipt_number text NOT NULL,
  checkout_id varchar REFERENCES checkouts(id),
  method text NOT NULL,
  amount numeric(12,2) NOT NULL,
  payment_account_id varchar REFERENCES store_payment_accounts(id),
  account_label text,
  account_detail text,
  confirmation_status text NOT NULL DEFAULT 'not_required',
  confirmation_source text,
  confirmed_at timestamp,
  confirmed_by_user_id varchar REFERENCES users(id),
  reference text,
  sender_name text,
  cash_tendered numeric(12,2),
  change_given numeric(12,2),
  change_owed numeric(12,2),
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sale_payment_legs_receipt ON sale_payment_legs (store_id, receipt_number);
CREATE INDEX IF NOT EXISTS idx_sale_payment_legs_account ON sale_payment_legs (store_id, payment_account_id, created_at);

-- Sold below cost (custom price under unit cost, incl. consumables recipe cost). Authoritative, set server-side.
ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS loss_amount numeric(12,2) NOT NULL DEFAULT 0;
