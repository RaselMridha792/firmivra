// R0 step 10 rules: the database keeps invoice totals, invoices follow their status rules and
// become PAID only when payments confirmed by a recorded processor event cover the total, a
// webhook event is processed once, and content and calculators keep their shape. App role.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner);
const db = createDatabase(urls.app);

const run = randomUUID().slice(0, 8);
const ids = { firmA: '', firmB: '', client: '', otherClient: '' };
/** A fake Stripe connected account id (acct_ + letters and digits). */
const newAccountId = () => `acct_${randomUUID().replace(/-/g, '')}`;
const accounts = { A: newAccountId(), B: newAccountId() };
let invoiceNumber = 0;

const firmA = () => db.forBusiness(ids.firmA);
const A = () => ({ businessId: ids.firmA });
const draft = () =>
  firmA().invoice.create({
    data: { ...A(), clientId: ids.client, number: `INV-${++invoiceNumber}` },
  });
const addLine = (invoiceId: string, unitAmountCents: number, quantity = 1) =>
  firmA().invoiceLine.create({
    data: { ...A(), invoiceId, description: 'Service', unitAmountCents, quantity },
  });
const total = async (id: string) =>
  (await firmA().invoice.findUniqueOrThrow({ where: { id } })).totalCents;
/** An issued invoice for $100. */
const openInvoice = async () => {
  const inv = await draft();
  await addLine(inv.id, 10000);
  return firmA().invoice.update({
    where: { id: inv.id },
    data: { status: 'OPEN', issuedAt: new Date() },
  });
};
const pay = (invoiceId: string, amountCents = 10000, accountId = accounts.A) =>
  firmA().payment.create({
    data: { ...A(), invoiceId, amountCents, processorRef: `cs_${randomUUID()}`, accountId },
  });
