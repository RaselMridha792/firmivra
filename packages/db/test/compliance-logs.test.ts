// Compliance & Deadlines, part 4 (R38): the compliance log and the firm's settings. Isolation
// between firms; the log is insert-only. Runs as the app role under RLS.
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);
const log = (data: Record<string, unknown> = {}) =>
  A().complianceLog.create({
    data: { businessId: f.firmA, kind: 'IMPORT', outcome: 'SUCCESS', ...data },
  });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r38cl');
});

describe('isolation', () => {
  it('another firm sees no log row or settings', async () => {
    await log({ message: 'Imported 12 entries', details: { entries: 12 } });
    await A().complianceSettings.create({ data: { businessId: f.firmA } });
    const B = db.forBusiness(f.firmB);
    expect(await B.complianceLog.findMany()).toEqual([]);
    expect(await B.complianceSettings.findMany()).toEqual([]);
    expect(
      await failure(
        B.complianceLog.create({ data: { businessId: f.firmA, kind: 'ERROR', outcome: 'FAILED' } }),
      ),
    ).toMatch(/row-level security|violates/i);
    expect(await failure(B.complianceSettings.create({ data: { businessId: f.firmA } }))).toMatch(
      /row-level security|violates|unique/i,
    );
  });

  it("a log row cannot point at another firm's calendar, deadline or recurrence", async () => {
    const calB = await db.forBusiness(f.firmB).complianceCalendar.create({
      data: {
        businessId: f.firmB,
        family: 'IRS_GENERAL',
        authority: 'IRS',
        jurisdiction: 'FEDERAL',
        effectiveYear: 2031,
        name: 'B (fake)',
        sourceUrl: 'https://www.irs.gov/',
      },
    });
    expect(await failure(log({ calendarId: calB.id }))).toMatch(/foreign key/i);
  });
});

describe('the log', () => {
  it('is insert-only for the app role', async () => {
    const row = await log();
    expect(
      await failure(A().complianceLog.update({ where: { id: row.id }, data: { message: 'x' } })),
    ).toMatch(/permission denied/i);
    expect(await failure(A().complianceLog.delete({ where: { id: row.id } }))).toMatch(
      /permission denied/i,
    );
  });

  it('keeps messages short and details a small object', async () => {
    for (const data of [
      { message: 'x'.repeat(501) },
      { details: [] },
      { details: { blob: 'x'.repeat(5000) } },
    ]) {
      expect(await failure(log(data))).toMatch(/check constraint/i);
    }
    await expect(
      log({ kind: 'ERROR', outcome: 'FAILED', message: 'Source unreachable' }),
    ).resolves.toBeTruthy();
  });
});

describe('settings', () => {
  it('has one row per firm with sane thresholds', async () => {
    await expect(
      A().complianceSettings.findUniqueOrThrow({ where: { businessId: f.firmA } }),
    ).resolves.toMatchObject({ dueSoonDays: 14, atRiskDays: 7, staleCalendarDays: 90 });
    expect(await failure(A().complianceSettings.create({ data: { businessId: f.firmA } }))).toMatch(
      /unique/i,
    );
    for (const data of [
      { dueSoonDays: 0 },
      { dueSoonDays: 91 },
      { atRiskDays: 0 },
      { staleCalendarDays: 3 },
      { escalateAfterDays: 61 },
      { defaultReminders: {} },
      { defaultReminders: new Array(11).fill({ daysBefore: 1 }) },
      { taskTemplates: [] },
    ]) {
      expect(
        await failure(A().complianceSettings.update({ where: { businessId: f.firmA }, data })),
      ).toMatch(/check constraint/i);
    }
    await expect(
      A().complianceSettings.update({
        where: { businessId: f.firmA },
        data: { dueSoonDays: 30, escalateToManager: true },
      }),
    ).resolves.toMatchObject({ dueSoonDays: 30 });
  });
});
