// End-to-end: R12 step 4, the audit log viewer (contract in packages/types/src/audit-log). The
// firm's Owner and Admins read their own firm's log, newest first, with filters and keyset
// paging; Staff and clients get 403. A Super Admin shows only as "Firmivra Support" without an IP;
// the user agent and other firms' rows never appear. The first page of each read is audited with
// the filters. The Super Admin route answers 403 SUPPORT_GRANT_REQUIRED until R8.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, type Prisma, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { type AuditEntry, AuditLogPage } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r12al-${key}-${run}@r12al.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  clientA: person('client-a'),
  ownerB: person('owner-b'),
  stranger: person('stranger'),
  admin2: person('admin2'),
};
const firms = {} as Record<'a' | 'b', { id: string; slug: string }>;
const DELETED_USER_ID = randomUUID();
const USER_AGENT = `SecretAgent/9.9 r12al-${run}`;
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

let app: INestApplication;
const tokens = new Map<string, string>();
let viewerSeq = 0;
const newViewer = () => `198.18.${(viewerSeq >> 8) & 255}.${viewerSeq++ & 255}`;

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

async function call(
  query: string,
  who: { email: string } | null,
  firm: 'a' | 'b' = 'a',
  viewer = newViewer(),
): Promise<Response> {
  const req = request(app.getHttpServer())
    .get(`/api/v1/business/audit-log${query}`)
    .set('x-business-id', firms[firm].id)
    .set('x-forwarded-for', `${viewer}, 10.0.0.5`);
  return who ? req.set('authorization', `Bearer ${await tokenFor(who.email)}`) : req;
}

const asOwner = async (query: string, firm: 'a' | 'b' = 'a') => {
  const res = await call(query, firm === 'a' ? people.ownerA : people.ownerB, firm);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return AuditLogPage.parse(res.body);
};

