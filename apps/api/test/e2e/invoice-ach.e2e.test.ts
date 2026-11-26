// End-to-end: Q23 (IP-041), bank payments (ACH) at Pay Now, against the fake Stripe. The approved
// plan: offered only while Settings > Payments has ACH on AND Stripe's ACH Direct Debit capability
// is active on the firm's account (stored from Stripe), in USD, for at least 0.50; instant bank
// verification only. With Stripe ACH off nothing is offered and nothing breaks. How the client paid
// (card or bank, last 4) is kept with the payment. Synthetic data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { AcceptedPayments } from '@firmivra/types';
import { InvoiceJobs } from '../../src/payments/invoices/invoice-jobs.js';
import { FakeStripeGateway } from '../../src/payments/stripe/fake-stripe.js';
import { codeOf, expectOk, Invoice, nyDay, startInvoiceApp } from './invoice-setup.js';
import { deliverEvent, stripeEvent } from './stripe-events.js';

const fake = new FakeStripeGateway();
let t: Awaited<ReturnType<typeof startInvoiceApp>>;
beforeAll(async () => {
  t = await startInvoiceApp('q23a', fake);
});
afterAll(async () => {
  await t.app.close();
});
const acct = () => `acct_${t.run}A`;

/** Stripe's capability as Firmivra stores it (only platform scope may write `stripe_accounts`). */
async function capability(active: boolean) {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, (tx) =>
    tx.stripeAccount.update({
      where: { businessId: t.ids.firmA },
      data: { achPaymentsActive: active },
    }),
  );
  await owner.$disconnect();
}
const accepted = async (method: 'get' | 'put', body?: object, who = t.people.ownerA) => {
  const req = request(t.app.getHttpServer())
    [method]('/api/v1/business/payments/setup/accepted')
    .set('x-business-id', t.ids.firmA)
    .set('authorization', `Bearer ${await t.tokenFor(who.email)}`);
  return body ? req.send(body) : req;
};
const choose = (acceptAch: boolean) =>
  accepted('put', {
    acceptCard: true,
    defaultCardProcessor: 'STRIPE',
    acceptAch,
    achProcessor: 'STRIPE',
  });
async function open(cents = 20_000) {
  const draft = Invoice.parse(
    expectOk(
      await t.firm('post', '', t.people.ownerA, {
        clientId: t.ids.one,
        lines: [{ description: 'Bookkeeping (fake)', unitAmountCents: cents }],
        dueOn: nyDay(30),
      }),
    ).body,
  );
  return Invoice.parse(
    expectOk(await t.firm('post', `/${draft.id}/send`, t.people.ownerA, {})).body,
  );
}
const lastCreate = () => fake.calls.filter((c) => c.method === 'createCheckoutSession').at(-1)!;
const pendingOf = (invoiceId: string) =>
  t.inScope(t.ids.firmA, (tx) => tx.payment.findFirstOrThrow({ where: { invoiceId } }));

describe('ACH in Settings > Payments', () => {
  it('stays locked and off while Stripe ACH is not active, and saves once it is', async () => {
    await capability(false);
    const locked = AcceptedPayments.parse(expectOk(await accepted('get')).body);
    expect(locked.acceptAch).toBe(false);
    expect(locked.locks.ach).toContain('ACH Direct Debit');
    const refused = await choose(true);
    expect([refused.status, codeOf(refused)]).toEqual([409, 'ACH_NOT_OFFERED']);

    await capability(true);
    const open = AcceptedPayments.parse(expectOk(await accepted('get')).body);
    expect(open.locks.ach).toBeNull();
    expect(AcceptedPayments.parse(expectOk(await choose(true)).body).acceptAch).toBe(true);

    // Stripe turns ACH off again: it reads off, whatever was saved.
    await capability(false);
    const off = AcceptedPayments.parse(expectOk(await accepted('get')).body);
    expect([off.acceptAch, off.locks.ach === null]).toEqual([false, false]);
    await capability(true);
    expect(AcceptedPayments.parse(expectOk(await accepted('get')).body).acceptAch).toBe(true);
  });
});

