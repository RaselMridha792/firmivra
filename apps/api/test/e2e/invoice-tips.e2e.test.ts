// End-to-end: Q22 (I-N05, R1-4), a tip at Pay Now (POST /portal/{firmSlug}/me/invoices/{id}/checkout
// with `tipCents`), against the fake Stripe. The approved tip plan: offered only while the invoice
// allows a tip and Settings > Payments' Tipping is on (checked again under the row lock); one session
// on the firm's own account with a "Tip" line; the webhook checks total = invoice part + tip; the
// tip never pays the invoice; it is refundable with the payment. Synthetic data only.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MyInvoiceDetail } from '@firmivra/types';
import { chargeOf, FakeStripeGateway } from '../../src/payments/stripe/fake-stripe.js';
import { codeOf, expectOk, Invoice, nyDay, startInvoiceApp } from './invoice-setup.js';
import { deliverEvent, stripeEvent } from './stripe-events.js';

const fake = new FakeStripeGateway();
let t: Awaited<ReturnType<typeof startInvoiceApp>>;
beforeAll(async () => {
  t = await startInvoiceApp('q22t', fake);
});
afterAll(async () => {
  await t.app.close();
});
const acct = () => `acct_${t.run}A`;

/** Settings > Payments' Tipping switch. */
const tipping = (on: boolean) =>
  t.inScope(t.ids.firmA, (tx) =>
    tx.paymentSettings.upsert({
      where: { businessId: t.ids.firmA },
      create: { businessId: t.ids.firmA, tippingEnabled: on },
      update: { tippingEnabled: on },
    }),
  );
/** A sent invoice of `cents`; `allowTip` needs Tipping on while it is made. */
async function open(cents = 20_000, allowTip = true) {
  await tipping(true);
  const draft = Invoice.parse(
    expectOk(
      await t.firm('post', '', t.people.ownerA, {
        clientId: t.ids.one,
        lines: [{ description: 'Tax return (fake)', unitAmountCents: cents }],
        dueOn: nyDay(30),
        allowTip,
      }),
    ).body,
  );
  return Invoice.parse(
    expectOk(await t.firm('post', `/${draft.id}/send`, t.people.ownerA, {})).body,
  );
}
const pay = (id: string, body: object = {}) =>
  t.portal('post', `/${id}/checkout`, t.people.primary, body);
const mine = async (id: string) =>
  MyInvoiceDetail.parse(expectOk(await t.portal('get', `/${id}`, t.people.primary)).body);
const firmView = async (id: string) =>
  Invoice.parse(expectOk(await t.firm('get', `/${id}`, t.people.ownerA)).body);
const pendingOf = (invoiceId: string) =>
  t.inScope(t.ids.firmA, (tx) =>
    tx.payment.findMany({ where: { invoiceId, status: 'PENDING' }, orderBy: { createdAt: 'asc' } }),
  );
const creates = () => fake.calls.filter((c) => c.method === 'createCheckoutSession');
/** Stripe says the session was paid `amountTotal` (the webhook). */
async function complete(invoiceId: string, amountTotal: number) {
  const [payment] = await pendingOf(invoiceId);
  const intent = fake.sessions.get(payment!.processorRef)!.paymentIntentId!;
  fake.setSession(payment!.processorRef, { status: 'complete' });
  expectOk(
    await deliverEvent(
      t.app,
      stripeEvent('checkout.session.completed', acct(), {
        id: payment!.processorRef,
        payment_status: 'paid',
        amount_total: amountTotal,
        currency: 'usd',
        payment_intent: intent,
        metadata: { payment_id: payment!.id },
      }),
    ),
  );
  return { paymentId: payment!.id, intent };
}

