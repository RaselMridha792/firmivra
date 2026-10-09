// Offline payments (Rasel, Oct 8, q28 h): an active Owner or Admin, acting as themselves, records a
// check or cash payment on an OPEN invoice, never above the balance due and never while a Stripe
// checkout is open. A recorded payment never changes and is never deleted; a mistake is voided
// once, with a reason, through app_void_offline_payment, and a void that leaves a PAID invoice
// uncovered reopens it. A new checkout is never for more than the balance. Runs as the app role
// under RLS.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope, type TxClient } from '../src/client.js';
import { DB_ERRORS, databaseErrorCode, isDbError } from '../src/errors.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
/** People: firm A's team (by role and status), a client login, firm B's owner, a Super Admin. */
const u = {
  owner: randomUUID(),
  admin: randomUUID(),
  staff: randomUUID(),
  invited: randomUUID(),
  deactivated: randomUUID(),
  racerG: randomUUID(),
  racerH: randomUUID(),
  client: randomUUID(),
  ownerB: randomUUID(),
  superAdmin: randomUUID(),
};
const ids = { firmA: '', firmB: '', client: '', clientB: '' };
/** Stripe ids have no hyphens. */
const stripeId = () => randomUUID().replace(/-/g, '');
const account = `acct_${stripeId()}`;
let invoiceNumber = 0;
let checkNumber = 1000;

/** Firm A's business scope, acting as `actor` (none when undefined). */
const scopeA = (actor?: string) =>
  actor === undefined
    ? { kind: 'business' as const, businessId: ids.firmA }
    : { kind: 'business' as const, businessId: ids.firmA, actorUserId: actor };
const as = (actor?: string) =>
  db.forBusiness(ids.firmA, actor === undefined ? {} : { actorUserId: actor });
const A = () => ({ businessId: ids.firmA });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** An issued invoice for `cents` (one line). */
async function openInvoice(cents = 10000, currency = 'usd') {
  const inv = await as().invoice.create({
    data: { ...A(), clientId: ids.client, number: `INV-${++invoiceNumber}`, currency },
  });
  await as().invoiceLine.create({
    data: { ...A(), invoiceId: inv.id, description: 'Service', unitAmountCents: cents },
  });
  return as().invoice.update({
    where: { id: inv.id },
    data: { status: 'OPEN', issuedAt: new Date() },
  });
}
const recordData = (
  invoiceId: string,
  amountCents: number,
  actor: string,
  data: Partial<Prisma.OfflinePaymentUncheckedCreateInput> = {},
): Prisma.OfflinePaymentUncheckedCreateInput => ({
  ...A(),
  invoiceId,
  amountCents,
  method: 'CHECK',
  reference: `${++checkNumber}`,
  receivedOn: new Date('2026-10-01'),
  idempotencyKey: randomUUID(),
  recordedByUserId: actor,
  ...data,
});
/** Records a payment as `actor` (the recorder too, unless `data` names another). */
const record = (
  invoiceId: string,
  amountCents: number,
  actor: string | undefined = u.owner,
  data: Partial<Prisma.OfflinePaymentUncheckedCreateInput> = {},
) =>
  as(actor).offlinePayment.create({
    data: recordData(invoiceId, amountCents, actor ?? u.owner, data),
  });
