// End-to-end: the firm's one tag list (L5 and L6 of Octavia's Leads review; contract in
// packages/types/src/tags): GET and POST /business/tags, and a client's tags at
// /business/clients/{id}/tags. A name in another case is the same tag, Owner and Admin add tags,
// Staff apply existing ones to their own clients only, and firm B never reads or changes firm A's.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { z } from 'zod';
import { ClientTags, FirmTag } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const Tag = z.strictObject(FirmTag.shape);
const List = z.strictObject({ items: z.array(Tag) });
const Names = z.strictObject(ClientTags.shape);

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `tags-${key}-${run}@tags.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  ownerB: person('owner-b'),
};
const ids = { firmA: '', firmB: '', mine: '', other: '', archived: '', service: '' };

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
  method: 'get' | 'post' | 'put' | 'patch',
  path: string,
  who: { email: string },
  body?: object,
  businessId = ids.firmA,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', businessId)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};
const list = async (who = people.ownerA, businessId = ids.firmA) =>
  List.parse(ok(await call('get', '/tags', who, undefined, businessId))).items;
const named = (items: z.infer<typeof Tag>[], name: string) =>
  items.find((t) => t.name.toLowerCase() === name.toLowerCase());

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    }
    ids.firmA = (
      await tx.business.create({ data: { slug: `tags-a-${run}`, name: 'A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: `tags-b-${run}`, name: 'B', status: 'ACTIVE' } })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const businessId = ids.firmA;
    for (const [userId, role] of [
      [people.ownerA.id, 'OWNER'],
      [people.adminA.id, 'ADMIN'],
      [people.staffA.id, 'STAFF'],
    ] as const) {
      await tx.membership.create({ data: { businessId, userId, role, status: 'ACTIVE' } });
    }
    const client = async (key: string, extra: object = {}) =>
      (
        await tx.client.create({
          data: {
            businessId,
            displayName: `Fake ${key} client`,
            email: `${key}-${run}@client.test`,
            ...extra,
          },
          select: { id: true },
        })
      ).id;
    ids.mine = await client('mine', { assignedUserId: people.staffA.id });
    ids.other = await client('other');
    ids.archived = await client('archived', { archivedAt: new Date() });
    ids.service = (
      await tx.service.create({ data: { businessId, kind: 'ANNUAL_TAX', name: `Tax ${run}` } })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmB, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
  });
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

describe('The firm’s tags (GET and POST /business/tags)', () => {
  it('Owner and Admin add tags; a name in another case is refused, never a second tag', async () => {
    expect(await list()).toEqual([]);
    const vip = Tag.parse(ok(await call('post', '/tags', people.ownerA, { name: ' VIP ' }), 201));
    expect(vip).toMatchObject({ name: 'VIP', leads: 0, clients: 0 });
    ok(await call('post', '/tags', people.adminA, { name: 'Back Taxes' }), 201);
    const again = await call('post', '/tags', people.adminA, { name: 'vip' });
    expect(again.status).toBe(409);
    expect(codeOf(again)).toBe('TAG_EXISTS');
    expect((await list()).map((t) => t.name)).toEqual(['Back Taxes', 'VIP']);
  });

  it('Staff read the list but cannot add to it; firm B sees only its own', async () => {
    expect((await list(people.staffA)).map((t) => t.name)).toEqual(['Back Taxes', 'VIP']);
    const staff = await call('post', '/tags', people.staffA, { name: 'Staff tag' });
    expect(staff.status).toBe(403);
    expect(await list(people.ownerB, ids.firmB)).toEqual([]);
    ok(await call('post', '/tags', people.ownerB, { name: 'VIP' }, ids.firmB), 201);
    expect((await list()).filter((t) => t.name === 'VIP')).toHaveLength(1);
  });

  it('400 for an empty or too long name', async () => {
    expect((await call('post', '/tags', people.ownerA, { name: '  ' })).status).toBe(400);
    expect((await call('post', '/tags', people.ownerA, { name: 'x'.repeat(41) })).status).toBe(400);
  });
});

describe('A client’s tags (GET and PUT /business/clients/{id}/tags)', () => {
  it('replaces them: existing names in any case, repeats once, new ones for Owner and Admin', async () => {
    const set = Names.parse(
      ok(
        await call('put', `/clients/${ids.mine}/tags`, people.ownerA, {
          tags: ['vip', 'VIP', 'Spanish Speaking'],
        }),
      ),
    );
    expect(set.tags).toEqual(['Spanish Speaking', 'VIP']);
    expect(Names.parse(ok(await call('get', `/clients/${ids.mine}/tags`, people.ownerA)))).toEqual(
      set,
    );
    const tags = await list();
    expect(named(tags, 'VIP')?.clients).toBe(1);
    expect(named(tags, 'Spanish Speaking')).toBeDefined();

    const fewer = Names.parse(
      ok(await call('put', `/clients/${ids.mine}/tags`, people.adminA, { tags: ['Back Taxes'] })),
    );
    expect(fewer.tags).toEqual(['Back Taxes']);
    expect(named(await list(), 'VIP')?.clients).toBe(0);
  });

  it('Staff: existing tags on their own clients; a new name is 400, another client is 404', async () => {
    const mine = Names.parse(
      ok(await call('put', `/clients/${ids.mine}/tags`, people.staffA, { tags: ['vip'] })),
    );
    expect(mine.tags).toEqual(['VIP']);
    const unknown = await call('put', `/clients/${ids.mine}/tags`, people.staffA, {
      tags: ['VIP', 'Brand new'],
    });
    expect(unknown.status).toBe(400);
    expect(codeOf(unknown)).toBe('UNKNOWN_TAG');
    expect(
      Names.parse(ok(await call('get', `/clients/${ids.mine}/tags`, people.staffA))).tags,
    ).toEqual(['VIP']);
    expect(named(await list(), 'Brand new')).toBeUndefined();
    for (const method of ['get', 'put'] as const) {
      const res = await call(method, `/clients/${ids.other}/tags`, people.staffA, {
        tags: ['VIP'],
      });
      expect(res.status).toBe(404);
    }
  });

  it('an archived client is 409; another firm’s client is 404; an empty list clears', async () => {
    const archived = await call('put', `/clients/${ids.archived}/tags`, people.ownerA, {
      tags: ['VIP'],
    });
    expect(archived.status).toBe(409);
    expect(codeOf(archived)).toBe('CLIENT_ARCHIVED');
    for (const method of ['get', 'put'] as const) {
      const res = await call(
        method,
        `/clients/${ids.mine}/tags`,
        people.ownerB,
        { tags: [] },
        ids.firmB,
      );
      expect(res.status).toBe(404);
    }
    expect(
      Names.parse(ok(await call('put', `/clients/${ids.mine}/tags`, people.ownerA, { tags: [] })))
        .tags,
    ).toEqual([]);
  });
});

describe('Leads share the list', () => {
  it('a lead tagged in another case counts on the same tag', async () => {
    const lead = ok(
      await call('post', '/leads', people.ownerA, {
        firstName: 'Pat',
        lastName: `Sample${run}`,
        email: `pat-${run}@example.test`,
        source: 'REFERRAL',
        serviceIds: [ids.service],
      }),
      201,
    ) as { id: string };
    ok(await call('patch', `/leads/${lead.id}`, people.ownerA, { tags: ['back taxes'] }));
    const tags = await list();
    expect(tags.filter((t) => t.name.toLowerCase() === 'back taxes')).toHaveLength(1);
    expect(named(tags, 'Back Taxes')?.leads).toBe(1);
  });
});
