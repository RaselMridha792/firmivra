// End-to-end: R55, PAY-3 and IP-F14 (Settings > Payments, Accepted Client Payments). A firm that
// never chose takes cards through Stripe once Stripe is ready; the Owner or an Admin turns cards
// off and on; off takes Pay Now away (the portal's canPay, checkout, the firm's list); bank
// payments stay off; a processor that can't take payments is refused; each lock says what it
// needs; the billing sections' version and values are untouched; firm B reaches none of it.
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ACCEPTED_PAYMENT_LOCKS, AcceptedPayments } from '@firmivra/types';
import { FakeStripeGateway } from '../../src/payments/stripe/fake-stripe.js';
import { codeOf, expectOk, startInvoiceApp } from './invoice-setup.js';

const Accepted = z.strictObject({
  ...AcceptedPayments.shape,
  locks: z.strictObject(AcceptedPayments.shape.locks.shape),
});
let t: Awaited<ReturnType<typeof startInvoiceApp>>;
beforeAll(async () => {
  t = await startInvoiceApp('r55ap', new FakeStripeGateway());
});
afterAll(async () => {
  await t.app.close();
});

const tokens = new Map<string, string>();
async function call(
  method: 'get' | 'put',
  path: string,
  who: { email: string },
  body?: object,
  businessId = t.ids.firmA,
): Promise<Response> {
  let token = tokens.get(who.email);
  if (!token) {
    const res = await request(t.app.getHttpServer())
      .post('/api/v1/dev/token')
      .send({ email: who.email })
      .expect(200);
    token = (res.body as { token: string }).token;
    tokens.set(who.email, token);
  }
  const req = request(t.app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', businessId)
    .set('authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body);
}
const accepted = (who: { email: string }, businessId?: string) =>
  call('get', '/payments/setup/accepted', who, undefined, businessId);
const save = (who: { email: string }, body: object, businessId?: string) =>
  call(
    'put',
    '/payments/setup/accepted',
    who,
    {
      acceptCard: true,
      defaultCardProcessor: 'STRIPE',
      acceptAch: false,
      achProcessor: 'STRIPE',
      ...body,
    },
    businessId,
  );
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const settingsRow = () =>
  t.inScope(t.ids.firmA, (tx) =>
    tx.paymentSettings.findUnique({ where: { businessId: t.ids.firmA } }),
  );
const canPay = async (invoiceId: string) => {
  const list = expectOk(await t.portal('get', '', t.people.primary)).body as {
    items: { id: string; canPay: boolean }[];
  };
  return list.items.find((i) => i.id === invoiceId)?.canPay;
};

describe('Accepted Client Payments (PAY-3, IP-F14)', () => {
  it('takes cards through Stripe until the firm turns them off, and Pay Now follows', async () => {
    expect(await settingsRow()).toBeNull();
    const start = Accepted.parse(expectOk(await accepted(t.people.adminA)).body);
    expect(start).toEqual({
      acceptCard: true,
      defaultCardProcessor: 'STRIPE',
      acceptAch: false,
      achProcessor: 'STRIPE',
      readyProcessors: ['STRIPE'],
      locks: { card: null, ach: ACCEPTED_PAYMENT_LOCKS.ach, paypal: ACCEPTED_PAYMENT_LOCKS.paypal },
      onlinePayments: true,
    });
    const invoice = await t.draft(t.ids.one, { status: 'OPEN' });
    expect(await canPay(invoice.id)).toBe(true);

    // An Admin turns cards off: the firm's first row, its billing sections as never saved (off).
    const off = Accepted.parse(expectOk(await save(t.people.adminA, { acceptCard: false })).body);
    expect(off).toMatchObject({ acceptCard: false, onlinePayments: false });
    const prefs = expectOk(await call('get', '/settings/payment-preferences', t.people.ownerA))
      .body as { reminders: { sendReminders: boolean; autoReceipts: boolean } };
    expect(prefs.reminders).toMatchObject({ sendReminders: false, autoReceipts: false });
    expect(await canPay(invoice.id)).toBe(false);
    expectError(
      await t.portal('post', `/${invoice.id}/checkout`, t.people.primary, {}),
      409,
      'PAYMENTS_NOT_SET_UP',
    );
    expect(
      (expectOk(await t.firm('get', '', t.people.ownerA)).body as { paymentsEnabled: boolean })
        .paymentsEnabled,
    ).toBe(false);

    // On again: the billing sections' version (their Save's check) is the same as before.
    const version = (await settingsRow())?.updatedAt.toISOString();
    const on = Accepted.parse(expectOk(await save(t.people.ownerA, { acceptCard: true })).body);
    expect(on.onlinePayments).toBe(true);
    expect((await settingsRow())?.updatedAt.toISOString()).toBe(version);
    expect(await canPay(invoice.id)).toBe(true);

    // Each change is audited with the methods only.
    const audit = await t.inScope(t.ids.firmA, (tx) =>
      tx.auditLog.findMany({
        where: { action: 'payments.accepted_methods_updated', entityId: t.ids.firmA },
        orderBy: { createdAt: 'asc' },
      }),
    );
    expect(audit.map((a) => a.metadata)).toEqual([
      {
        from: {
          acceptCard: true,
          defaultCardProcessor: 'STRIPE',
          acceptAch: false,
          achProcessor: 'STRIPE',
        },
        to: {
          acceptCard: false,
          defaultCardProcessor: 'STRIPE',
          acceptAch: false,
          achProcessor: 'STRIPE',
        },
      },
      {
        from: {
          acceptCard: false,
          defaultCardProcessor: 'STRIPE',
          acceptAch: false,
          achProcessor: 'STRIPE',
        },
        to: {
          acceptCard: true,
          defaultCardProcessor: 'STRIPE',
          acceptAch: false,
          achProcessor: 'STRIPE',
        },
      },
    ]);
    // Saving the same again changes and records nothing.
    expectOk(await save(t.people.ownerA, {}));
    expect(
      await t.inScope(t.ids.firmA, (tx) =>
        tx.auditLog.count({ where: { action: 'payments.accepted_methods_updated' } }),
      ),
    ).toBe(2);
  });

  it('keeps bank payments off, refuses a processor that cannot take payments, and says why', async () => {
    expectError(await save(t.people.ownerA, { acceptAch: true }), 409, 'ACH_NOT_OFFERED');
    // Firm B has no Stripe account: its card control is locked and says what it needs.
    const b = Accepted.parse(expectOk(await accepted(t.people.ownerB, t.ids.firmB)).body);
    expect(b).toMatchObject({
      readyProcessors: [],
      onlinePayments: false,
      locks: { card: ACCEPTED_PAYMENT_LOCKS.cardNotConnected },
    });
    expectError(
      await save(t.people.ownerB, { acceptCard: false }, t.ids.firmB),
      409,
      'PROCESSOR_NOT_READY',
    );
    // Its unchanged values save (nothing to do), and no row is made for it.
    expectOk(await save(t.people.ownerB, {}, t.ids.firmB));
    expect(
      await t.inScope(t.ids.firmB, (tx) =>
        tx.paymentSettings.findUnique({ where: { businessId: t.ids.firmB } }),
      ),
    ).toBeNull();
  });

  it('is the Owner’s and Admins’ only, and firm B never reaches firm A’s', async () => {
    expectError(await accepted(t.people.staffA), 403, 'FORBIDDEN');
    expectError(await save(t.people.staffA, { acceptCard: false }), 403, 'FORBIDDEN');
    expectError(await accepted(t.people.ownerB), 404, 'NOT_FOUND');
    expectError(await save(t.people.ownerB, { acceptCard: false }), 404, 'NOT_FOUND');
    expect((await settingsRow())?.acceptCard).toBe(true);
    expectError(
      await call('put', '/payments/setup/accepted', t.people.ownerA, { acceptCard: false }),
      400,
      'VALIDATION_FAILED',
    );
  });
});