const VOID_REASON = 'Recorded on the wrong invoice';
/** Voids through app_void_offline_payment in `tx`; the session's actor is the voider. */
const voidSql = (tx: TxClient, id: string, reason: string | null = VOID_REASON) =>
  tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM app_void_offline_payment(${id}::uuid, ${reason}::text)`;
/** Voids as `actor`: the payment afterwards, or null when none was voided. */
const voidIt = async (id: string, actor = u.owner, reason: string | null = VOID_REASON) => {
  const rows = await runInScope(app, scopeA(actor), (tx) => voidSql(tx, id, reason));
  return rows.length === 0 ? null : as().offlinePayment.findUniqueOrThrow({ where: { id } });
};
const voidData = (actor: string, data: Prisma.OfflinePaymentUncheckedUpdateInput = {}) => ({
  voidedByUserId: actor,
  voidReason: VOID_REASON,
  ...data,
});
/** A void by a plain UPDATE (refused: it would lock the payment before its invoice). */
const plainVoid = (
  id: string,
  actor: string,
  data: Prisma.OfflinePaymentUncheckedUpdateInput = voidData(actor),
) => as(actor).offlinePayment.update({ where: { id }, data });
const markPaidData = { status: 'PAID' as const, paidAt: new Date() };
const markPaid = (id: string) => as().invoice.update({ where: { id }, data: markPaidData });
const cancel = (id: string) =>
  as().invoice.update({
    where: { id },
    data: { status: 'CANCELED', canceledAt: new Date(), cancelReason: 'Billed twice' },
  });
const invoice = (id: string) => as().invoice.findUniqueOrThrow({ where: { id } });
const pendingData = (invoiceId: string, amountCents: number) => ({
  ...A(),
  invoiceId,
  amountCents,
  processorRef: `cs_${stripeId()}`,
  accountId: account,
});
/** A Stripe checkout: its PENDING payment. */
const stripePending = (invoiceId: string, amountCents: number) =>
  as().payment.create({ data: pendingData(invoiceId, amountCents) });
const stripeEvent = (paymentId: string, type = 'checkout.session.completed') =>
  as().paymentEvent.create({
    data: { ...A(), processorEventId: `evt_${stripeId()}`, type, paymentId, accountId: account },
  });
const stripeSucceed = async (paymentId: string) => {
  await stripeEvent(paymentId);
  return as().payment.update({
    where: { id: paymentId },
    data: { status: 'SUCCEEDED', paidAt: new Date() },
  });
};
/** A refund of `amountCents` from a Stripe payment, confirmed by Stripe's event. */
const refund = async (paymentId: string, amountCents: number) => {
  const e = await stripeEvent(paymentId, 'charge.refunded');
  await as().paymentRefund.create({
    data: {
      ...A(),
      paymentId,
      processorRefundId: `re_${stripeId()}`,
      accountId: account,
      amountCents,
      status: 'SUCCEEDED',
      eventId: e.id,
      refundedAt: new Date(),
    },
  });
};
const paymentStatus = async (id: string) =>
  (await as().payment.findUniqueOrThrow({ where: { id } })).status;
/** app_invoice_paid_cents: what Stripe took (refunded or not) plus live offline payments. */
const paidCents = (invoiceId: string) =>
  runInScope(app, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const [row] = await tx.$queryRaw<{ n: bigint }[]>`
      SELECT app_invoice_paid_cents(${invoiceId}::uuid) AS n`;
    return Number(row!.n);
  });
/** The database's date plus `days`, as a date for a DATE column. */
const dbDate = async (days: number) => {
  const [row] = await owner.$queryRaw<{ d: string }[]>`
    SELECT (current_date + ${days}::int)::text AS d`;
  return new Date(row!.d);
};
/** Settles into 'ok' or "<SQLSTATE or Prisma code> <message>", never an unhandled rejection. */
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: unknown) => {
      const code = databaseErrorCode(error) ?? (error as { code?: unknown } | null)?.code;
      const message = error instanceof Error ? error.message : String(error);
      return `${typeof code === 'string' ? code : ''} ${message}`;
    },
  );
const SERIALIZATION = /^(40001|P2034) /;
const IDEMPOTENCY_INDEX = 'offline_payments_business_id_idempotency_key_key';
const fails = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('expected the database to refuse it');
    },
    (error: unknown) => error,
  );
const notManager = async (promise: Promise<unknown>) =>
  expect(isDbError(await fails(promise), 'NOT_FIRM_MANAGER')).toBe(true);
/** A replay: Prisma's P2002 on the idempotency key's unique index, as for any duplicate key. */
const expectReplay = (error: unknown) => {
  expect((error as { code?: unknown }).code).toBe('P2002');
  expect(databaseErrorCode(error)).toBe('23505');
  expect(JSON.stringify((error as { meta?: unknown }).meta)).toContain(IDEMPOTENCY_INDEX);
};

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [id, pool] of [
      [u.owner, 'STAFF'],
      [u.admin, 'STAFF'],
      [u.staff, 'STAFF'],
      [u.invited, 'STAFF'],
      [u.deactivated, 'STAFF'],
      [u.racerG, 'STAFF'],
      [u.racerH, 'STAFF'],
      [u.client, 'CLIENT'],
      [u.ownerB, 'STAFF'],
      [u.superAdmin, 'ADMIN'],
    ] as const) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool, email: `${id}@offpay.test`, name: 'Fake Person' },
      });
    }
    await tx.platformAdmin.create({ data: { userId: u.superAdmin } });
    ids.firmA = (await tx.business.create({ data: { slug: `opa-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `opb-${run}`, name: 'B' } })).id;
    await tx.stripeAccount.create({
      data: {
        ...A(),
        accountId: account,
        onboardingStatus: 'COMPLETE',
        chargesEnabled: true,
        payoutsEnabled: true,
      },
    });
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    for (const [userId, role, status] of [
      [u.owner, 'OWNER', 'ACTIVE'],
      [u.admin, 'ADMIN', 'ACTIVE'],
      [u.staff, 'STAFF', 'ACTIVE'],
      [u.invited, 'ADMIN', 'INVITED'],
      [u.deactivated, 'ADMIN', 'DEACTIVATED'],
      [u.racerG, 'ADMIN', 'ACTIVE'],
      [u.racerH, 'ADMIN', 'ACTIVE'],
    ] as const) {
      await tx.membership.create({ data: { ...A(), userId, role, status } });
    }
    ids.client = (await tx.client.create({ data: { ...A(), displayName: 'Fake Client' } })).id;
    await tx.clientAccount.create({
      data: {
        ...A(),
        userId: u.client,
        clientId: ids.client,
        email: `${u.client}@offpay.test`,
        status: 'ACTIVE',
      },
    });
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmB, userId: u.ownerB, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.clientB = (
      await tx.client.create({ data: { businessId: ids.firmB, displayName: 'Fake B' } })
    ).id;
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), app.$disconnect(), db.disconnect()]);
});

