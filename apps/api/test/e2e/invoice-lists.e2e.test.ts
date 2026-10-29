// IP-F17 (Octavia's Invoices & Payments review, Oct 27): the routes Invoices & Payments lacked.
// View All Payments lists every payment, Stripe's and recorded ones (voided ones marked), on the
// firm's calendar; Recurring Invoices lists the firm's schedules. Staff see their clients' only.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PaymentPage, RecurringInvoiceList } from '@firmivra/types';
import { expectOk, nyDay, startInvoiceApp } from './invoice-setup.js';

let t: Awaited<ReturnType<typeof startInvoiceApp>>;
beforeAll(async () => {
  t = await startInvoiceApp('r56lists');
});
afterAll(async () => {
  await t.app.close();
});

const record = async (invoiceId: string, method: string, amountCents: number) =>
  expectOk(
    await t.firm('post', `/${invoiceId}/offline-payments`, t.people.ownerA, {
      method,
      amountCents,
      receivedOn: nyDay(0),
      idempotencyKey: randomUUID(),
      ...(method === 'CHECK' ? { reference: '3301' } : {}),
    }),
  ).body as { offlinePayments: { id: string; amountCents: number }[] };
const page = async (query = '', who = t.people.ownerA, businessId?: string) =>
  PaymentPage.parse(
    expectOk(await t.firm('get', `/payments${query}`, who, undefined, businessId)).body,
  );

describe('View All Payments (IP-F17)', () => {
  it('lists Stripe and recorded payments, voided ones marked, newest first, in reach', async () => {
    const mine = await t.draft(t.ids.one, { status: 'OPEN' });
    const theirs = await t.draft(t.ids.two, { status: 'OPEN' });
    await record(mine.id, 'CHECK', 10_000);
    await record(theirs.id, 'CASH', 5_000);
    const bounced = (await record(theirs.id, 'CASH', 3_000)).offlinePayments.find(
      (p) => p.amountCents === 3_000,
    )!.id;
    expectOk(
      await t.firm('post', `/${theirs.id}/offline-payments/${bounced}/void`, t.people.ownerA, {
        reason: 'Fake: bounced',
      }),
    );
    await t.inScope(t.ids.firmA, async (tx) => {
      const p = await tx.payment.create({
        data: {
          businessId: t.ids.firmA,
          invoiceId: theirs.id,
          currency: 'usd',
          accountId: `acct_${t.run}A`,
          amountCents: 20_000,
          methodType: 'card',
          processorRef: `cs_test_${randomUUID().replace(/-/g, '')}`,
        },
      });
      await tx.paymentEvent.create({
        data: {
          businessId: t.ids.firmA,
          accountId: `acct_${t.run}A`,
          type: 'checkout.session.completed',
          paymentId: p.id,
          processorEventId: `evt_${randomUUID().replace(/-/g, '')}`,
        },
      });
      await tx.payment.update({
        where: { id: p.id },
        data: { status: 'SUCCEEDED', paidAt: new Date() },
      });
    });

    const all = await page();
    expect(all.total).toBe(4);
    expect(all.items.map((r) => [r.source, r.method, r.amountCents, r.status]).sort()).toEqual(
      [
        ['RECORDED', 'CASH', 3_000, 'VOIDED'],
        ['RECORDED', 'CASH', 5_000, 'RECEIVED'],
        ['RECORDED', 'CHECK', 10_000, 'RECEIVED'],
        ['STRIPE', 'CARD', 20_000, 'RECEIVED'],
      ].sort(),
    );
    expect(all.receivedCents).toBe(35_000);
    expect(all.items.every((r) => r.receivedOn === nyDay(0))).toBe(true);
    expect((await page(`?search=${encodeURIComponent(mine.number)}`)).items).toHaveLength(1);
    expect((await page('?pageSize=2')).items).toHaveLength(2);
    expect((await page('?from=2000-01-01&to=2000-12-31')).total).toBe(0);

    const staff = await page('', t.people.staffA);
    expect(staff.items.map((r) => r.invoice.id)).toEqual([mine.id]);
    expect((await page('', t.people.ownerB, t.ids.firmB)).total).toBe(0);
  });
});

describe('Recurring Invoices (IP-F17)', () => {
  it('lists the schedules with their amount and next send day, in reach', async () => {
    const make = (clientId: string, name: string, next: number, everyThreeWeeks = false) =>
      t.inScope(t.ids.firmA, async (tx) => {
        const r = await tx.recurringInvoice.create({
          data: {
            businessId: t.ids.firmA,
            clientId,
            name,
            ...(everyThreeWeeks
              ? { frequency: 'CUSTOM', intervalCount: 3, intervalUnit: 'WEEK' }
              : { frequency: 'MONTHLY' }),
            startOn: new Date(`${nyDay(next)}T00:00:00.000Z`),
            nextSendOn: new Date(`${nyDay(next)}T00:00:00.000Z`),
          },
        });
        await tx.recurringInvoiceLine.create({
          data: {
            businessId: t.ids.firmA,
            recurringInvoiceId: r.id,
            description: 'Fake monthly bookkeeping',
            quantity: 2,
            unitAmountCents: 15_000,
          },
        });
        return r.id;
      });
    const later = await make(t.ids.two, `Fake later ${t.run}`, 20, true);
    const sooner = await make(t.ids.one, `Fake sooner ${t.run}`, 5);
    const list = RecurringInvoiceList.parse(
      expectOk(await t.firm('get', '/recurring', t.people.ownerA)).body,
    );
    expect(list.items.map((r) => r.id)).toEqual([sooner, later]);
    expect(list.items[0]).toMatchObject({
      frequency: 'MONTHLY',
      interval: null,
      status: 'ACTIVE',
      nextSendOn: nyDay(5),
      amountCents: 30_000,
      autoSend: true,
      autopay: false,
    });
    // R1's custom schedule (Oct 28): every 3 weeks.
    expect(list.items[1]).toMatchObject({
      frequency: 'CUSTOM',
      interval: { count: 3, unit: 'WEEK' },
    });
    const staff = RecurringInvoiceList.parse(
      expectOk(await t.firm('get', '/recurring', t.people.staffA)).body,
    );
    expect(staff.items.map((r) => r.id)).toEqual([sooner]);
  });
});
