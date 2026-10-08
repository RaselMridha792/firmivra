// End-to-end: R12 step 6, the firm's tasks (contract in packages/types/src/tasks). Owner and Admin
// see and change every task. Staff follow Rasel's rule of Oct 8 (q5): they see, change and create
// a client's tasks only when that client is assigned to them (404 otherwise, also for a task
// assigned to them on another client), and a client's task goes to a Staff member only when that
// client is assigned to them (409 CLIENT_NOT_ASSIGNED). Clients never reach tasks (403); another
// firm gets 404 and changes nothing. Changes are audited with ids and field names, never text.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, type Database, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { z } from 'zod';
import { MemberRef, Task as TaskShape } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { DATABASE } from '../../src/database/database.module.js';
import { reassignClientTasks } from '../../src/workspaces/tasks.service.js';
import { loadEnv } from '../../src/config/env.js';

// Strict copies of the contract's shapes, so a leaked field (businessId, clientId) fails.
const Member = z.strictObject(MemberRef.shape).nullable();
const Task = z.strictObject({
  ...TaskShape.shape,
  client: z.strictObject(TaskShape.shape.client.shape),
  assignedTo: Member,
  createdBy: Member,
});
type Task = z.infer<typeof Task>;
const TaskList = z.strictObject({ items: z.array(Task), nextCursor: z.string().nullable() });

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r12t-${key}-${run}@r12.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  staffA2: person('staff-a2'),
  invitedA: person('invited-a'),
  formerA: person('former-a'),
  clientA: person('client-a'),
  ownerB: person('owner-b'),
};
type Person = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', { id: string; slug: string }>;
/** c1 is staffA's, c2 is staffA2's, c3 and c4 nobody's; cB is firm B's. */
const clients = {} as Record<'c1' | 'c2' | 'c3' | 'c4' | 'cB', string>;
/** e1 is c1's, e2 is c2's, eB is firm B's. */
const engagements = {} as Record<'e1' | 'e2' | 'eB', string>;

let app: INestApplication;
const tokens = new Map<string, string>();
let lastViewer = 0;
const newViewer = () => `198.51.${100 + Math.floor(++lastViewer / 250)}.${lastViewer % 250}`;

async function asOwner<T>(
  scope: Parameters<typeof runInScope>[1],
  work: Parameters<typeof runInScope<T>>[2],
): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  try {
    return await runInScope(owner, scope, work);
  } finally {
    await owner.$disconnect();
  }
}
const inA = <T>(work: Parameters<typeof runInScope<T>>[2]) =>
  asOwner({ kind: 'business', businessId: firms.a.id }, work);

async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`)
    .send({ email })
    .expect(200);
  const token = (res.body as { token: string }).token;
  tokens.set(email, token);
  return token;
}

/** A firm call (Bearer: no cookie, so no Origin needed). */
async function call(
  method: 'get' | 'post' | 'patch',
  path: string,
  who: Person,
  firm: 'a' | 'b' = 'a',
  body?: object,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business/tasks${path}`)
    .set('x-business-id', firms[firm].id)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`)
    .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`);
  return body === undefined ? req : req.send(body);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res;
};
const create = async (body: object, who: Person = people.ownerA, firm: 'a' | 'b' = 'a') =>
  Task.parse(ok(await call('post', '', who, firm, body), 201).body);
const update = async (id: string, body: object, who: Person = people.ownerA) =>
  Task.parse(ok(await call('patch', `/${id}`, who, 'a', body)).body);
const list = async (query: string, who: Person = people.ownerA, firm: 'a' | 'b' = 'a') =>
  TaskList.parse(ok(await call('get', query, who, firm)).body);
const ids = async (query: string, who: Person = people.ownerA) =>
  (await list(query, who)).items.map((t) => t.id);