describe('recording', () => {
  it('an Owner records a check and an Admin records cash; the invoice stays OPEN', async () => {
    const inv = await openInvoice();
    const check = await record(inv.id, 3000, u.owner, { reference: '1042', note: 'Mailed in' });
    expect(check).toMatchObject({ method: 'CHECK', amountCents: 3000, currency: 'usd' });
    const cash = await record(inv.id, 2000, u.admin, { method: 'CASH', reference: null });
    expect(cash).toMatchObject({ method: 'CASH', reference: null, recordedByUserId: u.admin });
    expect((await invoice(inv.id)).status).toBe('OPEN');
    expect(await paidCents(inv.id)).toBe(5000);
  });

  it('recorded_at is the database clock, whatever the app sends', async () => {
    const inv = await openInvoice();
    const before = Date.now();
    const p = await record(inv.id, 1000, u.owner, { recordedAt: new Date('2020-01-01') });
    expect(p.recordedAt.getTime()).toBeGreaterThan(before - 60_000);
  });

  it('only an active Owner or Admin, acting as themselves (NOT_FIRM_MANAGER)', async () => {
    expect(DB_ERRORS.NOT_FIRM_MANAGER).toBe('FV002');
    const inv = await openInvoice();
    for (const who of [u.staff, u.invited, u.deactivated]) {
      await notManager(record(inv.id, 100, who));
    }
    // A client login, naming the owner or themselves; no actor at all; another person's name.
    await notManager(record(inv.id, 100, u.client, { recordedByUserId: u.owner }));
    await notManager(record(inv.id, 100, u.client));
    await notManager(as().offlinePayment.create({ data: recordData(inv.id, 100, u.owner) }));
    await notManager(record(inv.id, 100, u.owner, { recordedByUserId: u.admin }));
    expect(await as(u.owner).offlinePayment.count({ where: { invoiceId: inv.id } })).toBe(0);
  });

  it('only on an OPEN invoice, in its currency', async () => {
    const draft = await as().invoice.create({
      data: { ...A(), clientId: ids.client, number: `INV-${++invoiceNumber}` },
    });
    await as().invoiceLine.create({
      data: { ...A(), invoiceId: draft.id, description: 'Service', unitAmountCents: 5000 },
    });
    await expect(record(draft.id, 100)).rejects.toThrow(/only an open invoice/);
    await as().invoice.update({
      where: { id: draft.id },
      data: { status: 'SCHEDULED', scheduledFor: new Date('2026-12-01') },
    });
    await expect(record(draft.id, 100)).rejects.toThrow(/only an open invoice/);

    const canceled = await openInvoice();
    await as().invoice.update({
      where: { id: canceled.id },
      data: { status: 'CANCELED', canceledAt: new Date() },
    });
    await expect(record(canceled.id, 100)).rejects.toThrow(/only an open invoice/);

    const paid = await openInvoice(1000);
    await record(paid.id, 1000);
    await markPaid(paid.id);
    await expect(record(paid.id, 100)).rejects.toThrow(/only an open invoice/);

    const euros = await openInvoice(1000, 'eur');
    await expect(record(euros.id, 100)).rejects.toThrow(/in its own currency/);
    await expect(record(euros.id, 100, u.owner, { currency: 'eur' })).resolves.toBeDefined();
  });

  it('never above the balance due: SUCCEEDED Stripe plus live offline money (OVER_BALANCE)', async () => {
    const inv = await openInvoice(10000);
    await stripeSucceed((await stripePending(inv.id, 3000)).id);
    await record(inv.id, 5000);
    const over = await fails(record(inv.id, 2001));
    expect(isDbError(over, 'OVER_BALANCE')).toBe(true);
    expect(String(over)).toMatch(/OVER_BALANCE/);
    await expect(record(inv.id, 2000)).resolves.toBeDefined();
    await expect(record(inv.id, 1)).rejects.toThrow(/OVER_BALANCE/);
    for (const amountCents of [0, -500]) {
      await expect(record((await openInvoice()).id, amountCents)).rejects.toThrow(
        /check constraint/i,
      );
    }
  });

  it('a refunded Stripe payment still counts; a voided payment frees its cents', async () => {
    const inv = await openInvoice(10000);
    const p = await stripeSucceed((await stripePending(inv.id, 4000)).id);
    await refund(p.id, 4000);
    expect(await paymentStatus(p.id)).toBe('REFUNDED');
    // A refund never makes money owed again (a refunded invoice stays PAID).
    expect(await paidCents(inv.id)).toBe(4000);
    await expect(record(inv.id, 6001)).rejects.toThrow(/OVER_BALANCE/);
    const first = await record(inv.id, 6000);
    await voidIt(first.id);
    await expect(record(inv.id, 6000)).resolves.toBeDefined();
  });

  it('checks the reference, note and received date', async () => {
    const inv = await openInvoice(100000);
    for (const data of [
      { reference: null },
      { reference: 'A 1' },
      { reference: 'x'.repeat(21) },
      { reference: '-12' },
      { note: '   ' },
      { note: 'x'.repeat(501) },
      { receivedOn: new Date('1999-12-31') },
    ]) {
      await expect(record(inv.id, 100, u.owner, data)).rejects.toThrow(/check constraint/i);
    }
    await expect(record(inv.id, 100, u.owner, { receivedOn: await dbDate(2) })).rejects.toThrow(
      /received in the future/,
    );
    for (const data of [
      { receivedOn: await dbDate(1) },
      { receivedOn: new Date('2020-01-31') },
      { reference: 'A-12-b', note: 'x'.repeat(500) },
      { method: 'CASH' as const, reference: null },
    ]) {
      await expect(record(inv.id, 100, u.owner, data)).resolves.toBeDefined();
    }
    for (const data of [
      { voidedByUserId: u.owner, voidReason: 'Planted' },
      { voidReason: 'Planted' },
      { voidedAt: new Date() },
    ]) {
      await expect(record(inv.id, 100, u.owner, data)).rejects.toThrow(
        /recorded first, then voided/,
      );
    }
  });

  it('one live record of a check number per invoice; one row per idempotency key', async () => {
    const inv = await openInvoice();
    const other = await openInvoice();
    const first = await record(inv.id, 100, u.owner, { reference: 'ab-1' });
    await expect(record(inv.id, 100, u.owner, { reference: 'AB-1' })).rejects.toThrow(
      /unique constraint/i,
    );
    await expect(record(other.id, 100, u.owner, { reference: 'ab-1' })).resolves.toBeDefined();
    // Cash with the same receipt number is not a check: no rule.
    await expect(
      record(inv.id, 100, u.owner, { method: 'CASH', reference: 'ab-1' }),
    ).resolves.toBeDefined();
    await voidIt(first.id);
    await expect(record(inv.id, 100, u.owner, { reference: 'AB-1' })).resolves.toBeDefined();

    const key = randomUUID();
    await record(inv.id, 100, u.owner, { idempotencyKey: key });
    expectReplay(await fails(record(inv.id, 100, u.owner, { idempotencyKey: key })));
    // The same key on another invoice of the firm is the same request: a replay too.
    expectReplay(await fails(record(other.id, 100, u.owner, { idempotencyKey: key })));
    // The same key in another firm is that firm's own.
    const invB = await db.forBusiness(ids.firmB).invoice.create({
      data: { businessId: ids.firmB, clientId: ids.clientB, number: `INV-B-${run}` },
    });
    await db.forBusiness(ids.firmB).invoiceLine.create({
      data: { businessId: ids.firmB, invoiceId: invB.id, description: 'Fee', unitAmountCents: 500 },
    });
    await db.forBusiness(ids.firmB).invoice.update({
      where: { id: invB.id },
      data: { status: 'OPEN', issuedAt: new Date() },
    });
    await expect(
      db.forBusiness(ids.firmB, { actorUserId: u.ownerB }).offlinePayment.create({
        data: {
          ...recordData(invB.id, 100, u.ownerB, { idempotencyKey: key }),
          businessId: ids.firmB,
        },
      }),
    ).resolves.toBeDefined();
  });

  it('a retry of a recording that paid the balance is a replay, even once the invoice is PAID', async () => {
    const inv = await openInvoice(10000);
    const key = randomUUID();
    await record(inv.id, 10000, u.owner, { idempotencyKey: key });
    const retry = () => record(inv.id, 10000, u.owner, { idempotencyKey: key });
    expectReplay(await fails(retry()));
    await markPaid(inv.id);
    expectReplay(await fails(retry()));
  });

  it('a recorded payment never changes and is never deleted', async () => {
    const inv = await openInvoice();
    const second = await openInvoice();
    const p = await record(inv.id, 1000, u.owner, { note: 'Mailed in' });
    for (const data of [
      { amountCents: 999 },
      { method: 'CASH' as const },
      { reference: '9999' },
      { receivedOn: new Date('2026-09-30') },
      { note: 'Changed' },
      { idempotencyKey: randomUUID() },
      { recordedByUserId: u.admin },
      { invoiceId: second.id },
      { recordedAt: new Date('2020-01-01') },
      { currency: 'eur' },
    ]) {
      await expect(
        as(u.owner).offlinePayment.update({ where: { id: p.id }, data }),
      ).rejects.toThrow(/never changes/);
    }
    // Saving the same values is not a change.
    await expect(
      as(u.owner).offlinePayment.update({ where: { id: p.id }, data: { note: 'Mailed in' } }),
    ).resolves.toBeDefined();
    await expect(as(u.owner).offlinePayment.deleteMany({ where: { id: p.id } })).rejects.toThrow(
      /permission denied/i,
    );
  });
});

