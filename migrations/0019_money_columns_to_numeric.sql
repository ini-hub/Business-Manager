-- 0019_money_columns_to_numeric.sql
--
-- Converts every money/rate column from `real` (float4) to the `numeric` type
-- shared/schema.ts has always declared for it.
--
-- These columns drifted because early `drizzle-kit push` runs created them as
-- real, and push will not narrow a column type on its own. float4 carries only
-- ~7 significant decimal digits, so whole naira stop being representable above
-- ~16.7M and SUM() accumulates lossily: a 153M store total was measured 15 naira
-- off. Existing reports hid this by reducing in JS (which widens float4 to
-- float64 first), so the error only surfaced once aggregation moved into SQL.
--
-- 74 columns across 26 tables. Verified before writing:
-- every one is declared numeric in the schema, and no stored value overflows its
-- declared precision. The USING cast goes through float4's shortest round-trip
-- representation, which is exactly what the JS code already reads, so no
-- currently-displayed figure changes.

ALTER TABLE booking_items
  ALTER COLUMN total_price TYPE numeric(12, 2) USING total_price::numeric(12, 2),
  ALTER COLUMN unit_price TYPE numeric(12, 2) USING unit_price::numeric(12, 2);

ALTER TABLE bookings
  ALTER COLUMN deposit_amount TYPE numeric(12, 2) USING deposit_amount::numeric(12, 2),
  ALTER COLUMN discount_amount TYPE numeric(12, 2) USING discount_amount::numeric(12, 2),
  ALTER COLUMN discount_percent TYPE numeric(5, 2) USING discount_percent::numeric(5, 2),
  ALTER COLUMN subtotal TYPE numeric(12, 2) USING subtotal::numeric(12, 2),
  ALTER COLUMN total_price TYPE numeric(12, 2) USING total_price::numeric(12, 2);

ALTER TABLE cash_drops
  ALTER COLUMN amount TYPE numeric(12, 2) USING amount::numeric(12, 2);

ALTER TABLE cash_register_sessions
  ALTER COLUMN actual_cash TYPE numeric(12, 2) USING actual_cash::numeric(12, 2),
  ALTER COLUMN difference TYPE numeric(12, 2) USING difference::numeric(12, 2),
  ALTER COLUMN expected_cash TYPE numeric(12, 2) USING expected_cash::numeric(12, 2),
  ALTER COLUMN opening_float TYPE numeric(12, 2) USING opening_float::numeric(12, 2);

ALTER TABLE checkouts
  ALTER COLUMN balance_collected_today TYPE numeric(12, 2) USING balance_collected_today::numeric(12, 2),
  ALTER COLUMN booking_deposit_amount TYPE numeric(12, 2) USING booking_deposit_amount::numeric(12, 2),
  ALTER COLUMN discount_amount TYPE numeric(12, 2) USING discount_amount::numeric(12, 2),
  ALTER COLUMN discount_percent TYPE numeric(5, 2) USING discount_percent::numeric(5, 2),
  ALTER COLUMN subtotal TYPE numeric(12, 2) USING subtotal::numeric(12, 2),
  ALTER COLUMN tax_total TYPE numeric(12, 2) USING tax_total::numeric(12, 2),
  ALTER COLUMN total_charged TYPE numeric(12, 2) USING total_charged::numeric(12, 2),
  ALTER COLUMN total_price TYPE numeric(12, 2) USING total_price::numeric(12, 2);

ALTER TABLE credit_entries
  ALTER COLUMN amount_owed TYPE numeric(12, 2) USING amount_owed::numeric(12, 2),
  ALTER COLUMN amount_paid_upfront TYPE numeric(12, 2) USING amount_paid_upfront::numeric(12, 2),
  ALTER COLUMN outstanding_balance TYPE numeric(12, 2) USING outstanding_balance::numeric(12, 2);

ALTER TABLE customers
  ALTER COLUMN store_credit_balance TYPE numeric(12, 2) USING store_credit_balance::numeric(12, 2);

ALTER TABLE expenses
  ALTER COLUMN amount TYPE numeric(12, 2) USING amount::numeric(12, 2);

ALTER TABLE inventory_restock_events
  ALTER COLUMN new_cost_price TYPE numeric(12, 2) USING new_cost_price::numeric(12, 2),
  ALTER COLUMN new_selling_price TYPE numeric(12, 2) USING new_selling_price::numeric(12, 2),
  ALTER COLUMN previous_cost_price TYPE numeric(12, 2) USING previous_cost_price::numeric(12, 2),
  ALTER COLUMN previous_selling_price TYPE numeric(12, 2) USING previous_selling_price::numeric(12, 2),
  ALTER COLUMN unit_cost TYPE numeric(12, 2) USING unit_cost::numeric(12, 2);

ALTER TABLE orders
  ALTER COLUMN refunded_amount TYPE numeric(12, 2) USING refunded_amount::numeric(12, 2),
  ALTER COLUMN tax_applied TYPE numeric(12, 2) USING tax_applied::numeric(12, 2),
  ALTER COLUMN total_price TYPE numeric(12, 2) USING total_price::numeric(12, 2);

