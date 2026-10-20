import { ConflictException, type HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  previewSubscriptionChange,
  subscriptionAddMonths,
  subscriptionBillingDateCents,
  subscriptionEventText,
  type SubscriptionPlan,
  type SubscriptionPricing,
  subscriptionPriceCents,
  subscriptionProration,
  type SubscriptionRow,
} from '@firmivra/types';
import { asSubscriptionError, refuse } from '../../src/admin-subscriptions/subscriptions-common.js';
import {
  type AuditRow,
  type ChangeRow,
  eventsOf,
  keptSuspensionKind,
  type NoteRow,
  notesByRow,
  subscriptionNotesOf,
} from '../../src/admin-subscriptions/subscriptions-events.js';
import {
  accessEndsOf,
  churnOf,
  csvCell,
  currentNote,
  eventNote,
  inForce,
  matchesSearch,
  matchesStatus,
  nextBillingOf,
  periodOf,
  planChangeKind,
  previousPeriod,
  pricesOf,
  reactivatedStatus,
  renewsSoon,
  sortRows,
  splitEventNote,
  suspensionKindOf,
  usageOf,
} from '../../src/admin-subscriptions/subscriptions-math.js';

const TODAY = '2026-10-20';
const at = (iso: string) => new Date(iso);

const plan = (over: Partial<SubscriptionPlan> = {}): SubscriptionPlan => ({
  id: 'plan-basic',
  code: 'BASIC',
  name: 'Basic',
  priceCents: 10_000,
  billingCycle: 'MONTHLY',
  includedSeats: 2,
  maxSeats: 10,
  seatPriceCents: 2_000,
  includedLocations: 1,
  locationPriceCents: null,
  displayOrder: 1,
  active: true,
  features: [],
  ...over,
});
const PRO = plan({
  id: 'plan-pro',
  code: 'PRO',
  name: 'Pro',
  priceCents: 30_000,
  includedSeats: 3,
  maxSeats: 20,
  seatPriceCents: 2_500,
  locationPriceCents: 5_000,
  displayOrder: 2,
});

const pricing = (over: Partial<SubscriptionPricing> = {}): SubscriptionPricing => ({
  status: 'ACTIVE',
  billingCycle: 'MONTHLY',
  seatsAllowed: 3,
  seatsUsed: null,
  extraLocations: 0,
  baseOverrideCents: null,
  priceCents: 12_000,
  currentPeriodStart: '2026-10-01',
  nextBillingOn: '2026-11-01',
  plan: { id: 'plan-basic' },
  ...over,
});

describe('prices', () => {
  it('adds extra seats and locations at the plan’s rates to the base or the negotiated base', () => {
    const facts = {
      billingCycle: 'MONTHLY' as const,
      seatsIncluded: 3,
      seatsPurchased: 2,
      locationsIncluded: 1,
      locationsPurchased: 1,
      priceCentsOverride: null,
    };
    expect(pricesOf(PRO, facts)).toEqual({
      seatsAllowed: 5,
      locationsAllowed: 2,
      listPriceCents: 40_000,
      priceCents: 40_000,
      monthlyCents: 40_000,
    });
    expect(pricesOf(PRO, { ...facts, priceCentsOverride: 20_000 })).toMatchObject({
      listPriceCents: 40_000,
      priceCents: 30_000,
    });
    // Annual: 12 months of the monthly price; its monthly equivalent is a 12th, rounded down.
    expect(pricesOf(PRO, { ...facts, billingCycle: 'ANNUAL' })).toMatchObject({
      priceCents: 480_000,
      monthlyCents: 40_000,
    });
  });

  it('turns an annual plan’s price into a month by a 12th, rounded down', () => {
    const yearly = plan({ priceCents: 100_001, billingCycle: 'ANNUAL' });
    expect(subscriptionPriceCents(yearly, { billingCycle: 'MONTHLY' })).toBe(8_333);
  });

  it('seat usage is a whole percent, unknown until the rollup counts', () => {
    expect(usageOf(null, 5)).toBeNull();
    expect(usageOf(4, 5)).toBe(80);
    expect(usageOf(2, 3)).toBe(67);
  });
});

