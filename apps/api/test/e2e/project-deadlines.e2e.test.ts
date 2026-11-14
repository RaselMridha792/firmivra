// End-to-end: Tax Planning Review 2, approved addition "Project Deadlines" (contract in
// packages/types/src/tax-planning/project-deadlines.ts). A member's own deadline is PRIVATE by
// default: no one else sees it, Owner and Admin included (404). SHARED adds the coworkers it
// names, who read it and complete or reopen it; only the owner edits, shares or deletes it (403
// OWNER_ONLY). Staff name and see only clients assigned to them. Another firm gets 404. Audited
// with ids and counts only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import type { z } from 'zod';
import { OkResponse, ProjectDeadline, ProjectDeadlineList } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE } from '../../src/notify/notify.types.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const SECRET_NAME = `Fake secret deadline ${run}`;
const person = (key: string) => ({ id: randomUUID(), email: `r56pd-${key}-${run}@r56.test` });
const people = {
  ownerP: person('owner-p'),
  adminP: person('admin-p'),
  staffP: person('staff-p'),
  staff2P: person('staff2-p'),
  ownerQ: person('owner-q'),
};
const names = Object.fromEntries(Object.keys(people).map((k) => [k, `Fake R56pd ${k}`])) as Record<
  keyof typeof people,
  string
>;
const ids = { firmP: '', firmQ: '', serviceP: '', serviceQ: '', c1: '', c2: '', clientQ: '' };

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
/** A new viewer IP per call, so no test meets the per-IP rate limit. */
const viewer = () => {
  viewers += 1;
  return `198.19.${Math.floor(viewers / 250)}.${(viewers % 250) + 1}, 10.0.0.5`;
};

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

type Who = { email: string };
const BASE = '/business/tax-planning/project-deadlines';

async function call(
  method: 'get' | 'post' | 'put' | 'delete',
  path: string,
  who: Who,
  body?: object,
  businessId = ids.firmP,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1${BASE}${path}`)
    .set('x-business-id', businessId)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`)
    .set('x-forwarded-for', viewer());
  return body === undefined ? req : req.send(body);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const fieldOf = (res: Response) =>
  (res.body as { error?: { details?: { path: string }[] } }).error?.details?.[0]?.path;

/** Parses with the contract and refuses anything it does not name (a leaked field fails). */
function exact<S extends z.ZodType>(schema: S, res: Response, status = 200): z.output<S> {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  const parsed = schema.parse(res.body);
  expect(parsed).toEqual(res.body);
  return parsed;
}

async function asOwner<T>(
  businessId: string,
  work: Parameters<typeof runInScope<T>>[2],
): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, { kind: 'business', businessId }, work);
  } finally {
    await owner.$disconnect();
  }
}

const DUE = '2033-04-15T21:00:00.000Z';
const draft = (extra: object = {}) => ({
  name: `Fake planning review ${randomUUID().slice(0, 6)}`,
  dueAt: DUE,
  serviceId: ids.serviceP,
  ...extra,
});
const create = async (who: Who, extra: object = {}) =>
  exact(ProjectDeadline, await call('post', '', who, draft(extra)), 201);
