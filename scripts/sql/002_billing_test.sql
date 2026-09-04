-- TEST DATABASE ONLY. Manual opt-in; never executed by application startup.
-- Additive: no DROP, DELETE, ALTER or writes to legacy sites/invoices/send_runs.
BEGIN;
CREATE SCHEMA IF NOT EXISTS billing_test;
CREATE TABLE IF NOT EXISTS billing_test.environment (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  purpose TEXT NOT NULL CHECK (purpose = 'actualizador-wp-isolated-test')
);
INSERT INTO billing_test.environment VALUES (TRUE, 'actualizador-wp-isolated-test') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS billing_test.clients (
  id BIGSERIAL PRIMARY KEY,
  quipu_contact_id TEXT NOT NULL UNIQUE,
  billing_email TEXT NOT NULL UNIQUE CHECK (billing_email = lower(trim(billing_email))),
  payment_mode TEXT NOT NULL DEFAULT 'manual' CHECK (payment_mode IN ('manual','stripe_sepa')),
  stripe_customer_id TEXT,
  payment_method_id TEXT,
  mandate_id TEXT,
  setup_intent_id TEXT UNIQUE,
  billing_frequency TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_frequency IN ('monthly','quarterly')),
  quarterly_months INT[] NOT NULL DEFAULT '{3,6,9,12}',
  sites JSONB NOT NULL DEFAULT '[]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS billing_test.invoices (
  quipu_id TEXT PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES billing_test.clients(id),
  period TEXT NOT NULL,
  number TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  payment_status TEXT NOT NULL,
  pdf BYTEA NOT NULL,
  pdf_sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, period)
);
CREATE TABLE IF NOT EXISTS billing_test.runs (
  client_id BIGINT NOT NULL REFERENCES billing_test.clients(id),
  period TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('STARTED','PREPARED','REVIEW_REQUIRED')),
  report_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, period)
);
CREATE TABLE IF NOT EXISTS billing_test.outbox (
  client_id BIGINT NOT NULL,
  period TEXT NOT NULL,
  payload JSONB NOT NULL,
  PRIMARY KEY (client_id, period),
  FOREIGN KEY (client_id, period) REFERENCES billing_test.runs(client_id, period)
);
CREATE TABLE IF NOT EXISTS billing_test.payments (
  quipu_id TEXT PRIMARY KEY REFERENCES billing_test.invoices(quipu_id),
  payment_intent_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'SUBMITTING',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS billing_test.events (
  event_id TEXT PRIMARY KEY,
  payment_intent_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMIT;
