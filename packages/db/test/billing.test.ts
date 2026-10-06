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
const ids = { firmA: '', client: '', otherClient: '' };
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
const pay = (invoiceId: string, amountCents = 10000) =>
  firmA().payment.create({
    data: { ...A(), invoiceId, amountCents, processorRef: `cs_${randomUUID()}` },
  });
const recordEvent = (paymentId: string, type = 'checkout.session.completed') =>
  firmA().paymentEvent.create({
    data: { ...A(), processorEventId: `evt_${randomUUID()}`, type, paymentId },
  });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    ids.firmA = (await tx.business.create({ data: { slug: `ba-${run}`, name: 'A' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    ids.client = (await tx.client.create({ data: { ...A(), displayName: 'One' } })).id;
    ids.otherClient = (await tx.client.create({ data: { ...A(), displayName: 'Two' } })).id;
  });
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

  it('a calculator needs a disclaimer and a key, once per firm', async () => {
    const calc = (key: string, disclaimer: string) =>
      firmA().calculatorDefinition.create({ data: { ...A(), key, title: 'Calc', disclaimer } });
    await expect(calc('tax_return', ' ')).rejects.toThrow(/check constraint/i);
    await expect(calc('Tax Return', 'Estimate only')).rejects.toThrow(/check constraint/i);
    await calc('tax_return', 'Estimate only');
    await expect(calc('tax_return', 'Estimate only')).rejects.toThrow(/unique constraint/i);
  });
});
