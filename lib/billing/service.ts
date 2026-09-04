import { createHash } from 'node:crypto';
import type { QuipuInvoice, QuipuClient } from './quipu';
import { validPeriod } from './quipu';
import type { StripeTestClient } from './stripe';

export type Client = {
  id: string; quipu_contact_id: string; billing_email: string; payment_mode: 'manual' | 'stripe_sepa';
  stripe_customer_id?: string; payment_method_id?: string; mandate_id?: string;
  billing_frequency: 'monthly' | 'quarterly'; quarterly_months: number[];
  sites: Array<{ name: string; url: string }>;
};
export type StoredInvoice = QuipuInvoice & { pdf: Buffer };
export type Store = {
  clients(): Promise<Client[]>;
  invoice(client: string, period: string): Promise<StoredInvoice | null>;
  importInvoice(client: string, invoice: QuipuInvoice, pdf: Buffer): Promise<void>;
  claimRun(client: string, period: string): Promise<boolean>;
  prepare(client: string, period: string, payload: unknown, reportCount: number): Promise<void>;
  reviewRun(client: string, period: string): Promise<void>;
  claimPayment(invoice: string): Promise<boolean>;
  savePayment(invoice: string, id: string | null, status: string): Promise<void>;
};

export function invoiceDue(client: Client, period: string) {
  validPeriod(period);
  if (client.billing_frequency === 'monthly') return true;
  if (client.billing_frequency !== 'quarterly' || client.quarterly_months.length !== 4 ||
      new Set(client.quarterly_months).size !== 4 || client.quarterly_months.some(m => !Number.isInteger(m) || m < 1 || m > 12)) {
    throw new Error('Invalid client billing frequency');
  }
  return client.quarterly_months.includes(Number(period.slice(-2)));
}

export function sameInvoice(a: QuipuInvoice, b: QuipuInvoice) {
  return a.id === b.id && a.contactId === b.contactId && a.period === b.period &&
    a.number === b.number && a.amountCents === b.amountCents && a.paymentStatus === b.paymentStatus;
}

export async function syncInvoices(store: Store, quipu: Pick<QuipuClient, 'list' | 'pdf'>, period: string, apply = false) {
  validPeriod(period);
  const clients = await store.clients();
  const invoices = await quipu.list(period);
  const results: Array<{ clientId: string; status: string }> = [];
  for (const client of clients) {
    const matches = invoices.filter(i => i.contactId === client.quipu_contact_id);
    if (!invoiceDue(client, period)) { results.push({ clientId: client.id, status: 'NOT_DUE' }); continue; }
    if (matches.length !== 1) {
      results.push({ clientId: client.id, status: matches.length ? 'AMBIGUOUS_INVOICES' : 'MISSING_INVOICE' }); continue;
    }
    const invoice = matches[0];
    const previous = await store.invoice(client.id, period);
    if (previous) {
      results.push({ clientId: client.id, status: sameInvoice(previous, invoice) ? 'ALREADY_IMPORTED' : 'CONFLICT_REVIEW_REQUIRED' });
      continue;
    }
    if (!apply) { results.push({ clientId: client.id, status: 'WOULD_IMPORT' }); continue; }
    const pdf = await quipu.pdf(invoice.id);
    await store.importInvoice(client.id, invoice, pdf);
    results.push({ clientId: client.id, status: 'IMPORTED' });
  }
  return results;
}

