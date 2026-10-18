// Unit tests of Compliance & Deadlines: derived statuses, the recurring date engine and its
// holiday rule, calendar version comparison, applicability rules and the contract's guards.
import { describe, expect, it } from 'vitest';
import {
  CreateComplianceRecurrenceRequest,
  CreateComplianceDeadlineRequest,
  ImportComplianceCalendarRequest,
  PreviewRecurrenceRequest,
} from '@firmivra/types';
import { diffEntries, type DiffEntryData } from '../../src/compliance/compliance.diff.js';
import { atRiskClients } from '../../src/compliance/compliance.mappers.js';
import {
  adjustForHoliday,
  changePercent,
  csvCell,
  csvRow,
  displayStatusOf,
  federalHolidays,
  isoDay,
  occurrences,
  parseDay,
  type RepeatDefinition,
} from '../../src/compliance/compliance.shared.js';
import { decide } from '../../src/compliance/compliance-rules.service.js';

const d = parseDay;
const days = (list: { statutoryOn: Date; dueOn: Date }[]) =>
  list.map((o) => [isoDay(o.statutoryOn), isoDay(o.dueOn)]);

const base: RepeatDefinition = {
  frequency: 'MONTHLY',
  interval: null,
  repeatRule: { dayOfMonth: 15 },
  startOn: d('2026-01-01'),
  endMode: 'NEVER',
  endAfterCount: null,
  endOn: null,
  holidayRule: 'NONE',
};

describe('displayStatusOf', () => {
  const today = d('2026-10-15');
  const open = (dueOn: string, status = 'UPCOMING', extendedDueOn: string | null = null) => ({
    status,
    dueOn: d(dueOn),
    extendedDueOn: extendedDueOn ? d(extendedDueOn) : null,
  });

  it('derives Overdue and Due Soon from the date and the threshold, never from storage', () => {
    expect(displayStatusOf(open('2026-10-14'), today, 14)).toBe('OVERDUE');
    expect(displayStatusOf(open('2026-10-14', 'IN_PROGRESS'), today, 14)).toBe('OVERDUE');
    expect(displayStatusOf(open('2026-10-15'), today, 14)).toBe('DUE_SOON');
    expect(displayStatusOf(open('2026-10-29'), today, 14)).toBe('DUE_SOON');
    expect(displayStatusOf(open('2026-10-30'), today, 14)).toBe('UPCOMING');
    expect(displayStatusOf(open('2026-10-20'), today, 3)).toBe('UPCOMING');
  });

  it('keeps the stored status while on time, and the closed ones whatever the date', () => {
    expect(displayStatusOf(open('2026-10-16', 'IN_PROGRESS'), today, 14)).toBe('IN_PROGRESS');
    expect(displayStatusOf(open('2026-10-16', 'WAITING_ON_CLIENT'), today, 14)).toBe(
      'WAITING_ON_CLIENT',
    );
    for (const status of ['COMPLETED', 'NOT_APPLICABLE', 'CANCELLED']) {
      expect(displayStatusOf(open('2020-01-01', status), today, 14)).toBe(status);
    }
  });

  it('judges a deadline by its extended filing date', () => {
    expect(displayStatusOf(open('2026-10-01', 'UPCOMING', '2027-04-15'), today, 14)).toBe(
      'UPCOMING',
    );
    expect(displayStatusOf(open('2026-10-01', 'UPCOMING', '2026-10-10'), today, 14)).toBe(
      'OVERDUE',
    );
  });
});