/** Every page of a read, following nextCursor. */
async function all(query: string, limit = 100, firm: 'a' | 'b' = 'a'): Promise<AuditEntry[]> {
  const items: AuditEntry[] = [];
  let cursor: string | null = null;
  const sep = query ? '&' : '?';
  do {
    const c: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const page = await asOwner(`${query}${sep}limit=${limit}${c}`, firm);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;

const owner = () => createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);

/** Rows written straight into a firm's log (as other modules write them). */
async function seed(businessId: string, rows: Prisma.AuditLogCreateManyInput[]): Promise<void> {
  const db = owner();
  await runInScope(db, { kind: 'business', businessId }, (tx) =>
    tx.auditLog.createMany({ data: rows.map((r) => ({ ...r, businessId })) }),
  );
  await db.$disconnect();
}

async function viewedRows(businessId: string) {
  const db = owner();
  const rows = await runInScope(db, { kind: 'business', businessId }, (tx) =>
    tx.auditLog.findMany({ where: { businessId, action: 'audit_log.viewed' } }),
  );
  await db.$disconnect();
  return rows;
}

const now = Date.now();
const at = (msAgo: number) => new Date(now - msAgo);

beforeAll(async () => {
  const db = owner();
  await runInScope(db, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      const pool = key === 'clientA' ? 'CLIENT' : key === 'admin2' ? 'ADMIN' : 'STAFF';
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool, email: p.email, name: `Fake R12 ${key}` },
      });
    }
    await tx.platformAdmin.create({ data: { userId: people.admin2.id } });
    for (const key of ['a', 'b'] as const) {
      const slug = `r12al-${key}-${run}`;
      firms[key] = await tx.business.create({
        data: { slug, name: slug, status: 'ACTIVE' },
        select: { id: true, slug: true },
      });
    }
    // The fixture Super Admin asked firm A for support access (R8 approves and uses it later).
    await tx.supportAccessGrant.create({
      data: { businessId: firms.a.id, adminUserId: fx.users.admin.id, reason: 'Fake request' },
    });
  });
  const members = [
    [firms.a.id, people.ownerA.id, 'OWNER'],
    [firms.a.id, people.adminA.id, 'ADMIN'],
    [firms.a.id, people.staffA.id, 'STAFF'],
    [firms.b.id, people.ownerB.id, 'OWNER'],
  ] as const;
  for (const [businessId, userId, role] of members) {
    await runInScope(db, { kind: 'business', businessId }, (tx) =>
      tx.membership.create({ data: { businessId, userId, role, status: 'ACTIVE' } }),
    );
  }
  await runInScope(db, { kind: 'business', businessId: firms.a.id }, (tx) =>
    tx.clientAccount.create({
      data: {
        businessId: firms.a.id,
        userId: people.clientA.id,
        email: people.clientA.email,
        status: 'ACTIVE',
      },
    }),
  );
  await db.$disconnect();

  const common = { userAgent: USER_AGENT, entityType: 'rtest_thing' };
  await seed(firms.a.id, [
    {
      ...common,
      action: 'rtest.created',
      actorUserId: people.staffA.id,
      entityId: 'thing-1',
      metadata: { fields: ['title'] },
      ip: '203.0.113.10',
      requestId: 'req-a-1',
      createdAt: at(1 * HOUR),
    },
    {
      ...common,
      action: 'rtest.updated',
      actorUserId: people.clientA.id,
      entityId: 'thing-1',
      ip: '203.0.113.11',
      createdAt: at(2 * HOUR),
    },
    {
      ...common,
      action: 'rtest.support_read',
      actorUserId: fx.users.admin.id,
      entityId: 'thing-2',
      ip: '198.51.100.7',
      createdAt: at(3 * HOUR),
    },
    {
      ...common,
      action: 'rtest.system',
      actorUserId: null,
      entityId: null,
      ip: '203.0.113.12',
      createdAt: at(4 * HOUR),
    },
    {
      ...common,
      action: 'rtest.stranger',
      actorUserId: people.stranger.id,
      entityId: 'thing-3',
      ip: '203.0.113.13',
      createdAt: at(5 * HOUR),
    },
    {
      ...common,
      action: 'rtest.admin_no_grant',
      actorUserId: people.admin2.id,
      entityId: 'thing-3',
      ip: '198.51.100.8',
      createdAt: at(5 * HOUR + 1000),
    },
    // A login that no longer exists (R3 deletes a replaced sign-up login): no user row at all.
    {
      ...common,
      action: 'rtest.deleted_user',
      actorUserId: DELETED_USER_ID,
      entityId: 'thing-3',
      ip: '203.0.113.15',
      createdAt: at(5 * HOUR + 2000),
    },
    {
      ...common,
      action: 'rtest.old',
      actorUserId: people.ownerA.id,
      entityId: 'thing-old',
      ip: '203.0.113.14',
      createdAt: at(40 * DAY),
    },
    { ...common, action: 'r_test.thing', entityType: 'other_thing', createdAt: at(6 * HOUR) },
    { ...common, action: 'rxtest.thing', entityType: 'other_thing', createdAt: at(6 * HOUR) },
    // Seven rows at the very same moment: paging breaks the tie by id.
    ...Array.from({ length: 7 }, () => ({
      ...common,
      action: 'rpage.same',
      entityType: 'page_thing',
      createdAt: at(7 * HOUR),
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      ...common,
      action: 'rpage.spread',
      entityType: 'page_thing',
      createdAt: at(8 * HOUR + i * 1000),
    })),
  ]);
  await seed(firms.b.id, [
    {
      ...common,
      action: 'rtest.created',
      actorUserId: people.ownerB.id,
      entityId: 'thing-1',
      ip: '203.0.113.99',
      requestId: 'req-firm-b',
      createdAt: at(1 * HOUR),
    },
    // Two pages of one row for firm B, so it gets a cursor to try on firm A.
    ...Array.from({ length: 2 }, () => ({
      ...common,
      action: 'rpage.firm_b',
      entityType: 'page_thing',
      requestId: 'req-firm-b-page',
      createdAt: at(7 * HOUR),
    })),
  ]);
  // Platform rows (no firm: staff and Super Admin sign-ins, sign-up counters), here even with
  // firm A's staff member, record and request id: never in any firm's log.
  const platform = owner();
  await runInScope(platform, { kind: 'platform' }, (tx) =>
    tx.auditLog.createMany({
      data: [
        {
          ...common,
          businessId: null,
          action: 'rtest.platform',
          actorUserId: people.staffA.id,
          entityId: 'thing-1',
          ip: '203.0.113.77',
          requestId: 'req-platform',
          createdAt: at(30 * 60_000),
        },
      ],
    }),
  );
  await platform.$disconnect();

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

