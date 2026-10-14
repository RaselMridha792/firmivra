// Report schedules and runs (r39_report_schedules): firm-only rows, the day fields each
// frequency needs, firm-member recipients, and finished runs that never change.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { r39Fixtures } from './r39-fixtures.js';

const { A, B, as, setup, close, outcome } = r39Fixtures(inject('dbUrls'));
let report = '';
let schedule = '';
const time = new Date('1970-01-01T08:00:00Z');
const sched = (f = A, data: object = {}) =>
  as(f).reportSchedule.create({
    data: {
      businessId: f.id,
      definitionId: report,
      name: 'Weekly revenue',
      frequency: 'WEEKLY',
      weekday: 1,
      runTime: time,
      timezone: 'America/New_York',
      datePreset: 'previous_week',
      formats: ['PDF'],
      ownerUserId: f.owner,
      ...data,
    } as never,
  });
const run = (data: object = {}) =>
  as(A).reportRun.create({
    data: { businessId: A.id, definitionId: report, kind: 'VIEW', ...data } as never,
  });

beforeAll(async () => {
  await setup();
  const d = {
    businessId: A.id,
    category: 'FINANCIAL' as const,
    dataSource: 'invoices_payments',
    name: 'R',
    datePreset: 'this_year',
    ownerUserId: A.owner,
  };
  report = (await as(A).reportDefinition.create({ data: d })).id;
  schedule = (await sched()).id;
});
afterAll(close);

describe('row-level security', () => {
  it("hides another firm's rows and refuses links across firms", async () => {
    expect(await as(B).reportSchedule.findMany()).toEqual([]);
    expect(await as(B).reportScheduleRecipient.findMany()).toEqual([]);
    expect(await as(B).reportRun.findMany()).toEqual([]);
    expect(await outcome(sched(B))).toMatch(/Foreign key/);
    const r = as(B).reportRun.create({
      data: { businessId: B.id, definitionId: report, kind: 'VIEW' },
    });
    expect(await outcome(r)).toMatch(/Foreign key/);
  });
});

describe('schedules', () => {
  it('need the day fields their frequency uses, and no others', async () => {
    expect(await outcome(sched(A, { weekday: null }))).toMatch(/report_schedules_values/);
    expect(await outcome(sched(A, { frequency: 'MONTHLY' }))).toMatch(/report_schedules_values/);
    expect(await outcome(sched(A, { frequency: 'MONTHLY', weekday: null, dayOfMonth: 1 }))).toBe(
      'ok',
    );
    expect(await outcome(sched(A, { frequency: 'ANNUAL', weekday: null, dayOfMonth: 15 }))).toMatch(
      /report_schedules_values/,
    );
    expect(await outcome(sched(A, { frequency: 'DAILY', weekday: null }))).toBe('ok');
  });
  it('name one report, a format, and a delivery', async () => {
    expect(await outcome(sched(A, { definitionId: null }))).toMatch(/report_schedules_values/);
    expect(await outcome(sched(A, { definitionId: null, systemKey: 'revenue_summary' }))).toBe(
      'ok',
    );
    expect(await outcome(sched(A, { formats: [] }))).toMatch(/report_schedules_values/);
    expect(await outcome(sched(A, { formats: ['PDF', 'PDF'] }))).toMatch(/report_schedules_values/);
    expect(await outcome(sched(A, { deliverEmail: false }))).toMatch(/report_schedules_values/);
  });
  it('are stopped with a deleted time, never deleted', async () => {
    expect(
      await outcome(
        as(A).reportSchedule.update({ where: { id: schedule }, data: { deletedAt: new Date() } }),
      ),
    ).toMatch(/report_schedules_values/);
    expect(
      await outcome(
        as(A).reportSchedule.update({
          where: { id: schedule },
          data: { deletedAt: new Date(), active: false },
        }),
      ),
    ).toBe('ok');
    expect(await outcome(as(A).reportSchedule.delete({ where: { id: schedule } }))).toMatch(
      /permission denied/,
    );
  });
  it('send to firm members or an outside email, not both', async () => {
    const add = (d: object) =>
      outcome(
        as(A).reportScheduleRecipient.create({
          data: { businessId: A.id, scheduleId: schedule, ...d },
        }),
      );
    expect(await add({ userId: A.owner })).toBe('ok');
    expect(await add({ userId: B.owner })).toMatch(/REPORT_RECIPIENT_MEMBER/);
    expect(await add({ email: 'cpa@example.test' })).toBe('ok');
    expect(await add({ email: 'CPA@example.test' })).toMatch(/recipients_one/);
    expect(await add({ userId: A.owner, email: 'x@example.test' })).toMatch(/recipients_one/);
  });
});

describe('runs', () => {
  it('belong to a report, a kind and a file under the firm', async () => {
    expect(await outcome(run({ definitionId: null }))).toMatch(/report_runs_values/);
    expect(await outcome(run({ kind: 'SCHEDULED' }))).toMatch(/report_runs_values/);
    expect(
      await outcome(run({ kind: 'EXPORT', format: 'CSV', s3Key: `tenant/${B.id}/reports/x.csv` })),
    ).toMatch(/report_runs_values/);
    expect(await outcome(run({ kind: 'EXPORT' }))).toMatch(/report_runs_values/);
    expect(
      await outcome(
        run({
          kind: 'EXPORT',
          format: 'CSV',
          sensitive: true,
          s3Key: `tenant/${A.id}/reports/x.csv`,
        }),
      ),
    ).toBe('ok');
  });
  it('finish once and then never change', async () => {
    const r = await run();
    const update = (data: object) => outcome(as(A).reportRun.update({ where: { id: r.id }, data }));
    expect(await update({ status: 'SUCCEEDED', finishedAt: new Date(), rowCount: 5 })).toBe('ok');
    expect(await update({ rowCount: 6 })).toMatch(/REPORT_RUN_FINISHED/);
  });
});