describe('holidays', () => {
  it('knows the 2026 federal holidays by the day they are observed', () => {
    const h = federalHolidays(2026);
    for (const day of [
      '2026-01-01',
      '2026-01-19',
      '2026-02-16',
      '2026-05-25',
      '2026-06-19',
      '2026-07-03', // July 4 is a Saturday
      '2026-09-07',
      '2026-10-12',
      '2026-11-11',
      '2026-11-26',
      '2026-12-25',
    ]) {
      expect(h.has(day), day).toBe(true);
    }
    expect(h.has('2026-07-04')).toBe(false);
  });

  it('moves a weekend or holiday by the rule, and NONE leaves the date', () => {
    // Saturday Sep 5 2026: Monday Sep 7 is Labor Day, so the next business day is Tuesday.
    expect(isoDay(adjustForHoliday(d('2026-09-05'), 'NEXT_BUSINESS_DAY'))).toBe('2026-09-08');
    // Saturday Jul 4 2026 is observed on Friday Jul 3: the previous business day is Thursday.
    expect(isoDay(adjustForHoliday(d('2026-07-04'), 'PREVIOUS_BUSINESS_DAY'))).toBe('2026-07-02');
    expect(isoDay(adjustForHoliday(d('2026-09-05'), 'NONE'))).toBe('2026-09-05');
    expect(isoDay(adjustForHoliday(d('2026-10-15'), 'NEXT_BUSINESS_DAY'))).toBe('2026-10-15');
  });
});

describe('occurrences', () => {
  it('repeats monthly on a day, clamping to a short month', () => {
    const list = occurrences(
      { ...base, repeatRule: { dayOfMonth: 31 }, startOn: d('2026-01-01') },
      { count: 3 },
    );
    expect(days(list)).toEqual([
      ['2026-01-31', '2026-01-31'],
      ['2026-02-28', '2026-02-28'],
      ['2026-03-31', '2026-03-31'],
    ]);
  });

  it('repeats on the nth weekday, the last one being 5', () => {
    const second = occurrences({ ...base, repeatRule: { nth: 2, weekday: 2 } }, { count: 2 });
    expect(days(second).map((x) => x[0])).toEqual(['2026-01-13', '2026-02-10']);
    const last = occurrences({ ...base, repeatRule: { nth: 5, weekday: 5 } }, { count: 2 });
    expect(days(last).map((x) => x[0])).toEqual(['2026-01-30', '2026-02-27']);
  });

  it('follows a quarter rule: the day of the month after each quarter end', () => {
    const list = occurrences(
      {
        ...base,
        frequency: 'QUARTERLY',
        repeatRule: { monthsAfterQuarterEnd: 1, dayOfMonth: 30 },
        startOn: d('2026-02-01'),
      },
      { count: 3 },
    );
    expect(days(list).map((x) => x[0])).toEqual(['2026-04-30', '2026-07-30', '2026-10-30']);
  });

  it('repeats yearly and every N months', () => {
    const yearly = occurrences(
      { ...base, frequency: 'ANNUAL', repeatRule: { month: 4, day: 15 } },
      { count: 2 },
    );
    expect(days(yearly).map((x) => x[0])).toEqual(['2026-04-15', '2027-04-15']);
    const custom = occurrences(
      { ...base, frequency: 'CUSTOM', interval: 4, repeatRule: { dayOfMonth: 10 } },
      { count: 3 },
    );
    expect(days(custom).map((x) => x[0])).toEqual(['2026-01-10', '2026-05-10', '2026-09-10']);
  });

  it('keeps the statutory date when the holiday rule moves the due date', () => {
    const list = occurrences(
      {
        ...base,
        frequency: 'ANNUAL',
        repeatRule: { month: 9, day: 5 },
        holidayRule: 'NEXT_BUSINESS_DAY',
      },
      { count: 1 },
    );
    expect(days(list)).toEqual([['2026-09-05', '2026-09-08']]);
    expect(list[0]?.adjusted).toBe(true);
  });

  it('stops after a count or on a date, counting from the start', () => {
    expect(
      occurrences({ ...base, endMode: 'AFTER_COUNT', endAfterCount: 2 }, { count: 24 }),
    ).toHaveLength(2);
    const ending = occurrences(
      { ...base, endMode: 'ON_DATE', endOn: d('2026-03-15') },
      { count: 24 },
    );
    expect(days(ending).map((x) => x[0])).toEqual(['2026-01-15', '2026-02-15', '2026-03-15']);
    // Counting for "after N" starts at the first date, not at the first one still ahead.
    const later = occurrences(
      { ...base, endMode: 'AFTER_COUNT', endAfterCount: 3 },
      { count: 24, notBefore: d('2026-03-01') },
    );
    expect(days(later).map((x) => x[0])).toEqual(['2026-03-15']);
  });

  it('gives no dates for an authority-defined definition', () => {
    expect(
      occurrences({ ...base, frequency: 'AUTHORITY_DEFINED', repeatRule: {} }, { count: 3 }),
    ).toEqual([]);
  });
});

