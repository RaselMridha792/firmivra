// R36 (Invoices and Payments, r36_invoice_core): the firm's tax rates, the
// invoice screens' columns, and tax in the totals the database keeps (total = subtotal - discount
// + tax). Runs as the app role under RLS.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';
import { expectInvisibleToOtherFirm } from './r36-helpers.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = { firmA: '', firmB: '', client: '', staff: randomUUID(), serviceB: '' };
const stripeId = () => randomUUID().replace(/-/g, '');
const account = `acct_${stripeId()}`;
let invoiceNumber = 0;
let rateNumber = 0;

const A = () => ({ businessId: ids.firmA });
const firmA = () => db.forBusiness(ids.firmA);
const firmB = () => db.forBusiness(ids.firmB);
const newRate = (bps = 800, data: Record<string, unknown> = {}) =>
  firmA().invoiceTaxRate.create({
    data: { ...A(), name: `Rate ${++rateNumber}`, rateBps: bps, ...data },
  });
const draft = (data: Record<string, unknown> = {}) =>
  firmA().invoice.create({
    data: { ...A(), clientId: ids.client, number: `INV-${++invoiceNumber}`, ...data },
  });
const addLine = (invoiceId: string, unitAmountCents: number, taxable = false) =>
  firmA().invoiceLine.create({
    data: { ...A(), invoiceId, description: 'Service', unitAmountCents, taxable },
  });
