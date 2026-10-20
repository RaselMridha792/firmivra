import { describe, expect, it } from 'vitest';
import type { SalesOpportunity } from '@firmivra/types';
import { inSet, sortViews, summaryOf } from '../../src/admin-sales/sales-records.service.js';
import { builderMoveProblem } from '../../src/admin-sales/sales-setup.service.js';
import { attainmentOf } from '../../src/admin-sales/sales-targets.service.js';
import {
  assignmentFeedKind,
  attentionOf,
  basisPoints,
  boundsOf,
  change,
  contactStats,
  conversionOf,
  csvCell,
  DAY_MS,
  entryProblem,
  HOUR_MS,
  monthlyCents,
  periodBounds,
  phoneKeys,
  stageFeedKind,
  transactionStatusOf,
  within,
} from '../../src/admin-sales/sales-math.js';

const at = (s: string) => Date.parse(s);
const NOW = at('2026-10-19T15:00:00.000Z');
const rules = {
  noContactHours: 24,
  followUpDueHours: 24,
  noResponseAttempts: 3,
  noActivityDays: 14,
  ownerRequired: true,
};

describe('periods (UTC days)', () => {
  it('takes the last N days ending today and the N days before', () => {
    const { current, previous } = periodBounds({ period: 'LAST_7_DAYS' }, NOW);
    expect([current.from, current.to]).toEqual(['2026-10-13', '2026-10-19']);
    expect([previous.from, previous.to]).toEqual(['2026-10-06', '2026-10-12']);
    expect(periodBounds({}, NOW).current.from).toBe('2026-09-20');
  });

  it('takes this calendar month, quarter or year and the one before', () => {
    const month = periodBounds({ period: 'THIS_MONTH' }, NOW);
    expect([month.current.from, month.current.to]).toEqual(['2026-10-01', '2026-10-31']);
    expect([month.previous.from, month.previous.to]).toEqual(['2026-09-01', '2026-09-30']);
    const quarter = periodBounds({ period: 'THIS_QUARTER' }, NOW);
    expect([quarter.current.from, quarter.current.to]).toEqual(['2026-10-01', '2026-12-31']);
    expect([quarter.previous.from, quarter.previous.to]).toEqual(['2026-07-01', '2026-09-30']);
    const year = periodBounds({ period: 'THIS_YEAR' }, at('2026-02-10T00:00:00.000Z'));
    expect([year.previous.from, year.previous.to]).toEqual(['2025-01-01', '2025-12-31']);
    const january = periodBounds({ period: 'THIS_QUARTER' }, at('2026-01-05T00:00:00.000Z'));
    expect(january.previous.from).toBe('2025-10-01');
  });

  it('compares a range with the same number of days just before', () => {
    const { previous } = periodBounds({ from: '2026-10-10', to: '2026-10-19' }, NOW);
    expect([previous.from, previous.to]).toEqual(['2026-09-30', '2026-10-09']);
    const day = boundsOf('2026-10-19', '2026-10-19');
    expect(within(at('2026-10-19T23:59:59.999Z'), day)).toBe(true);
    expect(within(at('2026-10-20T00:00:00.000Z'), day)).toBe(false);
    expect(within(null, day)).toBe(false);
  });
});

