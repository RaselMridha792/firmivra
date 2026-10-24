// End-to-end: R55, the Tasks module (contract in packages/types/src/tasks/work.ts): task types,
// the rich create and change (type, priority, stage, dates and time, visibility, notes,
// collaborators, checklist, reminders, prerequisite, attachments), the row actions and bulk
// actions, the overview with its KPIs and calendar. Staff reach only their assigned clients'
// tasks; firm B never reads, changes, attaches to or depends on firm A's. Every change is audited
// with ids and field names, never text.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { z } from 'zod';
import {
  BulkTaskResult,
  OkResponse,
  TaskAttachment,
  TaskCalendar,
  TaskDetail as DetailShape,
  TaskOverviewPage,
  TaskSummary,
  TaskTemplate,
  TaskType,
  TaskTypeList,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

// Strict, so a leaked field (businessId, an internal id) fails.
const TaskDetail = z.strictObject(DetailShape.shape);
type TaskDetail = z.infer<typeof TaskDetail>;

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55t-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  staffA2: person('staff-a2'),
  clientA: person('client-a'),
  ownerB: person('owner-b'),
  ownerC: person('owner-c'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b' | 'c', string>;
/** c1 is staffA's, c2 is staffA2's, c3 is nobody's; cB is firm B's; cC is firm C's. */
const clients = {} as Record<'c1' | 'c2' | 'c3' | 'cB' | 'cC', string>;
const engagements = {} as Record<'e1' | 'e2', string>;
/** Documents of firm A: c1's file, c1's internal file, c2's file. */
const docs = {} as Record<'c1' | 'c1Internal' | 'c2', string>;
let docB = '';

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.53.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

async function asOwner<T>(
  scope: Parameters<typeof runInScope>[1],
  work: Parameters<typeof runInScope<T>>[2],
): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, scope, work);
  } finally {
    await owner.$disconnect();
  }
}
const inFirm = <T>(firm: 'a' | 'b' | 'c', work: Parameters<typeof runInScope<T>>[2]) =>
  asOwner({ kind: 'business', businessId: firms[firm] }, work);

async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .set('x-forwarded-for', viewer())
    .send({ email })
    .expect(200);
  const token = (res.body as { token: string }).token;
  tokens.set(email, token);
  return token;
}

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
async function call(
  method: Method,
  path: string,
  who: Who | undefined,
  body?: object,
  firm: 'a' | 'b' | 'c' = 'a',
): Promise<Response> {
  let req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', firms[firm])
    .set('x-forwarded-for', viewer());
  if (who) req = req.set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};

const detail = (res: Response, status = 200): TaskDetail => TaskDetail.parse(ok(res, status));
const create = (body: object, who: Who = people.ownerA, firm: 'a' | 'b' | 'c' = 'a') =>
  call('post', '/tasks', who, body, firm).then((r) => detail(r, 201));
const get = (id: string, who: Who = people.ownerA) =>
  call('get', `/tasks/${id}`, who).then((r) => detail(r));
const patch = (id: string, body: object, who: Who = people.ownerA) =>
  call('patch', `/tasks/${id}`, who, body).then((r) => detail(r));
const act = (id: string, action: string, who: Who = people.ownerA, body?: object) =>
  call('post', `/tasks/${id}/${action}`, who, body);
const mark = (what: string) => `${what} ${run} ${randomUUID().slice(0, 6)}`;

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: key === 'clientA' ? 'CLIENT' : 'STAFF',
          email: p.email,
          name: `Fake R55t ${key}`,
        },
      });
    }
    for (const key of ['a', 'b', 'c'] as const) {
      const slug = `r55t-${key}-${run}`;
      firms[key] = (
        await tx.business.create({
          data: { slug, name: slug, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
  });
  const members = [
    ['a', people.ownerA.id, 'OWNER'],
    ['a', people.adminA.id, 'ADMIN'],
    ['a', people.staffA.id, 'STAFF'],
    ['a', people.staffA2.id, 'STAFF'],
    ['b', people.ownerB.id, 'OWNER'],
    ['c', people.ownerC.id, 'OWNER'],
  ] as const;
  for (const [firm, userId, role] of members) {
    await inFirm(firm, (tx) =>
      tx.membership.create({
        data: { businessId: firms[firm], userId, role, status: 'ACTIVE' },
      }),
    );
  }
  type Tx = Parameters<Parameters<typeof inFirm>[1]>[0];
  const service = async (tx: Tx, businessId: string) =>
    (
      await tx.service.create({
        data: { businessId, kind: 'BOOKKEEPING', name: 'Bookkeeping' },
        select: { id: true },
      })
    ).id;
  const client = async (
    tx: Tx,
    firm: 'a' | 'b' | 'c',
    serviceId: string,
    name: string,
    assignedUserId: string | null = null,
  ) => {
    const businessId = firms[firm];
    const c = await tx.client.create({
      data: { businessId, displayName: `Task Client ${name} (fake)`, assignedUserId },
      select: { id: true },
    });
    const e = await tx.engagement.create({
      data: { businessId, clientId: c.id, serviceId, title: `${name} (fake)` },
      select: { id: true },
    });
    return { client: c.id, engagement: e.id };
  };
  const doc = async (
    tx: Tx,
    firm: 'a' | 'b' | 'c',
    owner: { client: string; engagement: string },
    direction: 'CLIENT_TO_FIRM' | 'INTERNAL',
  ) =>
    (
      await tx.document.create({
        data: {
          businessId: firms[firm],
          clientId: owner.client,
          engagementId: owner.engagement,
          direction,
          fileName: 'fake.pdf',
          contentType: 'application/pdf',
          sizeBytes: 100,
          sha256: 'a'.repeat(64),
          s3Key: `tenant/${firms[firm]}/r55/${randomUUID()}`,
        },
        select: { id: true },
      })
    ).id;

  await inFirm('a', async (tx) => {
    const svc = await service(tx, firms.a);
    const c1 = await client(tx, 'a', svc, 'c1', people.staffA.id);
    const c2 = await client(tx, 'a', svc, 'c2', people.staffA2.id);
    const c3 = await client(tx, 'a', svc, 'c3');
    clients.c1 = c1.client;
    clients.c2 = c2.client;
    clients.c3 = c3.client;
    engagements.e1 = c1.engagement;
    engagements.e2 = c2.engagement;
    docs.c1 = await doc(tx, 'a', c1, 'CLIENT_TO_FIRM');
    docs.c1Internal = await doc(tx, 'a', c1, 'INTERNAL');
    docs.c2 = await doc(tx, 'a', c2, 'CLIENT_TO_FIRM');
  });
  await inFirm('b', async (tx) => {
    const cb = await client(tx, 'b', await service(tx, firms.b), 'cB');
    clients.cB = cb.client;
    docB = await doc(tx, 'b', cb, 'CLIENT_TO_FIRM');
  });
  await inFirm('c', async (tx) => {
    clients.cC = (await client(tx, 'c', await service(tx, firms.c), 'cC')).client;
  });
  await inFirm('a', (tx) =>
    tx.clientAccount.create({
      data: {
        businessId: firms.a,
        userId: people.clientA.id,
        email: people.clientA.email,
        clientId: clients.c1,
        status: 'ACTIVE',
      },
    }),
  );

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env)],
  }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('task types', () => {
  it('everyone with the view reads; Owner and Admin change; names are unique ignoring case', async () => {
    const name = mark('Type');
    const made = TaskType.parse(
      ok(await call('post', '/task-types', people.ownerA, { name }), 201),
    );
    expect(made).toMatchObject({ name, archivedAt: null });
    expectError(
      await call('post', '/task-types', people.adminA, { name: name.toUpperCase() }),
      409,
      'DUPLICATE_NAME',
    );
    expectError(await call('post', '/task-types', people.staffA, { name: 'X' }), 403, 'FORBIDDEN');
    expectError(await call('post', '/task-types', people.clientA, { name: 'X' }), 403, 'FORBIDDEN');
    expectError(
      await call('post', '/task-types', people.ownerA, { name: '' }),
      400,
      'VALIDATION_FAILED',
    );
    const listed = TaskTypeList.parse(ok(await call('get', '/task-types', people.staffA)));
    expect(listed.items.map((t) => t.id)).toContain(made.id);

    const renamed = TaskType.parse(
      ok(await call('put', `/task-types/${made.id}`, people.adminA, { name: mark('Renamed') })),
    );
    expect(renamed.id).toBe(made.id);
    const archived = TaskType.parse(
      ok(await call('post', `/task-types/${made.id}/archive`, people.ownerA)),
    );
    expect(archived.archivedAt).not.toBeNull();
    // An archived type cannot be chosen for a task.
    expectError(
      await call('post', '/tasks', people.ownerA, {
        clientId: clients.c1,
        title: 'Archived type',
        typeId: made.id,
      }),
      409,
      'TYPE_ARCHIVED',
    );
    const restored = TaskType.parse(
      ok(await call('post', `/task-types/${made.id}/restore`, people.ownerA)),
    );
    expect(restored.archivedAt).toBeNull();
    const t = await create({ clientId: clients.c1, title: 'With a type', typeId: made.id });
    expect(t.type).toEqual({ id: made.id, name: renamed.name });
    expectError(
      await call('post', '/tasks', people.ownerA, {
        clientId: clients.c1,
        title: 'x',
        typeId: randomUUID(),
      }),
      400,
      'VALIDATION_FAILED',
    );
  });
});