const read = (id: string, who: Who) => call('get', `/${id}`, who);
const listOf = async (who: Who, query = '') =>
  exact(ProjectDeadlineList, await call('get', query, who)).items.map((d) => d.id);

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: 'STAFF',
          email: p.email,
          name: names[key as keyof typeof people],
        },
      });
    }
    for (const key of ['firmP', 'firmQ'] as const) {
      const slug = `r56pd-${key.toLowerCase()}-${run}`;
      ids[key] = (await tx.business.create({ data: { slug, name: slug, status: 'ACTIVE' } })).id;
    }
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmP }, async (tx) => {
    const P = { businessId: ids.firmP };
    for (const [userId, role] of [
      [people.ownerP.id, 'OWNER'],
      [people.adminP.id, 'ADMIN'],
      [people.staffP.id, 'STAFF'],
      [people.staff2P.id, 'STAFF'],
    ] as const) {
      await tx.membership.create({ data: { ...P, userId, role, status: 'ACTIVE' } });
    }
    ids.serviceP = (
      await tx.service.create({ data: { ...P, kind: 'TAX_PLANNING', name: `Planning ${run}` } })
    ).id;
    ids.c1 = (
      await tx.client.create({
        data: { ...P, displayName: 'Jamie Sample (fake)', assignedUserId: people.staffP.id },
      })
    ).id;
    ids.c2 = (await tx.client.create({ data: { ...P, displayName: 'Casey Nobody (fake)' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmQ }, async (tx) => {
    const Q = { businessId: ids.firmQ };
    await tx.membership.create({
      data: { ...Q, userId: people.ownerQ.id, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.serviceQ = (
      await tx.service.create({ data: { ...Q, kind: 'TAX_PLANNING', name: `Q planning ${run}` } })
    ).id;
    ids.clientQ = (await tx.client.create({ data: { ...Q, displayName: 'Q Client (fake)' } })).id;
  });
  await owner.$disconnect();

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
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
});

afterAll(async () => {
  await app.close();
});

describe('a private deadline', () => {
  it('is its owner’s alone: Owner and Admin get 404 too, and their lists leave it out', async () => {
    const d = await create(people.staffP, {
      name: SECRET_NAME,
      description: 'Fake: staff-only working notes',
      clientId: ids.c1,
      reminders: [
        { amount: 2, unit: 'HOURS' },
        { amount: 1, unit: 'DAYS', inApp: false, email: true },
      ],
    });
    expect(d).toMatchObject({
      name: SECRET_NAME,
      dueAt: DUE,
      service: { id: ids.serviceP, name: `Planning ${run}` },
      client: { id: ids.c1, name: 'Jamie Sample (fake)' },
      clientHidden: false,
      owner: { userId: people.staffP.id, name: names.staffP },
      visibility: 'PRIVATE',
      sharedWith: [],
      completedAt: null,
      completedBy: null,
      mine: true,
    });
    // Furthest first.
    expect(d.reminders).toEqual([
      { amount: 1, unit: 'DAYS', inApp: false, email: true, sentAt: null },
      { amount: 2, unit: 'HOURS', inApp: true, email: false, sentAt: null },
    ]);
    expect(exact(ProjectDeadline, await read(d.id, people.staffP)).id).toBe(d.id);
    for (const other of [people.ownerP, people.adminP, people.staff2P]) {
      expectError(await read(d.id, other), 404, 'NOT_FOUND');
      expect(await listOf(other, '?status=all')).not.toContain(d.id);
    }
    expect(await listOf(people.staffP)).toContain(d.id);
  });
});

describe('a shared deadline', () => {
  it('the coworkers it names read it and complete it; only the owner edits, shares or deletes', async () => {
    const d = await create(people.ownerP, {
      clientId: ids.c1,
      visibility: 'SHARED',
      sharedWithUserIds: [people.staffP.id, people.staff2P.id],
    });
    // By name.
    expect(d.sharedWith).toEqual([
      { userId: people.staff2P.id, name: names.staff2P },
      { userId: people.staffP.id, name: names.staffP },
    ]);
    // The assigned Staff member sees the client; the other one sees the deadline without it.
    const assigned = exact(ProjectDeadline, await read(d.id, people.staffP));
    expect([assigned.client?.id, assigned.clientHidden, assigned.mine]).toEqual([
      ids.c1,
      false,
      false,
    ]);
    const unassigned = exact(ProjectDeadline, await read(d.id, people.staff2P));
    expect([unassigned.client, unassigned.clientHidden]).toEqual([null, true]);
    expect(JSON.stringify(unassigned)).not.toContain('Jamie Sample');
    // The Admin is not named: 404.
    expectError(await read(d.id, people.adminP), 404, 'NOT_FOUND');

    expectError(await call('put', `/${d.id}`, people.staffP, draft()), 403, 'OWNER_ONLY');
    expectError(await call('delete', `/${d.id}`, people.staffP), 403, 'OWNER_ONLY');

    const done = exact(ProjectDeadline, await call('post', `/${d.id}/complete`, people.staffP));
    expect(done.completedBy).toEqual({ userId: people.staffP.id, name: names.staffP });
    expect(await listOf(people.ownerP, '?status=completed')).toContain(d.id);
    expect(await listOf(people.ownerP)).not.toContain(d.id);
    const open = exact(ProjectDeadline, await call('post', `/${d.id}/reopen`, people.staff2P));
    expect([open.completedAt, open.completedBy]).toEqual([null, null]);

    // The owner makes it private again: the coworkers lose it.
    const own = exact(
      ProjectDeadline,
      await call('put', `/${d.id}`, people.ownerP, draft({ visibility: 'PRIVATE' })),
    );
    expect([own.visibility, own.sharedWith]).toEqual(['PRIVATE', []]);
    expectError(await read(d.id, people.staffP), 404, 'NOT_FOUND');

    exact(OkResponse, await call('delete', `/${d.id}`, people.ownerP));
    expectError(await read(d.id, people.ownerP), 404, 'NOT_FOUND');
  });

  it('the lists split the caller’s own from the ones shared with them', async () => {
    const mine = await create(people.staff2P);
    const shared = await create(people.ownerP, {
      visibility: 'SHARED',
      sharedWithUserIds: [people.staff2P.id],
    });
    const own = await listOf(people.staff2P, '?scope=mine');
    expect(own).toContain(mine.id);
    expect(own).not.toContain(shared.id);
    const theirs = await listOf(people.staff2P, '?scope=shared');
    expect(theirs).toContain(shared.id);
    expect(theirs).not.toContain(mine.id);
  });
});

describe('what a deadline may name', () => {
  it('refuses a service or client of another firm, a client not assigned to Staff, and coworkers who are not active members', async () => {
    const refused = async (who: Who, extra: object, field: string) => {
      const res = await call('post', '', who, draft(extra));
      expectError(res, 400, 'VALIDATION_FAILED');
      expect(fieldOf(res)).toBe(field);
    };
    await refused(people.ownerP, { serviceId: ids.serviceQ }, 'serviceId');
    await refused(people.ownerP, { clientId: ids.clientQ }, 'clientId');
    await refused(people.staffP, { clientId: ids.c2 }, 'clientId');
    await refused(
      people.ownerP,
      { visibility: 'SHARED', sharedWithUserIds: [people.ownerQ.id] },
      'sharedWithUserIds',
    );
    await refused(
      people.ownerP,
      { visibility: 'SHARED', sharedWithUserIds: [people.ownerP.id] },
      'sharedWithUserIds',
    );
    await refused(people.ownerP, { visibility: 'SHARED' }, 'sharedWithUserIds');
    await refused(
      people.ownerP,
      { visibility: 'PRIVATE', sharedWithUserIds: [people.staffP.id] },
      'sharedWithUserIds',
    );
    await refused(
      people.ownerP,
      {
        reminders: [
          { amount: 1, unit: 'DAYS' },
          { amount: 24, unit: 'HOURS' },
        ],
      },
      'reminders',
    );
    await refused(
      people.ownerP,
      { reminders: [{ amount: 366, unit: 'DAYS' }] },
      'reminders.0.amount',
    );
    // The Owner names any client of the firm.
    expect((await create(people.ownerP, { clientId: ids.c2 })).client?.id).toBe(ids.c2);
  });
});

describe('edit and reminders', () => {
  it('a reminder already sent stays sent unless the due time moves', async () => {
    const d = await create(people.ownerP, { reminders: [{ amount: 1, unit: 'DAYS' }] });
    const sent = new Date('2033-04-14T21:00:00Z');
    await asOwner(ids.firmP, (tx) =>
      tx.projectDeadlineReminder.updateMany({
        where: { deadlineId: d.id },
        data: { sentAt: sent },
      }),
    );
    const same = exact(
      ProjectDeadline,
      await call(
        'put',
        `/${d.id}`,
        people.ownerP,
        draft({
          name: d.name,
          reminders: [
            { amount: 1, unit: 'DAYS' },
            { amount: 1, unit: 'HOURS' },
          ],
        }),
      ),
    );
    expect(same.reminders.map((r) => [r.unit, r.sentAt])).toEqual([
      ['DAYS', sent.toISOString()],
      ['HOURS', null],
    ]);
    const moved = exact(
      ProjectDeadline,
      await call(
        'put',
        `/${d.id}`,
        people.ownerP,
        draft({ dueAt: '2033-05-01T21:00:00.000Z', reminders: [{ amount: 1, unit: 'DAYS' }] }),
      ),
    );
    expect(moved.reminders.map((r) => r.sentAt)).toEqual([null]);
  });
});

describe('isolation and audit', () => {
  it('another firm gets 404 and changes nothing', async () => {
    const d = await create(people.ownerP);
    for (const [method, path, body] of [
      ['get', `/${d.id}`, undefined],
      ['put', `/${d.id}`, { ...draft(), serviceId: ids.serviceQ }],
      ['post', `/${d.id}/complete`, undefined],
      ['delete', `/${d.id}`, undefined],
    ] as const) {
      expectError(await call(method, path, people.ownerQ, body, ids.firmQ), 404, 'NOT_FOUND');
    }
    expect(await listOf(people.ownerP)).toContain(d.id);
    expect(exact(ProjectDeadline, await read(d.id, people.ownerP)).completedAt).toBeNull();
  });

  it('every change is audited with ids and counts, never the name or the description', async () => {
    const rows = await asOwner(ids.firmP, (tx) =>
      tx.auditLog.findMany({
        where: { businessId: ids.firmP, action: { startsWith: 'project_deadline' } },
        select: { action: true, metadata: true },
      }),
    );
    const actions = new Set(rows.map((r) => r.action));
    for (const action of [
      'project_deadline.created',
      'project_deadline.viewed',
      'project_deadline.updated',
      'project_deadline.completed',
      'project_deadline.reopened',
      'project_deadline.deleted',
      'project_deadlines.listed',
    ]) {
      expect(actions).toContain(action);
    }
    expect(JSON.stringify(rows)).not.toContain(SECRET_NAME);
    expect(JSON.stringify(rows)).not.toContain('staff-only working notes');
  });
});
