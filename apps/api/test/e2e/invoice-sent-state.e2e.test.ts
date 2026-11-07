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

describe('Resend (IP-F10, Octavia Oct 27)', () => {
  const resend = (id: string, who = t.people.ownerA, businessId?: string) =>
    t.firm('post', `/${id}/resend`, who, {}, businessId);
  const codeOf = (res: { body: unknown }) =>
    (res.body as { error?: { code?: string } }).error?.code;
  const deliveries = (invoiceId: string) =>
    t.inScope(t.ids.firmA, (tx) =>
      tx.notificationDelivery.count({
        where: {
          businessId: t.ids.firmA,
          channel: 'EMAIL',
          notification: { type: 'invoice.sent', entityId: invoiceId },
        },
      }),
    );

  it('sends an open invoice with a balance to its client again, audited, and nothing else', async () => {
    const sent = await send((await create()).id);
    expect(await deliveries(sent.id)).toBe(1);
    const again = Invoice.parse(expectOk(await resend(sent.id)).body);
    expect(again).toMatchObject({ id: sent.id, status: 'OPEN', number: sent.number });
    expect(again.balanceDueCents).toBe(sent.balanceDueCents);
    expect(await deliveries(sent.id)).toBe(2);
    const audit = await t.inScope(t.ids.firmA, (tx) =>
      tx.auditLog.findMany({ where: { entityId: sent.id, action: 'invoice.resent' } }),
    );
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]!.metadata)).not.toMatch(/Fake bookkeeping|20000/);
  });

  it('refuses a draft, a scheduled or a paid invoice; Staff may not; another firm gets not found', async () => {
    const draft = await create();
    const scheduled = await send((await create({ scheduledFor: nyDay(5) })).id);
    const paid = await send((await create()).id);
    expectOk(
      await t.firm('post', `/${paid.id}/offline-payments`, t.people.ownerA, {
        method: 'CASH',
        amountCents: 20_000,
        receivedOn: nyDay(0),
        idempotencyKey: randomUUID(),
      }),
    );
    for (const id of [draft.id, scheduled.id, paid.id]) {
      const res = await resend(id);
      expect([res.status, codeOf(res)], id).toEqual([409, 'NOT_RESENDABLE']);
    }
    const open = await send((await create()).id);
    expect((await resend(open.id, t.people.staffA)).status).toBe(403);
    const other = await resend(open.id, t.people.ownerB, t.ids.firmB);
    expect([other.status, codeOf(other)]).toEqual([404, 'NOT_FOUND']);
    const unknown = await resend(randomUUID());
    expect(unknown.status).toBe(404);
    expect(await deliveries(open.id)).toBe(1);
  });
});
