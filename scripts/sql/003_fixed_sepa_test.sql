-- TEST DATABASE ONLY. Additive migration for fixed recurring SEPA charges.
BEGIN;
ALTER TABLE billing_test.clients ADD COLUMN IF NOT EXISTS charge_amount_cents BIGINT CHECK (charge_amount_cents > 0);
ALTER TABLE billing_test.clients ADD COLUMN IF NOT EXISTS charge_currency TEXT NOT NULL DEFAULT 'eur' CHECK (charge_currency = 'eur');
CREATE TABLE IF NOT EXISTS billing_test.subscription_payments (
  client_id BIGINT NOT NULL REFERENCES billing_test.clients(id),
  period TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  payment_intent_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'SUBMITTING',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, period)
);
COMMIT;
