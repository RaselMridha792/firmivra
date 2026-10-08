// End-to-end: R10 step 3, the firm's clients (contract in packages/types/src/clients). Owner and
// Admin reach every client, Staff only their own; archive and restore are Owner and Admin. One
// email per firm, archived clients included. SSN, EIN and date of birth answer 501 until step 4.
// Every read and change is audited without values, and one firm never sees another's clients.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { z } from 'zod';
import { ClientListItem as ListShape, ClientRecord as RecordShape } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

// The contract drops unknown keys; these tests refuse them, so a leaked field (businessId) fails.
const Profile = z.strictObject(RecordShape.shape.profile.shape);
const Record_ = z.strictObject({ ...RecordShape.shape, profile: Profile });
const ListItem = z.strictObject(ListShape.shape);
const ListResponse = z.strictObject({
  items: z.array(ListItem),
  nextCursor: z.string().nullable(),
});

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r10-${key}-${run}@r10.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  staffA2: person('staff-a2'),
  clientA: person('client-a'),
  ownerB: person('owner-b'),
};
const firms = {} as Record<'a' | 'b', { id: string; slug: string }>;

let app: INestApplication;
const tokens = new Map<string, string>();

async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email })
    .expect(200);
  const token = (res.body as { token: string }).token;
  tokens.set(email, token);
  return token;
}

async function call(
  method: 'get' | 'post' | 'patch',
  path: string,
  who: { email: string },
  firm: 'a' | 'b' = 'a',
  body?: object,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business/clients${path}`)
    .set('x-business-id', firms[firm].id)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const create = async (body: object, who = people.ownerA, firm: 'a' | 'b' = 'a') => {
  const res = await call('post', '', who, firm, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return Record_.parse(res.body);
};
const list = async (query: string, who = people.ownerA) => {
  const res = await call('get', query, who);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return ListResponse.parse(res.body);
};
const email = (key: string) => `${key}-${run}@client.test`;

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      const pool = key === 'clientA' ? 'CLIENT' : 'STAFF';
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool, email: p.email, name: `Fake R10 ${key}` },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r10-${key}-${run}`;
      firms[key] = await tx.business.create({
        data: { slug, name: slug, status: 'ACTIVE' },
        select: { id: true, slug: true },
      });
    }
  });
  const members = [
    [firms.a.id, people.ownerA.id, 'OWNER'],
    [firms.a.id, people.adminA.id, 'ADMIN'],
    [firms.a.id, people.staffA.id, 'STAFF'],
    [firms.a.id, people.staffA2.id, 'STAFF'],
    [firms.b.id, people.ownerB.id, 'OWNER'],
  ] as const;
  for (const [businessId, userId, role] of members) {
    await runInScope(owner, { kind: 'business', businessId }, (tx) =>
      tx.membership.create({ data: { businessId, userId, role, status: 'ACTIVE' } }),
    );
  }
  await runInScope(owner, { kind: 'business', businessId: firms.a.id }, (tx) =>
    tx.clientAccount.create({
      data: {
        businessId: firms.a.id,
        userId: people.clientA.id,
        email: people.clientA.email,
        status: 'ACTIVE',
      },
    }),
  );
  await owner.$disconnect();

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

