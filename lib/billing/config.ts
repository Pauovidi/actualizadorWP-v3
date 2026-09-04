import { timingSafeEqual } from 'node:crypto';
import { Pool } from 'pg';
import { QuipuClient } from './quipu';
import { StripeTestClient } from './stripe';

export function authorizeTest(req: Request, env = process.env) {
  if (env.BILLING_INTEGRATION_MODE !== 'test' || env.VERCEL_ENV === 'production') return false;
  const expected = env.BILLING_TEST_ADMIN_TOKEN;
  if (!expected || expected.length < 32) return false;
  const supplied = req.headers.get('authorization') || '';
  const a = Buffer.from(supplied), b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && timingSafeEqual(new Uint8Array(a), new Uint8Array(b));
}

export function testPool(env = process.env) {
  if (env.BILLING_INTEGRATION_MODE !== 'test' || env.VERCEL_ENV === 'production') throw new Error('Test integration is disabled');
  const connectionString = env.BILLING_TEST_DATABASE_URL;
  if (!connectionString) throw new Error('An isolated test database is required');
  const target = new URL(connectionString);
  // Also reject alternate URLs for the same production server/database.
  for (const value of [env.DATABASE_URL, env.POSTGRES_URL, env.POSTGRES_PRISMA_URL]) {
    if (!value) continue;
    const prod = new URL(value);
    if (prod.hostname === target.hostname && prod.pathname === target.pathname) throw new Error('Production database cannot be used for billing tests');
  }
  return new Pool({ connectionString, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 15000 });
}

export function quipuClient() {
  return new QuipuClient({ owner: process.env.QUIPU_OWNER_SLUG || '', clientId: process.env.QUIPU_CLIENT_ID || '',
    clientSecret: process.env.QUIPU_CLIENT_SECRET || '', currency: process.env.QUIPU_ACCOUNT_CURRENCY || '' });
}

export function stripeClient() { return new StripeTestClient(process.env.STRIPE_TEST_SECRET_KEY || ''); }
