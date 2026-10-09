// End-to-end: R7 step 11, check and cash payments (POST /business/invoices/{id}/offline-payments
// and .../{offlinePaymentId}/void) on R0's offline_payments, against the database and the fake
// Stripe: PAID once covered, a retry records nothing twice, a void reopens, cancel is refused while
// the invoice holds money, an open checkout is ended first; Staff 403, firm B 404.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { KEY_INDEX, violatedIndex } from '../../src/payments/offline/offline-payments.service.js';
import { FakeStripeGateway } from '../../src/payments/stripe/fake-stripe.js';
import { codeOf, expectOk, Invoice, nyDay, startInvoiceApp } from './invoice-setup.js';
import { deliverEvent, stripeEvent } from './stripe-events.js';

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
    // The key is the firm's: used on another invoice, it is 404 and records nothing there.
    const other = await open();
    const elsewhere = await record(other.id, body);
    expect([elsewhere.status, codeOf(elsewhere)]).toEqual([404, 'NOT_FOUND']);
    const untouched = Invoice.parse(
      expectOk(await t.firm('get', `/${other.id}`, t.people.ownerA)).body,
    );
    expect(untouched.offlinePayments).toEqual([]);
  });

  it('records two first-time requests with one new key at once once (both 200)', async () => {
    const invoice = await open();
    const body = cash(10_000);
    const both = await Promise.all([record(invoice.id, body), record(invoice.id, body)]);
    for (const res of both) {
      expect(Invoice.parse(expectOk(res).body).offlinePayments).toHaveLength(1);
    }
    const rows = await t.inScope(t.ids.firmA, (tx) =>
      tx.offlinePayment.count({ where: { businessId: t.ids.firmA, invoiceId: invoice.id } }),
    );
    expect(rows).toBe(1);
  });

  it('takes recordings at once in turn: none goes over the balance (one 200, the rest 409)', async () => {
    const invoice = await open();
    const answers = await Promise.all([1, 2, 3].map(() => record(invoice.id, cash(30_000))));
    const outcomes = answers.map((res) => [res.status, codeOf(res) ?? null]).sort();
    expect(outcomes).toEqual([
      [200, null],
      [409, 'AMOUNT_TOO_LARGE'],
      [409, 'AMOUNT_TOO_LARGE'],
    ]);
    const after = Invoice.parse(
      expectOk(await t.firm('get', `/${invoice.id}`, t.people.ownerA)).body,
    );
    expect([after.amountPaidCents, after.offlinePayments.length]).toEqual([30_000, 1]);
  });

  it("tells the database's two unique refusals apart: the key (a retry) and the check", async () => {
    const invoice = await open();
    const first = cash(1_000, { method: 'CHECK', reference: 'R-555' });
    expectOk(await record(invoice.id, first));
    const db = createPrismaClient(testDatabaseUrls('test_api').app);
    const insert = (idempotencyKey: string, reference: string) =>
      runInScope(
        db,
        { kind: 'business', businessId: t.ids.firmA, actorUserId: t.people.ownerA.id },
        (tx) =>
          tx.offlinePayment.create({
            data: {
              businessId: t.ids.firmA,
              invoiceId: invoice.id,
              method: 'CHECK',
              amountCents: 1_000,
              reference,
              receivedOn: new Date(`${nyDay(0)}T00:00:00.000Z`),
              idempotencyKey,
              recordedByUserId: t.people.ownerA.id,
            },
          }),
      ).then(
        () => 'inserted',
        (e: unknown) => violatedIndex(e),
      );
    try {
      expect(await insert(first.idempotencyKey, 'R-556')).toBe(KEY_INDEX);
      expect(await insert(randomUUID(), 'r-555')).toBe('offline_payments_one_live_check');
    } finally {
      await db.$disconnect();
    }
  });

  it('refuses a check number live on this invoice already, in any case (409)', async () => {
    const invoice = await open();
    const check = (reference: string) => cash(1_000, { method: 'CHECK', reference });
    const first = Invoice.parse(expectOk(await record(invoice.id, check('1042'))).body);
    expectOk(await record(invoice.id, check('AB-1')));
    for (const reference of ['1042', 'ab-1']) {
      const twice = await record(invoice.id, check(reference));
      expect([twice.status, codeOf(twice)]).toEqual([409, 'DUPLICATE_CHECK_NUMBER']);
    }
    // A cash receipt with that number, the number on another invoice, or after a void: fine.
    expectOk(await record(invoice.id, cash(1_000, { reference: '1042' })));
    const other = await open();
    expectOk(await record(other.id, check('1042')));
    const id = first.offlinePayments.find((o) => o.reference === '1042')!.id;
    expectOk(await voidIt(invoice.id, id));
    expectOk(await record(invoice.id, check('1042')));
    // Two at once with new keys: one is recorded, the other is the duplicate (never a replay).
    const answers = await Promise.all([
      record(invoice.id, check('77')),
      record(invoice.id, check('77')),
    ]);
    expect(answers.map((res) => [res.status, codeOf(res) ?? null]).sort()).toEqual([
      [200, null],
      [409, 'DUPLICATE_CHECK_NUMBER'],
    ]);
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

  it('voids once when two voids come at once (one 200, one 409 ALREADY_VOIDED)', async () => {
    const invoice = await open();
    const part = Invoice.parse(expectOk(await record(invoice.id, cash(1_000))).body);
    const id = part.offlinePayments[0]!.id;
    const answers = await Promise.all([voidIt(invoice.id, id), voidIt(invoice.id, id)]);
    expect(answers.map((res) => [res.status, codeOf(res) ?? null]).sort()).toEqual([
      [200, null],
      [409, 'ALREADY_VOIDED'],
    ]);
    const voids = (await actions(invoice.id)).filter(
      (a) => a.action === 'invoice.offline_payment_voided',
    );
    expect(voids).toHaveLength(1);
    expect(JSON.stringify(voids)).not.toContain('Bounced');
  });

  it('refuses cancel while a SUCCEEDED Stripe payment is held (409 HAS_PAYMENTS)', async () => {
    const invoice = await open();
    const cashPart = Invoice.parse(expectOk(await record(invoice.id, cash(20_000))).body);
    expectOk(await t.portal('post', `/${invoice.id}/checkout`, t.people.primary, {}));
    const payment = await t.inScope(t.ids.firmA, (tx) =>
      tx.payment.findFirstOrThrow({ where: { businessId: t.ids.firmA, invoiceId: invoice.id } }),
    );
    const intent = fake.sessions.get(payment.processorRef)!.paymentIntentId!;
    fake.setSession(payment.processorRef, { status: 'complete' });
    expectOk(
      await deliverEvent(
        t.app,
        stripeEvent('checkout.session.completed', `acct_${t.run}A`, {
          id: payment.processorRef,
          payment_status: 'paid',
          amount_total: 30_000,
          payment_intent: intent,
          metadata: { payment_id: payment.id },
        }),
      ),
    );
    // Voiding the cash leaves the invoice uncovered: it reopens, holding the card payment.
    const reopened = await voidIt(invoice.id, cashPart.offlinePayments[0]!.id);
    expect(Invoice.parse(expectOk(reopened).body).status).toBe('OPEN');
    const held = await t.firm('post', `/${invoice.id}/cancel`, t.people.ownerA, { reason: 'x' });
    expect([held.status, codeOf(held)]).toEqual([409, 'HAS_PAYMENTS']);
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
