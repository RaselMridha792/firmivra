// Unit tests for R12 step 6: the tasks, workspaces and reports logic that needs no database.
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { reachesClient, sentFields } from '../../src/workspaces/common.js';
import {
  badTextPaths,
  CreateReportBody,
  CreateTaskBody,
  MyReportsListQuery,
  TasksQuery,
  UpdateReportBody,
  UpdateTaskBody,
  WorkspacesQuery,
} from '../../src/workspaces/input.js';
import {
  decodeTaskCursor,
  decodeTimeCursor,
  encodeTaskCursor,
  encodeTimeCursor,
} from '../../src/workspaces/paging.js';
import { readReportData, writeReportData } from '../../src/workspaces/reports.service.js';
import { completedAtAfter } from '../../src/workspaces/tasks.service.js';
import { workspaceKindOf } from '../../src/workspaces/workspaces.service.js';

const ID = '0199b6d1-0000-7000-8000-000000000001';
const forged = (raw: string) => Buffer.from(raw).toString('base64url');
const refused = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return ((e as BadRequestException).getResponse() as { code: string }).code;
  }
  return null;
};

describe('cursors', () => {
  it('round-trip the last row of a page', () => {
    const at = new Date('2026-10-08T01:02:03.456Z');
    expect(decodeTimeCursor(encodeTimeCursor({ at, id: ID }))).toEqual({ at, id: ID });
    for (const cursor of [
      { open: true as const, dueOn: '2026-11-02', id: ID },
      { open: true as const, dueOn: null, id: ID },
      { open: false as const, at, id: ID },
    ]) {
      expect(decodeTaskCursor(encodeTaskCursor(cursor))).toEqual(cursor);
    }
    expect(decodeTimeCursor(forged(`t|2026-10-08T01:02:03.456Z|${ID.toUpperCase()}`)).id).toBe(ID);
  });

  it('refuse anything else as 400 VALIDATION_FAILED, before the database sees it', () => {
    for (const cursor of [
      '',
      'not-a-cursor',
      forged(`t|2026-10-08T01:02:03.456Z`),
      forged(`t|2026-10-08T01:02:03.456Z|not-a-uuid`),
      forged(`t|2026-10-08T01:02:03Z|${ID}`),
      forged(`t|2026-10-08T01:02:03.456+00:00|${ID}`),
      forged(`t|2026-02-30T01:02:03.456Z|${ID}`),
      forged(`t|0000-01-01T00:00:00.000Z|${ID}`),
      forged(`t|+010000-01-01T00:00:00.000Z|${ID}`),
      forged(`t|2026-10-08T01:02:03.456Z|${ID}|more`),
      forged(`c|2026-10-08T01:02:03.456Z|${ID}`),
    ]) {
      expect(
        refused(() => decodeTimeCursor(cursor)),
        cursor,
      ).toBe('VALIDATION_FAILED');
    }
    for (const cursor of [
      'not-a-cursor',
      forged(`t|2026-10-08T01:02:03.456Z|${ID}`),
      forged(`o|2026-02-30|${ID}`),
      forged(`o|0000-01-01|${ID}`),
      forged(`o|2026-1-1|${ID}`),
      forged(`o|2026-10-08|${ID}|more`),
      forged(`c|0000-01-01T00:00:00.000Z|${ID}`),
      forged(`c||${ID}`),
      forged(`x|2026-10-08|${ID}`),
    ]) {
      expect(
        refused(() => decodeTaskCursor(cursor)),
        cursor,
      ).toBe('VALIDATION_FAILED');
    }
  });
});

