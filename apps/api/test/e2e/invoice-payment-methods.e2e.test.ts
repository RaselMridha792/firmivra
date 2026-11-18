// IP-F20 (Octavia's Invoices & Payments review, Oct 27): the overview's Payment Methods chart.
// GET /business/invoices/payment-methods sums the money collected in a range, on the firm's
// calendar, by method: Stripe payments its webhook confirmed (less confirmed refunds) and payments
// the firm recorded by hand, not voided. Staff see only their clients' money; another firm none.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { DashboardSummary, PaymentMethodsSummary, PaymentPage } from '@firmivra/types';
import { codeOf, expectOk, nyDay, startInvoiceApp } from './invoice-setup.js';

let t: Awaited<ReturnType<typeof startInvoiceApp>>;
beforeAll(async () => {
  t = await startInvoiceApp('r56pm');
});
afterAll(async () => {
  await t.app.close();
});

const record = (invoiceId: string, method: string, amountCents: number, extra: object = {}) =>
  t.firm('post', `/${invoiceId}/offline-payments`, t.people.ownerA, {
    method,
    amountCents,
    receivedOn: nyDay(0),
    idempotencyKey: randomUUID(),
    ...(method === 'CHECK' ? { reference: '2201' } : {}),
    ...extra,
  });
/**
 * A Stripe card payment its webhook confirmed, paid `daysAgo` days ago, and a confirmed refund of
 * `refundCents` confirmed `refundDaysAgo` days ago.
 */
const midday = (daysAgo: number) =>
  daysAgo === 0 ? new Date() : new Date(`${nyDay(-daysAgo)}T17:00:00.000Z`);
