-- Partner transfers can now be requested by the receiving business (kind = 'request').
-- A requester cannot see the supplier's inventory, so a requested line has no supplier item
-- until the supplier maps it when accepting. Idempotent.

ALTER TABLE partner_transfer_items ALTER COLUMN from_inventory_id DROP NOT NULL;
