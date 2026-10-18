// The bookkeeping module's logic (R38 Bookkeeping API): overview periods, the next report date,
// figures across periods, the status rules, sync status, period names, CSV cells and the mapping
// of the database's named rules.
import { describe, expect, it } from 'vitest';
import {
  bookkeepingDbMessage,
  changePercent,
  csvCell,
  csvRow,
  dueAfter,
  figurePeriodsIn,
  mapBookkeepingDbError,
  nextReportDue,
  periodLabel,
  periodRange,
  providerLabel,
  sharePercent,
  suggestStatus,
  syncStatusOf,
  totalsOf,
  type FigurePeriod,
  type StatusInputs,
} from '../../src/bookkeeping/bookkeeping.shared.js';

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('periodRange', () => {
  const today = day('2026-10-17');
  it('gives the month, last month, quarter and year with the one before each', () => {
    expect(periodRange('THIS_MONTH', today)).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      previousFrom: '2026-09-01',
      previousTo: '2026-09-30',
    });
    expect(periodRange('LAST_MONTH', today)).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(periodRange('THIS_QUARTER', today)).toEqual({
      from: '2026-10-01',
      to: '2026-12-31',
      previousFrom: '2026-07-01',
      previousTo: '2026-09-30',
    });
    expect(periodRange('THIS_YEAR', today)).toMatchObject({
      from: '2026-01-01',
      to: '2026-12-31',
      previousFrom: '2025-01-01',
    });
  });
  it('crosses the year end', () => {
    expect(periodRange('THIS_MONTH', day('2026-01-05'))).toMatchObject({
      previousFrom: '2025-12-01',
      previousTo: '2025-12-31',
    });
  });
});

describe('changePercent and sharePercent', () => {
  it('compare to one decimal and say nothing with nothing to compare', () => {
    expect(changePercent(112, 100)).toBe(12);
    expect(changePercent(5, 0)).toBeNull();
    expect(changePercent(5, null)).toBeNull();
    expect(changePercent(-50, -100)).toBe(50);
    expect(sharePercent(1, 3)).toBe(33.3);
    expect(sharePercent(1, 0)).toBeNull();
  });
});

describe('periodLabel', () => {
  it('names whole months, quarters and years', () => {
    expect(periodLabel('MONTH', '2026-09-01', '2026-09-30')).toBe('September 2026');
    expect(periodLabel('MONTH', '2028-02-01', '2028-02-29')).toBe('February 2028');
    expect(periodLabel('QUARTER', '2026-07-01', '2026-09-30')).toBe('Q3 2026');
    expect(periodLabel('YEAR', '2026-01-01', '2026-12-31')).toBe('2026');
  });
  it('leaves dates that are not a whole period, and custom ones, to be named', () => {
    expect(periodLabel('MONTH', '2026-09-05', '2026-09-30')).toBeNull();
    expect(periodLabel('QUARTER', '2026-08-01', '2026-10-31')).toBeNull();
    expect(periodLabel('CUSTOM', '2026-09-01', '2026-09-30')).toBeNull();
  });
});

describe('nextReportDue', () => {
  const base = { cadenceMonths: null, closeTargetDay: 10 } as const;
  it('reports the latest finished month whose due date has not passed', () => {
    expect(
      nextReportDue({
        ...base,
        cadence: 'MONTHLY',
        lastCompletedEnd: null,
        today: day('2026-10-05'),
      }),
    ).toEqual({ dueOn: '2026-10-10', periodStart: '2026-09-01', periodEnd: '2026-09-30' });
    // A new client is never born overdue: the first report is the next one still ahead.
    expect(
      nextReportDue({
        ...base,
        cadence: 'MONTHLY',
        lastCompletedEnd: null,
        today: day('2026-10-17'),
      }),
    ).toEqual({ dueOn: '2026-11-10', periodStart: '2026-10-01', periodEnd: '2026-10-31' });
  });
  it('keeps a date that has passed once work is under way: it is overdue', () => {
    expect(
      nextReportDue({
        ...base,
        cadence: 'MONTHLY',
        lastCompletedEnd: '2026-08-31',
        today: day('2026-10-17'),
      }),
    ).toEqual({ dueOn: '2026-10-10', periodStart: '2026-09-01', periodEnd: '2026-09-30' });
  });
  it('moves to the period after the last completed one', () => {
    expect(
      nextReportDue({
        ...base,
        cadence: 'MONTHLY',
        lastCompletedEnd: '2026-09-30',
        today: day('2026-10-17'),
      }),
    ).toEqual({ dueOn: '2026-11-10', periodStart: '2026-10-01', periodEnd: '2026-10-31' });
  });
  it('follows quarters and years', () => {
    expect(
      nextReportDue({
        ...base,
        cadence: 'QUARTERLY',
        lastCompletedEnd: null,
        today: day('2026-10-05'),
      }),
    ).toEqual({ dueOn: '2026-10-10', periodStart: '2026-07-01', periodEnd: '2026-09-30' });
    expect(
      nextReportDue({
        ...base,
        cadence: 'QUARTERLY',
        lastCompletedEnd: '2026-09-30',
        today: day('2026-10-17'),
      }),
    ).toMatchObject({ periodStart: '2026-10-01', periodEnd: '2026-12-31', dueOn: '2027-01-10' });
    expect(
      nextReportDue({
        ...base,
        cadence: 'ANNUAL',
        lastCompletedEnd: null,
        today: day('2026-01-05'),
      }),
    ).toMatchObject({ periodStart: '2025-01-01', periodEnd: '2025-12-31', dueOn: '2026-01-10' });
  });
  it('counts a custom cadence in months', () => {
    expect(
      nextReportDue({
        cadence: 'CUSTOM',
        cadenceMonths: 2,
        closeTargetDay: 5,
        lastCompletedEnd: '2026-08-31',
        today: day('2026-10-17'),
      }),
    ).toEqual({ dueOn: '2026-11-05', periodStart: '2026-09-01', periodEnd: '2026-10-31' });
  });
  it('never puts the due day past the 28th', () => {
    expect(dueAfter('2026-01-31', 31)).toBe('2026-02-28');
  });
});

