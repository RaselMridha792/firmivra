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
/** Waits until `check` holds (the fake records each call as it starts), so no test sleeps a guess. */
async function until(check: () => boolean) {
  for (let i = 0; i < 500 && !check(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(check()).toBe(true);
}

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
      tx.auditLog.findMany({
        where: { entityId: invoice.id, action: 'invoice.checkout_started' },
        select: { metadata: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
    // The second answer is audited too, as the same checkout again.
    expect(audit.map((a) => (a.metadata as { reused?: boolean }).reused ?? false)).toEqual([
      false,
      true,
    ]);
  });

  it('gives two clicks at once one checkout: one session, one PENDING row, the same URL', async () => {
    const invoice = await open();
    const before = creates().length;
    // Each Stripe call takes 200 ms, so the second click really waits on the first one's row.
    fake.delayMs = 200;
    try {
      const [a, b] = await Promise.all([pay(invoice.id), pay(invoice.id, t.people.spouse)]);
      const [first, second] = [Link.parse(expectOk(a).body), Link.parse(expectOk(b).body)];
      expect(second.url).toBe(first.url);
    } finally {
      fake.delayMs = 0;
    }
    expect(creates().length).toBe(before + 1);
    const rows = await paymentsOf(invoice.id);
    expect(rows.map((r) => r.status)).toEqual(['PENDING']);
    const audit = await t.inScope(t.ids.firmA, (tx) =>
      tx.auditLog.findMany({
        where: { entityId: invoice.id, action: 'invoice.checkout_started' },
        select: { metadata: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
    expect(audit.map((a) => (a.metadata as { reused?: boolean }).reused ?? false).sort()).toEqual([
      false,
      true,
    ]);
  });

  it('answers a click 409 PAYMENT_IN_PROGRESS while another one waits long on Stripe', async () => {
    const invoice = await open();
    const before = creates().length;
    // The first one holds the row for 3 s; each one after it waits at most 1 s.
    fake.delayMs = 3_000;
    try {
      const first = pay(invoice.id);
      await until(() => creates().length === before + 1);
      const second = await pay(invoice.id, t.people.spouse);
      expect([second.status, codeOf(second)]).toEqual([409, 'PAYMENT_IN_PROGRESS']);
      // So does a cancel by the firm; neither held a connection waiting for the row.
      const noCancel = await cancel(invoice.id);
      expect([noCancel.status, codeOf(noCancel)]).toEqual([409, 'PAYMENT_IN_PROGRESS']);
      expectOk(await first);
    } finally {
      fake.delayMs = 0;
    }
    expect(creates().length).toBe(before + 1);
  });

  it('answers 503 SERVICE_BUSY with Retry-After when three checkouts already wait on Stripe', async () => {
    const invoices = [];
    for (let i = 0; i < 4; i += 1) invoices.push(await open());
    const before = creates().length;
    fake.delayMs = 1_000;
    try {
      const first = invoices.slice(0, 3).map((i) => pay(i.id));
      await until(() => creates().length === before + 3);
      const fourth = await pay(invoices[3]!.id);
      expect([fourth.status, codeOf(fourth)]).toEqual([503, 'SERVICE_BUSY']);
      expect(fourth.headers['retry-after']).toBe('5');
      for (const res of await Promise.all(first)) expectOk(res);
    } finally {
      fake.delayMs = 0;
    }
    expect(await paymentsOf(invoices[3]!.id)).toEqual([]);
    expectOk(await pay(invoices[3]!.id));
  });

  it("builds the way back from the firm's stored slug, whatever case the URL used", async () => {
    const invoice = await open();
    expectOk(await pay(invoice.id, t.people.primary, {}, t.ids.slugA.toUpperCase()));
    const back = `${process.env.PORTAL_BASE_URL!.replace(/\/+$/, '')}/${t.ids.slugA}/invoices`;
    expect(creates().at(-1)).toMatchObject({
      params: { successUrl: `${back}?checkout=success&invoice=${invoice.id}` },
    });
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
    const audit = await t.inScope(t.ids.firmA, (tx) =>
      tx.auditLog.findMany({
        where: { OR: [{ entityId: p!.id }, { entityId: invoice.id, action: 'invoice.canceled' }] },
        select: { action: true, metadata: true },
      }),
    );
    expect(audit).toEqual(
      expect.arrayContaining([
        {
          action: 'payment.failed',
          metadata: { invoiceId: invoice.id, failureCode: 'checkout_expired' },
        },
        expect.objectContaining({
          action: 'invoice.canceled',
          metadata: expect.objectContaining({ clientId: t.ids.one }),
        }),
      ]),
    );
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

describe('the invoice row held by another API task', () => {
  it('answers Pay Now and cancel 409 PAYMENT_IN_PROGRESS after about a second, never 500', async () => {
    const invoice = await open();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const holding = new Promise<void>((resolve) => (held = resolve));
    // Another API process's Pay Now: its own transaction holds the row, so this process's
    // in-flight guard does not see it and the wait is the row lock's lock_timeout.
    const other = t.inScope(t.ids.firmA, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM invoices WHERE id = ${invoice.id}::uuid FOR UPDATE`;
      held();
      await gate;
    });
    try {
      await holding;
      for (const call of [() => pay(invoice.id), () => cancel(invoice.id)]) {
        const started = Date.now();
        const res = await call();
        expect([res.status, codeOf(res)]).toEqual([409, 'PAYMENT_IN_PROGRESS']);
        // It waited on the row (1 s), not on this process's guard, and gave up in time.
        expect(Date.now() - started).toBeGreaterThanOrEqual(900);
        expect(Date.now() - started).toBeLessThan(2_500);
      }
    } finally {
      release();
      await other;
    }
    // Nothing was written while it waited, and both work once the row is free.
    expect(await paymentsOf(invoice.id)).toEqual([]);
    expectOk(await pay(invoice.id));
  });
});