describe('who reaches which client', () => {
  it('clients are 403; another firm gets 404 on every route', async () => {
    const c = await create({ displayName: 'Jamie Sample (fake)', email: email('jamie') });
    expect((await call('get', '', people.clientA)).status).toBe(403);
    for (const [method, path] of [
      ['get', `/${c.id}`],
      ['patch', `/${c.id}`],
      ['post', `/${c.id}/archive`],
      ['post', `/${c.id}/restore`],
    ] as const) {
      const res = await call(
        method,
        path,
        people.ownerB,
        'b',
        method === 'patch' ? { displayName: 'X' } : {},
      );
      expect([res.status, codeOf(res)]).toEqual([404, 'NOT_FOUND']);
    }
    expect((await list('?status=all', people.ownerA)).items.map((i) => i.id)).toContain(c.id);
    const otherFirm = await call('get', '?status=all', people.ownerB, 'b');
    expect(ListResponse.parse(otherFirm.body).items.map((i) => i.id)).not.toContain(c.id);
  });

  it('Staff reach only their own clients; a client they create is theirs', async () => {
    const theirs = await create({
      displayName: 'Staff One Client',
      assignedUserId: people.staffA.id,
    });
    const other = await create({
      displayName: 'Staff Two Client',
      assignedUserId: people.staffA2.id,
    });
    const unassigned = await create({ displayName: 'Nobody Client' });

    const seen = (await list('?status=all', people.staffA)).items.map((i) => i.id);
    expect(seen).toContain(theirs.id);
    expect(seen).not.toContain(other.id);
    expect(seen).not.toContain(unassigned.id);
    for (const id of [other.id, unassigned.id]) {
      expect((await call('get', `/${id}`, people.staffA)).status).toBe(404);
      expect(
        (await call('patch', `/${id}`, people.staffA, 'a', { phone: '+14045550100' })).status,
      ).toBe(404);
    }

    const created = await create({ displayName: 'Made By Staff' }, people.staffA);
    expect(created.assignedTo).toEqual({ userId: people.staffA.id, name: 'Fake R10 staffA' });
    expect(Record_.parse((await call('get', `/${created.id}`, people.staffA)).body).id).toBe(
      created.id,
    );
  });

  it('Staff cannot set the assignee, filter by it, archive or restore (403)', async () => {
    const c = await create({ displayName: 'Assign Test', assignedUserId: people.staffA.id });
    for (const res of [
      await call('post', '', people.staffA, 'a', {
        displayName: 'X',
        assignedUserId: people.staffA.id,
      }),
      await call('patch', `/${c.id}`, people.staffA, 'a', { assignedUserId: people.staffA2.id }),
      await call('get', `?assignedUserId=${people.staffA.id}`, people.staffA),
      await call('post', `/${c.id}/archive`, people.staffA, 'a', {}),
      await call('post', `/${c.id}/restore`, people.staffA, 'a', {}),
    ]) {
      expect([res.status, codeOf(res)]).toEqual([403, 'FORBIDDEN']);
    }
  });

  it('the assignee must be an active member of this firm (404 otherwise)', async () => {
    for (const assignedUserId of [people.ownerB.id, randomUUID()]) {
      const res = await call('post', '', people.ownerA, 'a', { displayName: 'X', assignedUserId });
      expect([res.status, codeOf(res)]).toEqual([404, 'NOT_FOUND']);
    }
  });
});

