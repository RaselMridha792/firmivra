// End-to-end: Create Invoice's Recurring option (R55; Octavia's Invoices & Payments review of
// Oct 27, IP-F05). A recurring draft keeps a schedule that waits PAUSED with auto-send and AutoPay
// off; sending starts it from the day the invoice opens; turning Recurring off or canceling the
// draft ends it. Custom is every 1 to 52 weeks, months or years. Synthetic data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recurringPeriodOn } from '@firmivra/types';
import { InvoiceJobs } from '../../src/payments/invoices/invoice-jobs.js';
import { codeOf, expectOk, Invoice, nyDay, startInvoiceApp } from './invoice-setup.js';

const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

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

describe('making the invoices of a recurring schedule (IP-F18, part 2)', () => {
  /** A started schedule whose next send day is today (it began 21 days ago, every 3 weeks). */
  const dueToday = async (extra: object = {}) => {
    const d = await create(extra);
    const sent = Invoice.parse(
      expectOk(await t.firm('post', `/${d.id}/send`, t.people.ownerA, {})).body,
    );
    const id = sent.recurring!.id;
    // As if the first invoice went out 21 days ago.
    await t.inScope(t.ids.firmA, async (tx) => {
      await tx.invoice.update({
        where: { businessId_id: { businessId: t.ids.firmA, id: sent.id } },
        data: { recurringPeriodOn: new Date(`${nyDay(-21)}T00:00:00Z`) },
      });
      await tx.recurringInvoice.update({
        where: { businessId_id: { businessId: t.ids.firmA, id } },
        data: {
          startOn: new Date(`${nyDay(-21)}T00:00:00Z`),
          nextSendOn: new Date(`${nyDay(0)}T00:00:00Z`),
        },
      });
    });
    return id;
  };
  const made = (id: string) =>
    t.inScope(t.ids.firmA, (tx) =>
      tx.invoice.findMany({
        where: { businessId: t.ids.firmA, recurringInvoiceId: id },
        orderBy: { recurringPeriodOn: 'asc' },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
      }),
    );
  // Another test file may hold the job's lock for a moment: try until a run is not skipped.
  const run = async () => {
    for (let i = 0; i < 50; i += 1) {
      const r = await t.app.get(InvoiceJobs).run({ businessIds: [t.ids.firmA] });
      if (!r.skipped) return r;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('the invoice job stayed locked');
  };
  const chargesEnabled = (on: boolean) =>
    t.inScope(t.ids.firmA, (tx) =>
      tx.stripeAccount.update({
        where: { businessId: t.ids.firmA },
        data: { chargesEnabled: on, onboardingStatus: on ? 'COMPLETE' : 'RESTRICTED' },
      }),
    );

  it('the daily run makes the due period once, as a draft for review, and moves the schedule on', async () => {
    const id = await dueToday();
    await run();
    await run();
    const invoices = await made(id);
    expect(invoices).toHaveLength(2);
    const next = invoices.find((i) => day(i.recurringPeriodOn) === nyDay(0))!;
    expect(next).toMatchObject({ status: 'DRAFT', clientId: t.ids.one, totalCents: 45_000 });
    expect(next.lines.map((l) => [l.description, Number(l.quantity), l.unitAmountCents])).toEqual([
      ['Monthly bookkeeping (fake)', 1, 35_000],
      ['Payroll filings (fake)', 2, 5_000],
    ]);
    expect((await schedule(id)).nextSendOn?.toISOString().slice(0, 10)).toBe(nyDay(21));
    expect((await schedule(id)).occurrences).toBe(2);
    expect((await audits(id)).map((a) => a.action)).toContain('recurring_invoice.invoice_made');
  });

  it('with Auto-send it opens and goes to the client, never while the firm cannot take payments', async () => {
    const id = await dueToday();
    expectOk(await t.firm('patch', `/recurring/${id}`, t.people.ownerA, { autoSend: true }));
    await chargesEnabled(false);
    try {
      await run();
    } finally {
      await chargesEnabled(true);
    }
    const held = (await made(id)).find((i) => day(i.recurringPeriodOn) === nyDay(0))!;
    expect(held.status).toBe('DRAFT');
    expect(JSON.stringify((await audits(id)).map((x) => x.action))).toContain('invoice_made');
    // Another schedule, with payments ready: its invoice opens by itself.
    const ready = await dueToday();
    expectOk(await t.firm('patch', `/recurring/${ready}`, t.people.ownerA, { autoSend: true }));
    await run();
    const opened = (await made(ready)).find((i) => day(i.recurringPeriodOn) === nyDay(0))!;
    expect(opened.status).toBe('OPEN');
    // PAY-3: cards off in Settings > Payments does not hold it; it goes without Pay Now.
    const cardsOff = await dueToday();
    expectOk(await t.firm('patch', `/recurring/${cardsOff}`, t.people.ownerA, { autoSend: true }));
    // Cards off for this run only; the firm's settings row is put back as it was (or none).
    const where = { businessId: t.ids.firmA };
    const before = await t.inScope(t.ids.firmA, (tx) => tx.paymentSettings.findUnique({ where }));
    await t.inScope(t.ids.firmA, (tx) =>
      tx.paymentSettings.upsert({
        where,
        create: { ...where, acceptCard: false },
        update: { acceptCard: false },
      }),
    );
    try {
      await run();
    } finally {
      await t.inScope(t.ids.firmA, (tx) =>
        before
          ? tx.paymentSettings.update({ where, data: { acceptCard: before.acceptCard } })
          : tx.paymentSettings.delete({ where }),
      );
    }
    const sent = (await made(cardsOff)).find((i) => day(i.recurringPeriodOn) === nyDay(0))!;
    expect(sent.status).toBe('OPEN');
  });

  it('Send Now makes and sends the next one now; Staff may not; a paused one cannot', async () => {
    const d = await create();
    const sent = Invoice.parse(
      expectOk(await t.firm('post', `/${d.id}/send`, t.people.ownerA, {})).body,
    );
    const id = sent.recurring!.id;
    expect((await t.firm('post', `/recurring/${id}/send-now`, t.people.staffA, {})).status).toBe(
      403,
    );
    const after = expectOk(await t.firm('post', `/recurring/${id}/send-now`, t.people.ownerA, {}))
      .body as { occurrences: number; nextSendOn: string; invoices: { periodOn: string }[] };
    expect(after).toMatchObject({ occurrences: 2, nextSendOn: nyDay(42) });
    expect(after.invoices.map((i) => i.periodOn)).toEqual([nyDay(21), nyDay(0)]);
    expect((await made(id)).map((i) => i.status)).toEqual(['OPEN', 'OPEN']);
    expectOk(await t.firm('post', `/recurring/${id}/pause`, t.people.ownerA, {}));
    const paused = await t.firm('post', `/recurring/${id}/send-now`, t.people.ownerA, {});
    expect([paused.status, codeOf(paused)]).toEqual([409, 'RECURRING_STATE']);
  });
});