describe('numbers', () => {
  it('gives a trend only when there is something to compare with', () => {
    expect(change(5, 0)).toBeNull();
    expect(change(0, 0)).toBeNull();
    expect(change(15, 10)).toBe(50);
    expect(change(5, 10)).toBe(-50);
    expect(basisPoints(1, 3)).toBe(3333);
    expect(basisPoints(4, 0)).toBe(0);
  });

  it('counts B5 conversion: converted ÷ created, both without the duplicates and invalid leads', () => {
    const c = new Date(NOW);
    expect(
      conversionOf([
        { convertedAt: c, lostReason: null },
        { convertedAt: null, lostReason: 'BUDGET' },
        { convertedAt: null, lostReason: 'DUPLICATE' },
        { convertedAt: null, lostReason: 'INVALID_LEAD' },
        { convertedAt: null, lostReason: null },
        // Converted, then lost as a duplicate: out of both, so the rate never passes 100%.
        { convertedAt: c, lostReason: 'DUPLICATE' },
      ]),
    ).toEqual({ rateBp: 3333, converted: 1, eligible: 3 });
    expect(
      conversionOf([
        { convertedAt: c, lostReason: null },
        { convertedAt: c, lostReason: 'INVALID_LEAD' },
      ]),
    ).toEqual({ rateBp: 10_000, converted: 1, eligible: 1 });
    expect(conversionOf([])).toEqual({ rateBp: 0, converted: 0, eligible: 0 });
  });

  it('prices a linked subscription per month', () => {
    const plan = {
      basePriceCents: 19_900,
      overagePriceCentsPerSeat: 2_900,
      overagePriceCentsPerLocation: null,
      billingCycle: 'MONTHLY' as const,
    };
    expect(
      monthlyCents({ priceCentsOverride: null, seatsPurchased: 2, locationsPurchased: 1 }, plan),
    ).toBe(25_700);
    expect(
      monthlyCents({ priceCentsOverride: 15_000, seatsPurchased: 0, locationsPurchased: 0 }, plan),
    ).toBe(15_000);
    expect(
      monthlyCents(
        { priceCentsOverride: 120_001, seatsPurchased: 0, locationsPurchased: 0 },
        { ...plan, billingCycle: 'ANNUAL' },
      ),
    ).toBe(10_000);
  });

  it('maps a subscription state to the transaction status (B5)', () => {
    expect(transactionStatusOf('ACTIVE')).toBe('UNDER_CONTRACT');
    expect(transactionStatusOf('NON_RENEWING')).toBe('UNDER_CONTRACT');
    expect(transactionStatusOf('EXPIRED')).toBe('CLOSED');
    expect(transactionStatusOf('CANCELLED')).toBe('TERMINATED');
    expect(transactionStatusOf('TRIAL')).toBe('OPEN');
  });

  it('writes CSV cells that never run as a formula', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('Fake, Inc.')).toBe('"Fake, Inc."');
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(null)).toBe('');
    expect(phoneKeys('15550100123')).toEqual(['15550100123', '5550100123']);
    expect(phoneKeys('5550100123')).toEqual(['5550100123', '15550100123']);
  });
});

describe('contact counters and attention (B5)', () => {
  const act = (
    direction: 'OUTBOUND' | 'INBOUND',
    outcome: 'NO_ANSWER' | 'CONNECTED' | null,
    iso: string,
  ) => ({
    direction,
    outcome,
    occurredAt: new Date(iso),
  });

  it('counts attempts since the last two-way contact', () => {
    const stats = contactStats([
      act('OUTBOUND', 'NO_ANSWER', '2026-10-01T10:00:00Z'),
      act('OUTBOUND', 'CONNECTED', '2026-10-02T10:00:00Z'),
      act('OUTBOUND', 'NO_ANSWER', '2026-10-03T10:00:00Z'),
      act('OUTBOUND', null, '2026-10-04T10:00:00Z'),
    ]);
    expect(stats).toMatchObject({ outbound: 4, attempts: 2 });
    expect(stats.contactedAt?.toISOString()).toBe('2026-10-02T10:00:00.000Z');
    expect(stats.lastAt?.toISOString()).toBe('2026-10-04T10:00:00.000Z');
    expect(contactStats([act('INBOUND', null, '2026-10-01T10:00:00Z')]).attempts).toBe(0);
  });

  const base = {
    stageType: 'ACTIVE' as const,
    inNewLead: true,
    ownerId: 'someone',
    createdAt: NOW - 2 * DAY_MS,
    lastActivityAt: NOW - HOUR_MS,
    outbound: 0,
    attempts: 0,
    scheduledDue: [] as number[],
  };

  it('raises each badge from the settings, most important first', () => {
    expect(attentionOf(base, rules, NOW)).toEqual(['NO_CONTACT']);
    expect(attentionOf({ ...base, outbound: 1 }, rules, NOW)).toEqual([]);
    expect(
      attentionOf({ ...base, inNewLead: false, attempts: 3, outbound: 3 }, rules, NOW),
    ).toEqual(['NO_RESPONSE']);
    expect(
      attentionOf(
        { ...base, outbound: 1, ownerId: null, scheduledDue: [NOW - HOUR_MS, NOW + HOUR_MS] },
        rules,
        NOW,
      ),
    ).toEqual(['OVERDUE', 'UNASSIGNED', 'FOLLOW_UP_DUE']);
    expect(
      attentionOf({ ...base, outbound: 1, ownerId: null }, { ...rules, ownerRequired: false }, NOW),
    ).toEqual([]);
    expect(
      attentionOf({ ...base, outbound: 1, lastActivityAt: NOW - 15 * DAY_MS }, rules, NOW),
    ).toEqual(['NO_ACTIVITY']);
    expect(
      attentionOf({ ...base, scheduledDue: [NOW + 30 * HOUR_MS], outbound: 1 }, rules, NOW),
    ).toEqual([]);
  });

  it('gives lost and closed records no badges', () => {
    expect(attentionOf({ ...base, stageType: 'LOST', ownerId: null }, rules, NOW)).toEqual([]);
    expect(attentionOf({ ...base, stageType: 'CLOSED', ownerId: null }, rules, NOW)).toEqual([]);
    expect(
      attentionOf({ ...base, stageType: 'CONVERTED', inNewLead: false, ownerId: null }, rules, NOW),
    ).toEqual(['UNASSIGNED']);
  });
});

