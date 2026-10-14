// Payroll workers (r39_payroll_workers): firm-only rows under a payroll client, a pay rate only
// with a pay type, one provider id per client, checked text, never deleted.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { r39Fixtures } from './r39-fixtures.js';

const { A, B, as, setup, close, outcome } = r39Fixtures(inject('dbUrls'));
let pc = '';
const worker = (data: object = {}, f = A, client = pc) =>
  as(f).payrollWorker.create({
    data: {
      businessId: f.id,
      payrollClientId: client,
      displayName: 'Jasmine Smith',
      workerType: 'FULL_TIME',
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
});
afterAll(close);

describe('payroll workers', () => {
  it("are hidden from another firm, which cannot add one under this firm's client", async () => {
    await worker();
    expect(await as(B).payrollWorker.findMany()).toEqual([]);
    expect(await outcome(worker({}, B))).toMatch(/Foreign key/);
  });
  it('hold a rate only with a pay type, and one provider id per client', async () => {
    expect(await outcome(worker({ rateCents: 1800 }))).toMatch(/payroll_workers_values/);
    expect(await outcome(worker({ rateCents: 1800, payType: 'HOURLY', externalId: 'w-1' }))).toBe(
      'ok',
    );
    expect(await outcome(worker({ externalId: 'w-1' }))).toMatch(/Unique/i);
  });
  it('check text and source, and are never deleted', async () => {
    expect(await outcome(worker({ displayName: '  ' }))).toMatch(/payroll_workers_values/);
    expect(await outcome(worker({ source: 'scraped' }))).toMatch(/payroll_workers_values/);
    expect(await outcome(as(A).payrollWorker.deleteMany())).toMatch(/permission denied/);
  });
});
