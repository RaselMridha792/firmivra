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

describe('managing a recurring invoice (IP-F18, Octavia Oct 27)', () => {
  const started = async () => {
    const d = await create();
    const sent = Invoice.parse(
      expectOk(await t.firm('post', `/${d.id}/send`, t.people.ownerA, {})).body,
    );
    return { invoice: sent, id: sent.recurring!.id };
  };
  const one = (id: string, who = t.people.ownerA, businessId?: string) =>
    t.firm('get', `/recurring/${id}`, who, undefined, businessId);
  const act = (id: string, action: string, who = t.people.ownerA, businessId?: string) =>
    t.firm('post', `/recurring/${id}/${action}`, who, {}, businessId);

  it('shows its schedule, invoices, next send days in the firm zone and history', async () => {
    const { invoice, id } = await started();
    const d = expectOk(await one(id)).body as Record<string, unknown> & {
      upcoming: string[];
      invoices: { id: string; periodOn: string }[];
      history: { action: string; by: string | null }[];
    };
    expect(d).toMatchObject({
      id,
      status: 'ACTIVE',
      occurrences: 1,
      startOn: nyDay(0),
      nextSendOn: nyDay(21),
      timezone: 'America/New_York',
      waiting: false,
      autoSend: false,
      autopay: false,
      amountCents: 45_000,
    });
    expect(d.upcoming).toEqual([nyDay(21), nyDay(42), nyDay(63)]);
    expect(d.invoices).toEqual([expect.objectContaining({ id: invoice.id, periodOn: nyDay(0) })]);
    expect(d.history.map((h) => h.action)).toEqual(['started', 'created']);
    expect(JSON.stringify(d.history)).not.toMatch(/bookkeeping|35000/);
  });

  it('pauses, resumes from the next day on or after today, and ends; each audited', async () => {
    const { id } = await started();
    const paused = expectOk(await act(id, 'pause')).body as { status: string; upcoming: [] };
    expect(paused).toMatchObject({ status: 'PAUSED', upcoming: [] });
    expect([(await act(id, 'pause')).status, codeOf(await act(id, 'pause'))]).toEqual([
      409,
      'RECURRING_STATE',
    ]);
    // Paused past its send day (started 23 days ago, every 3 weeks: due 2 days ago): resuming
    // goes to the next send day ahead and does not make the missed period afterwards.
    await t.inScope(t.ids.firmA, (tx) =>
      tx.recurringInvoice.update({
        where: { businessId_id: { businessId: t.ids.firmA, id } },
        data: {
          startOn: new Date(`${nyDay(-23)}T00:00:00Z`),
          nextSendOn: new Date(`${nyDay(-2)}T00:00:00Z`),
        },
      }),
    );
    const resumed = expectOk(await act(id, 'resume')).body as { nextSendOn: string };
    expect(resumed).toMatchObject({ status: 'ACTIVE', nextSendOn: nyDay(19) });
    const ended = expectOk(await act(id, 'end')).body;
    expect(ended).toMatchObject({ status: 'ENDED', nextSendOn: null, upcoming: [] });
    expect(codeOf(await act(id, 'resume'))).toBe('RECURRING_STATE');
    expect((await schedule(id)).invoices).toHaveLength(1);
    expect((await audits(id)).map((a) => a.action)).toEqual([
      'recurring_invoice.created',
      'recurring_invoice.started',
      'recurring_invoice.paused',
      'recurring_invoice.resumed',
      'recurring_invoice.ended',
    ]);
  });

  it('turns Auto-send on and off; AutoPay cannot be set; a waiting schedule is changed on its draft', async () => {
    const { id } = await started();
    expect(
      expectOk(await t.firm('patch', `/recurring/${id}`, t.people.ownerA, { autoSend: true })).body,
    ).toMatchObject({ autoSend: true, autopay: false });
    expect(
      (await t.firm('patch', `/recurring/${id}`, t.people.ownerA, { autopay: true })).status,
    ).toBe(400);
    const draft = await create();
    const waitingId = draft.recurring!.id;
    expect(expectOk(await one(waitingId)).body).toMatchObject({ waiting: true, status: 'PAUSED' });
    expect(codeOf(await act(waitingId, 'resume'))).toBe('RECURRING_STATE');
    expect((await act(id, 'restart')).status).toBe(404);
  });

  it('Staff read their clients\x27 and change none; another firm and unknown ids are not found', async () => {
    const { id } = await started();
    expect((await one(id, t.people.staffA)).status).toBe(200);
    expect((await act(id, 'pause', t.people.staffA)).status).toBe(403);
    expect(
      (await t.firm('patch', `/recurring/${id}`, t.people.staffA, { autoSend: true })).status,
    ).toBe(403);
    for (const res of [
      await one(id, t.people.ownerB, t.ids.firmB),
      await act(id, 'end', t.people.ownerB, t.ids.firmB),
      await one('0199c3b0-0000-7000-8000-00000000ffff'),
    ]) {
      expect([res.status, codeOf(res)]).toEqual([404, 'NOT_FOUND']);
    }
    expect(expectOk(await one(id)).body).toMatchObject({ status: 'ACTIVE' });
  });
});