describe('figurePeriodsIn', () => {
  const p = (over: Partial<FigurePeriod>): FigurePeriod => ({
    engagementId: 'a',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
    incomeCents: 1000,
    expensesCents: 400,
    ...over,
  });
  it('takes periods inside the stretch with both figures known', () => {
    const picked = figurePeriodsIn(
      [
        p({}),
        p({ periodStart: '2026-08-01', periodEnd: '2026-08-31', expensesCents: null }),
        p({ periodStart: '2026-06-01', periodEnd: '2026-06-30' }),
      ],
      '2026-07-01',
      '2026-09-30',
    );
    expect(picked).toHaveLength(1);
    expect(totalsOf(picked)).toEqual({
      incomeCents: 1000,
      expensesCents: 400,
      netProfitCents: 600,
    });
  });
  it('counts the months of a client, not also its quarter', () => {
    const picked = figurePeriodsIn(
      [
        p({ periodStart: '2026-07-01', periodEnd: '2026-09-30', incomeCents: 9000 }),
        p({ periodStart: '2026-07-01', periodEnd: '2026-07-31' }),
        p({ periodStart: '2026-08-01', periodEnd: '2026-08-31' }),
      ],
      '2026-07-01',
      '2026-09-30',
    );
    expect(picked.map((x) => x.incomeCents)).toEqual([1000, 1000]);
  });
  it('counts each client once for the same stretch and nothing for no periods', () => {
    const picked = figurePeriodsIn([p({}), p({ engagementId: 'b' })], '2026-07-01', '2026-07-31');
    expect(picked).toHaveLength(2);
    expect(totalsOf([])).toEqual({ incomeCents: 0, expensesCents: 0, netProfitCents: 0 });
  });
});

describe('suggestStatus', () => {
  const inputs = (over: Partial<StatusInputs> = {}): StatusInputs => ({
    today: '2026-10-17',
    rules: {},
    alerts: {},
    started: true,
    overdueClose: null,
    overdueReport: null,
    outstandingRequests: 0,
    failedConnection: false,
    staleConnection: false,
    uncategorized: null,
    readyForReview: false,
    ...over,
  });
  it('is on track with nothing wrong, and not started before any work', () => {
    expect(suggestStatus(inputs())).toEqual({ status: 'ON_TRACK', reason: null });
    expect(suggestStatus(inputs({ started: false }))).toEqual({
      status: 'NOT_STARTED',
      reason: null,
    });
  });
  it('puts overdue first, then missing documents, then attention', () => {
    expect(
      suggestStatus(
        inputs({ overdueClose: '2026-10-10', outstandingRequests: 2, failedConnection: true }),
      ),
    ).toEqual({ status: 'OVERDUE', reason: 'Close past due 2026-10-10' });
    expect(suggestStatus(inputs({ overdueReport: '2026-09-30' }))).toEqual({
      status: 'OVERDUE',
      reason: 'Report past due 2026-09-30',
    });
    expect(suggestStatus(inputs({ outstandingRequests: 3, failedConnection: true }))).toEqual({
      status: 'MISSING_DOCUMENTS',
      reason: '3 documents outstanding',
    });
    expect(suggestStatus(inputs({ outstandingRequests: 1 })).reason).toBe('1 document outstanding');
    expect(suggestStatus(inputs({ failedConnection: true })).status).toBe('NEEDS_ATTENTION');
    expect(suggestStatus(inputs({ staleConnection: true })).status).toBe('NEEDS_ATTENTION');
    expect(suggestStatus(inputs({ uncategorized: 12 }))).toEqual({
      status: 'NEEDS_ATTENTION',
      reason: '12 transactions to categorize',
    });
    expect(suggestStatus(inputs({ readyForReview: true })).reason).toBe('Waiting for review');
  });
  it("waits out the firm's grace days", () => {
    const rules = { overdueAfterDays: 5 };
    expect(suggestStatus(inputs({ rules, overdueClose: '2026-10-14' })).status).toBe('ON_TRACK');
    expect(suggestStatus(inputs({ rules, overdueClose: '2026-10-11' })).status).toBe('OVERDUE');
  });
  it('ignores an alert the client turned off', () => {
    expect(
      suggestStatus(inputs({ alerts: { missingDocuments: false }, outstandingRequests: 4 })).status,
    ).toBe('ON_TRACK');
    expect(
      suggestStatus(inputs({ alerts: { failedIntegration: false }, failedConnection: true }))
        .status,
    ).toBe('ON_TRACK');
    expect(
      suggestStatus(inputs({ alerts: { staleSync: false }, staleConnection: true })).status,
    ).toBe('ON_TRACK');
    expect(
      suggestStatus(inputs({ alerts: { overdueClose: false }, overdueClose: '2026-01-01' })).status,
    ).toBe('ON_TRACK');
  });
});

