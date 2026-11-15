// R1, Invoices Review 2 I-N06 (r1_invoice_sent_correction): a sent invoice (OPEN: Sent or Overdue)
// with no money on it can be corrected on the same number: its lines, discount, tax rate and
// engagement. With any payment that did not fail (pending, succeeded, refunded), an unvoided
// offline payment, or once Paid or Canceled, it cannot; the number, currency and client never
// change once issued. Runs as the app role under RLS. Synthetic data only.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = { firmA: '', client: '', otherClient: '', engagement: '', manager: randomUUID() };
const stripeId = () => randomUUID().replace(/-/g, '');
const account = `acct_${stripeId()}`;
let invoiceNumber = 0;
let rateNumber = 0;

const A = () => ({ businessId: ids.firmA });
const firmA = () => db.forBusiness(ids.firmA);
const asManager = () => db.forBusiness(ids.firmA, { actorUserId: ids.manager });
const read = (id: string) => firmA().invoice.findUniqueOrThrow({ where: { id } });
const newRate = (bps: number) =>
  firmA().invoiceTaxRate.create({ data: { ...A(), name: `Rate ${++rateNumber}`, rateBps: bps } });
const addLine = (invoiceId: string, unitAmountCents: number, taxable = false) =>
  firmA().invoiceLine.create({
    data: { ...A(), invoiceId, description: 'Service', unitAmountCents, taxable },
  });

/** A sent invoice: a taxable 200.00 line and a 350.00 one, taxed at 8%. */
async function sent() {
  const rate = await newRate(800);
  const inv = await firmA().invoice.create({
    data: { ...A(), clientId: ids.client, number: `INV-C-${++invoiceNumber}`, taxRateId: rate.id },
  });
  await addLine(inv.id, 20000, true);
  await addLine(inv.id, 35000, false);
  await firmA().invoice.update({
    where: { id: inv.id },
    data: { status: 'OPEN', issuedAt: new Date() },
  });
  return inv;
}
const stripePayment = (invoiceId: string, amountCents: number) =>
  firmA().payment.create({
    data: {
      ...A(),
      invoiceId,
      amountCents,
      processorRef: `cs_${stripeId()}`,
      accountId: account,
    },
  });
