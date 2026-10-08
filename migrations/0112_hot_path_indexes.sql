-- Indexes whose benefit was measured with scripts/perf-explain.ts (150k checkouts, 40 stores, rolled back):
--  * inventory_batches FIFO lookup, run once per cart line inside the checkout transaction: 256 -> 6 buffers.
--  * super_admin_audit_logs by action / newest first: 426 -> 26 buffers for the suspend_business feed.
--  * checkouts by created_at across all stores (admin metrics): 15ms -> 10ms and less I/O.
--  * attendance_records by store and date range without a staff filter: 85 -> 41 buffers.
-- Idempotent. Plain CREATE INDEX because the migration runner wraps each file in a transaction.

CREATE INDEX IF NOT EXISTS idx_inventory_batches_fifo ON inventory_batches (inventory_id, expiry_date, created_at) WHERE quantity > 0;
CREATE INDEX IF NOT EXISTS idx_sa_audit_logs_created ON super_admin_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sa_audit_logs_action_created ON super_admin_audit_logs (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkouts_created_live ON checkouts (created_at) WHERE is_voided = false;
CREATE INDEX IF NOT EXISTS idx_attendance_store_date ON attendance_records (store_id, date);