describe('who reads the log', () => {
  it('Owner and Admin read it; Staff and clients 403; signed out 401', async () => {
    for (const who of [people.ownerA, people.adminA]) {
      const res = await call('?action=rtest.created', who);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(AuditLogPage.parse(res.body).items.map((i) => i.action)).toEqual(['rtest.created']);
    }
    for (const who of [people.staffA, people.clientA]) {
      const res = await call('', who);
      expect([res.status, codeOf(res)]).toEqual([403, 'FORBIDDEN']);
    }
    expect((await call('', null)).status).toBe(401);
  });

  it('a Super Admin session never opens a firm route (401)', async () => {
    const res = await call('', fx.users.admin);
    expect(res.status).toBe(401);
  });

  it("another firm gets 404 for this firm's log and never sees its rows", async () => {
    const res = await call('', people.ownerB, 'a');
    expect([res.status, codeOf(res)]).toEqual([404, 'NOT_FOUND']);

    const b = await asOwner('?entityType=rtest_thing', 'b');
    expect(b.items.map((i) => i.requestId)).toEqual(['req-firm-b']);
    const a = await all('?entityType=rtest_thing');
    expect(a.map((i) => i.requestId)).not.toContain('req-firm-b');
    expect(JSON.stringify(a)).not.toContain(people.ownerB.id);
  });

  it('never shows a platform row (no firm), by any filter', async () => {
    const from = new Date(now - 60 * DAY).toISOString();
    const to = new Date(now + HOUR).toISOString();
    for (const q of [
      '',
      '?action=rtest.platform',
      '?action=rtest.',
      `?actorUserId=${people.staffA.id}`,
      '?entityType=rtest_thing&entityId=thing-1',
      `?from=${from}&to=${to}`,
    ]) {
      for (const firm of ['a', 'b'] as const) {
        const rows = await all(q, 100, firm);
        expect(
          rows.map((r) => r.action),
          `${firm} ${q}`,
        ).not.toContain('rtest.platform');
        expect(JSON.stringify(rows), `${firm} ${q}`).not.toMatch(/req-platform|203\.0\.113\.77/);
      }
    }
  });
});

describe('what a row shows', () => {
  it('never the user agent or the firm id; the contract shape exactly', async () => {
    const res = await call('?entityType=rtest_thing', people.ownerA);
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('SecretAgent');
    expect(text).not.toMatch(/userAgent|user_agent|businessId/);
    expect(text).not.toContain(firms.a.id);
    const items = (res.body as { items: Record<string, unknown>[] }).items;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(
        ['action', 'actor', 'at', 'entity', 'id', 'ip', 'metadata', 'requestId'].sort(),
      );
      expect(Object.keys(item['entity'] as object).sort()).toEqual(['id', 'type']);
      if (item['actor'] !== null) {
        expect(Object.keys(item['actor'] as object).sort()).toEqual(['kind', 'name', 'userId']);
      }
    }
  });

  it('names staff and clients, hides Super Admins as Firmivra Support without IP', async () => {
    const rows = await all('?action=rtest.');
    const by = (action: string) => {
      const row = rows.find((r) => r.action === action);
      expect(row, action).toBeDefined();
      return row as AuditEntry;
    };
    expect(by('rtest.created')).toMatchObject({
      actor: { kind: 'STAFF', userId: people.staffA.id, name: 'Fake R12 staffA' },
      entity: { type: 'rtest_thing', id: 'thing-1' },
      metadata: { fields: ['title'] },
      ip: '203.0.113.10',
      requestId: 'req-a-1',
    });
    expect(by('rtest.updated')).toMatchObject({
      actor: { kind: 'CLIENT', userId: people.clientA.id, name: 'Fake R12 clientA' },
      metadata: {},
      ip: '203.0.113.11',
      requestId: null,
    });
    expect(by('rtest.support_read')).toMatchObject({
      actor: { kind: 'PLATFORM', userId: null, name: 'Firmivra Support' },
      ip: null,
    });
    expect(by('rtest.system')).toMatchObject({ actor: null, ip: '203.0.113.12' });
    // Not linked to the firm: the firm cannot tell who it was, so neither person nor IP.
    expect(by('rtest.stranger')).toMatchObject({ actor: null, ip: null });
    expect(by('rtest.admin_no_grant')).toMatchObject({ actor: null, ip: null });
    expect(by('rtest.deleted_user')).toMatchObject({ actor: null, ip: null });
    const text = JSON.stringify(rows);
    for (const hidden of [
      fx.users.admin.id,
      people.admin2.id,
      people.stranger.id,
      DELETED_USER_ID,
      '198.51.100.7',
      '198.51.100.8',
      '203.0.113.13',
      '203.0.113.15',
    ]) {
      expect(text).not.toContain(hidden);
    }
  });
});