describe('Stripe and offline money on one invoice', () => {
  it('a new checkout is never for more than the balance due (OVER_BALANCE)', async () => {
    const inv = await openInvoice(10000);
    await record(inv.id, 6000);
    const over = await fails(stripePending(inv.id, 10000));
    expect(isDbError(over, 'OVER_BALANCE')).toBe(true);
    // Two open checkouts for the balance (an abandoned one and a new one) are allowed.
    const checkout = await stripePending(inv.id, 4000);
    await expect(stripePending(inv.id, 4000)).resolves.toBeDefined();
    await stripeSucceed(checkout.id);
    await expect(stripePending(inv.id, 1)).rejects.toThrow(/OVER_BALANCE/);
    expect(await paidCents(inv.id)).toBe(10000);
  });

  it('an open checkout blocks a recording (PAYMENT_IN_PROGRESS) until it fails', async () => {
    expect(DB_ERRORS.PAYMENT_IN_PROGRESS).toBe('FV004');
    const inv = await openInvoice(10000);
    const checkout = await stripePending(inv.id, 10000);
    const blocked = await fails(record(inv.id, 1000));
    expect(isDbError(blocked, 'PAYMENT_IN_PROGRESS')).toBe(true);
    // The API expires the session at Stripe, then marks its payment FAILED.
    await as().payment.update({
      where: { id: checkout.id },
      data: { status: 'FAILED', failureCode: 'expired' },
    });
    await expect(record(inv.id, 10000)).resolves.toBeDefined();
  });

  it('PAID needs Stripe plus live offline payments covering the total', async () => {
    const inv = await openInvoice(10000);
    await stripeSucceed((await stripePending(inv.id, 6000)).id);
    await record(inv.id, 3000);
    await expect(markPaid(inv.id)).rejects.toThrow(/covering the total/);
    await record(inv.id, 1000, u.admin, { method: 'CASH', reference: null });
    await expect(markPaid(inv.id)).resolves.toMatchObject({ status: 'PAID' });

    const offlineOnly = await openInvoice(5000);
    await record(offlineOnly.id, 5000);
    await expect(markPaid(offlineOnly.id)).resolves.toMatchObject({ status: 'PAID' });
  });
});

