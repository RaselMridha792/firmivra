// End-to-end: Create Invoice's tax line, Assigned Staff, Invoice Template and attachments (R55;
// Octavia's Invoices & Payments review of Oct 27, IP-F03). The tax comes from the firm's own rate
// on the taxable lines, as the database computes it; staff, templates and files are the firm's
// (and the client's) own; a file must be one the client can see. Synthetic data only.
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invoiceTotals, MyInvoiceDetail } from '@firmivra/types';
import { codeOf, expectOk, Invoice, nyDay, startInvoiceApp } from './invoice-setup.js';

let t: Awaited<ReturnType<typeof startInvoiceApp>>;
const ref = {
  rate: '',
  oldRate: '',
  otherFirmRate: '',
  template: '',
  oldTemplate: '',
  shared: '',
  internal: '',
  checking: '',
  trashed: '',
  otherClient: '',
};

beforeAll(async () => {
  t = await startInvoiceApp('r55f03');
  const A = { businessId: t.ids.firmA };
  await t.inScope(t.ids.firmA, async (tx) => {
    const tag = randomUUID().slice(0, 8);
    ref.rate = (
      await tx.invoiceTaxRate.create({
        data: { ...A, name: `Fake State Tax ${tag}`, rateBps: 825 },
      })
    ).id;
    ref.oldRate = (
      await tx.invoiceTaxRate.create({
        data: { ...A, name: `Fake Old Tax ${tag}`, rateBps: 500, archivedAt: new Date() },
      })
    ).id;
    ref.template = (
      await tx.invoiceTemplate.create({ data: { ...A, name: `Fake Standard ${tag}` } })
    ).id;
    ref.oldTemplate = (
      await tx.invoiceTemplate.create({
        data: { ...A, name: `Fake Retired ${tag}`, archivedAt: new Date() },
      })
    ).id;
    const file = async (
      name: string,
      extra: {
        direction?: 'FIRM_TO_CLIENT' | 'INTERNAL';
        clean?: boolean;
        trashed?: boolean;
        clientId?: string;
        engagementId?: string;
      } = {},
    ) => {
      const key = randomUUID();
      const row = await tx.document.create({
        data: {
          ...A,
          clientId: extra.clientId ?? t.ids.one,
          engagementId: extra.engagementId ?? t.ids.engagementOne,
          direction: extra.direction ?? 'FIRM_TO_CLIENT',
          fileName: name,
          contentType: 'application/pdf',
          sizeBytes: 2048,
          sha256: createHash('sha256').update(key).digest('hex'),
          s3Key: `tenant/${t.ids.firmA}/r55f03/${key}/${name}`,
        },
      });
      await tx.document.update({
        where: { id: row.id },
        data: {
          ...(extra.clean === false ? {} : { scanStatus: 'CLEAN', scannedAt: new Date() }),
          ...(extra.trashed ? { trashedAt: new Date() } : {}),
        },
      });
      return row.id;
    };
    ref.shared = await file('engagement-letter-fake.pdf');
    ref.internal = await file('workpapers-fake.pdf', { direction: 'INTERNAL' });
    ref.checking = await file('just-uploaded-fake.pdf', { clean: false });
    ref.trashed = await file('old-fake.pdf', { trashed: true });
    ref.otherClient = await file('bravo-fake.pdf', {
      clientId: t.ids.two,
      engagementId: t.ids.engagementTwo,
    });
  });
  await t.inScope(t.ids.firmB, async (tx) => {
    ref.otherFirmRate = (
      await tx.invoiceTaxRate.create({
        data: { businessId: t.ids.firmB, name: 'Fake B Tax', rateBps: 700 },
      })
    ).id;
  });
});
afterAll(async () => {
  await t.app.close();
});

const LINES = [
  { description: 'Tax return preparation (fake)', unitAmountCents: 10_000, taxable: true },
  { description: 'Advice (fake)', unitAmountCents: 5_000 },
];
const body = (extra: object = {}) => ({
  clientId: t.ids.one,
  lines: LINES,
  discountCents: 1_500,
  dueOn: nyDay(30),
  ...extra,
});
const create = async (extra: object = {}) =>
  Invoice.parse(expectOk(await t.firm('post', '', t.people.ownerA, body(extra))).body);