describe('the feed', () => {
  const row = {
    fromStageId: 'a',
    fromStageName: 'New Lead',
    toStageType: 'ACTIVE' as const,
    source: 'MANUAL' as const,
    transactionStatus: null,
    createdAt: new Date(NOW),
  };
  it('reads a stage row as created, won, lost, a sync or a move', () => {
    expect(stageFeedKind({ ...row, fromStageId: null, fromStageName: null }, null)).toBe('CREATED');
    expect(stageFeedKind({ ...row, toStageType: 'CONVERTED' }, new Date(NOW))).toBe('WON');
    expect(stageFeedKind({ ...row, toStageType: 'CONVERTED' }, new Date(NOW - 1000))).toBe(
      'STAGE_CHANGED',
    );
    expect(stageFeedKind({ ...row, toStageType: 'LOST' }, null)).toBe('LOST');
    expect(
      stageFeedKind(
        {
          ...row,
          toStageType: 'TRANSACTION_SYNCED',
          source: 'TRANSACTION',
          transactionStatus: 'UNDER_CONTRACT',
        },
        new Date(NOW - 1000),
      ),
    ).toBe('UNDER_CONTRACT');
    expect(
      stageFeedKind(
        {
          ...row,
          toStageType: 'CONVERTED',
          source: 'TRANSACTION',
          transactionStatus: 'TERMINATED',
        },
        new Date(NOW - 5000),
      ),
    ).toBe('TERMINATED');
    expect(stageFeedKind({ ...row, fromStageId: null }, null)).toBe('STAGE_CHANGED');
    expect(assignmentFeedKind(null, 'x')).toBe('ASSIGNED');
    expect(assignmentFeedKind('x', 'y')).toBe('REASSIGNED');
    expect(assignmentFeedKind('x', null)).toBe('UNASSIGNED');
  });
});

describe('entering a stage', () => {
  const record = {
    valueCents: null,
    ownerId: null,
    planId: null,
    transactionId: null,
    transactionStatus: null,
    lostReason: null,
    lostNote: null,
  };
  const stage = { type: 'ACTIVE' as const, active: true, requires: [] };

  it('names what the stage needs, in the order the person fixes it', () => {
    expect(entryProblem(stage, record, true)).toBeNull();
    expect(entryProblem({ ...stage, active: false }, record, true)).toBe('STAGE_INACTIVE');
    expect(entryProblem({ ...stage, requires: ['VALUE', 'PLAN'] }, record, true)).toBe(
      'VALUE_REQUIRED',
    );
    expect(entryProblem({ ...stage, requires: ['ASSIGNEE'] }, record, true)).toBe('OWNER_REQUIRED');
    expect(entryProblem({ ...stage, requires: ['TRANSACTION'] }, record, true)).toBe(
      'TRANSACTION_REQUIRED',
    );
    expect(entryProblem({ ...stage, type: 'TRANSACTION_SYNCED' }, record, true)).toBe(
      'TRANSACTION_LOCKED',
    );
    expect(entryProblem(stage, { ...record, transactionStatus: 'UNDER_CONTRACT' }, true)).toBe(
      'TRANSACTION_LOCKED',
    );
    expect(entryProblem(stage, { ...record, lostReason: 'BUDGET' }, true)).toBe(
      'LOST_REASON_NOT_ALLOWED',
    );
  });

  it('needs a lost reason, and a note for OTHER while the settings ask', () => {
    const lost = { ...stage, type: 'LOST' as const };
    expect(entryProblem(lost, record, true)).toBe('LOST_REASON_REQUIRED');
    expect(entryProblem(lost, { ...record, lostReason: 'OTHER' }, true)).toBe('LOST_NOTE_REQUIRED');
    expect(entryProblem(lost, { ...record, lostReason: 'OTHER' }, false)).toBeNull();
    expect(
      entryProblem(lost, { ...record, lostReason: 'OTHER', lostNote: 'Moved' }, true),
    ).toBeNull();
    expect(
      entryProblem({ ...lost, requires: ['LOST_NOTE'] }, { ...record, lostReason: 'TIMING' }, true),
    ).toBe('LOST_NOTE_REQUIRED');
  });

  it('lets the builder move a transaction-bound record only to a stage of its type', () => {
    const row = {
      valueCents: null,
      assignedToUserId: null,
      planId: null,
      transactionId: 'tx',
      transactionStatus: 'UNDER_CONTRACT' as const,
      lostReason: null,
      lostNote: null,
    };
    const ctx = { rules: { lostOtherNoteRequired: true } } as Parameters<
      typeof builderMoveProblem
    >[2];
    expect(
      builderMoveProblem(
        { type: 'TRANSACTION_SYNCED', active: true, requires: ['TRANSACTION'] },
        row,
        ctx,
      ),
    ).toBeNull();
    expect(builderMoveProblem({ type: 'CONVERTED', active: true, requires: [] }, row, ctx)).toBe(
      'TRANSACTION_LOCKED',
    );
    expect(
      builderMoveProblem(
        { type: 'LOST', active: true, requires: [] },
        { ...row, transactionStatus: null, lostReason: 'BUDGET' },
        ctx,
      ),
    ).toBeNull();
  });
});

