import { NextResponse } from 'next/server';
import { authorizeTest, quipuClient, stripeClient, testPool } from '@/lib/billing/config';
import { TestBillingStore } from '@/lib/billing/store';
import { syncInvoices, prepareReports, collectPayments } from '@/lib/billing/service';
import { validPeriod } from '@/lib/billing/quipu';
import { POST as updateDemo } from '@/app/api/update/route';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!authorizeTest(req)) return NextResponse.json({ ok: false, error: 'Test integration unavailable' }, { status: 403 });
  let pool: ReturnType<typeof testPool> | undefined;
  let db: any;
  let locked = false;
  try {
    const input = await req.json();
    const period = validPeriod(input.period);
    if (!['plan','sync','run','setup','accept-setup','status'].includes(input.action)) throw new Error('Invalid action');
    pool = testPool();
    db = await pool.connect();
    const store = new TestBillingStore(db);
    await store.assertIsolated();
    // Serialize all test operations, including contact/mandate association.
    locked = (await db.query('SELECT pg_try_advisory_lock(68260904) AS locked')).rows[0].locked;
    if (!locked) return NextResponse.json({ ok: false, error: 'Test run already active' }, { status: 409 });
    if (input.action === 'status') {
      const runs = await db.query('SELECT client_id,period,status,report_count FROM billing_test.runs WHERE period=$1', [period]);
      const payments = await db.query(`SELECT p.quipu_id,p.payment_intent_id,p.status FROM billing_test.payments p
        JOIN billing_test.invoices i ON i.quipu_id=p.quipu_id WHERE i.period=$1`, [period]);
      return NextResponse.json({ ok: true, mode: 'test', runs: runs.rows, payments: payments.rows });
    }
    if (input.action === 'setup' || input.action === 'accept-setup') {
      const client = (await store.clients()).find(c => String(c.id) === String(input.clientId));
      if (!client?.stripe_customer_id) throw new Error('Test customer must be configured explicitly');
      const stripe = stripeClient();
      if (input.action === 'setup') {
        const session = await stripe.setup(client.stripe_customer_id, String(client.id),
          process.env.BILLING_TEST_RETURN_ORIGIN || '', input.attemptId);
        return NextResponse.json({ ok: true, mode: 'test', checkoutUrl: session.url });
      }
      const mandate = await stripe.acceptedSetup(input.setupIntentId, String(client.id), client.stripe_customer_id);
      await db.query(`UPDATE billing_test.clients SET payment_mode='stripe_sepa',payment_method_id=$2,
        mandate_id=$3,setup_intent_id=$4 WHERE id=$1`, [client.id, mandate.paymentMethodId, mandate.mandateId, input.setupIntentId]);
      return NextResponse.json({ ok: true, mode: 'test', mandateAccepted: true });
    }
    const quipu = quipuClient();
    const imported = await syncInvoices(store, quipu, period, input.action !== 'plan');
    if (input.action !== 'run') return NextResponse.json({ ok: true, mode: 'test', imported });
    const eligible = new Set(imported.filter(r => ['IMPORTED','ALREADY_IMPORTED','NOT_DUE'].includes(r.status)).map(r => String(r.clientId)));
    const clients = (await store.clients()).filter(c => eligible.has(String(c.id)));
    // Do not reuse an old invoice/report when this sync found a changed or ambiguous document.
    const eligibleStore = Object.create(store) as TestBillingStore;
    eligibleStore.clients = async () => clients;
    const reports = await prepareReports(eligibleStore, period, async site => {
      // Hardcoded demo flag, no token accepted from the caller, no network to WP.
      const r = await updateDemo(new Request('https://billing-test.invalid/api/update', {
        method: 'POST', body: JSON.stringify({ url: site.url, demo: true }),
      }));
      const payload = await r.json();
      if (!r.ok || !payload.ok) throw new Error('Demo report failed');
      return payload.data;
    }, true);
    // Manual-only clients do not require Stripe configuration.
    const payments = clients.some(c => c.payment_mode === 'stripe_sepa')
      ? await collectPayments(eligibleStore, quipu, stripeClient(), process.env.QUIPU_OWNER_SLUG || '', period, true) : [];
    return NextResponse.json({ ok: true, mode: 'test', imported, reports, payments,
      wordpress: 'simulated', email: 'private_outbox_only', productionChanged: false });
  } catch {
    // Never return provider bodies, credentials, invoice details or DB errors.
    return NextResponse.json({ ok: false, error: 'Billing test stopped; check configuration or reconcile pending operations' }, { status: 422 });
  } finally {
    if (db) {
      if (locked) await db.query('SELECT pg_advisory_unlock(68260904)').catch(() => {});
      db.release();
    }
    if (pool) await pool.end();
  }
}
