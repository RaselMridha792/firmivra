// End-to-end: R55, Communications (contract in packages/types/src/communications), the segments,
// lists and consent step: the criteria catalog, dynamic segments counted each time, saved lists,
// masked members, archiving, and consent. Staff reach only the clients assigned to them; a reader
// cannot change anything; firm B sees none of firm A's. No audit row holds an address or a name.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  ConsentView,
  SegmentDetail,
  SegmentFieldList,
  SegmentMemberPage,
  SegmentPage,
  SegmentPreview,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55c-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  staffA: person('staff-a'),
  readerA: person('reader-a'),
  ownerB: person('owner-b'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', string>;
const clients = {} as Record<'c1' | 'c2' | 'c3' | 'cB', string>;

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.59.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

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
    [method](`/api/v1/business/communications${path}`)
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
const { ownerA, staffA, readerA, ownerB } = people;

const seg = async (id: string, who: Who = ownerA) =>
  SegmentDetail.parse(ok(await call('get', `/segments/${id}`, who)));
const dynamic = (over: object = {}, who: Who = ownerA) =>
  call('post', '/segments', who, {
    name: mark('Active'),
    type: 'DYNAMIC',
    audience: 'CLIENTS',
    criteria: { conditions: [{ field: 'client.status', op: 'IS', value: 'ACTIVE' }] },
    ...over,
  });
const auditRows = (entityId: string) =>
  inFirm('a', (tx) =>
    tx.auditLog.findMany({
      where: { entityId },
      select: { action: true, metadata: true },
      orderBy: { createdAt: 'asc' },
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
          name: `Fake R55c ${key}`,
        },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r55c-${key}-${run}`;
      firms[key] = (
        await tx.business.create({
          data: { slug, name: `Firm ${slug}`, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
  });
  for (const [firm, userId, role] of [
    ['a', ownerA.id, 'OWNER'],
    ['a', staffA.id, 'STAFF'],
    ['a', readerA.id, 'TAX_PREPARER'],
    ['b', ownerB.id, 'OWNER'],
  ] as const) {
    await inFirm(firm, (tx) =>
      tx.membership.create({ data: { businessId: firms[firm], userId, role, status: 'ACTIVE' } }),
    );
  }
  await inFirm('a', async (tx) => {
    const businessId = firms.a;
    const client = async (key: 'c1' | 'c2' | 'c3', name: string, over: object = {}) => {
      clients[key] = (
        await tx.client.create({
          data: { businessId, displayName: name, email: `${key}-${run}@client.test`, ...over },
          select: { id: true },
        })
      ).id;
    };
    await client('c1', 'Jamie Sample (fake)', { status: 'ACTIVE', assignedUserId: staffA.id });
    await client('c2', 'Riley Example (fake)', { status: 'ACTIVE' });
    await client('c3', 'Casey Planner (fake)', { status: 'ON_HOLD', assignedUserId: staffA.id });
  });
  await inFirm('b', async (tx) => {
    clients.cB = (
      await tx.client.create({
        data: { businessId: firms.b, displayName: 'Firm B client (fake)', status: 'ACTIVE' },
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
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('segments', () => {
  it('serves the criteria catalog, narrowed by audience', async () => {
    const all = SegmentFieldList.parse(ok(await call('get', '/segments/fields', ownerA)));
    expect(all.items.map((f) => f.field)).toContain('client.status');
    expect(all.items.map((f) => f.field)).toContain('lead.status');
    ok(await call('get', '/segments/fields', readerA));
    expectError(await call('get', '/segments/fields', undefined), 401, 'UNAUTHENTICATED');
  });

  it('counts a dynamic segment each time, within the caller’s reach', async () => {
    const made = SegmentDetail.parse(ok(await dynamic(), 201));
    expect(made.type).toBe('DYNAMIC');
    expect(made.memberCount).toBe(3 - 1); // c1 and c2 are ACTIVE, c3 is ON_HOLD
    expect(made.criteriaSummary).toMatch(/Client status/);
    // Staff reach only c1 of the two.
    expect((await seg(made.id, staffA)).memberCount).toBe(1);
    // A new active client appears in the next read.
    await inFirm('a', (tx) =>
      tx.client.create({
        data: {
          businessId: firms.a,
          displayName: 'Later Client (fake)',
          email: `later-${run}@client.test`,
          status: 'ACTIVE',
        },
      }),
    );
    expect((await seg(made.id)).memberCount).toBe(3);
    const rows = await auditRows(made.id);
    expect(rows.map((r) => r.action)).toEqual(['communication_segment.created']);
    expect(JSON.stringify(rows)).not.toMatch(/client\.test|Jamie|Riley/);
  });

  it('refuses criteria the catalog does not offer, and a name already used', async () => {
    expectError(
      await dynamic({ criteria: { conditions: [{ field: 'client.ssn', op: 'IS', value: 'x' }] } }),
      400,
      'INVALID_CRITERIA',
    );
    expectError(
      await dynamic({
        criteria: { conditions: [{ field: 'client.status', op: 'CONTAINS', value: 'ACT' }] },
      }),
      400,
      'INVALID_CRITERIA',
    );
    expectError(
      await dynamic({
        criteria: { conditions: [{ field: 'client.status', op: 'IS', value: 'NOPE' }] },
      }),
      400,
      'INVALID_CRITERIA',
    );
    expectError(await dynamic({ audience: 'LEADS' }), 400, 'INVALID_CRITERIA');
    const name = mark('Same');
    ok(await dynamic({ name }), 201);
    expectError(await dynamic({ name: name.toUpperCase() }), 409, 'DUPLICATE_NAME');
    expect((await call('post', '/segments', ownerA, { name: 'x', type: 'DYNAMIC' })).status).toBe(
      400,
    );
    expect(
      (await call('post', '/segments', ownerA, { name: 'x', type: 'STATIC', criteria: {} })).status,
    ).toBe(400);
  });

  it('updates with an etag, and a stale save is refused', async () => {
    const made = SegmentDetail.parse(ok(await dynamic(), 201));
    const changed = SegmentDetail.parse(
      ok(
        await call('patch', `/segments/${made.id}`, ownerA, {
          etag: made.etag,
          criteria: { conditions: [{ field: 'client.status', op: 'IS', value: 'ON_HOLD' }] },
        }),
      ),
    );
    expect(changed.memberCount).toBe(1);
    expectError(
      await call('patch', `/segments/${made.id}`, ownerA, { etag: made.etag, description: 'x' }),
      409,
      'SAVE_CONFLICT',
    );
  });

  it('lists with filters and pages', async () => {
    const name = mark('Findable');
    ok(await dynamic({ name }), 201);
    const found = SegmentPage.parse(
      ok(await call('get', `/segments?search=${encodeURIComponent(name)}`, ownerA)),
    );
    expect(found.items.map((s) => s.name)).toEqual([name]);
    expect(
      SegmentPage.parse(ok(await call('get', '/segments?type=STATIC&pageSize=2', ownerA))).pageSize,
    ).toBe(2);
    expect((await call('get', '/segments?bogus=1', ownerA)).status).toBe(400);
  });

  it('previews criteria without saving, with masked samples', async () => {
    const before = SegmentPage.parse(ok(await call('get', '/segments', ownerA))).total;
    const p = SegmentPreview.parse(
      ok(
        await call('post', '/segments/preview', ownerA, {
          audience: 'CLIENTS',
          criteria: {
            conditions: [{ field: 'client.status', op: 'IS_ANY_OF', value: ['ACTIVE', 'ON_HOLD'] }],
          },
          sample: 2,
        }),
      ),
    );
    expect(p.count).toBeGreaterThanOrEqual(3);
    expect(p.sample).toHaveLength(2);
    for (const s of p.sample) expect(s.secondary).toMatch(/^.\*\*\*@/);
    expect(SegmentPage.parse(ok(await call('get', '/segments', ownerA))).total).toBe(before);
  });

  it('keeps a saved list, replaces its members, and masks them', async () => {
    const made = SegmentDetail.parse(
      ok(
        await call('post', '/segments', ownerA, {
          name: mark('List'),
          type: 'STATIC',
          clientIds: [clients.c1, clients.c2, clients.c1],
        }),
        201,
      ),
    );
    expect(made.memberCount).toBe(2);
    expect(made.criteria).toBeNull();
    const members = SegmentMemberPage.parse(
      ok(await call('get', `/segments/${made.id}/members`, ownerA)),
    );
    expect(members.items.map((m) => m.label)).toEqual([
      'Jamie Sample (fake)',
      'Riley Example (fake)',
    ]);
    expect(members.items[0]?.secondary).toMatch(/^c\*\*\*@client\.test$/);
    // Staff see only the member assigned to them.
    expect(
      SegmentMemberPage.parse(ok(await call('get', `/segments/${made.id}/members`, staffA))).total,
    ).toBe(1);
    const replaced = SegmentDetail.parse(
      ok(
        await call('put', `/segments/${made.id}/members`, ownerA, {
          clientIds: [clients.c3],
          etag: made.etag,
        }),
      ),
    );
    expect(replaced.memberCount).toBe(1);
    // A client of another firm cannot be named.
    expect(
      (
        await call('put', `/segments/${made.id}/members`, ownerA, {
          clientIds: [clients.cB],
          etag: replaced.etag,
        })
      ).status,
    ).toBe(400);
    // A dynamic segment has no members to set by hand.
    const dyn = SegmentDetail.parse(ok(await dynamic(), 201));
    expect(
      (await call('put', `/segments/${dyn.id}/members`, ownerA, { clientIds: [], etag: dyn.etag }))
        .status,
    ).toBe(400);
  });

  it('duplicates, archives and restores', async () => {
    const made = SegmentDetail.parse(ok(await dynamic(), 201));
    const copy = SegmentDetail.parse(
      ok(await call('post', `/segments/${made.id}/duplicate`, ownerA), 201),
    );
    expect(copy.name).toBe(`${made.name} (copy)`);
    expect(copy.id).not.toBe(made.id);
    expect(
      SegmentDetail.parse(ok(await call('post', `/segments/${made.id}/archive`, ownerA))).archived,
    ).toBe(true);
    const archived = SegmentPage.parse(ok(await call('get', '/segments?archived=true', ownerA)));
    expect(archived.items.map((s) => s.id)).toContain(made.id);
    const live = SegmentPage.parse(
      ok(await call('get', `/segments?search=${encodeURIComponent(made.name)}`, ownerA)),
    );
    expect(live.items.map((s) => s.id)).not.toContain(made.id);
    expect(
      SegmentDetail.parse(ok(await call('post', `/segments/${made.id}/restore`, ownerA))).archived,
    ).toBe(false);
  });

  it('will not archive a segment a scheduled communication uses', async () => {
    const made = SegmentDetail.parse(ok(await dynamic(), 201));
    await inFirm('a', async (tx) => {
      const c = await tx.communication.create({
        data: {
          businessId: firms.a,
          channel: 'EMAIL',
          name: 'Scheduled (fake)',
          status: 'SCHEDULED',
          createdByUserId: ownerA.id,
          scheduledFor: new Date(Date.now() + 86_400_000),
          timezone: 'America/New_York',
        },
      });
      await tx.communicationAudienceEntry.create({
        data: { businessId: firms.a, communicationId: c.id, kind: 'SEGMENT', segmentId: made.id },
      });
    });
    expectError(await call('post', `/segments/${made.id}/archive`, ownerA), 409, 'SEGMENT_IN_USE');
  });

  it('lets a reader read and nothing more', async () => {
    const made = SegmentDetail.parse(ok(await dynamic(), 201));
    ok(await call('get', '/segments', readerA));
    ok(await call('get', `/segments/${made.id}`, readerA));
    expectError(await dynamic({}, readerA), 403, 'FORBIDDEN');
    expectError(
      await call('patch', `/segments/${made.id}`, readerA, { etag: made.etag, description: 'x' }),
      403,
      'FORBIDDEN',
    );
    expectError(await call('post', `/segments/${made.id}/archive`, readerA), 403, 'FORBIDDEN');
  });

  it('shows firm B nothing of firm A', async () => {
    const made = SegmentDetail.parse(ok(await dynamic(), 201));
    expectError(
      await call('get', `/segments/${made.id}`, ownerB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call(
        'patch',
        `/segments/${made.id}`,
        ownerB,
        { etag: made.etag, description: 'x' },
        'b',
      ),
      404,
      'NOT_FOUND',
    );
    expect(
      SegmentPage.parse(ok(await call('get', '/segments', ownerB, undefined, 'b'))).items,
    ).toHaveLength(0);
    expectError(await call('get', `/segments/${randomUUID()}`, ownerA), 404, 'NOT_FOUND');
  });
});

describe('consent', () => {
  it('records a standing on a channel and reads it back', async () => {
    expect(
      ConsentView.parse(ok(await call('get', `/consent?clientId=${clients.c1}`, ownerA))).items,
    ).toHaveLength(0);
    const set = ConsentView.parse(
      ok(
        await call('put', '/consent', ownerA, {
          clientId: clients.c1,
          channel: 'EMAIL',
          status: 'OPTED_OUT',
          reason: 'Asked on the phone',
        }),
      ),
    );
    expect(set.items).toHaveLength(1);
    expect(set.items[0]).toMatchObject({ channel: 'EMAIL', status: 'OPTED_OUT', source: 'staff' });
    const again = ConsentView.parse(
      ok(
        await call('put', '/consent', ownerA, {
          clientId: clients.c1,
          channel: 'EMAIL',
          status: 'OPTED_IN',
        }),
      ),
    );
    expect(again.items[0]?.status).toBe('OPTED_IN');
    const rows = await auditRows(clients.c1);
    expect(rows.map((r) => r.action)).toEqual([
      'communication_consent.set',
      'communication_consent.set',
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/phone|client\.test/);
  });

  it('reaches only the caller’s contacts, and only for those who may change', async () => {
    const c2 = { clientId: clients.c2, channel: 'SMS', status: 'OPTED_OUT' };
    expectError(await call('put', '/consent', staffA, c2), 404, 'NOT_FOUND');
    expectError(await call('get', `/consent?clientId=${clients.c2}`, staffA), 404, 'NOT_FOUND');
    expectError(await call('put', '/consent', readerA, c2), 403, 'FORBIDDEN');
    expectError(await call('put', '/consent', ownerB, c2, 'b'), 404, 'NOT_FOUND');
    expect(
      (await call('put', '/consent', ownerA, { channel: 'SMS', status: 'OPTED_OUT' })).status,
    ).toBe(400);
    expect((await call('put', '/consent', ownerA, { ...c2, channel: 'ANNOUNCEMENT' })).status).toBe(
      400,
    );
    expect((await call('get', '/consent', ownerA)).status).toBe(400);
  });
});
