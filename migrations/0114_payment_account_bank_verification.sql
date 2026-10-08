-- Bank code (from the provider's bank list) and when the account name was last resolved at the bank. Idempotent.

ALTER TABLE store_payment_accounts ADD COLUMN IF NOT EXISTS bank_code text;
ALTER TABLE store_payment_accounts ADD COLUMN IF NOT EXISTS account_verified_at timestamp;