describe('list: search, filters and paging', () => {
  it('searches name, email and phone, with % and _ as plain characters', async () => {
    const pct = await create({ displayName: `100% Fake Co ${run}` });
    const und = await create({ displayName: `Under_Score ${run}` });
    await create({ displayName: `Plain Name ${run}`, phone: '+14045559999' });
    const ids = async (q: string) =>
      (await list(`?status=all&search=${encodeURIComponent(q)}`)).items.map((i) => i.id);
    expect(await ids(`% Fake Co ${run}`)).toEqual([pct.id]);
    expect(await ids(`r_Score ${run}`)).toEqual([und.id]);
    expect(await ids(`under_score ${run}`)).toEqual([und.id]);
    expect((await ids('%')).every((id) => id === pct.id)).toBe(true);
    expect((await list('?status=all&search=4045559999')).items).toHaveLength(1);
  });

  it('a search with a NUL or another control character is 400, never 500', async () => {
    for (const term of ['%00', `Fake%00${run}`, '%1B%5B31m', '%C2%85']) {
      const res = await call('get', `?search=${term}`, people.ownerA);
      expect([res.status, codeOf(res)], term).toEqual([400, 'VALIDATION_FAILED']);
    }
    // A query string can't carry a lone surrogate: the URL decoder turns the bytes of one into
    // U+FFFD, plain text. (A JSON body can; the shared rule refuses it, packages/types tests.)
    expect((await list('?search=%ED%A0%80')).items).toEqual([]);
  });

  it('pages newest first with an opaque cursor; a bad cursor is 400', async () => {
    const made = [];
    for (let i = 0; i < 5; i++) made.push(await create({ displayName: `Pager-${run} ${i}` }));
    const term = `search=${encodeURIComponent(`Pager-${run}`)}`;
    const first = await list(`?${term}&limit=2`);
    expect(first.items.map((i) => i.id)).toEqual([made[4]!.id, made[3]!.id]);
    const second = await list(`?${term}&limit=2&cursor=${first.nextCursor}`);
    expect(second.items.map((i) => i.id)).toEqual([made[2]!.id, made[1]!.id]);
    const third = await list(`?${term}&limit=2&cursor=${second.nextCursor}`);
    expect(third).toMatchObject({ nextCursor: null });
    expect(third.items.map((i) => i.id)).toEqual([made[0]!.id]);

    const bad = await call('get', '?cursor=not-a-cursor', people.ownerA);
    expect([bad.status, codeOf(bad)]).toEqual([400, 'VALIDATION_FAILED']);
  });

  it('archived clients leave the default list; the status filter shows them', async () => {
    const c = await create({ displayName: `Archive Me ${run}` });
    const archived = await call('post', `/${c.id}/archive`, people.adminA, 'a', {});
    expect(Record_.parse(archived.body).archivedAt).not.toBeNull();
    const search = `search=${encodeURIComponent(`Archive Me ${run}`)}`;
    expect((await list(`?${search}`)).items).toEqual([]);
    expect((await list(`?${search}&status=archived`)).items.map((i) => i.id)).toEqual([c.id]);
    // Repeating is harmless; restore brings it back.
    expect((await call('post', `/${c.id}/archive`, people.ownerA, 'a', {})).status).toBe(200);
    expect(
      Record_.parse((await call('post', `/${c.id}/restore`, people.ownerA, 'a', {})).body)
        .archivedAt,
    ).toBeNull();
  });
});

