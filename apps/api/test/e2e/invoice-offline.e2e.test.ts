// End-to-end: R7 step 11, check and cash payments (POST /business/invoices/{id}/offline-payments
// and .../{offlinePaymentId}/void) on R0's offline_payments, against the database and the fake
// Stripe: PAID once covered, a retry records nothing twice, a void reopens, cancel is refused while
// the invoice holds money, an open checkout is ended first; Staff 403, firm B 404.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeStripeGateway } from '../../src/payments/stripe/fake-stripe.js';
import { codeOf, expectOk, Invoice, nyDay, startInvoiceApp } from './invoice-setup.js';

const fake = new FakeStripeGateway();
let t: Awaited<ReturnType<typeof startInvoiceApp>>;
beforeAll(async () => {
  t = await startInvoiceApp('r7o', fake);
});
afterAll(async () => {
  await t.app.close();
});

/** An OPEN $500 invoice of client one. */
const open = () => t.draft(t.ids.one, { status: 'OPEN' });
const cash = (amountCents: number, extra: object = {}) => ({
  method: 'CASH',
  amountCents,
  receivedOn: nyDay(0),
  idempotencyKey: randomUUID(),
  ...extra,
});
const record = (id: string, body: object, who = t.people.ownerA, businessId?: string) =>
  t.firm('post', `/${id}/offline-payments`, who, body, businessId);
const voidIt = (id: string, paymentId: string, who = t.people.adminA, businessId?: string) =>
  t.firm(
    'post',
    `/${id}/offline-payments/${paymentId}/void`,
    who,
    { reason: 'Bounced' },
    businessId,
  );
const actions = (id: string) =>
  t.inScope(t.ids.firmA, async (tx) =>
    (
      await tx.auditLog.findMany({
        where: { businessId: t.ids.firmA, entityId: id },
        orderBy: { createdAt: 'asc' },
        select: { action: true, metadata: true, actorUserId: true },
      })
    ).filter((a) => a.action.startsWith('invoice.offline') || a.action === 'invoice.paid'),
  );

describe('record a check or cash payment', () => {
  it('counts toward the balance, turns the invoice PAID once covered, and is audited', async () => {
    const invoice = await open();
    const part = Invoice.parse(expectOk(await record(invoice.id, cash(20_000))).body);
    expect(part).toMatchObject({
      status: 'OPEN',
      amountPaidCents: 20_000,
      balanceDueCents: 30_000,
    });
    const check = cash(30_000, { method: 'CHECK', reference: '1042', note: 'Dropped off' });
    const paid = Invoice.parse(expectOk(await record(invoice.id, check)).body);
    expect(paid).toMatchObject({ status: 'PAID', clientStatus: 'PAID', balanceDueCents: 0 });
    expect(paid.offlinePayments.map((o) => [o.method, o.amountCents, o.reference])).toEqual([
      ['CHECK', 30_000, '1042'],
      ['CASH', 20_000, null],
    ]);
    expect(paid.offlinePayments[0]).toMatchObject({
      note: 'Dropped off',
      receivedOn: nyDay(0),
      recordedBy: { userId: t.people.ownerA.id },
      voidedAt: null,
    });
    const audit = await actions(invoice.id);
    expect(audit.map((a) => a.action)).toEqual([
      'invoice.offline_payment_recorded',
      'invoice.offline_payment_recorded',
      'invoice.paid',
    ]);
    expect(audit[1]).toMatchObject({
      actorUserId: t.people.ownerA.id,
      metadata: { method: 'CHECK', amountCents: 30_000 },
    });
    expect(JSON.stringify(audit)).not.toContain('Dropped off');
    // The client sees live payments' method, amount and day only.
    const mine = expectOk(await t.portal('get', `/${invoice.id}`, t.people.primary)).body as {
      status: string;
      offlinePayments: object[];
    };
    expect(mine.status).toBe('PAID');
    expect(mine.offlinePayments.map((o) => Object.keys(o).sort())).toEqual([
      ['amountCents', 'currency', 'id', 'method', 'receivedOn'],
      ['amountCents', 'currency', 'id', 'method', 'receivedOn'],
    ]);
  });

  it('answers a retry with the same key as it is, recording nothing twice', async () => {
    const invoice = await open();
    const body = cash(10_000);
    expectOk(await record(invoice.id, body));
    const [again, both] = await Promise.all([
      record(invoice.id, body),
      record(invoice.id, { ...body, amountCents: 5_000 }),
    ]);
    for (const res of [again, both]) {
      expect(Invoice.parse(expectOk(res).body).offlinePayments).toHaveLength(1);
    }
  });

  it('refuses a future day (400), a draft (409 NOT_OPEN) and more than the balance (409)', async () => {
    const invoice = await open();
    const future = await record(invoice.id, cash(100, { receivedOn: nyDay(2) }));
    expect([future.status, codeOf(future)]).toEqual([400, 'VALIDATION_FAILED']);
    const noNumber = await record(invoice.id, cash(100, { method: 'CHECK' }));
    expect([noNumber.status, codeOf(noNumber)]).toEqual([400, 'VALIDATION_FAILED']);
    const big = await record(invoice.id, cash(50_001));
    expect([big.status, codeOf(big)]).toEqual([409, 'AMOUNT_TOO_LARGE']);
    const draft = await t.draft(t.ids.one);
    const notOpen = await record(draft.id, cash(100));
    expect([notOpen.status, codeOf(notOpen)]).toEqual([409, 'NOT_OPEN']);
  });

  it('is for Owner and Admin of this firm only: Staff 403, firm B 404', async () => {
    const invoice = await open();
    const staff = await record(invoice.id, cash(100), t.people.staffA);
    expect([staff.status, codeOf(staff)]).toEqual([403, 'FORBIDDEN']);
    const other = await record(invoice.id, cash(100), t.people.ownerB, t.ids.firmB);
    expect([other.status, codeOf(other)]).toEqual([404, 'NOT_FOUND']);
    expectOk(await record(invoice.id, cash(100), t.people.adminA));
    const [row] = Invoice.parse(
      expectOk(await t.firm('get', `/${invoice.id}`, t.people.ownerA)).body,
    ).offlinePayments;
    const voidB = await voidIt(invoice.id, row!.id, t.people.ownerB, t.ids.firmB);
    expect([voidB.status, codeOf(voidB)]).toEqual([404, 'NOT_FOUND']);
    const voidStaff = await voidIt(invoice.id, row!.id, t.people.staffA);
    expect(voidStaff.status).toBe(403);
  });

  it('ends a checkout the client opened and left before recording', async () => {
    const invoice = await open();
    expectOk(await t.portal('post', `/${invoice.id}/checkout`, t.people.primary, {}));
    const [pending] = await t.inScope(t.ids.firmA, (tx) =>
      tx.payment.findMany({ where: { businessId: t.ids.firmA, invoiceId: invoice.id } }),
    );
    const res = await record(invoice.id, cash(50_000));
    expect(Invoice.parse(expectOk(res).body).status).toBe('PAID');
    expect(fake.sessions.get(pending!.processorRef)?.status).toBe('expired');
    const after = await t.inScope(t.ids.firmA, (tx) =>
      tx.payment.findFirstOrThrow({ where: { businessId: t.ids.firmA, id: pending!.id } }),
    );
    expect([after.status, after.failureCode]).toEqual(['FAILED', 'checkout_expired']);
  });
});