describe('proration', () => {
  it('bills the price difference for the days left of the same cycle', () => {
    const r = subscriptionProration({
      today: '2026-10-11',
      status: 'ACTIVE',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      from: { priceCents: 12_000, billingCycle: 'MONTHLY' },
      to: { priceCents: 30_000, billingCycle: 'MONTHLY' },
    });
    expect(r).toEqual({ amountCents: 12_000, nextBillingOn: '2026-10-31' });
  });

  it('a new cycle bills its full price less the unused part and moves the next billing', () => {
    const r = subscriptionProration({
      today: TODAY,
      status: 'ACTIVE',
      periodStart: TODAY,
      periodEnd: subscriptionAddMonths(TODAY, 1),
      from: { priceCents: 30_000, billingCycle: 'MONTHLY' },
      to: { priceCents: 360_000, billingCycle: 'ANNUAL' },
    });
    expect(r).toEqual({ amountCents: 330_000, nextBillingOn: '2027-10-20' });
  });

  it('moves nothing in a trial or without a period', () => {
    const base = {
      today: TODAY,
      periodStart: null,
      from: { priceCents: 1, billingCycle: 'MONTHLY' as const },
      to: { priceCents: 9, billingCycle: 'MONTHLY' as const },
    };
    expect(
      subscriptionProration({ ...base, status: 'TRIAL', periodEnd: '2026-11-20' }).amountCents,
    ).toBe(0);
    expect(subscriptionProration({ ...base, status: 'NON_RENEWING', periodEnd: null })).toEqual({
      amountCents: 0,
      nextBillingOn: null,
    });
  });

  it('the preview keeps the seats in use, drops locations a plan doesn’t sell, clears the negotiated base', () => {
    const toPro = previewSubscriptionChange(
      pricing({ baseOverrideCents: 9_000, seatsUsed: 4 }),
      PRO,
      {},
      '2026-10-01',
    );
    expect(toPro).toMatchObject({
      seats: 4,
      extraSeats: 1,
      baseOverrideCents: null,
      blocked: null,
    });
    const down = previewSubscriptionChange(
      pricing({ plan: { id: 'plan-pro' }, extraLocations: 2 }),
      plan(),
      {},
      '2026-10-01',
    );
    expect(down).toMatchObject({ extraLocations: 0, droppedLocations: 2 });
    expect(
      previewSubscriptionChange(pricing({ seatsUsed: 5 }), plan(), { seats: 4 }, TODAY).blocked,
    ).toBe('SEATS_IN_USE');
    expect(previewSubscriptionChange(pricing(), plan(), { seats: 11 }, TODAY).blocked).toBe(
      'SEATS_OUT_OF_RANGE',
    );
    expect(previewSubscriptionChange(pricing(), plan(), { extraLocations: 1 }, TODAY).blocked).toBe(
      'LOCATIONS_NOT_OFFERED',
    );
  });

  it('moving the billing date bills the days added and credits the days removed', () => {
    const sub = pricing({ priceCents: 31_000, currentPeriodStart: '2026-10-01' });
    expect(subscriptionBillingDateCents(sub, '2026-11-11')).toBe(10_000);
    expect(subscriptionBillingDateCents(sub, '2026-10-22')).toBe(-10_000);
    expect(subscriptionBillingDateCents({ ...sub, nextBillingOn: null }, '2026-11-11')).toBe(0);
  });
});

