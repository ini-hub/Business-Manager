ALTER TABLE IF EXISTS store_counters
  ADD COLUMN IF NOT EXISTS next_booking_number integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  booking_ref text NOT NULL UNIQUE,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  scheduled_at timestamptz NOT NULL,
  expected_ready_at timestamptz,
  lead_staff_id uuid REFERENCES staff(id),
  assisting_staff_id uuid REFERENCES staff(id),
  deposit_amount real NOT NULL DEFAULT 0,
  deposit_payment_method text,
  reminder_preference text NOT NULL DEFAULT 'whatsapp',
  notes text,
  reschedule_reason text,
  reschedule_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS booking_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  inventory_id uuid NOT NULL REFERENCES inventory(id),
  quantity integer NOT NULL DEFAULT 1,
  unit_price real NOT NULL DEFAULT 0,
  total_price real NOT NULL DEFAULT 0
);

ALTER TABLE IF EXISTS checkouts ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES bookings(id);

CREATE INDEX IF NOT EXISTS idx_bookings_store_created_at ON bookings(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_items_booking_id ON booking_items(booking_id);