const read = (id: string) => firmA().invoice.findUniqueOrThrow({ where: { id } });
/** A draft with a taxable 200.00 line and a non-taxable 350.00 line, taxed at 8%. */
async function taxedDraft() {
  const rate = await newRate(800);
  const inv = await draft({ taxRateId: rate.id });
  await addLine(inv.id, 20000, true);
  await addLine(inv.id, 35000, false);
  return { rate, inv };
}

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    ids.firmA = (await tx.business.create({ data: { slug: `ic-a-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `ic-b-${run}`, name: 'B' } })).id;
    await tx.user.create({
      data: {
        id: ids.staff,
        cognitoSub: ids.staff,
        pool: 'STAFF',
        email: `s-${run}@a.test`,
        name: 'Fake Staff',
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
      data: { ...A(), userId: ids.staff, role: 'STAFF', status: 'ACTIVE' },
    });
    ids.client = (await tx.client.create({ data: { ...A(), displayName: 'Fake Client' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    ids.serviceB = (
      await tx.service.create({ data: { businessId: ids.firmB, kind: 'OTHER', name: 'B service' } })
    ).id;
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), app.$disconnect(), db.disconnect()]);
});

describe('tax in the invoice totals', () => {
  it('tax is the rate on the taxable lines, and the total includes it', async () => {
    const { inv } = await taxedDraft();
    expect(await read(inv.id)).toMatchObject({
      subtotalCents: 55000,
      taxableSubtotalCents: 20000,
      taxRateBps: 800,
      taxCents: 1600,
      totalCents: 56600,
    });
  });

  it('the discount takes its share of the taxable lines', async () => {
    const { inv } = await taxedDraft();
    await firmA().invoice.update({
      where: { id: inv.id },
      data: { discountType: 'PERCENT', discountPercent: 10, discountCents: 5500 },
    });
    // 200.00 taxable x (495.00 / 550.00) x 8% = 14.40
    expect(await read(inv.id)).toMatchObject({ taxCents: 1440, totalCents: 49500 + 1440 });
  });

  it('changing a line or its tax treatment recomputes the tax', async () => {
    const { inv } = await taxedDraft();
    const [first] = await firmA().invoiceLine.findMany({
      where: { invoiceId: inv.id },
      orderBy: { amountCents: 'asc' },
    });
    await firmA().invoiceLine.update({ where: { id: first!.id }, data: { taxable: false } });
    expect(await read(inv.id)).toMatchObject({
      taxableSubtotalCents: 0,
      taxCents: 0,
      totalCents: 55000,
    });
    await firmA().invoiceLine.update({ where: { id: first!.id }, data: { taxable: true } });
    expect((await read(inv.id)).taxCents).toBe(1600);
  });

  it('nobody sets the tax or the taxable subtotal; they come from the rate and the lines', async () => {
    const { inv } = await taxedDraft();
    await firmA().invoice.update({
      where: { id: inv.id },
      data: { taxCents: 999, taxRateBps: 5000 },
    });
    expect(await read(inv.id)).toMatchObject({ taxCents: 1600, taxRateBps: 800 });
    await expect(
      firmA().invoice.update({ where: { id: inv.id }, data: { taxableSubtotalCents: 1 } }),
    ).rejects.toThrow(/kept by the database/);
  });

  it('a new invoice starts with no tax, and no rate means no tax', async () => {
    await expect(draft({ taxCents: 5 })).rejects.toThrow(/empty DRAFT/);
    const inv = await draft();
    await addLine(inv.id, 10000, true);
    expect(await read(inv.id)).toMatchObject({ taxRateBps: 0, taxCents: 0, totalCents: 10000 });
  });

  it('an issued invoice keeps its rate, discount type and tax; the rate row can change', async () => {
    const { rate, inv } = await taxedDraft();
    await firmA().invoice.update({
      where: { id: inv.id },
      data: { status: 'OPEN', issuedAt: new Date() },
    });
    await firmA().invoiceTaxRate.update({ where: { id: rate.id }, data: { rateBps: 1000 } });
    expect(await read(inv.id)).toMatchObject({
      taxRateBps: 800,
      taxCents: 1600,
      totalCents: 56600,
    });
    const other = await newRate(500);
    await expect(
      firmA().invoice.update({ where: { id: inv.id }, data: { taxRateId: other.id } }),
    ).rejects.toThrow(/issued invoice keeps/);
    await expect(
      firmA().invoice.update({
        where: { id: inv.id },
        data: { discountType: 'PERCENT', discountPercent: 5 },
      }),
    ).rejects.toThrow(/issued invoice keeps/);
  });

  it('PAID needs money covering the total with tax; a payment cannot pass the total', async () => {
    const { inv } = await taxedDraft();
    await firmA().invoice.update({
      where: { id: inv.id },
      data: { status: 'OPEN', issuedAt: new Date() },
    });
    const pay = (amountCents: number) =>
      firmA().payment.create({
        data: {
          ...A(),
          invoiceId: inv.id,
          amountCents,
          processorRef: `cs_${stripeId()}`,
          accountId: account,
        },
      });
    await expect(pay(56601)).rejects.toThrow(/OVER_BALANCE/);
    const p = await pay(55000); // the total without tax
    await firmA().paymentEvent.create({
      data: {
        ...A(),
        processorEventId: `evt_${stripeId()}`,
        type: 'checkout.session.completed',
        paymentId: p.id,
        accountId: account,
      },
    });
    await firmA().payment.update({
      where: { id: p.id },
      data: { status: 'SUCCEEDED', paidAt: new Date() },
    });
    await expect(
      firmA().invoice.update({
        where: { id: inv.id },
        data: { status: 'PAID', paidAt: new Date() },
      }),
    ).rejects.toThrow(/covering the total/);
  });
});

describe('invoice columns', () => {
  it('discount type and percent agree, within 0 to 100', async () => {
    const inv = await draft();
    const set = (data: Record<string, unknown>) =>
      firmA().invoice.update({ where: { id: inv.id }, data });
    await expect(set({ discountType: 'PERCENT' })).rejects.toThrow(/check constraint/i);
    await expect(set({ discountPercent: 5 })).rejects.toThrow(/check constraint/i);
    await expect(set({ discountType: 'PERCENT', discountPercent: 101 })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(set({ discountType: 'PERCENT', discountPercent: 12.5 })).resolves.toBeTruthy();
  });

  it("terms are a code, and the staff member is the firm's own", async () => {
    const inv = await draft();
    const set = (data: Record<string, unknown>) =>
      firmA().invoice.update({ where: { id: inv.id }, data });
    await expect(set({ paymentTerms: 'Net 14' })).rejects.toThrow(/check constraint/i);
    await expect(set({ paymentTerms: 'net_14' })).resolves.toBeTruthy();
    await expect(draft({ assignedUserId: randomUUID() })).rejects.toThrow(/foreign key/i);
    await expect(draft({ assignedUserId: ids.staff })).resolves.toBeTruthy();
  });

  it("a line points at the firm's own service, with a bounded item name", async () => {
    const inv = await draft();
    const line = (data: Record<string, unknown>) =>
      firmA().invoiceLine.create({
        data: { ...A(), invoiceId: inv.id, description: 'x', unitAmountCents: 100, ...data },
      });
    await expect(line({ serviceId: ids.serviceB })).rejects.toThrow(/foreign key/i);
    await expect(line({ itemName: '  ' })).rejects.toThrow(/check constraint/i);
    await expect(line({ itemName: 'Tax Return Preparation' })).resolves.toBeTruthy();
  });
});

describe('tax rates', () => {
  it('names, rates and the default are bounded', async () => {
    await expect(newRate(10001)).rejects.toThrow(/check constraint/i);
    await expect(newRate(-1)).rejects.toThrow(/check constraint/i);
    await expect(newRate(500, { name: '  ' })).rejects.toThrow(/check constraint/i);
    await expect(newRate(500, { isDefault: true, archivedAt: new Date() })).rejects.toThrow(
      /check constraint/i,
    );
  });

  it('an archived rate cannot be chosen for an invoice, new or being edited', async () => {
    const old = await newRate(500, { archivedAt: new Date() });
    await expect(draft({ taxRateId: old.id })).rejects.toThrow(/archived tax rate/);
    const inv = await draft();
    await expect(
      firmA().invoice.update({ where: { id: inv.id }, data: { taxRateId: old.id } }),
    ).rejects.toThrow(/archived tax rate/);
  });

  it('a firm has one live default rate; archiving it frees the slot', async () => {
    const solo = await runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.business.create({ data: { slug: `ic-c-${run}`, name: 'C' } }),
    );
    const c = db.forBusiness(solo.id);
    const base = { businessId: solo.id };
    await c.invoiceTaxRate.create({
      data: { ...base, name: 'One', rateBps: 100, isDefault: true },
    });
    await expect(
      c.invoiceTaxRate.create({ data: { ...base, name: 'Two', rateBps: 200, isDefault: true } }),
    ).rejects.toThrow(/unique/i);
    await c.invoiceTaxRate.updateMany({
      where: { name: 'One' },
      data: { isDefault: false, archivedAt: new Date() },
    });
    await expect(
      c.invoiceTaxRate.create({ data: { ...base, name: 'Two', rateBps: 200, isDefault: true } }),
    ).resolves.toBeTruthy();
  });

  it('names are unique per firm, not across firms; the app never deletes a rate', async () => {
    const rate = await newRate(100, { name: `Std ${run}` });
    await expect(newRate(100, { name: `Std ${run}` })).rejects.toThrow(/unique/i);
    await expect(
      firmB().invoiceTaxRate.create({
        data: { businessId: ids.firmB, name: `Std ${run}`, rateBps: 1 },
      }),
    ).resolves.toBeTruthy();
    await expect(firmA().invoiceTaxRate.deleteMany({ where: { id: rate.id } })).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('are invisible to another firm, and a firm cannot write into another', async () => {
    const rateA = await newRate(100);
    await firmB().invoiceTaxRate.create({
      data: { businessId: ids.firmB, name: `B ${run}`, rateBps: 1 },
    });
    await expectInvisibleToOtherFirm(app, ids.firmA, ids.firmB, ['invoice_tax_rates']);
    await expect(
      firmB().invoiceTaxRate.create({ data: { ...A(), name: `Sneaky ${run}`, rateBps: 1 } }),
    ).rejects.toThrow(/row-level security/i);
    // Firm B cannot point its invoice at firm A's rate (same-firm foreign key).
    await expect(
      firmB().invoice.create({
        data: { businessId: ids.firmB, clientId: ids.client, number: 'X', taxRateId: rateA.id },
      }),
    ).rejects.toThrow();
  });
});