describe('create and update', () => {
  it('creates the client and its profile, without SSN, EIN or date of birth (501)', async () => {
    const c = await create({
      displayName: 'Profile Client (fake)',
      accountType: 'BUSINESS',
      email: email('profile'),
      profile: {
        businessName: 'Profile Client LLC',
        entityType: 'LLC',
        address: { line1: '1 Sample Way', city: 'Atlanta', state: 'GA', postalCode: '30301' },
        preferredContactMethod: 'EMAIL',
      },
    });
    expect(c.profile).toMatchObject({
      businessName: 'Profile Client LLC',
      address: { line1: '1 Sample Way', city: 'Atlanta', country: 'US' },
      ssnLast4: null,
      einLast4: null,
      dateOfBirth: null,
    });
    for (const profile of [
      { ssn: '900-00-0001' },
      { ein: '90-0000001' },
      { dateOfBirth: '1985-04-12' },
    ]) {
      const res = await call('post', '', people.ownerA, 'a', {
        displayName: `Sensitive ${run}`,
        email: email(`sensitive-${Object.keys(profile)[0]}`),
        profile,
      });
      expect([res.status, codeOf(res)]).toEqual([501, 'NOT_IMPLEMENTED']);
    }
    expect(
      (await list(`?status=all&search=${encodeURIComponent(`Sensitive ${run}`)}`)).items,
    ).toEqual([]);
  });

  it('one email per firm, archived clients included; another firm may use it (409)', async () => {
    const e = email('dup');
    const first = await create({ displayName: 'Dup One', email: e });
    const again = await call('post', '', people.ownerA, 'a', {
      displayName: 'Dup Two',
      email: e.toUpperCase(),
    });
    expect([again.status, codeOf(again)]).toEqual([409, 'DUPLICATE_EMAIL']);
    await call('post', `/${first.id}/archive`, people.ownerA, 'a', {});
    const afterArchive = await call('post', '', people.ownerA, 'a', {
      displayName: 'Dup Three',
      email: e,
    });
    expect([afterArchive.status, codeOf(afterArchive)]).toEqual([409, 'DUPLICATE_EMAIL']);
    const other = await create({ displayName: 'Other Firm', email: e }, people.ownerB, 'b');
    expect(other.email).toBe(e);

    const second = await create({ displayName: 'Dup Four', email: email('dup-four') });
    const clash = await call('patch', `/${second.id}`, people.ownerA, 'a', { email: e });
    expect([clash.status, codeOf(clash)]).toEqual([409, 'DUPLICATE_EMAIL']);
  });

  it('updates only the fields sent; "" clears; an archived client is 409; bad input 400', async () => {
    const c = await create({
      displayName: 'Update Me',
      email: email('update'),
      phone: '+14045550101',
    });
    const res = await call('patch', `/${c.id}`, people.ownerA, 'a', {
      phone: '',
      displayName: 'Updated',
    });
    expect(Record_.parse(res.body)).toMatchObject({
      displayName: 'Updated',
      phone: null,
      email: email('update'),
    });

    for (const body of [{}, { businessId: firms.b.id }, { displayName: 'Tab\tName' }]) {
      const bad = await call('patch', `/${c.id}`, people.ownerA, 'a', body);
      expect([bad.status, codeOf(bad)]).toEqual([400, 'VALIDATION_FAILED']);
    }
    await call('post', `/${c.id}/archive`, people.ownerA, 'a', {});
    const locked = await call('patch', `/${c.id}`, people.ownerA, 'a', { displayName: 'Nope' });
    expect([locked.status, codeOf(locked)]).toEqual([409, 'CLIENT_ARCHIVED']);
    expect((await call('get', '/not-a-uuid', people.ownerA)).status).toBe(400);
  });
});

describe('audit', () => {
  it('logs every read and change with ids and field names, never names or emails', async () => {
    const c = await create({ displayName: `Audited Person ${run}`, email: email('audited') });
    await call('get', `/${c.id}`, people.ownerA);
    await call('patch', `/${c.id}`, people.ownerA, 'a', { displayName: `Audited Again ${run}` });
    await call('post', `/${c.id}/archive`, people.ownerA, 'a', {});
    await list('?status=all');

    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    const rows = await runInScope(owner, { kind: 'business', businessId: firms.a.id }, (tx) =>
      tx.auditLog.findMany({
        where: { businessId: firms.a.id, OR: [{ entityId: c.id }, { action: 'clients.listed' }] },
      }),
    );
    await owner.$disconnect();
    const actions = rows.map((r) => r.action);
    for (const action of [
      'client.created',
      'client.viewed',
      'client.updated',
      'client.archived',
      'clients.listed',
    ]) {
      expect(actions).toContain(action);
    }
    const text = JSON.stringify(rows.map((r) => r.metadata));
    expect(text).not.toContain('Audited');
    expect(text).not.toContain('audited-');
    expect(rows.find((r) => r.action === 'client.updated')?.metadata).toEqual({
      fields: ['displayName'],
    });
  });
});

/**
 * Runs `change` in a firm transaction and keeps it open (with the client's row locked) until
 * the request is waiting on it, then commits. Before the fix the request read first and only
 * waited at its write, so the change it had not seen still let it through.
 */
