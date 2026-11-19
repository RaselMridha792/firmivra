// Automations Review Two R11-R13 (R56, Nov 19; migration r56_automation_policies): the firm-wide
// missed-run policy and window, the rule conflict policy, and the emergency pause on
// automation_settings. Defaults keep today's behaviour, a pause names who paused and only while
// paused, and one firm's settings are never another's. Runs as the app role under RLS.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const urls = inject('dbUrls');
const { owner, db } = connect(urls);
/** The app role without the tenant client, for SQL the client would never write. */
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);
const policies = {
  missedRunPolicy: true,
  missedRunWindowDays: true,
  conflictPolicy: true,
  pausedAt: true,
  pausedByUserId: true,
} as const;
const sql = (statement: string, ...values: unknown[]) =>
  failure(
    runInScope(app, { kind: 'business', businessId: f.firmA }, (tx) =>
      tx.$executeRawUnsafe(statement, ...values),
    ),
  );

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r56aup');
  await A().automationSettings.create({ data: { businessId: f.firmA } });
  await B().automationSettings.create({ data: { businessId: f.firmB } });
});

afterAll(async () => {
  await app.$disconnect();
});

describe('the defaults keep today’s behaviour', () => {
  it('runs a missed occurrence once, honours priority then age, and is not paused', async () => {
    await expect(
      A().automationSettings.findUniqueOrThrow({
        where: { businessId: f.firmA },
        select: policies,
      }),
    ).resolves.toEqual({
      missedRunPolicy: 'RUN_ONCE',
      missedRunWindowDays: 7,
      conflictPolicy: 'PRIORITY_THEN_OLDEST',
      pausedAt: null,
      pausedByUserId: null,
    });
  });
});

describe('the firm’s choices', () => {
  it('saves each policy, and a pause with who paused; resuming clears both', async () => {
    const at = new Date('2026-11-19T15:00:00.000Z');
    await expect(
      A().automationSettings.update({
        where: { businessId: f.firmA },
        data: {
          missedRunPolicy: 'REPLAY_WINDOW',
          missedRunWindowDays: 30,
          conflictPolicy: 'SKIP_BOTH',
          pausedAt: at,
          pausedByUserId: f.memberA,
        },
        select: policies,
      }),
    ).resolves.toEqual({
      missedRunPolicy: 'REPLAY_WINDOW',
      missedRunWindowDays: 30,
      conflictPolicy: 'SKIP_BOTH',
      pausedAt: at,
      pausedByUserId: f.memberA,
    });
    await expect(
      A().automationSettings.update({
        where: { businessId: f.firmA },
        data: { pausedAt: null, pausedByUserId: null, missedRunPolicy: 'SKIP' },
        select: { missedRunPolicy: true, pausedAt: true, pausedByUserId: true },
      }),
    ).resolves.toEqual({ missedRunPolicy: 'SKIP', pausedAt: null, pausedByUserId: null });
  });

  it('refuses a window outside 1 to 90 days, and a pause without who paused (or the reverse)', async () => {
    for (const days of [0, 91])
      expect(
        await sql(
          'UPDATE automation_settings SET missed_run_window_days = $2 WHERE business_id = $1::uuid',
          f.firmA,
          days,
        ),
      ).toMatch(/automation_settings_policies|23514/);
    expect(
      await sql(
        'UPDATE automation_settings SET paused_at = now(), paused_by_user_id = NULL WHERE business_id = $1::uuid',
        f.firmA,
      ),
    ).toMatch(/automation_settings_policies|23514/);
    expect(
      await sql(
        'UPDATE automation_settings SET paused_at = NULL, paused_by_user_id = $2::uuid WHERE business_id = $1::uuid',
        f.firmA,
        f.memberA,
      ),
    ).toMatch(/automation_settings_policies|23514/);
  });

  it('refuses a policy that is not one of the choices, and NULL', async () => {
    expect(
      await sql(
        "UPDATE automation_settings SET conflict_policy = 'LAST_WINS' WHERE business_id = $1::uuid",
        f.firmA,
      ),
    ).toMatch(/invalid input value|22P02/i);
    expect(
      await sql(
        'UPDATE automation_settings SET missed_run_policy = NULL WHERE business_id = $1::uuid',
        f.firmA,
      ),
    ).toMatch(/null value|not-null|23502/i);
  });
});

describe('isolation', () => {
  it("firm B never sees or changes firm A's policies, and keeps its own", async () => {
    expect(await B().automationSettings.findMany({ where: { businessId: f.firmA } })).toEqual([]);
    const changed = await B().automationSettings.updateMany({
      where: { businessId: f.firmA },
      data: { conflictPolicy: 'PRIORITY_THEN_OLDEST' },
    });
    expect(changed.count).toBe(0);
    await expect(
      B().automationSettings.findUniqueOrThrow({
        where: { businessId: f.firmB },
        select: { conflictPolicy: true, pausedAt: true },
      }),
    ).resolves.toEqual({ conflictPolicy: 'PRIORITY_THEN_OLDEST', pausedAt: null });
  });
});
