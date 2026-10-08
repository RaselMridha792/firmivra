// End-to-end: R12 step 3, the firm's portal content (contract in packages/types/src/content).
// Everyone at the firm reads the editor's list; Owner and Admin create, edit, publish, unpublish
// and delete (Staff 403). Links are https only; each kind keeps its rules after an edit. Clients
// read published items only; an individual client reads tips only (403 BUSINESS_ONLY for
// resources and links), decided from the client record. Another firm gets 404 and changes
// nothing. Changes are audited with ids, kinds and field names, never the text.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { z } from 'zod';
import {
  ContentItem as ItemShape,
  MyContentItem as MyItemShape,
  OkResponse,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

// Strict copies of the contract's shapes, so a leaked field (businessId, createdByUserId) fails.
const Item = z.strictObject(ItemShape.shape);
const List = z.strictObject({ items: z.array(Item) });
const MyItem = z.strictObject(MyItemShape.shape);
const MyList = z.strictObject({ items: z.array(MyItem) });
type Item = z.infer<typeof Item>;

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r12c-${key}-${run}@r12.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  bizClient: person('client-biz'),
  indClient: person('client-ind'),
  unlinkedClient: person('client-unlinked'),
  ownerB: person('owner-b'),
};
type Person = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', { id: string; slug: string }>;

let app: INestApplication;
const tokens = new Map<string, string>();
let lastViewer = 0;
const newViewer = () => `198.51.${Math.floor(++lastViewer / 250)}.${lastViewer % 250}`;

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
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  who: Person,
  firm: 'a' | 'b' = 'a',
  body?: object,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business/content${path}`)
    .set('x-business-id', firms[firm].id)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`)
    .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`);
  return body === undefined ? req : req.send(body);
}

async function portal(who: Person, query = '', firm: 'a' | 'b' = 'a'): Promise<Response> {
  return request(app.getHttpServer())
    .get(`/api/v1/portal/${firms[firm].slug}/me/content${query}`)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`)
    .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res;
};
const create = async (body: object, who: Person = people.ownerA, firm: 'a' | 'b' = 'a') =>
  Item.parse(ok(await call('post', '', who, firm, body), 201).body);
const publish = async (id: string, who: Person = people.ownerA) =>
  Item.parse(ok(await call('post', `/${id}/publish`, who)).body);
const list = async (query: string, who: Person = people.ownerA, firm: 'a' | 'b' = 'a') =>
  List.parse(ok(await call('get', query, who, firm)).body).items;
const mine = async (who: Person, query = '') =>
  MyList.parse(ok(await portal(who, query)).body).items;
const fetchItem = (id: string) =>
  asOwner({ kind: 'business', businessId: firms.a.id }, (tx) =>
    tx.contentItem.findUnique({ where: { id } }),
  );

