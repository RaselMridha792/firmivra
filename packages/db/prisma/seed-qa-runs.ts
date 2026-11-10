// QA seed, part 3 (R1; Rasel's "Seed + test login" in R1's window, Nov 7, and R55's AU-Y18 list):
// Automation Logs fixtures for LVP. One PAUSED rule (the engine only scans ACTIVE rules) on
// client.created with a note and a task a day later, and four runs of it over four synthetic
// clients: success, failure, skipped and one waiting (its task scheduled for 2099, never runnable).
// No message templates: Rasel's Oct 29 rule, they come from the TP-F18 starters. Also gives part
// 1's paused rule a version 2 with the real action types (CREATE_TASK, ADD_CLIENT_NOTE); its runs
// keep version 1 as their history. Fixed ids, created once; nothing sendable. "Owner" is LVP's
// active Owner; clients A to D are part 2's first four synthetic clients.
import { runInScope, type createPrismaClient, type TxClient } from '../src/client.js';
import { qaExtraId } from './seed-qa-extra.js';
import { qaId } from './seed-qa-data.js';

type PrismaClient = ReturnType<typeof createPrismaClient>;

const id = (n: number) => qaExtraId(800 + n);
const NEVER = new Date('2099-01-01T00:00:00Z');

export type QaRunsResult = 'seeded' | 'already' | 'missing' | 'no-owner' | 'no-clients';