describe('create and read a task', () => {
  it('starts with defaults, and keeps every field the form sends', async () => {
    const plain = await create({ clientId: clients.c1, title: 'Plain task' });
    expect(plain).toMatchObject({
      priority: 'MEDIUM',
      progress: 'PENDING',
      status: 'OPEN',
      allDay: true,
      dueTime: null,
      clientVisible: false,
      overdue: false,
      blocked: false,
      recurring: false,
      checklist: { done: 0, total: 0 },
      checklistItems: [],
      reminders: [],
      attachments: [],
      additionalAssignees: [],
    });

    const type = TaskType.parse(
      ok(await call('post', '/task-types', people.ownerA, { name: mark('Full') }), 201),
    );
    const full = await create({
      clientId: clients.c1,
      engagementId: engagements.e1,
      title: 'Full task',
      details: 'Details',
      typeId: type.id,
      priority: 'HIGH',
      progress: 'IN_PROGRESS',
      startOn: '2030-01-02',
      dueOn: '2030-01-10',
      dueTime: '15:30',
      clientVisible: true,
      internalNotes: 'Staff only',
      assignedUserId: people.staffA.id,
      additionalAssigneeIds: [people.adminA.id, people.staffA.id],
      checklist: [{ label: 'First', required: true }, { label: 'Second' }],
      reminders: [{ daysBefore: 7 }, { daysBefore: 1, timeOfDay: '09:00', channels: ['EMAIL'] }],
      attachments: [{ documentId: docs.c1, clientVisible: true }],
    });
    expect(full).toMatchObject({
      title: 'Full task',
      priority: 'HIGH',
      progress: 'IN_PROGRESS',
      startOn: '2030-01-02',
      dueOn: '2030-01-10',
      dueTime: '15:30',
      allDay: false,
      clientVisible: true,
      internalNotes: 'Staff only',
      engagement: { id: engagements.e1 },
      assignedUserId: people.staffA.id,
      additionalAssigneeCount: 1,
      checklist: { done: 0, total: 2 },
    });
    // The primary assignee is not repeated among the collaborators.
    expect(full.additionalAssignees.map((m) => m.userId)).toEqual([people.adminA.id]);
    expect(full.checklistItems.map((i) => [i.label, i.required, i.position])).toEqual([
      ['First', true, 0],
      ['Second', false, 1],
    ]);
    expect(full.reminders.map((r) => [r.daysBefore, r.timeOfDay, r.channels])).toEqual([
      [7, null, []],
      [1, '09:00', ['EMAIL']],
    ]);
    expect(full.attachments).toEqual([
      expect.objectContaining({ documentId: docs.c1, clientVisible: true, fileName: 'fake.pdf' }),
    ]);
    expect(await get(full.id)).toEqual(full);
    expect(full.version).toBe(full.updatedAt);
  });

  it('refuses what the database could not hold, or a task could not do', async () => {
    const bad = async (body: object, code = 'VALIDATION_FAILED', status = 400) =>
      expectError(
        await call('post', '/tasks', people.ownerA, { clientId: clients.c1, title: 'T', ...body }),
        status,
        code,
      );
    await bad({ details: 'x'.repeat(2_001) });
    await bad({ startOn: '2030-02-01', dueOn: '2030-01-01' });
    await bad({ dueTime: '10:00' });
    await bad({ dueOn: '2030-01-10', dueTime: '10:00', allDay: true });
    await bad({ progress: 'BLOCKED' });
    await bad({ reminders: [{ daysBefore: 1 }] }, 'INVALID_REMINDER');
    await bad(
      { dueOn: '2030-01-10', reminders: [{ daysBefore: 1 }, { daysBefore: 1 }] },
      'INVALID_REMINDER',
    );
    await bad(
      {
        dueOn: '2030-01-10',
        dueTime: '09:00',
        reminders: [{ daysBefore: 0, timeOfDay: '10:00' }],
      },
      'INVALID_REMINDER',
    );
    await bad({ reminders: [{ daysBefore: 400 }] });
    await bad({ checklist: Array.from({ length: 51 }, () => ({ label: 'x' })) });
    await bad({ title: 'Nul \u0000 title' });
    await bad({ dueOn: '0000-01-01' });
    await bad({ businessId: firms.b });
    await bad({ engagementId: engagements.e2 }, 'ENGAGEMENT_MISMATCH', 409);
    await bad({ assignedUserId: people.staffA2.id }, 'CLIENT_NOT_ASSIGNED', 409);
    await bad({ additionalAssigneeIds: [people.ownerB.id] }, 'NOT_A_MEMBER', 409);
    await bad({ serviceId: randomUUID() });
    await bad({ attachments: [{ documentId: docs.c2 }] }, 'ATTACHMENT_NOT_ALLOWED', 409);
    await bad(
      { attachments: [{ documentId: docs.c1Internal, clientVisible: true }] },
      'ATTACHMENT_NOT_ALLOWED',
      409,
    );
    // An internal file may be attached, but not shown to the client.
    const internal = await create({
      clientId: clients.c1,
      title: 'Internal file',
      attachments: [{ documentId: docs.c1Internal }],
    });
    expect(internal.attachments[0]?.clientVisible).toBe(false);
  });
});

