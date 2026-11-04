// The QA seed (R1; Rasel's card "Approve seed", Oct 29): it runs twice without a second row, seeds
// LVP and Test Firm B with their own rows, leaves every row in a state no job sends from, never
// touches a row it did not make (a stand-in for Octavia's SAL QA report and a client of the firm),
// and a firm never sees the other firm's fixtures. Seeds the test database as the owner role.
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { QA_FIRMS, QA_USER, qaId, seedQa } from '../prisma/seed-qa-data.js';
import { connect } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
const firms: Record<string, string> = {};
const kept = { report: '', client: '' };
const LATER = new Date('2098-01-01T00:00:00Z');
/** Every fixed id the seed can use in a firm (UUID columns take no prefix match). */
const qaIds = (digit: number) => Array.from({ length: 600 }, (_, n) => qaId(digit, n));

/** Counts of the fixture tables in one firm, as its own tenant client sees them. */
async function counts(businessId: string) {
  const t = db.forBusiness(businessId);
  const where = { businessId };
  return {
    calendars: await t.complianceCalendar.count({ where }),
    deadlines: await t.complianceDeadline.count({ where }),
    runs: await t.automationRun.count({ where }),
    campaigns: await t.communication.count({ where }),
    schedules: await t.reportSchedule.count({ where }),
    connections: await t.integrationConnection.count({ where }),
  };
}

beforeAll(async () => {
  for (const { slug } of QA_FIRMS) {
    firms[slug] = await runInScope(owner, { kind: 'platform' }, async (tx) => {
      const found = await tx.business.findUnique({ where: { slug }, select: { id: true } });
      if (found) return found.id;
      const made = await tx.business.create({
        data: { slug, name: `${slug} (test)`, status: 'ACTIVE' },
        select: { id: true },
      });
      return made.id;
    });
  }
  // Stand-ins for rows the seed must never touch: a report of Octavia's and a client of the firm.
  await runInScope(owner, { kind: 'business', businessId: firms['lvp']! }, async (tx) => {
    const ownerUser = await tx.user.create({
      data: {
        cognitoSub: `qa-kept-${Date.now()}`,
        pool: 'STAFF',
        email: `kept-${Date.now()}@example.test`,
        name: 'Kept Owner (fake)',
      },
    });
    await tx.membership.create({
      data: { businessId: firms['lvp']!, userId: ownerUser.id, role: 'OWNER', status: 'ACTIVE' },
    });
    kept.report = (
      await tx.reportDefinition.create({
        data: {
          businessId: firms['lvp']!,
          category: 'FINANCIAL',
          dataSource: 'invoices_payments',
          name: `SAL QA Reports 2026-10-28 (${Date.now()})`,
          columns: ['client_name'],
          datePreset: 'this_year',
          ownerUserId: ownerUser.id,
        },
      })
    ).id;
    kept.client = (
      await tx.client.create({
        data: { businessId: firms['lvp']!, displayName: 'Kept client profile (fake)' },
      })
    ).id;
  });
});