describe('diffEntries', () => {
  const entry = (name: string, dueOn: string | null, extra: Partial<DiffEntryData> = {}) => ({
    name,
    form: null,
    type: 'TAX_FILING',
    description: null,
    ruleKind: dueOn ? 'FIXED_DATE' : 'NEEDS_VERIFICATION',
    dueOn,
    rule: null,
    ...extra,
  });

  it('reports added, removed, changed and unchanged entries', () => {
    const rows = diffEntries(
      [
        entry('Form 1065', '2026-03-16'),
        entry('Form 1120', '2026-04-15'),
        entry('Old', '2026-01-01'),
      ],
      [
        entry('Form 1065', '2026-03-16'),
        entry('Form 1120', '2026-04-20'),
        entry('New', '2026-06-01'),
      ],
    );
    const by = Object.fromEntries(rows.map((r) => [(r.after ?? r.before)?.name, r.change]));
    expect(by).toEqual({
      'Form 1065': 'UNCHANGED',
      'Form 1120': 'CHANGED',
      Old: 'REMOVED',
      New: 'ADDED',
    });
  });

  it('pairs repeated names by date, then in date order', () => {
    const rows = diffEntries(
      [entry('Estimated tax', '2026-04-15'), entry('Estimated tax', '2026-06-15')],
      [entry('Estimated tax', '2026-04-15'), entry('Estimated tax', '2026-06-16')],
    );
    expect(rows.map((r) => r.change)).toEqual(['UNCHANGED', 'CHANGED']);
  });

  it('sees a changed type, description or formula', () => {
    const rows = diffEntries(
      [entry('A', null, { ruleKind: 'FORMULA', rule: { monthsAfterYearEnd: 3, day: 15 } })],
      [entry('A', null, { ruleKind: 'FORMULA', rule: { monthsAfterYearEnd: 3, day: 16 } })],
    );
    expect(rows[0]?.change).toBe('CHANGED');
  });
});

describe('decide (applicability)', () => {
  const rule = {
    name: 'S corp return',
    version: 2,
    entityTypes: ['S_CORPORATION'],
    states: ['GA'],
    services: [] as never[],
    excludeStatuses: ['INACTIVE'],
    priorYearLiabilityOverCents: null,
    criteria: {},
  };
  const client = (over: Partial<Parameters<typeof decide>[1]> = {}) => ({
    id: 'c1',
    displayName: 'Fake Client',
    clientNumber: 10001,
    accountType: 'BUSINESS',
    status: 'ACTIVE',
    profile: { entityType: 'S_CORPORATION', state: 'GA' },
    engagements: [],
    ...over,
  });

  it('matches by entity type and state, and says why with the rule version', () => {
    const r = decide(rule, client());
    expect(r.kind).toBe('MATCH');
    expect(r.kind === 'MATCH' && r.reason).toContain('v2');
  });

  it('does not match other entity types or states, and excludes statuses', () => {
    expect(decide(rule, client({ profile: { entityType: 'PARTNERSHIP', state: 'GA' } })).kind).toBe(
      'NO_MATCH',
    );
    expect(
      decide(rule, client({ profile: { entityType: 'S_CORPORATION', state: 'FL' } })).kind,
    ).toBe('NO_MATCH');
    expect(decide(rule, client({ status: 'INACTIVE' })).kind).toBe('EXCLUDED');
  });

  it('flags missing data for review instead of guessing', () => {
    expect(decide(rule, client({ profile: null })).kind).toBe('REVIEW');
    expect(
      decide(rule, client({ profile: { entityType: 'S_CORPORATION', state: null } })).kind,
    ).toBe('REVIEW');
    expect(decide({ ...rule, priorYearLiabilityOverCents: 100_000 }, client()).kind).toBe('REVIEW');
    expect(decide({ ...rule, criteria: { election: 'S' } }, client()).kind).toBe('REVIEW');
  });

  it('matches by service', () => {
    const withService = {
      ...rule,
      entityTypes: [],
      states: [],
      services: ['BOOKKEEPING' as const],
    };
    expect(
      decide(withService, client({ engagements: [{ service: { kind: 'BOOKKEEPING' } }] })).kind,
    ).toBe('MATCH');
    expect(decide(withService, client()).kind).toBe('NO_MATCH');
  });
});