describe('ACH at Pay Now', () => {
  it('offers bank payments with instant verification only while ACH is on and active', async () => {
    await capability(true);
    expectOk(await choose(true));
    const invoice = await open(20_000);
    expectOk(await t.portal('post', `/${invoice.id}/checkout`, t.people.primary, {}));
    expect(lastCreate().params).toMatchObject({ invoiceId: invoice.id, bankDebit: true });

    // Stripe ACH off: cards only, nothing else changes.
    await capability(false);
    const cards = await open(20_000);
    expectOk(await t.portal('post', `/${cards.id}/checkout`, t.people.primary, {}));
    expect(lastCreate().params).toMatchObject({ invoiceId: cards.id, bankDebit: false });

    // The firm turned ACH off: cards only.
    await capability(true);
    expectOk(await choose(false));
    const off = await open(20_000);
    expectOk(await t.portal('post', `/${off.id}/checkout`, t.people.primary, {}));
    expect(lastCreate().params).toMatchObject({ invoiceId: off.id, bankDebit: false });
  });

  it("never offers a bank payment under Stripe's 0.50 smallest", async () => {
    await capability(true);
    expectOk(await choose(true));
    const small = await open(49);
    expectOk(await t.portal('post', `/${small.id}/checkout`, t.people.primary, {}));
    expect(lastCreate().params).toMatchObject({ invoiceId: small.id, bankDebit: false });
    const fifty = await open(50);
    expectOk(await t.portal('post', `/${fifty.id}/checkout`, t.people.primary, {}));
    expect(lastCreate().params).toMatchObject({ invoiceId: fifty.id, bankDebit: true });
  });
});

describe('how the client paid', () => {
  const complete = async (invoiceId: string, paymentStatus: 'paid' | 'unpaid', amount: number) => {
    const payment = await pendingOf(invoiceId);
    const intent = fake.sessions.get(payment.processorRef)!.paymentIntentId!;
    fake.setSession(payment.processorRef, { status: 'complete' });
    expectOk(
      await deliverEvent(
        t.app,
        stripeEvent('checkout.session.completed', acct(), {
          id: payment.processorRef,
          payment_status: paymentStatus,
          amount_total: amount,
          currency: 'usd',
          payment_intent: intent,
          metadata: { payment_id: payment.id },
        }),
      ),
    );
    return { payment, intent };
  };

  it('keeps a bank payment as us_bank_account with its last 4, still processing', async () => {
    await capability(true);
    expectOk(await choose(true));
    const invoice = await open(30_000);
    expectOk(await t.portal('post', `/${invoice.id}/checkout`, t.people.primary, {}));
    const payment = await pendingOf(invoice.id);
    const intent = fake.sessions.get(payment.processorRef)!.paymentIntentId!;
    fake.methods.set(intent, { methodType: 'us_bank_account', last4: '6789' });
    // A bank debit settles later: the session completes unpaid.
    await complete(invoice.id, 'unpaid', 30_000);
    expect(await pendingOf(invoice.id)).toMatchObject({
      status: 'PENDING',
      methodType: 'us_bank_account',
      last4: '6789',
    });
    const mine = expectOk(await t.portal('get', `/${invoice.id}`, t.people.primary)).body as {
      paymentProcessing: boolean;
    };
    expect(mine.paymentProcessing).toBe(true);
  });

  it('keeps a card payment as card with its last 4', async () => {
    await capability(false);
    const invoice = await open(12_000);
    expectOk(await t.portal('post', `/${invoice.id}/checkout`, t.people.primary, {}));
    await complete(invoice.id, 'paid', 12_000);
    expect(await pendingOf(invoice.id)).toMatchObject({
      status: 'SUCCEEDED',
      methodType: 'card',
      last4: '4242',
    });
    expect((await t.firm('get', `/${invoice.id}`, t.people.ownerA)).body).toMatchObject({
      status: 'PAID',
    });
  });
});

