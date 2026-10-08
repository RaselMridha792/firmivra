// Offline payments (Rasel, Oct 8, q28 h): an active Owner or Admin, acting as themselves, records a
// check or cash payment on an OPEN invoice, never above the balance due. A recorded payment never
// changes and is never deleted; a mistake is voided once, with a reason, and a void that leaves a
// PAID invoice uncovered reopens it. Stripe's rules are unchanged. Runs as the app role under RLS.
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
const voidData = (actor: string, data: Prisma.OfflinePaymentUncheckedUpdateInput = {}) => ({
  voidedByUserId: actor,
  voidReason: 'Recorded on the wrong invoice',
  ...data,
});
const voidIt = (
  id: string,
  actor: string | undefined = u.owner,
  data: Prisma.OfflinePaymentUncheckedUpdateInput = {},
) => as(actor).offlinePayment.update({ where: { id }, data: voidData(actor ?? u.owner, data) });
const markPaidData = { status: 'PAID' as const, paidAt: new Date() };
const markPaid = (id: string) => as().invoice.update({ where: { id }, data: markPaidData });
const invoice = (id: string) => as().invoice.findUniqueOrThrow({ where: { id } });
const stripePending = (invoiceId: string, amountCents: number) =>
  as().payment.create({
    data: { ...A(), invoiceId, amountCents, processorRef: `cs_${stripeId()}`, accountId: account },
  });
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
/** A Stripe payment refunded in full: its refund confirmed by Stripe's event. */
const refundInFull = async (paymentId: string, amountCents: number) => {
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
/** app_invoice_paid_cents: SUCCEEDED Stripe payments plus live offline payments. */
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
const fails = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('expected the database to refuse it');
    },
    (error: unknown) => error,
  );
