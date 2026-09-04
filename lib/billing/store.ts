import type { PoolClient } from 'pg';
import type { QuipuInvoice } from './quipu';
import type { Client, Store, StoredInvoice } from './service';
import { pdfHash } from './service';

export class TestBillingStore implements Store {
  constructor(readonly db: PoolClient) {}
  async assertIsolated() {
    const r = await this.db.query('SELECT purpose FROM billing_test.environment WHERE id = TRUE');
    if (r.rows[0]?.purpose !== 'actualizador-wp-isolated-test') throw new Error('Missing isolated test marker');
  }
  async clients(): Promise<Client[]> {
    return (await this.db.query('SELECT * FROM billing_test.clients WHERE enabled = TRUE ORDER BY id')).rows;
  }
  async invoice(client: string, period: string): Promise<StoredInvoice | null> {
    const r = await this.db.query(`SELECT i.*, c.quipu_contact_id FROM billing_test.invoices i
      JOIN billing_test.clients c ON c.id = i.client_id WHERE client_id=$1 AND period=$2`, [client, period]);
    const i = r.rows[0];
    return i ? { id: i.quipu_id, contactId: i.quipu_contact_id, period: i.period, number: i.number,
      amountCents: Number(i.amount_cents), paymentStatus: i.payment_status, pdf: i.pdf } : null;
  }
  async importInvoice(client: string, invoice: QuipuInvoice, pdf: Buffer) {
    // Intentionally no upsert: an existing document can never be overwritten.
    await this.db.query(`INSERT INTO billing_test.invoices
      (quipu_id,client_id,period,number,amount_cents,payment_status,pdf,pdf_sha256)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [invoice.id, client, invoice.period, invoice.number,
      invoice.amountCents, invoice.paymentStatus, pdf, pdfHash(pdf)]);
  }
  async claimRun(client: string, period: string) {
    const r = await this.db.query(`INSERT INTO billing_test.runs (client_id,period,status) VALUES ($1,$2,'STARTED')
      ON CONFLICT DO NOTHING RETURNING client_id`, [client, period]);
    return r.rowCount === 1;
  }
  async prepare(client: string, period: string, payload: unknown, reportCount: number) {
    await this.db.query('BEGIN');
    try {
      await this.db.query(`INSERT INTO billing_test.outbox (client_id,period,payload) VALUES ($1,$2,$3::jsonb)`,
        [client, period, JSON.stringify(payload)]);
      await this.db.query(`UPDATE billing_test.runs SET status='PREPARED',report_count=$3 WHERE client_id=$1 AND period=$2`,
        [client, period, reportCount]);
      await this.db.query('COMMIT');
    } catch (e) { await this.db.query('ROLLBACK'); throw e; }
  }
  async reviewRun(client: string, period: string) {
    await this.db.query(`UPDATE billing_test.runs SET status='REVIEW_REQUIRED' WHERE client_id=$1 AND period=$2`, [client, period]);
  }
  async claimPayment(invoice: string) {
    const r = await this.db.query(`INSERT INTO billing_test.payments (quipu_id)
      SELECT i.quipu_id FROM billing_test.invoices i JOIN billing_test.runs r
        ON i.client_id=r.client_id AND i.period=r.period
      WHERE i.quipu_id=$1 AND r.status='PREPARED' ON CONFLICT DO NOTHING RETURNING quipu_id`, [invoice]);
    return r.rowCount === 1;
  }
  async savePayment(invoice: string, id: string | null, status: string) {
    await this.db.query(`UPDATE billing_test.payments SET payment_intent_id=COALESCE($2,payment_intent_id),
      status=$3,updated_at=now() WHERE quipu_id=$1`, [invoice, id, status]);
  }
}