describe('voiding', () => {
  it('an Owner or Admin voids once, with a reason; voided_at is the database clock', async () => {
    const inv = await openInvoice();
    const a = await record(inv.id, 1000);
    const b = await record(inv.id, 1000);
    const before = Date.now();
    const voided = await voidIt(a.id, u.owner);
    expect(voided!.voidedAt!.getTime()).toBeGreaterThan(before - 60_000);
    expect(voided).toMatchObject({ voidedByUserId: u.owner, voidReason: VOID_REASON });
    await expect(voidIt(b.id, u.admin)).resolves.toMatchObject({ voidedByUserId: u.admin });
    expect(await paidCents(inv.id)).toBe(0);
  });

  it('needs a reason of 1 to 500 characters (a missing reason is refused too)', async () => {
    const inv = await openInvoice();
    const p = await record(inv.id, 1000);
    for (const reason of [null, '  ', 'x'.repeat(501)]) {
      await expect(voidIt(p.id, u.owner, reason)).rejects.toThrow(/check constraint/i);
    }
    expect((await as().offlinePayment.findUniqueOrThrow({ where: { id: p.id } })).voidedAt).toBe(
      null,
    );
  });

  it('only an active Owner or Admin, acting as themselves (NOT_FIRM_MANAGER)', async () => {
    const inv = await openInvoice();
    const p = await record(inv.id, 1000);
    for (const who of [u.staff, u.invited, u.deactivated, u.client]) {
      await notManager(voidIt(p.id, who));
    }
    // No actor at all (the default TenantPrisma.db).
    await notManager(runInScope(app, scopeA(), (tx) => voidSql(tx, p.id)));
    expect(await voidIt(randomUUID())).toBeNull();
  });

  it('only through app_void_offline_payment, which locks the invoice first', async () => {
    const inv = await openInvoice();
    const p = await record(inv.id, 1000);
    const voids: Prisma.OfflinePaymentUncheckedUpdateInput[] = [
      voidData(u.owner),
      voidData(u.admin),
      { voidReason: 'Oops' },
      { voidedByUserId: u.owner },
    ];
    for (const data of voids) {
      await expect(plainVoid(p.id, u.owner, data)).rejects.toThrow(/app_void_offline_payment/);
    }
    expect((await as().offlinePayment.findUniqueOrThrow({ where: { id: p.id } })).voidedAt).toBe(
      null,
    );
  });

  it('a voided payment is final: no second void, no un-void, no new reason', async () => {
    const inv = await openInvoice();
    const p = await record(inv.id, 1000);
    await voidIt(p.id);
    await expect(voidIt(p.id, u.admin)).rejects.toThrow(/voided payment is final/);
    const changes: Prisma.OfflinePaymentUncheckedUpdateInput[] = [
      { voidedAt: null, voidedByUserId: null, voidReason: null },
      { voidReason: 'Another reason' },
    ];
    for (const data of changes) {
      await expect(plainVoid(p.id, u.owner, data)).rejects.toThrow(/voided payment is final/);
    }
  });
});

