// End-to-end: Invoices Review 2 I-N06, Edit on a scheduled or sent-unpaid invoice (PUT
// /business/invoices/{id}), on the same number, with a reason kept in the audit and the history.
// A sent one: the client's open Pay Now page is ended first and the next one charges the new
// total; the update goes to the client by default. With money on it, or paid or canceled, 409.
// Against the fake Stripe; synthetic data only.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InvoiceHistory } from '@firmivra/types';
import { FakeStripeGateway } from '../../src/payments/stripe/fake-stripe.js';
import { codeOf, expectOk, Invoice, nyDay, startInvoiceApp } from './invoice-setup.js';

const fake = new FakeStripeGateway();
let t: Awaited<ReturnType<typeof startInvoiceApp>>;
beforeAll(async () => {
  t = await startInvoiceApp('r1ie', fake);
});
afterAll(async () => {
  await t.app.close();
});

const lines = (unitAmountCents: number) => [{ description: 'Fake bookkeeping', unitAmountCents }];
async function create(extra: object = {}) {
  return Invoice.parse(
    expectOk(
      await t.firm('post', '', t.people.ownerA, {
        clientId: t.ids.one,
        lines: lines(12_345),
        dueOn: nyDay(30),
        ...extra,
      }),
    ).body,
  );
}
async function send(id: string) {
  return Invoice.parse(expectOk(await t.firm('post', `/${id}/send`, t.people.ownerA, {})).body);
}
const edit = (id: string, body: object) => t.firm('put', `/${id}`, t.people.ownerA, body);
const pay = (id: string) => t.portal('post', `/${id}/checkout`, t.people.primary, {});
const paymentsOf = (invoiceId: string) =>
  t.inScope(t.ids.firmA, (tx) =>
    tx.payment.findMany({ where: { invoiceId }, orderBy: { createdAt: 'asc' } }),
  );
const audits = (id: string, action: string) =>
  t.inScope(t.ids.firmA, (tx) =>
    tx.auditLog.findMany({
      where: { entityId: id, action },
      select: { metadata: true },
      orderBy: { createdAt: 'asc' },
    }),
  );
const history = async (id: string) =>
  InvoiceHistory.parse(expectOk(await t.firm('get', `/${id}/history`, t.people.ownerA)).body).items;
const refused = async (
  res: Promise<{ status: number; body: unknown }>,
  status: number,
  code: string,
) => {
  const r = await res;
  expect([r.status, codeOf(r as never)], JSON.stringify(r.body)).toEqual([status, code]);
  return r;
};

describe('Edit a scheduled invoice (I-N06)', () => {
  it('needs a reason, keeps its number, and the reason and amounts go in the audit and history', async () => {
    const s = await send((await create({ scheduledFor: nyDay(5), dueOn: nyDay(20) })).id);
    expect(s.status).toBe('SCHEDULED');
    const body = { lines: lines(25_000), dueOn: nyDay(20), scheduledFor: nyDay(5) };
    const missing = await refused(edit(s.id, body), 400, 'VALIDATION_FAILED');
    expect(JSON.stringify(missing.body)).toContain('reason');
    const edited = Invoice.parse(
      expectOk(await edit(s.id, { ...body, reason: 'Client asked for the full year (fake)' })).body,
    );
    expect(edited).toMatchObject({ status: 'SCHEDULED', number: s.number, totalCents: 25_000 });
    expect((await audits(s.id, 'invoice.updated')).at(-1)?.metadata).toMatchObject({
      status: 'SCHEDULED',
      reason: 'Client asked for the full year (fake)',
      changed: { totalCents: { from: 12_345, to: 25_000 } },
    });
    expect((await history(s.id))[0]).toMatchObject({
      type: 'ACTIVITY_LOGGED',
      body: 'Invoice edited (total $123.45 to $250.00): Client asked for the full year (fake)',
    });
  });
});

