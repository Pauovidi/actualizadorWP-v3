import { NextResponse } from 'next/server';
import { stripeClient, testPool } from '@/lib/billing/config';
import { verifyStripeEvent } from '@/lib/billing/stripe';
import { TestBillingStore } from '@/lib/billing/store';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  if (process.env.BILLING_INTEGRATION_MODE !== 'test' || process.env.VERCEL_ENV === 'production') {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  let pool: ReturnType<typeof testPool> | undefined;
  let db: any;
  try {
    const raw = await req.text();
    const event = verifyStripeEvent(raw, req.headers.get('stripe-signature') || '', process.env.STRIPE_TEST_WEBHOOK_SECRET || '');
    if (!['payment_intent.processing','payment_intent.succeeded','payment_intent.payment_failed','payment_intent.canceled'].includes(event.type)) {
      return NextResponse.json({ received: true });
    }
    pool = testPool();
    db = await pool.connect();
    await new TestBillingStore(db).assertIsolated();
    await db.query('BEGIN');
    // Serialize reconciliation for this intent and retrieve its CURRENT status,
    // not the possibly stale status of an out-of-order webhook event.
    const local = (await db.query(`SELECT p.quipu_id,i.amount_cents,c.stripe_customer_id FROM billing_test.payments p
      JOIN billing_test.invoices i ON i.quipu_id=p.quipu_id JOIN billing_test.clients c ON c.id=i.client_id
      WHERE p.payment_intent_id=$1 FOR UPDATE OF p`, [event.data?.object?.id])).rows[0];
    if (!local) { await db.query('ROLLBACK'); return NextResponse.json({ received: false, retry: true }, { status: 409 }); }
    const inserted = await db.query(`INSERT INTO billing_test.events (event_id,payment_intent_id) VALUES ($1,$2)
      ON CONFLICT DO NOTHING RETURNING event_id`, [event.id, event.data.object.id]);
    if (inserted.rowCount) {
      const current = await stripeClient().payment(event.data.object.id);
      if (current.metadata?.quipu_invoice_id !== local.quipu_id || current.metadata?.quipu_owner !== process.env.QUIPU_OWNER_SLUG ||
          current.metadata?.purpose !== 'actualizador-wp-test' || current.amount !== Number(local.amount_cents) ||
          current.currency !== 'eur' || current.customer !== local.stripe_customer_id) throw new Error('Payment identity mismatch');
      await db.query(`UPDATE billing_test.payments SET status=$2,updated_at=now() WHERE payment_intent_id=$1`, [current.id, current.status]);
    }
    await db.query('COMMIT');
    return NextResponse.json({ received: true });
  } catch {
    if (db) await db.query('ROLLBACK').catch(() => {});
    return NextResponse.json({ received: false }, { status: 400 });
  } finally { if (db) db.release(); if (pool) await pool.end(); }
}
