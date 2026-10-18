import {
  type ComplianceApplicabilityRule,
  ComplianceApplicabilityRulesQuery,
  type ComplianceCalendar,
  type ComplianceCalendarDiff,
  type ComplianceCalendarEntry,
  ComplianceCalendarEntryInput,
  type ComplianceCalendarRow,
  ComplianceCalendarsQuery,
  type ComplianceClient,
  type ComplianceDeadline,
  type ComplianceDiffEntry,
  ComplianceLogsQuery,
  type ComplianceRecurrence,
  ComplianceRecurrencesQuery,
  type ComplianceRepeatRule,
  ComplianceSuggestionsQuery,
  ConfirmSuggestionRequest,
  CreateApplicabilityRuleRequest,
  CreateComplianceRecurrenceRequest,
  DismissSuggestionRequest,
  GenerateSuggestionsRequest,
  ImportComplianceCalendarRequest,
  parseInput,
  PreviewRecurrenceRequest,
  UpdateApplicabilityRuleRequest,
  UpdateComplianceCalendarEntryRequest,
  UpdateComplianceCalendarRequest,
  UpdateComplianceRecurrenceRequest,
  UpdateComplianceSettingsRequest,
} from '@firmivra/types';
import { mockMe } from './appointments';
import {
  CLIENTS,
  type MockRole,
  type Store,
  blankDeadline,
  copy,
  daysBetween,
  fail,
  fresh,
  iso,
  memberOf,
  nowIso,
  plus,
  today,
  uuid,
} from './compliance-base';

/** The library half of the Compliance mock: calendars, recurrences, rules, suggestions, logs, settings. */

type Shape = Pick<
  ComplianceRecurrence,
  | 'frequency'
  | 'interval'
  | 'repeatRule'
  | 'startOn'
  | 'endMode'
  | 'endAfterCount'
  | 'endOn'
  | 'holidayRule'
>;
interface Occurrence {
  statutoryOn: string;
  dueOn: string;
  adjusted: boolean;
}

const utc = (y: number, m: number, d: number) => Date.UTC(y, m, d, 12);
const clampDay = (y: number, m: number, d: number) =>
  Math.min(d, new Date(Date.UTC(y, m + 1, 0)).getUTCDate());

function nthWeekday(y: number, m: number, nth: number, weekday: number): number {
  const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
  const day = 1 + ((weekday - first + 7) % 7) + (nth - 1) * 7;
  return day > new Date(Date.UTC(y, m + 1, 0)).getUTCDate() ? day - 7 : day;
}

function statutory(shape: Shape, y: number, m: number): string | null {
  const r = shape.repeatRule as Record<string, number>;
  if (shape.frequency === 'ANNUAL') {
    return m === (r['month'] ?? 1) - 1 ? iso(utc(y, m, clampDay(y, m, r['day'] ?? 1))) : null;
  }
  if (shape.frequency === 'QUARTERLY') {
    const after = r['monthsAfterQuarterEnd'] ?? 0;
    return (m - after + 12) % 3 === 2
      ? iso(utc(y, m, clampDay(y, m, r['dayOfMonth'] ?? 15)))
      : null;
  }
  if (shape.frequency === 'MONTHLY' || shape.frequency === 'CUSTOM') {
    if (r['nth']) return iso(utc(y, m, nthWeekday(y, m, r['nth'], r['weekday'] ?? 1)));
    return iso(utc(y, m, clampDay(y, m, r['dayOfMonth'] ?? 15)));
  }
  return null;
}

/** The next dates of a recurrence, as the API calculates them: weekends moved by the holiday rule. */
export function occurrencesOf(shape: Shape, count: number, from = today()): Occurrence[] {
  if (shape.frequency === 'AUTHORITY_DEFINED') return [];
  const start = shape.startOn ?? from;
  const [sy = 2000, sm = 1] = start.split('-').map(Number);
  const out: Occurrence[] = [];
  const step = shape.frequency === 'CUSTOM' ? (shape.interval ?? 1) : 1;
  let made = 0;
  for (let i = 0; i < 600 && out.length < count; i += 1) {
    const month = sm - 1 + i;
    const y = sy + Math.floor(month / 12);
    const m = ((month % 12) + 12) % 12;
    if (i % step !== 0) continue;
    const on = statutory(shape, y, m);
    if (!on || on < start) continue;
    if (shape.endMode === 'ON_DATE' && shape.endOn && on > shape.endOn) break;
    if (shape.endMode === 'AFTER_COUNT' && made >= (shape.endAfterCount ?? 0)) break;
    made += 1;
    const day = new Date(`${on}T12:00:00Z`).getUTCDay();
    const move =
      shape.holidayRule === 'NEXT_BUSINESS_DAY'
        ? day === 6
          ? 2
          : day === 0
            ? 1
            : 0
        : shape.holidayRule === 'PREVIOUS_BUSINESS_DAY'
          ? day === 6
            ? -1
            : day === 0
              ? -2
              : 0
          : 0;
    out.push({ statutoryOn: on, dueOn: plus(on, move), adjusted: move !== 0 });
  }
  return out;
}

const year = () => new Date().getUTCFullYear();
const entryId = (n: number) => uuid('6e00', n);
const calId = (n: number) => uuid('6c00', n);

function entry(
  n: number,
  name: string,
  type: ComplianceCalendarEntry['type'],
  form: string | null,
  rule: { dueOn: string } | { rule: { monthsAfterYearEnd: number; day: number } } | null,
  description: string | null = null,
): ComplianceCalendarEntry {
  return {
    id: entryId(n),
    name,
    type,
    form,
    description,
    ruleKind: rule === null ? 'NEEDS_VERIFICATION' : 'dueOn' in rule ? 'FIXED_DATE' : 'FORMULA',
    dueOn: rule && 'dueOn' in rule ? rule.dueOn : null,
    rule: rule && 'rule' in rule ? rule.rule : null,
  };
}