// Same grouped payload consumed by the existing /api/send route. Test mode saves it
// to a private outbox instead of sending any SMTP or calling a customer's WordPress.
export async function prepareReports(store: Store, period: string,
  demoReport: (site: { name: string; url: string }) => Promise<{ reportHtml: string; reportFileName: string }>,
  apply = false) {
  validPeriod(period);
  const results: Array<{ clientId: string; status: string }> = [];
  for (const client of await store.clients()) {
    const due = invoiceDue(client, period);
    const invoice = await store.invoice(client.id, period);
    if (due && !invoice) { results.push({ clientId: client.id, status: 'MISSING_INVOICE' }); continue; }
    if (!client.sites.length) { results.push({ clientId: client.id, status: 'NO_SITES' }); continue; }
    if (!apply) { results.push({ clientId: client.id, status: 'WOULD_PREPARE' }); continue; }
    if (!await store.claimRun(client.id, period)) { results.push({ clientId: client.id, status: 'ALREADY_CLAIMED' }); continue; }
    try {
      const reports = [];
      for (const site of client.sites) {
        const report = await demoReport(site);
        if (!report.reportHtml?.startsWith('data:text/html;base64,')) throw new Error('Missing demo report');
        reports.push({ fileName: report.reportFileName, dataUrl: report.reportHtml, site });
      }
      await store.prepare(client.id, period, {
        email: client.billing_email, period, sites: client.sites, reports,
        invoice: due && invoice ? { fileName: `factura-quipu-${invoice.id}.pdf`, base64: invoice.pdf.toString('base64') } : null,
        subject: due ? `Informe de actualización + factura (${period})` : `Informe de actualización (${period})`,
        idempotencyKey: `billing-test-${client.id}-${period}`,
      }, reports.length);
      results.push({ clientId: client.id, status: 'PREPARED_NOT_SENT' });
    } catch {
      await store.reviewRun(client.id, period);
      results.push({ clientId: client.id, status: 'REVIEW_REQUIRED' });
    }
  }
  return results;
}

export async function collectPayments(store: Store, quipu: Pick<QuipuClient, 'get'>,
  stripe: Pick<StripeTestClient, 'charge'>, owner: string, period: string, apply = false) {
  validPeriod(period);
  const results: Array<{ clientId: string; status: string }> = [];
  for (const client of await store.clients()) {
    if (client.payment_mode !== 'stripe_sepa') { results.push({ clientId: client.id, status: 'MANUAL_PAYMENT' }); continue; }
    if (!invoiceDue(client, period)) { results.push({ clientId: client.id, status: 'NOT_DUE' }); continue; }
    const invoice = await store.invoice(client.id, period);
    if (!invoice) { results.push({ clientId: client.id, status: 'MISSING_INVOICE' }); continue; }
    if (!client.stripe_customer_id || !client.payment_method_id || !client.mandate_id) {
      results.push({ clientId: client.id, status: 'NO_ACCEPTED_MANDATE' }); continue;
    }
    if (!apply) { results.push({ clientId: client.id, status: 'WOULD_CHECK_TEST_PAYMENT' }); continue; }
    // Re-read the source of truth immediately before attempting a collection.
    const current = await quipu.get(invoice.id, period);
    if (!sameInvoice(invoice, current) || current.paymentStatus !== 'unpaid') {
      results.push({ clientId: client.id, status: 'INVOICE_REVIEW_REQUIRED' }); continue;
    }
    // Durable claim BEFORE the external request. Never automatically retry an
    // ambiguous submission, even after Stripe's 24-hour idempotency retention.
    if (!await store.claimPayment(invoice.id)) { results.push({ clientId: client.id, status: 'NOT_READY_OR_ALREADY_CLAIMED' }); continue; }
    try {
      const payment = await stripe.charge(invoice, owner, { customerId: client.stripe_customer_id,
        paymentMethodId: client.payment_method_id, mandateId: client.mandate_id });
      if (payment.livemode !== false || payment.amount !== invoice.amountCents || payment.currency !== 'eur') throw new Error('Payment mismatch');
      await store.savePayment(invoice.id, payment.id, payment.status);
      results.push({ clientId: client.id, status: payment.status });
    } catch {
      await store.savePayment(invoice.id, null, 'REVIEW_REQUIRED');
      results.push({ clientId: client.id, status: 'REVIEW_REQUIRED' });
    }
  }
  return results;
}

export function pdfHash(pdf: Buffer) { return createHash('sha256').update(new Uint8Array(pdf)).digest('hex'); }
