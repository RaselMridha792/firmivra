// End-to-end: R7, refunds (POST /business/invoices/{id}/payments/{paymentId}/refunds) and the
// refund webhooks (charge.refunded, refund.failed), against the fake Stripe.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chargeOf, FakeStripeGateway } from '../../src/payments/stripe/fake-stripe.js';
import { codeOf, expectOk, Invoice, nyDay, startInvoiceApp } from './invoice-setup.js';
import { deliverEvent, stripeEvent } from './stripe-events.js';

const fake = new FakeStripeGateway();
let t: Awaited<ReturnType<typeof startInvoiceApp>>;
beforeAll(async () => {
  t = await startInvoiceApp('r7r', fake);
});
afterAll(async () => {
  await t.app.close();
});
const acct = () => `acct_${t.run}A`;

/** A PAID invoice of 300.00 through checkout and the webhook: the invoice and its payment. */
async function paid(cents = 30_000) {
  const draft = Invoice.parse(
    expectOk(
      await t.firm('post', '', t.people.ownerA, {
        clientId: t.ids.one,
        lines: [{ description: 'Advisory', unitAmountCents: cents }],
        dueOn: nyDay(20),
      }),
    ).body,
  );
  expectOk(await t.firm('post', `/${draft.id}/send`, t.people.ownerA, {}));
  expectOk(await t.portal('post', `/${draft.id}/checkout`, t.people.primary, {}));
  const payment = await t.inScope(t.ids.firmA, (tx) =>
    tx.payment.findFirstOrThrow({ where: { invoiceId: draft.id } }),
  );
  const intent = fake.sessions.get(payment.processorRef)!.paymentIntentId!;
  fake.setSession(payment.processorRef, { status: 'complete' });
  expectOk(
    await deliverEvent(
      t.app,
      stripeEvent('checkout.session.completed', acct(), {
        id: payment.processorRef,
        payment_status: 'paid',
        amount_total: cents,
        payment_intent: intent,
        metadata: { payment_id: payment.id },
      }),
    ),
  );
  return { invoiceId: draft.id, paymentId: payment.id, intent };
}
const refund = (
  invoiceId: string,
  paymentId: string,
  amountCents: number,
  idempotencyKey: string = randomUUID(),
  who = t.people.ownerA,
  businessId?: string,
) =>
  t.firm(
    'post',
    `/${invoiceId}/payments/${paymentId}/refunds`,
    who,
    { amountCents, idempotencyKey },
    businessId,
  );
const refunded = (intent: string) =>
  deliverEvent(
    t.app,
    stripeEvent('charge.refunded', acct(), {
      id: chargeOf(intent),
      object: 'charge',
      payment_intent: intent,
    }),
  );
const paymentOf = async (invoiceId: string) =>
  Invoice.parse(expectOk(await t.firm('get', `/${invoiceId}`, t.people.ownerA)).body).payments[0]!;

describe('refunds', () => {
  it('refunds part, once per key, then the rest; the webhook confirms each and the payment ends REFUNDED', async () => {
    const { invoiceId, paymentId, intent } = await paid();
    const key = randomUUID();
    const first = Invoice.parse(expectOk(await refund(invoiceId, paymentId, 10_000, key)).body);
    expect(first.status).toBe('PAID');
    expect(first.payments[0]).toMatchObject({ refundableCents: 20_000, refundedCents: 0 });
    expect(first.payments[0]!.refunds.map((r) => [r.status, r.amountCents])).toEqual([
      ['PENDING', 10_000],
    ]);
    const call = fake.calls.filter((c) => c.method === 'createRefund').at(-1)!;
    expect(call.params).toMatchObject({
      paymentIntentId: intent,
      amountCents: 10_000,
      refundKey: key,
      idempotencyKey: `${t.ids.firmA}:${paymentId}:${key}`,
    });
    // A double click with the same key refunds once.
    expectOk(await refund(invoiceId, paymentId, 10_000, key));
    expect((await paymentOf(invoiceId)).refunds).toHaveLength(1);
    const tooMuch = await refund(invoiceId, paymentId, 25_000);
    expect([tooMuch.status, codeOf(tooMuch)]).toEqual([409, 'REFUND_TOO_LARGE']);

    expectOk(await refunded(intent));
    expect(await paymentOf(invoiceId)).toMatchObject({
      status: 'SUCCEEDED',
      refundedCents: 10_000,
    });

    const key2 = randomUUID();
    expectOk(await refund(invoiceId, paymentId, 20_000, key2));
    expectOk(await refunded(intent));
    const done = await paymentOf(invoiceId);
    expect(done).toMatchObject({ status: 'REFUNDED', refundedCents: 30_000, refundableCents: 0 });
    expect(done.refunds.every((r) => r.status === 'SUCCEEDED')).toBe(true);
    // A retry of the last refund after it used the payment up answers 200; a new one is refused.
    expectOk(await refund(invoiceId, paymentId, 20_000, key2));
    expect((await paymentOf(invoiceId)).refunds).toHaveLength(2);
    const more = await refund(invoiceId, paymentId, 1);
    expect([more.status, codeOf(more)]).toEqual([409, 'NOT_REFUNDABLE']);
    const audit = await t.inScope(t.ids.firmA, (tx) =>
      tx.auditLog.findMany({ where: { entityId: paymentId }, select: { action: true } }),
    );
    expect(audit.map((a) => a.action).filter((a) => a.startsWith('payment.refund'))).toEqual([
      'payment.refund_requested',
      'payment.refunded',
      'payment.refund_requested',
      'payment.refunded',
    ]);
  });

  it("records a refund made in the firm's Stripe dashboard, and a failed refund frees its cents", async () => {
    const { invoiceId, paymentId, intent } = await paid(5_000);
    fake.dashboardRefund(acct(), intent, 1_000);
    expectOk(await refunded(intent));
    const p = await paymentOf(invoiceId);
    expect(p).toMatchObject({ refundedCents: 1_000, refundableCents: 4_000 });

    expectOk(await refund(invoiceId, paymentId, 2_000));
    const pending = (await paymentOf(invoiceId)).refunds.find((r) => r.status === 'PENDING')!;
    const row = await t.inScope(t.ids.firmA, (tx) =>
      tx.paymentRefund.findUniqueOrThrow({ where: { id: pending.id } }),
    );
    expectOk(
      await deliverEvent(
        t.app,
        stripeEvent('refund.failed', acct(), {
          id: row.processorRefundId,
          object: 'refund',
          status: 'failed',
        }),
      ),
    );
    expect(await paymentOf(invoiceId)).toMatchObject({ refundableCents: 4_000 });
    expect((await paymentOf(invoiceId)).refunds.map((r) => r.status).sort()).toEqual([
      'FAILED',
      'SUCCEEDED',
    ]);
  });

  it('gives Staff 403, firm B and a payment of another invoice 404', async () => {
    const a = await paid(2_000);
    const b = await paid(2_000);
    const staff = await refund(a.invoiceId, a.paymentId, 100, randomUUID(), t.people.staffA);
    expect([staff.status, codeOf(staff)]).toEqual([403, 'FORBIDDEN']);
    for (const res of [
      await refund(a.invoiceId, a.paymentId, 100, randomUUID(), t.people.ownerB, t.ids.firmB),
      await refund(a.invoiceId, b.paymentId, 100),
    ]) {
      expect([res.status, codeOf(res)]).toEqual([404, 'NOT_FOUND']);
    }
    expect((await paymentOf(a.invoiceId)).refunds).toEqual([]);
  });
});
