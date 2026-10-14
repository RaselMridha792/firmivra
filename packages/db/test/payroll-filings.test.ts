// Payroll filings, reports and year-end (r39_payroll_filings): firm-only rows, no false filing
// claims, report versions that stay, a document of the same firm, and year-end rules.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { r39Fixtures } from './r39-fixtures.js';

const { A, B, as, setup, close, outcome } = r39Fixtures(inject('dbUrls'));
let pc = '';
const q3 = { periodStart: new Date('2026-07-01'), periodEnd: new Date('2026-09-30') };
const filing = (data: object = {}) =>
  as(A).payrollFiling.create({
    data: {
      businessId: A.id,
      payrollClientId: pc,
      form: '941',
      jurisdiction: 'federal',
      ...q3,
      ...data,
    } as never,
  });
const report = (data: object = {}) =>
  as(A).payrollReport.create({
    data: {
      businessId: A.id,
      payrollClientId: pc,
      kind: 'REGISTER',
      source: 'provider',
      ...q3,
      ...data,
    } as never,
  });
const yearEnd = (data: object = {}) =>
  as(A).payrollYearEnd.create({
    data: { businessId: A.id, payrollClientId: pc, taxYear: 2026, ...data } as never,
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

describe('row-level security', () => {
  it("hides another firm's rows and refuses links across firms", async () => {
    await filing();
    await report();
    await yearEnd();
    expect(await as(B).payrollFiling.findMany()).toEqual([]);
    expect(await as(B).payrollReport.findMany()).toEqual([]);
    expect(await as(B).payrollYearEnd.findMany()).toEqual([]);
    const f = as(B).payrollFiling.create({
      data: { businessId: B.id, payrollClientId: pc, form: '941', jurisdiction: 'federal', ...q3 },
    });
    expect(await outcome(f)).toMatch(/Foreign key|Unique/);
  });
});

describe('filings', () => {
  it('are filed or paid only when the source confirmed it', async () => {
    expect(await outcome(filing({ form: '940', status: 'FILED' }))).toMatch(/filings_values/);
    const confirmed = { confirmedAt: new Date(), source: 'provider', sourceSyncedAt: new Date() };
    expect(await outcome(filing({ form: '940', status: 'FILED', ...confirmed }))).toBe('ok');
    expect(await outcome(filing({ form: 'W-2', paymentStatus: 'PAID' }))).toMatch(/filings_values/);
    expect(await outcome(filing())).toMatch(/Unique/i);
    expect(await outcome(as(A).payrollFiling.deleteMany())).toMatch(/permission denied/);
  });
});

describe('reports', () => {
  it('stay as versions, insert-only, for the right run and a document of the firm', async () => {
    expect(await outcome(report())).toMatch(/Unique/i);
    expect(await outcome(report({ version: 2 }))).toBe('ok');
    expect(await outcome(report({ kind: 'JOURNAL', source: 'scraped' }))).toMatch(/reports_values/);
    expect(await outcome(report({ kind: 'JOURNAL', documentId: A.client }))).toMatch(
      /PAYROLL_REPORT_DOCUMENT/,
    );
    expect(await outcome(report({ kind: 'LABOR', runId: A.client }))).toMatch(
      /Foreign key|PAYROLL_REPORT_RUN/,
    );
    expect(await outcome(as(A).payrollReport.updateMany({ data: { version: 9 } }))).toMatch(
      /permission denied/,
    );
  });
});

describe('year-end', () => {
  it('is one per client and year, with the facts its status needs', async () => {
    expect(await outcome(yearEnd())).toMatch(/Unique/i);
    expect(await outcome(yearEnd({ taxYear: 2027, status: 'RECONCILED' }))).toMatch(
      /year_ends_values/,
    );
    expect(
      await outcome(yearEnd({ taxYear: 2028, status: 'DELIVERED', reconciledAt: new Date() })),
    ).toMatch(/year_ends_values/);
    const done = { status: 'DELIVERED', reconciledAt: new Date(), deliveredAt: new Date() };
    expect(await outcome(yearEnd({ taxYear: 2029, ...done }))).toBe('ok');
    expect(await outcome(yearEnd({ taxYear: 1999 }))).toMatch(/year_ends_values/);
  });
});
