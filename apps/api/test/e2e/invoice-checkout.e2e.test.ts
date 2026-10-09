// End-to-end: R7, Pay Now (POST /portal/{firmSlug}/me/invoices/{id}/checkout) and cancel, against
// the fake Stripe. The amount is the balance due from the database, the session runs on the firm's
// own account, one open checkout per invoice, and cancel expires open checkouts first.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CheckoutLink } from '@firmivra/types';
import { FakeStripeGateway } from '../../src/payments/stripe/fake-stripe.js';
import { codeOf, expectOk, Invoice, nyDay, startInvoiceApp } from './invoice-setup.js';

const Link = z.strictObject(CheckoutLink.shape);
const fake = new FakeStripeGateway();
let t: Awaited<ReturnType<typeof startInvoiceApp>>;
beforeAll(async () => {
  t = await startInvoiceApp('r7c', fake);
});
afterAll(async () => {
  await t.app.close();
});

const open = async (clientId = t.ids.one, cents = 12_345, extra: object = {}) => {
  const draft = Invoice.parse(
    expectOk(
      await t.firm('post', '', t.people.ownerA, {
        clientId,
        lines: [{ description: 'Tax return', unitAmountCents: cents }],
        dueOn: nyDay(30),
        ...extra,
      }),
    ).body,
  );
  return Invoice.parse(
    expectOk(await t.firm('post', `/${draft.id}/send`, t.people.ownerA, {})).body,
  );
};
const pay = (id: string, who = t.people.primary, body: object = {}, slug?: string) =>
  t.portal('post', `/${id}/checkout`, who, body, slug);
const cancel = (id: string, who = t.people.ownerA, businessId?: string) =>
  t.firm('post', `/${id}/cancel`, who, { reason: 'Billed by mistake' }, businessId);
const paymentsOf = (invoiceId: string) =>
  t.inScope(t.ids.firmA, (tx) =>
    tx.payment.findMany({ where: { invoiceId }, orderBy: { createdAt: 'asc' } }),
  );
const creates = () => fake.calls.filter((c) => c.method === 'createCheckoutSession');

describe('Pay Now', () => {
  it("charges the balance from the database on the firm's own account, and answers the same checkout again", async () => {
    const invoice = await open();
    const before = creates().length;
    const first = Link.parse(expectOk(await pay(invoice.id)).body);
    expect(new URL(first.url).host).toBe('checkout.stripe.com');
    const call = creates().at(-1)!;
    const back = `${process.env.PORTAL_BASE_URL!.replace(/\/$/, '')}/${t.ids.slugA}/invoices`;
    expect(call).toMatchObject({
      accountId: `acct_${t.run}A`,
      params: {
        invoiceId: invoice.id,
        amountCents: 12_345,
        currency: 'usd',
        successUrl: `${back}?checkout=success&invoice=${invoice.id}`,
        cancelUrl: `${back}?checkout=canceled&invoice=${invoice.id}`,
      },
    });
    const [payment] = await paymentsOf(invoice.id);
    expect(payment).toMatchObject({
      status: 'PENDING',
      amountCents: 12_345,
      accountId: `acct_${t.run}A`,
    });
    expect(payment!.processorRef).toMatch(/^cs_/);
    // A second click (or the spouse) gets the same open checkout.
    const second = Link.parse(expectOk(await pay(invoice.id, t.people.spouse)).body);
    expect(second.url).toBe(first.url);
    expect(creates().length).toBe(before + 1);
    // An open checkout is not a payment anyone sees yet.
    const firm = Invoice.parse(
      expectOk(await t.firm('get', `/${invoice.id}`, t.people.ownerA)).body,
    );
    expect(firm.payments).toEqual([]);
    const audit = await t.inScope(t.ids.firmA, (tx) =>
      tx.auditLog.count({ where: { entityId: invoice.id, action: 'invoice.checkout_started' } }),
    );
    expect(audit).toBe(1);
  });

  it('replaces a checkout close to its end, and marks the old one expired', async () => {
    const invoice = await open();
    const first = Link.parse(expectOk(await pay(invoice.id)).body);
    const [old] = await paymentsOf(invoice.id);
    fake.setSession(old!.processorRef, { expiresAt: new Date(Date.now() + 5 * 60_000) });
    const next = Link.parse(expectOk(await pay(invoice.id)).body);
    expect(next.url).not.toBe(first.url);
    expect(fake.sessions.get(old!.processorRef)!.status).toBe('expired');
    const [a, b] = await paymentsOf(invoice.id);
    expect([a!.status, a!.failureCode, b!.status]).toEqual([
      'FAILED',
      'checkout_expired',
      'PENDING',
    ]);
  });

  it('refuses an amount in the body, an invoice not open, a paid-at-Stripe checkout and Stripe down', async () => {
    const invoice = await open();
    const body = await pay(invoice.id, t.people.primary, { amountCents: 1 });
    expect([body.status, codeOf(body)]).toEqual([400, 'VALIDATION_FAILED']);

    const upcoming = await open(t.ids.one, 5_000, { scheduledFor: nyDay(4) });
    const notOpen = await pay(upcoming.id);
    expect([notOpen.status, codeOf(notOpen)]).toEqual([409, 'NOT_PAYABLE']);

    expectOk(await pay(invoice.id));
    const [p] = await paymentsOf(invoice.id);
    fake.setSession(p!.processorRef, { status: 'complete' });
    const busy = await pay(invoice.id);
    expect([busy.status, codeOf(busy)]).toEqual([409, 'PAYMENT_IN_PROGRESS']);
    const noCancel = await cancel(invoice.id);
    expect([noCancel.status, codeOf(noCancel)]).toEqual([409, 'PAYMENT_IN_PROGRESS']);

    const other = await open();
    fake.down = true;
    try {
      const down = await pay(other.id);
      expect([down.status, codeOf(down)]).toEqual([503, 'PAYMENT_PROVIDER_UNAVAILABLE']);
    } finally {
      fake.down = false;
    }
    expect(await paymentsOf(other.id)).toEqual([]);
  });

  it("gives another client and firm B 404, and a firm that can't take charges PAYMENTS_NOT_SET_UP", async () => {
    const invoice = await open();
    for (const res of [
      await pay(invoice.id, t.people.other),
      await pay(invoice.id, t.people.clientB, {}, t.ids.slugB),
    ]) {
      expect([res.status, codeOf(res)]).toEqual([404, 'NOT_FOUND']);
    }
    const bInvoice = await t.inScope(t.ids.firmB, async (tx) => {
      const inv = await tx.invoice.create({
        data: {
          businessId: t.ids.firmB,
          clientId: t.ids.clientB,
          number: `INV-B-${t.run}`,
          dueOn: new Date(`${nyDay(10)}T00:00:00.000Z`),
        },
      });
      await tx.invoiceLine.create({
        data: {
          businessId: t.ids.firmB,
          invoiceId: inv.id,
          description: 'x',
          unitAmountCents: 900,
        },
      });
      await tx.invoice.update({
        where: { id: inv.id },
        data: { status: 'OPEN', issuedAt: new Date() },
      });
      return inv.id;
    });
    const res = await pay(bInvoice, t.people.clientB, {}, t.ids.slugB);
    expect([res.status, codeOf(res)]).toEqual([409, 'PAYMENTS_NOT_SET_UP']);
  });
});

