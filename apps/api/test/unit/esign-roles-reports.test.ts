// R13 extras (contract 3), Firm Sign roles and reports on the in-memory ports (esign-fakes.ts):
// Owner and Admin list and set a Staff member's access (Owner and Admin fixed, Staff 403), the
// audit of a change, and the report's totals, turnaround, senders, visibility, filters and the
// firm's calendar days. Synthetic data only.
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { EsignReportQuery, type EsignRequestStatus } from '@firmivra/types';
import { dayStart, EsignReportsService } from '../../src/esign/extras/reports.service.js';
import { EsignRolesService } from '../../src/esign/extras/roles.service.js';
import type { EsignActor } from '../../src/esign/requests/requests.service.js';
import { esignWorld, type EsignWorld, InMemoryExtrasRepository } from './esign-fakes.js';

let w: EsignWorld;
let roles: EsignRolesService;
let reports: EsignReportsService;
const as = (userId: string, role: EsignActor['role']): EsignActor => ({ userId, role });

beforeEach(() => {
  w = esignWorld();
  const extras = new InMemoryExtrasRepository(w.repo);
  roles = new EsignRolesService(extras, w.directory, w.audit);
  reports = new EsignReportsService(extras, w.directory);
});

async function refused(work: Promise<unknown>): Promise<[number, string]> {
  try {
    await work;
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    return [error.getStatus(), (error.getResponse() as { code: string }).code];
  }
  throw new Error('expected a refusal');
}

describe('Firm Sign roles', () => {
  it('lists every active member by name; Owner and Admin follow their firm role', async () => {
    const list = await roles.list(w.a, as(w.users.adminA, 'ADMIN'));
    expect(list.items.map((m) => [m.user.name, m.esignRole, m.canChange])).toEqual([
      ['admin-a', 'ADMIN', false],
      ['manager-a', 'MANAGER', true],
      ['owner-a', 'OWNER', false],
      ['staff-a', 'STAFF', true],
      ['staff-a2', 'STAFF', true],
    ]);
    expect(list.items[0]!.email).toBe('admin-a@firm.test');
    const b = await roles.list(w.b, as(w.users.ownerB, 'OWNER'));
    expect(b.items.map((m) => m.user.name)).toEqual(['owner-b']);
  });

  it('makes a Staff member a Viewer and back, auditing ids and roles only', async () => {
    const owner = as(w.users.ownerA, 'OWNER');
    const set = await roles.set(w.a, owner, w.users.staffA, { esignRole: 'VIEWER' });
    expect([set.esignRole, set.canChange]).toEqual(['VIEWER', true]);
    expect(await w.repo.esignRole(w.a, w.users.staffA)).toBe('VIEWER');
    await roles.set(w.a, owner, w.users.staffA, { esignRole: 'VIEWER' });
    await roles.set(w.a, owner, w.users.staffA, { esignRole: 'STAFF' });
    expect(await w.repo.esignRole(w.a, w.users.staffA)).toBe('STAFF');
    expect(w.audit.entries.map((e) => [e.action, e.entity.id, e.metadata])).toEqual([
      ['esign.role_changed', w.users.staffA, { from: 'STAFF', to: 'VIEWER' }],
      ['esign.role_changed', w.users.staffA, { from: 'VIEWER', to: 'STAFF' }],
    ]);
  });

  it('refuses Owner and Admin (ROLE_FIXED); non-members and other firms’ are 404', async () => {
    const owner = as(w.users.ownerA, 'OWNER');
    const manager = { esignRole: 'MANAGER' } as const;
    expect(await refused(roles.set(w.a, owner, w.users.adminA, manager))).toEqual([
      409,
      'ROLE_FIXED',
    ]);
    for (const userId of [w.users.goneA, w.users.ownerB]) {
      expect(await refused(roles.set(w.a, owner, userId, manager))).toEqual([404, 'NOT_FOUND']);
    }
    expect(await w.repo.esignRole(w.b, w.users.ownerB)).toBe('OWNER');
  });

  it('is for Owner and Admin only: Staff, Managers and Viewers get 403', async () => {
    for (const actor of [
      as(w.users.staffA, 'STAFF'),
      as(w.users.managerA, 'MANAGER'),
      as(w.users.staffA2, 'VIEWER'),
    ]) {
      expect(await refused(roles.list(w.a, actor))).toEqual([403, 'FORBIDDEN']);
      const body = { esignRole: 'MANAGER' } as const;
      expect(await refused(roles.set(w.a, actor, w.users.staffA2, body))).toEqual([
        403,
        'FORBIDDEN',
      ]);
    }
    expect(w.audit.entries).toEqual([]);
  });
});