describe('filters', () => {
  it('the last 30 days by default; a range of up to 366 days on request', async () => {
    expect((await all('?action=rtest.')).map((r) => r.action)).not.toContain('rtest.old');
    const from = new Date(now - 60 * DAY).toISOString();
    const to = new Date(now + HOUR).toISOString();
    const ranged = await all(`?action=rtest.&from=${from}&to=${to}`);
    expect(ranged.map((r) => r.action)).toContain('rtest.old');
    const narrow = await all(
      `?from=${new Date(now - 41 * DAY).toISOString()}&to=${new Date(now - 39 * DAY).toISOString()}`,
    );
    expect(narrow.map((r) => r.action)).toEqual(['rtest.old']);
  });

  it('an action exactly or by prefix (LIKE wildcards are plain)', async () => {
    expect((await all('?action=rtest.updated')).map((r) => r.action)).toEqual(['rtest.updated']);
    expect((await all('?action=rtest')).length).toBe(0);
    const prefixed = (await all('?action=rtest.')).map((r) => r.action);
    expect(prefixed).toEqual(
      expect.arrayContaining(['rtest.created', 'rtest.updated', 'rtest.system']),
    );
    expect(prefixed.every((a) => a.startsWith('rtest.'))).toBe(true);
    expect((await all('?action=r_test.')).map((r) => r.action)).toEqual(['r_test.thing']);
  });

  it('by person, record type and record id', async () => {
    expect((await all(`?actorUserId=${people.staffA.id}`)).map((r) => r.action)).toEqual([
      'rtest.created',
    ]);
    const thing1 = await all('?entityType=rtest_thing&entityId=thing-1');
    expect(thing1.map((r) => r.action)).toEqual(['rtest.created', 'rtest.updated']);
    expect((await all('?entityType=other_thing')).map((r) => r.action).sort()).toEqual([
      'r_test.thing',
      'rxtest.thing',
    ]);
    // Only the firm's own people: a Super Admin's or a stranger's id finds nothing, so the
    // filter never confirms that an id acted here.
    for (const id of [
      fx.users.admin.id,
      people.admin2.id,
      people.stranger.id,
      people.ownerB.id,
      DELETED_USER_ID,
    ]) {
      expect(await all(`?actorUserId=${id}`), id).toHaveLength(0);
    }
  });

  it('refuses a bad query with 400 VALIDATION_FAILED', async () => {
    const day = (d: number) => new Date(now - d * DAY).toISOString();
    for (const q of [
      `?from=${day(1)}`,
      `?to=${day(1)}`,
      `?from=${day(1)}&to=${day(2)}`,
      `?from=${day(400)}&to=${day(0)}`,
      '?from=yesterday&to=today',
      '?action=Client.Created',
      '?action=client..created',
      '?action=client%00.',
      `?action=${'a'.repeat(81)}`,
      '?actorUserId=not-a-uuid',
      '?entityType=Client',
      '?entityId=abc%00def',
      '?entityId=line%0Abreak',
      `?entityId=${'x'.repeat(101)}`,
      '?limit=0',
      '?limit=101',
      '?limit=ten',
      '?limit=5&limit=6',
      '?action=a.&action=b.',
      '?businessId=' + firms.b.id,
      '?cursor=not-a-cursor',
      `?cursor=${'x'.repeat(201)}`,
      `?cursor=${Buffer.from(`-100000-01-01T00:00:00.000Z|${randomUUID()}`).toString('base64url')}`,
      `?cursor=${Buffer.from(`2026-10-01T00:00:00.000Z|${randomUUID()}\u0000`).toString('base64url')}`,
      '?cursor=abc%00',
    ]) {
      const res = await call(q, people.ownerA);
      expect([res.status, codeOf(res)], q).toEqual([400, 'VALIDATION_FAILED']);
    }
  });

  it('takes the year 0000 range without a 500', async () => {
    const res = await call('?from=0000-01-01T00:00:00Z&to=0000-12-31T00:00:00Z', people.ownerA);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(AuditLogPage.parse(res.body).items).toEqual([]);
  });
});

