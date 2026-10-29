// End-to-end: Create Invoice's Recurring option (R55; Octavia's Invoices & Payments review of
// Oct 27, IP-F05). A recurring draft keeps a schedule that waits PAUSED with auto-send and AutoPay
// off; sending starts it from the day the invoice opens; turning Recurring off or canceling the
// draft ends it. Custom is every 1 to 52 weeks, months or years. Synthetic data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recurringPeriodOn } from '@firmivra/types';
import { codeOf, expectOk, Invoice, nyDay, startInvoiceApp } from './invoice-setup.js';

let t: Awaited<ReturnType<typeof startInvoiceApp>>;
beforeAll(async () => {
  t = await startInvoiceApp('r55f05');
});
afterAll(async () => {
  await t.app.close();
});

const EVERY_3_WEEKS = { frequency: 'CUSTOM', intervalCount: 3, intervalUnit: 'WEEK' } as const;
const body = (extra: object = {}) => ({
  clientId: t.ids.one,
  lines: [
    { description: 'Monthly bookkeeping (fake)', unitAmountCents: 35_000 },
    { description: 'Payroll filings (fake)', quantity: 2, unitAmountCents: 5_000 },
  ],
  dueOn: nyDay(14),
  recurring: { ...EVERY_3_WEEKS, maxOccurrences: 6 },
  ...extra,
});
const create = async (extra: object = {}) =>
  Invoice.parse(expectOk(await t.firm('post', '', t.people.ownerA, body(extra))).body);
const schedule = (id: string) =>
  t.inScope(t.ids.firmA, (tx) =>
    tx.recurringInvoice.findUniqueOrThrow({
      where: { businessId_id: { businessId: t.ids.firmA, id } },
      include: { lines: { orderBy: { sortOrder: 'asc' } }, invoices: { select: { id: true } } },
    }),
  );
const audits = (id: string) =>
  t.inScope(t.ids.firmA, (tx) =>
    tx.auditLog.findMany({
      where: { entityType: 'recurring_invoice', entityId: id },
      orderBy: { createdAt: 'asc' },
      select: { action: true },
    }),
  );

describe('recurring invoices from Create Invoice (IP-F05)', () => {
  it('keeps a waiting schedule on a custom draft: paused, nothing automatic, lines copied', async () => {
    const draft = await create();
    expect(draft.recurring).toMatchObject({
      frequency: 'CUSTOM',
      intervalCount: 3,
      intervalUnit: 'WEEK',
      startOn: nyDay(0),
      nextSendOn: nyDay(21),
      endOn: null,
      maxOccurrences: 6,
      occurrences: 0,
      status: 'PAUSED',
      autoSend: false,
      autopay: false,
    });
    const s = await schedule(draft.recurring!.id);
    expect(s.invoices).toEqual([{ id: draft.id }]);
    expect(s.lines.map((l) => [l.description, Number(l.quantity), l.unitAmountCents])).toEqual([
      ['Monthly bookkeeping (fake)', 1, 35_000],
      ['Payroll filings (fake)', 2, 5_000],
    ]);
    expect((await audits(s.id)).map((a) => a.action)).toEqual(['recurring_invoice.created']);
  });

  it('follows the draft: a named frequency with an end date, then off ends it', async () => {
    const draft = await create();
    const id = draft.recurring!.id;
    const { clientId: _c, ...rest } = body();
    const endOn = recurringPeriodOn(nyDay(0), { frequency: 'MONTHLY' }, 4);
    const monthly = Invoice.parse(
      expectOk(
        await t.firm('put', `/${draft.id}`, t.people.ownerA, {
          ...rest,
          recurring: { frequency: 'MONTHLY', endOn },
        }),
      ).body,
    );
    expect(monthly.recurring).toMatchObject({
      id,
      frequency: 'MONTHLY',
      intervalCount: null,
      intervalUnit: null,
      nextSendOn: recurringPeriodOn(nyDay(0), { frequency: 'MONTHLY' }, 1),
      endOn,
      maxOccurrences: null,
      status: 'PAUSED',
    });
    const off = Invoice.parse(
      expectOk(await t.firm('put', `/${draft.id}`, t.people.ownerA, { ...rest, recurring: null }))
        .body,
    );
    expect(off.recurring).toBeNull();
    const s = await schedule(id);
    expect([s.status, s.nextSendOn, s.invoices]).toEqual(['ENDED', null, []]);
    expect(s.endedAt).not.toBeNull();
    expect((await audits(id)).map((a) => a.action)).toEqual([
      'recurring_invoice.created',
      'recurring_invoice.updated',
      'recurring_invoice.ended',
    ]);
  });

  it('starts the schedule when the invoice is sent, from the day it opens', async () => {
    const now = await create();
    const sent = Invoice.parse(
      expectOk(await t.firm('post', `/${now.id}/send`, t.people.ownerA, {})).body,
    );
    expect(sent.status).toBe('OPEN');
    expect(sent.recurring).toMatchObject({
      status: 'ACTIVE',
      startOn: nyDay(0),
      nextSendOn: nyDay(21),
      occurrences: 1,
      autoSend: false,
      autopay: false,
    });
    expect((await audits(sent.recurring!.id)).map((a) => a.action)).toEqual([
      'recurring_invoice.created',
      'recurring_invoice.started',
    ]);

    // Scheduled for a later day: the schedule starts that day.
    const later = await create({ scheduledFor: nyDay(5), dueOn: nyDay(20) });
    expect(later.recurring?.startOn).toBe(nyDay(5));
    const scheduled = Invoice.parse(
      expectOk(await t.firm('post', `/${later.id}/send`, t.people.ownerA, {})).body,
    );
    expect(scheduled.status).toBe('SCHEDULED');
    expect(scheduled.recurring).toMatchObject({
      status: 'ACTIVE',
      startOn: nyDay(5),
      nextSendOn: nyDay(26),
    });
  });

  it('ends the waiting schedule when the draft is canceled', async () => {
    const draft = await create();
    expectOk(
      await t.firm('post', `/${draft.id}/cancel`, t.people.ownerA, { reason: 'Fake: not needed' }),
    );
    const s = await schedule(draft.recurring!.id);
    expect(s.status).toBe('ENDED');
  });

  it('refuses a bad interval or end rule, and an end before the second invoice', async () => {
    for (const recurring of [
      { frequency: 'CUSTOM', intervalUnit: 'MONTH' },
      { ...EVERY_3_WEEKS, intervalCount: 53 },
      { ...EVERY_3_WEEKS, intervalCount: 0 },
      { frequency: 'MONTHLY', intervalCount: 2, intervalUnit: 'MONTH' },
      { frequency: 'ONE_TIME' },
      { frequency: 'WEEKLY', endOn: nyDay(60), maxOccurrences: 4 },
      { frequency: 'WEEKLY', maxOccurrences: 1 },
    ]) {
      expect(
        codeOf(await t.firm('post', '', t.people.ownerA, body({ recurring }))),
        JSON.stringify(recurring),
      ).toBe('VALIDATION_FAILED');
    }
    const soon = await t.firm(
      'post',
      '',
      t.people.ownerA,
      body({ recurring: { frequency: 'MONTHLY', endOn: nyDay(10) } }),
    );
    expect([soon.status, codeOf(soon)]).toEqual([409, 'RECURRING_END_TOO_SOON']);
  });
});
