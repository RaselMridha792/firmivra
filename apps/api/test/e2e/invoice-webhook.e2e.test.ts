// End-to-end: R7, Stripe's webhook (POST /api/v1/webhooks/stripe) with signed test events: the
// signature on the raw body, duplicates, a declined card then a good one, bank debits that settle
// or fail, expired checkouts, account.updated, and events from one firm's account never touching
// another firm.
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { FakeStripeGateway } from '../../src/payments/stripe/fake-stripe.js';
import { StripeWebhookService } from '../../src/payments/webhooks/stripe-webhook.service.js';
import { expectOk, Invoice, nyDay, startInvoiceApp, TEST_WEBHOOK_SECRET } from './invoice-setup.js';

const fake = new FakeStripeGateway();
let t: Awaited<ReturnType<typeof startInvoiceApp>>;
const accountB = () => `acct_${t.run}B`;
beforeAll(async () => {
  t = await startInvoiceApp('r7w', fake);
  // Firm B has a Stripe account that cannot take charges yet.
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, (tx) =>
    tx.stripeAccount.create({ data: { businessId: t.ids.firmB, accountId: accountB() } }),
  );
  await owner.$disconnect();
});
afterAll(async () => {
  await t.app.close();
});

const accountA = () => `acct_${t.run}A`;
const event = (type: string, account: string | null, object: object) => ({
  id: `evt_${randomBytes(10).toString('hex')}`,
  object: 'event',
  type,
  account,
  api_version: '2026-09-30.endive',
  created: Math.floor(Date.now() / 1000),
  livemode: false,
  pending_webhooks: 1,
  request: null,
  data: { object },
});
const deliver = (body: object, signature?: string) => {
  const payload = JSON.stringify(body);
  const header =
    signature ?? Stripe.webhooks.generateTestHeaderString({ payload, secret: TEST_WEBHOOK_SECRET });
  return request(t.app.getHttpServer())
    .post('/api/v1/webhooks/stripe')
    .set('content-type', 'application/json')
    .set('stripe-signature', header)
    .send(payload);
};