describe('POST /business/invoices/{id}/cancel', () => {
  it('expires the open checkout first, then cancels; a second cancel is INVOICE_CLOSED', async () => {
    const invoice = await open();
    expectOk(await pay(invoice.id));
    const [p] = await paymentsOf(invoice.id);
    const canceled = Invoice.parse(expectOk(await cancel(invoice.id)).body);
    expect(canceled).toMatchObject({
      status: 'CANCELED',
      clientStatus: 'CANCELED',
      cancelReason: 'Billed by mistake',
    });
    expect(fake.sessions.get(p!.processorRef)!.status).toBe('expired');
    expect((await paymentsOf(invoice.id))[0]!.status).toBe('FAILED');
    const again = await cancel(invoice.id);
    expect([again.status, codeOf(again)]).toEqual([409, 'INVOICE_CLOSED']);
    const payAfter = await pay(invoice.id);
    expect([payAfter.status, codeOf(payAfter)]).toEqual([409, 'NOT_PAYABLE']);
  });

  it('hides a canceled draft from the portal and keeps a canceled scheduled one as Canceled', async () => {
    const draft = Invoice.parse(
      expectOk(
        await t.firm('post', '', t.people.ownerA, {
          clientId: t.ids.one,
          lines: [{ description: 'x', unitAmountCents: 100 }],
          dueOn: nyDay(10),
          scheduledFor: nyDay(3),
        }),
      ).body,
    );
    const c1 = Invoice.parse(expectOk(await cancel(draft.id)).body);
    expect([c1.scheduledFor, c1.clientStatus]).toEqual([null, null]);
    const scheduled = await open(t.ids.one, 700, { scheduledFor: nyDay(3) });
    const c2 = Invoice.parse(expectOk(await cancel(scheduled.id)).body);
    expect([c2.scheduledFor, c2.clientStatus]).toEqual([nyDay(3), 'CANCELED']);
    const portal = await t.portal('get', `/${draft.id}`, t.people.primary);
    expect(portal.status).toBe(404);
  });

  it('gives Staff 403 and firm B 404', async () => {
    const invoice = await open();
    const staff = await cancel(invoice.id, t.people.staffA);
    expect([staff.status, codeOf(staff)]).toEqual([403, 'FORBIDDEN']);
    const b = await cancel(invoice.id, t.people.ownerB, t.ids.firmB);
    expect([b.status, codeOf(b)]).toEqual([404, 'NOT_FOUND']);
  });
});
