-- Phases 2-4 of the WhatsApp integration: inbound booking conversation
-- state, customer magic-link booking access, template registry + broadcast
-- campaigns, and opt-in/opt-out audit trail. See shared/schema/whatsapp.ts.

-- Phase 2
CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id varchar NOT NULL REFERENCES stores(id),
  customer_id varchar REFERENCES customers(id),
  wa_phone_e164 text NOT NULL,
  state text NOT NULL DEFAULT 'greeting',
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_inbound_at timestamp NOT NULL DEFAULT now(),
  last_outbound_at timestamp,
  expires_at timestamp NOT NULL,
  resulting_booking_id varchar REFERENCES bookings(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_store_phone ON whatsapp_conversations(store_id, wa_phone_e164, updated_at);

CREATE TABLE IF NOT EXISTS whatsapp_booking_access_tokens (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id varchar NOT NULL REFERENCES bookings(id),
  customer_id varchar NOT NULL REFERENCES customers(id),
  token text NOT NULL,
  expires_at timestamp NOT NULL,
  used_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_booking_access_tokens_token_unique UNIQUE (token)
);

-- Phase 3
CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id varchar NOT NULL REFERENCES stores(id),
  meta_template_name text NOT NULL,
  meta_template_id text,
  category text NOT NULL,
  language text NOT NULL DEFAULT 'en_US',
  body_text text NOT NULL,
  variable_count integer NOT NULL DEFAULT 0,
  variable_labels jsonb,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS whatsapp_broadcasts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id varchar NOT NULL REFERENCES stores(id),
  created_by_staff_id varchar,
  name text NOT NULL,
  template_id varchar NOT NULL REFERENCES whatsapp_templates(id),
  variable_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  scheduled_at timestamp,
  total_recipients integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  delivered_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  completed_at timestamp
);

CREATE TABLE IF NOT EXISTS whatsapp_broadcast_recipients (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id varchar NOT NULL REFERENCES whatsapp_broadcasts(id),
  customer_id varchar NOT NULL REFERENCES customers(id),
  whatsapp_message_id varchar REFERENCES whatsapp_messages(id),
  status text NOT NULL DEFAULT 'queued'
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_broadcast_recipients_broadcast ON whatsapp_broadcast_recipients(broadcast_id);

-- Phase 4
CREATE TABLE IF NOT EXISTS whatsapp_opt_ins (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id varchar NOT NULL REFERENCES customers(id),
  store_id varchar NOT NULL REFERENCES stores(id),
  event text NOT NULL,
  source text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_opt_ins_customer ON whatsapp_opt_ins(customer_id, created_at);