describe('a tip at Pay Now', () => {
  it('charges balance + tip in one session with a Tip line; the invoice is PAID with the tip apart', async () => {
    const invoice = await open(20_000);
    expect(await mine(invoice.id)).toMatchObject({ canPay: true, tipOffered: true });

    expectOk(await pay(invoice.id, { tipCents: 3_000 }));
    expect(creates().at(-1)).toMatchObject({
      accountId: acct(),
      params: { invoiceId: invoice.id, amountCents: 20_000, tipCents: 3_000 },
    });
    const [row] = await pendingOf(invoice.id);
    expect(row).toMatchObject({ amountCents: 20_000, tipCents: 3_000 });
    expect(fake.sessions.get(row!.processorRef)!.amountTotal).toBe(23_000);
    const started = await t.inScope(t.ids.firmA, (tx) =>
      tx.auditLog.findFirstOrThrow({
        where: { action: 'invoice.checkout_started', entityId: invoice.id },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(started.metadata).toMatchObject({ amountCents: 20_000, tipCents: 3_000 });

    await complete(invoice.id, 23_000);
    const paid = await firmView(invoice.id);
    // The tip never pays the invoice: paid 200.00, nothing left, no overpayment.
    expect(paid).toMatchObject({ status: 'PAID', amountPaidCents: 20_000, balanceDueCents: 0 });
    expect(paid.payments[0]).toMatchObject({
      status: 'SUCCEEDED',
      amountCents: 20_000,
      tipCents: 3_000,
      refundableCents: 23_000,
    });
    expect((await mine(invoice.id)).payments[0]).toMatchObject({
      amountCents: 20_000,
      tipCents: 3_000,
    });
  });

  it('answers the same checkout for the same tip, and makes a new one when the tip changes', async () => {
    const invoice = await open(10_000);
    const before = creates().length;
    const first = expectOk(await pay(invoice.id, { tipCents: 1_000 })).body as { url: string };
    const again = expectOk(await pay(invoice.id, { tipCents: 1_000 })).body as { url: string };
    expect(again.url).toBe(first.url);
    expect(creates()).toHaveLength(before + 1);

    const changed = expectOk(await pay(invoice.id, { tipCents: 1_500 })).body as { url: string };
    expect(changed.url).not.toBe(first.url);
    expect(creates()).toHaveLength(before + 2);
    const open2 = await pendingOf(invoice.id);
    expect(open2.map((p) => p.tipCents)).toEqual([1_500]);
    // No tip is its own amount too.
    expectOk(await pay(invoice.id));
    expect((await pendingOf(invoice.id)).map((p) => p.tipCents)).toEqual([0]);
  });

  it('refuses a tip while Tipping is off or the invoice does not allow one, and a tip over the limit', async () => {
    const allowed = await open(10_000);
    const plain = await open(10_000, false);
    expect((await mine(plain.id)).tipOffered).toBe(false);
    const refused = await pay(plain.id, { tipCents: 500 });
    expect([refused.status, codeOf(refused)]).toEqual([409, 'TIP_NOT_OFFERED']);
    // No tip is still fine there.
    expectOk(await pay(plain.id, { tipCents: 0 }));

    for (const tipCents of [10_001, -1, 12.5]) {
      const bad = await pay(allowed.id, { tipCents });
      expect([bad.status, codeOf(bad)]).toEqual([400, 'VALIDATION_FAILED']);
    }
    // The whole balance as a tip is the most.
    expectOk(await pay(allowed.id, { tipCents: 10_000 }));

    // Turning Tipping off stops tips at once, even on an invoice that allows them.
    await tipping(false);
    expect((await mine(allowed.id)).tipOffered).toBe(false);
    const off = await pay(allowed.id, { tipCents: 500 });
    expect([off.status, codeOf(off)]).toEqual([409, 'TIP_NOT_OFFERED']);
    expect(await pendingOf(allowed.id)).toMatchObject([{ tipCents: 10_000 }]);
    await tipping(true);
  });

  it('never marks the invoice paid when Stripe reports the total without the tip', async () => {
    const invoice = await open(15_000);
    expectOk(await pay(invoice.id, { tipCents: 2_000 }));
    await complete(invoice.id, 15_000);
    const view = await firmView(invoice.id);
    expect(view.status).toBe('OPEN');
    expect(view.balanceDueCents).toBe(15_000);
  });

  it('refunds the payment with its tip, then nothing more; the payment ends REFUNDED', async () => {
    const invoice = await open(12_000);
    expectOk(await pay(invoice.id, { tipCents: 1_800 }));
    const { paymentId, intent } = await complete(invoice.id, 13_800);
    const refund = (amountCents: number) =>
      t.firm('post', `/${invoice.id}/payments/${paymentId}/refunds`, t.people.ownerA, {
        amountCents,
        idempotencyKey: randomUUID(),
      });
    const tooMuch = await refund(13_801);
    expect([tooMuch.status, codeOf(tooMuch)]).toEqual([409, 'REFUND_TOO_LARGE']);
    expectOk(await refund(13_800));
    expectOk(
      await deliverEvent(
        t.app,
        stripeEvent('charge.refunded', acct(), {
          id: chargeOf(intent),
          object: 'charge',
          payment_intent: intent,
        }),
      ),
    );
    const view = await firmView(invoice.id);
    // A refund never makes money owed again: still PAID, the tip refunded with it.
    expect(view.status).toBe('PAID');
    expect(view.payments[0]).toMatchObject({
      status: 'REFUNDED',
      refundedCents: 13_800,
      refundableCents: 0,
    });
  });
});