/** An open invoice of client one with a checkout started: its invoice and PENDING payment. */
async function checkoutStarted(cents = 30_000) {
  const draft = Invoice.parse(
    expectOk(
      await t.firm('post', '', t.people.ownerA, {
        clientId: t.ids.one,
        lines: [{ description: 'Payroll', unitAmountCents: cents }],
        dueOn: nyDay(20),
      }),
    ).body,
  );
  expectOk(await t.firm('post', `/${draft.id}/send`, t.people.ownerA, {}));
  expectOk(await t.portal('post', `/${draft.id}/checkout`, t.people.primary, {}));
  const payment = await t.inScope(t.ids.firmA, (tx) =>
    tx.payment.findFirstOrThrow({ where: { invoiceId: draft.id } }),
  );
  return { invoiceId: draft.id, payment };
}
const session = (
  p: { id: string; processorRef: string; amountCents: number },
  extra: object = {},
) => ({
  id: p.processorRef,
  object: 'checkout.session',
  payment_status: 'paid',
  amount_total: p.amountCents,
  currency: 'usd',
  payment_intent: `pi_${p.id.replace(/-/g, '')}`,
  metadata: { payment_id: p.id, invoice_id: 'x' },
  ...extra,
});
const stateOf = (invoiceId: string) =>
  t.inScope(t.ids.firmA, async (tx) => ({
    invoice: (await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status,
    payments: (await tx.payment.findMany({ where: { invoiceId } })).map((p) => [
      p.status,
      p.failureCode,
    ]),
  }));
const eventsIn = (businessId: string, id: string) =>
  t.inScope(businessId, (tx) =>
    tx.paymentEvent.findMany({ where: { businessId, processorEventId: id } }),
  );

describe('POST /webhooks/stripe', () => {
  it('refuses a bad or missing signature with 400 and records nothing', async () => {
    const e = event('checkout.session.expired', accountA(), {});
    const bad = await deliver(e, 't=1,v1=00');
    expect(bad.status).toBe(400);
    const none = await request(t.app.getHttpServer())
      .post('/api/v1/webhooks/stripe')
      .set('content-type', 'application/json')
      .send(JSON.stringify(e));
    expect(none.status).toBe(400);
    expect(await eventsIn(t.ids.firmA, e.id)).toEqual([]);
  });

  it('a declined card then a good one in the same session ends PAID with one SUCCEEDED payment', async () => {
    const { invoiceId, payment } = await checkoutStarted();
    const declined = event('payment_intent.payment_failed', accountA(), {
      id: `pi_${payment.id.replace(/-/g, '')}`,
      object: 'payment_intent',
      metadata: { payment_id: payment.id },
    });
    expectOk(await deliver(declined));
    expect(await stateOf(invoiceId)).toEqual({ invoice: 'OPEN', payments: [['PENDING', null]] });
    // The declined card is not "processing": the client can still pay.
    const mine = await t.portal('get', `/${invoiceId}`, t.people.primary);
    expect((mine.body as { canPay: boolean }).canPay).toBe(true);

    const paid = event('checkout.session.completed', accountA(), session(payment));
    expectOk(await deliver(paid));
    expect(await stateOf(invoiceId)).toEqual({ invoice: 'PAID', payments: [['SUCCEEDED', null]] });
    // Stripe's second event for the same payment, and a duplicate delivery, change nothing.
    expectOk(
      await deliver(
        event('payment_intent.succeeded', accountA(), {
          object: 'payment_intent',
          amount_received: payment.amountCents,
          metadata: { payment_id: payment.id },
        }),
      ),
    );
    expectOk(await deliver(paid));
    expect(await eventsIn(t.ids.firmA, paid.id)).toHaveLength(1);
    expect(await stateOf(invoiceId)).toEqual({ invoice: 'PAID', payments: [['SUCCEEDED', null]] });
    const audit = await t.inScope(t.ids.firmA, (tx) =>
      tx.auditLog.findMany({
        where: {
          entityId: { in: [invoiceId, payment.id] },
          action: { in: ['payment.succeeded', 'invoice.paid'] },
        },
        select: { action: true, actorUserId: true },
      }),
    );
    expect(audit.map((a) => a.action).sort()).toEqual(['invoice.paid', 'payment.succeeded']);
    expect(audit.every((a) => a.actorUserId === null)).toBe(true);
  });

  it('never trusts an amount that differs from the payment', async () => {
    const { invoiceId, payment } = await checkoutStarted();
    expectOk(
      await deliver(
        event('checkout.session.completed', accountA(), session(payment, { amount_total: 1 })),
      ),
    );
    expect(await stateOf(invoiceId)).toEqual({ invoice: 'OPEN', payments: [['PENDING', null]] });
  });

  it('shows a bank debit as processing, then FAILED with Stripe’s code; an expired checkout fails too', async () => {
    const { invoiceId, payment } = await checkoutStarted();
    expectOk(
      await deliver(
        event(
          'checkout.session.completed',
          accountA(),
          session(payment, { payment_status: 'unpaid' }),
        ),
      ),
    );
    const mine = await t.portal('get', `/${invoiceId}`, t.people.primary);
    expect(mine.body).toMatchObject({ paymentProcessing: true, canPay: false });
    fake.failureCodes.set(`pi_${payment.id.replace(/-/g, '')}`, 'insufficient_funds');
    expectOk(
      await deliver(event('checkout.session.async_payment_failed', accountA(), session(payment))),
    );
    expect(await stateOf(invoiceId)).toEqual({
      invoice: 'OPEN',
      payments: [['FAILED', 'insufficient_funds']],
    });

    const other = await checkoutStarted();
    expectOk(await deliver(event('checkout.session.expired', accountA(), session(other.payment))));
    expect(await stateOf(other.invoiceId)).toEqual({
      invoice: 'OPEN',
      payments: [['FAILED', 'checkout_expired']],
    });
  });

  it("an event from firm B's account never touches firm A's payment", async () => {
    const { invoiceId, payment } = await checkoutStarted();
    const e = event('checkout.session.completed', accountB(), session(payment));
    expectOk(await deliver(e));
    expect(await stateOf(invoiceId)).toEqual({ invoice: 'OPEN', payments: [['PENDING', null]] });
    const [recorded] = await eventsIn(t.ids.firmB, e.id);
    expect(recorded).toMatchObject({ businessId: t.ids.firmB, paymentId: null });
    expect(await eventsIn(t.ids.firmA, e.id)).toEqual([]);
  });

  it('ignores an unknown account and updates the firm’s own row on account.updated', async () => {
    const unknown = event('checkout.session.completed', 'acct_unknown000', {});
    expectOk(await deliver(unknown));
    // Stripe's current state is what counts, not the event's copy (events can come out of order).
    fake.accounts.set(accountB(), {
      id: accountB(),
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      requirements: { currently_due: [], past_due: [], disabled_reason: null },
    });
    const stale = event('account.updated', accountB(), {
      id: accountB(),
      object: 'account',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      requirements: { currently_due: ['x'], past_due: [], disabled_reason: null },
    });
    // Stripe down: 503 and nothing recorded, so Stripe's retry is acted on.
    fake.down = true;
    try {
      expect((await deliver(stale)).status).toBe(503);
    } finally {
      fake.down = false;
    }
    expect(await eventsIn(t.ids.firmB, stale.id)).toEqual([]);
    expectOk(await deliver(stale));
    expect(await eventsIn(t.ids.firmB, stale.id)).toHaveLength(1);
    const row = await t.inScope(t.ids.firmB, (tx) =>
      tx.stripeAccount.findUniqueOrThrow({ where: { businessId: t.ids.firmB } }),
    );
    expect(row).toMatchObject({ onboardingStatus: 'COMPLETE', chargesEnabled: true });
    const a = await t.inScope(t.ids.firmA, (tx) =>
      tx.stripeAccount.findUniqueOrThrow({ where: { businessId: t.ids.firmA } }),
    );
    expect(a.accountId).toBe(accountA());
  });

  it('refuses an old signature with 400; no webhook secret or no Stripe key is 503', async () => {
    const e = event('checkout.session.expired', accountA(), {});
    const payload = JSON.stringify(e);
    const old = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: TEST_WEBHOOK_SECRET,
      timestamp: Math.floor(Date.now() / 1000) - 600,
    });
    expect((await deliver(e, old)).status).toBe(400);
    const service = t.app.get(StripeWebhookService) as unknown as Record<string, unknown>;
    for (const field of ['secret', 'stripe']) {
      const kept = service[field];
      service[field] = null;
      try {
        const res = await deliver(e);
        expect([res.status, (res.body as { error?: { code: string } }).error?.code]).toEqual([
          503,
          'PAYMENT_PROVIDER_UNAVAILABLE',
        ]);
      } finally {
        service[field] = kept;
      }
    }
    expect(await eventsIn(t.ids.firmA, e.id)).toEqual([]);
  });

  it('acts only on events of the key’s mode', async () => {
    const { invoiceId, payment } = await checkoutStarted();
    const live = { ...event('checkout.session.completed', accountA(), session(payment)) };
    live.livemode = true;
    expectOk(await deliver(live));
    expect(await stateOf(invoiceId)).toEqual({ invoice: 'OPEN', payments: [['PENDING', null]] });
    expect(await eventsIn(t.ids.firmA, live.id)).toEqual([]);
  });

  it('acts only on the payment’s own session, in its own currency', async () => {
    const { invoiceId, payment } = await checkoutStarted();
    for (const forged of [
      session(payment, { id: 'cs_test_forged123' }),
      session(payment, { currency: 'jpy' }),
    ]) {
      const e = event('checkout.session.completed', accountA(), forged);
      expectOk(await deliver(e));
      expect((await eventsIn(t.ids.firmA, e.id))[0]).toMatchObject({ paymentId: null });
    }
    expect(await stateOf(invoiceId)).toEqual({ invoice: 'OPEN', payments: [['PENDING', null]] });
  });

  it('settles a bank debit on payment_intent.succeeded only for the intent of its own session', async () => {
    const { invoiceId, payment } = await checkoutStarted();
    const intent = (id: string) =>
      event('payment_intent.succeeded', accountA(), {
        id,
        object: 'payment_intent',
        amount_received: payment.amountCents,
        currency: 'usd',
        metadata: { payment_id: payment.id },
      });
    fake.setSession(payment.processorRef, { status: 'complete', paymentIntentId: 'pi_real1' });
    expectOk(await deliver(intent('pi_other1')));
    expect(await stateOf(invoiceId)).toEqual({ invoice: 'OPEN', payments: [['PENDING', null]] });
    expectOk(await deliver(intent('pi_real1')));
    expect(await stateOf(invoiceId)).toEqual({ invoice: 'PAID', payments: [['SUCCEEDED', null]] });
  });

  it('takes both success events at once: one SUCCEEDED payment, both 200', async () => {
    const { invoiceId, payment } = await checkoutStarted();
    fake.setSession(payment.processorRef, { status: 'complete', paymentIntentId: 'pi_both1' });
    const results = await Promise.all([
      deliver(event('checkout.session.completed', accountA(), session(payment))),
      deliver(
        event('payment_intent.succeeded', accountA(), {
          id: 'pi_both1',
          object: 'payment_intent',
          amount_received: payment.amountCents,
          currency: 'usd',
          metadata: { payment_id: payment.id },
        }),
      ),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await stateOf(invoiceId)).toEqual({ invoice: 'PAID', payments: [['SUCCEEDED', null]] });
    const audits = await t.inScope(t.ids.firmA, (tx) =>
      tx.auditLog.count({ where: { entityId: payment.id, action: 'payment.succeeded' } }),
    );
    expect(audits).toBe(1);
  });

  it('never fails a payment that already succeeded', async () => {
    const { invoiceId, payment } = await checkoutStarted();
    expectOk(await deliver(event('checkout.session.completed', accountA(), session(payment))));
    for (const type of ['checkout.session.expired', 'checkout.session.async_payment_failed']) {
      expectOk(await deliver(event(type, accountA(), session(payment))));
    }
    expect(await stateOf(invoiceId)).toEqual({ invoice: 'PAID', payments: [['SUCCEEDED', null]] });
  });
});
