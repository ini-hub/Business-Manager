-- Quote -> booking / checkout conversion. A quote records the sale or booking it became; checkouts and bookings
-- record the quote they came from. Idempotent.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS converted_sale_id varchar REFERENCES checkouts(id);
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS converted_booking_id varchar REFERENCES bookings(id);
ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS quote_id varchar REFERENCES quotes(id);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS quote_id varchar REFERENCES quotes(id);
CREATE INDEX IF NOT EXISTS idx_checkouts_quote ON checkouts(quote_id);
CREATE INDEX IF NOT EXISTS idx_bookings_quote ON bookings(quote_id);
