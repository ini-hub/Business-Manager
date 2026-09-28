-- Business accounting: owner capital contributions/withdrawals, manually
-- tracked assets and liabilities. See shared/schema/accounting.ts. Retained
-- earnings is deliberately NOT a stored table here - it's derived at read
-- time from cumulative net profit (AnalyticsService.getProfitLossSummary
-- with no date range) minus cumulative withdrawals, giving a continuously
-- running balance with no period-close step.

CREATE TABLE IF NOT EXISTS capital_contributions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id varchar NOT NULL REFERENCES stores(id),
  type text NOT NULL,
  amount numeric(12, 2) NOT NULL,
  description text,
  date date NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_capital_contributions_store ON capital_contributions(store_id);

CREATE TABLE IF NOT EXISTS assets (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id varchar NOT NULL REFERENCES stores(id),
  name text NOT NULL,
  category text NOT NULL,
  value numeric(12, 2) NOT NULL,
  acquired_date date,
  notes text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assets_store ON assets(store_id);

CREATE TABLE IF NOT EXISTS liabilities (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id varchar NOT NULL REFERENCES stores(id),
  name text NOT NULL,
  category text NOT NULL,
  amount numeric(12, 2) NOT NULL,
  due_date date,
  notes text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_liabilities_store ON liabilities(store_id);