describe('reopen and cancel', () => {
  it('a void that leaves a PAID invoice uncovered reopens it; recording again pays it', async () => {
    const inv = await openInvoice(10000);
    const p = await record(inv.id, 10000);
    const paid = await markPaid(inv.id);
    await voidIt(p.id, u.owner, 'Check returned unpaid');
    const reopened = await invoice(inv.id);
    expect(reopened).toMatchObject({ status: 'OPEN', paidAt: null, number: paid.number });
    expect(reopened.issuedAt).toEqual(paid.issuedAt);
    await record(inv.id, 10000, u.admin);
    await expect(markPaid(inv.id)).resolves.toMatchObject({ status: 'PAID' });
  });

  it('the app cannot reopen a PAID invoice itself', async () => {
    const inv = await openInvoice(1000);
    await record(inv.id, 1000);
    await markPaid(inv.id);
    await expect(
      as(u.owner).invoice.update({ where: { id: inv.id }, data: { status: 'OPEN', paidAt: null } }),
    ).rejects.toThrow(/final/);
  });

  it('a void on a PAID invoice still covered (by two checkouts that both succeeded) leaves it PAID', async () => {
    const inv = await openInvoice(10000);
    const cash = await record(inv.id, 4000, u.owner, { method: 'CASH', reference: null });
    const first = await stripePending(inv.id, 6000);
    const second = await stripePending(inv.id, 6000);
    await stripeSucceed(first.id);
    await markPaid(inv.id);
    // Stripe's success after the invoice is PAID is still recorded, and can be refunded.
    await expect(stripeSucceed(second.id)).resolves.toMatchObject({ status: 'SUCCEEDED' });
    await expect(
      as().paymentRefund.create({
        data: {
          ...A(),
          paymentId: second.id,
          processorRefundId: `re_${stripeId()}`,
          accountId: account,
          amountCents: 2500,
        },
      }),
    ).resolves.toMatchObject({ status: 'PENDING' });
    await voidIt(cash.id, u.owner, 'Paid by card as well');
    expect((await invoice(inv.id)).status).toBe('PAID');
  });

  it('a Stripe-paid invoice refunded in full stays PAID (unchanged)', async () => {
    const inv = await openInvoice(10000);
    const p = await stripeSucceed((await stripePending(inv.id, 10000)).id);
    await markPaid(inv.id);
    await refund(p.id, 10000);
    expect((await invoice(inv.id)).status).toBe('PAID');
  });

  it('after a partial or a full card refund, a void reopens only the amount it removed', async () => {
    for (const refundCents of [4999, 5000]) {
      const inv = await openInvoice(10000);
      const check = await record(inv.id, 5000);
      const card = await stripeSucceed((await stripePending(inv.id, 5000)).id);
      await markPaid(inv.id);
      await refund(card.id, refundCents);
      expect(await paymentStatus(card.id)).toBe(refundCents === 5000 ? 'REFUNDED' : 'SUCCEEDED');
      expect((await invoice(inv.id)).status).toBe('PAID');
      await voidIt(check.id, u.owner, 'Check returned unpaid');
      expect(await invoice(inv.id)).toMatchObject({ status: 'OPEN', paidAt: null });
      // $50 due again: the returned check, never the card money the firm gave back.
      expect(await paidCents(inv.id)).toBe(5000);
    }
  });

  it('voiding cash after an overpaying card payment was refunded in full leaves the invoice PAID', async () => {
    const inv = await openInvoice(10000);
    const cash = await record(inv.id, 100, u.owner, { method: 'CASH', reference: null });
    const tabs = [await stripePending(inv.id, 9900), await stripePending(inv.id, 9900)];
    for (const p of tabs) await stripeSucceed(p.id);
    await markPaid(inv.id);
    await refund(tabs[1]!.id, 9900);
    expect(await paymentStatus(tabs[1]!.id)).toBe('REFUNDED');
    await voidIt(cash.id, u.owner, 'Recorded twice');
    // The client paid by card twice; the refund gave the second payment back. Nothing is owed.
    expect((await invoice(inv.id)).status).toBe('PAID');
    expect(await paidCents(inv.id)).toBe(19800);
  });

  it('an invoice with live offline payments is not canceled; after the void it is', async () => {
    const inv = await openInvoice();
    const p = await record(inv.id, 5000);
    await expect(cancel(inv.id)).rejects.toThrow(/holds money/);
    await voidIt(p.id, u.owner, 'Returned to client');
    await expect(cancel(inv.id)).resolves.toMatchObject({ status: 'CANCELED' });
  });

  it('a reopened invoice holding card money is not canceled until the card payment is refunded', async () => {
    const inv = await openInvoice(10000);
    const check = await record(inv.id, 5000);
    const card = await stripeSucceed((await stripePending(inv.id, 5000)).id);
    await markPaid(inv.id);
    await voidIt(check.id, u.owner, 'Check returned unpaid');
    expect((await invoice(inv.id)).status).toBe('OPEN');
    await expect(cancel(inv.id)).rejects.toThrow(/holds money/);
    await refund(card.id, 2500);
    await expect(cancel(inv.id)).rejects.toThrow(/holds money/);
    await refund(card.id, 2500);
    await expect(cancel(inv.id)).resolves.toMatchObject({ status: 'CANCELED' });
  });
});

describe('who sees offline payments', () => {
  it("only the firm's business scope; a client login reads them (the API filters)", async () => {
    const inv = await openInvoice();
    const p = await record(inv.id, 1000);
    expect(await as(u.client).offlinePayment.findUnique({ where: { id: p.id } })).not.toBeNull();
    expect(await db.forPlatform().offlinePayment.findMany()).toEqual([]);
    expect(await db.forAdmin(u.superAdmin).offlinePayment.findMany()).toEqual([]);
    expect(await db.forUser(u.owner).offlinePayment.findMany()).toEqual([]);
    const firmB = db.forBusiness(ids.firmB, { actorUserId: u.ownerB });
    expect(await firmB.offlinePayment.findUnique({ where: { id: p.id } })).toBeNull();
    expect(
      (
        await firmB.offlinePayment.updateMany({
          where: { id: p.id },
          data: { voidedByUserId: u.ownerB, voidReason: 'Planted' },
        })
      ).count,
    ).toBe(0);
    const voidedByB = await runInScope(
      app,
      { kind: 'business', businessId: ids.firmB, actorUserId: u.ownerB },
      (tx) => voidSql(tx, p.id, 'Planted'),
    );
    expect(voidedByB).toEqual([]);
    expect((await as().offlinePayment.findUniqueOrThrow({ where: { id: p.id } })).voidedAt).toBe(
      null,
    );
  });

  it('support scope is read-only: a Super Admin with a grant cannot record', async () => {
    const inv = await openInvoice();
    const g = await db.forAdmin(u.superAdmin).supportAccessGrant.create({
      data: { ...A(), adminUserId: u.superAdmin, reason: 'Fake support request' },
    });
    await as().supportAccessGrant.update({
      where: { id: g.id },
      data: { grantedByUserId: u.owner, expiresAt: new Date(Date.now() + 3_600_000) },
    });
    try {
      await expect(
        runInScope(app, { kind: 'admin', adminUserId: u.superAdmin }, async (tx) => {
          await tx.$queryRaw`SELECT app_enter_support_scope(${ids.firmA}::uuid, 'invoices')`;
          return tx.offlinePayment.create({ data: recordData(inv.id, 100, u.owner) });
        }),
      ).rejects.toThrow(/read-only/);
    } finally {
      await as().supportAccessGrant.update({
        where: { id: g.id },
        data: { revokedAt: new Date() },
      });
    }
  });
});