ALTER TABLE payroll_entries
  ALTER COLUMN active_transport TYPE numeric(12, 2) USING active_transport::numeric(12, 2),
  ALTER COLUMN gross_commission TYPE numeric(12, 2) USING gross_commission::numeric(12, 2),
  ALTER COLUMN holiday_pay TYPE numeric(12, 2) USING holiday_pay::numeric(12, 2),
  ALTER COLUMN leave_pay TYPE numeric(12, 2) USING leave_pay::numeric(12, 2),
  ALTER COLUMN net_pay TYPE numeric(12, 2) USING net_pay::numeric(12, 2),
  ALTER COLUMN off_day_pay TYPE numeric(12, 2) USING off_day_pay::numeric(12, 2),
  ALTER COLUMN passive_transport TYPE numeric(12, 2) USING passive_transport::numeric(12, 2),
  ALTER COLUMN total_transport TYPE numeric(12, 2) USING total_transport::numeric(12, 2);

ALTER TABLE profit_loss
  ALTER COLUMN total_gross_profit TYPE numeric(15, 2) USING total_gross_profit::numeric(15, 2),
  ALTER COLUMN total_revenue TYPE numeric(15, 2) USING total_revenue::numeric(15, 2);

ALTER TABLE promotions
  ALTER COLUMN spend_amount TYPE numeric(12, 2) USING spend_amount::numeric(12, 2);

ALTER TABLE purchase_order_items
  ALTER COLUMN total_cost TYPE numeric(12, 2) USING total_cost::numeric(12, 2),
  ALTER COLUMN unit_cost TYPE numeric(12, 2) USING unit_cost::numeric(12, 2);

ALTER TABLE purchase_orders
  ALTER COLUMN total_amount TYPE numeric(12, 2) USING total_amount::numeric(12, 2);

ALTER TABLE quote_items
  ALTER COLUMN total_price TYPE numeric(12, 2) USING total_price::numeric(12, 2),
  ALTER COLUMN unit_price TYPE numeric(12, 2) USING unit_price::numeric(12, 2);

ALTER TABLE quotes
  ALTER COLUMN total_price TYPE numeric(12, 2) USING total_price::numeric(12, 2);

ALTER TABLE repayments
  ALTER COLUMN amount_received TYPE numeric(12, 2) USING amount_received::numeric(12, 2);

ALTER TABLE return_logs
  ALTER COLUMN refund_amount TYPE numeric(12, 2) USING refund_amount::numeric(12, 2);

ALTER TABLE settings
  ALTER COLUMN active_day_transport TYPE numeric(12, 2) USING active_day_transport::numeric(12, 2),
  ALTER COLUMN commission_fixed_amount TYPE numeric(12, 2) USING commission_fixed_amount::numeric(12, 2),
  ALTER COLUMN commission_rate TYPE numeric(5, 4) USING commission_rate::numeric(5, 4),
  ALTER COLUMN fixed_base_amount TYPE numeric(12, 2) USING fixed_base_amount::numeric(12, 2),
  ALTER COLUMN holiday_day_rate TYPE numeric(12, 2) USING holiday_day_rate::numeric(12, 2),
  ALTER COLUMN leave_day_rate TYPE numeric(12, 2) USING leave_day_rate::numeric(12, 2),
  ALTER COLUMN off_day_rate TYPE numeric(12, 2) USING off_day_rate::numeric(12, 2),
  ALTER COLUMN passive_day_transport TYPE numeric(12, 2) USING passive_day_transport::numeric(12, 2);

ALTER TABLE staff
  ALTER COLUMN active_day_rate_override TYPE numeric(12, 2) USING active_day_rate_override::numeric(12, 2),
  ALTER COLUMN commission_fixed_amount_override TYPE numeric(12, 2) USING commission_fixed_amount_override::numeric(12, 2),
  ALTER COLUMN commission_rate_override TYPE numeric(5, 4) USING commission_rate_override::numeric(5, 4),
  ALTER COLUMN holiday_day_rate_override TYPE numeric(12, 2) USING holiday_day_rate_override::numeric(12, 2),
  ALTER COLUMN leave_day_rate_override TYPE numeric(12, 2) USING leave_day_rate_override::numeric(12, 2),
  ALTER COLUMN off_day_rate_override TYPE numeric(12, 2) USING off_day_rate_override::numeric(12, 2),
  ALTER COLUMN passive_day_rate_override TYPE numeric(12, 2) USING passive_day_rate_override::numeric(12, 2),
  ALTER COLUMN pay_per_month TYPE numeric(12, 2) USING pay_per_month::numeric(12, 2);

ALTER TABLE store_credit_transactions
  ALTER COLUMN amount TYPE numeric(12, 2) USING amount::numeric(12, 2);

ALTER TABLE stores
  ALTER COLUMN commission_rate TYPE numeric(5, 4) USING commission_rate::numeric(5, 4);

ALTER TABLE tax_rates
  ALTER COLUMN rate TYPE numeric(5, 2) USING rate::numeric(5, 2);

ALTER TABLE transactions
  ALTER COLUMN amount TYPE numeric(12, 2) USING amount::numeric(12, 2);

ALTER TABLE vendor_bills
  ALTER COLUMN amount TYPE numeric(12, 2) USING amount::numeric(12, 2),
  ALTER COLUMN amount_paid TYPE numeric(12, 2) USING amount_paid::numeric(12, 2);
