// R0 stage B3 (Oct 17): Firmivra bills firms. The database numbers the documents, works out line
// amounts and totals, and keeps an invoice's paid, refunded and credited sums and the statuses
// that follow; payments never pass the balance, refunds never pass what was paid, credit never
// passes what a note has left or what an invoice owes. A firm reads only its own issued documents.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = { admin: randomUUID(), firmA: '', firmB: '' };

const asAdmin = <T>(fn: (tx: TxClient) => Promise<T>) =>
  runInScope(app, { kind: 'admin', adminUserId: ids.admin }, fn);
const asFirm = <T>(firm: 'A' | 'B', fn: (tx: TxClient) => Promise<T>) =>
  runInScope(app, { kind: 'business', businessId: firm === 'A' ? ids.firmA : ids.firmB }, fn);
/** Settles a promise into its error message (or 'ok'), so a rejection is never unhandled. */
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    await tx.user.create({
      data: {
        id: ids.admin,
        cognitoSub: ids.admin,
        pool: 'ADMIN',
        email: `${ids.admin}@sup.test`,
        name: 'Fake',
      },
    });
    await tx.platformAdmin.create({ data: { userId: ids.admin, role: 'SUPER_ADMIN' } });
    ids.firmA = (
      await tx.business.create({ data: { slug: `b3a-${run}`, name: 'Firm A (fake)' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: `b3b-${run}`, name: 'Firm B (fake)' } })
    ).id;
  });
});

afterAll(async () => {
  await owner.$disconnect();
  await app.$disconnect();
});

const billTo = { billToName: 'Pat Owner', billToEmail: 'pat@firm.test' };

/** A DRAFT invoice to firm A with the given lines (unit cents, quantity, tax bps). */
const draftInvoice = (lines: [number, number?, number?][], extra: Record<string, unknown> = {}) =>
  asAdmin((tx) =>
    tx.platformInvoice.create({
      data: {
        businessId: ids.firmA,
        invoiceDate: new Date('2026-10-01'),
        dueDate: new Date('2026-10-31'),
        ...billTo,
        createdByUserId: ids.admin,
        ...extra,
        lines: {
          create: lines.map(([unitCents, quantity = 1, taxRateBps = 0], i) => ({
            description: `Line ${i + 1}`,
            unitCents,
            quantity,
            taxRateBps,
            sortOrder: i,
          })),
        },
      },
    }),
  );
const sentInvoice = async (lines: [number, number?, number?][]) => {
  const inv = await draftInvoice(lines);
  return asAdmin((tx) =>
    tx.platformInvoice.update({ where: { id: inv.id }, data: { status: 'SENT' } }),
  );
};
const pay = (
  invoiceId: string,
  amountCents: number,
  status: 'COMPLETED' | 'PENDING' = 'COMPLETED',
) =>
  asAdmin((tx) =>
    tx.platformPayment.create({
      data: {
        businessId: ids.firmA,
        invoiceId,
        amountCents,
        method: 'ACH',
        status,
        paidOn: new Date('2026-10-05'),
        idempotencyKey: randomUUID(),
      },
    }),
  );
const invoice = (id: string) =>
  asAdmin((tx) => tx.platformInvoice.findUniqueOrThrow({ where: { id } }));

describe('documents', () => {
  it("numbers each kind in order, never by the caller; the counters are the database's", async () => {
    const a = await draftInvoice([[1000]], { number: 'INV-1' });
    const b = await draftInvoice([[1000]]);
    expect(a.number).toMatch(/^INV-\d+$/);
    expect(Number(b.number.slice(4))).toBe(Number(a.number.slice(4)) + 1);
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformBillingCounter.update({
            where: { docType: 'INVOICE' },
            data: { lastNumber: 1 },
          }),
        ),
      ),
    ).toMatch(/permission denied/i);
  });

  it('works out line amounts, tax and totals; lines change only while a DRAFT', async () => {
    const inv = await draftInvoice([[19900], [2900, 2], [10000, 1, 825]]);
    const lines = await asAdmin((tx) =>
      tx.platformInvoiceLine.findMany({
        where: { invoiceId: inv.id },
        orderBy: { sortOrder: 'asc' },
      }),
    );
    expect(lines.map((l) => [l.amountCents, l.taxCents])).toEqual([
      [19900, 0],
      [5800, 0],
      [10000, 825],
    ]);
    const withDiscount = await asAdmin((tx) =>
      tx.platformInvoice.update({ where: { id: inv.id }, data: { discountCents: 700 } }),
    );
    expect([withDiscount.subtotalCents, withDiscount.taxCents, withDiscount.totalCents]).toEqual([
      35700, 825, 35825,
    ]);
    await asAdmin((tx) =>
      tx.platformInvoice.update({ where: { id: inv.id }, data: { status: 'SENT' } }),
    );
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformInvoiceLine.update({ where: { id: lines[0]!.id }, data: { unitCents: 1 } }),
        ),
      ),
    ).toMatch(/only while the document is a DRAFT/);
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformInvoice.update({ where: { id: inv.id }, data: { discountCents: 0 } }),
        ),
      ),
    ).toMatch(/fixed once sent/);
  });
});

