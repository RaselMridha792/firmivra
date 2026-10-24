// End-to-end: task drafts (R1, Oct 24; contract in packages/types/src/tasks/drafts.ts): Save as
// Draft with only a title, the Drafts tab (search, filters, sort, pages), reopen, edit, publish
// and discard. A draft is its creator's alone until it has a client, then the tasks' reach
// applies (Staff: their assigned clients'). No other read of tasks sees a draft and every task
// route answers 404 for one; publishing checks it as a new task is checked and makes the same id
// an OPEN task once. Firm B never reads or changes firm A's drafts. Audited with ids and field
// names, never text.
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
  TaskCalendar,
  TaskDetail as DetailShape,
  TaskDraft as DraftShape,
  TaskDraftPage as PageShape,
  TaskDraftRow,
  TaskList,
  TaskOverviewPage,
  TaskSummary,
  TaskType,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

// Strict, so a leaked field (businessId, an internal id) fails.
const TaskDetail = z.strictObject(DetailShape.shape);
type TaskDetail = z.infer<typeof TaskDetail>;
const TaskDraft = z.strictObject(DraftShape.shape);
type TaskDraft = z.infer<typeof TaskDraft>;
const DraftPage = z.strictObject({
  ...PageShape.shape,
  items: z.array(z.strictObject(TaskDraftRow.shape)),
});
type DraftPage = z.infer<typeof DraftPage>;

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r1td-${key}-${run}@r1td.test` });
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
type Firm = 'a' | 'b' | 'c';
const firms = {} as Record<Firm, string>;
/** c1 is staffA's, c2 is staffA2's, c3 is nobody's, cS has a name to search by; cB, cC. */
const clients = {} as Record<'c1' | 'c2' | 'c3' | 'cS' | 'cB' | 'cC', string>;
const engagements = {} as Record<'e1' | 'e2', string>;
/** Documents of firm A: c1's file and c2's file. */
const docs = {} as Record<'c1' | 'c2', string>;
const searchable = `Searchable ${run}`;

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.54.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

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
const inFirm = <T>(firm: Firm, work: Parameters<typeof runInScope<T>>[2]) =>
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
  firm: Firm = 'a',
): Promise<Response> {
  let req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', firms[firm])
    .set('x-forwarded-for', viewer());
  if (who) req = req.set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const pathsOf = (res: Response) =>
  ((res.body as { error?: { details?: { path: string }[] } }).error?.details ?? []).map(
    (d) => d.path,
  );
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};
const mark = (what: string) => `${what} ${run} ${randomUUID().slice(0, 6)}`;

const draftOf = (res: Response, status = 200): TaskDraft => TaskDraft.parse(ok(res, status));
const detailOf = (res: Response, status = 200): TaskDetail => TaskDetail.parse(ok(res, status));
const save = (body: object, who: Who = people.ownerA, firm: Firm = 'a') =>
  call('post', '/tasks/drafts', who, body, firm).then((r) => draftOf(r, 201));
const getDraft = (id: string, who: Who = people.ownerA) =>
  call('get', `/tasks/drafts/${id}`, who).then((r) => draftOf(r));
const edit = (id: string, body: object, who: Who = people.ownerA) =>
  call('patch', `/tasks/drafts/${id}`, who, body).then((r) => draftOf(r));
const publish = (id: string, body: object = {}, who: Who = people.ownerA, firm: Firm = 'a') =>
  call('post', `/tasks/drafts/${id}/publish`, who, body, firm);
const drafts = (query: string, who: Who = people.ownerA, firm: Firm = 'a'): Promise<DraftPage> =>
  call('get', `/tasks/drafts${query ? `?${query}` : ''}`, who, undefined, firm).then((r) =>
    DraftPage.parse(ok(r)),
  );
const idsOf = (page: { items: { id: string }[] }) => page.items.map((d) => d.id);
const createTask = (body: object, who: Who = people.ownerA, firm: Firm = 'a') =>
  call('post', '/tasks', who, body, firm).then((r) => detailOf(r, 201));
const newType = async (name: string) =>
  TaskType.parse(ok(await call('post', '/task-types', people.ownerA, { name }), 201));

/** A draft's row as the Drafts tab lists it. */
const rowOf = (d: TaskDraft) => ({
  id: d.id,
  title: d.title,
  client: d.client,
  type: d.type,
  service: d.service,
  priority: d.priority,
  dueOn: d.dueOn,
  assignedTo: d.assignedTo,
  createdBy: d.createdBy,
  missing: d.missing,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: key === 'clientA' ? 'CLIENT' : 'STAFF',
          email: p.email,
          name: `Fake R1td ${key}`,
        },
      });
    }
    for (const key of ['a', 'b', 'c'] as const) {
      const slug = `r1td-${key}-${run}`;
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
      tx.membership.create({ data: { businessId: firms[firm], userId, role, status: 'ACTIVE' } }),
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
    firm: Firm,
    serviceId: string,
    name: string,
    assignedUserId: string | null = null,
  ) => {
    const businessId = firms[firm];
    const c = await tx.client.create({
      data: { businessId, displayName: name, assignedUserId },
      select: { id: true },
    });
    const e = await tx.engagement.create({
      data: { businessId, clientId: c.id, serviceId, title: `${name} work` },
      select: { id: true },
    });
    return { client: c.id, engagement: e.id };
  };
  const doc = async (tx: Tx, owner: { client: string; engagement: string }) =>
    (
      await tx.document.create({
        data: {
          businessId: firms.a,
          clientId: owner.client,
          engagementId: owner.engagement,
          direction: 'CLIENT_TO_FIRM',
          fileName: 'fake.pdf',
          contentType: 'application/pdf',
          sizeBytes: 100,
          sha256: 'a'.repeat(64),
          s3Key: `tenant/${firms.a}/r1td/${randomUUID()}`,
        },
        select: { id: true },
      })
    ).id;

  await inFirm('a', async (tx) => {
    const svc = await service(tx, firms.a);
    const c1 = await client(tx, 'a', svc, 'Draft Client c1 (fake)', people.staffA.id);
    const c2 = await client(tx, 'a', svc, 'Draft Client c2 (fake)', people.staffA2.id);
    clients.c1 = c1.client;
    clients.c2 = c2.client;
    clients.c3 = (await client(tx, 'a', svc, 'Draft Client c3 (fake)')).client;
    clients.cS = (await client(tx, 'a', svc, `${searchable} (fake)`)).client;
    engagements.e1 = c1.engagement;
    engagements.e2 = c2.engagement;
    docs.c1 = await doc(tx, c1);
    docs.c2 = await doc(tx, c2);
  });
  await inFirm('b', async (tx) => {
    clients.cB = (
      await client(tx, 'b', await service(tx, firms.b), 'Draft Client cB (fake)')
    ).client;
  });
  await inFirm('c', async (tx) => {
    clients.cC = (
      await client(tx, 'c', await service(tx, firms.c), 'Draft Client cC (fake)')
    ).client;
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

describe('Save as Draft and reopen', () => {
  it('saves a draft with only a title, reads it back and lists it (before /tasks/:id)', async () => {
    const title = mark('Only a title');
    const d = await save({ title });
    expect(d).toMatchObject({
      title,
      status: 'DRAFT',
      client: null,
      missing: ['clientId'],
      type: null,
      service: null,
      engagement: null,
      priority: 'MEDIUM',
      progress: 'PENDING',
      dueOn: null,
      dueTime: null,
      allDay: true,
      clientVisible: false,
      assignedTo: null,
      assignedUserId: null,
      createdBy: { userId: people.ownerA.id },
      additionalAssignees: [],
      checklistItems: [],
      reminders: [],
      attachments: [],
      dependsOn: null,
      templateId: null,
    });
    expect(d.version).toBe(d.updatedAt);
    expect(await getDraft(d.id)).toEqual(d);
    // GET /tasks/drafts is the Drafts tab, not a task whose id is "drafts".
    const listed = await drafts(`search=${encodeURIComponent(title)}`);
    expect(listed).toEqual({ items: [rowOf(d)], total: 1, page: 1, pageSize: 10 });

    // Only the title is required; an engagement or a file needs the client first.
    for (const body of [{}, { title: '' }, { title: 'x', status: 'OPEN' }]) {
      expectError(
        await call('post', '/tasks/drafts', people.ownerA, body),
        400,
        'VALIDATION_FAILED',
      );
    }
    for (const body of [
      { title: 'x', engagementId: engagements.e1 },
      { title: 'x', attachments: [{ documentId: docs.c1 }] },
    ]) {
      const res = await call('post', '/tasks/drafts', people.ownerA, body);
      expectError(res, 400, 'VALIDATION_FAILED');
      expect(pathsOf(res)).toEqual(['clientId']);
    }
    expectError(
      await call('get', `/tasks/drafts/${randomUUID()}`, people.ownerA),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('get', '/tasks/drafts/not-an-id', people.ownerA),
      400,
      'VALIDATION_FAILED',
    );
    // Firm routes only: a client login is refused, a stranger is not signed in.
    expectError(await call('get', '/tasks/drafts', people.clientA), 403, 'FORBIDDEN');
    expectError(await call('post', '/tasks/drafts', people.clientA, { title }), 403, 'FORBIDDEN');
    expect((await call('get', '/tasks/drafts', undefined)).status).toBe(401);
  });

  it('keeps the fields as sent: only what the database cannot hold, or another firm’s id, is refused', async () => {
    const archived = await newType(mark('Archived kind'));
    ok(await call('post', `/task-types/${archived.id}/archive`, people.ownerA));
    const prerequisite = await createTask({ clientId: clients.c1, title: mark('Before') });
    const d = await save({
      title: mark('Full draft'),
      clientId: clients.c1,
      engagementId: engagements.e1,
      details: 'Synthetic details',
      typeId: archived.id,
      priority: 'HIGH',
      // Blocked without a reason, a Staff assignee without the client: publishing checks those.
      progress: 'BLOCKED',
      assignedUserId: people.staffA2.id,
      additionalAssigneeIds: [people.adminA.id],
      startOn: '2031-02-01',
      dueOn: '2031-02-10',
      dueTime: '15:30',
      clientVisible: true,
      internalNotes: 'Staff only',
      checklist: [{ label: 'First', required: true }, { label: 'Second' }],
      reminders: [{ daysBefore: 0, timeOfDay: '16:00' }],
      attachments: [{ documentId: docs.c1, clientVisible: true }],
      dependsOnTaskId: prerequisite.id,
    });
    expect(d).toMatchObject({
      client: { id: clients.c1 },
      missing: [],
      engagement: { id: engagements.e1 },
      type: { id: archived.id },
      priority: 'HIGH',
      progress: 'BLOCKED',
      assignedUserId: people.staffA2.id,
      startOn: '2031-02-01',
      dueOn: '2031-02-10',
      dueTime: '15:30',
      allDay: false,
      clientVisible: true,
      internalNotes: 'Staff only',
      dependsOn: { id: prerequisite.id, status: 'OPEN' },
    });
    expect(d.additionalAssignees.map((m) => m.userId)).toEqual([people.adminA.id]);
    expect(d.checklistItems.map((i) => [i.label, i.required])).toEqual([
      ['First', true],
      ['Second', false],
    ]);
    expect(d.reminders.map((r) => [r.daysBefore, r.timeOfDay])).toEqual([[0, '16:00']]);
    expect(d.attachments).toEqual([
      expect.objectContaining({ documentId: docs.c1, clientVisible: true }),
    ]);
    // Reminders without a due date wait for publishing too.
    const undated = await save({ title: mark('Undated'), reminders: [{ daysBefore: 2 }] });
    expect(undated.reminders.map((r) => r.daysBefore)).toEqual([2]);

    const bad = async (body: object, status: number, code: string) =>
      expectError(
        await call('post', '/tasks/drafts', people.ownerA, { title: 'Bad draft', ...body }),
        status,
        code,
      );
    await bad({ startOn: '2031-02-02', dueOn: '2031-02-01' }, 400, 'VALIDATION_FAILED');
    await bad({ dueTime: '10:00' }, 400, 'VALIDATION_FAILED');
    await bad({ reminders: [{ daysBefore: 1 }, { daysBefore: 1 }] }, 400, 'INVALID_REMINDER');
    await bad({ typeId: randomUUID() }, 400, 'VALIDATION_FAILED');
    await bad({ serviceId: randomUUID() }, 400, 'VALIDATION_FAILED');
    await bad({ templateId: randomUUID() }, 400, 'VALIDATION_FAILED');
    await bad({ dependsOnTaskId: randomUUID() }, 400, 'VALIDATION_FAILED');
    await bad({ clientId: clients.cB }, 404, 'NOT_FOUND');
    await bad({ assignedUserId: people.ownerB.id }, 409, 'NOT_A_MEMBER');
    await bad({ additionalAssigneeIds: [people.ownerB.id] }, 409, 'NOT_A_MEMBER');
    await bad(
      { checklist: [{ label: 'x', assignedUserId: people.ownerB.id }] },
      409,
      'NOT_A_MEMBER',
    );
    await bad({ checklist: [{ id: randomUUID(), label: 'x' }] }, 400, 'VALIDATION_FAILED');
    await bad({ clientId: clients.c1, engagementId: engagements.e2 }, 409, 'ENGAGEMENT_MISMATCH');
    await bad(
      { clientId: clients.c1, attachments: [{ documentId: docs.c2 }] },
      409,
      'ATTACHMENT_NOT_ALLOWED',
    );
  });

  it('fills what the request leaves out from a template, as a new task does', async () => {
    const tpl = ok(
      await call('post', '/task-templates', people.ownerA, {
        name: mark('Draft template'),
        priority: 'LOW',
        checklist: [{ label: 'Collect the statements', required: true }],
      }),
      201,
    ) as { id: string };
    const d = await save({ title: mark('From a template'), templateId: tpl.id });
    expect(d).toMatchObject({ priority: 'LOW', templateId: tpl.id, client: null });
    expect(d.checklistItems.map((i) => [i.label, i.required])).toEqual([
      ['Collect the statements', true],
    ]);
    // The request's own fields win.
    const own = await save({ title: mark('Own priority'), templateId: tpl.id, priority: 'HIGH' });
    expect(own.priority).toBe('HIGH');
  });
});

describe('edit a draft', () => {
  it('changes only what is sent and guards a stale save', async () => {
    const d = await save({
      title: mark('To edit'),
      clientId: clients.c1,
      details: 'D',
      priority: 'LOW',
      dueOn: '2031-03-01',
      checklist: [{ label: 'Keep' }, { label: 'Drop' }],
    });
    const changed = await edit(d.id, { priority: 'HIGH', details: null, version: d.version });
    expect(changed).toMatchObject({
      title: d.title,
      details: null,
      priority: 'HIGH',
      dueOn: '2031-03-01',
      status: 'DRAFT',
      client: { id: clients.c1 },
    });
    expect(changed.version).not.toBe(d.version);
    expectError(
      await call('patch', `/tasks/drafts/${d.id}`, people.adminA, {
        priority: 'LOW',
        version: d.version,
      }),
      409,
      'SAVE_CONFLICT',
    );
    expectError(
      await call('patch', `/tasks/drafts/${d.id}`, people.ownerA, {}),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', `/tasks/drafts/${randomUUID()}`, people.ownerA, { title: 'x' }),
      404,
      'NOT_FOUND',
    );
    // A step sent with its id keeps its row; one left out goes.
    const [keep] = changed.checklistItems;
    const steps = await edit(d.id, {
      checklist: [{ id: keep!.id, label: 'Kept, renamed' }, { label: 'Added' }],
    });
    expect(steps.checklistItems.map((i) => i.label)).toEqual(['Kept, renamed', 'Added']);
    expect(steps.checklistItems[0]?.id).toBe(keep!.id);
    // Clearing the date takes the time with it.
    const timed = await edit(d.id, { dueTime: '08:15' });
    expect(timed).toMatchObject({ dueTime: '08:15', allDay: false });
    expect(await edit(d.id, { dueOn: null })).toMatchObject({
      dueOn: null,
      dueTime: null,
      allDay: true,
    });
  });

  it('a new client takes the engagement and files with it, unless new ones come along', async () => {
    const d = await save({
      title: mark('Client change'),
      clientId: clients.c1,
      engagementId: engagements.e1,
      attachments: [{ documentId: docs.c1 }],
    });
    const moved = await edit(d.id, { clientId: clients.c2 });
    expect(moved).toMatchObject({ client: { id: clients.c2 }, engagement: null, attachments: [] });
    const withOwn = await edit(d.id, {
      clientId: clients.c1,
      engagementId: engagements.e1,
      attachments: [{ documentId: docs.c1 }],
    });
    expect(withOwn).toMatchObject({
      client: { id: clients.c1 },
      engagement: { id: engagements.e1 },
    });
    expect(withOwn.attachments.map((a) => a.documentId)).toEqual([docs.c1]);
    // The same client again changes nothing of it.
    const same = await edit(d.id, { clientId: clients.c1, title: `${d.title} v2` });
    expect(same.engagement?.id).toBe(engagements.e1);
    expect(same.attachments).toHaveLength(1);
    // Another client's engagement or file is refused.
    expectError(
      await call('patch', `/tasks/drafts/${d.id}`, people.ownerA, {
        clientId: clients.c2,
        engagementId: engagements.e1,
      }),
      409,
      'ENGAGEMENT_MISMATCH',
    );
    expectError(
      await call('patch', `/tasks/drafts/${d.id}`, people.ownerA, {
        attachments: [{ documentId: docs.c2 }],
      }),
      409,
      'ATTACHMENT_NOT_ALLOWED',
    );
    // Clearing the client: the draft needs one again before it can be published.
    const cleared = await edit(d.id, { clientId: null });
    expect(cleared).toMatchObject({
      client: null,
      missing: ['clientId'],
      engagement: null,
      attachments: [],
    });
    for (const body of [
      { engagementId: engagements.e1 },
      { attachments: [{ documentId: docs.c1 }] },
      { clientId: null, engagementId: engagements.e1 },
    ]) {
      const res = await call('patch', `/tasks/drafts/${d.id}`, people.ownerA, body);
      expectError(res, 400, 'VALIDATION_FAILED');
      expect(pathsOf(res), JSON.stringify(body)).toEqual(['clientId']);
    }
  });
});

describe('who sees which draft', () => {
  it('a draft without a client is its creator’s alone, even for the Owner', async () => {
    const mine = await save({ title: mark('Staff private') }, people.staffA);
    expect((await getDraft(mine.id, people.staffA)).id).toBe(mine.id);
    expect(idsOf(await drafts('pageSize=100', people.staffA))).toContain(mine.id);
    for (const who of [people.ownerA, people.adminA, people.staffA2]) {
      expectError(await call('get', `/tasks/drafts/${mine.id}`, who), 404, 'NOT_FOUND');
      expect(idsOf(await drafts('pageSize=100', who))).not.toContain(mine.id);
      expectError(
        await call('patch', `/tasks/drafts/${mine.id}`, who, { title: 'Taken' }),
        404,
        'NOT_FOUND',
      );
      expectError(await publish(mine.id, { clientId: clients.c3 }, who), 404, 'NOT_FOUND');
      expectError(await call('delete', `/tasks/drafts/${mine.id}`, who), 404, 'NOT_FOUND');
    }
    const ownersOwn = await save({ title: mark('Owner private') });
    expectError(
      await call('get', `/tasks/drafts/${ownersOwn.id}`, people.staffA),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('get', `/tasks/drafts/${ownersOwn.id}`, people.adminA),
      404,
      'NOT_FOUND',
    );
    expect((await getDraft(mine.id, people.staffA)).title).toBe(mine.title);
  });

  it('a draft with a client follows the tasks’ reach: Staff see their assigned clients’', async () => {
    const theirs = await save({ title: mark('For c1'), clientId: clients.c1 });
    const others = await save({ title: mark('For c2'), clientId: clients.c2 });
    expect((await getDraft(theirs.id, people.staffA)).id).toBe(theirs.id);
    expectError(await call('get', `/tasks/drafts/${others.id}`, people.staffA), 404, 'NOT_FOUND');
    const seen = idsOf(await drafts('pageSize=100', people.staffA));
    expect(seen).toContain(theirs.id);
    expect(seen).not.toContain(others.id);
    expect((await getDraft(others.id, people.staffA2)).id).toBe(others.id);
    // Owner and Admin see every draft with a client.
    for (const who of [people.ownerA, people.adminA]) {
      expect(idsOf(await drafts('pageSize=100', who))).toEqual(
        expect.arrayContaining([theirs.id, others.id]),
      );
    }
    // Staff save and edit only for their own clients (404 as for a new task).
    expectError(
      await call('post', '/tasks/drafts', people.staffA, { title: 'No', clientId: clients.c2 }),
      404,
      'NOT_FOUND',
    );
    expect((await edit(theirs.id, { priority: 'HIGH' }, people.staffA)).priority).toBe('HIGH');
    expectError(
      await call('patch', `/tasks/drafts/${theirs.id}`, people.staffA, { clientId: clients.c2 }),
      404,
      'NOT_FOUND',
    );
    // A prerequisite Staff cannot reach is not a prerequisite.
    const hidden = await createTask({ clientId: clients.c2, title: mark('Hidden') });
    expectError(
      await call('patch', `/tasks/drafts/${theirs.id}`, people.staffA, {
        dependsOnTaskId: hidden.id,
      }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('a draft whose client leaves its creator’s reach leaves the creator too', async () => {
    const moving = await save({ title: mark('Moving'), clientId: clients.c1 }, people.staffA);
    expect((await getDraft(moving.id, people.staffA)).id).toBe(moving.id);
    // The Owner moves it to c2, staffA2's client: staffA no longer reaches it in any way.
    expect((await edit(moving.id, { clientId: clients.c2 })).client?.id).toBe(clients.c2);
    expectError(await call('get', `/tasks/drafts/${moving.id}`, people.staffA), 404, 'NOT_FOUND');
    expect(idsOf(await drafts('pageSize=100', people.staffA))).not.toContain(moving.id);
    expectError(
      await call('patch', `/tasks/drafts/${moving.id}`, people.staffA, { title: 'Mine' }),
      404,
      'NOT_FOUND',
    );
    expectError(await publish(moving.id, {}, people.staffA), 404, 'NOT_FOUND');
    expectError(
      await call('delete', `/tasks/drafts/${moving.id}`, people.staffA),
      404,
      'NOT_FOUND',
    );
    // staffA2, whose client it now is, and the Owner still have it.
    expect((await getDraft(moving.id, people.staffA2)).title).toBe(moving.title);
    expect((await getDraft(moving.id)).title).toBe(moving.title);
  });
});

describe('the Drafts tab', () => {
  it('searches, filters, sorts and pages', async () => {
    const word = `Tab${randomUUID().slice(0, 6)}`;
    const kind = await newType(mark('Kind'));
    const alpha = await save({
      title: `${word} alpha`,
      clientId: clients.c1,
      typeId: kind.id,
      priority: 'HIGH',
    });
    const beta = await save({ title: `${word} beta`, priority: 'LOW' });
    const gamma = await save({
      title: `${word} gamma`,
      clientId: clients.cS,
      dueOn: '2031-05-01',
    });
    const delta = await save(
      {
        title: `${word} delta`,
        clientId: clients.c1,
        priority: 'HIGH',
        assignedUserId: people.staffA.id,
        dueOn: '2031-04-01',
      },
      people.adminA,
    );
    const titles = async (q: string, who: Who = people.ownerA) =>
      (await drafts(`search=${word}&pageSize=100&${q}`, who)).items.map((d) =>
        d.title.slice(word.length + 1),
      );
    const set = async (q: string, who?: Who) => (await titles(q, who)).sort();

    // Newest change first by default.
    expect(await titles('')).toEqual(['delta', 'gamma', 'beta', 'alpha']);
    await edit(beta.id, { details: 'touched' });
    expect((await titles(''))[0]).toBe('beta');
    expect(await set('priority=HIGH')).toEqual(['alpha', 'delta']);
    expect(await set(`typeId=${kind.id}`)).toEqual(['alpha']);
    expect(await set(`clientId=${clients.c1}`)).toEqual(['alpha', 'delta']);
    expect(await set(`assignedUserId=${people.staffA.id}`)).toEqual(['delta']);
    expect(await set('mine=true')).toEqual(['alpha', 'beta', 'gamma']);
    expect(await set('mine=true', people.adminA)).toEqual(['delta']);
    expect(await set('mine=true&priority=HIGH')).toEqual(['alpha']);
    // The search matches the title, the client's name and the type's.
    expect(idsOf(await drafts(`search=${encodeURIComponent(searchable)}`))).toEqual([gamma.id]);
    expect(idsOf(await drafts(`search=${encodeURIComponent(kind.name)}`))).toEqual([alpha.id]);
    expect(idsOf(await drafts(`search=${word.toLowerCase()}%20ALPHA`))).toEqual([alpha.id]);
    // Sorts.
    expect(await titles('sort=title&direction=asc')).toEqual(['alpha', 'beta', 'delta', 'gamma']);
    expect(await titles('sort=title&direction=desc')).toEqual(['gamma', 'delta', 'beta', 'alpha']);
    expect(
      (await drafts(`search=${word}&sort=priority&direction=desc`)).items.map((d) => d.priority),
    ).toEqual(['HIGH', 'HIGH', 'MEDIUM', 'LOW']);
    // Due: the dated first, soonest first; a draft with no date is the latest.
    expect((await titles('sort=due&direction=asc')).slice(0, 2)).toEqual(['delta', 'gamma']);
    // Pages.
    const first = await drafts(`search=${word}&pageSize=3`);
    expect([first.items.length, first.total, first.page, first.pageSize]).toEqual([3, 4, 1, 3]);
    const second = await drafts(`search=${word}&pageSize=3&page=2`);
    expect(second.items).toHaveLength(1);
    expect(new Set([...idsOf(first), ...idsOf(second)])).toEqual(
      new Set([alpha.id, beta.id, gamma.id, delta.id]),
    );
    expect((await drafts(`search=${word}&page=9`)).items).toEqual([]);
    for (const q of ['pageSize=101', 'sort=nope', 'mine=maybe', 'priority=URGENT', 'extra=1']) {
      expectError(await call('get', `/tasks/drafts?${q}`, people.ownerA), 400, 'VALIDATION_FAILED');
    }
  });
});

describe('drafts are not tasks yet', () => {
  it('no list, count or calendar shows a draft, and every task route answers 404 for one', async () => {
    // Firm C is this test's alone.
    const asC = (method: Method, path: string, body?: object) =>
      call(method, path, people.ownerC, body, 'c');
    const summary = async () => TaskSummary.parse(ok(await asC('get', '/tasks/summary')));
    const zero = {
      total: 0,
      pending: 0,
      inProgress: 0,
      overdue: 0,
      completedThisMonth: 0,
      mine: 0,
    };
    expect(await summary()).toEqual(zero);
    const d = await save(
      {
        title: mark('Late draft'),
        clientId: clients.cC,
        dueOn: '2020-01-10',
        progress: 'IN_PROGRESS',
        assignedUserId: people.ownerC.id,
        checklist: [{ label: 'Step' }],
      },
      people.ownerC,
      'c',
    );
    await save({ title: mark('Clientless draft') }, people.ownerC, 'c');
    const overview = async (q = '') =>
      TaskOverviewPage.parse(ok(await asC('get', `/tasks/overview?pageSize=100${q}`)));
    const calendar = async () =>
      TaskCalendar.parse(ok(await asC('get', '/tasks/calendar?from=2020-01-01&to=2020-01-31')));
    const legacy = async () =>
      TaskList.parse(ok(await asC('get', `/tasks?clientId=${clients.cC}`)));

    expect(await summary()).toEqual(zero);
    for (const view of ['', '&view=mine', '&view=completed', '&view=archived', '&overdue=true']) {
      expect((await overview(view)).items, view).toEqual([]);
    }
    expect((await calendar()).items).toEqual([]);
    expect((await legacy()).items).toEqual([]);

    const step = d.checklistItems[0]!.id;
    for (const [method, path, body] of [
      ['get', `/tasks/${d.id}`],
      ['patch', `/tasks/${d.id}`, { title: 'Taken' }],
      ['post', `/tasks/${d.id}/complete`],
      ['post', `/tasks/${d.id}/reopen`],
      ['post', `/tasks/${d.id}/cancel`],
      ['post', `/tasks/${d.id}/progress`, { progress: 'WAITING' }],
      ['post', `/tasks/${d.id}/duplicate`],
      ['post', `/tasks/${d.id}/archive`],
      ['post', `/tasks/${d.id}/restore`],
      ['post', `/tasks/${d.id}/save-as-template`, { name: mark('From a draft') }],
      ['post', `/tasks/${d.id}/convert-to-recurring`, { recurrence: { unit: 'MONTH' } }],
      ['put', `/tasks/${d.id}/checklist/order`, { ids: [step] }],
      ['post', `/tasks/${d.id}/checklist/${step}/complete`],
      ['post', `/tasks/${d.id}/checklist/${step}/reopen`],
      ['post', `/tasks/${d.id}/attachments`, { documentId: randomUUID() }],
    ] as const) {
      const res = await asC(method, path, body);
      expect([res.status, codeOf(res), method, path].join(' ')).toBe(
        [404, 'NOT_FOUND', method, path].join(' '),
      );
    }
    // Bulk skips it as not found; alone, nothing is found at all.
    expectError(
      await asC('post', '/tasks/bulk', { action: 'COMPLETE', ids: [d.id] }),
      404,
      'NOT_FOUND',
    );
    const live = await createTask(
      { clientId: clients.cC, title: mark('Live') },
      people.ownerC,
      'c',
    );
    const bulk = BulkTaskResult.parse(
      ok(
        await asC('post', '/tasks/bulk', {
          action: 'SET_PRIORITY',
          ids: [d.id, live.id],
          priority: 'HIGH',
        }),
      ),
    );
    expect(bulk).toEqual({ updated: 1, skipped: [{ id: d.id, reason: 'NOT_FOUND' }] });
    // A draft is no task's prerequisite.
    expectError(
      await asC('post', '/tasks', { clientId: clients.cC, title: 'Waits', dependsOnTaskId: d.id }),
      400,
      'VALIDATION_FAILED',
    );
    ok(await asC('post', `/tasks/${live.id}/cancel`));
    expect(draftOf(await asC('get', `/tasks/drafts/${d.id}`)).status).toBe('DRAFT');

    // Published, it is a task like any other.
    const task = detailOf(await publish(d.id, {}, people.ownerC, 'c'));
    expect(await summary()).toEqual({ ...zero, total: 1, inProgress: 1, overdue: 1, mine: 1 });
    expect(idsOf(await overview())).toEqual([task.id]);
    expect(idsOf(await overview('&view=mine'))).toEqual([task.id]);
    expect((await calendar()).items.map((i) => i.id)).toEqual([task.id]);
    // The older list: open tasks first, then the closed ones.
    expect((await legacy()).items.map((t) => t.id)).toEqual([task.id, live.id]);
  });
});

describe('publish', () => {
  it('needs a client, then makes the same id an OPEN task, once', async () => {
    const d = await save({ title: mark('To publish'), priority: 'HIGH' });
    const none = await publish(d.id);
    expectError(none, 400, 'VALIDATION_FAILED');
    expect(pathsOf(none)).toEqual(['clientId']);
    expect((await getDraft(d.id)).status).toBe('DRAFT');
    expectError(await publish(d.id, { version: '2020-01-01T00:00:00.000Z' }), 409, 'SAVE_CONFLICT');

    const task = detailOf(
      await publish(d.id, { clientId: clients.c1, dueOn: '2031-06-01', version: d.version }),
    );
    expect(task).toMatchObject({
      id: d.id,
      title: d.title,
      status: 'OPEN',
      kind: 'GENERAL',
      client: { id: clients.c1 },
      dueOn: '2031-06-01',
      priority: 'HIGH',
      createdBy: { userId: people.ownerA.id },
      archivedAt: null,
    });
    expect(TaskDetail.parse(ok(await call('get', `/tasks/${d.id}`, people.ownerA)))).toEqual(task);
    expect(Date.parse(task.createdAt)).toBeGreaterThanOrEqual(Date.parse(d.createdAt));
    // Not a draft any more: a second publish, an edit or a discard finds none.
    expectError(await publish(d.id), 404, 'NOT_FOUND');
    expectError(await call('get', `/tasks/drafts/${d.id}`, people.ownerA), 404, 'NOT_FOUND');
    expectError(
      await call('patch', `/tasks/drafts/${d.id}`, people.ownerA, { title: 'x' }),
      404,
      'NOT_FOUND',
    );
    expectError(await call('delete', `/tasks/drafts/${d.id}`, people.ownerA), 404, 'NOT_FOUND');
    expect(idsOf(await drafts('pageSize=100'))).not.toContain(d.id);
    const listed = TaskOverviewPage.parse(
      ok(await call('get', `/tasks/overview?search=${encodeURIComponent(d.title)}`, people.ownerA)),
    );
    expect(idsOf(listed)).toEqual([d.id]);
    // It is worked like any task.
    expect(detailOf(await call('post', `/tasks/${d.id}/complete`, people.ownerA)).status).toBe(
      'DONE',
    );
  });

  it('checks the draft as a new task is checked; refused, it stays a draft as it was', async () => {
    // Staff saved it with an assignee who cannot take the client.
    const d = await save(
      {
        title: mark('Staff draft'),
        clientId: clients.c1,
        assignedUserId: people.staffA2.id,
      },
      people.staffA,
    );
    expectError(
      await publish(d.id, { title: 'Changed' }, people.staffA),
      409,
      'CLIENT_NOT_ASSIGNED',
    );
    const kept = await getDraft(d.id, people.staffA);
    expect(kept).toMatchObject({
      status: 'DRAFT',
      title: d.title,
      assignedUserId: people.staffA2.id,
      version: d.version,
    });
    const archived = await newType(mark('Gone kind'));
    ok(await call('post', `/task-types/${archived.id}/archive`, people.ownerA));
    const refusals: [object, number, string][] = [
      [{ typeId: archived.id }, 409, 'TYPE_ARCHIVED'],
      [{ reminders: [{ daysBefore: 1 }] }, 400, 'INVALID_REMINDER'],
      [{ progress: 'BLOCKED' }, 400, 'VALIDATION_FAILED'],
      [
        {
          dueOn: '2031-07-01',
          dueTime: '09:00',
          reminders: [{ daysBefore: 0, timeOfDay: '10:00' }],
        },
        400,
        'INVALID_REMINDER',
      ],
    ];
    for (const [fields, status, code] of refusals) {
      const draft = await save({ title: mark('Refused'), clientId: clients.c1, ...fields });
      expectError(await publish(draft.id), status, code);
      expect((await getDraft(draft.id)).status).toBe('DRAFT');
    }
    // Fixed with the publish itself, it goes.
    const fixed = detailOf(
      await publish(d.id, { assignedUserId: people.staffA.id }, people.staffA),
    );
    expect(fixed).toMatchObject({ id: d.id, status: 'OPEN', assignedUserId: people.staffA.id });
  });
});

describe('publish after a prerequisite is done', () => {
  it('releases a draft blocked by its prerequisite, which then publishes as saved', async () => {
    const first = await createTask({ clientId: clients.c1, title: mark('First') });
    const waiting = await save({
      title: mark('Then'),
      clientId: clients.c1,
      dependsOnTaskId: first.id,
    });
    expect(waiting.progress).toBe('BLOCKED');
    ok(await call('post', `/tasks/${first.id}/complete`, people.ownerA));
    expect((await getDraft(waiting.id)).progress).toBe('PENDING');
    const task = detailOf(await publish(waiting.id));
    expect([task.id, task.status, task.progress]).toEqual([waiting.id, 'OPEN', 'PENDING']);
  });

  it('names a missing client before anything else the body sends', async () => {
    const bare = await save({ title: mark('No client yet') });
    // Applied first, an unknown assignee would answer before the missing client did.
    const res = await publish(bare.id, { assignedUserId: randomUUID(), priority: 'HIGH' });
    expectError(res, 400, 'VALIDATION_FAILED');
    expect(pathsOf(res)).toEqual(['clientId']);
  });
});

describe('discard', () => {
  it('deletes the draft with its checklist, reminders and files', async () => {
    const d = await save({
      title: mark('To discard'),
      clientId: clients.c1,
      dueOn: '2031-08-01',
      checklist: [{ label: 'Step' }],
      reminders: [{ daysBefore: 1 }],
      attachments: [{ documentId: docs.c1 }],
      additionalAssigneeIds: [people.adminA.id],
    });
    OkResponse.parse(ok(await call('delete', `/tasks/drafts/${d.id}`, people.ownerA)));
    expectError(await call('get', `/tasks/drafts/${d.id}`, people.ownerA), 404, 'NOT_FOUND');
    expectError(await call('delete', `/tasks/drafts/${d.id}`, people.ownerA), 404, 'NOT_FOUND');
    expect(idsOf(await drafts('pageSize=100'))).not.toContain(d.id);
    const left = await inFirm('a', async (tx) => ({
      task: await tx.task.count({ where: { id: d.id } }),
      steps: await tx.taskChecklistItem.count({ where: { taskId: d.id } }),
      reminders: await tx.taskReminder.count({ where: { taskId: d.id } }),
      files: await tx.taskAttachment.count({ where: { taskId: d.id } }),
      people: await tx.taskAssignee.count({ where: { taskId: d.id } }),
    }));
    expect(left).toEqual({ task: 0, steps: 0, reminders: 0, files: 0, people: 0 });
    // A live task is not a draft to discard.
    const live = await createTask({ clientId: clients.c1, title: mark('Live') });
    expectError(await call('delete', `/tasks/drafts/${live.id}`, people.ownerA), 404, 'NOT_FOUND');
  });
});

describe('firm B against firm A', () => {
  it('never reads, changes, publishes or discards firm A’s drafts', async () => {
    const a = await save({
      title: mark('Firm A draft'),
      clientId: clients.c1,
      checklist: [{ label: 'Step' }],
    });
    const asB = (method: Method, path: string, body?: object) =>
      call(method, path, people.ownerB, body, 'b');
    for (const [method, path, body] of [
      ['get', `/tasks/drafts/${a.id}`],
      ['patch', `/tasks/drafts/${a.id}`, { title: 'Taken' }],
      ['post', `/tasks/drafts/${a.id}/publish`, {}],
      ['post', `/tasks/drafts/${a.id}/publish`, { clientId: clients.cB }],
      ['delete', `/tasks/drafts/${a.id}`],
      ['get', `/tasks/${a.id}`],
    ] as const) {
      const res = await asB(method, path, body);
      expect([res.status, codeOf(res), method, path].join(' ')).toBe(
        [404, 'NOT_FOUND', method, path].join(' '),
      );
    }
    expect(idsOf(await drafts('pageSize=100', people.ownerB, 'b'))).not.toContain(a.id);
    // Naming firm A in the header is no way in.
    expectError(
      await call('get', '/tasks/drafts', people.ownerB, undefined, 'a'),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('get', `/tasks/drafts/${a.id}`, people.ownerB, undefined, 'a'),
      404,
      'NOT_FOUND',
    );

    // Firm A's records in firm B's drafts are refused as if they did not exist.
    const kind = await newType(mark('A kind'));
    const aTask = await createTask({ clientId: clients.c1, title: mark('A task') });
    const own = await save(
      { title: mark('Firm B draft'), clientId: clients.cB },
      people.ownerB,
      'b',
    );
    for (const body of [
      { clientId: clients.c1 },
      { typeId: kind.id },
      { dependsOnTaskId: aTask.id },
      { dependsOnTaskId: a.id },
      { clientId: clients.cB, attachments: [{ documentId: docs.c1 }] },
      { assignedUserId: people.ownerA.id },
      { additionalAssigneeIds: [people.ownerA.id] },
    ]) {
      for (const res of [
        await asB('post', '/tasks/drafts', { title: 'x', ...body }),
        await asB('patch', `/tasks/drafts/${own.id}`, body),
      ]) {
        expect(res.status, JSON.stringify(body)).toBeGreaterThanOrEqual(400);
        expect(res.status, JSON.stringify(body)).toBeLessThan(500);
      }
    }
    expect(await getDraft(a.id)).toEqual(a);
  });
});

describe('audit', () => {
  it('records save, view, edit, publish and discard with ids and field names, never text', async () => {
    const secret = `Secret-${run}`;
    const d = await save({
      title: `${secret} title`,
      details: `${secret} details`,
      internalNotes: `${secret} notes`,
      checklist: [{ label: `${secret} step` }],
    });
    await getDraft(d.id);
    await edit(d.id, { details: `${secret} again`, priority: 'HIGH' });
    const task = detailOf(await publish(d.id, { clientId: clients.c1, dueOn: '2031-09-01' }));
    const gone = await save({ title: `${secret} gone`, clientId: clients.c3 });
    ok(await call('delete', `/tasks/drafts/${gone.id}`, people.ownerA));
    await drafts(`search=${secret}&priority=HIGH`);

    const rows = await inFirm('a', (tx) =>
      tx.auditLog.findMany({
        where: { entityId: { in: [d.id, gone.id] } },
        orderBy: { createdAt: 'asc' },
      }),
    );
    const of = (id: string) => rows.filter((r) => r.entityId === id).map((r) => r.action);
    expect(of(d.id)).toEqual([
      'task.draft_saved',
      'task.draft_viewed',
      'task.draft_updated',
      'task.created',
    ]);
    expect(of(gone.id)).toEqual(['task.draft_saved', 'task.draft_discarded']);
    expect(JSON.stringify(rows.map((r) => r.metadata))).not.toContain(secret);
    const meta = (action: string, id = d.id) =>
      rows.find((r) => r.action === action && r.entityId === id)?.metadata;
    expect(meta('task.draft_saved')).toEqual({
      clientId: null,
      fields: ['checklist', 'details', 'internalNotes'],
    });
    expect(meta('task.draft_updated')).toEqual({ clientId: null, fields: ['details', 'priority'] });
    expect(meta('task.created')).toEqual({
      clientId: clients.c1,
      engagementId: null,
      assignedUserId: null,
      fields: ['clientId', 'dueOn'],
      fromDraft: true,
    });
    expect(meta('task.draft_discarded', gone.id)).toEqual({ clientId: clients.c3 });
    expect(task.id).toBe(d.id);
    const listed = await inFirm('a', (tx) =>
      tx.auditLog.findFirst({
        where: { action: 'tasks.drafts_listed' },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(listed?.metadata).toEqual({ count: 0, filters: ['priority', 'search'] });
  });
});