const stripePaid = (
  invoiceId: string,
  amountCents: number,
  daysAgo = 0,
  refundCents = 0,
  refundDaysAgo = 0,
) =>
  t.inScope(t.ids.firmA, async (tx) => {
    const p = await tx.payment.create({
      data: {
        businessId: t.ids.firmA,
        invoiceId,
        currency: 'usd',
        accountId: `acct_${t.run}A`,
        amountCents,
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
      // Midday (New York) of that firm day: 400 days of 24 hours back can cross a daylight-saving
      // change and land on the day before near midnight, which the range test then misses.
      data: {
        status: 'SUCCEEDED',
        paidAt: midday(daysAgo),
      },
    });
    if (refundCents > 0) {
      const refunded = await tx.paymentEvent.create({
        data: {
          businessId: t.ids.firmA,
          accountId: `acct_${t.run}A`,
          type: 'charge.refunded',
          paymentId: p.id,
          processorEventId: `evt_${randomUUID().replace(/-/g, '')}`,
        },
      });
      await tx.paymentRefund.create({
        data: {
          businessId: t.ids.firmA,
          paymentId: p.id,
          accountId: `acct_${t.run}A`,
          amountCents: refundCents,
          currency: 'usd',
          processorRefundId: `re_${randomUUID().replace(/-/g, '')}`,
          status: 'SUCCEEDED',
          eventId: refunded.id,
          refundedAt: midday(refundDaysAgo),
        },
      });
    }
  });
const methods = async (query = '', who = t.people.ownerA, businessId?: string) =>
  PaymentMethodsSummary.parse(
    expectOk(await t.firm('get', `/payment-methods${query}`, who, undefined, businessId)).body,
  );

describe('Payment Methods (IP-F20)', () => {
  it('sums Stripe and recorded payments by method; voided and out-of-range money stays out', async () => {
    const one = await t.draft(t.ids.one, { status: 'OPEN' });
    const two = await t.draft(t.ids.two, { status: 'OPEN' });
    expectOk(await record(one.id, 'CHECK', 10_000));
    expectOk(await record(two.id, 'CASH', 5_000));
    const voided = expectOk(await record(two.id, 'CASH', 3_000)).body as {
      offlinePayments: { id: string; amountCents: number }[];
    };
    const bounced = voided.offlinePayments.find((p) => p.amountCents === 3_000)!.id;
    expectOk(
      await t.firm('post', `/${two.id}/offline-payments/${bounced}/void`, t.people.ownerA, {
        reason: 'Fake: bounced',
      }),
    );
    // A card payment with a confirmed partial refund counts what was kept.
    await stripePaid(two.id, 20_000, 0, 4_000);
    // Paid well before this year: outside the default range.
    await stripePaid(two.id, 1_000, 400);

    const all = await methods();
    expect(all).toMatchObject({ from: `${nyDay(0).slice(0, 4)}-01-01`, to: nyDay(0) });
    expect(all.items).toEqual([
      { method: 'CARD', amountCents: 16_000, count: 1 },
      { method: 'CASH', amountCents: 5_000, count: 1 },
      { method: 'CHECK', amountCents: 10_000, count: 1 },
    ]);
    expect(all.totalCents).toBe(31_000);

    // A range with none of it, and one that holds only the old payment.
    expect(await methods(`?from=2000-01-01&to=2000-12-31`)).toMatchObject({
      items: [],
      totalCents: 0,
    });
    const old = nyDay(-400);
    expect((await methods(`?from=${old}&to=${old}`)).items).toEqual([
      { method: 'CARD', amountCents: 1_000, count: 1 },
    ]);
  });

  it('Staff see only their clients’ money; firm B sees none of firm A’s', async () => {
    const staff = await methods('', t.people.staffA);
    expect(staff.items).toEqual([{ method: 'CHECK', amountCents: 10_000, count: 1 }]);
    const firmB = await methods('', t.people.ownerB, t.ids.firmB);
    expect(firmB).toMatchObject({ items: [], totalCents: 0 });
  });

  it('refuses a range that ends before it starts, and audits the read', async () => {
    const res = await t.firm(
      'get',
      '/payment-methods?from=2026-05-02&to=2026-05-01',
      t.people.ownerA,
    );
    expect([res.status, codeOf(res)]).toEqual([400, 'VALIDATION_FAILED']);
    const audit = await t.inScope(t.ids.firmA, (tx) =>
      tx.auditLog.count({
        where: { businessId: t.ids.firmA, action: 'invoices.payment_methods.viewed' },
      }),
    );
    expect(audit).toBeGreaterThan(0);
  });
});

describe('Dashboard Review 2: a refund counts on the day it is confirmed, in every total', () => {
  it('the dashboard, All Payments and Payment Methods agree on the payment day, the refund day and both', async () => {
    const tokenRes = await request(t.app.getHttpServer())
      .post('/api/v1/dev/token')
      .send({ email: t.people.ownerA.email })
      .expect(200);
    const token = (tokenRes.body as { token: string }).token;
    const dashboard = async (from: string, to: string) => {
      const res = await request(t.app.getHttpServer())
        .get(
          `/api/v1/business/dashboard/summary?revenuePeriod=CUSTOM&revenueFrom=${from}&revenueTo=${to}`,
        )
        .set('x-business-id', t.ids.firmA)
        .set('authorization', `Bearer ${token}`);
      // The Owner may view Invoices & Payments, so the revenue is there (V5).
      return DashboardSummary.parse(expectOk(res).body).revenue!;
    };
    const payments = async (from: string, to: string) =>
      PaymentPage.parse(
        expectOk(await t.firm('get', `/payments?from=${from}&to=${to}`, t.people.ownerA)).body,
      );
    const totals = async (from: string, to: string) => {
      const [d, p, m] = await Promise.all([
        dashboard(from, to),
        payments(from, to),
        methods(`?from=${from}&to=${to}`),
      ]);
      return { dashboard: d.totalCents, allPayments: p.receivedCents, methods: m.totalCents };
    };

    // $300 by card five days ago; $100 of it refunded, confirmed two days ago (day X).
    const invoice = await t.draft(t.ids.one, { status: 'OPEN' });
    await stripePaid(invoice.id, 30_000, 5, 10_000, 2);
    const paidOn = nyDay(-5);
    const refundOn = nyDay(-2);

    // The payment's day keeps the whole payment: the refund is not on it.
    expect(await totals(paidOn, paidOn)).toEqual({
      dashboard: 30_000,
      allPayments: 30_000,
      methods: 30_000,
    });
    // Both days: the payment less the refund, everywhere.
    expect(await totals(paidOn, refundOn)).toEqual({
      dashboard: 20_000,
      allPayments: 20_000,
      methods: 20_000,
    });
    // Day X alone: the refund lowers its total. Payment Methods leaves a method at or below zero
    // out, as Service Breakdown does.
    expect(await totals(refundOn, refundOn)).toEqual({
      dashboard: -10_000,
      allPayments: -10_000,
      methods: 0,
    });
    const dayX = await dashboard(refundOn, refundOn);
    expect(dayX.buckets).toEqual([{ from: refundOn, to: refundOn, cents: -10_000 }]);
    // All Payments lists the refund on its own day, as its own row.
    const rows = (await payments(refundOn, refundOn)).items;
    expect(rows).toEqual([
      expect.objectContaining({
        status: 'REFUNDED',
        amountCents: -10_000,
        receivedOn: refundOn,
        invoice: expect.objectContaining({ id: invoice.id }),
      }),
    ]);
    const onPaidDay = (await payments(paidOn, paidOn)).items;
    expect(onPaidDay).toEqual([
      expect.objectContaining({ status: 'RECEIVED', amountCents: 30_000, receivedOn: paidOn }),
    ]);
  });
});