// Octavia's Tasks review (Oct 21), C1 and C2: a task saves without a type or a template, and
// each save makes one task. The bodies are what Create Task sends.
describe('saving from Create Task', () => {
  const form = (title: string) => ({
    clientId: clients.c1,
    title,
    details: 'Synthetic task for the review retest.',
    dueOn: '2027-03-02',
    assignedUserId: people.staffA.id,
    typeId: null,
    priority: 'HIGH',
    progress: 'NOT_STARTED',
    serviceId: null,
    startOn: null,
    allDay: true,
    dueTime: null,
    clientVisible: false,
    internalNotes: '',
    blockedReason: '',
    additionalAssigneeIds: [],
    dependsOnTaskId: null,
    reminders: [],
    checklist: [],
  });
  const found = async (title: string) =>
    TaskOverviewPage.parse(
      ok(
        await call(
          'get',
          `/tasks/overview?view=all&pageSize=100&search=${encodeURIComponent(title)}`,
          people.ownerA,
        ),
      ),
    ).items.map((t) => t.id);

  it('saves without a type or a template, reads back the same, and makes one task', async () => {
    const title = mark('No type or template');
    const made = await create(form(title));
    expect(made).toMatchObject({
      title,
      type: null,
      priority: 'HIGH',
      progress: 'NOT_STARTED',
      dueOn: '2027-03-02',
      assignedTo: { userId: people.staffA.id },
    });
    expect(await get(made.id)).toEqual(made);
    expect(await found(title)).toEqual([made.id]);

    // Edit saves into the same task.
    const renamed = await patch(made.id, { version: made.version, title: `${title} v2` });
    expect(renamed.id).toBe(made.id);
    expect(await found(title)).toEqual([made.id]);
  });

  it('saves from a template once, with its defaults', async () => {
    const tpl = ok(
      await call('post', '/task-templates', people.ownerA, {
        name: mark('Review template'),
        priority: 'LOW',
        checklist: [{ label: 'Collect the statements', required: true }],
      }),
      201,
    ) as { id: string };
    const title = mark('From a template');
    const made = await create({
      ...form(title),
      templateId: tpl.id,
      priority: 'LOW',
      checklist: [{ label: 'Collect the statements', required: true }],
    });
    expect(made).toMatchObject({ title, type: null, priority: 'LOW' });
    expect(made.checklistItems.map((c) => [c.label, c.required])).toEqual([
      ['Collect the statements', true],
    ]);
    expect(await get(made.id)).toEqual(made);
    expect(await found(title)).toEqual([made.id]);
  });
});

