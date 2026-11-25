// End-to-end: Q36, Tasks Review Two T-C01 (assignment acknowledgment) and T-C02 (the task's
// internal discussion), on the client's decisions (DECISIONS.md, Nov 16). Acknowledgment is
// required only when someone of the same role assigns the task (a higher role, or yourself, needs
// none), for the primary and each additional assignee; it is due one business day later, and the
// reminder job sends one bell item to the assignee and the assigner. Comments: staff who reach the
// task; the author edits for 15 minutes and deletes their own; assignees and mentioned staff get a
// bell item; never the client, never another firm. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  PendingTaskAcknowledgements,
  TaskAcknowledgements,
  TaskComment,
  TaskComments,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE } from '../../src/notify/notify.types.js';
import { TaskAckReminderJob } from '../../src/tasks/task-ack-reminder.job.js';
import { oneBusinessDayAfter, roleRank } from '../../src/tasks/task-collab.service.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `q36-${key}-${run}@q36.test` });
const people = {
  owner: person('owner'),
  admin1: person('admin1'),
  admin2: person('admin2'),
  staff1: person('staff1'),
  staff2: person('staff2'),
  outsider: person('outsider'),
  ownerB: person('owner-b'),
};
type Who = { id: string; email: string };
const firms = { a: '', b: '' };
const clients = { mine: '', staff1: '' };

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.71.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

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

async function call(
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  who: Who,
  body?: object,
  firm: 'a' | 'b' = 'a',
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', firms[firm])
    .set('x-forwarded-for', viewer())
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};

/** A task on the Owner's client, made by `who` with these assignees. */
async function task(who: Who, assignedUserId: string | null, additional: string[] = []) {
  const res = await call('post', '/tasks', who, {
    clientId: clients.mine,
    title: `Fake Q36 task ${randomUUID().slice(0, 6)}`,
    ...(assignedUserId ? { assignedUserId } : {}),
    ...(additional.length ? { additionalAssigneeIds: additional } : {}),
  });
  return (ok(res, 201) as { id: string }).id;
}
const acks = async (id: string, who: Who = people.owner) =>
  TaskAcknowledgements.parse(ok(await call('get', `/tasks/${id}/acknowledgements`, who)));
const bells = (taskId: string, type: string) =>
  inFirm('a', (tx) =>
    tx.notification.findMany({
      where: { entityId: taskId, entityType: 'task', type },
      select: { recipientUserId: true },
    }),
  );

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: 'STAFF',
          email: p.email,
          name: `Fake Q36 ${key}`,
        },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `q36-${key}-${run}`;
      firms[key] = (
        await tx.business.create({
          data: { slug, name: slug, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
  });
  const members = [
    ['a', people.owner.id, 'OWNER'],
    ['a', people.admin1.id, 'ADMIN'],
    ['a', people.admin2.id, 'ADMIN'],
    ['a', people.staff1.id, 'STAFF'],
    ['a', people.staff2.id, 'STAFF'],
    ['b', people.ownerB.id, 'OWNER'],
  ] as const;
  for (const [firm, userId, role] of members) {
    await inFirm(firm, (tx) =>
      tx.membership.create({
        data: { businessId: firms[firm], userId, role, status: 'ACTIVE' },
      }),
    );
  }
  await inFirm('a', async (tx) => {
    clients.mine = (
      await tx.client.create({
        data: { businessId: firms.a, displayName: 'Q36 Client (fake)' },
        select: { id: true },
      })
    ).id;
    clients.staff1 = (
      await tx.client.create({
        data: {
          businessId: firms.a,
          displayName: 'Q36 Staff Client (fake)',
          assignedUserId: people.staff1.id,
        },
        select: { id: true },
      })
    ).id;
  });
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({ send: () => Promise.resolve() })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
}, 60_000);

afterAll(async () => {
  await app.close();
});

describe('T-C01 rules', () => {
  it('ranks Owner > Admin > Manager > every other role', () => {
    expect(roleRank('OWNER')).toBeGreaterThan(roleRank('ADMIN'));
    expect(roleRank('ADMIN')).toBeGreaterThan(roleRank('MANAGER'));
    expect(roleRank('MANAGER')).toBeGreaterThan(roleRank('STAFF'));
    expect(roleRank('BOOKKEEPER')).toBe(roleRank('STAFF'));
  });

  it('one business day skips the weekend in the firm time zone', () => {
    const friday = new Date('2026-11-27T15:00:00Z');
    expect(oneBusinessDayAfter(friday, 'UTC').toISOString()).toBe('2026-11-30T15:00:00.000Z');
    const tuesday = new Date('2026-11-24T15:00:00Z');
    expect(oneBusinessDayAfter(tuesday, 'UTC').toISOString()).toBe('2026-11-25T15:00:00.000Z');
  });
});