const rowOf = (c: ComplianceCalendar): ComplianceCalendarRow => {
  const { entries, ...row } = c;
  return {
    ...row,
    entryCount: entries.length,
    needsVerificationCount: entries.filter((e) => e.ruleKind === 'NEEDS_VERIFICATION').length,
  };
};

function calendarAt(
  n: number,
  fields: Partial<ComplianceCalendar> &
    Pick<ComplianceCalendar, 'name' | 'family' | 'authority' | 'entries'>,
): ComplianceCalendar {
  const at = nowIso();
  const c: ComplianceCalendar = {
    id: calId(n),
    jurisdiction: 'FEDERAL',
    state: null,
    effectiveYear: year(),
    version: 1,
    sourceUrl: 'https://www.irs.gov/publications/p509',
    retrievedAt: at,
    verifiedAt: at,
    status: 'PUBLISHED',
    publishedAt: at,
    entryCount: 0,
    needsVerificationCount: 0,
    stale: false,
    createdAt: at,
    ...fields,
  };
  return { ...c, ...rowOf(c), entries: c.entries };
}

type Library = Pick<Store, 'calendars' | 'recurrences' | 'rules' | 'suggestions' | 'logs'>;

export function seedLibrary(empty: boolean): Library {
  if (empty) return { calendars: [], recurrences: [], rules: [], suggestions: [], logs: [] };
  const y = year();
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const calendars = [
    calendarAt(1, {
      name: `IRS Tax Calendar ${y}`,
      family: 'IRS_GENERAL',
      authority: 'IRS',
      entries: [
        entry(1, 'Form 1065 Partnership Return', 'TAX_FILING', '1065', {
          rule: { monthsAfterYearEnd: 3, day: 15 },
        }),
        entry(2, 'Form 1120-S S Corporation Return', 'TAX_FILING', '1120-S', {
          rule: { monthsAfterYearEnd: 3, day: 15 },
        }),
        entry(3, 'Form 1040 Individual Return', 'TAX_FILING', '1040', {
          rule: { monthsAfterYearEnd: 4, day: 15 },
        }),
        entry(4, 'Form 1120 C Corporation Return', 'TAX_FILING', '1120', {
          rule: { monthsAfterYearEnd: 4, day: 15 },
        }),
        entry(5, 'Estimated Tax Q3', 'ESTIMATED_TAX', '1040-ES', { dueOn: `${y}-09-15` }),
        entry(6, 'Estimated Tax Q4', 'ESTIMATED_TAX', '1040-ES', { dueOn: `${y + 1}-01-15` }),
      ],
      verifiedAt: ago(40),
    }),
    calendarAt(2, {
      name: `IRS Employer Calendar ${y}`,
      family: 'IRS_EMPLOYER',
      authority: 'IRS',
      sourceUrl: 'https://www.irs.gov/publications/p15',
      entries: [
        entry(7, 'Form 941 Q3', 'PAYROLL', '941', { dueOn: `${y}-11-02` }),
        entry(8, 'Form 941 Q4', 'PAYROLL', '941', { dueOn: `${y + 1}-02-01` }),
        entry(9, 'Form 940 Annual', 'PAYROLL', '940', { dueOn: `${y + 1}-02-01` }),
      ],
      verifiedAt: ago(40),
    }),
    calendarAt(3, {
      name: `Georgia Annual Registration ${y}`,
      family: 'SECRETARY_OF_STATE',
      authority: 'Georgia Secretary of State',
      jurisdiction: 'STATE',
      state: 'GA',
      sourceUrl: 'https://sos.ga.gov/how-to-guide/how-file-annual-registration',
      entries: [entry(10, 'Annual Registration', 'ANNUAL_REPORT', null, { dueOn: `${y}-04-01` })],
      verifiedAt: ago(260),
      retrievedAt: ago(260),
      stale: true,
    }),
    calendarAt(4, {
      name: `North Carolina Annual Report ${y}`,
      family: 'SECRETARY_OF_STATE',
      authority: 'North Carolina Secretary of State',
      jurisdiction: 'STATE',
      state: 'NC',
      sourceUrl: 'https://www.sosnc.gov/divisions/business_registration/annual_report_due_dates',
      status: 'DRAFT',
      publishedAt: null,
      verifiedAt: null,
      entries: [
        entry(11, 'LLC Annual Report', 'ANNUAL_REPORT', null, { dueOn: `${y}-04-15` }),
        entry(
          12,
          'Corporation Annual Report',
          'ANNUAL_REPORT',
          null,
          null,
          'Date not yet verified.',
        ),
      ],
    }),
    calendarAt(5, {
      name: `IRS Tax Calendar ${y - 1}`,
      family: 'IRS_GENERAL',
      authority: 'IRS',
      effectiveYear: y - 1,
      status: 'SUPERSEDED',
      entries: [
        entry(13, 'Form 1040 Individual Return', 'TAX_FILING', '1040', {
          rule: { monthsAfterYearEnd: 4, day: 15 },
        }),
      ],
      verifiedAt: ago(400),
    }),
  ];
  const monthlyShape = {
    frequency: 'MONTHLY',
    interval: null,
    repeatRule: { dayOfMonth: 15 },
    startOn: plus(today(), -60),
    endMode: 'NEVER',
    endAfterCount: null,
    endOn: null,
    holidayRule: 'NEXT_BUSINESS_DAY',
  } as const;
  const quarterShape = {
    frequency: 'QUARTERLY',
    interval: null,
    repeatRule: { monthsAfterQuarterEnd: 1, dayOfMonth: 30 },
    startOn: plus(today(), -90),
    endMode: 'NEVER',
    endAfterCount: null,
    endOn: null,
    holidayRule: 'NEXT_BUSINESS_DAY',
  } as const;
  const annualShape = {
    frequency: 'ANNUAL',
    interval: null,
    repeatRule: { month: 4, day: 1 },
    startOn: `${y - 1}-04-01`,
    endMode: 'NEVER',
    endAfterCount: null,
    endOn: null,
    holidayRule: 'NONE',
  } as const;
  const rec = (
    n: number,
    name: string,
    type: ComplianceRecurrence['type'],
    shape: Shape,
    fields: Partial<ComplianceRecurrence> = {},
  ): ComplianceRecurrence => ({
    id: uuid('3e00', n),
    name,
    type,
    description: null,
    agency: 'IRS',
    relatedForm: null,
    jurisdiction: 'FEDERAL',
    state: null,
    calendarEntry: null,
    ...shape,
    isTemplate: false,
    createTask: true,
    taskTemplateId: null,
    assignedTo: mockMe,
    clientVisible: false,
    remindClient: false,
    addToTaxCalendar: true,
    notifyTeam: true,
    reminders: [{ daysBefore: 7, inApp: true, channels: ['EMAIL'] }],
    sendPastDueNotice: false,
    escalateToManager: false,
    status: 'ACTIVE',
    pausedAt: null,
    endedAt: null,
    nextDueOn: occurrencesOf(shape, 1)[0]?.dueOn ?? null,
    deadlineCount: 4,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...fields,
  });
  const recurrences = [
    rec(1, 'Monthly Payroll Tax Deposit', 'PAYROLL', monthlyShape, { relatedForm: '941' }),
    rec(2, 'Quarterly Payroll Return (Form 941)', 'PAYROLL', quarterShape, {
      relatedForm: '941',
      deadlineCount: 6,
    }),
    rec(3, 'Georgia Annual Registration', 'ANNUAL_REPORT', annualShape, {
      agency: 'GA Secretary of State',
      jurisdiction: 'STATE',
      state: 'GA',
      status: 'PAUSED',
      pausedAt: ago(10),
      nextDueOn: null,
      deadlineCount: 1,
    }),
    rec(
      4,
      'Monthly Sales Tax Return',
      'SALES_TAX',
      { ...monthlyShape, startOn: null },
      {
        isTemplate: true,
        agency: 'State Department of Revenue',
        jurisdiction: 'STATE',
        nextDueOn: null,
        deadlineCount: 0,
      },
    ),
  ];
  const rules: ComplianceApplicabilityRule[] = [
    {
      id: uuid('7a00', 1),
      name: 'Partnership and multi-member LLC return',
      target: { kind: 'CALENDAR_ENTRY', id: entryId(1), name: 'Form 1065 Partnership Return' },
      outcome: 'SUGGEST',
      entityTypes: ['Partnership', 'Multi-member LLC'],
      states: [],
      services: ['ANNUAL_TAX'],
      excludeStatuses: ['Dissolved'],
      priorYearLiabilityOverCents: null,
      criteria: {},
      active: true,
      version: 1,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: uuid('7a00', 2),
      name: 'Georgia annual registration',
      target: { kind: 'CALENDAR_ENTRY', id: entryId(10), name: 'Annual Registration' },
      outcome: 'APPLY',
      entityTypes: ['LLC', 'Corporation'],
      states: ['GA'],
      services: [],
      excludeStatuses: [],
      priorYearLiabilityOverCents: null,
      criteria: {},
      active: true,
      version: 2,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  ];
  const sug = (
    n: number,
    client: number,
    rule: number,
    name: string,
    offset: number,
    decision: 'SUGGESTED' | 'NEEDS_REVIEW',
    reason: string,
  ) => ({
    id: uuid('8b00', n),
    client: CLIENTS[client]!,
    rule: { id: rules[rule]!.id, name: rules[rule]!.name, version: rules[rule]!.version },
    name,
    dueOn: plus(today(), offset),
    decision,
    reason,
    deadlineId: null,
    decidedBy: null,
    decidedAt: null,
    createdAt: nowIso(),
  });
  const suggestions = [
    sug(
      1,
      2,
      0,
      'Form 1065 Partnership Return',
      30,
      'SUGGESTED',
      'Multi-member LLC taxed as a partnership.',
    ),
    sug(2, 3, 1, 'Annual Registration', 45, 'SUGGESTED', 'Georgia LLC.'),
    sug(
      3,
      4,
      0,
      'Form 1065 Partnership Return',
      30,
      'NEEDS_REVIEW',
      'The entity type is missing on the client.',
    ),
  ];
  const logs = (
    [
      ['IMPORT', 'SUCCESS', `Imported IRS Tax Calendar ${y} (6 entries).`, 41, 1],
      ['VERIFY', 'SUCCESS', `Verified IRS Tax Calendar ${y}.`, 40, 1],
      ['PUBLISH', 'SUCCESS', `Published IRS Tax Calendar ${y}.`, 40, 1],
      [
        'IMPORT',
        'FAILED',
        'The Florida calendar had no entries. The last published version was kept.',
        12,
        3,
      ],
      [
        'GENERATE',
        'SUCCESS',
        'Generated 3 suggestions from “Partnership and multi-member LLC return”.',
        5,
        1,
      ],
      ['OVERRIDE', 'SUCCESS', 'Date changed on Form 941 Quarterly Payroll Return.', 2, 1],
    ] as const
  ).map(([kind, outcome, message, days, c], i) => ({
    id: uuid('4f00', i + 1),
    kind,
    outcome,
    message,
    calendarId: c === 3 ? null : calId(c),
    deadlineId: null,
    recurrenceId: null,
    details: {},
    actor: mockMe,
    createdAt: ago(days),
  }));
  return { calendars, recurrences, rules, suggestions, logs };
}

const page = <T>(rows: T[], q: { page?: number; pageSize?: number }) => {
  const size = q.pageSize ?? 25;
  const at = q.page ?? 1;
  return {
    items: rows.slice((at - 1) * size, at * size),
    total: rows.length,
    page: at,
    pageSize: size,
  };
};

interface Context {
  store: Store;
  role: MockRole;
  id: (block: string) => string;
  log: (
    kind: Store['logs'][number]['kind'],
    outcome: Store['logs'][number]['outcome'],
    message: string,
    extra?: Partial<Store['logs'][number]>,
  ) => unknown;
  run: <T>(work: () => T) => Promise<T>;
  staffBlocked: () => void;
  live: () => ComplianceDeadline[];
}

const entryKey = (e: { name: string; form: string | null }) => `${e.name}|${e.form ?? ''}`;
const side = (e: ComplianceCalendarEntry) => ({
  type: e.type,
  description: e.description,
  ruleKind: e.ruleKind,
  dueOn: e.dueOn,
  rule: e.rule,
});
const same = (a: ComplianceCalendarEntry, b: ComplianceCalendarEntry) =>
  JSON.stringify(side(a)) === JSON.stringify(side(b));

function diffOf(
  from: ComplianceCalendar | null,
  to: Pick<ComplianceCalendar, 'entries'> & Partial<ComplianceCalendar>,
  deadlines: ComplianceDeadline[],
): ComplianceCalendarDiff {
  const before = new Map((from?.entries ?? []).map((e) => [entryKey(e), e]));
  const after = new Map(to.entries.map((e) => [entryKey(e), e]));
  const entries: ComplianceDiffEntry[] = [];
  for (const [key, e] of after) {
    const old = before.get(key);
    const overridden = deadlines.filter(
      (d) => d.calendarEntry?.id === old?.id && d.dueOverridden,
    ).length;
    entries.push({
      change: !old ? 'ADDED' : same(old, e) ? 'UNCHANGED' : 'CHANGED',
      name: e.name,
      form: e.form,
      before: old ? side(old) : null,
      after: side(e),
      overriddenDeadlines: old && !same(old, e) ? overridden : 0,
    });
  }
  for (const [key, e] of before) {
    if (!after.has(key)) {
      entries.push({
        change: 'REMOVED',
        name: e.name,
        form: e.form,
        before: side(e),
        after: null,
        overriddenDeadlines: 0,
      });
    }
  }
  const count = (c: ComplianceDiffEntry['change']) => entries.filter((e) => e.change === c).length;
  const ref = (c: Partial<ComplianceCalendar> | null | undefined) =>
    c && c.id && c.name && c.version && c.status && c.effectiveYear
      ? {
          id: c.id,
          name: c.name,
          version: c.version,
          status: c.status,
          effectiveYear: c.effectiveYear,
        }
      : null;
  return {
    from: ref(from),
    to: ref(to),
    counts: {
      added: count('ADDED'),
      changed: count('CHANGED'),
      removed: count('REMOVED'),
      unchanged: count('UNCHANGED'),
    },
    conflicts: entries.reduce((n, e) => n + e.overriddenDeadlines, 0),
    entries,
  };
}

export function createLibraryMock(ctx: Context) {
  const { store, id, log, run, staffBlocked } = ctx;

  const calendar = (calendarId: string) => {
    const c = store.calendars.find((x) => x.id === calendarId);
    if (!c) throw fail(404, 'NOT_FOUND', 'That calendar was not found.');
    return c;
  };
  const sameKey = (a: ComplianceCalendar, b: ComplianceCalendar) =>
    a.family === b.family &&
    a.authority === b.authority &&
    a.effectiveYear === b.effectiveYear &&
    a.state === b.state;
  const sync = (c: ComplianceCalendar) => {
    Object.assign(c, rowOf(c));
    return c;
  };
  const draftOnly = (c: ComplianceCalendar) => {
    if (c.status !== 'DRAFT') {
      throw fail(409, 'CALENDAR_STATE', 'Only a draft calendar can be edited.');
    }
  };
  const recurrence = (recurrenceId: string) => {
    const r = store.recurrences.find((x) => x.id === recurrenceId);
    if (!r) throw fail(404, 'NOT_FOUND', 'That recurring deadline was not found.');
    return r;
  };
  const rule = (ruleId: string) => {
    const r = store.rules.find((x) => x.id === ruleId);
    if (!r) throw fail(404, 'NOT_FOUND', 'That rule was not found.');
    return r;
  };
  const targetName = (t: { kind: 'CALENDAR_ENTRY' | 'RECURRENCE'; id: string }) => {
    const name =
      t.kind === 'RECURRENCE'
        ? store.recurrences.find((r) => r.id === t.id)?.name
        : store.calendars.flatMap((c) => c.entries).find((e) => e.id === t.id)?.name;
    if (!name) throw fail(404, 'NOT_FOUND', 'That rule target was not found.');
    return name;
  };
  const nextOf = (r: ComplianceRecurrence) => {
    r.nextDueOn =
      r.status === 'ACTIVE' && !r.isTemplate ? (occurrencesOf(r, 1)[0]?.dueOn ?? null) : null;
    r.updatedAt = nowIso();
    return r;
  };
  const assignee = (userId: string | null | undefined) => {
    if (userId && !memberOf(userId)) {
      throw fail(409, 'NOT_A_MEMBER', 'That person is not on your team.');
    }
    return memberOf(userId);
  };

  const templateFrom = (d: ComplianceDeadline, name: string): ComplianceRecurrence => {
    if (store.recurrences.some((r) => r.name === name)) {
      throw fail(409, 'DUPLICATE', 'A template with this name already exists.');
    }
    const [, month = '1', day = '1'] = d.dueOn.split('-');
    const r: ComplianceRecurrence = {
      id: id('3e00'),
      name,
      type: d.type,
      description: d.description,
      agency: d.agency,
      relatedForm: d.relatedForm,
      jurisdiction: d.jurisdiction,
      state: d.state,
      calendarEntry: null,
      frequency: 'ANNUAL',
      interval: null,
      repeatRule: { month: Number(month), day: Number(day) },
      startOn: null,
      endMode: 'NEVER',
      endAfterCount: null,
      endOn: null,
      holidayRule: 'NEXT_BUSINESS_DAY',
      isTemplate: true,
      createTask: d.createTask,
      taskTemplateId: d.taskTemplateId,
      assignedTo: d.assignedTo,
      clientVisible: d.clientVisible,
      remindClient: false,
      addToTaxCalendar: true,
      notifyTeam: false,
      reminders: d.reminders,
      sendPastDueNotice: false,
      escalateToManager: false,
      status: 'ACTIVE',
      pausedAt: null,
      endedAt: null,
      nextDueOn: null,
      deadlineCount: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    store.recurrences.unshift(r);
    return r;
  };

  const clientsFor = (r: ComplianceApplicabilityRule) =>
    CLIENTS.filter((c) =>
      r.entityTypes.length === 0
        ? true
        : c.accountType === 'BUSINESS' || r.entityTypes.includes('Individual'),
    );

  const methods: Pick<
    ComplianceClient,
    | 'calendars'
    | 'importCalendar'
    | 'previewImport'
    | 'getCalendar'
    | 'updateCalendar'
    | 'compareCalendars'
    | 'verifyCalendar'
    | 'publishCalendar'
    | 'rollbackCalendar'
    | 'archiveCalendar'
    | 'addEntry'
    | 'updateEntry'
    | 'deleteEntry'
    | 'recurrences'
    | 'createRecurrence'
    | 'previewRecurrence'
    | 'getRecurrence'
    | 'updateRecurrence'
    | 'pauseRecurrence'
    | 'resumeRecurrence'
    | 'endRecurrence'
    | 'archiveRecurrence'
    | 'rules'
    | 'createRule'
    | 'getRule'
    | 'updateRule'
    | 'evaluateRule'
    | 'suggestions'
    | 'generateSuggestions'
    | 'confirmSuggestion'
    | 'dismissSuggestion'
    | 'logs'
    | 'settings'
    | 'updateSettings'
  > = {
    calendars: (query = {}) =>
      run(() => {
        const q = parseInput(ComplianceCalendarsQuery, query);
        const term = q.search?.toLowerCase();
        const rows = store.calendars
          .filter(
            (c) =>
              (!q.status || c.status === q.status) &&
              (!q.family || c.family === q.family) &&
              (!q.year || c.effectiveYear === q.year) &&
              (!q.state || c.state === q.state) &&
              (!term ||
                c.name.toLowerCase().includes(term) ||
                c.authority.toLowerCase().includes(term)),
          )
          .map(rowOf);
        return page(rows, q);
      }),
    importCalendar: (body) =>
      run(() => {
        staffBlocked();
        const input = parseInput(ImportComplianceCalendarRequest, body);
        if (input.entries.length === 0) {
          log(
            'IMPORT',
            'FAILED',
            `The ${input.name} import had no entries. The last published version was kept.`,
          );
          throw fail(409, 'NO_ENTRIES', 'The import has no entries.');
        }
        const earlier = store.calendars.filter(
          (c) =>
            c.family === input.family &&
            c.authority === input.authority &&
            c.effectiveYear === input.effectiveYear &&
            (c.state ?? null) === (input.state ?? null),
        );
        const c = calendarAt(Number(id('6c00').slice(-12)), {
          name: input.name,
          family: input.family,
          authority: input.authority,
          jurisdiction: input.jurisdiction,
          state: input.state ?? null,
          effectiveYear: input.effectiveYear,
          sourceUrl: input.sourceUrl,
          retrievedAt: input.retrievedAt ?? nowIso(),
          status: 'DRAFT',
          publishedAt: null,
          verifiedAt: null,
          version: earlier.length + 1,
          entries: input.entries.map((e) => ({
            id: id('6e00'),
            name: e.name,
            type: e.type,
            form: e.form ?? null,
            description: e.description ?? null,
            ruleKind: e.ruleKind,
            dueOn: e.ruleKind === 'FIXED_DATE' ? e.dueOn : null,
            rule: e.ruleKind === 'FORMULA' ? e.rule : null,
          })),
        });
        store.calendars.unshift(c);
        log('IMPORT', 'SUCCESS', `Imported ${c.name} (${c.entries.length} entries).`, {
          calendarId: c.id,
        });
        return sync(c);
      }),
    previewImport: (body) =>
      run(() => {
        const input = parseInput(ImportComplianceCalendarRequest, body);
        const published = store.calendars.find(
          (c) =>
            c.status === 'PUBLISHED' &&
            c.family === input.family &&
            c.authority === input.authority &&
            c.effectiveYear === input.effectiveYear,
        );
        const incoming = input.entries.map((e, i) => ({
          id: uuid('6e00', 900 + i),
          name: e.name,
          type: e.type,
          form: e.form ?? null,
          description: e.description ?? null,
          ruleKind: e.ruleKind,
          dueOn: e.ruleKind === 'FIXED_DATE' ? e.dueOn : null,
          rule: e.ruleKind === 'FORMULA' ? e.rule : null,
        }));
        return diffOf(
          published ?? null,
          {
            entries: incoming,
            name: input.name,
            version: (published?.version ?? 0) + 1,
            status: 'DRAFT',
            effectiveYear: input.effectiveYear,
            id: uuid('6c00', 999),
          },
          ctx.live(),
        );
      }),
    getCalendar: (calendarId) => run(() => sync(calendar(calendarId))),
    updateCalendar: (calendarId, body) =>
      run(() => {
        staffBlocked();
        const input = parseInput(UpdateComplianceCalendarRequest, body);
        const c = calendar(calendarId);
        if (c.status === 'SUPERSEDED' || c.status === 'ARCHIVED') {
          throw fail(409, 'CALENDAR_STATE', 'This calendar is closed.');
        }
        Object.assign(c, input);
        return sync(c);
      }),
    compareCalendars: (calendarId, otherId) =>
      run(() => diffOf(calendar(calendarId), calendar(otherId), ctx.live())),
    verifyCalendar: (calendarId) =>
      run(() => {
        staffBlocked();
        const c = calendar(calendarId);
        if (c.status !== 'DRAFT')
          throw fail(409, 'CALENDAR_STATE', 'Only a draft can be verified.');
        if (c.entries.some((e) => e.ruleKind === 'NEEDS_VERIFICATION')) {
          throw fail(409, 'ENTRIES_NEED_VERIFICATION', 'Some entries still need a verified date.');
        }
        c.status = 'VERIFIED';
        c.verifiedAt = nowIso();
        log('VERIFY', 'SUCCESS', `Verified ${c.name}.`, { calendarId: c.id });
        return sync(c);
      }),
    publishCalendar: (calendarId) =>
      run(() => {
        staffBlocked();
        const c = calendar(calendarId);
        if (c.status !== 'VERIFIED')
          throw fail(409, 'CALENDAR_STATE', 'Verify the calendar before publishing.');
        if (c.entries.length === 0) throw fail(409, 'NO_ENTRIES', 'The calendar has no entries.');
        for (const o of store.calendars) {
          if (o.id !== c.id && o.status === 'PUBLISHED' && sameKey(o, c)) o.status = 'SUPERSEDED';
        }
        c.status = 'PUBLISHED';
        c.publishedAt = nowIso();
        c.stale = false;
        log('PUBLISH', 'SUCCESS', `Published ${c.name}.`, { calendarId: c.id });
        return sync(c);
      }),
    rollbackCalendar: (calendarId) =>
      run(() => {
        staffBlocked();
        const c = calendar(calendarId);
        if (c.status !== 'PUBLISHED')
          throw fail(409, 'CALENDAR_STATE', 'Only the published version can be rolled back.');
        const prior = store.calendars
          .filter((o) => o.id !== c.id && o.status === 'SUPERSEDED' && sameKey(o, c))
          .sort((a, b) => b.version - a.version)[0];
        if (!prior) throw fail(409, 'CALENDAR_STATE', 'There is no earlier version to return to.');
        c.status = 'ARCHIVED';
        prior.status = 'PUBLISHED';
        prior.publishedAt = nowIso();
        log('ROLLBACK', 'SUCCESS', `Rolled ${c.name} back to version ${prior.version}.`, {
          calendarId: prior.id,
        });
        return sync(prior);
      }),
    archiveCalendar: (calendarId) =>
      run(() => {
        staffBlocked();
        const c = calendar(calendarId);
        if (c.status === 'PUBLISHED')
          throw fail(409, 'CALENDAR_STATE', 'A published calendar cannot be archived.');
        c.status = 'ARCHIVED';
        return sync(c);
      }),
    addEntry: (calendarId, body) =>
      run(() => {
        const input = parseInput(ComplianceCalendarEntryInput, body);
        const c = calendar(calendarId);
        draftOnly(c);
        if (
          c.entries.some(
            (e) =>
              e.name === input.name &&
              (e.dueOn ?? '') === (input.ruleKind === 'FIXED_DATE' ? input.dueOn : ''),
          )
        ) {
          throw fail(409, 'DUPLICATE', 'This calendar already has that entry.');
        }
        const e: ComplianceCalendarEntry = {
          id: id('6e00'),
          name: input.name,
          type: input.type,
          form: input.form ?? null,
          description: input.description ?? null,
          ruleKind: input.ruleKind,
          dueOn: input.ruleKind === 'FIXED_DATE' ? input.dueOn : null,
          rule: input.ruleKind === 'FORMULA' ? input.rule : null,
        };
        c.entries.push(e);
        sync(c);
        return e;
      }),
    updateEntry: (calendarId, entryIdValue, body) =>
      run(() => {
        const input = parseInput(UpdateComplianceCalendarEntryRequest, body);
        const c = calendar(calendarId);
        draftOnly(c);
        const e = c.entries.find((x) => x.id === entryIdValue);
        if (!e) throw fail(404, 'NOT_FOUND', 'That entry was not found.');
        Object.assign(e, input);
        sync(c);
        return e;
      }),
    deleteEntry: (calendarId, entryIdValue) =>
      run(() => {
        const c = calendar(calendarId);
        draftOnly(c);
        c.entries = c.entries.filter((x) => x.id !== entryIdValue);
        sync(c);
        return { ok: true as const };
      }),

    recurrences: (query = {}) =>
      run(() => {
        const q = parseInput(ComplianceRecurrencesQuery, query);
        const term = q.search?.toLowerCase();
        const rows = store.recurrences
          .filter(
            (r) =>
              r.status !== 'ARCHIVED' &&
              (!q.status || r.status === q.status) &&
              (q.templates === undefined || r.isTemplate === q.templates) &&
              (!q.type || r.type === q.type) &&
              (!term || r.name.toLowerCase().includes(term)),
          )
          .sort((a, b) => {
            const x = String(a[q.sort] ?? '');
            const y = String(b[q.sort] ?? '');
            return q.direction === 'desc' ? y.localeCompare(x) : x.localeCompare(y);
          });
        return page(rows, q);
      }),
    createRecurrence: (body) =>
      run(() => {
        const input = parseInput(CreateComplianceRecurrenceRequest, body);
        if (store.recurrences.some((r) => r.name === input.name && r.status !== 'ARCHIVED')) {
          throw fail(409, 'DUPLICATE', 'A recurring deadline with this name already exists.');
        }
        const entry = input.calendarEntryId
          ? store.calendars.find((c) => c.entries.some((e) => e.id === input.calendarEntryId))
          : null;
        if (input.calendarEntryId && !entry)
          throw fail(404, 'NOT_FOUND', 'That calendar entry was not found.');
        const r: ComplianceRecurrence = {
          id: id('3e00'),
          name: input.name,
          type: input.type,
          description: input.description ?? null,
          agency: input.agency ?? null,
          relatedForm: input.relatedForm ?? null,
          jurisdiction: input.jurisdiction ?? null,
          state: input.state ?? null,
          calendarEntry: entry
            ? {
                id: input.calendarEntryId!,
                name: entry.entries.find((e) => e.id === input.calendarEntryId)!.name,
              }
            : null,
          frequency: input.frequency,
          interval: input.interval ?? null,
          repeatRule: input.repeatRule,
          startOn: input.startOn ?? null,
          endMode: input.endMode,
          endAfterCount: input.endAfterCount ?? null,
          endOn: input.endOn ?? null,
          holidayRule: input.holidayRule,
          isTemplate: input.isTemplate,
          createTask: input.createTask,
          taskTemplateId: input.taskTemplateId ?? null,
          assignedTo: assignee(input.assignedUserId),
          clientVisible: input.clientVisible,
          remindClient: input.remindClient,
          addToTaxCalendar: input.addToTaxCalendar,
          notifyTeam: input.notifyTeam,
          reminders: input.reminders.map((x) => ({
            daysBefore: x.daysBefore,
            inApp: x.inApp ?? true,
            channels: x.channels ?? [],
          })),
          sendPastDueNotice: input.sendPastDueNotice,
          escalateToManager: input.escalateToManager,
          status: 'ACTIVE',
          pausedAt: null,
          endedAt: null,
          nextDueOn: null,
          deadlineCount: 0,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        store.recurrences.unshift(nextOf(r));
        return r;
      }),
    previewRecurrence: (body) =>
      run(() => {
        const input = parseInput(PreviewRecurrenceRequest, body);
        const dates = occurrencesOf(
          {
            frequency: input.frequency,
            interval: input.interval ?? null,
            repeatRule: input.repeatRule as ComplianceRepeatRule,
            startOn: input.startOn ?? null,
            endMode: input.endMode,
            endAfterCount: input.endAfterCount ?? null,
            endOn: input.endOn ?? null,
            holidayRule: input.holidayRule,
          },
          input.count,
        );
        return {
          dates,
          message:
            input.frequency === 'AUTHORITY_DEFINED'
              ? 'The dates follow the authority’s own calendar, so none are calculated here.'
              : dates.length === 0
                ? 'No dates fall inside this schedule.'
                : null,
        };
      }),
    getRecurrence: (recurrenceId) => run(() => recurrence(recurrenceId)),
    updateRecurrence: (recurrenceId, body) =>
      run(() => {
        const input = parseInput(UpdateComplianceRecurrenceRequest, body);
        const r = recurrence(recurrenceId);
        if (r.status === 'ENDED' || r.status === 'ARCHIVED') {
          throw fail(409, 'RECURRENCE_STATE', 'This recurring deadline has ended.');
        }
        const { assignedUserId, reminders, calendarEntryId, taskTemplateId, ...rest } = input;
        void calendarEntryId;
        Object.assign(r, rest);
        if (taskTemplateId !== undefined) r.taskTemplateId = taskTemplateId;
        if (assignedUserId !== undefined) r.assignedTo = assignee(assignedUserId);
        if (reminders)
          r.reminders = reminders.map((x) => ({
            daysBefore: x.daysBefore,
            inApp: x.inApp ?? true,
            channels: x.channels ?? [],
          }));
        return nextOf(r);
      }),
    pauseRecurrence: (recurrenceId) =>
      run(() => {
        const r = recurrence(recurrenceId);
        if (r.status !== 'ACTIVE')
          throw fail(409, 'RECURRENCE_STATE', 'Only an active one can be paused.');
        r.status = 'PAUSED';
        r.pausedAt = nowIso();
        return nextOf(r);
      }),
    resumeRecurrence: (recurrenceId) =>
      run(() => {
        const r = recurrence(recurrenceId);
        if (r.status !== 'PAUSED')
          throw fail(409, 'RECURRENCE_STATE', 'Only a paused one can be resumed.');
        r.status = 'ACTIVE';
        r.pausedAt = null;
        return nextOf(r);
      }),
    endRecurrence: (recurrenceId) =>
      run(() => {
        const r = recurrence(recurrenceId);
        if (r.status !== 'ACTIVE' && r.status !== 'PAUSED') {
          throw fail(409, 'RECURRENCE_STATE', 'This recurring deadline has already ended.');
        }
        r.status = 'ENDED';
        r.endedAt = nowIso();
        return nextOf(r);
      }),
    archiveRecurrence: (recurrenceId) =>
      run(() => {
        const r = recurrence(recurrenceId);
        if (r.status === 'ACTIVE')
          throw fail(409, 'RECURRENCE_STATE', 'End or pause it before archiving.');
        r.status = 'ARCHIVED';
        return nextOf(r);
      }),

    rules: (query = {}) =>
      run(() => {
        const q = parseInput(ComplianceApplicabilityRulesQuery, query);
        const term = q.search?.toLowerCase();
        return page(
          store.rules.filter(
            (r) =>
              (q.active === undefined || r.active === q.active) &&
              (!q.calendarEntryId || r.target.id === q.calendarEntryId) &&
              (!q.recurrenceId || r.target.id === q.recurrenceId) &&
              (!term || r.name.toLowerCase().includes(term)),
          ),
          q,
        );
      }),
    createRule: (body) =>
      run(() => {
        staffBlocked();
        const input = parseInput(CreateApplicabilityRuleRequest, body);
        if (store.rules.some((r) => r.name === input.name)) {
          throw fail(409, 'DUPLICATE', 'A rule with this name already exists.');
        }
        const r: ComplianceApplicabilityRule = {
          id: id('7a00'),
          name: input.name,
          target: { kind: input.target.kind, id: input.target.id, name: targetName(input.target) },
          outcome: input.outcome,
          entityTypes: input.entityTypes,
          states: input.states,
          services: input.services,
          excludeStatuses: input.excludeStatuses,
          priorYearLiabilityOverCents: input.priorYearLiabilityOverCents ?? null,
          criteria: input.criteria,
          active: input.active,
          version: 1,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        store.rules.unshift(r);
        return r;
      }),
    getRule: (ruleId) => run(() => rule(ruleId)),
    updateRule: (ruleId, body) =>
      run(() => {
        staffBlocked();
        const input = parseInput(UpdateApplicabilityRuleRequest, body);
        const r = rule(ruleId);
        Object.assign(r, input, { version: r.version + 1, updatedAt: nowIso() });
        return r;
      }),
    evaluateRule: (ruleId) =>
      run(() => {
        const r = rule(ruleId);
        if (!r.active) throw fail(409, 'RULE_INACTIVE', 'Turn the rule on before checking it.');
        const pool = clientsFor(r);
        const review = pool.filter((c) => c.clientNumber % 2 === 0 && c.accountType === 'BUSINESS');
        const matching = pool.filter((c) => !review.includes(c));
        return {
          ruleId: r.id,
          ruleVersion: r.version,
          matchingCount: matching.length,
          matching,
          needsReviewCount: review.length,
          needsReview: review.map((client) => ({
            client,
            reason: 'The entity type is missing on the client.',
          })),
          excludedCount: CLIENTS.length - pool.length,
        };
      }),

    suggestions: (query = {}) =>
      run(() => {
        const q = parseInput(ComplianceSuggestionsQuery, query);
        return page(
          store.suggestions.filter(
            (s) =>
              (q.decision === 'OPEN'
                ? s.decision === 'SUGGESTED' || s.decision === 'NEEDS_REVIEW'
                : s.decision === q.decision) &&
              (!q.clientId || s.client.id === q.clientId) &&
              (!q.ruleId || s.rule.id === q.ruleId),
          ),
          q,
        );
      }),
    generateSuggestions: (body) =>
      run(() => {
        const input = parseInput(GenerateSuggestionsRequest, body);
        const r = rule(input.ruleId);
        if (!r.active) throw fail(409, 'RULE_INACTIVE', 'Turn the rule on before generating.');
        const dueOn = input.dueOn ?? plus(today(), 30);
        let suggested = 0;
        let needsReview = 0;
        let decided = 0;
        for (const c of clientsFor(r)) {
          if (
            store.suggestions.some(
              (s) => s.client.id === c.id && s.rule.id === r.id && s.dueOn === dueOn,
            )
          ) {
            decided += 1;
            continue;
          }
          const review = c.clientNumber % 2 === 0 && c.accountType === 'BUSINESS';
          store.suggestions.push({
            id: id('8b00'),
            client: c,
            rule: { id: r.id, name: r.name, version: r.version },
            name: r.target.name,
            dueOn,
            decision: review ? 'NEEDS_REVIEW' : 'SUGGESTED',
            reason: review ? 'The entity type is missing on the client.' : 'Matches the rule.',
            deadlineId: null,
            decidedBy: null,
            decidedAt: null,
            createdAt: nowIso(),
          });
          if (review) needsReview += 1;
          else suggested += 1;
        }
        log(
          'GENERATE',
          'SUCCESS',
          `Generated ${suggested + needsReview} suggestions from “${r.name}”.`,
        );
        return { ruleId: r.id, dueOn, suggested, needsReview, applied: 0, alreadyDecided: decided };
      }),
    confirmSuggestion: (suggestionId, body = {}) =>
      run(() => {
        const input = parseInput(ConfirmSuggestionRequest, body);
        const s = store.suggestions.find((x) => x.id === suggestionId);
        if (!s) throw fail(404, 'NOT_FOUND', 'That suggestion was not found.');
        if (s.decision !== 'SUGGESTED' && s.decision !== 'NEEDS_REVIEW') {
          throw fail(409, 'SUGGESTION_STATE', 'This suggestion is already decided.');
        }
        const d = blankDeadline(id('2d00'), s.client, {
          name: s.name,
          type: 'TAX_FILING',
          source: 'GOVERNMENT',
          dueOn: s.dueOn,
          statutoryDueOn: s.dueOn,
          priority: input.priority ?? 'MEDIUM',
          assignedTo: assignee(input.assignedUserId),
          clientVisible: input.clientVisible ?? false,
          applicabilityReason: s.reason,
        });
        store.deadlines.unshift(d);
        s.decision = 'CONFIRMED';
        s.deadlineId = d.id;
        s.decidedBy = mockMe;
        s.decidedAt = nowIso();
        return fresh(d, store.settings);
      }),
    dismissSuggestion: (suggestionId, body) =>
      run(() => {
        parseInput(DismissSuggestionRequest, body);
        const s = store.suggestions.find((x) => x.id === suggestionId);
        if (!s) throw fail(404, 'NOT_FOUND', 'That suggestion was not found.');
        if (s.decision !== 'SUGGESTED' && s.decision !== 'NEEDS_REVIEW') {
          throw fail(409, 'SUGGESTION_STATE', 'This suggestion is already decided.');
        }
        s.decision = 'DISMISSED';
        s.decidedBy = mockMe;
        s.decidedAt = nowIso();
        return { ok: true as const };
      }),

    logs: (query = {}) =>
      run(() => {
        const q = parseInput(ComplianceLogsQuery, query);
        return page(
          store.logs.filter(
            (l) =>
              (!q.kind || l.kind === q.kind) &&
              (!q.outcome || l.outcome === q.outcome) &&
              (!q.calendarId || l.calendarId === q.calendarId) &&
              (!q.from || l.createdAt.slice(0, 10) >= q.from) &&
              (!q.to || l.createdAt.slice(0, 10) <= q.to),
          ),
          q,
        );
      }),
    settings: () => run(() => store.settings),
    updateSettings: (body) =>
      run(() => {
        staffBlocked();
        const input = parseInput(UpdateComplianceSettingsRequest, body);
        const { defaultReminders, ...rest } = input;
        Object.assign(store.settings, rest);
        if (defaultReminders) {
          store.settings.defaultReminders = defaultReminders.map((x) => ({
            daysBefore: x.daysBefore,
            inApp: x.inApp ?? true,
            channels: x.channels ?? [],
          }));
        }
        return store.settings;
      }),
  };

  void copy;
  void daysBetween;
  return { methods, templateFrom };
}