const recordEvent = (
  paymentId: string | null,
  accountId = accounts.A,
  type = 'checkout.session.completed',
) =>
  firmA().paymentEvent.create({
    data: { ...A(), processorEventId: `evt_${randomUUID()}`, type, paymentId, accountId },
  });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    ids.firmA = (await tx.business.create({ data: { slug: `ba-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `bb-${run}`, name: 'B' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    ids.client = (await tx.client.create({ data: { ...A(), displayName: 'One' } })).id;
    ids.otherClient = (await tx.client.create({ data: { ...A(), displayName: 'Two' } })).id;
    await tx.stripeAccount.create({
      data: {
        ...A(),
        accountId: accounts.A,
        onboardingStatus: 'COMPLETE',
        chargesEnabled: true,
        payoutsEnabled: true,
      },
    });
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, (tx) =>
    tx.stripeAccount.create({
      data: { businessId: ids.firmB, accountId: accounts.B, chargesEnabled: true },
    }),
  );
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('invoice totals', () => {
  it('the database adds up the lines and applies the discount', async () => {
    const inv = await draft();
    await addLine(inv.id, 3333, 1.5); // 4999.5 rounds to 5000
    const second = await addLine(inv.id, 2000);
    // A discount is set once there are lines: it can never exceed the subtotal.
    await firmA().invoice.update({ where: { id: inv.id }, data: { discountCents: 500 } });
    expect(await total(inv.id)).toBe(5000 + 2000 - 500);
    await firmA().invoiceLine.delete({ where: { id: second.id } });
    expect(await total(inv.id)).toBe(4500);
  });

  it('the app cannot set the subtotal, and a discount cannot exceed it', async () => {
    const inv = await draft();
    await addLine(inv.id, 1000);
    await expect(
      firmA().invoice.update({ where: { id: inv.id }, data: { subtotalCents: 1 } }),
    ).rejects.toThrow(/kept by the database/);
    await expect(
      firmA().invoice.update({ where: { id: inv.id }, data: { discountCents: 2000 } }),
    ).rejects.toThrow(/check constraint/i);
  });

  it('a new invoice starts as an empty draft', async () => {
    await expect(
      firmA().invoice.create({
        data: { ...A(), clientId: ids.client, number: `INV-${++invoiceNumber}`, status: 'OPEN' },
      }),
    ).rejects.toThrow(/empty DRAFT/);
  });
});

describe('invoice status', () => {
  it('lines and amounts are fixed once issued', async () => {
    const inv = await openInvoice();
    await expect(addLine(inv.id, 100)).rejects.toThrow(/draft or scheduled/);
    await expect(firmA().invoiceLine.deleteMany({ where: { invoiceId: inv.id } })).rejects.toThrow(
      /draft or scheduled/,
    );
    await expect(
      firmA().invoice.update({ where: { id: inv.id }, data: { discountCents: 100 } }),
    ).rejects.toThrow(/keeps its number/);
    await expect(
      firmA().invoice.update({ where: { id: inv.id }, data: { clientId: ids.otherClient } }),
    ).rejects.toThrow(/client of an invoice cannot change/);
  });

  it('moves only along the allowed paths', async () => {
    const inv = await draft();
    await expect(
      firmA().invoice.update({
        where: { id: inv.id },
        data: { status: 'PAID', paidAt: new Date() },
      }),
    ).rejects.toThrow(/cannot go from DRAFT to PAID/);
    const open = await openInvoice();
    await expect(
      firmA().invoice.update({ where: { id: open.id }, data: { status: 'DRAFT' } }),
    ).rejects.toThrow(/cannot go from OPEN to DRAFT/);
    await expect(
      firmA().invoice.update({
        where: { id: inv.id },
        data: { status: 'SCHEDULED' },
      }),
    ).rejects.toThrow(/check constraint/i);
  });

  it('is PAID only when succeeded payments cover the total; then final', async () => {
    const inv = await openInvoice();
    const markPaid = () =>
      firmA().invoice.update({
        where: { id: inv.id },
        data: { status: 'PAID', paidAt: new Date() },
      });
    await expect(markPaid()).rejects.toThrow(/covering the total/);

    const p = await pay(inv.id);
    await expect(markPaid()).rejects.toThrow(/covering the total/);
    await recordEvent(p.id);
    await firmA().payment.update({
      where: { id: p.id },
      data: { status: 'SUCCEEDED', paidAt: new Date() },
    });
    await expect(markPaid()).resolves.toMatchObject({ status: 'PAID' });
    await expect(
      firmA().invoice.update({
        where: { id: inv.id },
        data: { status: 'CANCELED', canceledAt: new Date() },
      }),
    ).rejects.toThrow(/final/);
    await expect(firmA().invoice.deleteMany({ where: { id: inv.id } })).rejects.toThrow(
      /permission denied/i,
    );
  });
});

describe('payments and webhook events', () => {
  it('a payment starts PENDING on an open invoice', async () => {
    const d = await draft();
    await expect(pay(d.id)).rejects.toThrow(/only an open invoice/);
    const inv = await openInvoice();
    await expect(
      firmA().payment.create({
        data: {
          ...A(),
          invoiceId: inv.id,
          amountCents: 10000,
          processorRef: `cs_${randomUUID()}`,
          accountId: accounts.A,
          status: 'SUCCEEDED',
          paidAt: new Date(),
        },
      }),
    ).rejects.toThrow(/starts PENDING/);
  });

  it('succeeds only on a recorded processor event, and never changes amount', async () => {
    const p = await pay((await openInvoice()).id);
    await expect(
      firmA().payment.update({
        where: { id: p.id },
        data: { status: 'SUCCEEDED', paidAt: new Date() },
      }),
    ).rejects.toThrow(/recorded processor event/);
    await expect(
      firmA().payment.update({ where: { id: p.id }, data: { amountCents: 1 } }),
    ).rejects.toThrow(/cannot change/);
    await firmA().payment.update({
      where: { id: p.id },
      data: { status: 'FAILED', failureCode: 'card_declined' },
    });
    await expect(
      firmA().payment.update({
        where: { id: p.id },
        data: { status: 'SUCCEEDED', paidAt: new Date() },
      }),
    ).rejects.toThrow(/cannot go from FAILED to SUCCEEDED/);
  });

  it('a duplicate event is refused; an event is processed once', async () => {
    const p = await pay((await openInvoice()).id);
    const eventId = `evt_${randomUUID()}`;
    const record = () =>
      firmA().paymentEvent.create({
        data: {
          ...A(),
          processorEventId: eventId,
          accountId: accounts.A,
          type: 'checkout.session.completed',
          paymentId: p.id,
        },
      });
    const e = await record();
    await expect(record()).rejects.toThrow(/unique constraint/i);
    await firmA().paymentEvent.update({ where: { id: e.id }, data: { processedAt: new Date() } });
    for (const data of [
      { processedAt: new Date(Date.now() + 1000) },
      { type: 'charge.refunded' },
    ]) {
      await expect(firmA().paymentEvent.update({ where: { id: e.id }, data })).rejects.toThrow(
        /recorded once/,
      );
    }
    await expect(firmA().paymentEvent.deleteMany({ where: { id: e.id } })).rejects.toThrow(
      /permission denied/i,
    );
  });
});

describe('Stripe Connect: each firm is paid into its own account', () => {
  it("a payment runs only on the firm's own account, with charges enabled", async () => {
    const inv = await openInvoice();
    await expect(pay(inv.id, 10000, accounts.B)).rejects.toThrow(/own connected account/);
    await expect(pay(inv.id, 10000, newAccountId())).rejects.toThrow(/own connected account/);

    await runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
      tx.stripeAccount.update({
        where: { businessId: ids.firmA },
        data: { chargesEnabled: false, onboardingStatus: 'RESTRICTED' },
      }),
    );
    try {
      await expect(pay(inv.id)).rejects.toThrow(/charges enabled/);
    } finally {
      await runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
        tx.stripeAccount.update({
          where: { businessId: ids.firmA },
          data: { chargesEnabled: true, onboardingStatus: 'COMPLETE' },
        }),
      );
    }
  });

  it("an event from another firm's account cannot be recorded or mark anything paid", async () => {
    const inv = await openInvoice();
    const p = await pay(inv.id);
    // Firm B's account sending an event into firm A's scope is refused outright.
    await expect(recordEvent(p.id, accounts.B)).rejects.toThrow(/own connected account/);
    await expect(recordEvent(null, accounts.B)).rejects.toThrow(/own connected account/);
    await expect(
      firmA().payment.update({
        where: { id: p.id },
        data: { status: 'SUCCEEDED', paidAt: new Date() },
      }),
    ).rejects.toThrow(/recorded processor event/);

    // In firm B's own scope, with B's own account, firm A's payment is out of reach.
    await expect(
      db.forBusiness(ids.firmB).paymentEvent.create({
        data: {
          businessId: ids.firmB,
          processorEventId: `evt_${randomUUID()}`,
          type: 'checkout.session.completed',
          accountId: accounts.B,
          paymentId: p.id,
        },
      }),
    ).rejects.toThrow();

    // From the firm's own account, the full path works.
    await recordEvent(p.id);
    await firmA().payment.update({
      where: { id: p.id },
      data: { status: 'SUCCEEDED', paidAt: new Date() },
    });
    await expect(
      firmA().invoice.update({
        where: { id: inv.id },
        data: { status: 'PAID', paidAt: new Date() },
      }),
    ).resolves.toMatchObject({ status: 'PAID' });
  });

  it('one account per firm, never shared, never changed; the platform can read it', async () => {
    await expect(
      db.forBusiness(ids.firmB).stripeAccount.create({
        data: { businessId: ids.firmB, accountId: newAccountId() },
      }),
    ).rejects.toThrow(/unique constraint/i);
    await expect(
      firmA().stripeAccount.update({
        where: { businessId: ids.firmA },
        data: { accountId: newAccountId() },
      }),
    ).rejects.toThrow(/cannot change/);
    await expect(
      firmA().stripeAccount.update({
        where: { businessId: ids.firmA },
        data: { onboardingStatus: 'COMPLETE', payoutsEnabled: false },
      }),
    ).rejects.toThrow(/check constraint/i);
    expect(await db.forBusiness(ids.firmB).stripeAccount.findMany()).toHaveLength(1);
    const seen = (await db.forPlatform().stripeAccount.findMany()).map((a) => a.accountId);
    expect(seen).toEqual(expect.arrayContaining([accounts.A, accounts.B]));
  });
});

describe('content and calculators', () => {
  const item = (data: { kind: 'RESOURCE' | 'EXTERNAL_LINK'; url?: string; body?: string }) =>
    firmA().contentItem.create({ data: { ...A(), title: 'Item', ...data } });

  it('an external link is an https URL; a resource has a body', async () => {
    await expect(item({ kind: 'EXTERNAL_LINK', url: 'http://example.test' })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(item({ kind: 'EXTERNAL_LINK' })).rejects.toThrow(/check constraint/i);
    await expect(item({ kind: 'RESOURCE' })).rejects.toThrow(/check constraint/i);
    await expect(
      item({ kind: 'EXTERNAL_LINK', url: 'https://www.irs.gov/' }),
    ).resolves.toBeDefined();
  });

  it('an external link icon is a design-system icon name, never a URL', async () => {
    const link = (iconKey: string) =>
      firmA().contentItem.create({
        data: {
          ...A(),
          kind: 'EXTERNAL_LINK',
          category: 'IRS & Business Taxes',
          title: 'IRS EIN',
          url: 'https://www.irs.gov/ein',
          iconKey,
        },
      });
    await expect(link('https://evil.test/icon.png')).rejects.toThrow(/check constraint/i);
    await expect(link('irs')).resolves.toMatchObject({ iconKey: 'irs' });
  });

  it('a calculator needs a disclaimer and a key, once per firm', async () => {
    const calc = (key: string, disclaimer: string) =>
      firmA().calculatorDefinition.create({ data: { ...A(), key, title: 'Calc', disclaimer } });
    await expect(calc('tax_return', ' ')).rejects.toThrow(/check constraint/i);
    await expect(calc('Tax Return', 'Estimate only')).rejects.toThrow(/check constraint/i);
    await calc('tax_return', 'Estimate only');
    await expect(calc('tax_return', 'Estimate only')).rejects.toThrow(/unique constraint/i);
  });
});