describe('invoice money', () => {
  it('only payments make an invoice paid, never past its total, never on a draft', async () => {
    const draft = await draftInvoice([[5000]]);
    expect(await outcome(pay(draft.id, 1000))).toMatch(/only a sent invoice takes payments/);
    const inv = await sentInvoice([[5000]]);
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformInvoice.update({ where: { id: inv.id }, data: { status: 'PAID' } }),
        ),
      ),
    ).toMatch(/cannot become PAID by hand/);
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformInvoice.update({ where: { id: inv.id }, data: { paidCents: 5000 } }),
        ),
      ),
    ).toMatch(/set the money columns/);
    await pay(inv.id, 2000);
    expect(await invoice(inv.id)).toMatchObject({ status: 'PARTIALLY_PAID', paidCents: 2000 });
    expect(await outcome(pay(inv.id, 3001))).toMatch(/more than the invoice balance/);
    const pending = await pay(inv.id, 3000, 'PENDING');
    expect(await invoice(inv.id)).toMatchObject({ status: 'PARTIALLY_PAID', paidCents: 2000 });
    await asAdmin((tx) =>
      tx.platformPayment.update({ where: { id: pending.id }, data: { status: 'COMPLETED' } }),
    );
    const paid = await invoice(inv.id);
    expect(paid).toMatchObject({ status: 'PAID', paidCents: 5000 });
    expect(paid.paidAt).not.toBeNull();
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformInvoice.update({
            where: { id: inv.id },
            data: { status: 'VOIDED', voidReason: 'x' },
          }),
        ),
      ),
    ).toMatch(/cannot become VOIDED by hand/);
  });

  it('refunds never pass what was paid, and mark the payment and the invoice', async () => {
    const inv = await sentInvoice([[4000]]);
    const p = await pay(inv.id, 4000);
    const refund = (amountCents: number) =>
      asAdmin((tx) =>
        tx.platformRefund.create({
          data: {
            businessId: ids.firmA,
            paymentId: p.id,
            amountCents,
            reason: 'Goodwill',
            requestedByUserId: ids.admin,
          },
        }),
      );
    const r1 = await refund(1500);
    expect(await outcome(refund(2600))).toMatch(/more than is left of the payment/);
    expect(await invoice(inv.id)).toMatchObject({ status: 'PAID', refundedCents: 0 }); // pending
    await asAdmin((tx) =>
      tx.platformRefund.update({ where: { id: r1.id }, data: { status: 'COMPLETED' } }),
    );
    expect(await invoice(inv.id)).toMatchObject({
      status: 'PARTIALLY_REFUNDED',
      refundedCents: 1500,
    });
    const r2 = await refund(2500);
    await asAdmin((tx) =>
      tx.platformRefund.update({ where: { id: r2.id }, data: { status: 'COMPLETED' } }),
    );
    expect(await invoice(inv.id)).toMatchObject({ status: 'REFUNDED', refundedCents: 4000 });
    expect(
      await asAdmin((tx) => tx.platformPayment.findUniqueOrThrow({ where: { id: p.id } })),
    ).toMatchObject({ status: 'REFUNDED', refundedCents: 4000 });
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformRefund.update({ where: { id: r1.id }, data: { amountCents: 1 } }),
        ),
      ),
    ).toMatch(/never changes/);
  });

  it('a void needs no money on the invoice, and is final', async () => {
    const inv = await sentInvoice([[3000]]);
    await asAdmin((tx) =>
      tx.platformInvoice.update({
        where: { id: inv.id },
        data: { status: 'VOIDED', voidReason: 'Billed in error.' },
      }),
    );
    expect(
      await outcome(
        asAdmin((tx) => tx.platformInvoice.update({ where: { id: inv.id }, data: { notes: 'x' } })),
      ),
    ).toMatch(/VOIDED invoice never changes/);
    expect(await outcome(pay(inv.id, 100))).toMatch(/only a sent invoice takes payments/);
  });
});