describe('paging', () => {
  it('newest first, every row once, ties broken by id', async () => {
    const whole = await all('?action=rpage.', 100);
    expect(whole).toHaveLength(11);
    const paged = await all('?action=rpage.', 2);
    expect(paged.map((r) => r.id)).toEqual(whole.map((r) => r.id));
    expect(new Set(paged.map((r) => r.id)).size).toBe(11);
    for (let i = 1; i < whole.length; i++) {
      const [prev, cur] = [whole[i - 1] as AuditEntry, whole[i] as AuditEntry];
      const order = Date.parse(prev.at) - Date.parse(cur.at) || (prev.id > cur.id ? 1 : -1);
      expect(order).toBeGreaterThan(0);
    }
  });

  it('defaults to 50 a page; nextCursor null on the last page', async () => {
    const page = await asOwner('?action=rpage.');
    expect(page.items).toHaveLength(11);
    expect(page.nextCursor).toBeNull();
    const first = await asOwner('?action=rpage.&limit=10');
    expect(first.items).toHaveLength(10);
    expect(first.nextCursor).not.toBeNull();
  });
});

describe('cursors', () => {
  const firstCursor = async (query: string, who: { email: string }, firm: 'a' | 'b' = 'a') => {
    const res = await call(query, who, firm);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const cursor = AuditLogPage.parse(res.body).nextCursor;
    expect(cursor).not.toBeNull();
    return cursor as string;
  };
  const withCursor = (query: string, cursor: string) =>
    `${query}&cursor=${encodeURIComponent(cursor)}`;

  it('work only for the firm, the reader and the filters they were given for', async () => {
    const q = '?action=rpage.&limit=1';
    const fromB = await firstCursor(q, people.ownerB, 'b');
    const own = await firstCursor(q, people.ownerA);
    expect((await call(withCursor(q, own), people.ownerA)).status).toBe(200);
    for (const [query, cursor, who] of [
      [q, fromB, people.ownerA],
      [q, own, people.adminA],
      ['?action=rpage.same&limit=1', own, people.ownerA],
      ['?action=rpage.&entityType=page_thing&limit=1', own, people.ownerA],
    ] as const) {
      const res = await call(withCursor(query, cursor), who);
      expect([res.status, codeOf(res)], query).toEqual([400, 'VALIDATION_FAILED']);
      expect(JSON.stringify(res.body)).not.toMatch(/req-firm-b|rpage/);
    }
  });

  it('a made-up or changed cursor is refused, so no read skips audit_log.viewed', async () => {
    const before = (await viewedRows(firms.a.id)).length;
    const own = await firstCursor('?action=rpage.&limit=1', people.ownerA);
    const [position, mac] = own.split('.') as [string, string];
    // Before every row: unsigned it would read the whole first page without a viewed row.
    const top = Buffer.from('9999-12-31T23:59:59.999Z|ffffffff-ffff-4fff-bfff-ffffffffffff');
    const forged = top.toString('base64url');
    for (const cursor of [forged, `${forged}.${mac}`, `${position}.${mac.slice(1)}A`]) {
      const res = await call(`?action=rpage.&limit=1&cursor=${cursor}`, people.ownerA);
      expect([res.status, codeOf(res)], cursor).toEqual([400, 'VALIDATION_FAILED']);
    }
    expect((await viewedRows(firms.a.id)).length).toBe(before + 1);
  });
});

