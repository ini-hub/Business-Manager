-- Pay-per-feature entitlement model: the feature catalog, its dependency
-- graph, and per-organisation purchased entitlements, plus the sunset-notice
-- reminder log for paywalling a currently-free feature. See
-- shared/schema/entitlements.ts and the "Pay-Per-Feature Entitlement Model"
-- requirements plan this shipped from.

CREATE TABLE IF NOT EXISTS feature_catalog (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  category text NOT NULL,
  tier_type text NOT NULL,
  price_monthly numeric(12, 2),
  price_annual numeric(12, 2),
  currency text NOT NULL DEFAULT 'NGN',
  parent_feature_id varchar REFERENCES feature_catalog(id),
  free_limit integer,
  limit_type text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feature_dependencies (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_id varchar NOT NULL REFERENCES feature_catalog(id),
  depends_on_feature_id varchar NOT NULL REFERENCES feature_catalog(id),
  CONSTRAINT uq_feature_dependencies UNIQUE (feature_id, depends_on_feature_id)
);

CREATE TABLE IF NOT EXISTS org_feature_entitlements (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id varchar NOT NULL REFERENCES organisations(id),
  feature_id varchar NOT NULL REFERENCES feature_catalog(id),
  status text NOT NULL DEFAULT 'active',
  source text NOT NULL,
  effective_from timestamp NOT NULL DEFAULT now(),
  removal_effective_at timestamp,
  subscription_payment_id varchar REFERENCES subscription_payments(id),
  granted_by_admin_id varchar,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_feature_entitlements_org ON org_feature_entitlements (organisation_id);
CREATE INDEX IF NOT EXISTS idx_org_feature_entitlements_feature ON org_feature_entitlements (feature_id);

-- At most one *active* entitlement per (org, feature) - a partial index,
-- which is why this lives in raw SQL rather than drizzle's table builder.
-- 'pending_removal'/'removed' rows for the same pair are fine to coexist
-- (they're history), only 'active' must be unique.
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_feature_entitlements_active
  ON org_feature_entitlements (organisation_id, feature_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS feature_sunset_reminder_logs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id varchar NOT NULL REFERENCES organisations(id),
  feature_id varchar NOT NULL REFERENCES feature_catalog(id),
  stage text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT uq_feature_sunset_reminder_logs UNIQUE (organisation_id, feature_id, stage)
);

-- Add-on feature keys a subscription payment covers, alongside the base plan.
ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS feature_keys jsonb;

-- ---------------------------------------------------------------------------
-- Seed catalog. Fixed ids so featureDependencies and bundle_child rows below
-- can reference them directly. Prices are placeholder starting points in NGN
-- - the whole point of this system is that the super admin edits them via
-- the admin Feature Catalog page (server/routes-admin.ts,
-- client/src/pages/admin/FeatureCatalog.tsx) without a deploy.
-- ---------------------------------------------------------------------------

INSERT INTO feature_catalog (id, key, name, description, category, tier_type, price_monthly, price_annual, free_limit, limit_type, is_active, sort_order) VALUES
  ('10000000-0000-0000-0000-000000000001', 'vendor_details', 'Vendor Details', 'Vendor records and profiles.', 'vendor_mgmt', 'free', NULL, NULL, NULL, NULL, true, 10),
  ('10000000-0000-0000-0000-000000000002', 'purchase_order_tracking', 'Purchase Order Tracking', 'Create and track purchase orders to vendors.', 'vendor_mgmt', 'free', NULL, NULL, NULL, NULL, true, 20),
  ('10000000-0000-0000-0000-000000000003', 'attendance_management', 'Attendance Management (manager-recorded)', 'Clock staff in and out on their behalf.', 'staff_mgmt', 'free', NULL, NULL, NULL, NULL, true, 30),
  ('10000000-0000-0000-0000-000000000004', 'contract_management', 'Contract Management', 'Versioned staff contracts with e-signature.', 'staff_mgmt', 'free', NULL, NULL, NULL, NULL, true, 40),
  ('10000000-0000-0000-0000-000000000005', 'sales_module', 'Sales Module', 'Core point-of-sale checkout.', 'inventory_mgmt', 'free', NULL, NULL, NULL, NULL, true, 50),
  ('10000000-0000-0000-0000-000000000006', 'customer_details', 'Customer Details', 'Customer records, up to the free tier limit.', 'customer_mgmt', 'free', NULL, NULL, NULL, NULL, true, 60),
  ('10000000-0000-0000-0000-000000000007', 'customer_filters', 'Customer Filters', 'Filter and segment the customer list.', 'customer_mgmt', 'free', NULL, NULL, NULL, NULL, true, 70),
  ('10000000-0000-0000-0000-000000000008', 'promotions', 'Promotions', 'BOGO, spend-threshold, and percentage-discount campaigns.', 'inventory_mgmt', 'free', NULL, NULL, NULL, NULL, true, 80),
  ('10000000-0000-0000-0000-000000000009', 'hide_transaction_amount', 'Hide Transaction Amount From Staff', 'Mask amounts from staff in transactions, dashboard, and exports.', 'business_settings', 'free', NULL, NULL, NULL, NULL, true, 90),

  ('10000000-0000-0000-0000-000000000010', 'staff_seats_addon', 'Additional Staff Seats', 'Unlimited staff beyond the first free seat.', 'staff_mgmt', 'paid_metered_limit', 2000, 20000, 1, 'staff_seats', true, 100),
  ('10000000-0000-0000-0000-000000000011', 'self_check_in', 'Self Check-In', 'Staff clock themselves in and out.', 'staff_mgmt', 'paid_flat', 1500, 15000, NULL, NULL, true, 110),
  ('10000000-0000-0000-0000-000000000012', 'staff_performance_tracking', 'Staff Performance Tracking', 'Per-staff performance reports.', 'staff_mgmt', 'paid_flat', 2500, 25000, NULL, NULL, true, 120),

  ('10000000-0000-0000-0000-000000000013', 'customer_capacity_addon', 'Additional Customer Capacity', 'Unlimited customers beyond the first 50 free.', 'customer_mgmt', 'paid_metered_limit', 2000, 20000, 50, 'customer_count', true, 130),
  ('10000000-0000-0000-0000-000000000014', 'customer_analytics_retention', 'Customer Analytics & Retention', 'Retention and repeat-customer analytics.', 'customer_mgmt', 'paid_flat', 3000, 30000, NULL, NULL, true, 140),
  ('10000000-0000-0000-0000-000000000015', 'quote_booking_management', 'Quote & Booking Management', 'Pricing not yet decided - placeholder entry.', 'customer_mgmt', 'paid_flat', NULL, NULL, NULL, NULL, false, 150),

  ('10000000-0000-0000-0000-000000000016', 'financial_management', 'Financial Management', 'P&L Statement, Expenses, and Hybrid/Commission Payroll, sold as one bundle.', 'financial_mgmt', 'bundle_parent', 7500, 75000, NULL, NULL, true, 160),
  ('10000000-0000-0000-0000-000000000017', 'pnl_statement', 'Profit & Loss Statement', 'Included in the Financial Management bundle.', 'financial_mgmt', 'bundle_child', NULL, NULL, NULL, NULL, true, 161),
  ('10000000-0000-0000-0000-000000000018', 'expenses_tracking', 'Expenses', 'Included in the Financial Management bundle.', 'financial_mgmt', 'bundle_child', NULL, NULL, NULL, NULL, true, 162),
  ('10000000-0000-0000-0000-000000000019', 'payroll_hybrid_commission', 'Payroll - Hybrid & Commission', 'Included in the Financial Management bundle. Fixed-pay payroll stays free.', 'financial_mgmt', 'bundle_child', NULL, NULL, NULL, NULL, true, 163),

  ('10000000-0000-0000-0000-000000000020', 'vat_tracking', 'VAT Tracking & Remittance Log', 'Backend not yet built - placeholder entry (see plan §6).', 'tax_compliance', 'paid_flat', NULL, NULL, NULL, NULL, false, 170),

  ('10000000-0000-0000-0000-000000000021', 'product_variants', 'Product Variants', 'Size/color/style variants per product.', 'inventory_mgmt', 'paid_flat', 1500, 15000, NULL, NULL, true, 180),
  ('10000000-0000-0000-0000-000000000022', 'sell_in_parts', 'Sell In Parts', 'Backend not yet built - placeholder entry (see plan §6).', 'inventory_mgmt', 'paid_flat', NULL, NULL, NULL, NULL, false, 190),
  ('10000000-0000-0000-0000-000000000023', 'receipts', 'Receipts', 'Custom receipt output beyond the default.', 'inventory_mgmt', 'paid_flat', 1000, 10000, NULL, NULL, true, 200),
  ('10000000-0000-0000-0000-000000000024', 'low_stock_threshold', 'Low Stock Threshold & Reminders', 'Configurable reorder points and alerts.', 'inventory_mgmt', 'paid_flat', 1000, 10000, NULL, NULL, true, 210),
  ('10000000-0000-0000-0000-000000000025', 'credit_sale', 'Credit Sale', 'Checkout a sale as credit against a customer.', 'inventory_mgmt', 'paid_flat', 2000, 20000, NULL, NULL, true, 220),
  ('10000000-0000-0000-0000-000000000026', 'credit_recall_reminders', 'Credit Recall Reminders', 'Automated reminders for outstanding credit.', 'inventory_mgmt', 'paid_flat', 1000, 10000, NULL, NULL, true, 230),
  ('10000000-0000-0000-0000-000000000027', 'consignment_management', 'Consignment Management', 'Backend not yet built - placeholder entry (see plan §6).', 'inventory_mgmt', 'paid_flat', NULL, NULL, NULL, NULL, false, 240),

  ('10000000-0000-0000-0000-000000000028', 'store_addon', 'Additional Store / Branch', 'Each store beyond the first free one.', 'business_settings', 'paid_flat', 5000, 50000, NULL, NULL, true, 250),
  ('10000000-0000-0000-0000-000000000029', 'receipt_customization', 'Custom Receipt Prefix + Thank-You Note', 'Currently free and in active use - see the sunset-notice mechanism before paywalling.', 'business_settings', 'paid_flat', 1500, 15000, NULL, NULL, true, 260),
  ('10000000-0000-0000-0000-000000000030', 'loyalty_program', 'Loyalty Point Configuration', 'Currently free and in active use - see the sunset-notice mechanism before paywalling.', 'business_settings', 'paid_flat', 1500, 15000, NULL, NULL, true, 270),
  ('10000000-0000-0000-0000-000000000031', 'custom_roles_permissions', 'Custom Roles & Permissions', 'Currently free and in active use - see the sunset-notice mechanism before paywalling.', 'business_settings', 'paid_flat', 1500, 15000, NULL, NULL, true, 280),
  ('10000000-0000-0000-0000-000000000032', 'plugins_integrations', 'Plugins & Integrations', 'Framework not yet built - placeholder entry (see plan §6).', 'business_settings', 'paid_flat', NULL, NULL, NULL, NULL, false, 290)
ON CONFLICT (key) DO NOTHING;

-- Bundle children point at the Financial Management bundle parent (column
-- list above omits parent_feature_id to keep that INSERT's rows uniform).
UPDATE feature_catalog SET parent_feature_id = '10000000-0000-0000-0000-000000000016'
  WHERE id IN ('10000000-0000-0000-0000-000000000017', '10000000-0000-0000-0000-000000000018', '10000000-0000-0000-0000-000000000019');

INSERT INTO feature_dependencies (feature_id, depends_on_feature_id) VALUES
  ('10000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000003'), -- self_check_in -> attendance_management
  ('10000000-0000-0000-0000-000000000025', '10000000-0000-0000-0000-000000000005'), -- credit_sale -> sales_module
  ('10000000-0000-0000-0000-000000000025', '10000000-0000-0000-0000-000000000006'), -- credit_sale -> customer_details
  ('10000000-0000-0000-0000-000000000026', '10000000-0000-0000-0000-000000000025')  -- credit_recall_reminders -> credit_sale
ON CONFLICT ON CONSTRAINT uq_feature_dependencies DO NOTHING;