describe('two at once (two app-role sessions)', () => {
  type Iso = 'ReadCommitted' | 'RepeatableRead';
  /** A transaction in firm A's scope as `actor`. */
  const inTx = <T>(actor: string, fn: (tx: TxClient) => Promise<T>, isolationLevel: Iso) =>
    app.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.scope', 'business', true),
          set_config('app.current_business_id', ${ids.firmA}, true),
          set_config('app.current_actor_id', ${actor}, true)`;
        return fn(tx);
      },
      { isolationLevel, maxWait: 15_000, timeout: 60_000 },
    );
  type Work = (tx: TxClient) => Promise<unknown>;
  /** As `actor`: the work, and for the first transaction, work to do after the second waits. */
  type Step = [actor: string, fn: Work, then?: Work];

  /**
   * Runs `first` and holds its transaction open; starts `second`, waits until it is blocked by a
   * lock (pg_blocking_pids), then lets `first` finish (its `then` step) and commit. Returns both
   * outcomes.
   */
  async function race(first: Step, second: Step, isolationLevel: Iso = 'ReadCommitted') {
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const holding = new Promise<void>((resolve) => (held = resolve));
    const one = outcome(
      inTx(
        first[0],
        async (tx) => {
          await first[1](tx);
          held();
          await released;
          if (first[2]) await first[2](tx);
        },
        isolationLevel,
      ),
    );
    void one.then(() => held());
    await holding;

    let pid = 0;
    let started!: () => void;
    const hasPid = new Promise<void>((resolve) => (started = resolve));
    const two = outcome(
      inTx(
        second[0],
        async (tx) => {
          const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
          pid = row!.pid;
          started();
          await second[1](tx);
        },
        isolationLevel,
      ),
    );
    let twoDone = false;
    void two.then(() => {
      twoDone = true;
      started();
    });
    await hasPid;
    let waited = false;
    for (let i = 0; !twoDone; i++) {
      const [row] = await owner.$queryRaw<{ n: number }[]>`
        SELECT cardinality(pg_blocking_pids(${pid}::int))::int AS n`;
      if (row!.n > 0) {
        waited = true;
        break;
      }
      if (i === 500) throw new Error(`backend ${pid} never waited`);
      await sleep(20);
    }
    release();
    const outcomes = [await one, await two];
    // Every race here is decided by the second transaction waiting for the first one's lock.
    expect(waited, `the second transaction did not wait: ${outcomes[1]}`).toBe(true);
    return outcomes;
  }
  const recordIn =
    (
      invoiceId: string,
      cents: number,
      actor: string,
      data: Partial<Prisma.OfflinePaymentUncheckedCreateInput> = {},
    ) =>
    (tx: TxClient) =>
      tx.offlinePayment.create({ data: recordData(invoiceId, cents, actor, data) });
  const voidIn = (id: string) => (tx: TxClient) => voidSql(tx, id);
  const checkoutIn = (invoiceId: string, cents: number) => (tx: TxClient) =>
    tx.payment.create({ data: pendingData(invoiceId, cents) });
  const recordAndPayIn =
    (invoiceId: string, cents: number, actor: string) => async (tx: TxClient) => {
      await tx.offlinePayment.create({ data: recordData(invoiceId, cents, actor) });
      await tx.invoice.update({ where: { id: invoiceId }, data: markPaidData });
    };

  it('two recordings never exceed the balance (READ COMMITTED: the second sees the first)', async () => {
    const inv = await openInvoice(10000);
    const [one, two] = await race(
      [u.owner, recordIn(inv.id, 6000, u.owner)],
      [u.admin, recordIn(inv.id, 6000, u.admin)],
    );
    expect(one).toBe('ok');
    expect(two).toMatch(/^FV003 /);
    expect(await paidCents(inv.id)).toBe(6000);
  });

  it('two recordings never exceed the balance (REPEATABLE READ: the second fails to serialize)', async () => {
    const inv = await openInvoice(10000);
    const [one, two] = await race(
      [u.owner, recordIn(inv.id, 6000, u.owner)],
      [u.admin, recordIn(inv.id, 6000, u.admin)],
      'RepeatableRead',
    );
    expect(one).toBe('ok');
    expect(two).toMatch(SERIALIZATION);
    expect(await paidCents(inv.id)).toBe(6000);
  });

  it('a retry racing its original is a replay, even when the original paid the balance', async () => {
    const inv = await openInvoice(10000);
    const idempotencyKey = randomUUID();
    const [one, two] = await race(
      [u.owner, recordIn(inv.id, 10000, u.owner, { idempotencyKey })],
      [u.owner, recordIn(inv.id, 10000, u.owner, { idempotencyKey })],
    );
    expect(one).toBe('ok');
    expect(two).toMatch(/^23505 /);
    expect(two).toContain(IDEMPOTENCY_INDEX);
    expect(await paidCents(inv.id)).toBe(10000);
  });

  it('a checkout waiting behind a recording is held to the balance (OVER_BALANCE)', async () => {
    const inv = await openInvoice(10000);
    const [one, two] = await race(
      [u.owner, recordIn(inv.id, 6000, u.owner)],
      [u.admin, checkoutIn(inv.id, 10000)],
    );
    expect(one).toBe('ok');
    expect(two).toMatch(/^FV003 /);
  });

  it('a recording waiting behind a new checkout is refused (PAYMENT_IN_PROGRESS)', async () => {
    const inv = await openInvoice(10000);
    const [one, two] = await race(
      [u.admin, checkoutIn(inv.id, 10000)],
      [u.owner, recordIn(inv.id, 6000, u.owner)],
    );
    expect(one).toBe('ok');
    expect(two).toMatch(/^FV004 /);
    expect(await paidCents(inv.id)).toBe(0);
  });

  it('a void waiting behind "record the rest and mark PAID" reopens the invoice', async () => {
    const inv = await openInvoice(10000);
    const cash = await record(inv.id, 2000, u.owner, { method: 'CASH', reference: null });
    const [one, two] = await race(
      [u.owner, recordAndPayIn(inv.id, 8000, u.owner)],
      [u.admin, voidIn(cash.id)],
    );
    expect([one, two]).toEqual(['ok', 'ok']);
    expect(await invoice(inv.id)).toMatchObject({ status: 'OPEN', paidAt: null });
    expect(await paidCents(inv.id)).toBe(8000);
  });

  it('under REPEATABLE READ that void fails to serialize; PAID stands, covered', async () => {
    const inv = await openInvoice(10000);
    const cash = await record(inv.id, 2000, u.owner, { method: 'CASH', reference: null });
    const [one, two] = await race(
      [u.owner, recordAndPayIn(inv.id, 8000, u.owner)],
      [u.admin, voidIn(cash.id)],
      'RepeatableRead',
    );
    expect(one).toBe('ok');
    expect(two).toMatch(SERIALIZATION);
    expect((await invoice(inv.id)).status).toBe('PAID');
    expect(await paidCents(inv.id)).toBe(10000);
  });

  it('"record the rest and mark PAID" waiting behind a void is refused PAID', async () => {
    const inv = await openInvoice(10000);
    const cash = await record(inv.id, 2000, u.owner, { method: 'CASH', reference: null });
    const [one, two] = await race(
      [u.owner, voidIn(cash.id)],
      [u.admin, recordAndPayIn(inv.id, 8000, u.admin)],
    );
    expect(one).toBe('ok');
    expect(two).toMatch(/covering the total/);
    expect((await invoice(inv.id)).status).toBe('OPEN');
    expect(await paidCents(inv.id)).toBe(0);
  });

  it('voiding two payments of an invoice and a void of the second at once take turns (no deadlock)', async () => {
    const inv = await openInvoice(10000);
    const a = await record(inv.id, 1000);
    const b = await record(inv.id, 1000);
    const [one, two] = await race([u.owner, voidIn(a.id), voidIn(b.id)], [u.admin, voidIn(b.id)]);
    expect(one).toBe('ok');
    expect(two).toMatch(/voided payment is final/);
    const rows = await as().offlinePayment.findMany({ where: { invoiceId: inv.id } });
    expect(rows.map((r) => r.voidedByUserId)).toEqual([u.owner, u.owner]);
  });

  it('a cancel waiting behind a recording is refused', async () => {
    const inv = await openInvoice(10000);
    const [one, two] = await race(
      [u.owner, recordIn(inv.id, 5000, u.owner)],
      [
        u.admin,
        (tx) =>
          tx.invoice.update({
            where: { id: inv.id },
            data: { status: 'CANCELED', canceledAt: new Date() },
          }),
      ],
    );
    expect(one).toBe('ok');
    expect(two).toMatch(/holds money/);
    expect((await invoice(inv.id)).status).toBe('OPEN');
  });

  const demote = (userId: string) => (tx: TxClient) =>
    tx.membership.update({
      where: { businessId_userId: { businessId: ids.firmA, userId } },
      data: { role: 'STAFF' },
    });

  it('a demotion waits for a recording by that person; the payment stands', async () => {
    const inv = await openInvoice(10000);
    const [one, two] = await race(
      [u.racerG, recordIn(inv.id, 1000, u.racerG)],
      [u.owner, demote(u.racerG)],
    );
    expect([one, two]).toEqual(['ok', 'ok']);
    expect(await paidCents(inv.id)).toBe(1000);
    await notManager(record(inv.id, 1000, u.racerG));
  });

  it("a recording waiting behind that person's demotion is refused (NOT_FIRM_MANAGER)", async () => {
    const inv = await openInvoice(10000);
    const [one, two] = await race(
      [u.owner, demote(u.racerH)],
      [u.racerH, recordIn(inv.id, 1000, u.racerH)],
    );
    expect(one).toBe('ok');
    expect(two).toMatch(/^FV002 /);
    expect(await paidCents(inv.id)).toBe(0);
  });
});