describe('change a task', () => {
  it('changes only what is sent, clears with null, and guards a stale save', async () => {
    const t = await create({
      clientId: clients.c1,
      title: 'To change',
      details: 'D',
      dueOn: '2030-03-01',
      internalNotes: 'N',
      priority: 'LOW',
    });
    const changed = await patch(t.id, {
      priority: 'HIGH',
      internalNotes: null,
      version: t.version,
    });
    expect(changed).toMatchObject({
      title: 'To change',
      details: 'D',
      priority: 'HIGH',
      internalNotes: null,
      dueOn: '2030-03-01',
    });
    expect(changed.version).not.toBe(t.version);
    expectError(
      await call('patch', `/tasks/${t.id}`, people.adminA, { priority: 'LOW', version: t.version }),
      409,
      'SAVE_CONFLICT',
    );
    // Clearing the date takes the time with it.
    const timed = await patch(t.id, { dueOn: '2030-03-05', dueTime: '08:15' });
    expect(timed).toMatchObject({ dueTime: '08:15', allDay: false });
    const cleared = await patch(t.id, { dueOn: null });
    expect(cleared).toMatchObject({ dueOn: null, dueTime: null, allDay: true });
    expectError(await call('patch', `/tasks/${t.id}`, people.ownerA, {}), 400, 'VALIDATION_FAILED');
    expectError(
      await call('patch', `/tasks/${t.id}`, people.ownerA, { reminders: [{ daysBefore: 1 }] }),
      400,
      'INVALID_REMINDER',
    );
    expectError(
      await call('patch', `/tasks/${randomUUID()}`, people.ownerA, { title: 'x' }),
      404,
      'NOT_FOUND',
    );
  });

  it('replaces the lists it is sent and keeps a checklist step by its id', async () => {
    const t = await create({
      clientId: clients.c1,
      title: 'Lists',
      dueOn: '2030-04-01',
      checklist: [{ label: 'Keep' }, { label: 'Drop' }],
      reminders: [{ daysBefore: 3 }],
      additionalAssigneeIds: [people.adminA.id],
    });
    const [keep] = t.checklistItems;
    await act(t.id, `checklist/${keep!.id}/complete`);
    const saved = await patch(t.id, {
      checklist: [
        { label: 'Kept, renamed', id: keep!.id },
        { label: 'Added', required: true },
      ],
      reminders: [{ daysBefore: 2 }],
      additionalAssigneeIds: [],
    });
    expect(saved.checklistItems.map((i) => i.label)).toEqual(['Kept, renamed', 'Added']);
    expect(saved.checklistItems[0]).toMatchObject({ id: keep!.id });
    expect(saved.checklistItems[0]?.completedAt).not.toBeNull();
    expect(saved.reminders.map((r) => r.daysBefore)).toEqual([2]);
    expect(saved.additionalAssignees).toEqual([]);
    expectError(
      await call('patch', `/tasks/${t.id}`, people.ownerA, {
        checklist: [{ id: randomUUID(), label: 'Ghost' }],
      }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('waits for a prerequisite, refuses a loop, and unblocks when it is done', async () => {
    const first = await create({ clientId: clients.c1, title: 'Prerequisite' });
    const second = await create({
      clientId: clients.c1,
      title: 'Depends',
      dependsOnTaskId: first.id,
    });
    expect(second).toMatchObject({ progress: 'BLOCKED', blocked: true });
    expect(second.dependsOn).toEqual({ id: first.id, title: 'Prerequisite', status: 'OPEN' });
    expectError(await act(second.id, 'complete'), 409, 'DEPENDENCY_OPEN');
    expectError(
      await act(second.id, 'progress', people.ownerA, { progress: 'IN_PROGRESS' }),
      409,
      'DEPENDENCY_OPEN',
    );

    const third = await create({
      clientId: clients.c1,
      title: 'Third',
      dependsOnTaskId: second.id,
    });
    for (const target of [first.id]) {
      expectError(
        await call('patch', `/tasks/${target}`, people.ownerA, { dependsOnTaskId: third.id }),
        400,
        'DEPENDENCY_CYCLE',
      );
    }
    expectError(
      await call('patch', `/tasks/${first.id}`, people.ownerA, { dependsOnTaskId: first.id }),
      400,
      'DEPENDENCY_CYCLE',
    );

    detail(await act(first.id, 'complete'));
    const freed = await get(second.id);
    expect(freed).toMatchObject({ progress: 'PENDING', blocked: false });
    detail(await act(second.id, 'complete'));
    // Clearing the prerequisite is allowed.
    const alone = await patch(third.id, { dependsOnTaskId: null });
    expect(alone.dependsOn).toBeNull();
  });
});

describe('actions', () => {
  it('completes, reopens, cancels and sets the stage; required steps come first', async () => {
    const t = await create({
      clientId: clients.c1,
      title: 'Actions',
      checklist: [{ label: 'Must', required: true }],
    });
    expectError(await act(t.id, 'complete'), 409, 'REQUIRED_ITEMS_OPEN');
    expectError(
      await call('patch', `/tasks/${t.id}`, people.ownerA, { status: 'DONE' }),
      409,
      'REQUIRED_ITEMS_OPEN',
    );
    const stepped = detail(await act(t.id, `checklist/${t.checklistItems[0]!.id}/complete`));
    expect(stepped.checklist).toEqual({ done: 1, total: 1 });
    expect(stepped.checklistItems[0]?.completedBy?.userId).toBe(people.ownerA.id);
    const done = detail(await act(t.id, 'complete', people.adminA));
    expect(done).toMatchObject({ status: 'DONE', completedBy: { userId: people.adminA.id } });
    expect(done.completedAt).not.toBeNull();
    // Completing twice changes nothing.
    expect(detail(await act(t.id, 'complete')).completedAt).toBe(done.completedAt);
    expectError(
      await act(t.id, 'progress', people.ownerA, { progress: 'IN_PROGRESS' }),
      409,
      'TASK_CLOSED',
    );
    const reopened = detail(await act(t.id, 'reopen'));
    expect(reopened).toMatchObject({ status: 'OPEN', completedAt: null, completedBy: null });
    const staged = detail(await act(t.id, 'progress', people.ownerA, { progress: 'WAITING' }));
    expect(staged.progress).toBe('WAITING');
    const cancelled = detail(await act(t.id, 'cancel'));
    expect(cancelled.status).toBe('CANCELLED');

    // The steps: reopen one, reorder them.
    const u = await create({
      clientId: clients.c1,
      title: 'Steps',
      checklist: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
    });
    const ids = u.checklistItems.map((i) => i.id);
    const reordered = detail(
      await call('put', `/tasks/${u.id}/checklist/order`, people.ownerA, {
        ids: [ids[2], ids[0], ids[1]],
      }),
    );
    expect(reordered.checklistItems.map((i) => i.label)).toEqual(['C', 'A', 'B']);
    expectError(
      await call('put', `/tasks/${u.id}/checklist/order`, people.ownerA, { ids: [ids[0]] }),
      400,
      'VALIDATION_FAILED',
    );
    detail(await act(u.id, `checklist/${ids[0]}/complete`));
    expect(detail(await act(u.id, `checklist/${ids[0]}/reopen`)).checklist.done).toBe(0);
    expectError(await act(u.id, `checklist/${randomUUID()}/complete`), 404, 'NOT_FOUND');
  });

  it('duplicates, archives and restores', async () => {
    const t = await create({
      clientId: clients.c1,
      title: 'Original',
      dueOn: '2030-05-05',
      assignedUserId: people.staffA.id,
      checklist: [{ label: 'Step', required: true }],
      reminders: [{ daysBefore: 1 }],
      attachments: [{ documentId: docs.c1 }],
    });
    await act(t.id, `checklist/${t.checklistItems[0]!.id}/complete`);
    const copy = detail(await act(t.id, 'duplicate'), 201);
    expect(copy).toMatchObject({
      title: 'Original (Copy)',
      status: 'OPEN',
      dueOn: '2030-05-05',
      assignedUserId: people.staffA.id,
      checklist: { done: 0, total: 1 },
      attachments: [],
      dependsOn: null,
    });
    expect(copy.reminders).toHaveLength(1);
    expect(copy.id).not.toBe(t.id);

    const archived = detail(await act(t.id, 'archive'));
    expect(archived.archivedAt).not.toBeNull();
    expectError(
      await call('patch', `/tasks/${t.id}`, people.ownerA, { title: 'Edit archived' }),
      409,
      'TASK_CLOSED',
    );
    expectError(await act(t.id, 'complete'), 409, 'TASK_CLOSED');
    expect(detail(await act(t.id, 'restore')).archivedAt).toBeNull();
  });
});

describe('attachments', () => {
  it('attaches the client’s own documents and approves them for the client one by one', async () => {
    const t = await create({ clientId: clients.c1, title: 'Files' });
    const added = TaskAttachment.parse(
      ok(
        await call('post', `/tasks/${t.id}/attachments`, people.ownerA, { documentId: docs.c1 }),
        201,
      ),
    );
    expect(added).toMatchObject({ documentId: docs.c1, clientVisible: false });
    expectError(
      await call('post', `/tasks/${t.id}/attachments`, people.ownerA, { documentId: docs.c1 }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', `/tasks/${t.id}/attachments`, people.ownerA, { documentId: docs.c2 }),
      409,
      'ATTACHMENT_NOT_ALLOWED',
    );
    const shown = TaskAttachment.parse(
      ok(
        await call('patch', `/tasks/${t.id}/attachments/${added.id}`, people.ownerA, {
          clientVisible: true,
        }),
      ),
    );
    expect(shown.clientVisible).toBe(true);
    const internal = TaskAttachment.parse(
      ok(
        await call('post', `/tasks/${t.id}/attachments`, people.ownerA, {
          documentId: docs.c1Internal,
        }),
        201,
      ),
    );
    expectError(
      await call('patch', `/tasks/${t.id}/attachments/${internal.id}`, people.ownerA, {
        clientVisible: true,
      }),
      409,
      'ATTACHMENT_NOT_ALLOWED',
    );
    OkResponse.parse(
      ok(await call('delete', `/tasks/${t.id}/attachments/${added.id}`, people.ownerA)),
    );
    expect((await get(t.id)).attachments.map((a) => a.id)).toEqual([internal.id]);
    expectError(
      await call('delete', `/tasks/${t.id}/attachments/${added.id}`, people.ownerA),
      404,
      'NOT_FOUND',
    );
  });
});

describe('who reaches which task', () => {
  it('Staff reach only their assigned clients’ tasks; clients and strangers none', async () => {
    const mine = await create({ clientId: clients.c1, title: mark('Staff mine') });
    const theirs = await create({ clientId: clients.c2, title: mark('Staff theirs') });
    expect((await get(mine.id, people.staffA)).id).toBe(mine.id);
    expectError(await call('get', `/tasks/${theirs.id}`, people.staffA), 404, 'NOT_FOUND');
    expectError(await act(theirs.id, 'complete', people.staffA), 404, 'NOT_FOUND');
    expectError(
      await call('post', '/tasks', people.staffA, { clientId: clients.c2, title: 'No' }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', `/tasks/${theirs.id}/attachments`, people.staffA, { documentId: docs.c2 }),
      404,
      'NOT_FOUND',
    );
    // A prerequisite Staff cannot reach is not a prerequisite.
    expectError(
      await call('post', '/tasks', people.staffA, {
        clientId: clients.c1,
        title: 'Waits',
        dependsOnTaskId: theirs.id,
      }),
      400,
      'VALIDATION_FAILED',
    );
    const seen = TaskOverviewPage.parse(
      ok(await call('get', '/tasks/overview?search=Staff&pageSize=100', people.staffA)),
    );
    expect(seen.items.map((t) => t.id)).toContain(mine.id);
    expect(seen.items.map((t) => t.id)).not.toContain(theirs.id);

    for (const res of [
      await call('get', '/tasks/summary', people.clientA),
      await call('get', '/tasks/overview', people.clientA),
      await call('get', `/tasks/${mine.id}`, people.clientA),
      await call('post', '/tasks/bulk', people.clientA, { action: 'COMPLETE', ids: [mine.id] }),
    ]) {
      expectError(res, 403, 'FORBIDDEN');
    }
    expect((await call('get', '/tasks/summary', undefined)).status).toBe(401);
  });
});

describe('overview, summary and calendar', () => {
  it('filters, sorts, searches and pages the table', async () => {
    const word = `Over${randomUUID().slice(0, 6)}`;
    const mk = (title: string, body: object = {}, who: Who = people.ownerA) =>
      create({ clientId: clients.c1, title: `${word} ${title}`, ...body }, who);
    await mk('late', { dueOn: '2020-01-01', priority: 'HIGH' });
    await mk('soon', { dueOn: '2099-01-01', priority: 'LOW' });
    await mk('undated', { priority: 'MEDIUM', assignedUserId: people.staffA.id });
    const finished = await mk('finished', { dueOn: '2020-02-02' });
    await act(finished.id, 'complete');
    const dropped = await mk('dropped');
    await act(dropped.id, 'cancel');
    const filed = await mk('filed');
    await act(filed.id, 'archive');

    const page = (q: string, who: Who = people.ownerA) =>
      call('get', `/tasks/overview?search=${word}&${q}`, who).then((r) =>
        TaskOverviewPage.parse(ok(r)),
      );
    const titles = async (q: string, who?: Who) =>
      (await page(q, who)).items.map((t) => t.title.slice(word.length + 1));

    // All: not cancelled, not archived; open first, by date, no date last.
    expect(await titles('')).toEqual(['late', 'soon', 'undated', 'finished']);
    expect(await titles('view=completed')).toEqual(['finished']);
    expect(await titles('view=archived')).toEqual(['filed']);
    expect(await titles('status=CANCELLED')).toEqual([]);
    expect(await titles('priority=HIGH')).toEqual(['late']);
    expect(await titles('overdue=true')).toEqual(['late']);
    expect(await titles('view=mine', people.staffA)).toEqual(['undated']);
    expect(await titles(`assignedUserId=${people.staffA.id}`)).toEqual(['undated']);
    expect(await titles('dueFrom=2090-01-01')).toEqual(['soon']);
    expect(await titles('dueTo=2020-12-31')).toEqual(['late', 'finished']);
    expect(await titles('sort=priority&direction=asc&status=OPEN')).toEqual([
      'late',
      'undated',
      'soon',
    ]);
    expect(await titles('sort=title&direction=desc&status=OPEN')).toEqual([
      'undated',
      'soon',
      'late',
    ]);
    const first = await page('status=OPEN&pageSize=2');
    expect([first.items.length, first.total, first.page, first.pageSize]).toEqual([2, 3, 1, 2]);
    expect((await page('status=OPEN&pageSize=2&page=2')).items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({
      overdue: true,
      client: { id: clients.c1 },
      checklist: { done: 0, total: 0 },
    });
    expectError(
      await call('get', '/tasks/overview?view=everything', people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('get', '/tasks/overview?pageSize=101', people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('counts the KPIs over what the caller reaches', async () => {
    // Firm C is this test's alone.
    const make = (title: string, body: object = {}) =>
      create({ clientId: clients.cC, title, ...body }, people.ownerC, 'c');
    const base = TaskSummary.parse(
      ok(await call('get', '/tasks/summary', people.ownerC, undefined, 'c')),
    );
    expect(base).toEqual({
      total: 0,
      pending: 0,
      inProgress: 0,
      overdue: 0,
      completedThisMonth: 0,
      mine: 0,
    });
    await make('Pending');
    await make('Working', { progress: 'IN_PROGRESS' });
    await make('Late', { dueOn: '2020-01-01', assignedUserId: people.ownerC.id });
    const done = await make('Done');
    await call('post', `/tasks/${done.id}/complete`, people.ownerC, undefined, 'c');
    const gone = await make('Cancelled');
    await call('post', `/tasks/${gone.id}/cancel`, people.ownerC, undefined, 'c');
    const summary = TaskSummary.parse(
      ok(await call('get', '/tasks/summary', people.ownerC, undefined, 'c')),
    );
    expect(summary).toEqual({
      total: 4,
      pending: 2,
      inProgress: 1,
      overdue: 1,
      completedThisMonth: 1,
      mine: 1,
    });
  });

  it('lists the due tasks of a range, in order, and refuses a long one', async () => {
    const t1 = await create({
      clientId: clients.c1,
      title: 'Cal two',
      dueOn: '2031-06-12',
      dueTime: '14:00',
    });
    const t2 = await create({ clientId: clients.c1, title: 'Cal one', dueOn: '2031-06-10' });
    await create({ clientId: clients.c1, title: 'Cal out', dueOn: '2031-08-01' });
    const calendar = TaskCalendar.parse(
      ok(
        await call(
          'get',
          `/tasks/calendar?from=2031-06-01&to=2031-06-30&clientId=${clients.c1}`,
          people.ownerA,
        ),
      ),
    );
    expect(calendar.items.map((i) => i.id)).toEqual([t2.id, t1.id]);
    expect(calendar.items[1]).toMatchObject({
      dueOn: '2031-06-12',
      dueTime: '14:00',
      allDay: false,
    });
    expectError(
      await call('get', '/tasks/calendar?from=2031-01-01&to=2031-12-31', people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
  });
});

describe('bulk actions', () => {
  it('changes what fits and says why the rest was left', async () => {
    const mk = (title: string, clientId = clients.c1, body: object = {}) =>
      create({ clientId, title: mark(title), ...body });
    const a = await mk('bulk a', clients.c1, { dueOn: '2030-07-01' });
    const b = await mk('bulk b', clients.c1, { checklist: [{ label: 'Must', required: true }] });
    const c = await mk('bulk c', clients.c1);
    const other = await mk('bulk other', clients.c3);
    const bulk = (body: object, who: Who = people.ownerA) =>
      call('post', '/tasks/bulk', who, body).then((r) => BulkTaskResult.parse(ok(r)));

    const done = await bulk({ action: 'COMPLETE', ids: [a.id, b.id, randomUUID()] });
    expect(done.updated).toBe(1);
    expect(done.skipped.map((s) => s.reason).sort()).toEqual(['NOT_FOUND', 'REQUIRED_ITEMS_OPEN']);
    expect((await get(a.id)).status).toBe('DONE');
    expect((await get(b.id)).status).toBe('OPEN');

    // Staff cannot reach another client's task, and it looks like any 404.
    const staff = await bulk(
      { action: 'SET_PRIORITY', ids: [c.id, other.id], priority: 'HIGH' },
      people.staffA,
    );
    expect(staff).toEqual({ updated: 1, skipped: [{ id: other.id, reason: 'NOT_FOUND' }] });
    expect((await get(other.id)).priority).toBe('MEDIUM');

    // Reassign to Staff only where they hold the client.
    const re = await bulk({
      action: 'REASSIGN',
      ids: [c.id, other.id],
      assignedUserId: people.staffA.id,
    });
    expect(re.updated).toBe(1);
    expect(re.skipped).toEqual([{ id: other.id, reason: 'CLIENT_NOT_ASSIGNED' }]);
    expect((await get(c.id)).assignedUserId).toBe(people.staffA.id);

    // Someone outside the firm is refused for the whole request.
    expectError(
      await call('post', '/tasks/bulk', people.ownerA, {
        action: 'REASSIGN',
        ids: [c.id],
        assignedUserId: people.ownerB.id,
      }),
      409,
      'NOT_A_MEMBER',
    );

    // Due dates: set one, or shift each; a task with no date has none to shift.
    const dated = await mk('bulk dated', clients.c1, { dueOn: '2030-08-01' });
    const set = await bulk({ action: 'SET_DUE_DATE', ids: [dated.id, c.id], dueOn: '2030-09-09' });
    expect(set.updated).toBe(2);
    const shift = await bulk({ action: 'SET_DUE_DATE', ids: [dated.id], shiftDays: -9 });
    expect(shift.updated).toBe(1);
    expect((await get(dated.id)).dueOn).toBe('2030-08-31');
    const undated = await mk('bulk undated', clients.c1);
    const none = await bulk({ action: 'SET_DUE_DATE', ids: [undated.id], shiftDays: 3 });
    expect(none).toEqual({ updated: 0, skipped: [{ id: undated.id, reason: 'NO_DUE_DATE' }] });

    const staged = await bulk({
      action: 'SET_PROGRESS',
      ids: [dated.id, c.id],
      progress: 'WAITING',
    });
    expect(staged.updated).toBe(2);

    // Cancelling and archiving ask to be confirmed.
    expectError(
      await call('post', '/tasks/bulk', people.ownerA, { action: 'CANCEL', ids: [c.id] }),
      400,
      'VALIDATION_FAILED',
    );
    expect((await bulk({ action: 'CANCEL', ids: [c.id], confirm: true })).updated).toBe(1);
    expect((await bulk({ action: 'ARCHIVE', ids: [dated.id], confirm: true })).updated).toBe(1);

    const audit = await inFirm('a', (tx) =>
      tx.auditLog.findMany({
        where: { action: 'tasks.bulk' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      }),
    );
    expect(audit[0]?.metadata).toMatchObject({
      action: 'ARCHIVE',
      requested: 1,
      updated: 1,
      ids: [dated.id],
    });
  });
});

describe('audit', () => {
  it('records changes with ids and field names, never text', async () => {
    const secret = `Secret-${run}`;
    const t = await create({
      clientId: clients.c1,
      title: `${secret} title`,
      details: `${secret} details`,
      internalNotes: `${secret} notes`,
      dueOn: '2030-10-01',
      checklist: [{ label: `${secret} step` }],
      reminders: [{ daysBefore: 1 }],
    });
    await patch(t.id, { priority: 'HIGH', internalNotes: `${secret} again` });
    await act(t.id, 'progress', people.ownerA, { progress: 'WAITING' });
    await act(t.id, `checklist/${t.checklistItems[0]!.id}/complete`);
    await call('post', `/tasks/${t.id}/attachments`, people.ownerA, { documentId: docs.c1 });
    await act(t.id, 'complete');
    await get(t.id);
    const rows = await inFirm('a', (tx) => tx.auditLog.findMany({ where: { entityId: t.id } }));
    const actions = rows.map((r) => r.action);
    for (const action of [
      'task.created',
      'task.updated',
      'task.progress_changed',
      'task.checklist_item_completed',
      'task.attachment_added',
      'task.completed',
      'task.viewed',
    ]) {
      expect(actions).toContain(action);
    }
    expect(JSON.stringify(rows.map((r) => r.metadata))).not.toContain(secret);
    expect(rows.find((r) => r.action === 'task.updated')?.metadata).toEqual({
      clientId: clients.c1,
      fields: ['internalNotes', 'priority'],
    });
    expect(rows.find((r) => r.action === 'task.created')?.metadata).toMatchObject({
      clientId: clients.c1,
      fields: ['checklist', 'details', 'dueOn', 'internalNotes', 'reminders'],
    });
  });
});

// Octavia's Tasks review A3 (R1, Oct 24): Custom reminders, a number of minutes, hours or days
// before the due date and time, beside the days rules. They need a due time, two never fire at one
// moment, and they read back as sent, in the order they fire.
describe('Custom reminders', () => {
  type Rule = TaskDetail['reminders'][number];
  /** A rule as read, without its row id. */
  const shape = (r: Omit<Rule, 'id'>) => [
    r.daysBefore,
    r.timeOfDay,
    r.amount,
    r.unit,
    r.inApp,
    r.channels,
  ];
  const timed = (body: object = {}) =>
    create({
      clientId: clients.c1,
      title: mark('Custom'),
      dueOn: '2030-06-10',
      dueTime: '14:30',
      ...body,
    });
  const refused = (res: Response, message: string) => {
    expectError(res, 400, 'INVALID_REMINDER');
    expect((res.body as { error: { message: string } }).error.message).toBe(message);
  };
  const NEEDS_TIME = 'A reminder in minutes or hours needs a due time';
  const SAME_MOMENT = 'Two reminders fire at the same time';

  it('keeps each unit as sent, beside the days rules, in the order they fire', async () => {
    const t = await timed({
      reminders: [
        { amount: 30, unit: 'MINUTES' },
        { amount: 2, unit: 'HOURS', channels: ['EMAIL'] },
        { daysBefore: 1, timeOfDay: '09:00' },
        { amount: 3, unit: 'DAYS', inApp: false, channels: ['SMS'] },
        { amount: 36, unit: 'HOURS' },
        { daysBefore: 0 },
      ],
    });
    // Due Jun 10 at 14:30: 3 days, 36 hours, Jun 9 at 09:00, 2 hours, 30 minutes before; the day
    // rule with the firm's default time sits as if at the due time.
    expect(t.reminders.map(shape)).toEqual([
      [3, null, 3, 'DAYS', false, ['SMS']],
      [1, null, 36, 'HOURS', true, []],
      [1, '09:00', null, null, true, []],
      [0, null, 2, 'HOURS', true, ['EMAIL']],
      [0, null, 30, 'MINUTES', true, []],
      [0, null, null, null, true, []],
    ]);
    expect(await get(t.id)).toEqual(t);
    // Kept as minutes and the unit typed, with their whole days.
    const rows = await inFirm('a', (tx) =>
      tx.taskReminder.findMany({
        where: { taskId: t.id },
        orderBy: [{ daysBefore: 'desc' }, { minutesBefore: { sort: 'desc', nulls: 'last' } }],
      }),
    );
    expect(rows.map((r) => [r.daysBefore, r.minutesBefore, r.unit])).toEqual([
      [3, 4_320, 'DAYS'],
      [1, 2_160, 'HOURS'],
      [1, null, null],
      [0, 120, 'HOURS'],
      [0, 30, 'MINUTES'],
      [0, null, null],
    ]);
    // Read back and sent back without their ids, they stay as they were.
    const again = await patch(t.id, { reminders: t.reminders.map(({ id: _id, ...rule }) => rule) });
    expect(again.reminders.map(shape)).toEqual(t.reminders.map(shape));
  });

  it('need a due time: refused on an all-day task, and they keep the task from going all-day', async () => {
    const base = { clientId: clients.c1, title: mark('No time') };
    refused(
      await call('post', '/tasks', people.ownerA, {
        ...base,
        dueOn: '2030-06-10',
        reminders: [{ amount: 1, unit: 'HOURS' }],
      }),
      NEEDS_TIME,
    );
    refused(
      await call('post', '/tasks', people.ownerA, {
        ...base,
        dueOn: '2030-06-10',
        allDay: true,
        reminders: [{ amount: 2, unit: 'DAYS' }],
      }),
      NEEDS_TIME,
    );
    refused(
      await call('post', '/tasks', people.ownerA, {
        ...base,
        reminders: [{ amount: 2, unit: 'DAYS' }],
      }),
      'Set a due date before adding reminders',
    );

    const t = await timed({ reminders: [{ amount: 45, unit: 'MINUTES' }, { daysBefore: 2 }] });
    refused(
      await call('patch', `/tasks/${t.id}`, people.ownerA, { allDay: true, dueTime: null }),
      NEEDS_TIME,
    );
    refused(await call('patch', `/tasks/${t.id}`, people.ownerA, { dueTime: null }), NEEDS_TIME);
    refused(
      await call('patch', `/tasks/${t.id}`, people.ownerA, { dueOn: null }),
      'Set a due date before adding reminders',
    );
    expect(await get(t.id)).toEqual(t);
    // A change that keeps the due time keeps them.
    expect((await patch(t.id, { title: `${t.title} v2` })).reminders.map(shape)).toEqual(
      t.reminders.map(shape),
    );
    // With its reminders replaced in the same request, it goes all-day.
    const allDay = await patch(t.id, {
      allDay: true,
      dueTime: null,
      reminders: [{ daysBefore: 2 }],
    });
    expect(allDay).toMatchObject({ allDay: true, dueTime: null });
    expect(allDay.reminders.map(shape)).toEqual([[2, null, null, null, true, []]]);
  });

  it('never fire twice at one moment, also after the due time moves', async () => {
    const at = (dueTime: string, reminders: object[]) =>
      call('post', '/tasks', people.ownerA, {
        clientId: clients.c1,
        title: mark('Moments'),
        dueOn: '2030-06-10',
        dueTime,
        reminders,
      });
    // 60 minutes and 1 hour are one reminder, as are 1 day and 24 hours.
    refused(
      await at('14:30', [
        { amount: 60, unit: 'MINUTES' },
        { amount: 1, unit: 'HOURS' },
      ]),
      SAME_MOMENT,
    );
    refused(
      await at('14:30', [
        { amount: 1, unit: 'DAYS' },
        { amount: 24, unit: 'HOURS' },
      ]),
      SAME_MOMENT,
    );
    refused(
      await at('14:30', [
        { amount: 15, unit: 'MINUTES' },
        { amount: 15, unit: 'MINUTES', channels: ['EMAIL'] },
      ]),
      'Each reminder can be added once',
    );
    // "1 day before at 14:30" and "1 day before" a task due at 14:30 are the same moment...
    refused(
      await at('14:30', [
        { daysBefore: 1, timeOfDay: '14:30' },
        { amount: 1, unit: 'DAYS' },
      ]),
      SAME_MOMENT,
    );
    // ...but not when it is due at 16:00.
    const t = detail(
      await at('16:00', [
        { amount: 1, unit: 'DAYS' },
        { daysBefore: 1, timeOfDay: '14:30' },
        { daysBefore: 0 },
        { amount: 2, unit: 'HOURS' },
      ]),
      201,
    );
    expect(t.reminders.map(shape)).toEqual([
      [1, '14:30', null, null, true, []],
      [1, null, 1, 'DAYS', true, []],
      [0, null, 2, 'HOURS', true, []],
      [0, null, null, null, true, []],
    ]);
    // Moving the due time onto the collision is refused: the kept reminders are checked.
    refused(
      await call('patch', `/tasks/${t.id}`, people.ownerA, { dueTime: '14:30' }),
      SAME_MOMENT,
    );
    expect((await get(t.id)).dueTime).toBe('16:00');
  });

  it('are kept by Duplicate and Save as Template', async () => {
    const t = await timed({
      reminders: [{ amount: 90, unit: 'MINUTES', channels: ['EMAIL'] }, { daysBefore: 1 }],
    });
    const copy = detail(await act(t.id, 'duplicate'), 201);
    expect(copy).toMatchObject({ dueOn: '2030-06-10', dueTime: '14:30' });
    expect(copy.reminders.map(shape)).toEqual([
      [1, null, null, null, true, []],
      [0, null, 90, 'MINUTES', true, ['EMAIL']],
    ]);
    expect(copy.reminders.map(shape)).toEqual(t.reminders.map(shape));
    const tpl = TaskTemplate.parse(
      ok(
        await call('post', `/tasks/${t.id}/save-as-template`, people.ownerA, {
          name: mark('Custom template'),
        }),
        201,
      ),
    );
    expect(tpl.reminders.map(shape)).toEqual(t.reminders.map(shape));
  });

  it('a template’s that do not fit a new task are left out, never refused', async () => {
    const tpl = TaskTemplate.parse(
      ok(
        await call('post', '/task-templates', people.ownerA, {
          name: mark('Fitting'),
          reminders: [
            { amount: 2, unit: 'HOURS' },
            { daysBefore: 1, timeOfDay: '14:30' },
            { amount: 1, unit: 'DAYS' },
            { daysBefore: 0, timeOfDay: '18:00' },
          ],
        }),
        201,
      ),
    );
    expect(tpl.reminders.map(shape)).toEqual([
      [0, null, 2, 'HOURS', true, []],
      [1, '14:30', null, null, true, []],
      [1, null, 1, 'DAYS', true, []],
      [0, '18:00', null, null, true, []],
    ]);
    const from = (body: object) =>
      create({ clientId: clients.c1, title: mark('From template'), templateId: tpl.id, ...body });
    // No due date (the template sets none): none of them.
    expect((await from({})).reminders).toEqual([]);
    // All day: the days rules only.
    expect((await from({ dueOn: '2030-07-01' })).reminders.map(shape)).toEqual([
      [1, '14:30', null, null, true, []],
      [0, '18:00', null, null, true, []],
    ]);
    // Due at 14:30: "1 day" fires with "1 day at 14:30", and 18:00 is after the due time.
    expect((await from({ dueOn: '2030-07-01', dueTime: '14:30' })).reminders.map(shape)).toEqual([
      [1, '14:30', null, null, true, []],
      [0, null, 2, 'HOURS', true, []],
    ]);
    // The same rules sent with the request are checked as sent.
    refused(
      await call('post', '/tasks', people.ownerA, {
        clientId: clients.c1,
        title: mark('Sent'),
        templateId: tpl.id,
        dueOn: '2030-07-01',
        reminders: [{ amount: 2, unit: 'HOURS' }],
      }),
      NEEDS_TIME,
    );
  });

  it('firm B never reads or changes firm A’s Custom reminders', async () => {
    const a = await timed({ reminders: [{ amount: 15, unit: 'MINUTES' }] });
    const asB = (method: Method, path: string, body?: object) =>
      call(method, path, people.ownerB, body, 'b');
    for (const [method, path, body] of [
      ['get', `/tasks/${a.id}`],
      ['patch', `/tasks/${a.id}`, { reminders: [{ amount: 30, unit: 'MINUTES' }] }],
      ['patch', `/tasks/${a.id}`, { allDay: true, dueTime: null }],
      ['post', `/tasks/${a.id}/duplicate`],
      ['post', `/tasks/${a.id}/save-as-template`, { name: mark('Taken') }],
    ] as const) {
      const res = await asB(method, path, body);
      expect([res.status, codeOf(res), method, path].join(' ')).toBe(
        [404, 'NOT_FOUND', method, path].join(' '),
      );
    }
    expect(await get(a.id)).toEqual(a);
    expect(a.reminders.map(shape)).toEqual([[0, null, 15, 'MINUTES', true, []]]);
  });
});

describe('firm B against firm A', () => {
  it('never reads, changes or uses firm A’s tasks, documents or types', async () => {
    const a = await create({
      clientId: clients.c1,
      title: 'Firm A only',
      checklist: [{ label: 'Step' }],
      attachments: [{ documentId: docs.c1 }],
    });
    const type = TaskType.parse(
      ok(await call('post', '/task-types', people.ownerA, { name: mark('A type') }), 201),
    );
    const asB = (method: Method, path: string, body?: object) =>
      call(method, path, people.ownerB, body, 'b');
    const item = a.checklistItems[0]!.id;
    const attachment = a.attachments[0]!.id;

    for (const [method, path, body] of [
      ['get', `/tasks/${a.id}`],
      ['patch', `/tasks/${a.id}`, { title: 'Taken' }],
      ['post', `/tasks/${a.id}/complete`],
      ['post', `/tasks/${a.id}/reopen`],
      ['post', `/tasks/${a.id}/cancel`],
      ['post', `/tasks/${a.id}/progress`, { progress: 'WAITING' }],
      ['post', `/tasks/${a.id}/duplicate`],
      ['post', `/tasks/${a.id}/archive`],
      ['post', `/tasks/${a.id}/restore`],
      ['post', `/tasks/${a.id}/checklist/${item}/complete`],
      ['post', `/tasks/${a.id}/checklist/${item}/reopen`],
      ['put', `/tasks/${a.id}/checklist/order`, { ids: [item] }],
      ['post', `/tasks/${a.id}/attachments`, { documentId: docs.c1 }],
      ['patch', `/tasks/${a.id}/attachments/${attachment}`, { clientVisible: true }],
      ['delete', `/tasks/${a.id}/attachments/${attachment}`],
      ['put', `/task-types/${type.id}`, { name: 'Taken' }],
      ['post', `/task-types/${type.id}/archive`],
      ['post', `/task-types/${type.id}/restore`],
    ] as const) {
      const res = await asB(method, path, body);
      expect([res.status, codeOf(res), method, path].join(' ')).toBe(
        [404, 'NOT_FOUND', method, path].join(' '),
      );
    }

    // Firm A's records in firm B's bodies are refused as if they did not exist.
    const own = await create({ clientId: clients.cB, title: 'Firm B task' }, people.ownerB, 'b');
    for (const body of [
      { clientId: clients.c1, title: 'Into A' },
      { clientId: clients.cB, title: 'x', typeId: type.id },
      { clientId: clients.cB, title: 'x', dependsOnTaskId: a.id },
      { clientId: clients.cB, title: 'x', attachments: [{ documentId: docs.c1 }] },
      { clientId: clients.cB, title: 'x', additionalAssigneeIds: [people.ownerA.id] },
      { clientId: clients.cB, title: 'x', assignedUserId: people.ownerA.id },
    ]) {
      const res = await asB('post', '/tasks', body);
      expect(res.status, JSON.stringify(body)).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
    expect((await asB('patch', `/tasks/${own.id}`, { dependsOnTaskId: a.id })).status).toBe(400);
    // Its own document attaches; firm A's does not.
    expect((await asB('post', `/tasks/${own.id}/attachments`, { documentId: docB })).status).toBe(
      201,
    );
    expectError(
      await asB('post', `/tasks/${own.id}/attachments`, { documentId: docs.c1 }),
      409,
      'ATTACHMENT_NOT_ALLOWED',
    );

    // Only firm A's tasks: nothing found, like any one task of another firm.
    expectError(
      await asB('post', '/tasks/bulk', { action: 'COMPLETE', ids: [a.id, randomUUID()] }),
      404,
      'NOT_FOUND',
    );
    // Mixed with its own, bulk skips it as NOT_FOUND and changes nothing.
    const bulk = BulkTaskResult.parse(
      ok(await asB('post', '/tasks/bulk', { action: 'COMPLETE', ids: [a.id, own.id] })),
    );
    expect(bulk).toEqual({ updated: 1, skipped: [{ id: a.id, reason: 'NOT_FOUND' }] });

    // Lists show nothing of firm A's.
    const overview = TaskOverviewPage.parse(ok(await asB('get', '/tasks/overview?pageSize=100')));
    expect(overview.items.map((t) => t.id)).toEqual(expect.not.arrayContaining([a.id]));
    expect(TaskTypeList.parse(ok(await asB('get', '/task-types'))).items).toEqual([]);
    expectError(
      await call('get', `/tasks/${a.id}`, people.ownerB, undefined, 'a'),
      404,
      'NOT_FOUND',
    );

    expect(await get(a.id)).toEqual(a);
  });
});
