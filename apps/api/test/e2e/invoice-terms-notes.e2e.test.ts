// End-to-end: Create Invoice's payment terms, Notes to Client and Internal Note (R55; Octavia's
// Invoices & Payments review of Oct 27, IP-F02). The firm reads all three; the client's portal
// gets the terms and the note to them and never the internal note. Synthetic data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MyInvoiceDetail } from '@firmivra/types';
import { codeOf, expectOk, Invoice, nyDay, startInvoiceApp } from './invoice-setup.js';

let t: Awaited<ReturnType<typeof startInvoiceApp>>;
beforeAll(async () => {
  t = await startInvoiceApp('r55f02');
});
afterAll(async () => {
  await t.app.close();
});

const INTERNAL = 'Fake internal: client disputed last year, be gentle';
const body = (extra: object = {}) => ({
  clientId: t.ids.one,
  lines: [{ description: 'Annual return (fake)', unitAmountCents: 45_000 }],
  dueOn: nyDay(30),
  paymentTerms: 'net_30',
  notesToClient: 'Thank you for your business (fake).',
  internalNote: INTERNAL,
  ...extra,
});

describe('payment terms and notes (IP-F02)', () => {
  it('keeps the three on the draft for the firm, and the update replaces them', async () => {
    const draft = Invoice.parse(expectOk(await t.firm('post', '', t.people.ownerA, body())).body);
    expect(draft).toMatchObject({
      paymentTerms: 'net_30',
      notesToClient: 'Thank you for your business (fake).',
      internalNote: INTERNAL,
    });
    const { clientId: _c, ...update } = body({
      paymentTerms: 'due_on_receipt',
      internalNote: '  ',
    });
    const changed = Invoice.parse(
      expectOk(await t.firm('put', `/${draft.id}`, t.people.ownerA, update)).body,
    );
    // An empty note is none.
    expect([changed.paymentTerms, changed.internalNote]).toEqual(['due_on_receipt', null]);
  });

  it('shows the client the terms and the note to them, never the internal note', async () => {
    const draft = Invoice.parse(expectOk(await t.firm('post', '', t.people.ownerA, body())).body);
    expectOk(await t.firm('post', `/${draft.id}/send`, t.people.ownerA, {}));
    const res = expectOk(await t.portal('get', `/${draft.id}`, t.people.primary));
    expect(JSON.stringify(res.body)).not.toContain(INTERNAL);
    expect(res.body).not.toHaveProperty('internalNote');
    expect(MyInvoiceDetail.parse(res.body)).toMatchObject({
      paymentTerms: 'net_30',
      notesToClient: 'Thank you for your business (fake).',
    });
    // Nor in the client's list.
    expect(
      JSON.stringify(expectOk(await t.portal('get', '', t.people.primary)).body),
    ).not.toContain(INTERNAL);
  });

  it("takes the firm's own terms, and a draft keeps them once the firm removes them", async () => {
    const ownTerms = (customTermDays: number[]) =>
      t.inScope(t.ids.firmA, (tx) =>
        tx.paymentSettings.upsert({
          where: { businessId: t.ids.firmA },
          create: { businessId: t.ids.firmA, customTermDays },
          update: { customTermDays },
        }),
      );
    await ownTerms([45]);
    const draft = Invoice.parse(
      expectOk(await t.firm('post', '', t.people.ownerA, body({ paymentTerms: 'net_45' }))).body,
    );
    expect(draft.paymentTerms).toBe('net_45');
    const other = await t.firm('post', '', t.people.ownerA, body({ paymentTerms: 'net_90' }));
    expect([other.status, codeOf(other)]).toEqual([409, 'TERMS_NOT_OFFERED']);

    await ownTerms([]);
    const { clientId: _c, ...update } = body({ paymentTerms: 'net_45' });
    expectOk(await t.firm('put', `/${draft.id}`, t.people.ownerA, update));
    expect(
      codeOf(await t.firm('post', '', t.people.ownerA, body({ paymentTerms: 'net_45' }))),
    ).toBe('TERMS_NOT_OFFERED');
    // The client reads them as Net 45.
    expectOk(await t.firm('post', `/${draft.id}/send`, t.people.ownerA, {}));
    const mine = MyInvoiceDetail.parse(
      expectOk(await t.portal('get', `/${draft.id}`, t.people.primary)).body,
    );
    expect(mine.paymentTerms).toBe('net_45');
  });

  it('refuses an unknown term and a note over 1,000 characters', async () => {
    for (const bad of [
      body({ paymentTerms: 'net_999' }),
      body({ paymentTerms: 'net_0' }),
      body({ internalNote: 'x'.repeat(1001) }),
    ]) {
      expect(codeOf(await t.firm('post', '', t.people.ownerA, bad))).toBe('VALIDATION_FAILED');
    }
  });
});
