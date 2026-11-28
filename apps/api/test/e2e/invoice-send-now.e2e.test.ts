// Q24 (I-N03, the lead's (b)): Send Now on a Scheduled invoice. Send on a SCHEDULED invoice opens
// it at once (OPEN, issued now, its scheduled day cleared), audited, and the client gets
// invoice.sent as on any send; the daily job then has nothing left to open. A sent, paid or
// canceled invoice is still refused; Staff may not; another firm's invoice is not found.
// Synthetic data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InvoiceJobs } from '../../src/payments/invoices/invoice-jobs.js';
import { codeOf, expectOk, Invoice, nyDay, startInvoiceApp } from './invoice-setup.js';

let t: Awaited<ReturnType<typeof startInvoiceApp>>;
beforeAll(async () => {
  t = await startInvoiceApp('q24now');
});
afterAll(async () => {
  await t.app.close();
});

const scheduled = async () => {
  const draft = Invoice.parse(
    expectOk(
      await t.firm('post', '', t.people.ownerA, {
        clientId: t.ids.one,
        lines: [{ description: 'Fake advisory', unitAmountCents: 18_000 }],
        scheduledFor: nyDay(5),
        dueOn: nyDay(30),
      }),
    ).body,
  );
  const sent = Invoice.parse(
    expectOk(await t.firm('post', `/${draft.id}/send`, t.people.ownerA, {})).body,
  );
  expect(sent.status).toBe('SCHEDULED');
  return sent;
};
const sendNow = (id: string, who = t.people.ownerA, businessId = t.ids.firmA) =>
  t.firm('post', `/${id}/send`, who, {}, businessId);
const bell = (invoiceId: string) =>
  t.inScope(t.ids.firmA, (tx) =>
    tx.notification.findMany({
      where: { businessId: t.ids.firmA, type: 'invoice.sent', entityId: invoiceId },
      select: { id: true },
    }),
  );

describe('Send Now on a Scheduled invoice (Q24, I-N03)', () => {
  it('opens it now, clears its day, audits it and tells the client', async () => {
    const invoice = await scheduled();
    expect(await bell(invoice.id)).toEqual([]);

    const now = Invoice.parse(expectOk(await sendNow(invoice.id)).body);
    expect(now).toMatchObject({ status: 'OPEN', scheduledFor: null });
    expect(now.issuedAt).not.toBeNull();
    expect((await bell(invoice.id)).length).toBeGreaterThan(0);
    const audit = await t.inScope(t.ids.firmA, (tx) =>
      tx.auditLog.findMany({
        where: { businessId: t.ids.firmA, action: 'invoice.sent', entityId: invoice.id },
        select: { metadata: true },
      }),
    );
    expect(audit).toEqual([
      { metadata: expect.objectContaining({ sentNow: true, scheduledFor: nyDay(5) }) },
    ]);

    // Its day comes: the job has nothing left to open, and the client is not told twice.
    const before = (await bell(invoice.id)).length;
    const later = new Date(`${nyDay(6)}T15:00:00.000Z`);
    await t.app.get(InvoiceJobs).run({ now: later, businessIds: [t.ids.firmA] });
    expect((await bell(invoice.id)).length).toBe(before);
  });

  it('still refuses a sent invoice; Staff may not; another firm gets not found', async () => {
    const invoice = await scheduled();
    const staff = await sendNow(invoice.id, t.people.staffA);
    expect(staff.status).toBe(403);
    const other = await sendNow(invoice.id, t.people.ownerB, t.ids.firmB);
    expect(other.status).toBe(404);
    expect(
      Invoice.parse(expectOk(await t.firm('get', `/${invoice.id}`, t.people.ownerA)).body).status,
    ).toBe('SCHEDULED');

    expectOk(await sendNow(invoice.id));
    const again = await sendNow(invoice.id);
    expect([again.status, codeOf(again)]).toEqual([409, 'NOT_DRAFT']);
  });

  it('refuses a canceled invoice', async () => {
    const invoice = await scheduled();
    expectOk(
      await t.firm('post', `/${invoice.id}/cancel`, t.people.ownerA, { reason: 'Fake reason' }),
    );
    const refused = await sendNow(invoice.id);
    expect([refused.status, codeOf(refused)]).toEqual([409, 'NOT_DRAFT']);
  });
});