async function whileChanging(
  change: (tx: TxClient) => Promise<unknown>,
  send: () => Promise<Response>,
): Promise<Response> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  let letGo!: () => void;
  const released = new Promise<void>((resolve) => (letGo = resolve));
  let held!: (pid: number) => void;
  const holding = new Promise<number>((resolve) => (held = resolve));
  const holder = runInScope(owner, { kind: 'business', businessId: firms.a.id }, async (tx) => {
    await change(tx);
    const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    held(row!.pid);
    await released;
  });
  try {
    const pid = await holding;
    const pending = send();
    for (let i = 0; ; i++) {
      const [row] = await owner.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE ${pid}::int = ANY (pg_blocking_pids(pid))`;
      if (row!.n > 0) break;
      if (i === 500) throw new Error('the request never waited on the change');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    letGo();
    await holder;
    return await pending;
  } finally {
    letGo();
    await owner.$disconnect();
  }
}

describe('changes at the same time', () => {
  it('an update that waited on an archive is 409 CLIENT_ARCHIVED and writes nothing', async () => {
    const { id } = await create({ displayName: `Race archive ${run}` });
    const res = await whileChanging(
      (tx) => tx.client.update({ where: { id }, data: { archivedAt: new Date() } }),
      () => call('patch', `/${id}`, people.ownerA, 'a', { displayName: 'Changed' }),
    );
    expect([res.status, codeOf(res)]).toEqual([409, 'CLIENT_ARCHIVED']);
    const after = Record_.parse((await call('get', `/${id}`, people.ownerA)).body);
    expect(after.displayName).toBe(`Race archive ${run}`);
  });

  it('a Staff update that waited on a reassignment away is 404 and writes nothing', async () => {
    const { id } = await create({
      displayName: `Race reassign ${run}`,
      assignedUserId: people.staffA.id,
    });
    const res = await whileChanging(
      (tx) => tx.client.update({ where: { id }, data: { assignedUserId: people.staffA2.id } }),
      () => call('patch', `/${id}`, people.staffA, 'a', { displayName: 'Changed' }),
    );
    expect([res.status, codeOf(res)]).toEqual([404, 'NOT_FOUND']);
    const after = Record_.parse((await call('get', `/${id}`, people.ownerA)).body);
    expect(after.displayName).toBe(`Race reassign ${run}`);
  });

  it('an archive that waited on another archive is not archived twice (one audit row)', async () => {
    const { id } = await create({ displayName: `Race twice ${run}` });
    const res = await whileChanging(
      (tx) => tx.client.update({ where: { id }, data: { archivedAt: new Date() } }),
      () => call('post', `/${id}/archive`, people.ownerA, 'a', {}),
    );
    expect(res.status).toBe(200);
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    const rows = await runInScope(owner, { kind: 'business', businessId: firms.a.id }, (tx) =>
      tx.auditLog.count({ where: { action: 'client.archived', entityId: id } }),
    );
    await owner.$disconnect();
    expect(rows).toBe(0);
  });

  it('an update does not wait for a row being added under the client (FOR KEY SHARE)', async () => {
    const { id } = await create({ displayName: `Race key share ${run}` });
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    let letGo!: () => void;
    const released = new Promise<void>((resolve) => (letGo = resolve));
    let held!: () => void;
    const holding = new Promise<void>((resolve) => (held = resolve));
    // What adding a tax year, service or return for the client holds until it commits: the
    // foreign key check's FOR KEY SHARE on the client's row. FOR UPDATE would wait for it.
    const holder = runInScope(owner, { kind: 'business', businessId: firms.a.id }, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM clients WHERE id = ${id}::uuid FOR KEY SHARE`;
      held();
      await released;
    });
    let timer: NodeJS.Timeout | undefined;
    try {
      await holding;
      const res = await Promise.race([
        call('patch', `/${id}`, people.ownerA, 'a', { displayName: 'Changed' }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('the update waited on FOR KEY SHARE')), 3_000);
        }),
      ]);
      expect([res.status, Record_.parse(res.body).displayName]).toEqual([200, 'Changed']);
    } finally {
      clearTimeout(timer);
      letGo();
      await holder;
      await owner.$disconnect();
    }
  });
});