describe('atRiskClients', () => {
  const today = d('2026-10-15');
  const ref = (id: string) => ({
    id,
    displayName: `Client ${id}`,
    clientNumber: 10001,
    accountType: 'BUSINESS' as const,
  });
  const row = (clientId: string, dueOn: string, status = 'UPCOMING', priority = 'MEDIUM') => ({
    clientId,
    client: ref(clientId),
    status,
    priority,
    dueOn: d(dueOn),
    extendedDueOn: null,
  });

  it('counts overdue, high-priority soon and waiting-on-client work, and ignores the rest', () => {
    const list = atRiskClients(
      [
        row('a', '2026-10-01'),
        row('a', '2026-10-30'),
        row('b', '2026-10-18', 'UPCOMING', 'HIGH'),
        row('c', '2026-10-17', 'WAITING_ON_CLIENT'),
        row('d', '2026-10-17'),
        row('e', '2026-10-30', 'UPCOMING', 'HIGH'),
        row('f', '2026-09-01', 'COMPLETED'),
      ],
      today,
      7,
    );
    expect(list.map((c) => c.client.id)).toEqual(['a', 'b', 'c']);
    expect(list[0]).toMatchObject({ overdueCount: 1, nextDueOn: '2026-10-30' });
    expect(list[1]).toMatchObject({ highPriorityUpcomingCount: 1 });
    expect(list[2]).toMatchObject({ waitingOnClientCount: 1 });
  });
});

describe('figures and CSV', () => {
  it('gives no change when there is nothing to compare', () => {
    expect(changePercent(5, null)).toBeNull();
    expect(changePercent(5, 0)).toBeNull();
    expect(changePercent(12, 10)).toBe(20);
  });

  it('keeps a spreadsheet from running a cell as a formula', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell(5)).toBe('5');
    expect(csvRow(['a,b', null, 'c'])).toBe('"a,b",,c');
  });
});