export async function seedQaRuns(owner: PrismaClient, now = new Date()): Promise<QaRunsResult> {
  const lvp = await runInScope(owner, { kind: 'platform' }, (tx) =>
    tx.business.findUnique({ where: { slug: 'lvp' }, select: { id: true } }),
  );
  if (!lvp) return 'missing';
  const businessId = lvp.id;
  return runInScope(owner, { kind: 'business', businessId }, async (tx) => {
    if (await tx.automationRule.findUnique({ where: { id: id(0) } })) return 'already';
    const ownerMember = await tx.membership.findFirst({
      where: { businessId, role: 'OWNER', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { userId: true },
    });
    if (!ownerMember) return 'no-owner';
    const clients = [1, 2, 3, 4].map(qaExtraId);
    const found = await tx.client.count({ where: { id: { in: clients }, archivedAt: null } });
    if (found < 4) return 'no-clients';
    await seedLogRule(tx, businessId, ownerMember.userId, clients, now);
    await fixPartOneRule(tx, businessId);
    return 'seeded';
  });
}

async function seedLogRule(
  tx: TxClient,
  businessId: string,
  ownerId: string,
  clients: string[],
  now: Date,
) {
  const at = (ms: number) => new Date(now.getTime() + ms);
  const DAY = 86_400_000;
  await tx.automationRule.create({
    data: {
      id: id(0),
      businessId,
      name: 'Seeded log fixture (fake)',
      category: 'CLIENTS',
      priority: 'MEDIUM',
      ownerUserId: ownerId,
      createdByUserId: ownerId,
    },
  });
  await tx.automationRuleVersion.create({
    data: {
      id: id(1),
      businessId,
      ruleId: id(0),
      version: 1,
      triggerModule: 'CLIENTS',
      triggerEvent: 'client.created',
      timing: 'IMMEDIATE',
      matchMode: 'ALL',
      conditions: [],
      actions: [
        {
          id: 'note',
          type: 'ADD_CLIENT_NOTE',
          config: { body: 'Welcome (synthetic)' },
          delayMinutes: 0,
          dependsOn: null,
        },
        {
          id: 'task',
          type: 'CREATE_TASK',
          config: { title: 'Set up (synthetic)' },
          delayMinutes: 1440,
          dependsOn: 'note',
        },
      ],
      settings: {
        preventDuplicatesDays: 7,
        logAll: true,
        notifyOnFailureUserIds: [],
        addToCalendar: false,
        quietHours: null,
        safetyThreshold: null,
      },
      createdByUserId: ownerId,
    },
  });
  await tx.automationRule.update({
    where: { id: id(0) },
    data: { status: 'PAUSED', currentVersionId: id(1) },
  });

  const runs = [
    {
      n: 10,
      client: clients[0]!,
      status: 'SUCCESS',
      startedAt: at(-3 * DAY),
      finishedAt: at(-3 * DAY + 2000),
      durationMs: 2000,
      message: 'Done (synthetic)',
    },
    {
      n: 11,
      client: clients[1]!,
      status: 'FAILED',
      startedAt: at(-2 * DAY),
      finishedAt: at(-2 * DAY + 1000),
      durationMs: 1000,
      errorCode: 'CLIENT_ARCHIVED',
      message: 'The client is archived',
    },
    {
      n: 12,
      client: clients[2]!,
      status: 'SKIPPED',
      startedAt: null,
      finishedAt: at(-DAY),
      errorCode: 'CONDITION_NOT_MET',
      message: 'Its condition was not met',
    },
    { n: 13, client: clients[3]!, status: 'PENDING', startedAt: at(-10 * 60_000) },
  ] as const;
  for (const r of runs) {
    const { n, client, ...rest } = r;
    await tx.automationRun.create({
      data: {
        id: id(n),
        businessId,
        ruleId: id(0),
        ruleVersionId: id(1),
        dryRun: false,
        sourceModule: 'CLIENTS',
        sourceEventKey: `client.created:${client}:created`,
        clientId: client,
        recordKind: 'client',
        recordId: client,
        correlationId: id(n + 50),
        depth: 0,
        ...rest,
      },
    });
  }

  const executions = [
    [20, 10, 'note', 'SUCCESS', 1, 'Note added', at(-3 * DAY + 1000), {}],
    [21, 10, 'task', 'SUCCESS', 1, 'Task created', at(-3 * DAY + 2000), {}],
    [
      22,
      11,
      'note',
      'FAILED',
      1,
      'The client is archived',
      at(-2 * DAY + 1000),
      { errorCode: 'CLIENT_ARCHIVED' },
    ],
    [23, 11, 'task', 'SKIPPED', 0, 'An earlier action did not succeed', at(-2 * DAY + 1000), {}],
    [24, 12, 'note', 'SKIPPED', 0, 'Its condition was not met, so it was skipped', at(-DAY), {}],
    [25, 12, 'task', 'SKIPPED', 0, 'An earlier action did not succeed', at(-DAY), {}],
    [26, 13, 'note', 'SUCCESS', 1, 'Note added', at(-10 * 60_000), {}],
    [27, 13, 'task', 'PENDING', 0, null, null, { scheduledFor: NEVER }],
  ] as const;
  for (const [n, run, key, status, attempts, detail, finishedAt, extra] of executions) {
    await tx.automationActionExecution.create({
      data: {
        id: id(n),
        businessId,
        runId: id(run),
        actionKey: key,
        position: key === 'note' ? 0 : 1,
        actionType: key === 'note' ? 'ADD_CLIENT_NOTE' : 'CREATE_TASK',
        status,
        idempotencyKey: `seed:${id(run)}:${key}`,
        attempts,
        retryable: false,
        detail,
        finishedAt,
        ...extra,
      },
    });
  }
}

/** Part 1's paused rule takes a version 2 with the action types the engine knows. */
async function fixPartOneRule(tx: TxClient, businessId: string) {
  const rule = qaId(0, 200);
  const current = await tx.automationRule.findUnique({
    where: { id: rule },
    select: { currentVersionId: true },
  });
  if (!current) return;
  const v1 = await tx.automationRuleVersion.findUniqueOrThrow({ where: { id: qaId(0, 201) } });
  await tx.automationRuleVersion.create({
    data: {
      id: id(30),
      businessId,
      ruleId: rule,
      version: 2,
      triggerModule: v1.triggerModule,
      triggerEvent: v1.triggerEvent,
      timing: v1.timing,
      offsetValue: v1.offsetValue,
      offsetUnit: v1.offsetUnit,
      matchMode: v1.matchMode,
      conditions: [],
      actions: [
        { id: 'a1', type: 'CREATE_TASK', config: { title: 'QA fixture task' }, delayMinutes: 0 },
        { id: 'a2', type: 'ADD_CLIENT_NOTE', config: { body: 'QA fixture note' }, delayMinutes: 0 },
      ],
      createdByUserId: v1.createdByUserId,
    },
  });
  await tx.automationRule.update({ where: { id: rule }, data: { currentVersionId: id(30) } });
}
