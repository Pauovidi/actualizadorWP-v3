-- Actualitzador WP (Vercel UI) - automation tables

CREATE TABLE IF NOT EXISTS sites (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL,
  email TEXT NOT NULL,
  billing_frequency TEXT NOT NULL DEFAULT 'monthly', -- 'monthly' | 'quarterly'
  quarterly_months INT[] NULL,                      -- e.g. {3,6,9,12} for quarterly invoices
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoices (
  id BIGSERIAL PRIMARY KEY,
  billing_email TEXT NOT NULL,
  period TEXT NOT NULL,            -- 'YYYY-MM' or 'YYYY-Qn'
  file_name TEXT NOT NULL,
  blob_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (billing_email, period)
);

CREATE TABLE IF NOT EXISTS send_runs (
  id BIGSERIAL PRIMARY KEY,
  billing_email TEXT NOT NULL,
  period TEXT NOT NULL,
  status TEXT NOT NULL,           -- 'SENT' | 'SKIPPED' | 'ERROR'
  details JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (billing_email, period)
);
