-- Open-banking feed (Mono): linked bank accounts and the transactions pulled from them. Idempotent.

CREATE TABLE IF NOT EXISTS bank_connections (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id varchar NOT NULL REFERENCES stores(id),
  payment_account_id varchar NOT NULL REFERENCES store_payment_accounts(id),
  provider text NOT NULL DEFAULT 'mono',
  provider_account_id text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  last_synced_at timestamp,
  created_by_user_id varchar REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bank_connections_store ON bank_connections (store_id);
CREATE UNIQUE INDEX IF NOT EXISTS bank_connections_provider_account ON bank_connections (provider, provider_account_id);
CREATE UNIQUE INDEX IF NOT EXISTS bank_connections_one_live_per_account ON bank_connections (payment_account_id) WHERE status <> 'disconnected';

CREATE TABLE IF NOT EXISTS bank_transactions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id varchar NOT NULL REFERENCES bank_connections(id),
  store_id varchar NOT NULL REFERENCES stores(id),
  external_id text NOT NULL,
  direction text NOT NULL,
  amount numeric(12,2) NOT NULL,
  narration text,
  posted_at timestamp NOT NULL,
  matched_leg_id varchar REFERENCES sale_payment_legs(id),
  matched_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS bank_transactions_external ON bank_transactions (connection_id, external_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_store_posted ON bank_transactions (store_id, posted_at);