describe('the KPI row and the list', () => {
  const view = (patch: Partial<SalesOpportunity>): SalesOpportunity =>
    ({
      id: patch.id ?? 'x',
      stageType: 'ACTIVE',
      stageOrder: 0,
      valueCents: null,
      convertedAt: null,
      lostReason: null,
      attention: [],
      createdAt: new Date(NOW - DAY_MS).toISOString(),
      lastActivityAt: new Date(NOW - DAY_MS).toISOString(),
      firmName: 'Fake',
      ...patch,
    }) as SalesOpportunity;

  it('counts B5 pipeline value, closed revenue, active clients and attention', () => {
    const all = [
      view({ id: 'a', valueCents: 1000 }),
      view({
        id: 'b',
        stageType: 'CONVERTED',
        valueCents: 2000,
        convertedAt: new Date(NOW).toISOString(),
      }),
      view({ id: 'c', stageType: 'TRANSACTION_SYNCED', valueCents: 3000 }),
      view({ id: 'd', stageType: 'CLOSED', valueCents: 4000 }),
      view({ id: 'e', stageType: 'LOST', valueCents: 5000, lostReason: 'DUPLICATE' }),
      view({
        id: 'f',
        attention: ['OVERDUE', 'UNASSIGNED'],
        createdAt: new Date(NOW - 40 * DAY_MS).toISOString(),
      }),
    ];
    const s = summaryOf(all, 'p', {}, NOW);
    expect(s).toMatchObject({
      totalOpportunities: 6,
      inProgress: 2,
      pipelineValueCents: 6000,
      closedRevenueCents: 4000,
      activeClients: 2,
      needsAttention: 1,
      conversion: { converted: 1, eligible: 5, rateBp: 2000 },
    });
    expect(s.attention).toMatchObject({ OVERDUE: 1, UNASSIGNED: 1, NO_CONTACT: 0 });
    expect(s.trends.totalOpportunities).toBe(400);
    expect(summaryOf([], 'p', {}, NOW)).toMatchObject({
      totalOpportunities: 0,
      pipelineValueCents: 0,
      conversion: { rateBp: 0 },
      trends: { totalOpportunities: null, conversion: null },
    });
  });

  it('keeps the KPI sets and sorts the list', () => {
    expect(inSet(view({ stageType: 'TRANSACTION_SYNCED' }), 'ACTIVE_CLIENTS')).toBe(true);
    expect(inSet(view({ stageType: 'CLOSED' }), 'OPEN')).toBe(false);
    expect(
      inSet(view({ stageType: 'LOST', convertedAt: new Date(NOW).toISOString() }), 'CONVERTED'),
    ).toBe(true);
    const rows = [
      view({ id: 'a', stageOrder: 1, valueCents: 10 }),
      view({ id: 'b', stageOrder: 0, valueCents: null }),
      view({ id: 'c', stageOrder: 0, valueCents: 30 }),
    ];
    expect(sortViews(rows, undefined, undefined).map((v) => v.id)).toEqual(['b', 'c', 'a']);
    expect(sortViews(rows, 'VALUE', undefined).map((v) => v.id)).toEqual(['c', 'a', 'b']);
    expect(sortViews(rows, 'VALUE', 'asc').map((v) => v.id)).toEqual(['a', 'c', 'b']);
  });
});

describe('targets (D1)', () => {
  const q4 = boundsOf('2026-10-01', '2026-12-31');
  it('shows progress so far against the share of the period elapsed', () => {
    const half = q4.start + (q4.end - q4.start) / 2;
    expect(attainmentOf('WON_DEALS', 6, 12, q4, half)).toEqual({
      actual: 6,
      progressBp: 5000,
      elapsedBp: 5000,
      onPace: true,
      ended: false,
    });
    expect(attainmentOf('WON_DEALS', 5, 12, q4, half).onPace).toBe(false);
    expect(attainmentOf('NEW_LEADS', 0, 10, q4, q4.start - DAY_MS)).toMatchObject({
      elapsedBp: 0,
      onPace: true,
    });
    expect(attainmentOf('CONVERSION_RATE', 2500, 2000, q4, q4.end)).toMatchObject({
      onPace: true,
      ended: true,
      progressBp: 12500,
    });
  });
});
