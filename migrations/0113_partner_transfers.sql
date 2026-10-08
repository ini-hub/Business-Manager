-- Partner transfers: stock sent between *different* businesses that have connected as trusted partners.
-- Separate from stock_transfers (same-business). Obligations (money / goods back) live in their own
-- ledger and are not mixed into credit_entries or vendor_bills. Idempotent.

ALTER TABLE organisations ADD COLUMN IF NOT EXISTS partner_code text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_organisations_partner_code ON organisations (partner_code) WHERE partner_code IS NOT NULL;

ALTER TABLE stores ADD COLUMN IF NOT EXISTS accepts_partner_transfers boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS business_partnerships (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_org_id varchar NOT NULL REFERENCES organisations(id),
  addressee_org_id varchar NOT NULL REFERENCES organisations(id),
  -- pending | active | declined | revoked
  status text NOT NULL DEFAULT 'pending',
  requested_by_user_id varchar REFERENCES users(id),
  responded_by_user_id varchar REFERENCES users(id),
  responded_at timestamp,
  revoked_by_org_id varchar REFERENCES organisations(id),
  trade_credit_limit numeric(12,2),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT business_partnerships_distinct_orgs CHECK (requester_org_id <> addressee_org_id)
);
-- One row per unordered pair, whichever side asked first.
CREATE UNIQUE INDEX IF NOT EXISTS uq_business_partnerships_pair
  ON business_partnerships (LEAST(requester_org_id, addressee_org_id), GREATEST(requester_org_id, addressee_org_id));
CREATE INDEX IF NOT EXISTS idx_business_partnerships_addressee ON business_partnerships (addressee_org_id, status);

CREATE TABLE IF NOT EXISTS partner_transfers (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  partnership_id varchar NOT NULL REFERENCES business_partnerships(id),
  from_org_id varchar NOT NULL REFERENCES organisations(id),
  to_org_id varchar NOT NULL REFERENCES organisations(id),
  from_store_id varchar NOT NULL REFERENCES stores(id),
  to_store_id varchar NOT NULL REFERENCES stores(id),
  -- send: sender pushes stock. request: receiver asks, sender fulfils.
  kind text NOT NULL DEFAULT 'send',
  -- offered | accepted | shipped | received | disputed | closed | rejected | cancelled
  status text NOT NULL DEFAULT 'offered',
  -- none | payable | return_in_kind
  settlement_type text NOT NULL DEFAULT 'none',
  agreed_total numeric(12,2) NOT NULL DEFAULT 0,
  due_date timestamp,
  -- After receipt the sender may propose terms for a transfer sent with 'none'; the receiver must agree.
  proposed_settlement_type text,
  proposed_due_date timestamp,
  notes text,
  rejection_reason text,
  idempotency_key text,
  created_by_user_id varchar REFERENCES users(id),
  accepted_at timestamp,
  accepted_by_user_id varchar REFERENCES users(id),
  shipped_at timestamp,
  shipped_by_user_id varchar REFERENCES users(id),
  received_at timestamp,
  received_by_user_id varchar REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT partner_transfers_distinct_orgs CHECK (from_org_id <> to_org_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_transfers_idem ON partner_transfers (from_org_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_partner_transfers_from ON partner_transfers (from_store_id, status);
CREATE INDEX IF NOT EXISTS idx_partner_transfers_to ON partner_transfers (to_store_id, status);

CREATE TABLE IF NOT EXISTS partner_transfer_items (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id varchar NOT NULL REFERENCES partner_transfers(id) ON DELETE CASCADE,
  from_inventory_id varchar NOT NULL REFERENCES inventory(id),
  -- Snapshot: the partner never sees live inventory.
  name text NOT NULL,
  sku text,
  barcode text,
  unit text,
  quantity numeric(14,4) NOT NULL,
  unit_cost_snapshot numeric(12,2) NOT NULL DEFAULT 0,
  agreed_unit_price numeric(12,2),
  -- Receiver's mapping, set at accept.
  to_inventory_id varchar REFERENCES inventory(id),
  confirmed_quantity numeric(14,4),
  CONSTRAINT partner_transfer_items_qty_positive CHECK (quantity > 0)
);
CREATE INDEX IF NOT EXISTS idx_partner_transfer_items_transfer ON partner_transfer_items (transfer_id);

-- One obligation per transfer once a settlement type other than 'none' is agreed.
CREATE TABLE IF NOT EXISTS partner_obligations (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id varchar NOT NULL UNIQUE REFERENCES partner_transfers(id),
  creditor_org_id varchar NOT NULL REFERENCES organisations(id),
  debtor_org_id varchar NOT NULL REFERENCES organisations(id),
  kind text NOT NULL, -- money | goods
  amount_due numeric(12,2) NOT NULL DEFAULT 0,
  amount_settled numeric(12,2) NOT NULL DEFAULT 0,
  -- open | settled | waived
  status text NOT NULL DEFAULT 'open',
  due_date timestamp,
  last_reminded_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partner_obligations_creditor ON partner_obligations (creditor_org_id, status);
CREATE INDEX IF NOT EXISTS idx_partner_obligations_debtor ON partner_obligations (debtor_org_id, status);

CREATE TABLE IF NOT EXISTS partner_settlements (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id varchar NOT NULL REFERENCES partner_obligations(id),
  amount numeric(12,2) NOT NULL,
  method text, -- cash | transfer | pos | goods_return
  -- For goods_return: the reverse partner transfer that carried the goods back.
  return_transfer_id varchar REFERENCES partner_transfers(id),
  reference text,
  notes text,
  recorded_by_org_id varchar NOT NULL REFERENCES organisations(id),
  recorded_by_user_id varchar REFERENCES users(id),
  -- pending until the creditor confirms (or the creditor recorded it themselves)
  status text NOT NULL DEFAULT 'pending',
  confirmed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT partner_settlements_amount_positive CHECK (amount > 0)
);
CREATE INDEX IF NOT EXISTS idx_partner_settlements_obligation ON partner_settlements (obligation_id);

-- Every change to a transfer or its terms, readable by both parties.
CREATE TABLE IF NOT EXISTS partner_transfer_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id varchar NOT NULL REFERENCES partner_transfers(id) ON DELETE CASCADE,
  org_id varchar NOT NULL REFERENCES organisations(id),
  user_id varchar REFERENCES users(id),
  event text NOT NULL,
  detail jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partner_transfer_events_transfer ON partner_transfer_events (transfer_id, created_at);