const link = (category: string, extra: object = {}) => ({
  kind: 'EXTERNAL_LINK',
  category,
  title: 'IRS Small Business Center (fake)',
  description: 'Synthetic link for tests',
  url: 'https://www.irs.gov/businesses/small-businesses-self-employed',
  iconKey: 'irs',
  ...extra,
});
const tip = (category: string | null, extra: object = {}) => ({
  kind: 'TIP',
  category,
  title: 'Keep receipts (fake)',
  body: 'Keep **every** receipt for seven years.',
  ...extra,
});
const resource = (extra: object = {}) => ({
  kind: 'RESOURCE',
  category: 'payroll',
  title: 'Running payroll (fake)',
  body: '## Steps\n\n- Pay on time\n- File quarterly',
  ...extra,
});

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      const pool = key.toLowerCase().includes('client') ? 'CLIENT' : 'STAFF';
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool, email: p.email, name: `Fake R12c ${key}` },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r12c-${key}-${run}`;
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
  ] as const;
  for (const [businessId, userId, role] of members) {
    await asOwner({ kind: 'business', businessId }, (tx) =>
      tx.membership.create({ data: { businessId, userId, role, status: 'ACTIVE' } }),
    );
  }
  const A = { businessId: firms.a.id };
  await asOwner({ kind: 'business', businessId: firms.a.id }, async (tx) => {
    const biz = await tx.client.create({
      data: { ...A, accountType: 'BUSINESS', displayName: 'Sample Biz LLC (fake)' },
    });
    const ind = await tx.client.create({
      data: { ...A, accountType: 'INDIVIDUAL', displayName: 'Pat Sample (fake)' },
    });
    // The login says BUSINESS but the firm's record says INDIVIDUAL: the record decides.
    await tx.clientAccount.create({
      data: {
        ...A,
        userId: people.indClient.id,
        email: people.indClient.email,
        clientId: ind.id,
        accountType: 'BUSINESS',
        status: 'ACTIVE',
      },
    });
    await tx.clientAccount.create({
      data: {
        ...A,
        userId: people.bizClient.id,
        email: people.bizClient.email,
        clientId: biz.id,
        accountType: 'BUSINESS',
        status: 'ACTIVE',
      },
    });
    // No client record yet: treated as an individual whatever the login says.
    await tx.clientAccount.create({
      data: {
        ...A,
        userId: people.unlinkedClient.id,
        email: people.unlinkedClient.email,
        accountType: 'BUSINESS',
        status: 'ACTIVE',
      },
    });
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

describe('the firm editor: create', () => {
  it('Owner and Admin create drafts of each kind; Staff and clients get 403', async () => {
    const cat = `Create ${run}`;
    const l = await create(link(cat));
    expect(l).toMatchObject({
      kind: 'EXTERNAL_LINK',
      category: cat,
      url: 'https://www.irs.gov/businesses/small-businesses-self-employed',
      iconKey: 'irs',
      body: null,
      sortOrder: 0,
      publishedAt: null,
    });
    const t = await create(tip(cat, { sortOrder: 3 }), people.adminA);
    expect(t).toMatchObject({ kind: 'TIP', url: null, iconKey: null, sortOrder: 3 });
    const r = await create(resource({ description: '' }));
    expect(r).toMatchObject({ kind: 'RESOURCE', category: 'payroll', description: null });
    expect((await fetchItem(l.id))?.createdByUserId).toBe(people.ownerA.id);
    expect((await fetchItem(t.id))?.createdByUserId).toBe(people.adminA.id);

    const staff = await call('post', '', people.staffA, 'a', tip(cat));
    expect([staff.status, codeOf(staff)]).toEqual([403, 'FORBIDDEN']);
    expect((await call('post', '', people.bizClient, 'a', tip(cat))).status).toBe(403);
    expect((await list(`?category=${encodeURIComponent(cat)}`)).map((i) => i.id).sort()).toEqual(
      [l.id, t.id].sort(),
    );
  });

  it('normalizes https links and keeps every kind to its rules (400)', async () => {
    const cat = `Rules ${run}`;
    const normalized = await create(link(cat, { url: 'HTTPS://IRS.GOV/some page' }));
    expect(normalized.url).toBe('https://irs.gov/some%20page');

    const bad: object[] = [
      link(cat, { url: 'http://irs.gov/' }),
      link(cat, { url: 'javascript:alert(1)' }),
      link(cat, { url: 'https://127.0.0.1/' }),
      link(cat, { url: 'https://localhost/' }),
      link(cat, { url: 'https://user:pass@irs.gov/' }),
      link(cat, { body: 'Links have no body' }),
      link(cat, { url: null }),
      link(cat, { iconKey: 'https://evil.example/icon.png' }),
      tip(cat, { body: null }),
      tip(cat, { url: 'https://irs.gov/' }),
      resource({ category: 'not-a-page' }),
      resource({ category: null }),
      resource({ title: '' }),
      resource({ title: 'a\u0000b' }),
      // Half of a surrogate pair: Postgres cannot store it (400, not a 500 from the driver).
      resource({ title: 'Half a pair \ud800' }),
      resource({ body: 'Half a pair \udc00 here' }),
      tip(`Half \ud83d ${run}`),
      link(cat, { description: '\udfff' }),
      resource({ sortOrder: 1001 }),
      resource({ body: 'x'.repeat(20_001) }),
      resource({ businessId: firms.b.id }),
      { kind: 'NOTE', title: 'x', body: 'y' },
      {},
    ];
    for (const body of bad) {
      const res = await call('post', '', people.ownerA, 'a', body);
      expect([res.status, codeOf(res)], JSON.stringify(body)).toEqual([400, 'VALIDATION_FAILED']);
    }
    expect((await list(`?category=${encodeURIComponent(cat)}`)).map((i) => i.id)).toEqual([
      normalized.id,
    ]);
  });
});

describe('the firm editor: list', () => {
  it('everyone at the firm reads drafts and published, by category then sortOrder', async () => {
    const [c1, c2] = [`List 1 ${run}`, `List 2 ${run}`];
    const b2 = await create(tip(c2, { sortOrder: 1 }));
    const a5 = await create(link(c1, { sortOrder: 5 }));
    const a1 = await create(tip(c1, { sortOrder: 1 }));
    await publish(a5.id);
    for (const who of [people.ownerA, people.adminA, people.staffA]) {
      const ids = (await list('', who))
        .filter((i) => i.category === c1 || i.category === c2)
        .map((i) => i.id);
      expect(ids).toEqual([a1.id, a5.id, b2.id]);
    }
    expect((await list(`?kind=TIP&category=${encodeURIComponent(c1)}`)).map((i) => i.id)).toEqual([
      a1.id,
    ]);
    const links = await list('?kind=EXTERNAL_LINK');
    expect(links.every((i) => i.kind === 'EXTERNAL_LINK')).toBe(true);
    expect(links.find((i) => i.id === a5.id)?.publishedAt).not.toBeNull();
    expect((await call('get', '', people.bizClient)).status).toBe(403);
  });

  it('refuses unknown or bad filters (400)', async () => {
    for (const q of [
      '?kind=NOTE',
      '?businessId=x',
      `?category=${'x'.repeat(81)}`,
      '?category=%00',
      '?category=a%01b',
    ]) {
      const res = await call('get', q, people.ownerA);
      expect([res.status, codeOf(res)], q).toEqual([400, 'VALIDATION_FAILED']);
    }
  });
});

describe('the firm editor: update', () => {
  it('changes only what is sent; null clears optional fields', async () => {
    const cat = `Update ${run}`;
    const l = await create(link(cat));
    const res = await call('patch', `/${l.id}`, people.adminA, 'a', {
      title: 'IRS EIN (fake)',
      description: null,
      iconKey: null,
      url: 'https://www.irs.gov/ein',
      sortOrder: 7,
    });
    const updated = Item.parse(ok(res).body);
    expect(updated).toMatchObject({
      title: 'IRS EIN (fake)',
      description: null,
      iconKey: null,
      url: 'https://www.irs.gov/ein',
      sortOrder: 7,
      category: cat,
      kind: 'EXTERNAL_LINK',
    });
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(l.updatedAt));
  });

  it('keeps each kind to its rules after the edit (400) and changes nothing', async () => {
    const l = await create(link(`Update rules ${run}`));
    const r = await create(resource());
    const t = await create(tip(null));
    const bad: [Item, object][] = [
      [l, { body: 'A link has no body' }],
      [l, { url: 'http://irs.gov/' }],
      [l, { kind: 'TIP' }],
      [r, { category: 'not-a-page' }],
      [r, { category: null }],
      [r, { body: '' }],
      [t, { url: 'https://irs.gov/' }],
      [t, {}],
      [t, { iconKey: 'Bad Icon' }],
      [t, { body: 'Half a pair \ud800' }],
      [l, { title: 'Half a pair \udfff' }],
      [r, { category: 'payroll', description: 'x\udc00' }],
    ];
    for (const [item, body] of bad) {
      const res = await call('patch', `/${item.id}`, people.ownerA, 'a', body);
      expect([res.status, codeOf(res)], JSON.stringify(body)).toEqual([400, 'VALIDATION_FAILED']);
    }
    expect(
      Item.parse(
        ok(
          await call('patch', `/${r.id}`, people.ownerA, 'a', {
            category: 'tax-deductions',
          }),
        ).body,
      ).category,
    ).toBe('tax-deductions');
    const row = await fetchItem(l.id);
    expect([row?.body, row?.url]).toEqual([
      null,
      'https://www.irs.gov/businesses/small-businesses-self-employed',
    ]);
  });

  it('Staff get 403; an unknown or malformed id is 404 or 400', async () => {
    const t = await create(tip(null));
    const staff = await call('patch', `/${t.id}`, people.staffA, 'a', { title: 'Staff edit' });
    expect([staff.status, codeOf(staff)]).toEqual([403, 'FORBIDDEN']);
    expect((await fetchItem(t.id))?.title).toBe('Keep receipts (fake)');
    const missing = await call('patch', `/${randomUUID()}`, people.ownerA, 'a', { title: 'X' });
    expect([missing.status, codeOf(missing)]).toEqual([404, 'NOT_FOUND']);
    const malformed = await call('patch', '/not-a-uuid', people.ownerA, 'a', { title: 'X' });
    expect([malformed.status, codeOf(malformed)]).toEqual([400, 'VALIDATION_FAILED']);
  });
});

describe('the firm editor: publish, unpublish and delete', () => {
  it('publishes and unpublishes, both idempotent', async () => {
    const t = await create(tip(null));
    const p1 = await publish(t.id, people.adminA);
    expect(p1.publishedAt).not.toBeNull();
    const p2 = await publish(t.id);
    expect(p2.publishedAt).toBe(p1.publishedAt);
    const u1 = Item.parse(ok(await call('post', `/${t.id}/unpublish`, people.ownerA)).body);
    expect(u1.publishedAt).toBeNull();
    const u2 = Item.parse(ok(await call('post', `/${t.id}/unpublish`, people.adminA)).body);
    expect(u2.publishedAt).toBeNull();
  });

  it('Staff get 403 on publish, unpublish and delete; unknown ids are 404', async () => {
    const t = await create(tip(null));
    for (const [method, path] of [
      ['post', `/${t.id}/publish`],
      ['post', `/${t.id}/unpublish`],
      ['delete', `/${t.id}`],
    ] as const) {
      const res = await call(method, path, people.staffA);
      expect([res.status, codeOf(res)], path).toEqual([403, 'FORBIDDEN']);
      const missing = await call(method, path.replace(t.id, randomUUID()), people.ownerA);
      expect([missing.status, codeOf(missing)], path).toEqual([404, 'NOT_FOUND']);
    }
    expect((await fetchItem(t.id))?.publishedAt).toBeNull();
  });

  it('deletes an item (published or not); a second delete is 404', async () => {
    const t = await create(tip(null));
    await publish(t.id);
    OkResponse.parse(ok(await call('delete', `/${t.id}`, people.adminA)).body);
    expect(await fetchItem(t.id)).toBeNull();
    const again = await call('delete', `/${t.id}`, people.ownerA);
    expect([again.status, codeOf(again)]).toEqual([404, 'NOT_FOUND']);
  });
});

describe('parallel requests', () => {
  const actions = (id: string) =>
    asOwner({ kind: 'business', businessId: firms.a.id }, (tx) =>
      tx.auditLog.findMany({ where: { businessId: firms.a.id, entityId: id } }),
    ).then((rows) => rows.map((r) => r.action).sort());

  it('parallel publishes agree on one publish and one audit row', async () => {
    const t = await create(tip(null, { title: 'Receipts 😀 (fake)' }));
    expect(t.title).toBe('Receipts 😀 (fake)');
    const all = await Promise.all(
      Array.from({ length: 6 }, () => call('post', `/${t.id}/publish`, people.ownerA)),
    );
    const dates = all.map((res) => Item.parse(ok(res).body).publishedAt);
    expect(new Set(dates).size).toBe(1);
    expect(dates[0]).not.toBeNull();
    expect(await actions(t.id)).toEqual(['content.created', 'content.published']);
  });

  it('parallel deletes and edits: one delete wins, the rest are 404, no 500', async () => {
    const t = await create(tip(null));
    const all = await Promise.all([
      call('delete', `/${t.id}`, people.ownerA),
      call('patch', `/${t.id}`, people.adminA, 'a', { title: 'Late edit' }),
      call('delete', `/${t.id}`, people.adminA),
      call('post', `/${t.id}/publish`, people.ownerA),
      call('delete', `/${t.id}`, people.ownerA),
    ]);
    for (const res of all) expect([200, 404], JSON.stringify(res.body)).toContain(res.status);
    const deletes = [all[0], all[2], all[4]].map((res) => res?.status);
    expect(deletes.filter((s) => s === 200)).toHaveLength(1);
    expect(await fetchItem(t.id)).toBeNull();
    expect((await actions(t.id)).filter((a) => a === 'content.deleted')).toHaveLength(1);
  });
});

describe('tenant isolation', () => {
  it('another firm gets 404 on every route and changes nothing', async () => {
    const cat = `Isolation ${run}`;
    const l = await create(link(cat));
    await publish(l.id);
    const before = await fetchItem(l.id);
    for (const [method, path, body] of [
      ['patch', `/${l.id}`, { title: 'Taken over' }],
      ['post', `/${l.id}/publish`, undefined],
      ['post', `/${l.id}/unpublish`, undefined],
      ['delete', `/${l.id}`, undefined],
    ] as const) {
      const res = await call(method, path, people.ownerB, 'b', body);
      expect([res.status, codeOf(res)], path).toEqual([404, 'NOT_FOUND']);
    }
    expect(await fetchItem(l.id)).toEqual(before);
    expect((await list('', people.ownerB, 'b')).map((i) => i.id)).not.toContain(l.id);
    // Firm A's members are not in firm B: 404, never firm B's content.
    expect((await call('get', '', people.ownerA, 'b')).status).toBe(404);
    // Firm B's own item stays out of firm A's lists and portal.
    const theirs = await create(tip(cat), people.ownerB, 'b');
    expect(
      Item.parse(ok(await call('post', `/${theirs.id}/publish`, people.ownerB, 'b')).body)
        .publishedAt,
    ).not.toBeNull();
    expect((await list('')).map((i) => i.id)).not.toContain(theirs.id);
    expect((await mine(people.bizClient)).map((i) => i.id)).not.toContain(theirs.id);
    expect((await call('patch', `/${theirs.id}`, people.ownerA, 'a', { title: 'X' })).status).toBe(
      404,
    );
  });
});

describe('the portal', () => {
  let items: Record<'link' | 'resource' | 'tip' | 'draftTip' | 'draftLink', Item>;
  const cat = `Portal ${run}`;
  beforeAll(async () => {
    items = {
      link: await create(link(cat, { sortOrder: 2 })),
      resource: await create(resource({ category: 'startup-guide' })),
      tip: await create(tip(cat, { sortOrder: 1 })),
      draftTip: await create(tip(cat, { sortOrder: 0 })),
      draftLink: await create(link(cat)),
    };
    for (const key of ['link', 'resource', 'tip'] as const) await publish(items[key].id);
  });

  it('a business client reads every published kind, in order, without dates', async () => {
    const all = await mine(people.bizClient);
    const ids = all.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining([items.link.id, items.resource.id, items.tip.id]));
    expect(ids).not.toContain(items.draftTip.id);
    expect(ids).not.toContain(items.draftLink.id);
    const inCat = await mine(people.bizClient, `?category=${encodeURIComponent(cat)}`);
    expect(inCat.map((i) => i.id)).toEqual([items.tip.id, items.link.id]);
    expect(inCat[1]).toEqual({
      id: items.link.id,
      kind: 'EXTERNAL_LINK',
      category: cat,
      title: items.link.title,
      description: items.link.description,
      body: null,
      url: items.link.url,
      iconKey: 'irs',
      sortOrder: 2,
    });
    const resources = await mine(people.bizClient, '?kind=RESOURCE&category=startup-guide');
    expect(resources.map((i) => i.id)).toContain(items.resource.id);
    expect(resources.every((i) => i.kind === 'RESOURCE')).toBe(true);
    const links = await mine(people.bizClient, '?kind=EXTERNAL_LINK');
    expect(links.map((i) => i.id)).toContain(items.link.id);
    expect(links.every((i) => i.kind === 'EXTERNAL_LINK')).toBe(true);
  });

  it('an individual client (by the client record) reads tips only; 403 BUSINESS_ONLY otherwise', async () => {
    for (const who of [people.indClient, people.unlinkedClient]) {
      const all = await mine(who);
      expect(all.length).toBeGreaterThan(0);
      expect(all.every((i) => i.kind === 'TIP')).toBe(true);
      expect(all.map((i) => i.id)).toContain(items.tip.id);
      expect(all.map((i) => i.id)).not.toContain(items.draftTip.id);
      expect((await mine(who, '?kind=TIP')).map((i) => i.id)).toContain(items.tip.id);
      for (const kind of ['RESOURCE', 'EXTERNAL_LINK']) {
        const res = await portal(who, `?kind=${kind}`);
        expect([res.status, codeOf(res)], kind).toEqual([403, 'BUSINESS_ONLY']);
      }
    }
  });

  it('an unpublished item disappears from the portal at once', async () => {
    ok(await call('post', `/${items.tip.id}/unpublish`, people.ownerA));
    expect((await mine(people.bizClient)).map((i) => i.id)).not.toContain(items.tip.id);
    expect((await mine(people.indClient)).map((i) => i.id)).not.toContain(items.tip.id);
    await publish(items.tip.id);
  });

  it('refuses bad queries, staff sessions and another firm', async () => {
    for (const q of ['?kind=NOTE', '?clientId=x', '?category=%00', '?kind=TIP&category=a%00b']) {
      const res = await portal(people.bizClient, q);
      expect([res.status, codeOf(res)], q).toEqual([400, 'VALIDATION_FAILED']);
    }
    expect((await portal(people.ownerA)).status).toBe(401);
    expect((await portal(people.bizClient, '', 'b')).status).toBe(404);
  });
});

describe('audit', () => {
  it('logs every change with the id, kind and field names, never the text', async () => {
    const secret = `Secret-ish ${run}`;
    const l = await create(link(`Audit ${run}`, { title: secret, description: secret }));
    ok(await call('patch', `/${l.id}`, people.ownerA, 'a', { description: `${secret} 2` }));
    await publish(l.id);
    ok(await call('post', `/${l.id}/unpublish`, people.ownerA));
    ok(await call('delete', `/${l.id}`, people.ownerA));
    const rows = await asOwner({ kind: 'business', businessId: firms.a.id }, (tx) =>
      tx.auditLog.findMany({ where: { businessId: firms.a.id, entityId: l.id } }),
    );
    expect(rows.map((r) => r.action).sort()).toEqual([
      'content.created',
      'content.deleted',
      'content.published',
      'content.unpublished',
      'content.updated',
    ]);
    expect(rows.every((r) => r.entityType === 'content_item')).toBe(true);
    expect(rows.every((r) => r.actorUserId === people.ownerA.id)).toBe(true);
    expect(rows.find((r) => r.action === 'content.updated')?.metadata).toEqual({
      kind: 'EXTERNAL_LINK',
      fields: ['description'],
    });
    const metadata = JSON.stringify(rows.map((r) => r.metadata));
    expect(metadata).not.toContain('Secret-ish');
    expect(metadata).not.toContain('irs.gov');
  });
});