const notManager = async (promise: Promise<unknown>) =>
  expect(isDbError(await fails(promise), 'NOT_FIRM_MANAGER')).toBe(true);

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

  it("a PENDING checkout and a REFUNDED payment don't count; a voided payment frees its cents", async () => {
    const pending = await openInvoice(10000);
    await stripePending(pending.id, 10000);
    await expect(record(pending.id, 10000)).resolves.toBeDefined();

    const refunded = await openInvoice(10000);
    const p = await stripeSucceed((await stripePending(refunded.id, 10000)).id);
    await refundInFull(p.id, 10000);
    expect((await as().payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('REFUNDED');
    expect(await paidCents(refunded.id)).toBe(0);
    const first = await record(refunded.id, 10000);
    await expect(record(refunded.id, 1)).rejects.toThrow(/OVER_BALANCE/);
    await voidIt(first.id);
    await expect(record(refunded.id, 10000)).resolves.toBeDefined();
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
    await expect(record(inv.id, 100, u.owner, { idempotencyKey: key })).rejects.toThrow(
      /unique constraint/i,
    );
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

describe('PAID', () => {
  it('needs SUCCEEDED Stripe plus live offline payments covering the total', async () => {
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
    const voided = await voidIt(a.id, u.owner, { voidedAt: new Date('2020-01-01') });
    expect(voided.voidedAt!.getTime()).toBeGreaterThan(before - 60_000);
    expect(voided).toMatchObject({ voidedByUserId: u.owner });
    await expect(voidIt(b.id, u.admin)).resolves.toMatchObject({ voidedByUserId: u.admin });
    expect(await paidCents(inv.id)).toBe(0);
  });

  it('needs a reason of 1 to 500 characters (a missing reason is refused too)', async () => {
    const inv = await openInvoice();
    const p = await record(inv.id, 1000);
    for (const data of [
      { voidedByUserId: u.owner },
      { voidedByUserId: u.owner, voidReason: '  ' },
      { voidedByUserId: u.owner, voidReason: 'x'.repeat(501) },
    ]) {
      await expect(
        as(u.owner).offlinePayment.update({ where: { id: p.id }, data }),
      ).rejects.toThrow(/check constraint/i);
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
    await notManager(as().offlinePayment.update({ where: { id: p.id }, data: voidData(u.owner) }));
    await notManager(
      as(u.owner).offlinePayment.update({ where: { id: p.id }, data: voidData(u.admin) }),
    );
    // A void without a voider is still a void, by nobody.
    await notManager(
      as(u.owner).offlinePayment.update({ where: { id: p.id }, data: { voidReason: 'Oops' } }),
    );
  });

  it('a voided payment is final: no second void, no un-void, no new reason', async () => {
    const inv = await openInvoice();
    const p = await record(inv.id, 1000);
    await voidIt(p.id);
    for (const data of [
      voidData(u.admin),
      { voidedAt: null, voidedByUserId: null, voidReason: null },
      { voidReason: 'Another reason' },
    ]) {
      await expect(
        as(u.owner).offlinePayment.update({ where: { id: p.id }, data }),
      ).rejects.toThrow(/voided payment is final/);
    }
  });
});

describe('reopen and cancel', () => {
  it('a void that leaves a PAID invoice uncovered reopens it; recording again pays it', async () => {
    const inv = await openInvoice(10000);
    const p = await record(inv.id, 10000);
    const paid = await markPaid(inv.id);
    await voidIt(p.id, u.owner, { voidReason: 'Check returned unpaid' });
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

  it('a void on a PAID invoice still covered (here by a late Stripe success) leaves it PAID', async () => {
    const inv = await openInvoice(10000);
    const pending = await stripePending(inv.id, 10000);
    const cash = await record(inv.id, 10000, u.owner, { method: 'CASH', reference: null });
    await markPaid(inv.id);
    // Stripe's success after offline money paid it is still recorded, and can be refunded.
    await expect(stripeSucceed(pending.id)).resolves.toMatchObject({ status: 'SUCCEEDED' });
    await expect(
      as().paymentRefund.create({
        data: {
          ...A(),
          paymentId: pending.id,
          processorRefundId: `re_${stripeId()}`,
          accountId: account,
          amountCents: 2500,
        },
      }),
    ).resolves.toMatchObject({ status: 'PENDING' });
    await voidIt(cash.id, u.owner, { voidReason: 'Paid by card as well' });
    expect((await invoice(inv.id)).status).toBe('PAID');
  });

  it('a Stripe-paid invoice refunded in full stays PAID (unchanged)', async () => {
    const inv = await openInvoice(10000);
    const p = await stripeSucceed((await stripePending(inv.id, 10000)).id);
    await markPaid(inv.id);
    await refundInFull(p.id, 10000);
    expect((await invoice(inv.id)).status).toBe('PAID');
  });

  it('an invoice with live offline payments is not canceled; after the void it is', async () => {
    const inv = await openInvoice();
    const p = await record(inv.id, 5000);
    const cancel = () =>
      as().invoice.update({
        where: { id: inv.id },
        data: { status: 'CANCELED', canceledAt: new Date(), cancelReason: 'Billed twice' },
      });
    await expect(cancel()).rejects.toThrow(/void its offline payments before canceling it/);
    await voidIt(p.id, u.owner, { voidReason: 'Returned to client' });
    await expect(cancel()).resolves.toMatchObject({ status: 'CANCELED' });
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
  type Step = [actor: string, fn: (tx: TxClient) => Promise<unknown>];

  /**
   * Runs `first` and holds its transaction open; starts `second`, waits until it is blocked by a
   * lock (pg_blocking_pids), then lets `first` commit. Returns both outcomes.
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
  const recordIn = (invoiceId: string, cents: number, actor: string) => (tx: TxClient) =>
    tx.offlinePayment.create({ data: recordData(invoiceId, cents, actor) });
  const voidIn = (id: string, actor: string) => (tx: TxClient) =>
    tx.offlinePayment.update({ where: { id }, data: voidData(actor) });
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

  it('a void waiting behind "record the rest and mark PAID" reopens the invoice', async () => {
    const inv = await openInvoice(10000);
    const cash = await record(inv.id, 2000, u.owner, { method: 'CASH', reference: null });
    const [one, two] = await race(
      [u.owner, recordAndPayIn(inv.id, 8000, u.owner)],
      [u.admin, voidIn(cash.id, u.admin)],
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
      [u.admin, voidIn(cash.id, u.admin)],
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
      [u.owner, voidIn(cash.id, u.owner)],
      [u.admin, recordAndPayIn(inv.id, 8000, u.admin)],
    );
    expect(one).toBe('ok');
    expect(two).toMatch(/covering the total/);
    expect((await invoice(inv.id)).status).toBe('OPEN');
    expect(await paidCents(inv.id)).toBe(0);
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
    expect(two).toMatch(/void its offline payments before canceling it/);
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