describe('Create Invoice tax, staff, template and files (IP-F03)', () => {
  it("taxes the taxable lines at the firm's rate after the discount's share, as the form shows", async () => {
    const draft = await create({ taxRateId: ref.rate });
    // 10,000 taxable of 15,000, less 1,500 discount: 10,000 x 13,500 x 8.25% / 15,000 = 742.5.
    expect(draft.tax).toMatchObject({ rateBps: 825, taxableSubtotalCents: 10_000, cents: 743 });
    expect(draft.tax?.name).toMatch(/^Fake State Tax/);
    expect([draft.subtotalCents, draft.discountCents, draft.totalCents]).toEqual([
      15_000, 1_500, 14_243,
    ]);
    expect(draft.lines.map((l) => l.taxable)).toEqual([true, false]);
    expect(invoiceTotals({ lines: LINES, discountCents: 1_500, taxRateBps: 825 })).toMatchObject({
      taxCents: 743,
      totalCents: 14_243,
    });
    // None chosen: no tax line.
    expect((await create()).tax).toBeNull();

    // The client sees the same tax line.
    expectOk(await t.firm('post', `/${draft.id}/send`, t.people.ownerA, {}));
    const mine = MyInvoiceDetail.parse(
      expectOk(await t.portal('get', `/${draft.id}`, t.people.primary)).body,
    );
    expect(mine.tax).toMatchObject({ rateBps: 825, cents: 743 });
    expect(mine.totalCents).toBe(14_243);
  });

  it("keeps Assigned Staff and the template, refusing anyone's or anything not the firm's", async () => {
    const draft = await create({ assignedUserId: t.people.staffA.id, templateId: ref.template });
    expect(draft.assignedTo?.userId).toBe(t.people.staffA.id);
    expect(draft.template?.id).toBe(ref.template);
    for (const bad of [
      { assignedUserId: t.people.ownerB.id },
      { templateId: ref.oldTemplate },
      { taxRateId: ref.oldRate },
      { taxRateId: ref.otherFirmRate },
    ]) {
      expect(
        codeOf(await t.firm('post', '', t.people.ownerA, body(bad))),
        JSON.stringify(bad),
      ).toBe('NOT_FOUND');
    }
  });

  it('keeps a rate archived after the draft chose it', async () => {
    const tag = randomUUID().slice(0, 8);
    const rate = await t.inScope(
      t.ids.firmA,
      async (tx) =>
        (
          await tx.invoiceTaxRate.create({
            data: { businessId: t.ids.firmA, name: `Fake Soon Gone ${tag}`, rateBps: 600 },
          })
        ).id,
    );
    const draft = await create({ taxRateId: rate });
    await t.inScope(t.ids.firmA, (tx) =>
      tx.invoiceTaxRate.update({ where: { id: rate }, data: { archivedAt: new Date() } }),
    );
    const { clientId: _c, ...update } = body({ taxRateId: rate });
    const kept = Invoice.parse(
      expectOk(await t.firm('put', `/${draft.id}`, t.people.ownerA, update)).body,
    );
    expect(kept.tax?.rateBps).toBe(600);
  });

  it('attaches only files the client can see, and the client sees them', async () => {
    const draft = await create({ documentIds: [ref.shared] });
    expect(draft.attachments).toEqual([
      {
        documentId: ref.shared,
        fileName: 'engagement-letter-fake.pdf',
        contentType: 'application/pdf',
        sizeBytes: 2048,
      },
    ]);
    for (const [ids, code] of [
      [[ref.internal], 'ATTACHMENT_NOT_SHAREABLE'],
      [[ref.checking], 'ATTACHMENT_NOT_SHAREABLE'],
      [[ref.trashed], 'NOT_FOUND'],
      [[ref.otherClient], 'NOT_FOUND'],
      [[ref.shared, ref.shared], 'VALIDATION_FAILED'],
    ] as const) {
      expect(
        codeOf(await t.firm('post', '', t.people.ownerA, body({ documentIds: ids }))),
        ids.join(),
      ).toBe(code);
    }

    // Left out keeps them; an empty list removes them.
    const { clientId: _c, ...update } = body();
    const kept = Invoice.parse(
      expectOk(await t.firm('put', `/${draft.id}`, t.people.ownerA, update)).body,
    );
    expect(kept.attachments).toHaveLength(1);
    expectOk(await t.firm('post', `/${draft.id}/send`, t.people.ownerA, {}));
    const mine = MyInvoiceDetail.parse(
      expectOk(await t.portal('get', `/${draft.id}`, t.people.primary)).body,
    );
    expect(mine.attachments.map((a) => a.documentId)).toEqual([ref.shared]);

    // A file the firm trashes later leaves the invoice for both sides.
    await t.inScope(t.ids.firmA, (tx) =>
      tx.document.update({ where: { id: ref.shared }, data: { trashedAt: new Date() } }),
    );
    expect(
      Invoice.parse(expectOk(await t.firm('get', `/${draft.id}`, t.people.ownerA)).body)
        .attachments,
    ).toEqual([]);
    expect(
      MyInvoiceDetail.parse(expectOk(await t.portal('get', `/${draft.id}`, t.people.primary)).body)
        .attachments,
    ).toEqual([]);

    const other = await create({ documentIds: [] });
    expect(other.attachments).toEqual([]);
  });
});
