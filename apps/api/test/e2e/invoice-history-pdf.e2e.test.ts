// IP-F09 (Octavia's Invoices & Payments review, Oct 27): the row menu's Add Note and Log Activity
// (an invoice's firm-only history) and Download PDF (what the client is billed, behind a
// short-lived link). Owner and Admin write; Staff read their clients' only; another firm none.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { Invoice, InvoiceHistory, InvoiceHistoryItem, InvoicePdfLink } from '@firmivra/types';
import { pdfTotals } from '../../src/payments/invoices/invoice-pdf.js';
import { codeOf, expectOk, nyDay, startInvoiceApp } from './invoice-setup.js';

let t: Awaited<ReturnType<typeof startInvoiceApp>>;
beforeAll(async () => {
  t = await startInvoiceApp('r56hist');
});
afterAll(async () => {
  await t.app.close();
});

const refused = async (res: Promise<unknown>, status: number, code: string) => {
  const r = (await res) as { status: number };
  expect([r.status, codeOf(r as never)]).toEqual([status, code]);
};

describe('an invoice’s history (IP-F09)', () => {
  it('keeps notes and logged activity, newest first, firm only and audited', async () => {
    const mine = await t.draft(t.ids.one, { status: 'OPEN' });
    const add = (body: object, who = t.people.ownerA) =>
      t.firm('post', `/${mine.id}/history`, who, body);
    const note = InvoiceHistoryItem.parse(
      expectOk(await add({ type: 'NOTE', body: 'Fake: client will pay Friday' }), 201).body,
    );
    expect(note).toMatchObject({
      type: 'NOTE',
      body: 'Fake: client will pay Friday',
      actor: { userId: t.people.ownerA.id },
    });
    expectOk(
      await add(
        { type: 'ACTIVITY_LOGGED', body: 'Fake: called about the invoice' },
        t.people.adminA,
      ),
      201,
    );
    await refused(add({ type: 'NOTE', body: '' }), 400, 'VALIDATION_FAILED');
    await refused(add({ type: 'SENT', body: 'x' }), 400, 'VALIDATION_FAILED');
    await refused(add({ type: 'NOTE', body: 'x'.repeat(2001) }), 400, 'VALIDATION_FAILED');
    await refused(add({ type: 'NOTE', body: 'x' }, t.people.staffA), 403, 'FORBIDDEN');

    const history = InvoiceHistory.parse(
      expectOk(await t.firm('get', `/${mine.id}/history`, t.people.ownerA)).body,
    );
    expect(history.items.map((i) => i.type)).toEqual(['ACTIVITY_LOGGED', 'NOTE']);
    // Staff read the history of their own client's invoice, not another client's.
    expect(
      InvoiceHistory.parse(
        expectOk(await t.firm('get', `/${mine.id}/history`, t.people.staffA)).body,
      ).items,
    ).toHaveLength(2);
    const theirs = await t.draft(t.ids.two, { status: 'OPEN' });
    await refused(t.firm('get', `/${theirs.id}/history`, t.people.staffA), 404, 'NOT_FOUND');
    await refused(
      t.firm('get', `/${mine.id}/history`, t.people.ownerB, undefined, t.ids.firmB),
      404,
      'NOT_FOUND',
    );
    const audit = await t.inScope(t.ids.firmA, (tx) =>
      tx.auditLog.findMany({ where: { entityId: mine.id }, select: { action: true } }),
    );
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['invoice.note_added', 'invoice.activity_logged']),
    );
  });
});

describe('Download PDF (IP-F09)', () => {
  it('makes a PDF of what the client is billed, behind a short-lived link', async () => {
    const inv = await t.draft(t.ids.one, {
      status: 'OPEN',
      lines: [
        { description: 'Fake tax return', unitAmountCents: 50_000 },
        { description: 'Fake “quoted” extra — line', unitAmountCents: 2_500 },
      ],
    });
    const link = InvoicePdfLink.parse(
      expectOk(await t.firm('get', `/${inv.id}/pdf`, t.people.ownerA)).body,
    );
    expect(new Date(link.expiresAt).getTime()).toBeGreaterThan(Date.now());
    // The file is under the firm's own reports prefix, saved under the invoice's number.
    const [key, name] = link.url.replace(/^memory:/, '').split('?name=');
    expect(key).toMatch(new RegExp(`^tenant/${t.ids.firmA}/reports/invoice-[0-9a-f-]+\\.pdf$`));
    expect(decodeURIComponent(name!)).toBe(`${inv.number}.pdf`);
    const doc = await PDFDocument.load(t.files.objects.get(key!)!);
    expect(doc.getTitle()).toBe(`Invoice ${inv.number}`);
    expect(doc.getPageCount()).toBe(1);
    // Staff: their client's invoice only.
    expectOk(await t.firm('get', `/${inv.id}/pdf`, t.people.staffA));
    // A taxed invoice (R55's IP-F03) has a Tax row, and its rows add up to the Total.
    const rate = await t.inScope(t.ids.firmA, (tx) =>
      tx.invoiceTaxRate.create({
        data: { businessId: t.ids.firmA, name: `Fake State Tax ${t.run}`, rateBps: 825 },
        select: { id: true },
      }),
    );
    const taxed = Invoice.parse(
      expectOk(
        await t.firm('post', '', t.people.ownerA, {
          clientId: t.ids.one,
          lines: [
            { description: 'Fake tax return', unitAmountCents: 10_000, taxable: true },
            { description: 'Fake advice', unitAmountCents: 5_000 },
          ],
          discountCents: 1_500,
          taxRateId: rate.id,
          dueOn: nyDay(30),
        }),
      ).body,
    );
    const rows = pdfTotals(taxed);
    expect(rows.map(([label]) => label)).toEqual([
      'Subtotal',
      'Discount',
      'Tax (8.25%)',
      'Total',
      'Balance due',
    ]);
    const [subtotal, discount, tax, total] = rows.map(([, cents]) => cents);
    expect(subtotal! + discount! + tax!).toBe(total);
    expect(total).toBe(14_243);
    const taxedLink = InvoicePdfLink.parse(
      expectOk(await t.firm('get', `/${taxed.id}/pdf`, t.people.ownerA)).body,
    );
    const [taxedKey] = taxedLink.url.replace(/^memory:/, '').split('?name=');
    expect((await PDFDocument.load(t.files.objects.get(taxedKey!)!)).getPageCount()).toBe(1);
    const other = await t.draft(t.ids.two, { status: 'OPEN' });
    await refused(t.firm('get', `/${other.id}/pdf`, t.people.staffA), 404, 'NOT_FOUND');
  });
});