describe('the API input schemas', () => {
  const task = { clientId: ID, title: 'Call the bank (fake)' };
  const report = { kind: 'REPORT', title: 'September close (fake)' };

  it('refuse a NUL or half a surrogate pair anywhere, and keep whole pairs (emoji)', () => {
    expect(badTextPaths({ a: 'ok 😀', b: ['fine', { c: 'x\ud800' }], d: 'nul\u0000' })).toEqual([
      ['b', 1, 'c'],
      ['d'],
    ]);
    expect(CreateTaskBody.safeParse({ ...task, title: 'Call 😀' }).success).toBe(true);
    expect(CreateTaskBody.safeParse({ ...task, details: 'x \udfff' }).success).toBe(false);
    expect(UpdateTaskBody.safeParse({ title: 'x \ud800 y' }).success).toBe(false);
    expect(CreateReportBody.safeParse({ ...report, title: 'Close 😀' }).success).toBe(true);
    const lines = (label: string) => ({
      ...report,
      data: { lines: [{ label, amountCents: 100 }] },
    });
    expect(CreateReportBody.safeParse(lines('Revenue')).success).toBe(true);
    const bad = CreateReportBody.safeParse(lines('Rev \ud800'));
    expect(bad.error?.issues.map((i) => i.path.join('.'))).toContain('data.lines.0.label');
    expect(UpdateReportBody.safeParse({ data: { summary: 'x \udbff' } }).success).toBe(false);
  });

  it('refuse a due date Postgres cannot store, and keep the rest of the contract', () => {
    expect(CreateTaskBody.safeParse({ ...task, dueOn: '0001-01-01' }).success).toBe(true);
    expect(CreateTaskBody.safeParse({ ...task, dueOn: '0000-01-01' }).success).toBe(false);
    expect(UpdateTaskBody.safeParse({ dueOn: '0000-12-31' }).success).toBe(false);
    expect(UpdateTaskBody.safeParse({ dueOn: null }).success).toBe(true);
    expect(UpdateTaskBody.safeParse({}).success).toBe(false);
    expect(
      CreateReportBody.safeParse({ ...report, data: { lines: [{ label: 'X', amountCents: 1.5 }] } })
        .success,
    ).toBe(false);
  });

  it('query filters refuse control characters and unknown keys', () => {
    expect(WorkspacesQuery.parse({})).toEqual({ status: 'ACTIVE', limit: 25 });
    expect(WorkspacesQuery.safeParse({ search: 'a\u0000b' }).success).toBe(false);
    expect(WorkspacesQuery.safeParse({ search: 'a\u0001b' }).success).toBe(false);
    expect(TasksQuery.parse({ limit: '10' })).toEqual({ limit: 10 });
    expect(TasksQuery.safeParse({ cursor: 'x\ud800' }).success).toBe(false);
    expect(MyReportsListQuery.safeParse({ status: 'PUBLISHED' }).success).toBe(false);
  });
});

describe('tasks', () => {
  const now = new Date('2026-10-08T12:00:00.000Z');
  const earlier = new Date('2026-10-01T09:00:00.000Z');

  it('completedAt: set when DONE, kept while DONE, cleared otherwise, untouched if not sent', () => {
    expect(completedAtAfter({ status: 'OPEN', completedAt: null }, 'DONE', now)).toBe(now);
    expect(completedAtAfter({ status: 'DONE', completedAt: earlier }, 'DONE', now)).toBe(earlier);
    expect(completedAtAfter({ status: 'DONE', completedAt: earlier }, 'OPEN', now)).toBeNull();
    expect(completedAtAfter({ status: 'DONE', completedAt: earlier }, 'CANCELLED', now)).toBeNull();
    expect(completedAtAfter({ status: 'OPEN', completedAt: null }, undefined, now)).toBeUndefined();
  });

  it('Staff reach a client only when it is assigned to them; Owner and Admin every one', () => {
    const userId = ID;
    const staff = { userId, role: 'STAFF' as const };
    expect(reachesClient(staff, { assignedUserId: ID })).toBe(true);
    expect(reachesClient({ ...staff, userId: ID.toUpperCase() }, { assignedUserId: ID })).toBe(
      true,
    );
    expect(reachesClient(staff, { assignedUserId: null })).toBe(false);
    expect(reachesClient(staff, { assignedUserId: '0199b6d1-0000-7000-8000-000000000002' })).toBe(
      false,
    );
    for (const role of ['OWNER', 'ADMIN'] as const) {
      expect(reachesClient({ userId, role }, { assignedUserId: null })).toBe(true);
    }
  });

  it('the audit log gets the names of the fields sent, sorted, never their values', () => {
    expect(
      sentFields({ title: 'Secret', details: null, dueOn: undefined, status: 'DONE' }, [
        'title',
        'details',
        'dueOn',
        'status',
      ]),
    ).toEqual(['details', 'status', 'title']);
  });
});

describe('workspaces and reports', () => {
  it('only Bookkeeping and Tax Planning services have a workspace', () => {
    expect(workspaceKindOf('BOOKKEEPING')).toBe('BOOKKEEPING');
    expect(workspaceKindOf('TAX_PLANNING')).toBe('TAX_PLANNING');
    for (const kind of ['ANNUAL_TAX', 'QUARTERLY_TAX', 'PAYROLL', 'OTHER'] as const) {
      expect(workspaceKindOf(kind)).toBeNull();
    }
  });

  it('report figures are stored as the contract has them and read back safely', () => {
    expect(writeReportData(undefined)).toEqual({ summary: null, lines: [] });
    expect(
      writeReportData({
        summary: 'Fine',
        lines: [{ label: 'Revenue', amountCents: 1200, note: null }],
      }),
    ).toEqual({ summary: 'Fine', lines: [{ label: 'Revenue', amountCents: 1200, note: null }] });
    expect(readReportData({})).toEqual({ summary: null, lines: [] });
    expect(readReportData(null)).toEqual({ summary: null, lines: [] });
    expect(
      readReportData({
        summary: 3,
        lines: [{ label: 'A', amountCents: 1.5 }, 'junk', { amountCents: 7, note: 'n', extra: 1 }],
      }),
    ).toEqual({
      summary: null,
      lines: [
        { label: 'A', amountCents: null, note: null },
        { label: '', amountCents: 7, note: 'n' },
      ],
    });
  });
});
