-- Returns previously refunded only the pre-discount, pre-tax line price
-- (orders.total_price / quantity), never reversing the tax or discount the
-- customer actually paid — the difference just vanished from the books with
-- no ledger entry anywhere. server/repositories/SalesRepository.ts#processReturn
-- now refunds against checkouts.total_charged (the true tax/discount-inclusive
-- amount) instead, and records the tax portion explicitly here.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_refunded numeric(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE return_logs ADD COLUMN IF NOT EXISTS tax_refund_amount numeric(12, 2) NOT NULL DEFAULT 0;
