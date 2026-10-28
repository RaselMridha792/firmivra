// IP-F07 (Octavia's Invoices & Payments review, Oct 27): an invoice is Sent only once it was
// actually dispatched: its email went to the client (the outbox's sent time). Pressing Send on a
// future date (Scheduled) is not a dispatch; a dispatched invoice stays Sent once paid.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectOk, Invoice, InvoiceList, nyDay, startInvoiceApp } from './invoice-setup.js';

let t: Awaited<ReturnType<typeof startInvoiceApp>>;
beforeAll(async () => {
  t = await startInvoiceApp('r56sent');
});
afterAll(async () => {
  await t.app.close();
});

const create = async (extra: object = {}) =>
  Invoice.parse(
    expectOk(
      await t.firm('post', '', t.people.ownerA, {
        clientId: t.ids.one,
        lines: [{ description: 'Fake bookkeeping', unitAmountCents: 20_000 }],
        dueOn: nyDay(30),
        ...extra,
      }),
    ).body,
  );
const send = async (id: string) =>
  Invoice.parse(expectOk(await t.firm('post', `/${id}/send`, t.people.ownerA, {})).body);
const listed = async (id: string) =>
  InvoiceList.parse(expectOk(await t.firm('get', '?limit=100', t.people.ownerA)).body).items.find(
    (i) => i.id === id,
  )!;
/** The invoice email's outbox row; marked sent as the sender job would, when it is not yet. */
const dispatched = (invoiceId: string) =>
  t.inScope(t.ids.firmA, async (tx) => {
    const d = await tx.notificationDelivery.findFirstOrThrow({
      where: {
        businessId: t.ids.firmA,
        channel: 'EMAIL',
        notification: { type: 'invoice.sent', entityId: invoiceId },
      },
    });
    if (d.status === 'SENT') return d.sentAt!.toISOString();
    const sentAt = new Date();
    await tx.notificationDelivery.update({
      where: { id: d.id },
      data: { status: 'SENT', sentAt, attempts: 1 },
    });
    return sentAt.toISOString();
  });

describe('the Sent state (IP-F07)', () => {
  it('comes from the real dispatch, not the Send click; a scheduled invoice is not Sent', async () => {
    const later = await send((await create({ scheduledFor: nyDay(5) })).id);
    expect(later).toMatchObject({ status: 'SCHEDULED', sentAt: null });
    expect((await listed(later.id)).sentAt).toBeNull();

    const now = await send((await create()).id);
    expect(now.status).toBe('OPEN');
    const at = await dispatched(now.id);
    expect((await listed(now.id)).sentAt).toBe(at);
    const one = Invoice.parse(expectOk(await t.firm('get', `/${now.id}`, t.people.ownerA)).body);
    expect(one.sentAt).toBe(at);

    // Paid in full: still Sent.
    const paid = Invoice.parse(
      expectOk(
        await t.firm('post', `/${now.id}/offline-payments`, t.people.ownerA, {
          method: 'CASH',
          amountCents: 20_000,
          receivedOn: nyDay(0),
          idempotencyKey: randomUUID(),
        }),
      ).body,
    );
    expect(paid).toMatchObject({ status: 'PAID', sentAt: at });
  });
});