describe('the row’s dates and statuses', () => {
  const facts = {
    status: 'ACTIVE' as const,
    autoRenew: true,
    nextBillingOn: '2026-11-20',
    trialEndsOn: '2026-10-01',
    periodEnd: '2026-11-20',
    paidThroughOn: '2026-11-20',
    closedOn: null,
  };

  it('shows the next billing only while it renews', () => {
    expect(nextBillingOf(facts)).toBe('2026-11-20');
    expect(nextBillingOf({ ...facts, status: 'PAST_DUE' })).toBe('2026-11-20');
    expect(nextBillingOf({ ...facts, autoRenew: false })).toBeNull();
    for (const status of ['TRIAL', 'NON_RENEWING', 'SUSPENDED', 'CANCELLED'] as const)
      expect(nextBillingOf({ ...facts, status })).toBeNull();
  });

  it('says when access ends', () => {
    expect(accessEndsOf(facts)).toBeNull();
    expect(accessEndsOf({ ...facts, status: 'NON_RENEWING', autoRenew: false })).toBe('2026-11-20');
    expect(accessEndsOf({ ...facts, status: 'TRIAL', autoRenew: false })).toBe('2026-10-01');
    expect(accessEndsOf({ ...facts, status: 'TRIAL' })).toBeNull();
    expect(accessEndsOf({ ...facts, status: 'EXPIRED' })).toBe('2026-10-01');
    expect(accessEndsOf({ ...facts, status: 'CANCELLED', closedOn: '2026-10-19' })).toBe(
      '2026-10-19',
    );
  });

  it('a plan move is an upgrade or downgrade by display order, then by monthly price', () => {
    expect(planChangeKind(plan(), PRO)).toBe('UPGRADED');
    expect(planChangeKind(PRO, plan())).toBe('DOWNGRADED');
    const yearly = plan({ priceCents: 110_000, billingCycle: 'ANNUAL' });
    expect(planChangeKind(plan(), yearly)).toBe('DOWNGRADED');
  });

  it('reactivation: back to Trial when it never paid, else by Auto-Renew', () => {
    expect(reactivatedStatus({ paid: false, autoRenew: true })).toBe('TRIAL');
    expect(reactivatedStatus({ paid: true, autoRenew: true })).toBe('ACTIVE');
    expect(reactivatedStatus({ paid: true, autoRenew: false })).toBe('NON_RENEWING');
  });

  it('the suspension’s kind: the one kept, else nonpayment from Past Due, else administrative', () => {
    expect(suspensionKindOf('PAUSE', 'ACTIVE')).toBe('PAUSE');
    expect(suspensionKindOf(undefined, 'PAST_DUE')).toBe('NONPAYMENT');
    expect(suspensionKindOf('BOGUS', 'ACTIVE')).toBe('ADMIN');
    const audit = (kind: string, createdAt: string): AuditRow => ({
      id: kind,
      action: 'subscription.suspended',
      actorUserId: null,
      metadata: { kind },
      createdAt: at(createdAt),
    });
    expect(
      keptSuspensionKind([
        audit('ADMIN', '2026-10-01T00:00:00Z'),
        audit('PAUSE', '2026-10-05T00:00:00Z'),
      ]),
    ).toBe('PAUSE');
  });
});

