-- Admin-managed pricing bundles: a named set of catalog features, discounted while a
-- business holds all of it. Replaces the hardcoded bundle list and the
-- platform_config "bundle_discounts" override. Owns no entitlement, so deleting a
-- bundle never changes anyone's access.
--
-- Idempotent; seeds the three bundles that were previously in code.

CREATE TABLE IF NOT EXISTS pricing_bundles (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  tagline text NOT NULL DEFAULT '',
  feature_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  discount_pct numeric(5,2) NOT NULL DEFAULT 0,
  bullets jsonb NOT NULL DEFAULT '[]'::jsonb,
  featured boolean NOT NULL DEFAULT false,
  show_on_landing boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- REVIEW: placeholder discounts, editable from Super Admin > Bundles.
INSERT INTO pricing_bundles (key, name, tagline, feature_keys, discount_pct, bullets, featured, sort_order) VALUES
  ('starter', 'Starter', 'For shops selling on credit',
   '["credit_sale","quotes_management","product_variants","inventory_audit","tax_management","staff_seats_addon"]'::jsonb, 25,
   '["Credit sales and quotes","Item variants and stock audit","Taxes, unlimited staff"]'::jsonb, false, 10),
  ('growth', 'Growth', 'For teams and second branches',
   '["credit_sale","quotes_management","product_variants","inventory_audit","tax_management","staff_seats_addon","booking_management","self_check_in","financial_management","loyalty_program","store_addon","stock_transfer"]'::jsonb, 25,
   '["Everything in Starter","Booking, self check-in, commission payroll","Loyalty, extra stores, stock transfer"]'::jsonb, true, 20),
  ('business', 'Business', 'For multi-store operations',
   '["credit_sale","quotes_management","product_variants","inventory_audit","tax_management","staff_seats_addon","booking_management","self_check_in","financial_management","loyalty_program","store_addon","stock_transfer","custom_roles_permissions","whatsapp_broadcasts","customer_capacity_addon","item_capacity_addon"]'::jsonb, 25,
   '["Everything in Growth","Custom roles, WhatsApp","Unlimited customers and items"]'::jsonb, false, 30)
ON CONFLICT (key) DO NOTHING;

DO $$
BEGIN
  IF to_regclass('public.pricing_bundles') IS NULL THEN
    RAISE EXCEPTION '0101: pricing_bundles was not created';
  END IF;
END $$;
