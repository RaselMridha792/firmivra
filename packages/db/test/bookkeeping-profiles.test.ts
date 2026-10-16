// Bookkeeping, part 1 (R38): the firm's settings, the profile of a Bookkeeping engagement and
// its activity history. Isolation between firms and the rules of migration
// r38_bookkeeping_profiles. Runs as the app role under RLS.
import { beforeAll, describe, expect, inject, it } from 'vitest';
import {
  connect,
  createEngagement,
  createTwoFirms,
  failure,
  type TwoFirms,
} from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);
const profile = async (data: Record<string, unknown> = {}) =>
  A().bookkeepingProfile.create({
    data: {
      businessId: f.firmA,
      engagementId: await createEngagement(owner, f.firmA, f.clientA),
      ...data,
    },
  });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r38bp');
});

describe('isolation', () => {
  it('another firm sees no settings, profile or activity', async () => {
    const p = await profile();
    await A().bookkeepingSettings.create({ data: { businessId: f.firmA } });
    await A().bookkeepingActivity.create({
      data: {
        businessId: f.firmA,
        engagementId: p.engagementId,
        kind: 'NOTE',
        summary: 'Called client',
      },
    });
    const B = db.forBusiness(f.firmB);
    expect(await B.bookkeepingSettings.findMany()).toEqual([]);
    expect(await B.bookkeepingProfile.findMany()).toEqual([]);
    expect(await B.bookkeepingActivity.findMany()).toEqual([]);
    expect(
      await failure(
        B.bookkeepingProfile.create({
          data: { businessId: f.firmA, engagementId: p.engagementId },
        }),
      ),
    ).toMatch(/row-level security|violates|Bookkeeping service/i);
  });

  it("a profile cannot use another firm's engagement or reviewer", async () => {
    const engB = await createEngagement(owner, f.firmB, f.clientB);
    expect(await failure(profile({ engagementId: engB }))).toMatch(
      /foreign key|Bookkeeping service/i,
    );
    expect(await failure(profile({ reviewerUserId: f.memberB }))).toMatch(/foreign key/i);
  });
});

describe('profiles', () => {
  it('belong to a Bookkeeping engagement, one each, and keep it', async () => {
    const tax = await createEngagement(owner, f.firmA, f.clientA, 'ANNUAL_TAX');
    expect(await failure(profile({ engagementId: tax }))).toMatch(/Bookkeeping service/);
    const p = await profile();
    expect(
      await failure(
        A().bookkeepingProfile.create({
          data: { businessId: f.firmA, engagementId: p.engagementId },
        }),
      ),
    ).toMatch(/unique/i);
    expect(
      await failure(
        A().bookkeepingProfile.update({ where: { id: p.id }, data: { engagementId: tax } }),
      ),
    ).toMatch(/cannot move/);
  });

  it('starts NOT_STARTED and AUTOMATIC, and dates a status change', async () => {
    const p = await profile();
    expect(p).toMatchObject({
      status: 'NOT_STARTED',
      statusSource: 'AUTOMATIC',
      cadence: 'MONTHLY',
    });
    await new Promise((r) => setTimeout(r, 20));
    const same = await A().bookkeepingProfile.update({
      where: { id: p.id },
      data: { statusReason: 'x' },
    });
    expect(same.statusChangedAt).toEqual(p.statusChangedAt);
    const changed = await A().bookkeepingProfile.update({
      where: { id: p.id },
      data: {
        status: 'MISSING_DOCUMENTS',
        statusSource: 'MANUAL',
        statusReason: '3 documents outstanding',
      },
    });
    expect(changed.statusChangedAt.getTime()).toBeGreaterThan(p.statusChangedAt.getTime());
  });

  it('checks the cadence, close day, text and JSON shapes, and a pause reason', async () => {
    for (const data of [
      { cadence: 'CUSTOM' },
      { cadenceMonths: 3 },
      { cadence: 'CUSTOM', cadenceMonths: 25 },
      { closeTargetDay: 29 },
      { statusReason: 'x'.repeat(301) },
      { portalDefaults: [] },
      { alerts: [] },
      { categorizationRules: {} },
      { reportSchedule: {} },
      { pausedAt: new Date() },
    ]) {
      expect(await failure(profile(data))).toMatch(/check constraint/i);
    }
    await expect(profile({ cadence: 'CUSTOM', cadenceMonths: 2 })).resolves.toBeTruthy();
    await expect(
      profile({ pausedAt: new Date(), pauseReason: 'Client on hold', reviewerUserId: f.member2A }),
    ).resolves.toBeTruthy();
  });
});

describe('activity', () => {
  it('is insert-only, short, and only for an engagement with a profile', async () => {
    const p = await profile();
    const add = (data: Record<string, unknown> = {}, engagementId = p.engagementId) =>
      A().bookkeepingActivity.create({
        data: {
          businessId: f.firmA,
          engagementId,
          kind: 'SYNC',
          summary: 'Sync finished',
          ...data,
        },
      });
    const row = await add({ details: { from: 'ON_TRACK', to: 'OVERDUE' } });
    expect(
      await failure(
        A().bookkeepingActivity.update({ where: { id: row.id }, data: { summary: 'x' } }),
      ),
    ).toMatch(/permission denied/i);
    expect(await failure(A().bookkeepingActivity.delete({ where: { id: row.id } }))).toMatch(
      /permission denied/i,
    );
    for (const data of [{ summary: ' ' }, { summary: 'x'.repeat(301) }, { details: [] }]) {
      expect(await failure(add(data))).toMatch(/check constraint/i);
    }
    const bare = await createEngagement(owner, f.firmA, f.clientA);
    expect(await failure(add({}, bare))).toMatch(/bookkeeping profile/);
  });
});

describe('settings', () => {
  it('has one row per firm with sane limits and JSON shapes', async () => {
    await expect(
      A().bookkeepingSettings.findUniqueOrThrow({ where: { businessId: f.firmA } }),
    ).resolves.toMatchObject({
      defaultCadence: 'MONTHLY',
      closeTargetDay: 10,
      reconToleranceCents: 0,
    });
    expect(
      await failure(A().bookkeepingSettings.create({ data: { businessId: f.firmA } })),
    ).toMatch(/unique/i);
    const set = (data: Record<string, unknown>) =>
      A().bookkeepingSettings.update({ where: { businessId: f.firmA }, data });
    for (const data of [
      { closeTargetDay: 0 },
      { closeTargetDay: 29 },
      { upcomingReportDays: 0 },
      { staleSyncHours: 721 },
      { reconToleranceCents: -1 },
      { statusRules: [] },
      { closeChecklist: {} },
      { closeChecklist: new Array(31).fill({ key: 'x' }) },
      { reportSchedule: {} },
    ]) {
      expect(await failure(set(data))).toMatch(/check constraint/i);
    }
    await expect(set({ closeTargetDay: 15, defaultCadence: 'QUARTERLY' })).resolves.toMatchObject({
      closeTargetDay: 15,
    });
  });
});
