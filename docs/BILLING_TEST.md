# Quipu → Actualizador WP → optional Stripe: isolated test implementation

This branch is a **test implementation, not an activated production integration**.
The existing panel, manual invoice uploads, SMTP route and production schedule are
preserved. The only legacy execution change makes `dryRun=1` genuinely read-only.
Quipu remains the sole issuer of invoices. Stripe uses Setup-mode Checkout and
PaymentIntents, never Stripe Billing invoices or subscriptions.

## What works in code

- Quipu OAuth Client Credentials with Basic authentication and `scope=ecommerce`.
- Owner-prefixed v1 API; pagination; serial rate limiting; final income invoices
  only; exact decimal conversion; PDF content/size validation.
- Explicit Quipu contact → billing client mapping. No matching by customer name or
  guessed email. Multiple invoices for a contact/period require review.
- Immutable PDF import into a private test database, separate from Vercel Blob
  and the existing production tables. Original PDF bytes and SHA-256 retained.
- Monthly and quarterly invoice rules, grouped report payload compatible with
  `/api/send`. In tests, WordPress uses the existing demo handler and email is
  saved in a private outbox. **No SMTP delivery and no WordPress mutation.**
- Payment mode defaults to manual. Stripe mode can only be associated through a
  succeeded SetupIntent with the expected client metadata. An active accepted
  multi-use SEPA mandate and PaymentMethod ownership are checked again on charge.
- Fresh Quipu invoice read before each test charge; paid/partially paid/changed
  invoices blocked. Quipu receives no invoice writes or payment-status updates.
- Durable payment claim plus a stable Stripe idempotency key. An ambiguous
  submission is held for review instead of being retried after key expiry.
- Signed test webhooks, five-minute replay window, deduplicated event IDs, and
  current PaymentIntent retrieval under a row lock for out-of-order delivery.
  `processing` is retained as processing; it is not reported as paid.

## Activation requirements (not performed by this change)

1. Provision an isolated PostgreSQL test database with no production data. Run
   `scripts/sql/002_billing_test.sql` there only. No startup migration is provided.
   The environment marker is a second check, not a substitute for separation.
2. Set the following through the operator's normal secret-management interface.
   Do not paste values into tickets, logs, source control or chat:

   | Name | Purpose |
   | --- | --- |
   | `BILLING_INTEGRATION_MODE` | Exactly `test` |
   | `BILLING_TEST_DATABASE_URL` | Dedicated test database, never the production database |
   | `BILLING_TEST_DATABASE_DATABASE_URL` | Vercel Neon-generated equivalent accepted without copying or exposing the secret |
   | `BILLING_TEST_ADMIN_TOKEN` | Dedicated random administrative token, at least 32 characters |
   | `QUIPU_OWNER_SLUG` | Quipu account identifier |
   | `QUIPU_ACCOUNT_CURRENCY` | `EUR`, only after verifying the account currency |
   | `QUIPU_CLIENT_ID`, `QUIPU_CLIENT_SECRET` | Existing Quipu API access, provided by operator |
   | `STRIPE_TEST_SECRET_KEY` | Test key; `sk_live_` is rejected |
   | `STRIPE_TEST_WEBHOOK_SECRET` | Signing secret of the test webhook endpoint |
   | `BILLING_TEST_RETURN_ORIGIN` | HTTPS origin of the isolated preview |

3. Insert test clients into `billing_test.clients` with explicit Quipu contact IDs,
   an intended billing email, fictional demo sites and `enabled=true`. They start
   with `payment_mode=manual`. Only link a deliberately selected Stripe **test**
   customer. Do not import production WordPress tokens.
4. Deploy an isolated preview. `VERCEL_ENV=production` blocks the new endpoints.
   No credentials are inherited or pulled by this branch.

## Test API