const stored = (id: string) => inA((tx) => tx.task.findUniqueOrThrow({ where: { id } }));
/** A task written straight to the database (R10's name change, or history). */
const insertTask = (data: {
  clientId: string;
  title: string;
  kind?: 'GENERAL' | 'NAME_CHANGE';
  status?: 'OPEN' | 'DONE' | 'CANCELLED';
  assignedUserId?: string;
}) =>
  inA((tx) =>
    tx.task.create({
      data: {
        businessId: firms.a.id,
        ...data,
        ...(data.status === 'DONE' ? { completedAt: new Date() } : {}),
      },
      select: { id: true },
    }),
  ).then((t) => t.id);

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: key === 'clientA' ? 'CLIENT' : 'STAFF',
          email: p.email,
          name: `Fake R12t ${key}`,
        },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r12t-${key}-${run}`;
      firms[key] = await tx.business.create({
        data: { slug, name: slug, status: 'ACTIVE' },
        select: { id: true, slug: true },
      });
    }
  });
  const members = [
    [firms.a.id, people.ownerA.id, 'OWNER', 'ACTIVE'],
    [firms.a.id, people.adminA.id, 'ADMIN', 'ACTIVE'],
    [firms.a.id, people.staffA.id, 'STAFF', 'ACTIVE'],
    [firms.a.id, people.staffA2.id, 'STAFF', 'ACTIVE'],
    [firms.a.id, people.invitedA.id, 'STAFF', 'INVITED'],
    [firms.a.id, people.formerA.id, 'ADMIN', 'DEACTIVATED'],
    [firms.b.id, people.ownerB.id, 'OWNER', 'ACTIVE'],
  ] as const;
  for (const [businessId, userId, role, status] of members) {
    await asOwner({ kind: 'business', businessId }, (tx) =>
      tx.membership.create({ data: { businessId, userId, role, status } }),
    );
  }
  await inA(async (tx) => {
    const businessId = firms.a.id;
    const client = (key: string, assignedUserId: string | null) =>
      tx.client
        .create({
          data: { businessId, displayName: `Task Client ${key} (fake)`, assignedUserId },
          select: { id: true },
        })
        .then((c) => c.id);
    clients.c1 = await client('c1', people.staffA.id);
    clients.c2 = await client('c2', people.staffA2.id);
    clients.c3 = await client('c3', null);
    clients.c4 = await client('c4', null);
    await tx.clientAccount.create({
      data: {
        businessId,
        userId: people.clientA.id,
        email: people.clientA.email,
        clientId: clients.c1,
        status: 'ACTIVE',
      },
    });
    const service = await tx.service.create({
      data: { businessId, kind: 'BOOKKEEPING', name: 'Bookkeeping' },
      select: { id: true },
    });
    const engagement = (clientId: string) =>
      tx.engagement
        .create({
          data: { businessId, clientId, serviceId: service.id, title: 'Bookkeeping (fake)' },
          select: { id: true },
        })
        .then((e) => e.id);
    engagements.e1 = await engagement(clients.c1);
    engagements.e2 = await engagement(clients.c2);
  });
  await asOwner({ kind: 'business', businessId: firms.b.id }, async (tx) => {
    const businessId = firms.b.id;
    clients.cB = (
      await tx.client.create({
        data: { businessId, displayName: 'Other Firm Client (fake)' },
        select: { id: true },
      })
    ).id;
    const service = await tx.service.create({
      data: { businessId, kind: 'BOOKKEEPING', name: 'Bookkeeping' },
      select: { id: true },
    });
    engagements.eB = (
      await tx.engagement.create({
        data: { businessId, clientId: clients.cB, serviceId: service.id, title: 'B (fake)' },
        select: { id: true },
      })
    ).id;
  });

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

describe('who reaches which task', () => {
  it('clients are 403 on every route; another firm gets 404 and changes nothing', async () => {
    const t = await create({ clientId: clients.c1, title: 'Isolation task (fake)' });
    for (const res of [
      await call('get', '', people.clientA),
      await call('post', '', people.clientA, 'a', { clientId: clients.c1, title: 'X' }),
      await call('patch', `/${t.id}`, people.clientA, 'a', { title: 'X' }),
    ]) {
      expect([res.status, codeOf(res)]).toEqual([403, 'FORBIDDEN']);
    }

    const patched = await call('patch', `/${t.id}`, people.ownerB, 'b', { title: 'Taken' });
    expect([patched.status, codeOf(patched)]).toEqual([404, 'NOT_FOUND']);
    const created = await call('post', '', people.ownerB, 'b', {
      clientId: clients.c1,
      title: 'Into firm A',
    });
    expect([created.status, codeOf(created)]).toEqual([404, 'NOT_FOUND']);
    expect((await list('', people.ownerB, 'b')).items.map((i) => i.id)).not.toContain(t.id);
    expect((await list(`?clientId=${clients.c1}`, people.ownerB, 'b')).items).toEqual([]);
    // Firm B's own client cannot take firm A's engagement either.
    const mixed = await call('post', '', people.ownerB, 'b', {
      clientId: clients.cB,
      engagementId: engagements.e1,
      title: 'Mixed',
    });
    expect([mixed.status, codeOf(mixed)]).toEqual([409, 'ENGAGEMENT_MISMATCH']);
    // Firm B's owner has no place in firm A at all.
    expect((await call('get', '', people.ownerB, 'a')).status).toBe(404);

    expect(await stored(t.id)).toMatchObject({ title: 'Isolation task (fake)', status: 'OPEN' });
    const counts = await inA((tx) =>
      tx.task.count({ where: { title: { in: ['Taken', 'Into firm A'] } } }),
    );
    expect(counts).toBe(0);
  });

  it('Owner and Admin see and change every client task', async () => {
    const made = [
      await create({ clientId: clients.c1, title: 'Owner on c1' }),
      await create({ clientId: clients.c2, title: 'Owner on c2' }, people.adminA),
      await create({ clientId: clients.c3, title: 'Owner on c3' }),
    ];
    for (const who of [people.ownerA, people.adminA]) {
      const seen = await ids('?limit=100&status=OPEN', who);
      for (const t of made) expect(seen).toContain(t.id);
    }
    const changed = await update(made[1]!.id, { title: 'Admin changed it' }, people.adminA);
    expect(changed).toMatchObject({ title: 'Admin changed it', client: { id: clients.c2 } });
    expect(made[1]!.createdBy).toEqual({ userId: people.adminA.id, name: 'Fake R12t adminA' });
  });

  it('Staff see, change and create only the tasks of clients assigned to them (q5)', async () => {
    const theirs = await create({
      clientId: clients.c1,
      title: "On staffA's client, for the owner",
      assignedUserId: people.ownerA.id,
    });
    const other = await create({ clientId: clients.c2, title: "On staffA2's client" });
    const nobodys = await create({ clientId: clients.c3, title: "On nobody's client" });
    // Assigned to staffA when c2 was theirs; c2 has since gone to staffA2.
    const legacy = await insertTask({
      clientId: clients.c2,
      title: 'Assigned to staffA on another client',
      assignedUserId: people.staffA.id,
    });

    const seen = await ids('?limit=100', people.staffA);
    expect(seen).toContain(theirs.id);
    for (const id of [other.id, nobodys.id, legacy]) expect(seen).not.toContain(id);
    expect(await ids(`?assignedUserId=${people.staffA.id}&limit=100`, people.staffA)).not.toContain(
      legacy,
    );
    expect((await list(`?clientId=${clients.c2}`, people.staffA)).items).toEqual([]);
    expect((await list(`?engagementId=${engagements.e2}`, people.staffA)).items).toEqual([]);

    for (const id of [other.id, nobodys.id, legacy]) {
      const res = await call('patch', `/${id}`, people.staffA, 'a', { status: 'DONE' });
      expect([res.status, codeOf(res)]).toEqual([404, 'NOT_FOUND']);
      expect((await stored(id)).status).toBe('OPEN');
    }
    expect((await update(theirs.id, { status: 'DONE' }, people.staffA)).status).toBe('DONE');

    for (const clientId of [clients.c2, clients.c3, randomUUID()]) {
      const res = await call('post', '', people.staffA, 'a', { clientId, title: 'Not theirs' });
      expect([res.status, codeOf(res)]).toEqual([404, 'NOT_FOUND']);
    }
    const made = await create({ clientId: clients.c1, title: 'Made by staffA' }, people.staffA);
    expect(made).toMatchObject({
      client: { id: clients.c1 },
      createdBy: { userId: people.staffA.id, name: 'Fake R12t staffA' },
      assignedTo: null,
    });
    // The other Staff member reaches c2's tasks, the legacy one included.
    expect(await ids('?limit=100', people.staffA2)).toEqual(
      expect.arrayContaining([other.id, legacy]),
    );
  });
});

describe('assignees', () => {
  it("a client's task goes to a Staff member only when that client is theirs (409)", async () => {
    for (const [clientId, userId, who] of [
      [clients.c1, people.staffA2.id, people.ownerA],
      [clients.c3, people.staffA.id, people.ownerA],
      [clients.c1, people.staffA2.id, people.staffA],
    ] as const) {
      const res = await call('post', '', who, 'a', {
        clientId,
        title: 'Wrong staff',
        assignedUserId: userId,
      });
      expect([res.status, codeOf(res)]).toEqual([409, 'CLIENT_NOT_ASSIGNED']);
    }
    const toStaff = await create({
      clientId: clients.c1,
      title: 'To staffA',
      assignedUserId: people.staffA.id.toUpperCase(),
    });
    expect(toStaff.assignedTo).toEqual({ userId: people.staffA.id, name: 'Fake R12t staffA' });
    // Owner and Admin can take any client's task, also from Staff.
    for (const [clientId, userId, who] of [
      [clients.c3, people.adminA.id, people.ownerA],
      [clients.c2, people.ownerA.id, people.adminA],
      [clients.c1, people.adminA.id, people.staffA],
    ] as const) {
      const t = await create({ clientId, title: 'To a manager', assignedUserId: userId }, who);
      expect(t.assignedTo?.userId).toBe(userId);
    }

    const res = await call('patch', `/${toStaff.id}`, people.ownerA, 'a', {
      assignedUserId: people.staffA2.id,
    });
    expect([res.status, codeOf(res)]).toEqual([409, 'CLIENT_NOT_ASSIGNED']);
    expect((await stored(toStaff.id)).assignedUserId).toBe(people.staffA.id);
    expect((await update(toStaff.id, { assignedUserId: null })).assignedTo).toBeNull();
    expect((await update(toStaff.id, { assignedUserId: people.staffA.id })).assignedTo).toEqual({
      userId: people.staffA.id,
      name: 'Fake R12t staffA',
    });
  });

  it('the assignee must be an active member of this firm (409 NOT_A_MEMBER)', async () => {
    const t = await create({ clientId: clients.c3, title: 'Member check' });
    for (const userId of [
      people.ownerB.id,
      people.invitedA.id,
      people.formerA.id,
      people.clientA.id,
      randomUUID(),
    ]) {
      const made = await call('post', '', people.ownerA, 'a', {
        clientId: clients.c3,
        title: 'Member check',
        assignedUserId: userId,
      });
      expect([made.status, codeOf(made)]).toEqual([409, 'NOT_A_MEMBER']);
      const changed = await call('patch', `/${t.id}`, people.ownerA, 'a', {
        assignedUserId: userId,
      });
      expect([changed.status, codeOf(changed)]).toEqual([409, 'NOT_A_MEMBER']);
    }
    expect((await stored(t.id)).assignedUserId).toBeNull();
  });
});

describe('create and update', () => {
  it("the engagement must be the client's (409 ENGAGEMENT_MISMATCH)", async () => {
    for (const engagementId of [engagements.e2, engagements.eB, randomUUID()]) {
      const res = await call('post', '', people.ownerA, 'a', {
        clientId: clients.c1,
        engagementId,
        title: 'Mismatch',
      });
      expect([res.status, codeOf(res)]).toEqual([409, 'ENGAGEMENT_MISMATCH']);
    }
    const t = await create({ clientId: clients.c1, engagementId: engagements.e1, title: 'Fits' });
    expect(t.engagementId).toBe(engagements.e1);
    expect((await list(`?engagementId=${engagements.e1}`)).items.map((i) => i.id)).toContain(t.id);
  });

  it('DONE sets completedAt and keeps it; reopening clears it; null and "" clear', async () => {
    const t = await create({
      clientId: clients.c3,
      title: 'Lifecycle',
      details: 'Line one\nLine two',
      dueOn: '2026-11-20',
    });
    expect(t).toMatchObject({
      kind: 'GENERAL',
      status: 'OPEN',
      details: 'Line one\nLine two',
      dueOn: '2026-11-20',
      completedAt: null,
    });
    const done = await update(t.id, { status: 'DONE' });
    expect(done.completedAt).not.toBeNull();
    const again = await update(t.id, { status: 'DONE', title: 'Lifecycle, done' });
    expect(again.completedAt).toBe(done.completedAt);
    expect((await update(t.id, { status: 'CANCELLED' })).completedAt).toBeNull();
    expect((await update(t.id, { status: 'OPEN' })).completedAt).toBeNull();
    expect(await update(t.id, { details: null, dueOn: null })).toMatchObject({
      details: null,
      dueOn: null,
      title: 'Lifecycle, done',
    });
    await update(t.id, { details: 'Back' });
    expect((await update(t.id, { details: '' })).details).toBeNull();
  });

  it('reopening a name change while another is open is 409 NAME_CHANGE_PENDING', async () => {
    const open = await insertTask({
      clientId: clients.c1,
      title: 'Name change',
      kind: 'NAME_CHANGE',
    });
    const closed = await insertTask({
      clientId: clients.c1,
      title: 'Older name change',
      kind: 'NAME_CHANGE',
      status: 'CANCELLED',
    });
    const res = await call('patch', `/${closed}`, people.ownerA, 'a', { status: 'OPEN' });
    expect([res.status, codeOf(res)]).toEqual([409, 'NAME_CHANGE_PENDING']);
    expect((await stored(closed)).status).toBe('CANCELLED');
    // Other changes to a closed name change are fine; so is reopening once the other is done.
    expect((await update(closed, { title: 'Older name change (seen)' })).kind).toBe('NAME_CHANGE');
    expect((await update(open, { status: 'DONE' }, people.staffA)).status).toBe('DONE');
    expect((await update(closed, { status: 'OPEN' })).status).toBe('OPEN');
    await update(closed, { status: 'DONE' });

    // Two at once: the database's unique index lets one through, the other is 409, never 500.
    const pair = [
      await insertTask({
        clientId: clients.c3,
        title: 'NC 1',
        kind: 'NAME_CHANGE',
        status: 'CANCELLED',
      }),
      await insertTask({
        clientId: clients.c3,
        title: 'NC 2',
        kind: 'NAME_CHANGE',
        status: 'CANCELLED',
      }),
    ];
    const results = await Promise.all(
      pair.map((id) => call('patch', `/${id}`, people.ownerA, 'a', { status: 'OPEN' })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.map(codeOf)).toContain('NAME_CHANGE_PENDING');
    const openNow = await inA((tx) =>
      tx.task.count({ where: { id: { in: pair }, status: 'OPEN' } }),
    );
    expect(openNow).toBe(1);
  });

  it('refuses bad input with 400 before anything else', async () => {
    const t = await create({ clientId: clients.c3, title: 'Validation' });
    for (const body of [
      {},
      { clientId: 'not-a-uuid', title: 'X' },
      { clientId: clients.c3, title: '' },
      { clientId: clients.c3, title: '   ' },
      { clientId: clients.c3, title: 'X', businessId: firms.b.id },
      { clientId: clients.c3, title: 'X', kind: 'NAME_CHANGE' },
      { clientId: clients.c3, title: 'Tab\tTitle' },
      { clientId: clients.c3, title: 'Nul \u0000 title' },
      { clientId: clients.c3, title: 'Half \ud800 pair' },
      { clientId: clients.c3, title: 'X', details: 'Half \udc00 pair' },
      { clientId: clients.c3, title: 'X', details: 'Nul \u0000' },
      { clientId: clients.c3, title: 'X', dueOn: '2026-02-30' },
      { clientId: clients.c3, title: 'X', dueOn: '0000-01-01' },
      { clientId: clients.c3, title: 'X'.repeat(201) },
    ]) {
      const res = await call('post', '', people.ownerA, 'a', body);
      expect([res.status, codeOf(res)], JSON.stringify(body)).toEqual([400, 'VALIDATION_FAILED']);
    }
    for (const body of [
      {},
      { status: 'BAD' },
      { title: null },
      { dueOn: '0000-06-01' },
      { assignedUserId: 'nobody' },
      { title: 'Half \udfff pair' },
    ]) {
      const res = await call('patch', `/${t.id}`, people.ownerA, 'a', body);
      expect([res.status, codeOf(res)], JSON.stringify(body)).toEqual([400, 'VALIDATION_FAILED']);
    }
    const badId = await call('patch', '/not-a-uuid', people.ownerA, 'a', { title: 'X' });
    expect([badId.status, codeOf(badId)]).toEqual([400, 'VALIDATION_FAILED']);
    const unknown = await call('patch', `/${randomUUID()}`, people.ownerA, 'a', { title: 'X' });
    expect([unknown.status, codeOf(unknown)]).toEqual([404, 'NOT_FOUND']);
    const forged = (raw: string) => Buffer.from(raw).toString('base64url');
    for (const query of [
      '?limit=0',
      '?limit=101',
      '?status=BAD',
      '?clientId=not-a-uuid',
      '?unknown=1',
      '?cursor=not-a-cursor',
      `?cursor=${forged(`o|0000-01-01|${t.id}`)}`,
      `?cursor=${forged(`c|0000-01-01T00:00:00.000Z|${t.id}`)}`,
      `?cursor=${forged(`c|2026-10-08T00:00:00Z|${t.id}`)}`,
      `?cursor=${forged(`x|2026-10-08|${t.id}`)}`,
      `?cursor=${forged(`o|2026-10-08|${t.id}|extra`)}`,
    ]) {
      const res = await call('get', query, people.ownerA);
      expect([res.status, codeOf(res)], query).toEqual([400, 'VALIDATION_FAILED']);
    }
    expect((await stored(t.id)).title).toBe('Validation');
  });
});

describe('the list', () => {
  it('open tasks first by due date (none last), then the rest by last change, paged', async () => {
    const c = clients.c4;
    const late = await create({ clientId: c, title: 'Due Nov 3', dueOn: '2026-11-03' });
    const none = await create({ clientId: c, title: 'No date' });
    const early = await create({ clientId: c, title: 'Due Nov 1', dueOn: '2026-11-01' });
    const middle = await create({ clientId: c, title: 'Due Nov 2', dueOn: '2026-11-02' });
    const doneFirst = await create({ clientId: c, title: 'Closed first', dueOn: '2026-10-01' });
    const doneLast = await create({ clientId: c, title: 'Closed last' });
    await update(doneFirst.id, { status: 'DONE' });
    await update(doneLast.id, { status: 'CANCELLED' });

    const pages: string[][] = [];
    let cursor: string | null = null;
    do {
      const page: z.infer<typeof TaskList> = await list(
        `?clientId=${c}&limit=2${cursor ? `&cursor=${cursor}` : ''}`,
      );
      pages.push(page.items.map((i) => i.id));
      cursor = page.nextCursor;
    } while (cursor && pages.length < 10);
    expect(pages).toEqual([
      [early.id, middle.id],
      [late.id, none.id],
      [doneLast.id, doneFirst.id],
    ]);
    expect(await ids(`?clientId=${c}&status=OPEN`)).toEqual([
      early.id,
      middle.id,
      late.id,
      none.id,
    ]);
    expect(await ids(`?clientId=${c}&status=DONE`)).toEqual([doneFirst.id]);
    expect(await ids(`?clientId=${c}&assignedUserId=${people.ownerA.id}`)).toEqual([]);

    // Paging through the closed ones alone, and one row per page across the boundary.
    const first = await list(`?clientId=${c}&status=CANCELLED&limit=1`);
    expect([first.items.map((i) => i.id), first.nextCursor]).toEqual([[doneLast.id], null]);
    const one = await list(`?clientId=${c}&limit=4`);
    expect(one.items.map((i) => i.id)).toEqual([early.id, middle.id, late.id, none.id]);
    const rest = await list(`?clientId=${c}&limit=4&cursor=${one.nextCursor}`);
    expect([rest.items.map((i) => i.id), rest.nextCursor]).toEqual([
      [doneLast.id, doneFirst.id],
      null,
    ]);
  });
});

describe('audit', () => {
  it('logs reads and changes with ids and field names, never titles or details', async () => {
    const marker = `Secret-${run}`;
    const t = await create({
      clientId: clients.c3,
      title: `${marker} title`,
      details: `${marker} details`,
      dueOn: '2026-12-01',
      assignedUserId: people.adminA.id,
    });
    // An upper-case id in the URL reaches the task; the audit row still has the stored id.
    await update(t.id.toUpperCase(), { title: `${marker} again`, status: 'DONE' });
    await list(`?clientId=${clients.c3}`);

    const rows = await inA((tx) =>
      tx.auditLog.findMany({
        where: {
          businessId: firms.a.id,
          OR: [{ entityId: t.id }, { action: 'tasks.listed' }],
        },
      }),
    );
    const actions = rows.map((r) => r.action);
    for (const action of ['task.created', 'task.updated', 'tasks.listed']) {
      expect(actions).toContain(action);
    }
    expect(JSON.stringify(rows.map((r) => r.metadata))).not.toContain(marker);
    expect(rows.find((r) => r.action === 'task.created')?.metadata).toEqual({
      clientId: clients.c3,
      engagementId: null,
      assignedUserId: people.adminA.id,
      fields: ['assignedUserId', 'details', 'dueOn'],
    });
    expect(rows.find((r) => r.action === 'task.updated')?.metadata).toEqual({
      clientId: clients.c3,
      fields: ['status', 'title'],
      status: 'DONE',
    });
    expect(rows.filter((r) => r.action === 'tasks.listed').map((r) => r.metadata)).toContainEqual({
      count: expect.any(Number) as number,
      filters: ['clientId'],
      clientId: clients.c3,
    });
  });
});

describe("a client's new assignee (R12's rule, for R10's reassign path)", () => {
  it("moves the old Staff assignee's open tasks to the new one or to nobody; Owner and Admin keep theirs", async () => {
    const businessId = firms.a.id;
    const database = app.get<Database>(DATABASE);
    // As R10's reassign path will: the client's assignee and its tasks in one firm transaction.
    const reassign = (from: string | null, to: string | null) =>
      database.withScope({ kind: 'business', businessId }, async (tx) => {
        await tx.client.update({ where: { id: clients.c4 }, data: { assignedUserId: to } });
        return reassignClientTasks(tx, businessId, clients.c4, from, to);
      });
    await inA((tx) =>
      tx.client.update({ where: { id: clients.c4 }, data: { assignedUserId: people.staffA.id } }),
    );
    const open = await insertTask({
      clientId: clients.c4,
      title: 'Open (fake)',
      assignedUserId: people.staffA.id,
    });
    const done = await insertTask({
      clientId: clients.c4,
      title: 'Done (fake)',
      status: 'DONE',
      assignedUserId: people.staffA.id,
    });
    const owners = await insertTask({
      clientId: clients.c4,
      title: 'Owner (fake)',
      assignedUserId: people.ownerA.id,
    });
    const nobodys = await insertTask({ clientId: clients.c4, title: 'Nobody (fake)' });
    const elsewhere = await insertTask({
      clientId: clients.c1,
      title: 'Another client (fake)',
      assignedUserId: people.staffA.id,
    });
    const holder = async (id: string) => (await stored(id)).assignedUserId;

    expect(await reassign(people.staffA.id, people.staffA2.id)).toBe(1);
    expect(await holder(open)).toBe(people.staffA2.id);
    expect(await holder(done)).toBe(people.staffA.id);
    expect(await holder(owners)).toBe(people.ownerA.id);
    expect(await holder(nobodys)).toBeNull();
    expect(await holder(elsewhere)).toBe(people.staffA.id);
    // The new assignee reaches it through the API now.
    expect(await ids(`?clientId=${clients.c4}`, people.staffA2)).toContain(open);

    // A client left with nobody: the open task is nobody's too.
    expect(await reassign(people.staffA2.id, null)).toBe(1);
    expect(await holder(open)).toBeNull();

    // From an Owner: their tasks stay with them.
    await inA((tx) =>
      tx.client.update({ where: { id: clients.c4 }, data: { assignedUserId: people.ownerA.id } }),
    );
    expect(await reassign(people.ownerA.id, people.staffA.id)).toBe(0);
    expect(await holder(owners)).toBe(people.ownerA.id);
    // Nothing to do for no previous assignee or the same one.
    expect(await reassign(null, people.staffA.id)).toBe(0);
    expect(await reassign(people.staffA.id, people.staffA.id)).toBe(0);
  });
});
