// IP-F08 (Octavia's Invoices & Payments review, Oct 27): Edit/Correct an eligible unpaid invoice
// on the same number. A scheduled one: its send day and due date, or the whole draft in the
// editor. An open one with something to pay: its due date, with a reason once it was sent. Paid,
// canceled and draft invoices are not corrected this way; every correction is audited.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { codeOf, expectOk, Invoice, nyDay, startInvoiceApp } from './invoice-setup.js';

let t: Awaited<ReturnType<typeof startInvoiceApp>>;
beforeAll(async () => {
  t = await startInvoiceApp('r56fix');
});
afterAll(async () => {
  await t.app.close();
});

const lines = [{ description: 'Fake bookkeeping', unitAmountCents: 20_000 }];
const create = async (extra: object = {}) =>
  Invoice.parse(
    expectOk(
      await t.firm('post', '', t.people.ownerA, {
        clientId: t.ids.one,
        lines,
        dueOn: nyDay(30),
        ...extra,
      }),
    ).body,
  );
const send = async (id: string) =>
  Invoice.parse(expectOk(await t.firm('post', `/${id}/send`, t.people.ownerA, {})).body);
const correct = (id: string, body: object, who = t.people.ownerA, businessId?: string) =>
  t.firm('post', `/${id}/correct`, who, body, businessId);
const refused = async (
  res: Promise<{ status: number; body: unknown }>,
  status: number,
  code: string,
) => {
  const r = await res;
  expect([r.status, codeOf(r as never)]).toEqual([status, code]);
};
const corrections = (id: string) =>
  t.inScope(t.ids.firmA, (tx) =>
    tx.auditLog.findMany({
      where: { entityId: id, action: 'invoice.corrected' },
      orderBy: { createdAt: 'asc' },
      select: { metadata: true },
    }),
  );

describe('a scheduled invoice (IP-F08)', () => {
  it('changes its send day and due date, or is edited whole, and stays scheduled', async () => {
    const s = await send((await create({ scheduledFor: nyDay(5), dueOn: nyDay(20) })).id);
    expect(s.status).toBe('SCHEDULED');
    const moved = Invoice.parse(
      expectOk(await correct(s.id, { scheduledFor: nyDay(7), dueOn: nyDay(25) })).body,
    );
    expect(moved).toMatchObject({
      number: s.number,
      status: 'SCHEDULED',
      scheduledFor: nyDay(7),
      dueOn: nyDay(25),
    });
    expect((await corrections(s.id))[0]?.metadata).toMatchObject({
      dueOn: { from: nyDay(20), to: nyDay(25) },
      scheduledFor: { from: nyDay(5), to: nyDay(7) },
      sent: false,
    });
    await refused(correct(s.id, { scheduledFor: nyDay(0) }), 409, 'SCHEDULE_PASSED');
    await refused(correct(s.id, { dueOn: nyDay(6) }), 409, 'DUE_BEFORE_SEND');

    // The editor's update takes a scheduled invoice too, as long as it stays scheduled.
    const edited = Invoice.parse(
      expectOk(
        await t.firm('put', `/${s.id}`, t.people.ownerA, {
          lines: [{ description: 'Fake bookkeeping, corrected', unitAmountCents: 25_000 }],
          dueOn: nyDay(25),
          scheduledFor: nyDay(8),
        }),
      ).body,
    );
    expect(edited).toMatchObject({ status: 'SCHEDULED', totalCents: 25_000, number: s.number });
    await refused(
      t.firm('put', `/${s.id}`, t.people.ownerA, {
        lines,
        dueOn: nyDay(25),
        scheduledFor: nyDay(0),
      }),
      409,
      'SCHEDULE_PASSED',
    );
  });
});

describe('an open invoice (IP-F08)', () => {
  it('extends its due date; once sent, only with a reason, kept in its history', async () => {
    const o = await send((await create({ dueOn: nyDay(3) })).id);
    expect(o.status).toBe('OPEN');
    // Its email may already have gone; make sure it has, as the sender job would.
    await t.inScope(t.ids.firmA, async (tx) => {
      const d = await tx.notificationDelivery.findFirstOrThrow({
        where: { channel: 'EMAIL', notification: { type: 'invoice.sent', entityId: o.id } },
      });
      if (d.status !== 'SENT')
        await tx.notificationDelivery.update({
          where: { id: d.id },
          data: { status: 'SENT', sentAt: new Date(), attempts: 1 },
        });
    });
    await refused(correct(o.id, { dueOn: nyDay(10) }), 400, 'VALIDATION_FAILED');
    const later = Invoice.parse(
      expectOk(await correct(o.id, { dueOn: nyDay(10), reason: 'Fake: client asked for a week' }))
        .body,
    );
    expect(later).toMatchObject({ number: o.number, status: 'OPEN', dueOn: nyDay(10) });
    expect((await corrections(o.id)).at(-1)?.metadata).toMatchObject({
      dueOn: { from: nyDay(3), to: nyDay(10) },
      sent: true,
      reason: 'Fake: client asked for a week',
    });
    await refused(correct(o.id, { dueOn: nyDay(-1), reason: 'x' }), 409, 'DUE_DATE_PASSED');
    await refused(correct(o.id, { scheduledFor: nyDay(4), reason: 'x' }), 409, 'NOT_CORRECTABLE');
    await refused(correct(o.id, { reason: 'x' }), 400, 'VALIDATION_FAILED');
    await refused(correct(o.id, { dueOn: nyDay(11) }, t.people.staffA), 403, 'FORBIDDEN');
    await refused(
      correct(o.id, { dueOn: nyDay(11) }, t.people.ownerB, t.ids.firmB),
      404,
      'NOT_FOUND',
    );

    // Paid, it is final; a draft is changed in the editor, not here.
    expectOk(
      await t.firm('post', `/${o.id}/offline-payments`, t.people.ownerA, {
        method: 'CASH',
        amountCents: 20_000,
        receivedOn: nyDay(0),
        idempotencyKey: randomUUID(),
      }),
    );
    await refused(correct(o.id, { dueOn: nyDay(12), reason: 'x' }), 409, 'NOT_CORRECTABLE');
    const draft = await create();
    await refused(correct(draft.id, { dueOn: nyDay(12) }), 409, 'NOT_CORRECTABLE');
  });
});