describe('part 2: after a bank payment', () => {
  /** A sent invoice due `dueOn`, paid by bank at checkout; the session completes unpaid (settling). */
  async function bankPaid(dueOn: string, cents = 25_000) {
    await capability(true);
    expectOk(await choose(true));
    const draft = Invoice.parse(
      expectOk(
        await t.firm('post', '', t.people.ownerA, {
          clientId: t.ids.one,
          lines: [{ description: 'Payroll (fake)', unitAmountCents: cents }],
          dueOn,
        }),
      ).body,
    );
    expectOk(await t.firm('post', `/${draft.id}/send`, t.people.ownerA, {}));
    expectOk(await t.portal('post', `/${draft.id}/checkout`, t.people.primary, {}));
    const payment = await pendingOf(draft.id);
    const intent = fake.sessions.get(payment.processorRef)!.paymentIntentId!;
    fake.methods.set(intent, { methodType: 'us_bank_account', last4: '1357' });
    fake.setSession(payment.processorRef, { status: 'complete' });
    expectOk(
      await deliverEvent(
        t.app,
        stripeEvent('checkout.session.completed', acct(), {
          id: payment.processorRef,
          payment_status: 'unpaid',
          amount_total: cents,
          currency: 'usd',
          payment_intent: intent,
          metadata: { payment_id: payment.id },
        }),
      ),
    );
    return { invoiceId: draft.id, payment, intent };
  }
  const bell = (invoiceId: string, type: string) =>
    t.inScope(t.ids.firmA, (tx) =>
      tx.notification.findMany({
        where: { businessId: t.ids.firmA, type, entityId: invoiceId },
        select: { recipientUserId: true },
      }),
    );

  it('a failed bank debit tells the client and the firm; the invoice stays open', async () => {
    const { invoiceId, payment } = await bankPaid(nyDay(30));
    expectOk(
      await deliverEvent(
        t.app,
        stripeEvent('checkout.session.async_payment_failed', acct(), {
          id: payment.processorRef,
          payment_status: 'unpaid',
          currency: 'usd',
          metadata: { payment_id: payment.id },
        }),
      ),
    );
    expect(await pendingOf(invoiceId)).toMatchObject({ status: 'FAILED' });
    const view = Invoice.parse(
      expectOk(await t.firm('get', `/${invoiceId}`, t.people.ownerA)).body,
    );
    expect(view.status).toBe('OPEN');
    expect(view.payments[0]).toMatchObject({ methodType: 'us_bank_account', last4: '1357' });
    // Both sides: the client's login and the firm's members each get the bell item.
    expect((await bell(invoiceId, 'payment.failed')).length).toBeGreaterThanOrEqual(2);
  });

  it('an abandoned checkout that only expires tells no one', async () => {
    await capability(false);
    const invoice = await open(9_000);
    expectOk(await t.portal('post', `/${invoice.id}/checkout`, t.people.primary, {}));
    const payment = await pendingOf(invoice.id);
    expectOk(
      await deliverEvent(
        t.app,
        stripeEvent('checkout.session.expired', acct(), {
          id: payment.processorRef,
          currency: 'usd',
          metadata: { payment_id: payment.id },
        }),
      ),
    );
    expect(await pendingOf(invoice.id)).toMatchObject({ status: 'FAILED' });
    expect(await bell(invoice.id, 'payment.failed')).toEqual([]);
  });

  it('sends no reminder while a bank payment is processing', async () => {
    const processing = await bankPaid(nyDay(7));
    await t.inScope(t.ids.firmA, (tx) =>
      tx.paymentSettings.update({
        where: { businessId: t.ids.firmA },
        data: { sendReminders: true, reminderDaysBeforeList: [7] },
      }),
    );
    const unpaid = Invoice.parse(
      expectOk(
        await t.firm('post', '', t.people.ownerA, {
          clientId: t.ids.one,
          lines: [{ description: 'Advisory (fake)', unitAmountCents: 10_000 }],
          dueOn: nyDay(7),
        }),
      ).body,
    );
    expectOk(await t.firm('post', `/${unpaid.id}/send`, t.people.ownerA, {}));
    // 15:00 UTC is past 9:00 in the firm (New York), when reminders go out.
    const later = new Date(`${nyDay(0)}T15:00:00.000Z`);
    await t.app.get(InvoiceJobs).run({ now: later, businessIds: [t.ids.firmA] });
    expect(await bell(processing.invoiceId, 'invoice.reminder')).toEqual([]);
    expect((await bell(unpaid.id, 'invoice.reminder')).length).toBeGreaterThan(0);
  });

  it('the portal list says whether Pay Now takes a bank account', async () => {
    await capability(true);
    expectOk(await choose(true));
    const on = expectOk(await t.portal('get', '', t.people.primary)).body as {
      bankPayments: boolean;
    };
    expect(on.bankPayments).toBe(true);
    expectOk(await choose(false));
    const off = expectOk(await t.portal('get', '', t.people.primary)).body as {
      bankPayments: boolean;
    };
    expect(off.bankPayments).toBe(false);
  });
});