describe('the QA seed', () => {
  it('seeds both firms, and a second run adds and changes nothing', async () => {
    const reportBefore = await runInScope(
      owner,
      { kind: 'business', businessId: firms['lvp']! },
      (tx) => tx.reportDefinition.findUniqueOrThrow({ where: { id: kept.report } }),
    );
    const first = await seedQa(owner);
    expect(first).toEqual({ seeded: ['lvp', 'test-firm-b'], missing: [] });
    const after = { lvp: await counts(firms['lvp']!), b: await counts(firms['test-firm-b']!) };
    for (const c of Object.values(after)) {
      expect(c.calendars).toBeGreaterThanOrEqual(10);
      expect(c.deadlines).toBeGreaterThanOrEqual(10);
      expect(c.runs).toBeGreaterThanOrEqual(7);
      expect(c.campaigns).toBeGreaterThanOrEqual(6);
      expect(c.schedules).toBeGreaterThanOrEqual(3);
      expect(c.connections).toBeGreaterThanOrEqual(4);
    }

    await expect(seedQa(owner)).resolves.toEqual({ seeded: ['lvp', 'test-firm-b'], missing: [] });
    expect({ lvp: await counts(firms['lvp']!), b: await counts(firms['test-firm-b']!) }).toEqual(
      after,
    );
    // Rows it did not make are untouched.
    await runInScope(owner, { kind: 'business', businessId: firms['lvp']! }, async (tx) => {
      await expect(
        tx.reportDefinition.findUniqueOrThrow({ where: { id: kept.report } }),
      ).resolves.toEqual(reportBefore);
      await expect(
        tx.client.findUniqueOrThrow({ where: { id: kept.client } }),
      ).resolves.toMatchObject({ displayName: 'Kept client profile (fake)' });
    });
  });

  it('leaves nothing any job would send', async () => {
    for (const { slug, digit } of QA_FIRMS) {
      const businessId = firms[slug]!;
      await runInScope(owner, { kind: 'business', businessId }, async (tx) => {
        const where = { businessId, id: { in: qaIds(digit) } };
        // The fixture member holds no seat; there is no Cognito user behind it.
        await expect(
          tx.membership.findUniqueOrThrow({ where: { id: qaId(digit, 1) } }),
        ).resolves.toMatchObject({ userId: QA_USER.id, status: 'DEACTIVATED' });
        // Automations: no rule the engine scans, no pending action due before 2099.
        expect(await tx.automationRule.count({ where: { ...where, status: 'ACTIVE' } })).toBe(0);
        expect(
          await tx.automationActionExecution.count({
            where: {
              ...where,
              status: 'PENDING',
              OR: [{ scheduledFor: null }, { scheduledFor: { lt: LATER } }],
            },
          }),
        ).toBe(0);
        // Communications: nothing sending, nobody queued, the scheduled ones wait until 2099.
        expect(await tx.communication.count({ where: { ...where, status: 'SENDING' } })).toBe(0);
        expect(
          await tx.communicationRecipient.count({ where: { ...where, status: 'QUEUED' } }),
        ).toBe(0);
        expect(
          await tx.communication.count({
            where: { ...where, status: 'SCHEDULED', scheduledFor: { lt: LATER } },
          }),
        ).toBe(0);
        // Reports: no next run before 2099, and only the fixture member receives.
        expect(
          await tx.reportSchedule.count({ where: { ...where, nextRunAt: { lt: LATER } } }),
        ).toBe(0);
        expect(
          await tx.reportScheduleRecipient.count({
            where: { ...where, NOT: { userId: QA_USER.id } },
          }),
        ).toBe(0);
        // Integrations: no secret and no scheduled sync.
        expect(
          await tx.integrationConnection.count({
            where: { ...where, OR: [{ secretRef: { not: null } }, { nextSyncAt: { not: null } }] },
          }),
        ).toBe(0);
        // Compliance: no reminders on the fixture deadlines.
        expect(
          await tx.complianceDeadlineReminder.count({
            where: { businessId, deadlineId: { in: qaIds(digit) } },
          }),
        ).toBe(0);
      });
    }
  });
});

describe('isolation', () => {
  it("a firm never sees the other firm's fixtures", async () => {
    const lvp = db.forBusiness(firms['lvp']!);
    const b = db.forBusiness(firms['test-firm-b']!);
    for (const [tenant, other] of [
      [lvp, qaIds(1)],
      [b, qaIds(0)],
    ] as const) {
      const where = { id: { in: other } };
      expect(await tenant.complianceDeadline.findMany({ where })).toEqual([]);
      expect(await tenant.automationRun.findMany({ where })).toEqual([]);
      expect(await tenant.communication.findMany({ where })).toEqual([]);
      expect(await tenant.reportSchedule.findMany({ where })).toEqual([]);
      expect(await tenant.integrationConnection.findMany({ where })).toEqual([]);
      expect(await tenant.client.findMany({ where })).toEqual([]);
    }
    const { count } = await b.communication.updateMany({
      where: { id: qaId(0, 320) },
      data: { name: 'Changed by firm B' },
    });
    expect(count).toBe(0);
  });
});
