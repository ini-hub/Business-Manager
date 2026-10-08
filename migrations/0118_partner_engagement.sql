-- Partner transfers, round two: opt-in sharing of items with partners, why a shortfall happened,
-- email invitations to join as a partner, and a once-a-month statement log. Idempotent.

-- A supplier lists the items partners may request. Off by default; nothing is visible until chosen.
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS shared_with_partners boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_inventory_shared_with_partners ON inventory (store_id) WHERE shared_with_partners;

-- Recorded by the receiver at receipt, for the lines that came up short.
ALTER TABLE partner_transfer_items ADD COLUMN IF NOT EXISTS shortfall_reason text; -- missing | damaged
ALTER TABLE partner_transfer_items ADD COLUMN IF NOT EXISTS shortfall_note text;

CREATE TABLE IF NOT EXISTS partner_invites (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id varchar NOT NULL REFERENCES organisations(id),
  email text NOT NULL,
  invited_by_user_id varchar REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  -- Set when a business owned by this address becomes the inviter's partner.
  accepted_at timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_invites_org_email ON partner_invites (org_id, lower(email));

-- One statement per business per month, however many instances run the job.
CREATE TABLE IF NOT EXISTS partner_statement_log (
  org_id varchar NOT NULL REFERENCES organisations(id),
  period text NOT NULL, -- YYYY-MM
  sent_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, period)
);
