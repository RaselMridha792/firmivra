// End-to-end: the Super Admin notification center (R56 on R0's B1; contract in
// packages/types/src/admin-notifications). A member reads and changes only their own items: the
// list with filters and paging, the summary cards, the bell, read and unread, resolve (items that
// ask for work only), dismiss, bulk and mark-all-read. Resolved and dismissed are final. Resolving
// or dismissing a security or billing item writes an audit row. Firm sessions get 401.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, type Prisma, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  AdminNotification,
  AdminNotificationSummary,
  BulkAdminNotificationsResponse,
  ListAdminNotificationsResponse,
  RecentAdminNotifications,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r56an-${key}-${run}@r56an.test` });
const me = person('me');
const other = person('other');
const BASE = '/api/v1/admin/notifications';
const HOUR = 60 * 60_000;
const now = Date.now();

let app: INestApplication;
const tokens = new Map<string, string>();
let viewerSeq = 0;
const newViewer = () => `198.19.${(viewerSeq >> 8) & 255}.${viewerSeq++ & 255}`;

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
  method: 'get' | 'post',
  path: string,
  who: { email: string } | null = me,
  body?: object,
): Promise<Response> {
  let req = request(app.getHttpServer())
    [method](`${BASE}${path}`)
    .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`);
  if (who) req = req.set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return method === 'post' ? req.send(body ?? {}) : req;
}
const ok = async (method: 'get' | 'post', path: string, body?: object) => {
  const res = await call(method, path, me, body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as unknown;
};
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;

const owner = () => createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);

/** My items, oldest to newest: the keys name them in the tests. */
const ids: Record<string, string> = {};
let othersId = '';

beforeAll(async () => {
  const db = owner();
  await runInScope(db, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries({ me, other })) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: 'ADMIN',
          email: p.email,
          name: `Fake R56 ${key}`,
        },
      });
      await tx.platformAdmin.create({ data: { userId: p.id } });
    }
    const item = (
      key: string,
      hoursAgo: number,
      data: Partial<Prisma.PlatformNotificationUncheckedCreateInput>,
    ) =>
      tx.platformNotification
        .create({
          data: {
            recipientUserId: me.id,
            category: 'SYSTEM',
            type: 'system.fake',
            title: `Fake ${key} ${run}`,
            sourceType: 'system',
            eventKey: `r56an-${key}-${run}`,
            occurredAt: new Date(now - hoursAgo * HOUR),
            ...data,
          },
        })
        .then((row) => (ids[key] = row.id));
    await item('security', 5, {
      category: 'SECURITY',
      priority: 'CRITICAL',
      type: 'security.suspicious_login',
      requiresAction: true,
      attention: 'ACTION_REQUIRED',
    });
    await item('billing', 4, {
      category: 'BILLING_SUBSCRIPTIONS',
      type: 'billing.payment_failed',
      body: 'Monthly payment failed (sample).',
      sourceLabel: 'Sample Firm',
      businessId: fx.firmA.id,
    });
    await item('application', 3, {
      category: 'FIRM_APPLICATIONS',
      priority: 'HIGH',
      type: 'firm_application.submitted',
      sourceType: 'firm_application',
      sourceLabel: 'Sunrise Sample Accounting',
      requiresAction: true,
      attention: 'ACTION_REQUIRED',
    });
    await item('info', 2, { priority: 'INFORMATIONAL' });
    await item('update', 1, {});
    othersId = (
      await tx.platformNotification.create({
        data: {
          recipientUserId: other.id,
          category: 'SECURITY',
          type: 'security.fake',
          title: `Fake other ${run}`,
          sourceType: 'system',
          eventKey: `r56an-other-${run}`,
          requiresAction: true,
          attention: 'ACTION_REQUIRED',
        },
      })
    ).id;
  });
  await db.$disconnect();

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

async function auditRows(entityId: string) {
  const db = owner();
  const rows = await runInScope(db, { kind: 'platform' }, (tx) =>
    tx.auditLog.findMany({ where: { entityType: 'platform_notification', entityId } }),
  );
  await db.$disconnect();
  return rows;
}

describe('who may call', () => {
  it('answers 401 signed out and to firm and client sessions', async () => {
    for (const who of [null, fx.users.ownerA]) {
      const res = await call('get', '', who);
      expect(res.status).toBe(401);
    }
  });
});

describe('GET /admin/notifications', () => {
  it('lists only my items, newest first, with paging', async () => {
    const page = ListAdminNotificationsResponse.parse(await ok('get', '?pageSize=2'));
    expect(page.total).toBe(5);
    expect(page.items.map((i) => i.id)).toEqual([ids['update'], ids['info']]);
    const two = ListAdminNotificationsResponse.parse(await ok('get', '?pageSize=2&page=3'));
    expect(two.items.map((i) => i.id)).toEqual([ids['security']]);
    expect(JSON.stringify(page)).not.toContain(othersId);
  });

  it('filters by category, priority, status and text, and shows the firm', async () => {
    const billing = ListAdminNotificationsResponse.parse(
      await ok('get', '?category=BILLING_SUBSCRIPTIONS'),
    );
    expect(billing.items).toHaveLength(1);
    expect(billing.items[0]?.business).toEqual({ id: fx.firmA.id, name: expect.any(String) });
    const critical = ListAdminNotificationsResponse.parse(await ok('get', '?priority=CRITICAL'));
    expect(critical.items.map((i) => i.id)).toEqual([ids['security']]);
    const action = ListAdminNotificationsResponse.parse(await ok('get', '?status=ACTION_REQUIRED'));
    expect(action.total).toBe(2);
    const found = ListAdminNotificationsResponse.parse(await ok('get', '?search=sunrise'));
    expect(found.items.map((i) => i.id)).toEqual([ids['application']]);
  });

  it('refuses a bad filter (400)', async () => {
    for (const q of ['?status=GONE', '?pageSize=500', '?nope=1']) {
      const res = await call('get', q);
      expect([res.status, codeOf(res)], q).toEqual([400, 'VALIDATION_FAILED']);
    }
  });
});

