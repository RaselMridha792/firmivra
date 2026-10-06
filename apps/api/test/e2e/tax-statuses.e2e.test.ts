// End-to-end: T04 tax statuses (contract in packages/types/src/tax-statuses). Staff list;
// Owner and Admin add, rename, reorder and archive. Names are unique ignoring case (archived
// ones too), at most 500 per firm, and one firm never sees or changes another's.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { ListTaxStatusesResponse, TaxStatus } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `t04-${key}-${run}@t04.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  clientA: person('client-a'),
  ownerB: person('owner-b'),
  ownerFull: person('owner-full'),
  ownerRace: person('owner-race'),
};
const firms = {} as Record<'a' | 'b' | 'full' | 'race', { id: string; slug: string }>;
const ownerOf = {
  a: people.ownerA,
  b: people.ownerB,
  full: people.ownerFull,
  race: people.ownerRace,
};

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

type Method = 'get' | 'post' | 'patch' | 'put';
async function call(
  method: Method,
  path: string,
  who: { email: string } | undefined,
  businessId: string,
  body?: object,
): Promise<Response> {
  const token = who ? await tokenFor(who.email) : undefined;
  let req = request(app.getHttpServer())
    [method](`/api/v1/business/tax-statuses${path}`)
    .set('x-business-id', businessId);
  if (token) req = req.set('authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const list = async (firm: 'a' | 'b' | 'race', query = '') => {
  const res = await call('get', query, ownerOf[firm], firms[firm].id);
  expect(res.status).toBe(200);
  return ListTaxStatusesResponse.parse(res.body).items;
};
const create = async (name: string, firm: 'a' | 'b' | 'full' | 'race' = 'a') =>
  call('post', '', ownerOf[firm], firms[firm].id, { name });

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      const pool = key === 'clientA' ? 'CLIENT' : 'STAFF';
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool, email: p.email, name: `Fake T04 ${key}` },
      });
    }
    for (const key of ['a', 'b', 'full', 'race'] as const) {
      const slug = `t04-${key}-${run}`;
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
    [firms.b.id, people.ownerB.id, 'OWNER'],
    [firms.full.id, people.ownerFull.id, 'OWNER'],
    [firms.race.id, people.ownerRace.id, 'OWNER'],
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
  // A firm at the limit: 500 statuses, one of them archived.
  await runInScope(owner, { kind: 'business', businessId: firms.full.id }, (tx) =>
    tx.taxStatus.createMany({
      data: Array.from({ length: 500 }, (_, i) => ({
        businessId: firms.full.id,
        name: `Status ${i}`,
        sortOrder: i,
        archivedAt: i === 0 ? new Date() : null,
      })),
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
  // Listening, so supertest shares one server; requests sent together never close it.
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('who may do what', () => {
  it('staff list; only Owner and Admin change; clients 403; other firms 404', async () => {
    const staff = await call('get', '', people.staffA, firms.a.id);
    expect([staff.status, staff.body]).toEqual([200, { items: [] }]);
    const staffCreate = await call('post', '', people.staffA, firms.a.id, { name: 'Mine' });
    expect([staffCreate.status, codeOf(staffCreate)]).toEqual([403, 'FORBIDDEN']);
    expect((await call('get', '', people.clientA, firms.a.id)).status).toBe(403);
    const outsider = await call('get', '', people.ownerB, firms.a.id);
    expect([outsider.status, codeOf(outsider)]).toEqual([404, 'NOT_FOUND']);
    expect((await call('get', '', undefined, firms.a.id)).status).toBe(401);
    const admin = await call('post', '', people.adminA, firms.a.id, { name: 'Admin made' });
    expect(admin.status).toBe(201);
  });
});

describe('create, rename, reorder, archive', () => {
  it('adds statuses at the end, trimmed; names are unique ignoring case', async () => {
    const first = TaxStatus.parse((await create('  Waiting for documents ')).body);
    const second = TaxStatus.parse((await create('Filed')).body);
    expect(first).toMatchObject({ name: 'Waiting for documents', sortOrder: 1, archivedAt: null });
    expect(second.sortOrder).toBe(2);

    const duplicate = await create('FILED');
    expect([duplicate.status, codeOf(duplicate)]).toEqual([409, 'DUPLICATE_NAME']);
    for (const body of [{ name: '   ' }, { name: 'X', businessId: firms.b.id }, {}]) {
      const res = await call('post', '', people.ownerA, firms.a.id, body);
      expect([res.status, codeOf(res)]).toEqual([400, 'VALIDATION_FAILED']);
    }
  });

  it('renames; 404 for an unknown id or another firm’s; 409 for a taken name', async () => {
    const [made, waiting, filed] = await list('a');
    expect([made?.name, waiting?.name, filed?.name]).toEqual([
      'Admin made',
      'Waiting for documents',
      'Filed',
    ]);
    const renamed = await call('patch', `/${filed?.id}`, people.ownerA, firms.a.id, {
      name: 'filed',
    });
    expect([renamed.status, (renamed.body as TaxStatus).name]).toEqual([200, 'filed']);

    const taken = await call('patch', `/${filed?.id}`, people.ownerA, firms.a.id, {
      name: 'admin MADE',
    });
    expect([taken.status, codeOf(taken)]).toEqual([409, 'DUPLICATE_NAME']);
    expect(
      (await call('patch', `/${randomUUID()}`, people.ownerA, firms.a.id, { name: 'X' })).status,
    ).toBe(404);
    expect(
      (await call('patch', '/not-a-uuid', people.ownerA, firms.a.id, { name: 'X' })).status,
    ).toBe(400);

    const theirs = TaxStatus.parse((await create('Firm B only', 'b')).body);
    const across = await call('patch', `/${theirs.id}`, people.ownerA, firms.a.id, {
      name: 'Ours',
    });
    expect([across.status, codeOf(across)]).toEqual([404, 'NOT_FOUND']);
    expect((await list('b')).map((s) => s.name)).toEqual(['Firm B only']);
  });

  it('reorders: every active status once, unknown 404, missing 409, repeated 400', async () => {
    const ids = (await list('a')).map((s) => s.id);
    const reversed = [...ids].reverse();
    const res = await call('put', '/order', people.ownerA, firms.a.id, { ids: reversed });
    expect(res.status).toBe(200);
    const items = ListTaxStatusesResponse.parse(res.body).items;
    expect(items.map((s) => s.id)).toEqual(reversed);
    expect(items.map((s) => s.sortOrder)).toEqual([0, 1, 2]);

    const missing = await call('put', '/order', people.ownerA, firms.a.id, {
      ids: reversed.slice(1),
    });
    expect([missing.status, codeOf(missing)]).toEqual([409, 'CONFLICT']);
    const unknown = await call('put', '/order', people.ownerA, firms.a.id, {
      ids: [...reversed, randomUUID()],
    });
    expect([unknown.status, codeOf(unknown)]).toEqual([404, 'NOT_FOUND']);
    const twice = await call('put', '/order', people.ownerA, firms.a.id, {
      ids: [...reversed, reversed[0]],
    });
    expect(twice.status).toBe(400);
  });

  it('archives (once, repeat harmless); archived ones are hidden but keep their name', async () => {
    const [top] = await list('a');
    const archived = await call('post', `/${top?.id}/archive`, people.ownerA, firms.a.id);
    expect(archived.status).toBe(200);
    const archivedAt = (archived.body as TaxStatus).archivedAt;
    expect(archivedAt).not.toBeNull();
    const again = await call('post', `/${top?.id}/archive`, people.ownerA, firms.a.id);
    expect((again.body as TaxStatus).archivedAt).toBe(archivedAt);

    expect((await list('a')).map((s) => s.id)).not.toContain(top?.id);
    expect((await list('a', '?includeArchived=true')).map((s) => s.id)).toContain(top?.id);
    expect((await create(top?.name ?? '')).status).toBe(409);

    // A new order lists active statuses only; naming the archived one is a conflict.
    const active = (await list('a')).map((s) => s.id);
    const withArchived = await call('put', '/order', people.ownerA, firms.a.id, {
      ids: [...active, top?.id],
    });
    expect(withArchived.status).toBe(409);
    for (const query of ['?includeArchived=yes', '?other=1']) {
      expect((await call('get', query, people.ownerA, firms.a.id)).status).toBe(400);
    }
  });

  it('audits each change without the names', async () => {
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    const rows = await runInScope(owner, { kind: 'business', businessId: firms.a.id }, (tx) =>
      tx.auditLog.findMany({ where: { businessId: firms.a.id, entityType: 'tax_status' } }),
    );
    await owner.$disconnect();
    const actions = new Set(rows.map((r) => r.action));
    for (const action of ['created', 'renamed', 'reordered', 'archived']) {
      expect(actions).toContain(`tax_status.${action}`);
    }
    expect(rows.filter((r) => r.action === 'tax_status.archived')).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('Waiting for documents');
  });
});

describe('limits and races', () => {
  it('refuses a 501st status, archived ones included', async () => {
    const res = await create('One too many', 'full');
    expect([res.status, codeOf(res)]).toEqual([409, 'CONFIGURATION_LIMIT']);
  });

  it('statuses added at the same moment get distinct places and never duplicate', async () => {
    const results = await Promise.all(
      ['One', 'Two', 'Three', 'Four', 'one'].map((name) => create(name, 'race')),
    );
    const created = results.filter((r) => r.status === 201).map((r) => r.body as TaxStatus);
    const refused = results.filter((r) => r.status === 409);
    expect([created.length, refused.length]).toEqual([4, 1]);
    expect(created.map((s) => s.sortOrder).sort()).toEqual([0, 1, 2, 3]);
  });
});