describe('reading the log is audited', () => {
  it('the first page writes audit_log.viewed with the filters, never the rows; later pages none', async () => {
    const before = (await viewedRows(firms.a.id)).length;
    const viewer = newViewer();
    const first = await call('?action=rpage.&limit=3', people.adminA, 'a', viewer);
    expect(first.status).toBe(200);
    const page = AuditLogPage.parse(first.body);
    expect(page.items.map((i) => i.action)).not.toContain('audit_log.viewed');
    const second = await call(
      `?action=rpage.&limit=3&cursor=${encodeURIComponent(page.nextCursor ?? '')}`,
      people.adminA,
    );
    expect(second.status).toBe(200);

    const rows = await viewedRows(firms.a.id);
    expect(rows.length).toBe(before + 1);
    const row = rows.find((r) => r.ip === viewer);
    expect(row).toMatchObject({
      actorUserId: people.adminA.id,
      entityType: 'audit_log',
      entityId: null,
    });
    expect(row?.metadata).toMatchObject({ action: 'rpage.', limit: 3, defaultRange: true });
    expect(Object.keys(row?.metadata as object).sort()).toEqual(
      ['action', 'defaultRange', 'from', 'limit', 'to'].sort(),
    );
    const text = JSON.stringify(rows.map((r) => r.metadata));
    for (const item of page.items) expect(text).not.toContain(item.id);
    expect(text).not.toMatch(/Fake R12|@r12al\.test|SecretAgent/);

    // The viewed row shows in the log itself, as the reader.
    const viewed = await all('?action=audit_log.viewed');
    expect(viewed.some((v) => v.actor?.userId === people.adminA.id)).toBe(true);
  });

  it('records the record filter only when it is an id, never the text typed', async () => {
    const [typed, byText] = ['000-00-0000', newViewer()];
    const [id, byId] = [randomUUID(), newViewer()];
    expect((await call(`?entityId=${typed}`, people.ownerA, 'a', byText)).status).toBe(200);
    expect((await call(`?entityId=${id}`, people.ownerA, 'a', byId)).status).toBe(200);
    const rows = await viewedRows(firms.a.id);
    expect(rows.find((r) => r.ip === byText)?.metadata).toMatchObject({ entityIdText: true });
    expect(rows.find((r) => r.ip === byId)?.metadata).toMatchObject({ entityId: id });
    expect(JSON.stringify(rows.map((r) => r.metadata))).not.toContain(typed);
  });

  it('a refused read writes nothing, and nothing in another firm', async () => {
    const beforeA = (await viewedRows(firms.a.id)).length;
    const beforeB = (await viewedRows(firms.b.id)).length;
    await call('', people.staffA);
    await call('', people.ownerB, 'a');
    await call('?limit=0', people.ownerA);
    expect((await viewedRows(firms.a.id)).length).toBe(beforeA);
    expect((await viewedRows(firms.b.id)).length).toBe(beforeB);
  });
});

describe('GET /admin/firms/{businessId}/audit-log', () => {
  const adminCall = async (path: string, who: { email: string }) =>
    request(app.getHttpServer())
      .get(path)
      .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`)
      .set('authorization', `Bearer ${await tokenFor(who.email)}`);

  it('answers 403 SUPPORT_GRANT_REQUIRED to a Super Admin until R8, and reads nothing', async () => {
    const before = (await viewedRows(firms.a.id)).length;
    for (const path of [
      `/api/v1/admin/firms/${firms.a.id}/audit-log`,
      `/api/v1/admin/firms/${firms.b.id}/audit-log?action=rtest.`,
      `/api/v1/admin/firms/${randomUUID()}/audit-log`,
    ]) {
      const res = await adminCall(path, fx.users.admin);
      expect([res.status, codeOf(res)], path).toEqual([403, 'SUPPORT_GRANT_REQUIRED']);
      expect(JSON.stringify(res.body)).not.toContain('rtest');
    }
    expect((await viewedRows(firms.a.id)).length).toBe(before);
  });

  it('refuses firm sessions (401)', async () => {
    for (const who of [people.ownerA, people.clientA]) {
      const res = await adminCall(`/api/v1/admin/firms/${firms.a.id}/audit-log`, who);
      expect(res.status).toBe(401);
    }
  });
});
