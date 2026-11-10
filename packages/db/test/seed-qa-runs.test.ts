// QA seed part 3 (R1, Nov 10; R55's AU-Y18): a paused rule on client.created with four runs (success,
// failure, skipped, waiting) and their eight actions for LVP; part 1's paused rule gets a version 2
// with the real action types. Runs twice without a second row, leaves nothing the engine would run,
// and another firm sees none of it. Seeds the test database as the owner role.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { qaId, seedQa } from '../prisma/seed-qa-data.js';
import { qaExtraId, seedQaExtra } from '../prisma/seed-qa-extra.js';
import { seedQaRuns } from '../prisma/seed-qa-runs.js';
import { connect } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
const id = (n: number) => qaExtraId(800 + n);
let lvp = '';
let other = '';

const firm = (slug: string) =>
  runInScope(owner, { kind: 'platform' }, async (tx) => {
    const found = await tx.business.findUnique({ where: { slug }, select: { id: true } });
    return (
      found ??
      (await tx.business.create({
        data: { slug, name: `${slug} (test)`, status: 'ACTIVE' },
        select: { id: true },
      }))
    ).id;
  });

beforeAll(async () => {
  lvp = await firm('lvp');
  other = await firm('test-firm-b');
  const stamp = randomUUID();
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    await tx.user.create({
      data: {
        id: stamp,
        cognitoSub: stamp,
        pool: 'STAFF',
        email: `o-${stamp}@qr.test`,
        name: 'QA3 Owner (fake)',
      },
    });
    if (!(await tx.platformAdmin.findFirst({ where: { role: 'SUPER_ADMIN' } }))) {
      await tx.platformAdmin.create({ data: { userId: stamp } });
    }
  });
  await runInScope(owner, { kind: 'business', businessId: lvp }, async (tx) => {
    if (
      !(await tx.membership.findFirst({
        where: { businessId: lvp, role: 'OWNER', status: 'ACTIVE' },
      }))
    ) {
      await tx.membership.create({
        data: { businessId: lvp, userId: stamp, role: 'OWNER', status: 'ACTIVE' },
      });
    }
  });
  // Parts 1 and 2 first: part 3 runs on part 2's clients and fixes part 1's rule.
  await seedQa(owner);
  await seedQaExtra(owner);
});

describe('QA seed part 3', () => {
  it('seeds once; a second run adds nothing', async () => {
    expect(await seedQaRuns(owner)).toMatch(/seeded|already/);
    expect(await seedQaRuns(owner)).toBe('already');
  });

  it("holds R55's rule, runs and actions", async () => {
    const t = db.forBusiness(lvp);
    await expect(
      t.automationRule.findUniqueOrThrow({ where: { id: id(0) } }),
    ).resolves.toMatchObject({
      status: 'PAUSED',
      currentVersionId: id(1),
    });
    const runs = await t.automationRun.findMany({
      where: { id: { in: [10, 11, 12, 13].map(id) } },
      orderBy: { id: 'asc' },
      select: { status: true, errorCode: true, sourceEventKey: true, clientId: true },
    });
    expect(runs.map((r) => [r.status, r.errorCode])).toEqual([
      ['SUCCESS', null],
      ['FAILED', 'CLIENT_ARCHIVED'],
      ['SKIPPED', 'CONDITION_NOT_MET'],
      ['PENDING', null],
    ]);
    expect(runs[0]!.sourceEventKey).toBe(`client.created:${runs[0]!.clientId}:created`);
    const actions = await t.automationActionExecution.findMany({
      where: { runId: { in: [10, 11, 12, 13].map(id) } },
      select: { actionType: true, status: true, retryable: true, scheduledFor: true },
    });
    expect(actions).toHaveLength(8);
    expect(
      actions.every(
        (a) => !a.retryable && ['ADD_CLIENT_NOTE', 'CREATE_TASK'].includes(a.actionType),
      ),
    ).toBe(true);
  });

  it("gives part 1's paused rule a version 2 with the real action types", async () => {
    const t = db.forBusiness(lvp);
    const rule = await t.automationRule.findUniqueOrThrow({
      where: { id: qaId(0, 200) },
      include: { currentVersion: true },
    });
    expect(rule).toMatchObject({ status: 'PAUSED', currentVersion: { version: 2 } });
    expect((rule.currentVersion!.actions as { type: string }[]).map((a) => a.type)).toEqual([
      'CREATE_TASK',
      'ADD_CLIENT_NOTE',
    ]);
  });

  it('leaves nothing the engine would run', async () => {
    const t = db.forBusiness(lvp);
    expect(await t.automationRule.count({ where: { id: id(0), status: 'ACTIVE' } })).toBe(0);
    expect(
      await t.automationActionExecution.count({
        where: {
          runId: { in: [10, 11, 12, 13].map(id) },
          status: 'PENDING',
          OR: [{ scheduledFor: null }, { scheduledFor: { lt: new Date('2098-01-01') } }],
        },
      }),
    ).toBe(0);
  });
});

describe('isolation', () => {
  it("another firm never sees or changes LVP's log fixtures", async () => {
    const b = db.forBusiness(other);
    expect(await b.automationRule.findMany({ where: { id: id(0) } })).toEqual([]);
    expect(
      await b.automationRun.findMany({ where: { id: { in: [10, 11, 12, 13].map(id) } } }),
    ).toEqual([]);
    const { count } = await b.automationRule.updateMany({
      where: { id: id(0) },
      data: { status: 'ACTIVE' },
    });
    expect(count).toBe(0);
  });
});