describe('credit notes', () => {
  const credit = async (cents: number) => {
    const cn = await asAdmin((tx) =>
      tx.platformCreditNote.create({
        data: {
          businessId: ids.firmA,
          issueDate: new Date('2026-10-02'),
          reason: 'Service credit',
          createdByUserId: ids.admin,
          lines: { create: [{ description: 'Credit', unitCents: cents }] },
        },
      }),
    );
    return asAdmin((tx) =>
      tx.platformCreditNote.update({ where: { id: cn.id }, data: { status: 'AVAILABLE' } }),
    );
  };
  const apply = (creditNoteId: string, invoiceId: string, amountCents: number) =>
    asAdmin((tx) =>
      tx.platformCreditApplication.create({
        data: {
          businessId: ids.firmA,
          creditNoteId,
          invoiceId,
          amountCents,
          appliedByUserId: ids.admin,
        },
      }),
    );

  it('applies within what the note has left and what the invoice owes, and tracks both', async () => {
    const cn = await credit(5000);
    expect(cn.number).toMatch(/^CN-\d+$/);
    const inv = await sentInvoice([[3000]]);
    expect(await outcome(apply(cn.id, inv.id, 3001))).toMatch(/more than the invoice balance/);
    await apply(cn.id, inv.id, 3000);
    expect(await invoice(inv.id)).toMatchObject({ status: 'PAID', creditedCents: 3000 });
    const note = await asAdmin((tx) =>
      tx.platformCreditNote.findUniqueOrThrow({ where: { id: cn.id } }),
    );
    expect(note).toMatchObject({ status: 'PARTIALLY_APPLIED', appliedCents: 3000 });
    const other = await sentInvoice([[9000]]);
    expect(await outcome(apply(cn.id, other.id, 2001))).toMatch(
      /more than the credit note has left/,
    );
    await apply(cn.id, other.id, 2000);
    expect(
      await asAdmin((tx) => tx.platformCreditNote.findUniqueOrThrow({ where: { id: cn.id } })),
    ).toMatchObject({ status: 'APPLIED', appliedCents: 5000 });
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformCreditNote.update({
            where: { id: cn.id },
            data: { status: 'VOIDED', voidReason: 'x' },
          }),
        ),
      ),
    ).toMatch(/cannot become VOIDED by hand/);
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformCreditApplication.deleteMany({ where: { creditNoteId: cn.id } }),
        ),
      ),
    ).toMatch(/permission denied/i);
  });
});

describe('estimates', () => {
  it('converts only with its invoice; only a DRAFT is deleted; what was quoted is fixed once sent', async () => {
    const est = await asAdmin((tx) =>
      tx.platformEstimate.create({
        data: {
          businessId: ids.firmA,
          issueDate: new Date('2026-10-01'),
          expirationDate: new Date('2026-10-31'),
          contactName: 'Pat Owner',
          contactEmail: 'pat@firm.test',
          createdByUserId: ids.admin,
          lines: {
            create: [{ description: 'Business plan, 12 months', quantity: 12, unitCents: 49900 }],
          },
        },
      }),
    );
    expect(est.number).toMatch(/^EST-\d+$/);
    const sent = await asAdmin((tx) =>
      tx.platformEstimate.update({ where: { id: est.id }, data: { status: 'SENT' } }),
    );
    expect(sent.totalCents).toBe(598800);
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformEstimate.update({ where: { id: est.id }, data: { discountCents: 100 } }),
        ),
      ),
    ).toMatch(/fixed once sent/);
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformEstimate.update({ where: { id: est.id }, data: { status: 'CONVERTED' } }),
        ),
      ),
    ).toMatch(/CONVERTED needs the invoice/);
    expect(
      await outcome(asAdmin((tx) => tx.platformEstimate.delete({ where: { id: est.id } }))),
    ).toMatch(/only a DRAFT is deleted/);
    await draftInvoice([[598800]], { sourceEstimateId: est.id });
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformEstimate.update({ where: { id: est.id }, data: { status: 'CONVERTED' } }),
        ),
      ),
    ).toBe('ok');
  });
});

describe('what a firm sees', () => {
  it("its own issued documents with their lines and payments, never drafts, never another firm's, never settings", async () => {
    const draft = await draftInvoice([[1111]]);
    const sent = await sentInvoice([[2222]]);
    await pay(sent.id, 2222);
    const seen = await asFirm('A', async (tx) => ({
      invoices: (await tx.platformInvoice.findMany()).map((i) => i.id),
      lines: await tx.platformInvoiceLine.count({
        where: { invoiceId: { in: [draft.id, sent.id] } },
      }),
      payments: await tx.platformPayment.count({ where: { invoiceId: sent.id } }),
      settings: await tx.platformBillingSettings.count(),
      recurring: await tx.platformRecurringInvoice.count(),
    }));
    expect(seen.invoices).toContain(sent.id);
    expect(seen.invoices).not.toContain(draft.id);
    expect(seen.lines).toBe(1);
    expect(seen.payments).toBe(1);
    expect([seen.settings, seen.recurring]).toEqual([0, 0]);
    expect(await asFirm('B', (tx) => tx.platformInvoice.count({ where: { id: sent.id } }))).toBe(0);
    const write = await asFirm('A', (tx) =>
      tx.platformInvoice.updateMany({ where: { id: sent.id }, data: { notes: 'mine now' } }),
    );
    expect(write.count).toBe(0);
  });
});