describe('T-C01 acknowledgment', () => {
  it('same role, someone else: required for the primary and each additional assignee', async () => {
    const id = await task(people.admin1, people.admin2.id, [people.staff2.id]);
    const view = await acks(id, people.admin2);
    const of = (userId: string) => view.items.find((i) => i.assignee.userId === userId)!;
    expect(of(people.admin2.id)).toMatchObject({ required: true, acknowledgedAt: null });
    // A Staff member assigned by an Admin (a higher role) needs none.
    expect(of(people.staff2.id)).toMatchObject({ required: false, dueAt: null });
    expect(view.mine).toBe('PENDING');
    const due = new Date(of(people.admin2.id).dueAt!).getTime();
    expect(due).toBeGreaterThan(Date.now() + 20 * 3_600_000);

    const pending = PendingTaskAcknowledgements.parse(
      ok(await call('get', '/tasks/acknowledgements/pending', people.admin2)),
    );
    expect(pending.items.map((p) => p.taskId)).toContain(id);

    // The assigner has nothing to acknowledge; the assignee acknowledges once.
    expectError(
      await call('post', `/tasks/${id}/acknowledge`, people.admin1),
      409,
      'NOTHING_TO_ACKNOWLEDGE',
    );
    const done = TaskAcknowledgements.parse(
      ok(await call('post', `/tasks/${id}/acknowledge`, people.admin2)),
    );
    expect(done.mine).toBe('DONE');
    expect(done.items.find((i) => i.assignee.userId === people.admin2.id)).toMatchObject({
      acknowledgedBy: { userId: people.admin2.id },
    });
    expectError(
      await call('post', `/tasks/${id}/acknowledge`, people.admin2),
      409,
      'NOTHING_TO_ACKNOWLEDGE',
    );
    expect(
      PendingTaskAcknowledgements.parse(
        ok(await call('get', '/tasks/acknowledgements/pending', people.admin2)),
      ).items.map((p) => p.taskId),
    ).not.toContain(id);

    // The assigner gets a bell item; the audit keeps both steps.
    expect((await bells(id, 'task.acknowledged')).map((b) => b.recipientUserId)).toEqual([
      people.admin1.id,
    ]);
    const audit = await inFirm('a', (tx) =>
      tx.auditLog.findMany({
        where: { entityId: id },
        select: { action: true, actorUserId: true },
      }),
    );
    expect(audit).toEqual(
      expect.arrayContaining([
        { action: 'task.acknowledgement.required', actorUserId: people.admin1.id },
        { action: 'task.acknowledged', actorUserId: people.admin2.id },
      ]),
    );
  });

  it('a higher role or yourself: no acknowledgment', async () => {
    const byOwner = await acks(await task(people.owner, people.admin2.id));
    expect(byOwner.items).toEqual([expect.objectContaining({ required: false })]);
    const self = await acks(await task(people.admin1, people.admin1.id), people.admin1);
    expect(self).toMatchObject({
      mine: 'NONE',
      items: [expect.objectContaining({ required: false })],
    });
  });

  it('reassigning gives the new assignee a row and removes the old one', async () => {
    const id = await task(people.admin1, people.admin2.id);
    ok(await call('patch', `/tasks/${id}`, people.admin1, { assignedUserId: people.owner.id }));
    const view = await acks(id);
    expect(view.items.map((i) => i.assignee.userId)).toEqual([people.owner.id]);
    expect(view.items[0]!.required).toBe(false);
  });

  it('one reminder to the assignee and the assigner after the business day', async () => {
    const id = await task(people.admin1, people.admin2.id);
    const job = app.get(TaskAckReminderJob);
    const later = new Date(Date.now() + 5 * 86_400_000);
    expect(await job.run({ now: new Date(), businessIds: [firms.a] })).toMatchObject({
      reminded: 0,
    });
    const first = await job.run({ now: later, businessIds: [firms.a] });
    expect(first.skipped).toBe(false);
    const recipients = (await bells(id, 'task.acknowledgement_reminder'))
      .map((b) => b.recipientUserId)
      .sort();
    expect(recipients).toEqual([people.admin1.id, people.admin2.id].sort());
    expect((await acks(id)).items[0]!.reminderSentAt).not.toBeNull();
    // Once, ever.
    await job.run({ now: new Date(later.getTime() + 86_400_000), businessIds: [firms.a] });
    expect(await bells(id, 'task.acknowledgement_reminder')).toHaveLength(2);
  });

  it('another firm and a Staff member outside the client get 404', async () => {
    const id = await task(people.admin1, people.admin2.id);
    expectError(
      await call('get', `/tasks/${id}/acknowledgements`, people.ownerB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('get', `/tasks/${id}/acknowledgements`, people.staff1),
      404,
      'NOT_FOUND',
    );
  });
});

describe('T-C02 discussion', () => {
  it('post, list, mention; assignees and mentioned staff get a bell item, never the author', async () => {
    const id = await task(people.admin1, people.admin2.id);
    const posted = TaskComment.parse(
      ok(
        await call('post', `/tasks/${id}/comments`, people.admin1, {
          body: '  Please check the totals.  ',
          mentionUserIds: [people.owner.id],
        }),
        201,
      ),
    );
    expect(posted).toMatchObject({
      body: 'Please check the totals.',
      author: { userId: people.admin1.id },
      canEdit: true,
      canDelete: true,
      edited: false,
    });
    const list = TaskComments.parse(ok(await call('get', `/tasks/${id}/comments`, people.admin2)));
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ canEdit: false, canDelete: false });
    expect((await bells(id, 'task.comment')).map((b) => b.recipientUserId).sort()).toEqual(
      [people.admin2.id, people.owner.id].sort(),
    );
    expectError(
      await call('post', `/tasks/${id}/comments`, people.admin1, {
        body: 'x',
        mentionUserIds: [people.outsider.id],
      }),
      422,
      'INVALID_MENTION',
    );
    expect(
      (await call('post', `/tasks/${id}/comments`, people.admin1, { body: '   ' })).status,
    ).toBe(400);
    expect(
      (
        await call('post', `/tasks/${id}/comments`, people.admin1, {
          body: 'x',
          clientVisible: true,
        })
      ).status,
    ).toBe(400);
  });

  it('the author edits within 15 minutes and deletes their own; others cannot', async () => {
    const id = await task(people.admin1, people.admin2.id);
    const c = TaskComment.parse(
      ok(await call('post', `/tasks/${id}/comments`, people.admin1, { body: 'First' }), 201),
    );
    const edited = TaskComment.parse(
      ok(
        await call('patch', `/tasks/${id}/comments/${c.id}`, people.admin1, {
          body: 'First, fixed',
        }),
      ),
    );
    expect(edited.body).toBe('First, fixed');
    expectError(
      await call('patch', `/tasks/${id}/comments/${c.id}`, people.admin2, { body: 'Not mine' }),
      403,
      'NOT_AUTHOR',
    );
    expectError(
      await call('delete', `/tasks/${id}/comments/${c.id}`, people.owner),
      403,
      'NOT_AUTHOR',
    );
    await inFirm('a', (tx) =>
      tx.taskComment.update({
        where: { id: c.id },
        data: { createdAt: new Date(Date.now() - 16 * 60_000) },
      }),
    );
    expectError(
      await call('patch', `/tasks/${id}/comments/${c.id}`, people.admin1, { body: 'Too late' }),
      409,
      'EDIT_WINDOW_CLOSED',
    );
    ok(await call('delete', `/tasks/${id}/comments/${c.id}`, people.admin1));
    expect(
      TaskComments.parse(ok(await call('get', `/tasks/${id}/comments`, people.admin1))).items,
    ).toEqual([]);
    const audit = await inFirm('a', (tx) =>
      tx.auditLog.findMany({
        where: { entityId: id, action: { startsWith: 'task.comment.' } },
        select: { action: true },
      }),
    );
    expect(audit.map((a) => a.action).sort()).toEqual(
      ['task.comment.created', 'task.comment.deleted', 'task.comment.updated'].sort(),
    );
    expectError(
      await call('delete', `/tasks/${id}/comments/${c.id}`, people.admin1),
      404,
      'NOT_FOUND',
    );
  });

  it('another firm and a Staff member outside the client get 404', async () => {
    const id = await task(people.admin1, null);
    expectError(
      await call('get', `/tasks/${id}/comments`, people.ownerB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', `/tasks/${id}/comments`, people.staff1, { body: 'Hi' }),
      404,
      'NOT_FOUND',
    );
  });
});