describe('the contract', () => {
  const deadline = {
    clientId: crypto.randomUUID(),
    name: 'Q3 estimate',
    type: 'ESTIMATED_TAX',
    dueOn: '2026-09-15',
  };

  it('takes a deadline with defaults, and refuses a task template without a task', () => {
    const ok = CreateComplianceDeadlineRequest.parse(deadline);
    expect(ok).toMatchObject({
      source: 'FIRM',
      priority: 'MEDIUM',
      status: 'UPCOMING',
      createTask: false,
    });
    expect(
      CreateComplianceDeadlineRequest.safeParse({
        ...deadline,
        taskTemplateId: crypto.randomUUID(),
      }).success,
    ).toBe(false);
    expect(
      CreateComplianceDeadlineRequest.safeParse({ ...deadline, status: 'COMPLETED' }).success,
    ).toBe(false);
    expect(CreateComplianceDeadlineRequest.safeParse({ ...deadline, extra: 1 }).success).toBe(
      false,
    );
  });

  it('refuses two reminders for the same day, and one with no way to remind', () => {
    const r = (reminders: unknown) =>
      CreateComplianceDeadlineRequest.safeParse({ ...deadline, reminders }).success;
    expect(r([{ daysBefore: 7 }, { daysBefore: 1, channels: ['EMAIL'] }])).toBe(true);
    expect(r([{ daysBefore: 7 }, { daysBefore: 7 }])).toBe(false);
    expect(r([{ daysBefore: 7, inApp: false }])).toBe(false);
  });

  const rec = {
    name: 'Form 941',
    type: 'PAYROLL',
    frequency: 'QUARTERLY',
    repeatRule: { monthsAfterQuarterEnd: 1, dayOfMonth: 30 },
    startOn: '2026-01-01',
  };

  it('checks a recurring definition as the database does', () => {
    const ok = (over: object) =>
      CreateComplianceRecurrenceRequest.safeParse({ ...rec, ...over }).success;
    expect(ok({})).toBe(true);
    expect(ok({ repeatRule: { dayOfMonth: 15 } })).toBe(false); // does not fit a quarter
    expect(ok({ frequency: 'CUSTOM', repeatRule: { dayOfMonth: 5 } })).toBe(false); // no interval
    expect(ok({ frequency: 'CUSTOM', interval: 2, repeatRule: { dayOfMonth: 5 } })).toBe(true);
    expect(ok({ interval: 2 })).toBe(false);
    expect(ok({ startOn: undefined })).toBe(false);
    expect(ok({ startOn: undefined, isTemplate: true })).toBe(true);
    expect(ok({ endMode: 'AFTER_COUNT' })).toBe(false);
    expect(ok({ endMode: 'ON_DATE', endOn: '2025-12-31' })).toBe(false);
    expect(ok({ remindClient: true })).toBe(false);
    expect(ok({ remindClient: true, clientVisible: true })).toBe(true);
    expect(ok({ taskTemplateId: crypto.randomUUID() })).toBe(false);
  });

  it('previews without a start and caps the count', () => {
    expect(
      PreviewRecurrenceRequest.safeParse({ frequency: 'ANNUAL', repeatRule: { month: 4, day: 15 } })
        .success,
    ).toBe(true);
    expect(
      PreviewRecurrenceRequest.safeParse({
        frequency: 'ANNUAL',
        repeatRule: { month: 4, day: 15 },
        count: 25,
      }).success,
    ).toBe(false);
  });

  it('imports a calendar with fixed dates, formulas and unknown dates, and never invents one', () => {
    const cal = {
      family: 'IRS_GENERAL',
      authority: 'IRS',
      jurisdiction: 'FEDERAL',
      effectiveYear: 2026,
      name: 'IRS 2026',
      sourceUrl: 'https://www.irs.gov/publications/p509',
      entries: [
        { ruleKind: 'FIXED_DATE', name: 'Form 1040', type: 'TAX_FILING', dueOn: '2026-04-15' },
        {
          ruleKind: 'FORMULA',
          name: 'Form 1065',
          type: 'TAX_FILING',
          rule: { monthsAfterYearEnd: 3, day: 15 },
        },
        { ruleKind: 'NEEDS_VERIFICATION', name: 'Form X', type: 'TAX_FILING' },
      ],
    };
    const ok = (over: object) =>
      ImportComplianceCalendarRequest.safeParse({ ...cal, ...over }).success;
    expect(ok({})).toBe(true);
    expect(ok({ sourceUrl: 'http://example.com' })).toBe(false);
    expect(ok({ state: 'GA' })).toBe(false); // federal
    expect(ok({ entries: [{ ruleKind: 'FIXED_DATE', name: 'A', type: 'TAX_FILING' }] })).toBe(
      false,
    );
    expect(
      ok({
        entries: [
          { ruleKind: 'NEEDS_VERIFICATION', name: 'A', type: 'TAX_FILING', dueOn: '2026-01-01' },
        ],
      }),
    ).toBe(false);
    expect(
      ok({
        entries: [
          { ruleKind: 'FIXED_DATE', name: 'A', type: 'TAX_FILING', dueOn: '2026-04-15' },
          { ruleKind: 'FIXED_DATE', name: 'A', type: 'TAX_FILING', dueOn: '2026-04-15' },
        ],
      }),
    ).toBe(false);
  });
});
