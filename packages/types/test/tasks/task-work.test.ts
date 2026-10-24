import { describe, expect, it } from 'vitest';
import {
  BulkTaskRequest,
  CreateTaskDetailRequest,
  createRequest,
  createTaskWorkClient,
  CreateTaskSeriesRequest,
  CreateTaskTemplateRequest,
  reminderMinutes,
  ReminderRule,
  ReminderRuleOut,
  Recurrence,
  TaskCalendarQuery,
  TaskDetail,
  TaskOverviewQuery,
  TaskReminderUnit,
  UpdateTaskDetailRequest,
} from '../../src/index.js';

const id = '0199c0e0-0a00-7000-8000-000000000001';
const other = '0199c0e0-0a00-7000-8000-000000000002';

function fakeFetch(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('Tasks work contract: requests', () => {
  it('keeps the older create body valid and takes the new fields', () => {
    const base = { clientId: id, title: 'Send the engagement letter' };
    expect(CreateTaskDetailRequest.safeParse(base).success).toBe(true);
    expect(
      CreateTaskDetailRequest.safeParse({
        ...base,
        priority: 'HIGH',
        progress: 'PENDING',
        dueOn: '2026-11-01',
        dueTime: '09:30',
        allDay: false,
        clientVisible: true,
        checklist: [{ label: 'Draft' }, { label: 'Review', required: true }],
        reminders: [{ daysBefore: 1 }],
        additionalAssigneeIds: [other],
        dependsOnTaskId: other,
        templateId: other,
      }).success,
    ).toBe(true);
    // Strict: the firm is never named, and unknown fields are refused.
    expect(CreateTaskDetailRequest.safeParse({ ...base, businessId: id }).success).toBe(false);
    expect(CreateTaskDetailRequest.safeParse({ ...base, dueTime: '9:30' }).success).toBe(false);
  });

  it('refuses a text over the database limit and an empty update', () => {
    const base = { clientId: id, title: 'T' };
    expect(CreateTaskDetailRequest.safeParse({ ...base, details: 'x'.repeat(2_001) }).success).toBe(
      false,
    );
    expect(UpdateTaskDetailRequest.safeParse({}).success).toBe(false);
    expect(UpdateTaskDetailRequest.safeParse({ version: 'v' }).success).toBe(false);
    expect(UpdateTaskDetailRequest.safeParse({ version: 'v', priority: 'LOW' }).success).toBe(true);
    expect(UpdateTaskDetailRequest.safeParse({ internalNotes: null, dueOn: null }).success).toBe(
      true,
    );
  });

  it('needs somewhere to remind, within a year', () => {
    expect(ReminderRule.safeParse({ daysBefore: 0 }).success).toBe(true);
    expect(ReminderRule.safeParse({ daysBefore: 7, channels: ['EMAIL', 'SMS'] }).success).toBe(
      true,
    );
    expect(ReminderRule.safeParse({ daysBefore: 7, inApp: false }).success).toBe(false);
    expect(ReminderRule.safeParse({ daysBefore: 366 }).success).toBe(false);
    expect(ReminderRule.safeParse({ daysBefore: -1 }).success).toBe(false);
    expect(
      ReminderRule.safeParse({ daysBefore: 1, channels: ['EMAIL', 'EMAIL', 'SMS'] }).success,
    ).toBe(false);
  });

  it('checks how a recurrence ends', () => {
    const base = { unit: 'WEEK', startOn: '2026-11-02' };
    expect(Recurrence.safeParse(base).success).toBe(true);
    expect(Recurrence.safeParse({ ...base, endMode: 'AFTER_COUNT' }).success).toBe(false);
    expect(
      Recurrence.safeParse({ ...base, endMode: 'AFTER_COUNT', endAfterCount: 4 }).success,
    ).toBe(true);
    expect(Recurrence.safeParse({ ...base, endMode: 'ON_DATE' }).success).toBe(false);
    expect(Recurrence.safeParse({ ...base, endMode: 'ON_DATE', endOn: '2026-10-01' }).success).toBe(
      false,
    );
    expect(Recurrence.safeParse({ ...base, endMode: 'ON_DATE', endOn: '2027-01-01' }).success).toBe(
      true,
    );
    // A count or a date without the matching end is a conflict, not ignored.
    expect(Recurrence.safeParse({ ...base, endAfterCount: 4 }).success).toBe(false);
    expect(Recurrence.safeParse({ ...base, endOn: '2027-01-01' }).success).toBe(false);
    expect(Recurrence.safeParse({ ...base, interval: 0 }).success).toBe(false);
    expect(
      Recurrence.safeParse({ ...base, unit: 'MONTH', pattern: { monthly: 'NTH_WEEKDAY' } }).success,
    ).toBe(false);
    expect(
      Recurrence.safeParse({
        ...base,
        unit: 'MONTH',
        pattern: { monthly: 'NTH_WEEKDAY', nth: 5, weekday: 1 },
      }).success,
    ).toBe(true);
  });

  it('makes a series from a client, a title and a recurrence', () => {
    const body = {
      clientId: id,
      title: 'Monthly close',
      recurrence: { unit: 'MONTH', startOn: '2026-11-05' },
    };
    expect(CreateTaskSeriesRequest.safeParse(body).success).toBe(true);
    expect(CreateTaskSeriesRequest.safeParse({ ...body, recurrence: undefined }).success).toBe(
      false,
    );
  });

  it('takes each bulk action with its own fields and asks to confirm the destructive ones', () => {
    const ids = [id, other];
    expect(
      BulkTaskRequest.safeParse({ action: 'REASSIGN', ids, assignedUserId: null }).success,
    ).toBe(true);
    expect(
      BulkTaskRequest.safeParse({ action: 'SET_PRIORITY', ids, priority: 'HIGH' }).success,
    ).toBe(true);
    expect(BulkTaskRequest.safeParse({ action: 'COMPLETE', ids }).success).toBe(true);
    expect(BulkTaskRequest.safeParse({ action: 'CANCEL', ids }).success).toBe(false);
    expect(BulkTaskRequest.safeParse({ action: 'ARCHIVE', ids, confirm: true }).success).toBe(true);
    expect(BulkTaskRequest.safeParse({ action: 'COMPLETE', ids: [] }).success).toBe(false);
    expect(
      BulkTaskRequest.safeParse({ action: 'COMPLETE', ids: Array(101).fill(id) }).success,
    ).toBe(false);
    // A due-date change sets a date or shifts by days, one of the two.
    const due = (o: object) => BulkTaskRequest.safeParse({ action: 'SET_DUE_DATE', ids, ...o });
    expect(due({ dueOn: '2026-12-01' }).success).toBe(true);
    expect(due({ shiftDays: -3 }).success).toBe(true);
    expect(due({}).success).toBe(false);
    expect(due({ dueOn: '2026-12-01', shiftDays: 1 }).success).toBe(false);
  });
});

describe('Tasks work contract: Custom reminders (Oct 24)', () => {
  const fails = (body: object, path: string) => {
    const r = ReminderRule.safeParse(body);
    expect(r.success, JSON.stringify(body)).toBe(false);
    expect(r.error?.issues.map((i) => i.path.join('.'))).toContain(path);
  };

  it('keeps the days form: a {daysBefore} body still parses as before', () => {
    expect(ReminderRule.parse({ daysBefore: 1 })).toEqual({
      daysBefore: 1,
      timeOfDay: null,
      inApp: true,
      channels: [],
    });
    expect(reminderMinutes(ReminderRule.parse({ daysBefore: 1, timeOfDay: '09:00' }))).toBeNull();
    const base = { clientId: id, title: 'T', dueOn: '2026-11-01' };
    expect(
      CreateTaskDetailRequest.safeParse({ ...base, reminders: [{ daysBefore: 1 }] }).success,
    ).toBe(true);
  });

  it('takes an amount of minutes, hours or days', () => {
    expect(TaskReminderUnit.options).toEqual(['MINUTES', 'HOURS', 'DAYS']);
    for (const [amount, unit, minutes] of [
      [30, 'MINUTES', 30],
      [2, 'HOURS', 120],
      [3, 'DAYS', 4_320],
      [999, 'HOURS', 59_940],
      [365, 'DAYS', 525_600],
    ] as const) {
      const rule = ReminderRule.parse({ amount, unit, channels: ['EMAIL'] });
      expect(rule).toMatchObject({ amount, unit, timeOfDay: null, inApp: true });
      expect(reminderMinutes(rule)).toBe(minutes);
    }
    expect(
      CreateTaskTemplateRequest.safeParse({
        name: 'Custom',
        reminders: [{ amount: 2, unit: 'HOURS' }, { daysBefore: 1 }],
      }).success,
    ).toBe(true);
  });

  it('is the days form or an amount with its unit, never half of one', () => {
    fails({}, 'daysBefore');
    fails({ inApp: true, channels: ['SMS'] }, 'daysBefore');
    fails({ amount: 2 }, 'unit');
    fails({ unit: 'HOURS' }, 'amount');
    fails({ amount: 2, unit: null }, 'unit');
    // Days that are not the amount's whole days.
    fails({ daysBefore: 1, amount: 2, unit: 'HOURS' }, 'daysBefore');
    fails({ daysBefore: 0, amount: 1, unit: 'DAYS' }, 'daysBefore');
    // Its whole days may come with it: 36 hours is 1 day, 90 minutes 0.
    expect(ReminderRule.safeParse({ daysBefore: 1, amount: 36, unit: 'HOURS' }).success).toBe(true);
    expect(ReminderRule.safeParse({ daysBefore: 0, amount: 90, unit: 'MINUTES' }).success).toBe(
      true,
    );
    // A null amount and unit: a days rule.
    expect(ReminderRule.safeParse({ daysBefore: 2, amount: null, unit: null }).success).toBe(true);
  });

  it('takes no time of day with Custom', () => {
    fails({ amount: 1, unit: 'HOURS', timeOfDay: '09:00' }, 'timeOfDay');
    expect(ReminderRule.safeParse({ amount: 1, unit: 'HOURS', timeOfDay: null }).success).toBe(
      true,
    );
  });

  it('caps Custom at 365 days and 999 of a unit, whole and above zero', () => {
    fails({ amount: 366, unit: 'DAYS' }, 'amount');
    fails({ amount: 1_000, unit: 'MINUTES' }, 'amount');
    fails({ amount: 0, unit: 'MINUTES' }, 'amount');
    fails({ amount: -5, unit: 'HOURS' }, 'amount');
    fails({ amount: 1.5, unit: 'HOURS' }, 'amount');
    fails({ amount: 2, unit: 'WEEKS' }, 'unit');
    // Still somewhere to remind.
    fails({ amount: 2, unit: 'HOURS', inApp: false }, 'channels');
  });

  it('sends a rule read back as it came, without its id', () => {
    for (const out of [
      {
        id,
        daysBefore: 1,
        timeOfDay: '09:00',
        amount: null,
        unit: null,
        inApp: true,
        channels: [],
      },
      {
        id,
        daysBefore: 1,
        timeOfDay: null,
        amount: 36,
        unit: 'HOURS',
        inApp: false,
        channels: ['SMS'],
      },
    ]) {
      const { id: _id, ...back } = ReminderRuleOut.parse(out);
      expect(ReminderRule.safeParse(back).success, JSON.stringify(back)).toBe(true);
    }
  });

  it('reads an older answer without amount and unit as days rules', () => {
    const detail = {
      id,
      title: 'T',
      kind: 'GENERAL',
      client: { id, displayName: 'Jamie Sample' },
      type: null,
      engagement: null,
      service: null,
      deadline: null,
      priority: 'MEDIUM',
      status: 'OPEN',
      progress: 'PENDING',
      dueOn: '2026-11-01',
      dueTime: null,
      allDay: true,
      overdue: false,
      assignedTo: null,
      additionalAssigneeCount: 0,
      checklist: { done: 0, total: 0 },
      blocked: false,
      recurring: false,
      clientVisible: false,
      archivedAt: null,
      updatedAt: '2026-10-17T10:00:00.000Z',
      details: null,
      engagementId: null,
      startOn: null,
      assignedUserId: null,
      additionalAssignees: [],
      checklistItems: [],
      reminders: [{ id: other, daysBefore: 1, timeOfDay: null, inApp: true, channels: [] }],
      attachments: [],
      dependsOn: null,
      blockedReason: null,
      internalNotes: null,
      templateId: null,
      series: null,
      completedAt: null,
      completedBy: null,
      createdBy: null,
      createdAt: '2026-10-17T10:00:00.000Z',
      version: '2026-10-17T10:00:00.000Z',
    };
    expect(TaskDetail.parse(detail).reminders).toEqual([
      {
        id: other,
        daysBefore: 1,
        timeOfDay: null,
        amount: null,
        unit: null,
        inApp: true,
        channels: [],
      },
    ]);
    const custom = { ...detail.reminders[0], daysBefore: 0, amount: 2, unit: 'HOURS' };
    expect(TaskDetail.parse({ ...detail, reminders: [custom] }).reminders[0]).toMatchObject({
      amount: 2,
      unit: 'HOURS',
    });
  });
});

describe('Tasks work contract: queries', () => {
  it('defaults the overview and reads a true/false overdue filter', () => {
    expect(TaskOverviewQuery.parse({})).toMatchObject({
      view: 'all',
      sort: 'due',
      direction: 'asc',
      page: 1,
      pageSize: 10,
    });
    expect(TaskOverviewQuery.parse({ overdue: 'true', page: '2' })).toMatchObject({
      overdue: true,
      page: 2,
    });
    expect(TaskOverviewQuery.safeParse({ view: 'everything' }).success).toBe(false);
    expect(TaskOverviewQuery.safeParse({ pageSize: '101' }).success).toBe(false);
  });

  it('limits the calendar to 62 days in order', () => {
    const q = (from: string, to: string) => TaskCalendarQuery.safeParse({ from, to }).success;
    expect(q('2026-11-01', '2026-11-30')).toBe(true);
    expect(q('2026-11-01', '2026-12-31')).toBe(true);
    expect(q('2026-11-01', '2027-01-15')).toBe(false);
    expect(q('2026-11-10', '2026-11-01')).toBe(false);
  });
});

describe('createTaskWorkClient', () => {
  const row = {
    id,
    title: 'T',
    kind: 'GENERAL',
    client: { id, displayName: 'Jamie Sample' },
    type: null,
    engagement: null,
    service: null,
    deadline: null,
    priority: 'MEDIUM',
    status: 'OPEN',
    progress: 'PENDING',
    dueOn: null,
    dueTime: null,
    allDay: true,
    overdue: false,
    assignedTo: null,
    additionalAssigneeCount: 0,
    checklist: { done: 0, total: 0 },
    blocked: false,
    recurring: false,
    clientVisible: false,
    archivedAt: null,
    updatedAt: '2026-10-17T10:00:00.000Z',
  };

  it('calls the routes in the contract and never sends a business id', async () => {
    const f = fakeFetch({ items: [row], total: 1, page: 1, pageSize: 10 });
    const client = createTaskWorkClient(createRequest({ fetch: f.fn, baseUrl: '/api/v1' }));
    const page = await client.overview({ view: 'mine', overdue: true, priority: 'HIGH' });
    expect(page.items).toHaveLength(1);
    const url = f.calls[0]?.url ?? '';
    expect(url.startsWith('/api/v1/business/tasks/overview?')).toBe(true);
    for (const part of ['view=mine', 'priority=HIGH', 'overdue=true', 'sort=due', 'page=1']) {
      expect(url).toContain(part);
    }
    expect(JSON.stringify(f.calls)).not.toMatch(/businessId|x-business-id/i);
  });

  it('refuses bad input before sending anything', async () => {
    const f = fakeFetch({});
    const client = createTaskWorkClient(createRequest({ fetch: f.fn, baseUrl: '/api/v1' }));
    await expect(client.bulk({ action: 'CANCEL', ids: [id] } as never)).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
    await expect(client.task('not-an-id')).rejects.toMatchObject({ status: 400 });
    expect(f.calls).toHaveLength(0);
  });
});