const stripeSettle = async (paymentId: string, status: 'SUCCEEDED' | 'FAILED') => {
  await firmA().paymentEvent.create({
    data: {
      ...A(),
      processorEventId: `evt_${stripeId()}`,
      type: status === 'SUCCEEDED' ? 'checkout.session.completed' : 'checkout.session.expired',
      paymentId,
      accountId: account,
    },
  });
  return firmA().payment.update({
    where: { id: paymentId },
    data: status === 'SUCCEEDED' ? { status, paidAt: new Date() } : { status },
  });
};
/** Every correction the invoice can be asked for; each one refused when it is not correctable. */
async function expectFrozen(invoiceId: string) {
  await expect(addLine(invoiceId, 1000)).rejects.toThrow(/lines change only while/);
  const line = await firmA().invoiceLine.findFirstOrThrow({ where: { invoiceId } });
  await expect(
    firmA().invoiceLine.update({ where: { id: line.id }, data: { unitAmountCents: 1 } }),
  ).rejects.toThrow(/lines change only while/);
  await expect(firmA().invoiceLine.delete({ where: { id: line.id } })).rejects.toThrow(
    /lines change only while/,
  );
  await expect(
    firmA().invoice.update({ where: { id: invoiceId }, data: { discountCents: 100 } }),
  ).rejects.toThrow(/issued invoice keeps/);
  await expect(
    firmA().invoice.update({ where: { id: invoiceId }, data: { engagementId: ids.engagement } }),
  ).rejects.toThrow(/issued invoice keeps/);
}

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    ids.firmA = (await tx.business.create({ data: { slug: `icx-a-${run}`, name: 'A' } })).id;
    await tx.user.create({
      data: {
        id: ids.manager,
        cognitoSub: ids.manager,
        pool: 'STAFF',
        email: `m-${run}@a.test`,
        name: 'Fake Owner',
      },
    });
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
    await tx.membership.create({
      data: { ...A(), userId: ids.manager, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.client = (await tx.client.create({ data: { ...A(), displayName: 'Fake Client' } })).id;
    ids.otherClient = (await tx.client.create({ data: { ...A(), displayName: 'Fake Other' } })).id;
    const service = await tx.service.create({ data: { ...A(), kind: 'OTHER', name: 'Advice' } });
    ids.engagement = (
      await tx.engagement.create({
        data: { ...A(), clientId: ids.client, serviceId: service.id, title: 'Advice (fake)' },
      })
    ).id;
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('correcting a sent invoice with no money on it (I-N06)', () => {
  it('takes new lines, a discount, another tax rate and an engagement; the totals follow', async () => {
    const inv = await sent();
    expect(await read(inv.id)).toMatchObject({ status: 'OPEN', taxCents: 1600, totalCents: 56600 });
    const lines = await firmA().invoiceLine.findMany({ where: { invoiceId: inv.id } });
    await firmA().invoiceLine.delete({ where: { id: lines[1]!.id } });
    await firmA().invoiceLine.update({
      where: { id: lines[0]!.id },
      data: { unitAmountCents: 30000 },
    });
    await addLine(inv.id, 10000);
    const lower = await newRate(500);
    await firmA().invoice.update({
      where: { id: inv.id },
      data: { discountCents: 4000, taxRateId: lower.id, engagementId: ids.engagement },
    });
    // 300.00 taxable + 100.00, less 40.00; 5% on the taxable share (300 of 400) after it: 13.50.
    expect(await read(inv.id)).toMatchObject({
      status: 'OPEN',
      number: inv.number,
      subtotalCents: 40000,
      discountCents: 4000,
      taxRateBps: 500,
      taxCents: 1350,
      totalCents: 37350,
      engagementId: ids.engagement,
    });
  });

  it('a failed Stripe payment leaves it correctable', async () => {
    const inv = await sent();
    await stripeSettle((await stripePayment(inv.id, 56600)).id, 'FAILED');
    await addLine(inv.id, 1000);
    expect((await read(inv.id)).subtotalCents).toBe(56000);
  });

  it('never changes its number, currency or client', async () => {
    const inv = await sent();
    await expect(
      firmA().invoice.update({ where: { id: inv.id }, data: { number: 'INV-OTHER' } }),
    ).rejects.toThrow(/issued invoice keeps/);
    await expect(
      firmA().invoice.update({ where: { id: inv.id }, data: { currency: 'cad' } }),
    ).rejects.toThrow(/issued invoice keeps/);
    await expect(
      firmA().invoice.update({ where: { id: inv.id }, data: { clientId: ids.otherClient } }),
    ).rejects.toThrow(/client of an invoice cannot change/);
  });
});

describe('what keeps a sent invoice as it is (I-N06)', () => {
  it('a pending Stripe payment', async () => {
    const inv = await sent();
    await stripePayment(inv.id, 10000);
    await expectFrozen(inv.id);
  });

  it('a succeeded Stripe payment (partly paid)', async () => {
    const inv = await sent();
    await stripeSettle((await stripePayment(inv.id, 10000)).id, 'SUCCEEDED');
    await expectFrozen(inv.id);
  });

  it('a refund on its payment', async () => {
    const inv = await sent();
    const p = await stripeSettle((await stripePayment(inv.id, 10000)).id, 'SUCCEEDED');
    await firmA().paymentRefund.create({
      data: {
        ...A(),
        paymentId: p.id,
        processorRefundId: `re_${stripeId()}`,
        accountId: account,
        amountCents: 10000,
      },
    });
    await expectFrozen(inv.id);
  });

  it('an offline payment not voided', async () => {
    const inv = await sent();
    await asManager().offlinePayment.create({
      data: {
        ...A(),
        invoiceId: inv.id,
        amountCents: 5000,
        method: 'CHECK',
        reference: '1001',
        receivedOn: new Date('2026-11-01'),
        idempotencyKey: randomUUID(),
        recordedByUserId: ids.manager,
      },
    });
    await expectFrozen(inv.id);
  });

  it('paid, and canceled, stay final', async () => {
    const paid = await sent();
    await stripeSettle((await stripePayment(paid.id, 56600)).id, 'SUCCEEDED');
    await firmA().invoice.update({
      where: { id: paid.id },
      data: { status: 'PAID', paidAt: new Date() },
    });
    await expect(addLine(paid.id, 1000)).rejects.toThrow(/lines change only while/);
    await expect(
      firmA().invoice.update({ where: { id: paid.id }, data: { discountCents: 100 } }),
    ).rejects.toThrow(/paid or canceled invoice is final/);
    const canceled = await sent();
    await firmA().invoice.update({
      where: { id: canceled.id },
      data: { status: 'CANCELED', canceledAt: new Date(), cancelReason: 'Billed twice (fake)' },
    });
    await expect(addLine(canceled.id, 1000)).rejects.toThrow(/lines change only while/);
    await expect(
      firmA().invoice.update({ where: { id: canceled.id }, data: { discountCents: 100 } }),
    ).rejects.toThrow(/paid or canceled invoice is final/);
  });
});