describe('Edit a sent invoice with nothing paid (I-N06)', () => {
  it('ends the open Pay Now page, keeps the number, sends the update, and the next page charges the new total', async () => {
    const o = await send((await create()).id);
    expect(o.status).toBe('OPEN');
    // The client opened the pay page: a checkout for the old amount.
    expectOk(await pay(o.id));
    const [old] = await paymentsOf(o.id);
    expect(old).toMatchObject({ status: 'PENDING', amountCents: 12_345 });

    const body = { lines: lines(20_000), dueOn: nyDay(30) };
    await refused(edit(o.id, body), 400, 'VALIDATION_FAILED');
    await refused(
      edit(o.id, { ...body, scheduledFor: nyDay(3), reason: 'x' }),
      409,
      'NOT_CORRECTABLE',
    );
    // A correction leaves something to pay.
    await refused(
      edit(o.id, { lines: lines(5_000), discountCents: 5_000, dueOn: nyDay(30), reason: 'x' }),
      400,
      'VALIDATION_FAILED',
    );
    const edited = Invoice.parse(
      expectOk(await edit(o.id, { ...body, reason: 'Wrong rate billed (fake)' })).body,
    );
    expect(edited).toMatchObject({ status: 'OPEN', number: o.number, totalCents: 20_000 });
    // The old checkout is ended at Stripe and its payment marked expired.
    expect(fake.sessions.get(old!.processorRef)!.status).toBe('expired');
    expect((await paymentsOf(o.id))[0]).toMatchObject({
      status: 'FAILED',
      failureCode: 'checkout_expired',
    });
    // The update went to the client (the usual invoice email), and the audit and history say why.
    expect(await audits(o.id, 'invoice.resent')).toHaveLength(1);
    expect((await audits(o.id, 'invoice.updated')).at(-1)?.metadata).toMatchObject({
      status: 'OPEN',
      reason: 'Wrong rate billed (fake)',
      sendUpdate: true,
      changed: { totalCents: { from: 12_345, to: 20_000 } },
    });
    expect((await history(o.id))[0]?.body).toBe(
      'Invoice edited (total $123.45 to $200.00): Wrong rate billed (fake)',
    );
    // The next pay page charges the new total.
    expectOk(await pay(o.id));
    const fresh = (await paymentsOf(o.id)).at(-1);
    expect(fresh).toMatchObject({ status: 'PENDING', amountCents: 20_000 });
  });

  it('with sendUpdate false, nothing goes to the client', async () => {
    const o = await send((await create()).id);
    expectOk(
      await edit(o.id, {
        lines: lines(15_000),
        dueOn: nyDay(30),
        reason: 'Typo in the description (fake)',
        sendUpdate: false,
      }),
    );
    expect(await audits(o.id, 'invoice.resent')).toHaveLength(0);
  });

  it('with a payment on it (partly paid), or paid or canceled, it stays as it is: 409', async () => {
    const o = await send((await create()).id);
    expectOk(
      await t.firm('post', `/${o.id}/offline-payments`, t.people.ownerA, {
        method: 'CASH',
        amountCents: 2_000,
        receivedOn: nyDay(0),
        idempotencyKey: randomUUID(),
      }),
    );
    // I-N10: the list says how money came in (the Payment Method filter).
    const listed = (
      expectOk(await t.firm('get', '?limit=100', t.people.ownerA)).body as {
        items: { id: string; paymentMethods: string[] }[];
      }
    ).items.find((i) => i.id === o.id);
    expect(listed?.paymentMethods).toEqual(['CASH']);
    const body = { lines: lines(20_000), dueOn: nyDay(30), reason: 'Wrong rate (fake)' };
    await refused(edit(o.id, body), 409, 'HAS_PAYMENTS');
    expect(
      Invoice.parse(expectOk(await t.firm('get', `/${o.id}`, t.people.ownerA)).body),
    ).toMatchObject({ totalCents: 12_345 });
    const c = await send((await create()).id);
    expectOk(await t.firm('post', `/${c.id}/cancel`, t.people.ownerA, { reason: 'Billed twice' }));
    await refused(edit(c.id, body), 409, 'INVOICE_CLOSED');
  });
});
