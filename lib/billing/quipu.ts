import { Buffer } from 'node:buffer';

export type QuipuInvoice = {
  id: string;
  contactId: string;
  number: string;
  period: string;
  amountCents: number;
  paymentStatus: string;
};

export function validPeriod(period: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error('Invalid billing period');
  return period;
}

export function cents(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{1,6}(\.\d{1,2})?$/.test(value)) {
    throw new Error('Invalid invoice total');
  }
  const [whole, fraction = ''] = value.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result) || result <= 0 || result > 99999999) throw new Error('Invalid invoice total');
  return result;
}

export function normalizeInvoice(resource: any, period: string): QuipuInvoice {
  validPeriod(period);
  const a = resource?.attributes;
  const contactId = resource?.relationships?.contact?.data?.id;
  if (resource?.type !== 'invoices' || !/^\d+$/.test(resource?.id || '') ||
      !/^\d+$/.test(contactId || '') || a?.kind !== 'income' || a?.stage !== 'final' ||
      typeof a.number !== 'string' || !a.number.trim() ||
      typeof a.issue_date !== 'string' || !a.issue_date.startsWith(period + '-') ||
      !/^\d{4}-\d{2}-\d{2}$/.test(a.issue_date) ||
      !['paid', 'unpaid', 'partially_paid'].includes(a.payment_status)) {
    throw new Error('Invoice is not an eligible final income invoice');
  }
  // Currency is an account-level setting in Quipu v1; EUR must be confirmed in configuration.
  return { id: String(resource.id), contactId: String(contactId), number: a.number,
    period, amountCents: cents(a.total_amount), paymentStatus: a.payment_status };
}

export class QuipuClient {
  private token = '';
  private tokenExpires = 0;
  private lastRequest = 0;
  constructor(private config: { owner: string; clientId: string; clientSecret: string; currency: string },
    private request: typeof fetch = fetch,
    private pause: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms))) {
    if (!/^[a-zA-Z0-9_-]+$/.test(config.owner) || !config.clientId || !config.clientSecret || config.currency !== 'EUR') {
      throw new Error('Quipu configuration incomplete; confirmed EUR account required');
    }
  }

  private async call(path: string, pdf = false): Promise<Response> {
    // Serial requests stay below Quipu's documented 5 requests / 5 seconds per client.
    const wait = Math.max(0, 1100 - (Date.now() - this.lastRequest));
    if (wait) await this.pause(wait);
    this.lastRequest = Date.now();
    if (!this.token || Date.now() >= this.tokenExpires) {
      const r = await this.request('https://getquipu.com/oauth/token', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials&scope=ecommerce',
      });
      if (!r.ok) throw new Error(`Quipu authentication failed (${r.status})`);
      const token = await r.json();
      if (!token.access_token || !Number.isFinite(token.expires_in)) throw new Error('Invalid Quipu token response');
      this.token = token.access_token;
      this.tokenExpires = Date.now() + Math.max(0, token.expires_in - 60) * 1000;
      await this.pause(1100);
      this.lastRequest = Date.now();
    }
    const r = await this.request(`https://getquipu.com/${this.config.owner}${path}`, {
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${this.token}`, Accept: pdf ? 'application/pdf' : 'application/vnd.quipu.v1+json' },
    });
    if (!r.ok) throw new Error(`Quipu request failed (${r.status}); safe to retry the sync`);
    return r;
  }

  async list(period: string): Promise<QuipuInvoice[]> {
    validPeriod(period);
    const invoices = new Map<string, QuipuInvoice>();
    let totalPages = 1;
    for (let page = 1; page <= totalPages; page++) {
      const query = new URLSearchParams({ 'filter[kind]': 'income', 'filter[period]': period,
        'page[number]': String(page), 'page[size]': '100' });
      const data = await (await this.call(`/invoices?${query}`)).json();
      const pagination = data?.meta?.pagination_info;
      if (!Array.isArray(data.data) || !Number.isInteger(pagination?.total_pages) ||
          pagination.total_pages < 0 || pagination.total_pages > 100 || pagination.current_page !== page) {
        throw new Error('Invalid or incomplete Quipu pagination');
      }
      totalPages = Math.max(1, pagination.total_pages);
      for (const resource of data.data) {
        if (resource.attributes?.stage === 'draft') continue;
        const invoice = normalizeInvoice(resource, period);
        const prior = invoices.get(invoice.id);
        if (prior && JSON.stringify(prior) !== JSON.stringify(invoice)) throw new Error('Invoice changed during pagination');
        invoices.set(invoice.id, invoice);
      }
    }
    return [...invoices.values()];
  }

  async get(id: string, period: string) {
    if (!/^\d+$/.test(id)) throw new Error('Invalid Quipu invoice ID');
    return normalizeInvoice((await (await this.call(`/invoices/${id}`)).json()).data, period);
  }

  async pdf(id: string): Promise<Buffer> {
    if (!/^\d+$/.test(id)) throw new Error('Invalid Quipu invoice ID');
    const r = await this.call(`/invoices/${id}/download`, true);
    if (!r.headers.get('content-type')?.includes('application/pdf')) throw new Error('Quipu did not return a PDF');
    const reader = r.body?.getReader();
    if (!reader) throw new Error('Missing PDF body');
    const parts: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('Invoice PDF exceeds 4 MiB'); }
      parts.push(value);
    }
    const pdf = Buffer.concat(parts);
    if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid PDF signature');
    return pdf;
  }
}
