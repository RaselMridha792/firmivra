// End-to-end: R55, task templates and recurring tasks (contract in packages/types/src/tasks/work.ts).
// Templates: made by Owner and Admin, read by Staff, started from by `templateId` as a snapshot.
// Series: the preview, the occurrences scheduled ahead, the generation job (one task per due
// occurrence, never twice, however often or at once it runs), the edit scopes, pause, resume,
// stop, skip, a task turned into a series. Firm B never reads or changes firm A's.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  SeriesPreview,
  TaskDetail,
  TaskOccurrence,
  TaskOccurrencePage,
  TaskSeriesDetail,
  TaskSeriesPage,
  TaskTemplate,
  TaskTemplateList,
  TaskType,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { TaskSeriesJob } from '../../src/tasks/task-series.job.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55r-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  staffA2: person('staff-a2'),
  formerA: person('former-a'),
  clientA: person('client-a'),
  ownerB: person('owner-b'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', string>;
/** c1 is staffA's, c2 is staffA2's, c3 nobody's; cB is firm B's. */
const clients = {} as Record<'c1' | 'c2' | 'c3' | 'cB', string>;
const engagements = {} as Record<'e1', string>;

let app: INestApplication;
let job: TaskSeriesJob;
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
const inFirm = <T>(firm: 'a' | 'b', work: Parameters<typeof runInScope<T>>[2]) =>
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
  firm: 'a' | 'b' = 'a',
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
const mark = (what: string) => `${what} ${run} ${randomUUID().slice(0, 6)}`;

const template = (res: Response, status = 200) => TaskTemplate.parse(ok(res, status));
const series = (res: Response, status = 200) => TaskSeriesDetail.parse(ok(res, status));
const mkTemplate = (body: object = {}, who: Who = people.ownerA) =>
  call('post', '/task-templates', who, { name: mark('Template'), ...body }).then((r) =>
    template(r, 201),
  );
/** Series a test made: stopped after it, so a later test's job run has only its own to look at. */
const toStop: string[] = [];
const mkSeries = (body: Record<string, unknown> = {}, who: Who = people.ownerA) =>
  call('post', '/task-series', who, {
    clientId: clients.c1,
    title: mark('Series'),
    ...body,
    // No weekend shift unless a test asks: dates then count straight.
    recurrence: {
      unit: 'DAY',
      startOn: '2030-01-01',
      holidayRule: 'NONE',
      ...(body.recurrence as object | undefined),
    },
  }).then((r) => {
    const created = series(r, 201);
    toStop.push(created.id);
    return created;
  });
const occurrences = (id: string, q = '') =>
  call('get', `/task-series/${id}/occurrences?pageSize=100${q}`, people.ownerA).then((r) =>
    TaskOccurrencePage.parse(ok(r)),
  );
/** A job run as of noon UTC that day: the same calendar date in any US time zone. */
const runJob = (date: string, businessIds = [firms.a]) =>
  job.run({ now: new Date(`${date}T16:00:00Z`), businessIds });
const tasksOf = (seriesId: string) =>
  inFirm('a', async (tx) => {
    const occ = await tx.taskOccurrence.findMany({
      where: { seriesId, taskId: { not: null } },
      select: { taskId: true },
    });
    return tx.task.findMany({
      where: { id: { in: occ.map((o) => o.taskId!) } },
      orderBy: { dueOn: 'asc' },
      include: { taskChecklistItems: true, taskReminders: true, assignees: true },
    });
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
          name: `Fake R55r ${key}`,
        },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r55r-${key}-${run}`;
      firms[key] = (
        await tx.business.create({
          data: { slug, name: slug, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
  });
  for (const [firm, userId, role, status] of [
    ['a', people.ownerA.id, 'OWNER', 'ACTIVE'],
    ['a', people.adminA.id, 'ADMIN', 'ACTIVE'],
    ['a', people.staffA.id, 'STAFF', 'ACTIVE'],
    ['a', people.staffA2.id, 'STAFF', 'ACTIVE'],
    ['a', people.formerA.id, 'ADMIN', 'ACTIVE'],
    ['b', people.ownerB.id, 'OWNER', 'ACTIVE'],
  ] as const) {
    await inFirm(firm, (tx) =>
      tx.membership.create({ data: { businessId: firms[firm], userId, role, status } }),
    );
  }
  await inFirm('a', async (tx) => {
    const businessId = firms.a;
    const service = await tx.service.create({
      data: { businessId, kind: 'BOOKKEEPING', name: 'Bookkeeping' },
      select: { id: true },
    });
    const client = async (name: string, assignedUserId: string | null = null) =>
      (
        await tx.client.create({
          data: { businessId, displayName: `Series Client ${name} (fake)`, assignedUserId },
          select: { id: true },
        })
      ).id;
    clients.c1 = await client('c1', people.staffA.id);
    clients.c2 = await client('c2', people.staffA2.id);
    clients.c3 = await client('c3');
    engagements.e1 = (
      await tx.engagement.create({
        data: { businessId, clientId: clients.c1, serviceId: service.id, title: 'c1 (fake)' },
        select: { id: true },
      })
    ).id;
    await tx.clientAccount.create({
      data: {
        businessId,
        userId: people.clientA.id,
        email: people.clientA.email,
        clientId: clients.c1,
        status: 'ACTIVE',
      },
    });
  });
  await inFirm('b', async (tx) => {
    clients.cB = (
      await tx.client.create({
        data: { businessId: firms.b, displayName: 'Other Firm Client (fake)' },
        select: { id: true },
      })
    ).id;
  });

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: process.env.TEST_LOG ?? 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env)],
  }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
  job = nest.get(TaskSeriesJob);
});

afterEach(async () => {
  for (const id of toStop.splice(0)) await call('post', `/task-series/${id}/stop`, people.ownerA);
});

afterAll(async () => {
  await app.close();
});

describe('task templates', () => {
  it('Owner and Admin make and change them; everyone with the view reads; names are unique', async () => {
    const type = TaskType.parse(
      ok(await call('post', '/task-types', people.ownerA, { name: mark('Tpl type') }), 201),
    );
    const t = await mkTemplate({
      description: 'Do the thing',
      typeId: type.id,
      priority: 'HIGH',
      assignmentRule: 'SPECIFIC_USER',
      assignedUserId: people.staffA.id,
      dueOffsetDays: 5,
      clientVisibleDefault: true,
      checklist: [{ label: 'One', required: true }, { label: 'Two' }],
      reminders: [{ daysBefore: 2 }],
      recurrence: { unit: 'MONTH', startOn: '2030-01-05' },
    });
    expect(t).toMatchObject({
      priority: 'HIGH',
      assignmentRule: 'SPECIFIC_USER',
      assignedTo: { userId: people.staffA.id },
      dueOffsetDays: 5,
      type: { id: type.id },
      clientVisibleDefault: true,
      archivedAt: null,
    });
    expect(t.checklist).toEqual([
      { label: 'One', required: true },
      { label: 'Two', required: false },
    ]);
    expect(t.reminders[0]).toMatchObject({ daysBefore: 2, inApp: true });
    expect(t.recurrence).toMatchObject({ unit: 'MONTH', startOn: '2030-01-05' });

    expectError(
      await call('post', '/task-templates', people.adminA, { name: t.name.toUpperCase() }),
      409,
      'DUPLICATE_NAME',
    );
    expectError(
      await call('post', '/task-templates', people.staffA, { name: 'X' }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('post', '/task-templates', people.clientA, { name: 'X' }),
      403,
      'FORBIDDEN',
    );
    const staff = template(await call('get', `/task-templates/${t.id}`, people.staffA));
    expect(staff.id).toBe(t.id);
    const listed = TaskTemplateList.parse(
      ok(await call('get', `/task-templates?search=${encodeURIComponent(t.name)}`, people.staffA)),
    );
    expect(listed.items.map((i) => i.id)).toEqual([t.id]);
  });

  it('refuses what cannot work', async () => {
    const bad = async (body: object, status = 400, code = 'VALIDATION_FAILED') =>
      expectError(
        await call('post', '/task-templates', people.ownerA, { name: mark('Bad'), ...body }),
        status,
        code,
      );
    await bad({ assignmentRule: 'SPECIFIC_USER' });
    await bad({ assignedUserId: people.staffA.id });
    await bad({ assignmentRule: 'CLIENT_TEAM', assignedUserId: people.staffA.id });
    await bad(
      { assignmentRule: 'SPECIFIC_USER', assignedUserId: people.ownerB.id },
      409,
      'NOT_A_MEMBER',
    );
    await bad({ typeId: randomUUID() });
    await bad({ serviceId: randomUUID() });
    await bad({ dueOffsetDays: 731 });
    await bad({ reminders: [{ daysBefore: 1 }, { daysBefore: 1 }] }, 400, 'INVALID_REMINDER');
    await bad({ checklist: Array.from({ length: 51 }, () => ({ label: 'x' })) });
    await bad({ name: '' });
    const archived = TaskType.parse(
      ok(await call('post', '/task-types', people.ownerA, { name: mark('Old type') }), 201),
    );
    await call('post', `/task-types/${archived.id}/archive`, people.ownerA);
    await bad({ typeId: archived.id }, 409, 'TYPE_ARCHIVED');
  });

  it('changes with a version, duplicates, archives and restores', async () => {
    const t = await mkTemplate({ checklist: [{ label: 'Step' }] });
    const changed = template(
      await call('patch', `/task-templates/${t.id}`, people.adminA, {
        version: t.version,
        priority: 'LOW',
        description: null,
        recurrence: null,
      }),
    );
    expect(changed).toMatchObject({ priority: 'LOW', description: null, recurrence: null });
    expect(changed.checklist).toEqual(t.checklist);
    expectError(
      await call('patch', `/task-templates/${t.id}`, people.ownerA, {
        version: t.version,
        priority: 'HIGH',
      }),
      409,
      'SAVE_CONFLICT',
    );
    expectError(
      await call('patch', `/task-templates/${t.id}`, people.staffA, {
        version: changed.version,
        priority: 'HIGH',
      }),
      403,
      'FORBIDDEN',
    );
    // Moving off "specific person" drops the person.
    const spec = await mkTemplate({
      assignmentRule: 'SPECIFIC_USER',
      assignedUserId: people.staffA.id,
    });
    const open = template(
      await call('patch', `/task-templates/${spec.id}`, people.ownerA, {
        version: spec.version,
        assignmentRule: 'UNASSIGNED',
      }),
    );
    expect(open).toMatchObject({ assignmentRule: 'UNASSIGNED', assignedTo: null });

    const copy = template(
      await call('post', `/task-templates/${t.id}/duplicate`, people.ownerA),
      201,
    );
    expect(copy.name).toBe(`${t.name} (Copy)`);
    expect(copy.id).not.toBe(t.id);
    const archived = template(await call('post', `/task-templates/${t.id}/archive`, people.ownerA));
    expect(archived.archivedAt).not.toBeNull();
    const active = TaskTemplateList.parse(
      ok(await call('get', `/task-templates?search=${encodeURIComponent(t.name)}`, people.ownerA)),
    );
    expect(active.items.map((i) => i.id)).toEqual([copy.id]);
    const gone = TaskTemplateList.parse(
      ok(
        await call(
          'get',
          `/task-templates?status=archived&search=${encodeURIComponent(t.name)}`,
          people.ownerA,
        ),
      ),
    );
    expect(gone.items.map((i) => i.id)).toEqual([t.id]);
    expect(
      template(await call('post', `/task-templates/${t.id}/restore`, people.ownerA)).archivedAt,
    ).toBeNull();
  });

  it('starts a task as a snapshot; the request wins; an archived template is refused', async () => {
    const t = await mkTemplate({
      description: 'From the template',
      priority: 'HIGH',
      assignmentRule: 'SPECIFIC_USER',
      assignedUserId: people.adminA.id,
      dueOffsetDays: 3,
      clientVisibleDefault: true,
      checklist: [{ label: 'A', required: true }, { label: 'B' }],
      reminders: [{ daysBefore: 1 }],
    });
    const made = TaskDetail.parse(
      ok(
        await call('post', '/tasks', people.ownerA, {
          clientId: clients.c1,
          title: 'Started from a template',
          templateId: t.id,
        }),
        201,
      ),
    );
    expect(made).toMatchObject({
      details: 'From the template',
      priority: 'HIGH',
      assignedUserId: people.adminA.id,
      clientVisible: true,
      templateId: t.id,
    });
    expect(made.dueOn).not.toBeNull();
    expect(made.checklistItems.map((i) => [i.label, i.required])).toEqual([
      ['A', true],
      ['B', false],
    ]);
    expect(made.reminders.map((r) => r.daysBefore)).toEqual([1]);

    // The request's own fields win over the template's.
    const own = TaskDetail.parse(
      ok(
        await call('post', '/tasks', people.ownerA, {
          clientId: clients.c1,
          title: 'Own fields',
          templateId: t.id,
          priority: 'LOW',
          dueOn: '2031-02-02',
          checklist: [{ label: 'Only mine' }],
          assignedUserId: people.staffA.id,
        }),
        201,
      ),
    );
    expect(own).toMatchObject({
      priority: 'LOW',
      dueOn: '2031-02-02',
      assignedUserId: people.staffA.id,
    });
    expect(own.checklistItems.map((i) => i.label)).toEqual(['Only mine']);

    // A later edit of the template never reaches the task.
    await call('patch', `/task-templates/${t.id}`, people.ownerA, {
      version: t.version,
      priority: 'LOW',
      checklist: [],
    });
    const after = TaskDetail.parse(ok(await call('get', `/tasks/${made.id}`, people.ownerA)));
    expect(after.priority).toBe('HIGH');
    expect(after.checklistItems).toHaveLength(2);

    await call('post', `/task-templates/${t.id}/archive`, people.ownerA);
    expectError(
      await call('post', '/tasks', people.ownerA, {
        clientId: clients.c1,
        title: 'x',
        templateId: t.id,
      }),
      400,
      'VALIDATION_FAILED',
    );
    // CLIENT_TEAM: the client's own assignee.
    const team = await mkTemplate({ assignmentRule: 'CLIENT_TEAM' });
    const teamTask = TaskDetail.parse(
      ok(
        await call('post', '/tasks', people.ownerA, {
          clientId: clients.c1,
          title: 'Client team',
          templateId: team.id,
        }),
        201,
      ),
    );
    expect(teamTask.assignedUserId).toBe(people.staffA.id);
  });

  it('saves a task as a template (Owner and Admin)', async () => {
    const t = TaskDetail.parse(
      ok(
        await call('post', '/tasks', people.ownerA, {
          clientId: clients.c1,
          title: 'Source task',
          details: 'Source details',
          priority: 'HIGH',
          dueOn: '2031-05-10',
          assignedUserId: people.staffA.id,
          checklist: [{ label: 'Step', required: true }],
          reminders: [{ daysBefore: 4 }],
          clientVisible: true,
        }),
        201,
      ),
    );
    const name = mark('Saved');
    const saved = template(
      await call('post', `/tasks/${t.id}/save-as-template`, people.adminA, { name }),
      201,
    );
    expect(saved).toMatchObject({
      name,
      description: 'Source details',
      priority: 'HIGH',
      assignmentRule: 'SPECIFIC_USER',
      assignedTo: { userId: people.staffA.id },
      clientVisibleDefault: true,
    });
    expect(saved.checklist).toEqual([{ label: 'Step', required: true }]);
    expect(saved.reminders[0]?.daysBefore).toBe(4);
    expectError(
      await call('post', `/tasks/${t.id}/save-as-template`, people.ownerA, { name }),
      409,
      'DUPLICATE_NAME',
    );
    expectError(
      await call('post', `/tasks/${t.id}/save-as-template`, people.staffA, { name: mark('x') }),
      403,
      'FORBIDDEN',
    );
  });
});

describe('recurring series: preview and create', () => {
  it('previews the next dates for unsaved settings', async () => {
    const preview = SeriesPreview.parse(
      ok(
        await call('post', '/task-series/preview', people.staffA, {
          recurrence: {
            unit: 'WEEK',
            startOn: '2099-11-02',
            pattern: { weekdays: [1, 3] },
            endMode: 'AFTER_COUNT',
            endAfterCount: 3,
          },
          count: 6,
        }),
      ),
    );
    expect(preview.dates.map((d) => d.scheduledOn)).toEqual([
      '2099-11-02',
      '2099-11-04',
      '2099-11-09',
    ]);
    expect(preview.endsAfter).toBe(3);
    const monthly = SeriesPreview.parse(
      ok(
        await call('post', '/task-series/preview', people.ownerA, {
          recurrence: { unit: 'MONTH', startOn: '2099-01-31', holidayRule: 'NONE' },
          count: 3,
        }),
      ),
    );
    expect(monthly.dates.map((d) => d.dueOn)).toEqual(['2099-01-31', '2099-02-28', '2099-03-31']);
    expect(monthly.endsAfter).toBeNull();
    const weekend = SeriesPreview.parse(
      ok(
        await call('post', '/task-series/preview', people.ownerA, {
          recurrence: { unit: 'DAY', startOn: '2099-11-06', holidayRule: 'NEXT_BUSINESS_DAY' },
          count: 2,
        }),
      ),
    );
    // 2099-11-07 is a Saturday: due the Monday, its key unchanged.
    expect(weekend.dates[1]).toEqual({ scheduledOn: '2099-11-07', dueOn: '2099-11-09' });

    for (const recurrence of [
      { unit: 'MONTH', startOn: '2099-01-01', pattern: { weekdays: [1] } },
      { unit: 'WEEK', startOn: '2099-01-01', pattern: { monthly: 'DAY_OF_MONTH' } },
      { unit: 'WEEK', startOn: '2099-01-01', pattern: { nth: 2 } },
    ]) {
      expectError(
        await call('post', '/task-series/preview', people.ownerA, { recurrence }),
        400,
        'INVALID_RECURRENCE',
      );
    }
    expectError(
      await call('post', '/task-series/preview', people.ownerA, {
        recurrence: { unit: 'DAY', startOn: '2099-01-01', endMode: 'AFTER_COUNT' },
      }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('makes a series, with the occurrences ahead, and tells who may', async () => {
    const type = TaskType.parse(
      ok(await call('post', '/task-types', people.ownerA, { name: mark('Series type') }), 201),
    );
    const s = await mkSeries({
      title: mark('Monthly close'),
      engagementId: engagements.e1,
      typeId: type.id,
      priority: 'HIGH',
      details: 'Close the books',
      assignmentRule: 'SPECIFIC_USER',
      assignedUserId: people.staffA.id,
      extraAssigneeIds: [people.adminA.id],
      leadDays: 5,
      dueTime: '17:00',
      clientVisible: true,
      checklist: [{ label: 'Reconcile', required: true }],
      reminders: [{ daysBefore: 2 }],
      recurrence: { unit: 'MONTH', startOn: '2099-03-31', holidayRule: 'NEXT_BUSINESS_DAY' },
    });
    expect(s).toMatchObject({
      status: 'ACTIVE',
      summary: 'Every month on day 31',
      priority: 'HIGH',
      assignmentRule: 'SPECIFIC_USER',
      assignedTo: { userId: people.staffA.id },
      type: { id: type.id },
      engagementId: engagements.e1,
      leadDays: 5,
      dueTime: '17:00',
      clientVisible: true,
      generatedCount: 0,
      client: { id: clients.c1 },
    });
    expect(s.extraAssignees.map((m) => m.userId)).toEqual([people.adminA.id]);
    expect(s.recurrence).toMatchObject({ unit: 'MONTH', startOn: '2099-03-31', endMode: 'NEVER' });
    expect(s.upcoming.map((d) => [d.scheduledOn, d.dueOn])).toEqual([
      ['2099-03-31', '2099-03-31'],
      ['2099-04-30', '2099-04-30'],
      ['2099-05-31', '2099-06-01'],
      ['2099-06-30', '2099-06-30'],
      ['2099-07-31', '2099-07-31'],
      ['2099-08-31', '2099-08-31'],
    ]);
    // Far-future series: nothing is within the horizon yet, and nothing is made.
    expect((await occurrences(s.id)).total).toBe(0);

    // Close by: scheduled ahead, then listed with the next date.
    const near = await mkSeries({ recurrence: { unit: 'DAY', startOn: '2030-01-01' } });
    expect(near.status).toBe('ACTIVE');
    await runJob('2030-01-03');
    const rows = await occurrences(near.id);
    expect(rows.total).toBeGreaterThan(100);
    const detail = series(await call('get', `/task-series/${near.id}`, people.staffA));
    expect(detail.nextDueOn).toBe('2030-01-04');
    expect(detail.upcoming).toHaveLength(6);

    const list = TaskSeriesPage.parse(
      ok(await call('get', `/task-series?search=${encodeURIComponent(s.title)}`, people.staffA)),
    );
    expect(list.items.map((i) => i.id)).toEqual([s.id]);

    expectError(
      await call('post', '/task-series', people.staffA, {
        clientId: clients.c1,
        title: 'x',
        recurrence: { unit: 'DAY', startOn: '2030-01-01' },
      }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('post', '/task-series', people.clientA, {
        clientId: clients.c1,
        title: 'x',
        recurrence: { unit: 'DAY', startOn: '2030-01-01' },
      }),
      403,
      'FORBIDDEN',
    );
    expect((await call('get', '/task-series', undefined)).status).toBe(401);
  });

  it('refuses what cannot work', async () => {
    const bad = async (body: object, status = 400, code = 'VALIDATION_FAILED') =>
      expectError(
        await call('post', '/task-series', people.ownerA, {
          clientId: clients.c1,
          title: 'Bad',
          recurrence: { unit: 'DAY', startOn: '2030-01-01' },
          ...body,
        }),
        status,
        code,
      );
    await bad({ assignmentRule: 'SPECIFIC_USER' });
    await bad({ assignedUserId: people.staffA.id, assignmentRule: 'CLIENT_TEAM' });
    await bad(
      { assignmentRule: 'SPECIFIC_USER', assignedUserId: people.ownerB.id },
      409,
      'NOT_A_MEMBER',
    );
    await bad({ extraAssigneeIds: [people.ownerB.id] }, 409, 'NOT_A_MEMBER');
    await bad({ notifyClient: true });
    await bad({ engagementId: randomUUID() });
    await bad({ typeId: randomUUID() });
    await bad({ clientId: randomUUID() }, 404, 'NOT_FOUND');
    await bad({ templateId: randomUUID() });
    await bad(
      { recurrence: { unit: 'MONTH', startOn: '2030-01-01', pattern: { weekdays: [1] } } },
      400,
      'INVALID_RECURRENCE',
    );
    await bad({ reminders: [{ daysBefore: 1 }, { daysBefore: 1 }] }, 400, 'INVALID_REMINDER');
    await bad({ businessId: firms.b });
    await bad({ recurrence: { unit: 'DAY', startOn: '0000-01-01' } });
  });
});

describe('the generation job', () => {
  it('makes one task per due occurrence, a snapshot, and never twice', async () => {
    const s = await mkSeries({
      title: mark('Daily'),
      details: 'Snapshot details',
      priority: 'HIGH',
      assignmentRule: 'SPECIFIC_USER',
      assignedUserId: people.staffA.id,
      extraAssigneeIds: [people.adminA.id, people.formerA.id],
      checklist: [{ label: 'Step', required: true }],
      reminders: [{ daysBefore: 0 }],
      clientVisible: true,
      recurrence: { unit: 'DAY', startOn: '2030-02-01' },
    });
    const first = await runJob('2030-02-03');
    expect(first).toMatchObject({ skipped: false });
    let tasks = await tasksOf(s.id);
    // Daily series are made on their day: Feb 1, 2 and 3 have come (the start is in the past).
    expect(tasks.map((t) => t.dueOn?.toISOString().slice(0, 10))).toEqual(['2030-02-03']);
    expect(tasks[0]).toMatchObject({
      title: s.title,
      details: 'Snapshot details',
      priority: 'HIGH',
      assignedUserId: people.staffA.id,
      clientVisible: true,
      clientId: clients.c1,
      status: 'OPEN',
      allDay: true,
    });
    expect(tasks[0]?.taskChecklistItems.map((i) => [i.label, i.required])).toEqual([
      ['Step', true],
    ]);
    expect(tasks[0]?.taskReminders.map((r) => r.daysBefore)).toEqual([0]);
    expect(tasks[0]?.assignees.map((a) => a.userId).sort()).toEqual(
      [people.adminA.id, people.formerA.id].sort(),
    );

    // The same run again, and a run at once from two places, make nothing new.
    await runJob('2030-02-03');
    await Promise.all([runJob('2030-02-03'), runJob('2030-02-03')]);
    expect(await tasksOf(s.id)).toHaveLength(1);

    // Two days on: the two newer occurrences, each once.
    await runJob('2030-02-05');
    tasks = await tasksOf(s.id);
    expect(tasks.map((t) => t.dueOn?.toISOString().slice(0, 10))).toEqual([
      '2030-02-03',
      '2030-02-04',
      '2030-02-05',
    ]);
    const generated = await occurrences(s.id, '&state=GENERATED');
    expect(generated.items.map((o) => o.taskId).sort()).toEqual(tasks.map((t) => t.id).sort());
    expect(series(await call('get', `/task-series/${s.id}`, people.ownerA)).generatedCount).toBe(3);

    // The task is a normal task: it shows as recurring, with its series.
    const detail = TaskDetail.parse(ok(await call('get', `/tasks/${tasks[0]!.id}`, people.ownerA)));
    expect(detail).toMatchObject({ recurring: true, series: { id: s.id, title: s.title } });
    const audit = await inFirm('a', (tx) =>
      tx.auditLog.findMany({
        where: { entityId: s.id, action: 'task_series.occurrence_generated' },
      }),
    );
    expect(audit).toHaveLength(3);
    expect(audit[0]?.actorUserId).toBeNull();
    expect(JSON.stringify(audit.map((a) => a.metadata))).not.toContain('Snapshot details');
  });

  it('is the same however the occurrence is reached: two at once make one task', async () => {
    const s = await mkSeries({ recurrence: { unit: 'DAY', startOn: '2030-03-01' } });
    await runJob('2030-03-01');
    const [one] = (await occurrences(s.id, '&state=GENERATED')).items;
    // An occurrence made already is left alone, however it is called.
    const again = await Promise.all([
      job.generate(firms.a, one!.id, '2030-03-01'),
      job.generate(firms.a, one!.id, '2030-03-01'),
    ]);
    expect(again).toEqual(['IGNORED', 'IGNORED']);
    // One still waiting is made by exactly one of two callers.
    const [next] = (await occurrences(s.id, '&state=SCHEDULED')).items.slice(-1);
    const race = await Promise.all([
      job.generate(firms.a, next!.id, '2030-03-01'),
      job.generate(firms.a, next!.id, '2030-03-01'),
    ]);
    expect(race.filter((r) => r === 'GENERATED')).toHaveLength(1);
    expect(await tasksOf(s.id)).toHaveLength(2);
  });

  it('follows the lead time and the start of the period', async () => {
    const lead = await mkSeries({
      leadDays: 3,
      recurrence: { unit: 'MONTH', startOn: '2030-06-20' },
    });
    await runJob('2030-06-16');
    expect(await tasksOf(lead.id)).toHaveLength(0);
    await runJob('2030-06-17');
    expect((await tasksOf(lead.id)).map((t) => t.dueOn?.toISOString().slice(0, 10))).toEqual([
      '2030-06-20',
    ]);

    const period = await mkSeries({
      createAtPeriodStart: true,
      recurrence: { unit: 'MONTH', startOn: '2030-09-20' },
    });
    await runJob('2030-08-31');
    expect(await tasksOf(period.id)).toHaveLength(0);
    await runJob('2030-09-01');
    expect((await tasksOf(period.id)).map((t) => t.dueOn?.toISOString().slice(0, 10))).toEqual([
      '2030-09-20',
    ]);
  });

  it('puts a task nobody can take unassigned, and skips an archived client', async () => {
    // The person left: the task is made, unassigned.
    await inFirm('a', (tx) =>
      tx.membership.updateMany({
        where: { businessId: firms.a, userId: people.formerA.id },
        data: { status: 'DEACTIVATED' },
      }),
    );
    const left = await mkSeries({
      assignmentRule: 'SPECIFIC_USER',
      assignedUserId: people.adminA.id,
      recurrence: { unit: 'DAY', startOn: '2030-04-01' },
    });
    await inFirm('a', (tx) =>
      tx.membership.updateMany({
        where: { businessId: firms.a, userId: people.adminA.id },
        data: { status: 'DEACTIVATED' },
      }),
    );
    await runJob('2030-04-01');
    const [t] = await tasksOf(left.id);
    expect(t?.assignedUserId).toBeNull();
    await inFirm('a', (tx) =>
      tx.membership.updateMany({
        where: { businessId: firms.a, userId: people.adminA.id },
        data: { status: 'ACTIVE' },
      }),
    );

    // A Staff person without the client cannot take its tasks either.
    const wrong = await mkSeries({
      clientId: clients.c3,
      assignmentRule: 'SPECIFIC_USER',
      assignedUserId: people.staffA.id,
      recurrence: { unit: 'DAY', startOn: '2030-04-02' },
    });
    await runJob('2030-04-02');
    expect((await tasksOf(wrong.id))[0]?.assignedUserId).toBeNull();
    // CLIENT_TEAM goes to the client's own assignee.
    const team = await mkSeries({
      assignmentRule: 'CLIENT_TEAM',
      recurrence: { unit: 'DAY', startOn: '2030-04-03' },
    });
    await runJob('2030-04-03');
    expect((await tasksOf(team.id))[0]?.assignedUserId).toBe(people.staffA.id);

    // An archived client is skipped, with the reason on the occurrence.
    const c = await inFirm('a', (tx) =>
      tx.client.create({
        data: { businessId: firms.a, displayName: 'Archived series client (fake)' },
        select: { id: true },
      }),
    );
    const archived = await mkSeries({
      clientId: c.id,
      recurrence: { unit: 'DAY', startOn: '2030-05-01' },
    });
    await inFirm('a', (tx) =>
      tx.client.update({ where: { id: c.id }, data: { archivedAt: new Date() } }),
    );
    await runJob('2030-05-01');
    expect(await tasksOf(archived.id)).toHaveLength(0);
    const skipped = await occurrences(archived.id, '&state=SKIPPED');
    expect(skipped.items[0]?.skipReason).toMatch(/archived/i);
  });

  it('ends a series whose rule has no dates left', async () => {
    const s = await mkSeries({
      recurrence: { unit: 'DAY', startOn: '2030-07-01', endMode: 'AFTER_COUNT', endAfterCount: 2 },
    });
    await runJob('2030-07-01');
    expect((await tasksOf(s.id)).length).toBe(1);
    expect(series(await call('get', `/task-series/${s.id}`, people.ownerA)).status).toBe('ACTIVE');
    await runJob('2030-07-03');
    expect((await tasksOf(s.id)).length).toBe(2);
    const done = series(await call('get', `/task-series/${s.id}`, people.ownerA));
    expect(done.status).toBe('ENDED');
    expect(done.endedAt).not.toBeNull();
    expect((await occurrences(s.id)).total).toBe(2);
  });
});

describe('editing and controlling a series', () => {
  it('FUTURE changes the definition, not the tasks made; ENTIRE also the open ones', async () => {
    const s = await mkSeries({
      title: mark('Edit me'),
      priority: 'LOW',
      recurrence: { unit: 'DAY', startOn: '2030-08-01' },
    });
    await runJob('2030-08-02');
    await runJob('2030-08-03');
    const made = await tasksOf(s.id);
    const done = made[0]!;
    const open = made[1]!;
    await call('post', `/tasks/${done.id}/complete`, people.ownerA);

    const renamed = mark('Renamed');
    const future = series(
      await call('patch', `/task-series/${s.id}`, people.ownerA, {
        scope: 'FUTURE',
        version: s.version,
        title: renamed,
        priority: 'HIGH',
      }),
    );
    expect(future).toMatchObject({ title: renamed, priority: 'HIGH' });
    const unchanged = await tasksOf(s.id);
    expect(unchanged.map((t) => t.title)).toEqual([s.title, s.title]);
    await runJob('2030-08-04');
    expect((await tasksOf(s.id)).map((t) => t.title)).toEqual([s.title, s.title, renamed]);

    expectError(
      await call('patch', `/task-series/${s.id}`, people.adminA, {
        scope: 'FUTURE',
        version: s.version,
        title: 'Stale',
      }),
      409,
      'SAVE_CONFLICT',
    );

    const again = mark('Everywhere');
    series(
      await call('patch', `/task-series/${s.id}`, people.ownerA, {
        scope: 'ENTIRE',
        version: future.version,
        title: again,
        priority: 'MEDIUM',
      }),
    );
    const byId = new Map((await tasksOf(s.id)).map((t) => [t.id, t]));
    // The completed one is history; the open ones follow.
    expect(byId.get(done.id)).toMatchObject({ title: s.title, priority: 'LOW', status: 'DONE' });
    expect(byId.get(open.id)).toMatchObject({ title: again, priority: 'MEDIUM', status: 'OPEN' });
    expectError(
      await call('patch', `/task-series/${s.id}`, people.staffA, {
        scope: 'FUTURE',
        version: 'x',
        title: 'No',
      }),
      403,
      'FORBIDDEN',
    );
  });

  it('a new recurrence replaces the occurrences not made, and keeps the made ones', async () => {
    const s = await mkSeries({ recurrence: { unit: 'DAY', startOn: '2030-09-01' } });
    await runJob('2030-09-02');
    const before = await occurrences(s.id, '&state=GENERATED');
    expect(before.total).toBe(1);
    const weekly = series(
      await call('patch', `/task-series/${s.id}`, people.ownerA, {
        scope: 'FUTURE',
        version: s.version,
        recurrence: { unit: 'WEEK', interval: 2 },
      }),
    );
    expect(weekly.summary).toBe('Every 2 weeks');
    expect(weekly.recurrence).toMatchObject({ unit: 'WEEK', interval: 2, startOn: '2030-09-01' });
    await runJob('2030-09-02');
    const scheduled = await occurrences(s.id, '&state=SCHEDULED');
    // Every other week from the start, none before today, a week of dates apart.
    const dates = scheduled.items.map((o) => o.scheduledOn).sort();
    expect(dates.length).toBeGreaterThan(5);
    for (let i = 1; i < dates.length; i++) {
      expect((Date.parse(dates[i]!) - Date.parse(dates[i - 1]!)) / 86_400_000).toBe(14);
    }
    expect((await occurrences(s.id, '&state=GENERATED')).total).toBe(1);
    expectError(
      await call('patch', `/task-series/${s.id}`, people.ownerA, {
        scope: 'FUTURE',
        version: weekly.version,
        recurrence: { pattern: { monthly: 'DAY_OF_MONTH' } },
      }),
      400,
      'INVALID_RECURRENCE',
    );
    expectError(
      await call('patch', `/task-series/${s.id}`, people.ownerA, {
        scope: 'FUTURE',
        version: weekly.version,
        recurrence: { endMode: 'ON_DATE' },
      }),
      400,
      'INVALID_RECURRENCE',
    );
  });

  it('pauses, resumes without a flood, skips, and stops', async () => {
    const s = await mkSeries({ recurrence: { unit: 'DAY', startOn: '2030-10-01' } });
    await runJob('2030-10-01');
    expect(await tasksOf(s.id)).toHaveLength(1);

    const paused = series(await call('post', `/task-series/${s.id}/pause`, people.ownerA));
    expect(paused).toMatchObject({ status: 'PAUSED' });
    expect(paused.pausedAt).not.toBeNull();
    expect(paused.upcoming).toEqual([]);
    expectError(
      await call('post', `/task-series/${s.id}/pause`, people.ownerA),
      409,
      'SERIES_NOT_ACTIVE',
    );
    await runJob('2030-10-05');
    expect(await tasksOf(s.id)).toHaveLength(1);

    // Occurrences that came due while it was paused (rows dated before today).
    await inFirm('a', (tx) =>
      tx.taskOccurrence.createMany({
        data: ['2026-10-01', '2026-10-02', '2026-10-03'].map((d) => ({
          businessId: firms.a,
          seriesId: s.id,
          scheduledOn: new Date(`${d}T00:00:00Z`),
          dueOn: new Date(`${d}T00:00:00Z`),
        })),
      }),
    );
    const resumed = series(await call('post', `/task-series/${s.id}/resume`, people.ownerA));
    expect(resumed.status).toBe('ACTIVE');
    expectError(
      await call('post', `/task-series/${s.id}/resume`, people.ownerA),
      409,
      'SERIES_NOT_ACTIVE',
    );
    // What came due while paused is skipped, not made all at once.
    const missed = await inFirm('a', (tx) =>
      tx.taskOccurrence.findMany({
        where: { seriesId: s.id, state: 'SKIPPED', skipReason: 'Missed while paused' },
        orderBy: { scheduledOn: 'asc' },
      }),
    );
    expect(missed.map((o) => o.scheduledOn.toISOString().slice(0, 10))).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ]);
    await runJob('2030-10-05');
    // The occurrences already scheduled in the window are made as they come due; the three that
    // came due before today were skipped.
    const dates = (await tasksOf(s.id)).map((t) => t.dueOn?.toISOString().slice(0, 10));
    expect(dates).toContain('2030-10-05');
    expect(dates.every((d) => d! >= '2030-10-01')).toBe(true);

    // Skip one occurrence; it is not made, and cannot be skipped twice.
    const [next] = (await occurrences(s.id, '&state=SCHEDULED')).items.slice(-1);
    const skipped = TaskOccurrence.parse(
      ok(
        await call('post', `/task-series/${s.id}/occurrences/${next!.id}/skip`, people.ownerA, {
          reason: 'Client on holiday',
        }),
      ),
    );
    expect(skipped).toMatchObject({ state: 'SKIPPED', skipReason: 'Client on holiday' });
    expectError(
      await call('post', `/task-series/${s.id}/occurrences/${next!.id}/skip`, people.ownerA, {}),
      409,
      'OCCURRENCE_CLOSED',
    );
    const made = (await occurrences(s.id, '&state=GENERATED')).items[0]!;
    expectError(
      await call('post', `/task-series/${s.id}/occurrences/${made.id}/skip`, people.ownerA, {}),
      409,
      'OCCURRENCE_CLOSED',
    );

    // "Delete future occurrences" needs confirming, keeps what was made, and the series stays active.
    expectError(
      await call('post', `/task-series/${s.id}/skip-future`, people.ownerA, {}),
      400,
      'VALIDATION_FAILED',
    );
    series(
      await call('post', `/task-series/${s.id}/skip-future`, people.ownerA, { confirm: true }),
    );
    expect((await occurrences(s.id, '&state=SCHEDULED')).total).toBe(0);
    expect(await tasksOf(s.id)).toHaveLength(2);

    const stopped = series(await call('post', `/task-series/${s.id}/stop`, people.ownerA));
    expect(stopped.status).toBe('ENDED');
    expect(series(await call('post', `/task-series/${s.id}/stop`, people.ownerA)).status).toBe(
      'ENDED',
    );
    expect(
      (
        await call('patch', `/task-series/${s.id}`, people.ownerA, {
          scope: 'FUTURE',
          version: stopped.version,
          title: 'No',
        })
      ).status,
    ).toBe(409);
    await runJob('2030-10-20');
    expect(await tasksOf(s.id)).toHaveLength(2);
    const audit = await inFirm('a', (tx) =>
      tx.auditLog.findMany({ where: { entityId: s.id }, orderBy: { createdAt: 'asc' } }),
    );
    for (const action of [
      'task_series.created',
      'task_series.paused',
      'task_series.resumed',
      'task_series.occurrence_skipped',
      'task_series.future_skipped',
      'task_series.stopped',
    ]) {
      expect(audit.map((a) => a.action)).toContain(action);
    }
  });

  it('turns a task into the first occurrence of a series', async () => {
    const t = TaskDetail.parse(
      ok(
        await call('post', '/tasks', people.ownerA, {
          clientId: clients.c1,
          title: 'One-off, now monthly',
          dueOn: '2031-01-15',
          priority: 'HIGH',
          checklist: [{ label: 'Step' }],
          reminders: [{ daysBefore: 1 }],
          assignedUserId: people.staffA.id,
        }),
        201,
      ),
    );
    const s = series(
      await call('post', `/tasks/${t.id}/convert-to-recurring`, people.ownerA, {
        recurrence: { unit: 'MONTH' },
      }),
      201,
    );
    expect(s).toMatchObject({
      title: 'One-off, now monthly',
      priority: 'HIGH',
      generatedCount: 1,
      assignmentRule: 'SPECIFIC_USER',
      assignedTo: { userId: people.staffA.id },
      summary: 'Every month on day 15',
    });
    expect(s.recurrence.startOn).toBe('2031-01-15');
    expect(s.checklist).toEqual([{ label: 'Step', required: false }]);
    const linked = TaskDetail.parse(ok(await call('get', `/tasks/${t.id}`, people.ownerA)));
    expect(linked).toMatchObject({ recurring: true, series: { id: s.id } });

    expectError(
      await call('post', `/tasks/${t.id}/convert-to-recurring`, people.ownerA, {
        recurrence: { unit: 'MONTH' },
      }),
      400,
      'VALIDATION_FAILED',
    );
    const undated = TaskDetail.parse(
      ok(
        await call('post', '/tasks', people.ownerA, { clientId: clients.c1, title: 'No date' }),
        201,
      ),
    );
    expectError(
      await call('post', `/tasks/${undated.id}/convert-to-recurring`, people.ownerA, {
        recurrence: { unit: 'MONTH' },
      }),
      400,
      'INVALID_RECURRENCE',
    );
    expectError(
      await call('post', `/tasks/${undated.id}/convert-to-recurring`, people.staffA, {
        recurrence: { unit: 'MONTH' },
      }),
      403,
      'FORBIDDEN',
    );
  });
});

describe('who reaches which series', () => {
  it('Staff read only their assigned clients’ series', async () => {
    const mine = await mkSeries({ clientId: clients.c1, title: mark('Staff mine') });
    const theirs = await mkSeries({ clientId: clients.c2, title: mark('Staff theirs') });
    expect(series(await call('get', `/task-series/${mine.id}`, people.staffA)).id).toBe(mine.id);
    expectError(await call('get', `/task-series/${theirs.id}`, people.staffA), 404, 'NOT_FOUND');
    expectError(
      await call('get', `/task-series/${theirs.id}/occurrences`, people.staffA),
      404,
      'NOT_FOUND',
    );
    const seen = TaskSeriesPage.parse(
      ok(await call('get', '/task-series?search=Staff&pageSize=100', people.staffA)),
    );
    expect(seen.items.map((i) => i.id)).toContain(mine.id);
    expect(seen.items.map((i) => i.id)).not.toContain(theirs.id);
    expectError(await call('get', '/task-series', people.clientA), 403, 'FORBIDDEN');
  });
});

describe('firm B against firm A', () => {
  it('never reads or changes firm A’s templates and series', async () => {
    const t = await mkTemplate();
    const s = await mkSeries();
    const [occ] = (await occurrences(s.id)).items;
    const asB = (method: Method, path: string, body?: object) =>
      call(method, path, people.ownerB, body, 'b');
    for (const [method, path, body] of [
      ['get', `/task-templates/${t.id}`],
      ['patch', `/task-templates/${t.id}`, { version: t.version, priority: 'LOW' }],
      ['post', `/task-templates/${t.id}/duplicate`],
      ['post', `/task-templates/${t.id}/archive`],
      ['post', `/task-templates/${t.id}/restore`],
      ['get', `/task-series/${s.id}`],
      ['get', `/task-series/${s.id}/occurrences`],
      ['patch', `/task-series/${s.id}`, { scope: 'FUTURE', version: s.version, title: 'Taken' }],
      ['post', `/task-series/${s.id}/pause`],
      ['post', `/task-series/${s.id}/resume`],
      ['post', `/task-series/${s.id}/stop`],
      ['post', `/task-series/${s.id}/skip-future`, { confirm: true }],
      ['post', `/task-series/${s.id}/occurrences/${occ?.id ?? randomUUID()}/skip`, {}],
    ] as const) {
      const res = await asB(method, path, body);
      expect([res.status, codeOf(res), method, path].join(' ')).toBe(
        [404, 'NOT_FOUND', method, path].join(' '),
      );
    }
    // Firm A's client, template and ids in firm B's bodies are refused.
    expectError(
      await asB('post', '/task-series', {
        clientId: clients.c1,
        title: 'Into A',
        recurrence: { unit: 'DAY', startOn: '2030-01-01' },
      }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await asB('post', '/task-series', {
        clientId: clients.cB,
        title: 'x',
        templateId: t.id,
        recurrence: { unit: 'DAY', startOn: '2030-01-01' },
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await asB('post', '/tasks', { clientId: clients.cB, title: 'x', templateId: t.id }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await asB('post', `/tasks/${randomUUID()}/convert-to-recurring`, {
        recurrence: { unit: 'DAY' },
      }),
      404,
      'NOT_FOUND',
    );
    const lists = [
      TaskTemplateList.parse(ok(await asB('get', '/task-templates?status=all'))).items.map(
        (i) => i.id,
      ),
      TaskSeriesPage.parse(ok(await asB('get', '/task-series?pageSize=100'))).items.map(
        (i) => i.id,
      ),
    ];
    expect(lists[0]).not.toContain(t.id);
    expect(lists[1]).not.toContain(s.id);

    // The job runs per firm: asked for firm B it makes nothing of firm A's.
    const before = (await occurrences(s.id)).total;
    await job.run({ now: new Date('2030-12-01T16:00:00Z'), businessIds: [firms.b] });
    expect((await occurrences(s.id)).total).toBe(before);
    expect(await tasksOf(s.id)).toHaveLength(0);
  });
});
