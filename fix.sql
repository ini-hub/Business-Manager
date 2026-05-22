CREATE TABLE IF NOT EXISTS bookings (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id VARCHAR NOT NULL REFERENCES stores(id),
  customer_id VARCHAR NOT NULL REFERENCES customers(id),
  booking_ref TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  scheduled_at TIMESTAMP NOT NULL,
  expected_ready_at TIMESTAMP,
  lead_staff_id VARCHAR REFERENCES staff(id),
  assisting_staff_id VARCHAR REFERENCES staff(id),
  deposit_amount REAL NOT NULL DEFAULT 0,
  deposit_payment_method TEXT,
  subtotal REAL NOT NULL DEFAULT 0,
  discount_amount REAL NOT NULL DEFAULT 0,
  discount_percent REAL NOT NULL DEFAULT 0,
  discount_reason TEXT,
  discount_approved_by TEXT,
  total_price REAL NOT NULL DEFAULT 0,
  reminder_preference TEXT NOT NULL DEFAULT 'whatsapp',
  notes TEXT,
  reschedule_reason TEXT,
  reschedule_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booking_items (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id VARCHAR NOT NULL REFERENCES bookings(id),
  inventory_id VARCHAR NOT NULL REFERENCES inventory(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  total_price REAL NOT NULL DEFAULT 0
);

ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS booking_id VARCHAR REFERENCES bookings(id);