describe('void a check or cash payment', () => {
  it('reopens a PAID invoice it no longer covers, once, and lets cancel through after', async () => {
    const invoice = await open();
    const paid = Invoice.parse(expectOk(await record(invoice.id, cash(50_000))).body);
    const id = paid.offlinePayments[0]!.id;
    const held = await t.firm('post', `/${invoice.id}/cancel`, t.people.ownerA, { reason: 'x' });
    expect([held.status, codeOf(held)]).toEqual([409, 'INVOICE_CLOSED']);
    const reopened = Invoice.parse(expectOk(await voidIt(invoice.id, id)).body);
    expect(reopened).toMatchObject({ status: 'OPEN', paidAt: null, balanceDueCents: 50_000 });
    expect(reopened.offlinePayments[0]).toMatchObject({
      voidReason: 'Bounced',
      voidedBy: { userId: t.people.adminA.id },
    });
    expect(reopened.offlinePayments[0]!.voidedAt).not.toBeNull();
    const again = await voidIt(invoice.id, id);
    expect([again.status, codeOf(again)]).toEqual([409, 'ALREADY_VOIDED']);
    expect((await actions(invoice.id)).at(-1)).toMatchObject({
      action: 'invoice.offline_payment_voided',
      metadata: { offlinePaymentId: id, amountCents: 50_000, reopened: true },
    });
    const mine = expectOk(await t.portal('get', `/${invoice.id}`, t.people.primary)).body as {
      offlinePayments: object[];
    };
    expect(mine.offlinePayments).toEqual([]);
    expectOk(await t.firm('post', `/${invoice.id}/cancel`, t.people.ownerA, { reason: 'x' }));
  });

  it('refuses cancel while a live payment is held, and a payment of another invoice (404)', async () => {
    const invoice = await open();
    const part = Invoice.parse(expectOk(await record(invoice.id, cash(1_000))).body);
    const held = await t.firm('post', `/${invoice.id}/cancel`, t.people.ownerA, { reason: 'x' });
    expect([held.status, codeOf(held)]).toEqual([409, 'HAS_PAYMENTS']);
    const other = await open();
    const wrong = await voidIt(other.id, part.offlinePayments[0]!.id);
    expect([wrong.status, codeOf(wrong)]).toEqual([404, 'NOT_FOUND']);
    const unknown = await voidIt(invoice.id, randomUUID());
    expect(unknown.status).toBe(404);
  });
});
