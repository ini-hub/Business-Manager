-- Phase 1 of the WhatsApp integration (per-store number routing + outbound/
-- inbound message log). See shared/schema/whatsapp.ts. whatsapp_numbers maps
-- Meta's phone_number_id (the routing key on every inbound webhook payload)
-- to a store; whatsapp_messages mirrors pending_emails' queue + webhook-
-- driven delivery-status pattern (server/services/EmailQueue.ts) for
-- WhatsApp sends, and also logs inbound messages.

CREATE TABLE IF NOT EXISTS whatsapp_numbers (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id varchar NOT NULL REFERENCES stores(id),
  phone_number_id text NOT NULL,
  waba_id text NOT NULL,
  display_phone_number text,
  access_token_encrypted text,
  status text NOT NULL DEFAULT 'pending_verification',
  quality_rating text,
  messaging_tier_limit integer,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_numbers_store_unique UNIQUE (store_id),
  CONSTRAINT whatsapp_numbers_phone_number_id_unique UNIQUE (phone_number_id)
);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id varchar NOT NULL REFERENCES stores(id),
  customer_id varchar REFERENCES customers(id),
  direction text NOT NULL,
  wa_message_id text,
  to_phone_e164 text,
  from_phone_e164 text,
  message_type text NOT NULL,
  template_name text,
  template_variables jsonb,
  body_text text,
  payload jsonb,
  broadcast_id varchar,
  status text NOT NULL DEFAULT 'queued',
  error_code text,
  error_message text,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamp NOT NULL DEFAULT now(),
  sent_at timestamp,
  delivered_at timestamp,
  read_at timestamp,
  failed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_messages_wa_message_id_unique UNIQUE (wa_message_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_store_direction ON whatsapp_messages(store_id, direction, created_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_broadcast ON whatsapp_messages(broadcast_id);
