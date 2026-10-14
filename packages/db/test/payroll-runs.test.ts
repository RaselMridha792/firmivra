// Payroll runs (r39_payroll_runs): firm-only rows, sums that add up, a workflow that moves
// along with a reason to reopen, and completed runs that never change.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { r39Fixtures } from './r39-fixtures.js';

const { A, B, as, setup, close, outcome } = r39Fixtures(inject('dbUrls'));
let pc = '';
let n = 0;
const day = (d: number) => new Date(Date.UTC(2026, 8, d));
const run = (data: object = {}, f = A, client = pc) =>
  as(f).payrollRun.create({
    data: {
      businessId: f.id,
      payrollClientId: client,
      periodStart: day(1 + n),
      periodEnd: day(15 + n++),
      payDate: day(19),
      frequency: 'SEMI_MONTHLY',
      ...data,
    } as never,
  });
const figures = {
  regularPayCents: 4421500,
  overtimePayCents: 312000,
  otherEarningsCents: 128500,
  grossCents: 4862000,
};

beforeAll(async () => {
  await setup('PAYROLL');
  pc = (
    await as(A).payrollClient.create({
      data: { businessId: A.id, clientId: A.client, engagementId: A.eng },
    })
  ).id;
});
afterAll(close);

describe('row-level security', () => {
  it("hides another firm's rows and refuses links across firms", async () => {
    await run();
    expect(await as(B).payrollRun.findMany()).toEqual([]);
    expect(await outcome(run({}, B))).toMatch(/Foreign key/);
  });
});

describe('runs', () => {
  it('check the sums wherever the parts are there, and never negative money', async () => {
    expect(await outcome(run(figures))).toBe('ok');
    expect(await outcome(run({ ...figures, grossCents: 1 }))).toMatch(/payroll_runs_values/);
    expect(
      await outcome(
        run({ ...figures, employeeTaxesCents: 689000, deductionsCents: 315000, netCents: 3858000 }),
      ),
    ).toBe('ok');
    expect(
      await outcome(
        run({ ...figures, employeeTaxesCents: 689000, deductionsCents: 315000, netCents: 1 }),
      ),
    ).toMatch(/payroll_runs_values/);
    expect(
      await outcome(
        run({
          employerTaxesCents: 492000,
          employerBenefitsCents: 188000,
          employerCostsCents: 880000,
        }),
      ),
    ).toMatch(/payroll_runs_values/);
    expect(await outcome(run({ regularPayCents: -5 }))).toMatch(/payroll_runs_values/);
    expect(await outcome(run({ figuresConfirmed: true }))).toMatch(/payroll_runs_values/);
  });
  it('keep one run per client and period, and a period that makes sense', async () => {
    const dup = { periodStart: day(1), periodEnd: day(15) };
    expect(await outcome(run(dup))).toMatch(/Unique/i);
    expect(await outcome(run({ periodStart: day(20), periodEnd: day(10) }))).toMatch(
      /payroll_runs_values/,
    );
  });
  it('move along the workflow, with approval facts and a reason to reopen', async () => {
    const r = await run();
    const set = (data: object) => outcome(as(A).payrollRun.update({ where: { id: r.id }, data }));
    const now = new Date();
    expect(await set({ status: 'APPROVED' })).toMatch(/PAYROLL_RUN_STATUS/);
    expect(await set({ status: 'IN_PROGRESS', step: 3 })).toBe('ok');
    expect(await set({ status: 'READY_FOR_REVIEW' })).toMatch(/payroll_runs_values/);
    expect(await set({ status: 'READY_FOR_REVIEW', readyAt: now })).toBe('ok');
    expect(await set({ status: 'APPROVED', approvedAt: now, approvedByUserId: A.owner })).toBe(
      'ok',
    );
    expect(await set({ status: 'IN_PROGRESS' })).toMatch(/PAYROLL_RUN_REOPEN/);
    expect(
      await set({ status: 'IN_PROGRESS', reopenedAt: now, reopenReason: 'Hours changed' }),
    ).toBe('ok');
  });
  it('never change once completed', async () => {
    const now = new Date();
    const r = await run({
      status: 'COMPLETED',
      readyAt: now,
      approvedAt: now,
      approvedByUserId: A.owner,
      submittedAt: now,
      completedAt: now,
    });
    const edit = as(A).payrollRun.update({ where: { id: r.id }, data: { employeeCount: 3 } });
    expect(await outcome(edit)).toMatch(/PAYROLL_RUN_COMPLETED/);
    expect(await outcome(as(A).payrollRun.delete({ where: { id: r.id } }))).toMatch(
      /permission denied/,
    );
  });
});