`POST /api/billing/test` requires `Authorization: Bearer <BILLING_TEST_ADMIN_TOKEN>`.
Every request includes a `period` of `YYYY-MM`. Requests and errors intentionally
avoid returning PDFs, customer emails, database details or provider error bodies.

| action | Effect |
| --- | --- |
| `plan` | Read Quipu + test mappings; report proposed imports; no DB writes, PDF download, WP or email |
| `sync` | Import eligible PDFs into private test tables only |
| `run` | Sync, prepare grouped demo reports/outbox, then optional Stripe test collection |
| `setup` | Requires `clientId`, unique `attemptId`; returns test Checkout URL |
| `accept-setup` | Requires `clientId`, `setupIntentId`; verifies accepted mandate with Stripe |
| `status` | Lists test run/payment states, without PDF or email content |

The Checkout return URL is informational only; it never enables direct debit.
The operator calls `accept-setup` after acceptance; the server verifies the
SetupIntent, mandate and customer rather than trusting the browser redirect.

`POST /api/billing/stripe-webhook` verifies Stripe signatures instead of the admin
token. Subscribe to `payment_intent.processing`, `payment_intent.succeeded`,
`payment_intent.payment_failed` and `payment_intent.canceled` in **test mode**.
An event that arrives before its local PaymentIntent mapping returns 409 for
provider retry. An ambiguous submission with no saved ID requires reconciliation
using Stripe metadata (`purpose`, `quipu_owner`, `quipu_invoice_id`) before retry.
Never delete a payment claim just to make a retry run.

## Verification and limitations

Run `npm ci --ignore-scripts`, `npm test`, `npm run lint`,
`npx tsc --noEmit --incremental false`, `npm run build`, then `npm run smoke`.
The contract tests use synthetic data and stubbed network responses. They do not
claim live Quipu compatibility, real bank settlement, SMTP delivery, or execution
of SQL against PostgreSQL. Test compilation is separate from the type-check gate.

The repo declares Node 20.x. The local audit ran Node 22.18.0; deployment-runtime
parity remains a separate release gate. Smoke uses portable recursive directory
reads because the old `fs.promises.glob()` usage did not collect its async iterator
and is not available on the declared Node 20 runtime.

## Production cutover still required

- Reconcile each customer's contact ID, due months, service, amount, currency,
  invoice numbering and tax treatment. Create Quipu recurrence templates for day
  5 only after checking existing issued invoices and excluding duplicate periods.
- Account for annual/bimonthly or other exceptions explicitly. This implementation
  deliberately supports only the current monthly/quarterly model.
- Validate one manual client and one SEPA test client end-to-end in the isolated
  database, including SQL constraints, race conditions, refunds/failures and
  mandate revocation. Obtain an explicitly designated SMTP test recipient.
- Wire the validated importer to the production invoice/report store and panel;
  it is currently private test storage, not the panel's live invoice list.
- Unify the scheduled WordPress adapter with the manual handler, fix authenticated
  GET invocation, add durable run recovery/concurrency protection and a bounded
  job budget. Merely adding GET would activate previously dormant updates.
- Schedule after Quipu emission on day 5, with controlled catch-up for late
  invoices. Verify Europe/Madrid vs UTC and do not assume a fixed local UTC offset.
- Verify prenotification and mandate communications in Stripe before any live
  collection. Live payments require a distinct reviewed change; there is no live
  key escape hatch in this implementation.
- Only then deploy production with a fresh rollback snapshot and post-deploy
  read-only verification. Never mark this branch “production complete”.

## Official references checked on 2026-09-04

- [Quipu v1 OpenAPI](https://github.com/quipuapp/api-v1-docs/blob/main/openapi.yaml)
- [Stripe SetupIntents](https://docs.stripe.com/payments/setup-intents)
- [Stripe Checkout Session creation](https://docs.stripe.com/api/checkout/sessions/create)
- [Stripe PaymentIntent creation](https://docs.stripe.com/api/payment_intents/create)
- [Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
