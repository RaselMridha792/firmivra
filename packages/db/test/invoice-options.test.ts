// R36 (Invoices and Payments, r36_invoice_options): the Create Invoice screen's notes, options and
// payment methods, and the firm's invoice templates. Runs as the app role under RLS.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';
import { createFirms, expectInvisibleToOtherFirm } from './r36-helpers.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

let f: Awaited<ReturnType<typeof createFirms>>;
let count = 0;
const A = () => ({ businessId: f.firmA });
const firmA = () => db.forBusiness(f.firmA);
const firmB = () => db.forBusiness(f.firmB);
const template = (data: Record<string, unknown> = {}) =>
  firmA().invoiceTemplate.create({ data: { ...A(), name: `Template ${++count}`, ...data } });
const draft = (data: Record<string, unknown> = {}) =>
  firmA().invoice.create({
    data: { ...A(), clientId: f.client, number: `INV-${++count}`, ...data },
  });

beforeAll(async () => {
  f = await createFirms(owner, 'io');
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), app.$disconnect(), db.disconnect()]);
});

describe('invoice notes and options', () => {
  it('start with sensible defaults: email the client, attach files, all three methods', async () => {
    expect(await draft()).toMatchObject({
      emailClient: true,
      includeAttachments: true,
      allowTip: false,
      requirePaymentBeforeDue: false,
      autopay: false,
      paymentMethods: ['CARD', 'ACH', 'MANUAL'],
      notesToClient: null,
      internalNote: null,
    });
  });

  it('keep the notes apart, bounded, and editable after the invoice is issued', async () => {
    const inv = await draft();
    const set = (data: Record<string, unknown>) =>
      firmA().invoice.update({ where: { id: inv.id }, data });
    await expect(set({ notesToClient: 'x'.repeat(2001) })).rejects.toThrow(/check constraint/i);
    await expect(set({ internalNote: 'x'.repeat(2001) })).rejects.toThrow(/check constraint/i);
    await firmA().invoiceLine.create({
      data: { ...A(), invoiceId: inv.id, description: 'Service', unitAmountCents: 1000 },
    });
    await set({ status: 'OPEN', issuedAt: new Date() });
    await expect(
      set({ notesToClient: 'Thank you', internalNote: 'Chase on Friday' }),
    ).resolves.toMatchObject({ notesToClient: 'Thank you', internalNote: 'Chase on Friday' });
  });

  it('AutoPay needs card or ACH', async () => {
    const inv = await draft();
    const set = (data: Record<string, unknown>) =>
      firmA().invoice.update({ where: { id: inv.id }, data });
    await expect(set({ paymentMethods: ['MANUAL'], autopay: true })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(set({ paymentMethods: ['ACH'], autopay: true })).resolves.toBeTruthy();
  });
});

describe('invoice templates', () => {
  it('names and text are bounded; a default is live', async () => {
    await expect(template({ name: '  ' })).rejects.toThrow(/check constraint/i);
    await expect(template({ name: 'x'.repeat(81) })).rejects.toThrow(/check constraint/i);
    await expect(template({ memo: 'x'.repeat(501) })).rejects.toThrow(/check constraint/i);
    await expect(template({ isDefault: true, archivedAt: new Date() })).rejects.toThrow(
      /check constraint/i,
    );
  });

  it('an invoice takes a live template, never an archived one', async () => {
    const live = await template();
    const old = await template({ archivedAt: new Date() });
    await expect(draft({ templateId: live.id })).resolves.toBeTruthy();
    await expect(draft({ templateId: old.id })).rejects.toThrow(/archived template/);
    const inv = await draft({ templateId: live.id });
    await firmA().invoiceTemplate.update({
      where: { id: live.id },
      data: { archivedAt: new Date() },
    });
    // An invoice keeps the template it had, archived since; moving it to one is refused.
    await expect(
      firmA().invoice.update({ where: { id: inv.id }, data: { notesToClient: 'ok' } }),
    ).resolves.toBeTruthy();
    await expect(
      firmA().invoice.update({ where: { id: inv.id }, data: { templateId: old.id } }),
    ).rejects.toThrow(/archived template/);
  });

  it('a firm has one live default; archiving it frees the slot', async () => {
    const solo = await runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.business.create({ data: { slug: `io-c-${f.run}`, name: 'C' } }),
    );
    const c = db.forBusiness(solo.id);
    const base = { businessId: solo.id };
    await c.invoiceTemplate.create({ data: { ...base, name: 'One', isDefault: true } });
    await expect(
      c.invoiceTemplate.create({ data: { ...base, name: 'Two', isDefault: true } }),
    ).rejects.toThrow(/unique/i);
    await c.invoiceTemplate.updateMany({
      where: { name: 'One' },
      data: { isDefault: false, archivedAt: new Date() },
    });
    await expect(
      c.invoiceTemplate.create({ data: { ...base, name: 'Two', isDefault: true } }),
    ).resolves.toBeTruthy();
  });

  it('names are unique per firm, not across firms; the app never deletes one', async () => {
    const t = await template({ name: `Std ${f.run}` });
    await expect(template({ name: `Std ${f.run}` })).rejects.toThrow(/unique/i);
    await expect(
      firmB().invoiceTemplate.create({ data: { businessId: f.firmB, name: `Std ${f.run}` } }),
    ).resolves.toBeTruthy();
    await expect(firmA().invoiceTemplate.deleteMany({ where: { id: t.id } })).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('are invisible to another firm; a firm cannot write into or point at another', async () => {
    const tA = await template();
    await firmB().invoiceTemplate.create({ data: { businessId: f.firmB, name: `B ${f.run}` } });
    await expectInvisibleToOtherFirm(app, f.firmA, f.firmB, ['invoice_templates']);
    await expect(
      firmB().invoiceTemplate.create({ data: { ...A(), name: `Sneaky ${f.run}` } }),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      firmB().invoice.create({
        data: { businessId: f.firmB, clientId: f.client, number: 'X', templateId: tA.id },
      }),
    ).rejects.toThrow();
  });
});