describe('syncStatusOf', () => {
  const now = day('2026-10-17');
  it('says not connected, error, never, stale or synced from the connection', () => {
    expect(syncStatusOf(null, 48, now)).toBe('NOT_CONNECTED');
    expect(syncStatusOf({ status: 'DISCONNECTED', lastSuccessfulSyncAt: null }, 48, now)).toBe(
      'NOT_CONNECTED',
    );
    expect(syncStatusOf({ status: 'EXPIRED', lastSuccessfulSyncAt: now }, 48, now)).toBe('ERROR');
    expect(syncStatusOf({ status: 'ERROR', lastSuccessfulSyncAt: now }, 48, now)).toBe('ERROR');
    expect(syncStatusOf({ status: 'CONNECTED', lastSuccessfulSyncAt: null }, 48, now)).toBe(
      'NEVER',
    );
    expect(
      syncStatusOf({ status: 'CONNECTED', lastSuccessfulSyncAt: day('2026-10-10') }, 48, now),
    ).toBe('STALE');
    expect(
      syncStatusOf({ status: 'CONNECTED', lastSuccessfulSyncAt: day('2026-10-16') }, 48, now),
    ).toBe('SYNCED');
  });
});

describe('providerLabel', () => {
  it('names the known providers and shows any other key as it is', () => {
    expect(providerLabel('quickbooks')).toBe('QuickBooks Online');
    expect(providerLabel('wave')).toBe('wave');
    expect(providerLabel(null)).toBe('Not connected');
  });
});

describe('csv', () => {
  it('quotes cells and defuses formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(null)).toBe('');
    expect(csvRow(['a', 1, null, '+1'])).toBe("a,1,,'+1");
  });
});

describe('the database rules', () => {
  const raised = (message: string) => ({ message: `ERROR: ${message}` });
  it('finds the rule in an error message', () => {
    expect(
      bookkeepingDbMessage(raised('bookkeeping: a closed period is locked, reopen it first')),
    ).toBe('bookkeeping: a closed period is locked, reopen it first');
    expect(bookkeepingDbMessage(new Error('something else'))).toBeUndefined();
    expect(bookkeepingDbMessage(null)).toBeUndefined();
  });
  const codeOf = (message: string) => {
    try {
      mapBookkeepingDbError(raised(message));
    } catch (e) {
      return (e as { getResponse?: () => { code: string } }).getResponse?.().code ?? 'RAW';
    }
    return 'NONE';
  };
  it("turns each rule into the contract's 409", () => {
    expect(codeOf('bookkeeping: a closed period is locked, reopen it first')).toBe('PERIOD_LOCKED');
    expect(codeOf('bookkeeping: the period is closed and locked')).toBe('PERIOD_LOCKED');
    expect(codeOf('bookkeeping: complete the required close steps before closing the period')).toBe(
      'CLOSE_ITEMS_OPEN',
    );
    expect(codeOf('bookkeeping reports: publish the report before delivering it')).toBe(
      'REPORT_NOT_PUBLISHED',
    );
    expect(codeOf("bookkeeping: the account must be the period's client's")).toBe(
      'NOT_THIS_CLIENTS',
    );
    expect(codeOf("bookkeeping reports: the period must be the same client's")).toBe(
      'NOT_THIS_CLIENTS',
    );
    expect(codeOf('bookkeeping: a NOT_STARTED period cannot become CLOSED')).toBe('PERIOD_STATE');
    expect(codeOf('bookkeeping reports: a delivered report is frozen')).toBe('REPORT_STATE');
  });
  it('rethrows what it does not know', () => {
    expect(() => mapBookkeepingDbError(new Error('boom'))).toThrow('boom');
    expect(() => mapBookkeepingDbError(raised('bookkeeping: something new'))).toThrow();
  });
});