describe('Firm Sign reports', () => {
  const HOUR = 3_600_000;
  /** A request sent at `sentAt` by `sender`, for `clientId`, in `status` now. */
  async function sent(
    sender: string,
    sentAt: string,
    status: EsignRequestStatus,
    hours: number | null = null,
    clientId: string | null = w.ids.c2,
  ) {
    const r = await w.repo.createRequest(w.a, {
      title: 'Fake report',
      source: 'TAB',
      clientId,
      engagementId: null,
      senderUserId: sender,
      internalNote: null,
      emailSubject: null,
      emailMessage: null,
      routing: 'SEQUENTIAL',
      expiryDays: 30,
      reminders: { firstAfterDays: 3, everyDays: 3, max: 3 },
      expiryWarningDays: 2,
    });
    w.repo.seed(w.a, r.id, (row) => {
      const at = new Date(sentAt);
      Object.assign(row.record, {
        status,
        sentAt: at,
        completedAt: hours === null ? null : new Date(+at + hours * HOUR),
      });
    });
  }
  const query = (q: object) =>
    EsignReportQuery.parse({ from: '2026-10-01', to: '2026-10-31', ...q });

  beforeEach(async () => {
    const { ownerA, staffA } = w.users;
    await sent(ownerA, '2026-10-02T15:00:00Z', 'COMPLETED', 10);
    await sent(ownerA, '2026-10-03T15:00:00Z', 'COMPLETED', 21);
    await sent(ownerA, '2026-10-04T15:00:00Z', 'VOIDED');
    await sent(staffA, '2026-10-05T15:00:00Z', 'VIEWED');
    await sent(staffA, '2026-10-06T15:00:00Z', 'DECLINED');
    await sent(staffA, '2026-10-07T15:00:00Z', 'EXPIRED');
    // Sept 30 at 11 pm in New York: before the range in the firm's own calendar.
    await sent(ownerA, '2026-10-01T03:00:00Z', 'COMPLETED', 1);
    // Oct 31 at 11 pm in New York: still inside.
    await sent(staffA, '2026-11-01T03:00:00Z', 'SENT');
    // Never sent: not counted.
    await w.repo.createRequest(w.a, {
      ...{ title: 'Fake draft', source: 'TAB', clientId: null, engagementId: null },
      ...{ senderUserId: ownerA, internalNote: null, emailSubject: null, emailMessage: null },
      ...{ routing: 'SEQUENTIAL', expiryDays: 30, expiryWarningDays: 2 },
      reminders: { firstAfterDays: 3, everyDays: 3, max: 3 },
    });
  });

  it('totals the firm’s requests sent in its calendar days, with turnaround and senders', async () => {
    const report = await reports.report(w.a, as(w.users.adminA, 'ADMIN'), query({}));
    expect(report.totals).toEqual({
      sent: 7,
      completed: 2,
      outstanding: 2,
      declined: 1,
      expired: 1,
      voided: 1,
      completionRate: 2 / 7,
      averageCompletionHours: 15.5,
    });
    expect(report.bySender.map((s) => [s.sender.name, s.sent, s.completed])).toEqual([
      ['staff-a', 4, 0],
      ['owner-a', 3, 2],
    ]);
    expect(report.bySender[1]!.averageCompletionHours).toBe(15.5);
    expect(report.bySender[0]!.completionRate).toBe(0);
  });

  it('narrows by status and sender; an empty range has null rates', async () => {
    const owner = as(w.users.ownerA, 'OWNER');
    const done = await reports.report(w.a, owner, query({ status: 'COMPLETED' }));
    expect([done.totals.sent, done.totals.completionRate]).toEqual([2, 1]);
    const staff = await reports.report(w.a, owner, query({ senderId: w.users.staffA }));
    expect(staff.bySender.map((s) => s.sender.userId)).toEqual([w.users.staffA]);
    const empty = await reports.report(w.a, owner, query({ from: '2025-01-01', to: '2025-01-31' }));
    expect(empty).toEqual({
      from: '2025-01-01',
      to: '2025-01-31',
      totals: {
        ...{ sent: 0, completed: 0, outstanding: 0, declined: 0, expired: 0, voided: 0 },
        completionRate: null,
        averageCompletionHours: null,
      },
      bySender: [],
    });
  });

  it('counts only what Staff, Managers and Viewers may open; never another firm’s', async () => {
    // staff-a2 sends one for c2 (nobody's); staff-a sees their own and their client's only.
    await sent(w.users.staffA2, '2026-10-08T15:00:00Z', 'SENT');
    await sent(w.users.ownerA, '2026-10-09T15:00:00Z', 'SENT', null, w.ids.c1);
    for (const role of ['STAFF', 'MANAGER', 'VIEWER'] as const) {
      const mine = await reports.report(w.a, as(w.users.staffA, role), query({}));
      expect([role, mine.totals.sent]).toEqual([role, 5]);
    }
    const b = await reports.report(w.b, as(w.users.ownerB, 'OWNER'), query({}));
    expect(b.totals.sent).toBe(0);
  });

  it('allows at most a year, end not before start (400 at the pipe)', () => {
    expect(EsignReportQuery.safeParse({ from: '2026-01-01', to: '2027-01-02' }).success).toBe(
      false,
    );
    expect(EsignReportQuery.safeParse({ from: '2026-02-01', to: '2026-01-01' }).success).toBe(
      false,
    );
    expect(EsignReportQuery.safeParse({ from: '2025-01-01', to: '2026-01-01' }).success).toBe(true);
  });

  it('starts each day at midnight in the firm’s time zone, across daylight saving time', () => {
    const ny = 'America/New_York';
    expect(dayStart('2026-03-08', ny).toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(dayStart('2026-03-09', ny).toISOString()).toBe('2026-03-09T04:00:00.000Z');
    expect(dayStart('2026-11-01', ny).toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(dayStart('2026-11-02', ny).toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect(dayStart('2026-10-01', 'Asia/Dhaka').toISOString()).toBe('2026-09-30T18:00:00.000Z');
  });
});
