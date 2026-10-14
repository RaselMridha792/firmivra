// Bookkeeping, part 4 (R38): report preparation, review and delivery. Isolation between firms
// and the rules of migration r38_bookkeeping_reports. Runs as the app role under RLS.
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import {
  connect,
  createEngagement,
  createTwoFirms,
  failure,
  type TwoFirms,
} from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
let eng: string; // a bookkeeping engagement of firm A with a profile
const A = () => db.forBusiness(f.firmA);
const now = () => new Date();
let n = 0;
const report = (data: Record<string, unknown> = {}) =>
  A().bookkeepingReport.create({
    data: {
      businessId: f.firmA,
      engagementId: eng,
      reportType: 'PROFIT_LOSS',
      periodLabel: `Period ${++n}`,
      ...data,
    },
  });
const set = (id: string, data: Record<string, unknown>) =>
  A().bookkeepingReport.update({ where: { id }, data });
/** An engagement report of `engagementId`, published or not (the owner role, as the app's own flow). */
const engagementReport = (businessId: string, engagementId: string, published: boolean) =>
  runInScope(owner, { kind: 'business', businessId }, (tx) =>
    tx.engagementReport.create({
      data: {
        businessId,
        engagementId,
        kind: 'REPORT',
        title: 'Report (fake)',
        ...(published ? { status: 'PUBLISHED', publishedAt: now() } : {}),
      },
    }),
  );

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r38br');
  eng = await createEngagement(owner, f.firmA, f.clientA);
  await A().bookkeepingProfile.create({ data: { businessId: f.firmA, engagementId: eng } });
});

describe('isolation', () => {
  it('another firm sees no report row, and cannot use its engagement report', async () => {
    const er = await engagementReport(f.firmA, eng, true);
    await report({ engagementReportId: er.id });
    expect(await db.forBusiness(f.firmB).bookkeepingReport.findMany()).toEqual([]);
    const engB = await createEngagement(owner, f.firmB, f.clientB);
    await db.forBusiness(f.firmB).bookkeepingProfile.create({
      data: { businessId: f.firmB, engagementId: engB },
    });
    expect(
      await failure(
        db.forBusiness(f.firmB).bookkeepingReport.create({
          data: {
            businessId: f.firmB,
            engagementId: engB,
            reportType: 'PROFIT_LOSS',
            periodLabel: 'x',
            engagementReportId: er.id,
          },
        }),
      ),
    ).toMatch(/same client's|unique/i);
  });
});

describe('reports', () => {
  it('are one per client, type and period, and custom ones are named', async () => {
    const r = await report({ reportType: 'BALANCE_SHEET', periodLabel: 'Q3 2026' });
    expect(
      await failure(report({ reportType: 'BALANCE_SHEET', periodLabel: r.periodLabel })),
    ).toMatch(/unique/i);
    await expect(
      report({ reportType: 'BALANCE_SHEET', periodLabel: 'Q4 2026' }),
    ).resolves.toBeTruthy();
    for (const data of [
      { reportType: 'CUSTOM' },
      { customName: 'Owner draw summary' },
      { reportType: 'CUSTOM', customName: ' ' },
      { periodLabel: ' ' },
      { reviewNote: 'x'.repeat(1001) },
    ]) {
      expect(await failure(report(data))).toMatch(/check constraint/i);
    }
    await expect(
      report({ reportType: 'CUSTOM', customName: 'Owner draw summary', periodLabel: 'Q3 2026' }),
    ).resolves.toBeTruthy();
  });

  it('belong to a client with a profile, and a period of the same client', async () => {
    const bare = await createEngagement(owner, f.firmA, f.clientA);
    expect(await failure(report({ engagementId: bare }))).toMatch(/bookkeeping profile/);
    const otherEng = await createEngagement(owner, f.firmA, f.clientA);
    await A().bookkeepingProfile.create({ data: { businessId: f.firmA, engagementId: otherEng } });
    const otherPeriod = await A().bookkeepingPeriod.create({
      data: {
        businessId: f.firmA,
        engagementId: otherEng,
        label: 'Sep 2026',
        periodStart: new Date('2026-09-01'),
        periodEnd: new Date('2026-09-30'),
      },
    });
    expect(await failure(report({ periodId: otherPeriod.id }))).toMatch(
      /period must be the same client's/,
    );
  });

  it('go through preparation, review and delivery in order', async () => {
    const r = await report();
    expect(await failure(set(r.id, { status: 'APPROVED' }))).toMatch(/cannot become/);
    await set(r.id, { status: 'IN_PROGRESS' });
    expect(await failure(set(r.id, { status: 'IN_REVIEW' }))).toMatch(/check constraint/i); // needs generated_at
    await set(r.id, { status: 'IN_REVIEW', generatedAt: now(), generatedByUserId: f.memberA });
    expect(await failure(set(r.id, { status: 'APPROVED' }))).toMatch(/check constraint/i); // needs the review
    await set(r.id, { status: 'APPROVED', reviewedAt: now(), reviewedByUserId: f.member2A });
    expect(await failure(set(r.id, { status: 'DELIVERED', deliveredAt: now() }))).toMatch(
      /check constraint/i,
    ); // needs a report
  });

  it('a send-back clears the review', async () => {
    const r = await report({ status: 'IN_REVIEW', generatedAt: now() });
    await set(r.id, { status: 'APPROVED', reviewedAt: now(), reviewedByUserId: f.memberA });
    await expect(set(r.id, { status: 'IN_PROGRESS' })).resolves.toMatchObject({
      reviewedAt: null,
      reviewedByUserId: null,
    });
  });
});

describe('delivery', () => {
  const approved = (engagementReportId?: string) =>
    report({
      status: 'APPROVED',
      generatedAt: now(),
      reviewedAt: now(),
      ...(engagementReportId ? { engagementReportId } : {}),
    });
  const deliver = (id: string) =>
    set(id, { status: 'DELIVERED', deliveredAt: now(), deliveredByUserId: f.memberA });

  it('needs a published report of the same client, once', async () => {
    const draft = await engagementReport(f.firmA, eng, false);
    const r = await approved(draft.id);
    expect(await failure(deliver(r.id))).toMatch(/publish the report/);
    const other = await createEngagement(owner, f.firmA, f.clientA);
    const foreign = await engagementReport(f.firmA, other, true);
    expect(await failure(approved(foreign.id))).toMatch(/same client's/);
    const published = await engagementReport(f.firmA, eng, true);
    const r2 = await approved(published.id);
    expect(await failure(approved(published.id))).toMatch(/unique/i);
    await expect(deliver(r2.id)).resolves.toMatchObject({ status: 'DELIVERED' });
  });

  it('freezes the row once delivered', async () => {
    const published = await engagementReport(f.firmA, eng, true);
    const r = await approved(published.id);
    await deliver(r.id);
    for (const data of [{ reviewNote: 'late' }, { status: 'IN_PROGRESS' }, { dueOn: new Date() }]) {
      expect(await failure(set(r.id, data))).toMatch(/frozen/);
    }
  });
});