describe('the table', () => {
  const row = (over: Partial<SubscriptionRow> & { id: string }): SubscriptionRow =>
    ({
      firm: {
        id: `f-${over.id}`,
        name: `Firm ${over.id}`,
        slug: 'firm',
        status: 'ACTIVE',
        email: null,
        domain: null,
      },
      plan: { id: 'plan-basic', code: 'BASIC', name: 'Basic' },
      status: 'ACTIVE',
      monthlyCents: 0,
      usagePercent: null,
      nextBillingOn: null,
      ...over,
    }) as SubscriptionRow;

  it('periods: both days, else the current UTC month; the one before is as long', () => {
    expect(periodOf({}, TODAY)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(periodOf({ from: '2026-01-01', to: '2026-01-10' }, TODAY)).toEqual({
      from: '2026-01-01',
      to: '2026-01-10',
    });
    expect(previousPeriod({ from: '2026-10-01', to: '2026-10-31' })).toEqual({
      from: '2026-08-31',
      to: '2026-09-30',
    });
  });

  it('the status filter and its groups', () => {
    const soon = row({ id: 'a', nextBillingOn: '2026-11-19' });
    expect(matchesStatus(soon, 'RENEWING_SOON', TODAY)).toBe(true);
    expect(renewsSoon(row({ id: 'b', nextBillingOn: '2026-11-20' }), TODAY)).toBe(false);
    expect(matchesStatus(row({ id: 'c', status: 'NON_RENEWING' }), 'PAYING', TODAY)).toBe(true);
    expect(matchesStatus(row({ id: 'd', status: 'TRIAL' }), 'PAYING', TODAY)).toBe(false);
    expect(matchesStatus(row({ id: 'e', status: 'TRIAL' }), 'TRIAL', TODAY)).toBe(true);
  });

  it('in force during the period; search covers the firm’s name, slug, email and domain', () => {
    const period = { from: '2026-10-01', to: '2026-10-31' };
    expect(inForce({ startedOn: '2026-09-01', endedOn: null }, period)).toBe(true);
    expect(inForce({ startedOn: '2026-11-01', endedOn: null }, period)).toBe(false);
    expect(inForce({ startedOn: '2026-01-01', endedOn: '2026-09-30' }, period)).toBe(false);
    expect(inForce({ startedOn: '2026-01-01', endedOn: '2026-10-01' }, period)).toBe(true);
    const r = row({ id: 'x' });
    r.firm.domain = 'fake-firm.example.test';
    expect(matchesSearch(r, 'FIRM x')).toBe(true);
    expect(matchesSearch(r, 'fake-firm')).toBe(true);
    expect(matchesSearch(r, 'other')).toBe(false);
  });

  it('sorts by the key with unknown values last either way, then by firm name', () => {
    const rows = [
      row({ id: 'b', usagePercent: 40 }),
      row({ id: 'a', usagePercent: null }),
      row({ id: 'c', usagePercent: 90 }),
    ];
    expect(sortRows(rows, 'USAGE', 'asc').map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(sortRows(rows, 'USAGE', 'desc').map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect(sortRows(rows).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('churn', () => {
  const move = (subscriptionId: string, toStatus: ChangeRow['toStatus'], iso: string) => ({
    subscriptionId,
    toStatus,
    at: Date.parse(iso),
  });

  it('counts those paying when the period began that moved to Canceled in it', () => {
    const moves = [
      move('a', 'ACTIVE', '2026-09-01T00:00:00Z'),
      move('a', 'CANCELLED', '2026-10-05T00:00:00Z'),
      move('b', 'ACTIVE', '2026-09-02T00:00:00Z'),
      move('c', 'TRIAL', '2026-09-03T00:00:00Z'),
      move('c', 'CANCELLED', '2026-10-06T00:00:00Z'),
      move('d', 'ACTIVE', '2026-10-02T00:00:00Z'),
      move('d', 'CANCELLED', '2026-10-07T00:00:00Z'),
      move('e', 'ACTIVE', '2026-09-03T00:00:00Z'),
      move('e', null, '2026-09-20T00:00:00Z'),
      move('e', 'CANCELLED', '2026-10-31T23:00:00Z'),
    ];
    expect(churnOf(moves, { from: '2026-10-01', to: '2026-10-31' })).toEqual({
      base: 3,
      churned: 2,
      rateBp: 6_667,
    });
    expect(churnOf([], { from: '2026-10-01', to: '2026-10-31' })).toEqual({
      base: 0,
      churned: 0,
      rateBp: 0,
    });
  });
});

describe('events and notes', () => {
  const note = (over: Partial<NoteRow> & { id: string; auditLogId: string }): NoteRow => ({
    authorUserId: 'admin-1',
    body: 'Fake note',
    supersedesNoteId: null,
    retractedAt: null,
    createdAt: at('2026-10-10T10:00:00Z'),
    ...over,
  });

  it('keeps a reason and its approver in one note, and reads them back', () => {
    expect(splitEventNote(eventNote('Fake loyalty', 'Fake Approver'))).toEqual({
      reason: 'Fake loyalty',
      approvedBy: 'Fake Approver',
    });
    expect(splitEventNote(eventNote('Fake only'))).toEqual({
      reason: 'Fake only',
      approvedBy: null,
    });
    expect(splitEventNote(null)).toEqual({ reason: null, approvedBy: null });
  });

  it('a note as B4 left it: the latest edit of the first note, nothing once retracted', () => {
    const first = note({ id: 'n1', auditLogId: 'a1' });
    const edit = note({
      id: 'n2',
      auditLogId: 'a1',
      supersedesNoteId: 'n1',
      body: 'Fake edited',
      createdAt: at('2026-10-11T10:00:00Z'),
    });
    const other = note({ id: 'n3', auditLogId: 'a1', createdAt: at('2026-10-12T10:00:00Z') });
    const byAge = (a: NoteRow, b: NoteRow) => a.createdAt.getTime() - b.createdAt.getTime();
    expect(currentNote([other, edit, first], byAge)?.body).toBe('Fake edited');
    expect(currentNote([{ ...first, retractedAt: at('2026-10-13T00:00:00Z') }], byAge)).toBeNull();
    expect(notesByRow([first, edit]).get('a1')?.id).toBe('n2');
  });

  it('maps history rows and this module’s audit rows to events, newest first', () => {
    const changes: ChangeRow[] = [
      {
        id: 'c1',
        kind: 'UPGRADED',
        fromPlanId: 'plan-basic',
        toPlanId: 'plan-pro',
        fromStatus: 'ACTIVE',
        toStatus: 'ACTIVE',
        fromSeats: 3,
        toSeats: 3,
        mrrCents: 30_000,
        reason: null,
        effectiveAt: at('2026-10-10T10:00:00Z'),
        changedByUserId: 'admin-1',
      },
      {
        id: 'c2',
        kind: 'STATUS_CHANGED',
        fromPlanId: null,
        toPlanId: null,
        fromStatus: 'ACTIVE',
        toStatus: 'PAST_DUE',
        fromSeats: null,
        toSeats: null,
        mrrCents: null,
        reason: null,
        effectiveAt: at('2026-10-12T10:00:00Z'),
        changedByUserId: null,
      },
    ];
    const audits: AuditRow[] = [
      {
        id: 'a1',
        action: 'subscription.plan_changed',
        actorUserId: 'admin-1',
        metadata: { changeIds: ['c1'], amountCents: 18_000 },
        createdAt: at('2026-10-10T10:00:00Z'),
      },
      {
        id: 'a2',
        action: 'subscription.price_changed',
        actorUserId: 'admin-1',
        metadata: { event: 'PRICE_CHANGED', fromCents: null, toCents: 9_000, mrrCents: 29_000 },
        createdAt: at('2026-10-11T10:00:00Z'),
      },
      {
        id: 'a3',
        action: 'subscription.note_added',
        actorUserId: 'admin-1',
        metadata: { event: 'NOTE_ADDED' },
        createdAt: at('2026-10-13T10:00:00Z'),
      },
      {
        id: 'a4',
        action: 'subscription.trial_extended',
        actorUserId: 'admin-1',
        metadata: { event: 'TRIAL_EXTENDED', fromDay: '2026-10-14', toDay: 'not a day' },
        createdAt: at('2026-10-09T10:00:00Z'),
      },
    ];
    const notes = notesByRow([
      note({ id: 'n1', auditLogId: 'a2', body: eventNote('Fake loyalty', 'Fake Approver') }),
      note({ id: 'n2', auditLogId: 'a3', body: 'Fake internal' }),
    ]);
    const names: Record<string, string> = { 'plan-basic': 'Basic', 'plan-pro': 'Pro' };
    const events = eventsOf({
      changes,
      audits,
      notes,
      planName: (id) => (id ? (names[id] ?? null) : null),
      nameOf: (id) => (id ? 'Fake Admin' : 'System'),
    });
    expect(events.map((e) => [e.id, e.source, e.action])).toEqual([
      ['a3', 'AUDIT', 'NOTE_ADDED'],
      ['c2', 'CHANGE', 'STATUS_CHANGED'],
      ['a2', 'AUDIT', 'PRICE_CHANGED'],
      ['c1', 'CHANGE', 'UPGRADED'],
      ['a4', 'AUDIT', 'TRIAL_EXTENDED'],
    ]);
    const [noteEvent, pastDue, price, upgrade, trial] = events;
    expect(upgrade).toMatchObject({
      fromPlan: 'Basic',
      toPlan: 'Pro',
      amountCents: 18_000,
      mrrCents: 30_000,
      actor: { kind: 'USER', name: 'Fake Admin' },
    });
    expect(pastDue).toMatchObject({ actor: { kind: 'SYSTEM', name: 'System' }, amountCents: null });
    expect(price).toMatchObject({
      toCents: 9_000,
      fromCents: null,
      reason: 'Fake loyalty',
      approvedBy: 'Fake Approver',
    });
    expect(noteEvent).toMatchObject({ reason: null });
    expect(trial).toMatchObject({ fromDay: '2026-10-14', toDay: null });
    expect(events.map(subscriptionEventText)).toEqual([
      'Internal note added',
      'Payment failed',
      'Negotiated price set',
      'Plan upgraded',
      'Trial extended',
    ]);
    expect(subscriptionNotesOf(audits, notes, () => 'Fake Admin')).toEqual([
      {
        id: 'n2',
        body: 'Fake internal',
        author: 'Fake Admin',
        createdAt: '2026-10-10T10:00:00.000Z',
      },
    ]);
  });
});

describe('a change with two history rows', () => {
  it('shows its money once, on the first row', () => {
    const change = (id: string, kind: ChangeRow['kind']): ChangeRow => ({
      id,
      kind,
      fromPlanId: null,
      toPlanId: null,
      fromStatus: 'ACTIVE',
      toStatus: 'ACTIVE',
      fromSeats: 3,
      toSeats: 3,
      mrrCents: 30_000,
      reason: null,
      effectiveAt: at('2026-10-10T10:00:00Z'),
      changedByUserId: 'admin-1',
    });
    const events = eventsOf({
      changes: [change('c1', 'UPGRADED'), change('c2', 'CYCLE_CHANGED')],
      audits: [
        {
          id: 'a1',
          action: 'subscription.plan_changed',
          actorUserId: 'admin-1',
          metadata: { changeIds: ['c1', 'c2'], amountCents: 330_000 },
          createdAt: at('2026-10-10T10:00:00Z'),
        },
      ],
      notes: new Map(),
      planName: () => null,
      nameOf: () => 'Fake Admin',
    });
    expect(Object.fromEntries(events.map((e) => [e.action, e.amountCents]))).toEqual({
      UPGRADED: 330_000,
      CYCLE_CHANGED: null,
    });
  });
});

describe('errors and CSV', () => {
  it('answers each contract code with its status', () => {
    expect(refuse('ALREADY_SUBSCRIBED').getStatus()).toBe(409);
    expect(refuse('NO_CHANGE').getStatus()).toBe(422);
    expect(refuse('NOT_FOUND').getStatus()).toBe(404);
    expect(refuse('BALANCE_DUE').getResponse()).toMatchObject({ code: 'BALANCE_DUE' });
  });

  it('turns database refusals into codes, never a 500', () => {
    const db = (code: string) => ({
      meta: { driverAdapterError: { cause: { originalCode: code } } },
    });
    const unique = asSubscriptionError({ code: 'P2002' }) as HttpException;
    expect(unique.getResponse()).toMatchObject({ code: 'ALREADY_SUBSCRIBED' });
    expect((asSubscriptionError(db('23514')) as HttpException).getStatus()).toBe(400);
    expect((asSubscriptionError(db('23503')) as HttpException).getStatus()).toBe(404);
    const http = new ConflictException({ code: 'FIRM_NOT_BILLABLE' });
    expect(asSubscriptionError(http)).toBe(http);
    const other = new Error('boom');
    expect(asSubscriptionError(other)).toBe(other);
  });

  it('quotes cells that would run as a spreadsheet formula', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(null)).toBe('');
  });
});