describe('the cards and the bell', () => {
  it('counts my items', async () => {
    const s = AdminNotificationSummary.parse(await ok('get', '/summary'));
    expect(s).toMatchObject({ total: 5, unread: 5, actionRequired: 2, critical: 1 });
    expect((await ok('get', '/unread-count')) as { count: number }).toEqual({ count: 5 });
    const recent = RecentAdminNotifications.parse(await ok('get', '/recent?limit=2'));
    expect(recent.items.map((i) => i.id)).toEqual([ids['update'], ids['info']]);
    expect(recent.unread).toBe(5);
  });
});

describe('one item', () => {
  it('reads my item without marking it read; another member’s is 404, a bad id 400', async () => {
    const item = AdminNotification.parse(await ok('get', `/${ids['info']}`));
    expect(item.readAt).toBeNull();
    const res = await call('get', `/${othersId}`);
    expect([res.status, codeOf(res)]).toEqual([404, 'NOT_FOUND']);
    expect((await call('get', '/not-an-id')).status).toBe(400);
  });

  it('marks read and unread', async () => {
    const read = AdminNotification.parse(await ok('post', `/${ids['info']}/read`));
    expect(read.readAt).not.toBeNull();
    const again = AdminNotification.parse(await ok('post', `/${ids['info']}/read`));
    expect(again.readAt).toBe(read.readAt);
    const unread = AdminNotification.parse(await ok('post', `/${ids['info']}/unread`));
    expect(unread.readAt).toBeNull();
  });

  it('resolves an item that asks for work, audits it for security, and keeps it final', async () => {
    const done = AdminNotification.parse(await ok('post', `/${ids['security']}/resolve`));
    expect(done.attention).toBe('RESOLVED');
    expect(done.resolvedAt).not.toBeNull();
    expect(done.resolvedBy).toEqual({ userId: me.id, name: 'Fake R56 me' });
    const rows = await auditRows(ids['security']!);
    expect(rows.map((r) => r.action)).toEqual(['platform_notification.resolved']);
    expect(rows[0]?.businessId).toBeNull();
    for (const action of ['resolve', 'dismiss']) {
      const res = await call('post', `/${ids['security']}/${action}`);
      expect([res.status, codeOf(res)], action).toEqual([409, 'ALREADY_CLOSED']);
    }
    const s = AdminNotificationSummary.parse(await ok('get', '/summary'));
    expect(s.resolvedToday).toBe(1);
    expect(s.critical).toBe(0);
  });

  it('refuses to resolve an item that asks for no work, and dismisses it', async () => {
    const res = await call('post', `/${ids['update']}/resolve`);
    expect([res.status, codeOf(res)]).toEqual([409, 'NOT_ACTIONABLE']);
    const gone = AdminNotification.parse(await ok('post', `/${ids['update']}/dismiss`));
    expect(gone.attention).toBe('DISMISSED');
    expect(gone.dismissedAt).not.toBeNull();
    expect(await auditRows(ids['update']!)).toEqual([]);
  });

  it('cannot change another member’s item (404) and leaves it as it was', async () => {
    for (const action of ['read', 'resolve', 'dismiss']) {
      const res = await call('post', `/${othersId}/${action}`);
      expect([res.status, codeOf(res)], action).toEqual([404, 'NOT_FOUND']);
    }
    const db = owner();
    const row = await runInScope(db, { kind: 'platform' }, (tx) =>
      tx.platformNotification.findUnique({ where: { id: othersId } }),
    );
    await db.$disconnect();
    expect(row).toMatchObject({ readAt: null, attention: 'ACTION_REQUIRED' });
  });
});

describe('many items', () => {
  it('bulk applies to mine and skips what it cannot change', async () => {
    const body = { ids: [ids['billing'], ids['application'], othersId], action: 'DISMISS' };
    const r = BulkAdminNotificationsResponse.parse(await ok('post', '/bulk', body));
    expect(r).toEqual({ updated: 2, skipped: [othersId] });
    expect((await auditRows(ids['billing']!)).map((a) => a.action)).toEqual([
      'platform_notification.dismissed',
    ]);
    const res = await call('post', '/bulk', me, { ids: [], action: 'READ' });
    expect(res.status).toBe(400);
  });

  it('marks every unread item matching the filter read', async () => {
    expect(await ok('post', '/mark-all-read', { category: 'FIRM_APPLICATIONS' })).toEqual({
      updated: 1,
    });
    expect(await ok('post', '/mark-all-read', {})).toEqual({ updated: 4 });
    expect(await ok('get', '/unread-count')).toEqual({ count: 0 });
  });
});
