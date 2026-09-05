import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { QuipuInvoice } from './quipu';

export type MandateBinding = { customerId: string; paymentMethodId: string; mandateId: string };
export type Payment = { id: string; status: string; amount: number; currency: string; livemode: false };
export type SubscriptionCharge = { clientId: string; period: string; amountCents: number };

export class StripeTestClient {
  constructor(private key: string, private request: typeof fetch = fetch) {
    if (!/^sk_test_[a-zA-Z0-9]+$/.test(key)) throw new Error('Only Stripe test secret keys are accepted');
  }

  private async call(path: string, body?: Record<string, string>, idempotencyKey?: string): Promise<any> {
    const r = await this.request(`https://api.stripe.com/v1/${path}`, {
      method: body ? 'POST' : 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${this.key}`, 'Stripe-Version': '2024-06-20',
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
      ...(body ? { body: new URLSearchParams(body) } : {}),
    });
    if (!r.ok) throw new Error(`Stripe test request failed (${r.status}); reconcile before retrying payment`);
    const result = await r.json();
    if (result.livemode !== false) throw new Error('Stripe returned a non-test object');
    return result;
  }

  async setup(customerId: string, bindingId: string, returnOrigin: string, attemptId: string) {
    if (!/^cus_[a-zA-Z0-9]+$/.test(customerId) || !/^[a-zA-Z0-9-]{8,80}$/.test(attemptId)) throw new Error('Invalid setup parameters');
    const origin = new URL(returnOrigin);
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/') throw new Error('HTTPS return origin required');
    return this.call('checkout/sessions', {
      mode: 'setup', currency: 'eur', customer: customerId, 'payment_method_types[0]': 'sepa_debit',
      'setup_intent_data[metadata][billing_binding]': bindingId,
      'setup_intent_data[metadata][purpose]': 'actualizador-wp-test',
      success_url: `${origin.origin}/?sepa=test-return`, cancel_url: `${origin.origin}/?sepa=test-cancel`,
    }, `awp-setup-test-${bindingId}-${attemptId}`);
  }

  async acceptedSetup(setupIntentId: string, bindingId: string, customerId: string): Promise<MandateBinding> {
    if (!/^seti_[a-zA-Z0-9]+$/.test(setupIntentId)) throw new Error('Invalid SetupIntent');
    const setup = await this.call(`setup_intents/${setupIntentId}`);
    if (setup.status !== 'succeeded' || setup.customer !== customerId ||
        setup.metadata?.billing_binding !== bindingId || setup.metadata?.purpose !== 'actualizador-wp-test') {
      throw new Error('Setup has not been accepted for this client');
    }
    const binding = { customerId, paymentMethodId: setup.payment_method, mandateId: setup.mandate };
    await this.verifyMandate(binding);
    return binding;
  }

  async verifyMandate(b: MandateBinding) {
    if (!/^cus_[a-zA-Z0-9]+$/.test(b.customerId) || !/^pm_[a-zA-Z0-9]+$/.test(b.paymentMethodId) ||
        !/^mandate_[a-zA-Z0-9]+$/.test(b.mandateId)) throw new Error('Missing accepted SEPA mandate');
    const mandate = await this.call(`mandates/${b.mandateId}`);
    const method = await this.call(`payment_methods/${b.paymentMethodId}`);
    if (mandate.status !== 'active' || mandate.type !== 'multi_use' || mandate.payment_method !== b.paymentMethodId ||
        !mandate.customer_acceptance?.accepted_at || method.type !== 'sepa_debit' || method.customer !== b.customerId) {
      throw new Error('SEPA mandate is inactive or belongs to a different client');
    }
  }

  async charge(invoice: QuipuInvoice, owner: string, b: MandateBinding): Promise<Payment> {
    if (invoice.paymentStatus !== 'unpaid') throw new Error('Invoice is already paid or partially paid');
    if (!Number.isSafeInteger(invoice.amountCents) || invoice.amountCents < 1 || invoice.amountCents > 99999999) throw new Error('Invalid charge amount');
    await this.verifyMandate(b);
    const stable = createHash('sha256').update(`${owner}:${invoice.id}`).digest('hex');
    return this.call('payment_intents', {
      amount: String(invoice.amountCents), currency: 'eur', customer: b.customerId,
      payment_method: b.paymentMethodId, mandate: b.mandateId,
      'payment_method_types[0]': 'sepa_debit', confirm: 'true', off_session: 'true',
      'metadata[quipu_invoice_id]': invoice.id, 'metadata[quipu_owner]': owner,
      'metadata[purpose]': 'actualizador-wp-test',
    }, `awp-quipu-test-${stable}`);
  }

  async chargeSubscription(charge: SubscriptionCharge, b: MandateBinding): Promise<Payment> {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(String(charge.clientId)) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(charge.period) ||
        !Number.isSafeInteger(charge.amountCents) || charge.amountCents < 1 || charge.amountCents > 99999999) {
      throw new Error('Invalid fixed charge');
    }
    await this.verifyMandate(b);
    const stable = createHash('sha256').update(`${charge.clientId}:${charge.period}`).digest('hex');
    return this.call('payment_intents', {
      amount: String(charge.amountCents), currency: 'eur', customer: b.customerId,
      payment_method: b.paymentMethodId, mandate: b.mandateId,
      'payment_method_types[0]': 'sepa_debit', confirm: 'true', off_session: 'true',
      'metadata[billing_client_id]': String(charge.clientId), 'metadata[billing_period]': charge.period,
      'metadata[purpose]': 'actualizador-wp-subscription-test',
    }, `awp-subscription-test-${stable}`);
  }

  async payment(id: string): Promise<Payment & { metadata: Record<string, string>; customer: string }> {
    if (!/^pi_[a-zA-Z0-9]+$/.test(id)) throw new Error('Invalid PaymentIntent');
    return this.call(`payment_intents/${id}`);
  }
}

export function verifyStripeEvent(raw: string, header: string, secret: string, now = Date.now()) {
  if (!secret || Buffer.byteLength(raw) > 1024 * 1024) throw new Error('Invalid webhook');
  const fields = header.split(',').map(x => x.split('='));
  const timestamp = fields.find(([k]) => k === 't')?.[1] || '';
  if (!/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300) throw new Error('Expired webhook');
  const expected = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest();
  if (!fields.some(([k, v]) => k === 'v1' && /^[a-f0-9]{64}$/.test(v) && timingSafeEqual(new Uint8Array(expected), new Uint8Array(Buffer.from(v, 'hex'))))) {
    throw new Error('Invalid webhook signature');
  }
  const event = JSON.parse(raw);
  if (event.livemode !== false || typeof event.id !== 'string' || !event.id.startsWith('evt_')) throw new Error('Only test events are accepted');
  return event;
}
