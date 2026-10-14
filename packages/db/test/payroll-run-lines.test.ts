// Run lines and run issues (r39_payroll_lines): firm-only rows, lines of the run's own client
// while it is prepared, and approval blocked by errors.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { r39Fixtures } from './r39-fixtures.js';

const { A, B, as, setup, close, outcome } = r39Fixtures(inject('dbUrls'));
let pc = '';
let run = '';
let w1 = '';
const period = { periodStart: new Date('2026-09-01'), periodEnd: new Date('2026-09-15') };
const line = (data: object = {}) =>
  as(A).payrollRunLine.create({
    data: {
      businessId: A.id,
      runId: run,
      workerId: w1,
      regularPayCents: 144000,
      otherEarningsCents: 5000,
      deductionsCents: 22045,
      totalPayCents: 126955,
      hours: 80,
      ...data,
    } as never,
  });
const issue = (data: object = {}) =>
  as(A).payrollRunIssue.create({
    data: {
      businessId: A.id,
      runId: run,
      severity: 'WARNING',
      code: 'overtime_review',
      message: '2 workers have overtime hours.',
      ...data,
    } as never,
  });

beforeAll(async () => {
  await setup('PAYROLL');
  pc = (
    await as(A).payrollClient.create({
      data: { businessId: A.id, clientId: A.client, engagementId: A.eng },
    })
  ).id;
  const w = { businessId: A.id, payrollClientId: pc, workerType: 'FULL_TIME' as const };
  w1 = (await as(A).payrollWorker.create({ data: { ...w, displayName: 'Jasmine Smith' } })).id;
  const r = {
    businessId: A.id,
    payrollClientId: pc,
    payDate: new Date('2026-09-19'),
    frequency: 'SEMI_MONTHLY' as const,
    status: 'IN_PROGRESS' as const,
  };
  run = (await as(A).payrollRun.create({ data: { ...r, ...period } })).id;
});
afterAll(close);

describe('row-level security', () => {
  it("hides another firm's rows", async () => {
    await line();
    await issue();
    expect(await as(B).payrollRunLine.findMany()).toEqual([]);
    expect(await as(B).payrollRunIssue.findMany()).toEqual([]);
  });
});

describe('lines', () => {
  it("add up, once per worker, and only for a worker of the run's client", async () => {
    expect(await outcome(line())).toMatch(/Unique/i);
    const w = { businessId: A.id, payrollClientId: pc, workerType: 'PART_TIME' as const };
    const w2 = (await as(A).payrollWorker.create({ data: { ...w, displayName: 'Emily' } })).id;
    expect(await outcome(line({ workerId: w2, totalPayCents: 1 }))).toMatch(/run_lines_values/);
    expect(await outcome(line({ workerId: w2 }))).toBe('ok');
    const other = await as(A).service.create({
      data: { businessId: A.id, kind: 'PAYROLL', name: 'Second payroll' },
    });
    const e = { businessId: A.id, clientId: A.client, serviceId: other.id, title: 'Other' };
    const eng = await as(A).engagement.create({ data: e });
    const pc2 = await as(A).payrollClient.create({
      data: { businessId: A.id, clientId: A.client, engagementId: eng.id },
    });
    const stray = await as(A).payrollWorker.create({
      data: { ...w, payrollClientId: pc2.id, displayName: 'Stray' },
    });
    expect(await outcome(line({ workerId: stray.id }))).toMatch(/PAYROLL_LINE_WORKER/);
  });
  it('are locked once the run is ready for review', async () => {
    const now = new Date();
    await as(A).payrollRun.update({
      where: { id: run },
      data: { status: 'READY_FOR_REVIEW', readyAt: now },
    });
    expect(await outcome(as(A).payrollRunLine.updateMany({ data: { note: 'late' } }))).toMatch(
      /PAYROLL_RUN_LOCKED/,
    );
    expect(await outcome(as(A).payrollRunLine.deleteMany())).toMatch(/PAYROLL_RUN_LOCKED/);
  });
});

describe('issues and approval', () => {
  it('block approval while an error is open, then allow it', async () => {
    const err = await issue({
      severity: 'ERROR',
      code: 'bank_validation',
      message: 'Bank validation is pending.',
    });
    const approve = () =>
      outcome(
        as(A).payrollRun.update({
          where: { id: run },
          data: { status: 'APPROVED', approvedAt: new Date(), approvedByUserId: A.owner },
        }),
      );
    expect(await approve()).toMatch(/PAYROLL_RUN_BLOCKED/);
    const resolve = { resolvedAt: new Date(), resolvedByUserId: A.owner };
    expect(
      await outcome(
        as(A).payrollRunIssue.update({ where: { id: err.id }, data: { message: 'Changed' } }),
      ),
    ).toMatch(/PAYROLL_ISSUE_FROZEN/);
    expect(
      await outcome(as(A).payrollRunIssue.update({ where: { id: err.id }, data: resolve })),
    ).toBe('ok');
    expect(await approve()).toBe('ok');
  });
  it('carry short messages without long numbers', async () => {
    expect(await outcome(issue({ message: 'Account 123456789 failed' }))).toMatch(
      /run_issues_values/,
    );
  });
});
