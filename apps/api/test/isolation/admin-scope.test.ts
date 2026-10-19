// R8 step 2 (R0's #123 answer): the admin site never opens a plain business scope. A Super Admin
// reaches a firm's data only through SupportScope (app_enter_support_scope: their own active
// grant, read-only). This calls every route under /api/v1/admin as a Super Admin (writes with a
// valid body against real records) and fails if any of them opened a firm's scope through
// forBusiness or withScope({ kind: 'business' }). Exceptions: AuditService writing a firm's own
// audit row ("Firmivra Support"), which only inserts; and ONBOARDING below, where approving an
// application sets up the firm it just created, and only that firm.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type Database, type Scope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { AppModule } from '../../src/app.module.js';
import { requestContext } from '../../src/common/request-context.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { DATABASE } from '../../src/database/database.module.js';
import { NOTIFY_SERVICE } from '../../src/notify/notify.types.js';
import { DOCUMENT_STORAGE } from '../../src/storage/document-storage.js';
import {
  prepareSupport,
  type SupportWrite,
  supportRecord,
  supportStorage,
  supportWrites,
  type WriteHelpers,
} from './admin-support-writes.js';
import { billingWrites, prepareBilling } from './admin-billing-writes.js';
import { integrationsWrites, prepareIntegrations } from './admin-integrations-writes.js';
import { apiRoutes, fillPath } from './routes.js';

const fx = inject('fixtures');
let app: INestApplication;
/** Business scopes opened during requests, outside AuditService: the path and the firm. */
const opens: { path: string; businessId: string }[] = [];
const opened = () => opens.map((o) => o.path);

function record(businessId: string): void {
  const path = requestContext.getStore()?.path;
  if (path === undefined) return;
  if (new Error().stack?.includes('audit/audit.service')) return;
  opens.push({ path, businessId });
}

/**
 * Admin writes allowed to open a business scope, and only the scope of the firm their own
 * application created (still in setup): approve copies the application's details into the new
 * firm's settings and invites its Owner; owner-invite resends that invite. They read no other
 * firm's data. R0 may later move them behind a definer function like the support scope.
 */
const ONBOARDING = new Set([
  'POST /api/v1/admin/firm-applications/:id/approve',
  'POST /api/v1/admin/firm-applications/:id/owner-invite',
]);

/** A pending application per write case, so each action meets a record it can act on. */
const applications: Record<string, string> = {};
/** An open notification of the fixture Super Admin per write case that acts on one (R56). */
const items: Record<string, string> = {};
/** Communications records (R56) each write case acts on: a thread, messages, templates, a category. */
const comms: Record<string, string> = {};
const tag = randomUUID().slice(0, 8);
const ADMIN_EMAIL = 'admin@firmivra.test';

/**
 * Every admin write, with a body that passes validation, run in this order; `app` names the
 * application it acts on (the owner invite resends for the one just approved), `item` a
 * notification and `comm` a communications record (R56); `params` fills a route's other ids
 * (the Integrations catalog's `:planId`). Support's writes
 * (admin-support-writes.ts) name their own `record`, may build the body, and may add a query. A
 * body may be a function, read when it runs.
 */
const WRITES: Record<
  string,
  Omit<SupportWrite, 'body'> & {
    body: SupportWrite['body'] | (() => object);
    app?: string;
    item?: string;
    comm?: string;
    params?: () => Record<string, string>;
  }
> = {
  'POST /api/v1/admin/firm-applications/:id/approve': { body: {}, app: 'approve' },
  'POST /api/v1/admin/firm-applications/:id/request-info': {
    body: { message: 'Fake: please send your licence' },
    app: 'info',
  },
  'POST /api/v1/admin/firm-applications/:id/decline': {
    body: { reason: 'Fake reason' },
    app: 'decline',
  },
  'POST /api/v1/admin/firm-applications/:id/owner-invite': { body: {}, app: 'approve' },
  'PUT /api/v1/admin/firm-applications/:id/notes': { body: { notes: 'Fake note' }, app: 'notes' },
  'POST /api/v1/admin/firms/:businessId/support-access': { body: { reason: 'Fake reason' } },
  'POST /api/v1/admin/notifications/bulk': { body: { ids: [randomUUID()], action: 'READ' } },
  'POST /api/v1/admin/notifications/mark-all-read': { body: {} },
  'POST /api/v1/admin/notifications/:id/read': { body: {}, item: 'read' },
  'POST /api/v1/admin/notifications/:id/unread': { body: {}, item: 'unread' },
  'POST /api/v1/admin/notifications/:id/resolve': { body: {}, item: 'resolve' },
  'POST /api/v1/admin/notifications/:id/dismiss': { body: {}, item: 'dismiss' },
  'POST /api/v1/admin/communications/conversations/:id/read': { body: {}, comm: 'conv' },
  'PATCH /api/v1/admin/communications/conversations/:id': {
    body: { status: 'OPEN' },
    comm: 'conv',
  },
  'POST /api/v1/admin/communications/messages': {
    body: () => ({
      contact: { type: 'TEAM', userId: fx.users.admin.id },
      channel: 'INTERNAL',
      body: 'Fake scope note',
      mode: 'SEND',
      idempotencyKey: randomUUID(),
    }),
  },
  'PATCH /api/v1/admin/communications/messages/:id': { body: { body: 'Fake edit' }, comm: 'edit' },
  'POST /api/v1/admin/communications/messages/:id/send': {
    body: () => ({ idempotencyKey: randomUUID() }),
    comm: 'send',
  },
  'POST /api/v1/admin/communications/messages/:id/schedule': {
    body: () => ({
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
      scheduledTimeZone: 'America/New_York',
    }),
    comm: 'schedule',
  },
  'POST /api/v1/admin/communications/messages/:id/cancel': { body: {}, comm: 'cancel' },
  'POST /api/v1/admin/communications/messages/:id/retry': {
    body: () => ({ idempotencyKey: randomUUID() }),
    comm: 'retry',
  },
  'DELETE /api/v1/admin/communications/messages/:id': { body: {}, comm: 'delete' },
  'POST /api/v1/admin/communications/templates': {
    body: () => ({
      categoryId: comms['cat'],
      name: `Fake scope template new ${tag}`,
      channel: 'SMS',
      body: 'Fake {{contact.first_name}}',
    }),
  },
  'PATCH /api/v1/admin/communications/templates/:id': { body: { body: 'Fake edit' }, comm: 'tpl' },
  'POST /api/v1/admin/communications/templates/:id/duplicate': { body: {}, comm: 'tpl' },
  'POST /api/v1/admin/communications/templates/:id/preview': { body: {}, comm: 'tpl' },
  'POST /api/v1/admin/communications/templates/:id/test': { body: {}, comm: 'tpl' },
  'POST /api/v1/admin/communications/templates/:id/archive': { body: {}, comm: 'tpl' },
  'POST /api/v1/admin/communications/template-categories': {
    body: { name: `Fake scope category new ${tag}` },
  },
  'POST /api/v1/admin/communications/broadcasts': { body: { name: 'Fake scope broadcast new' } },
  'PATCH /api/v1/admin/communications/broadcasts/:id': {
    body: { name: 'Fake scope edit' },
    comm: 'b-patch',
  },
  'POST /api/v1/admin/communications/broadcasts/:id/test': {
    body: { channels: ['EMAIL'] },
    comm: 'b-test',
  },
  'POST /api/v1/admin/communications/broadcasts/:id/schedule': {
    body: () => ({
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
      scheduledTimeZone: 'America/New_York',
    }),
    comm: 'b-schedule',
  },
  'POST /api/v1/admin/communications/broadcasts/:id/send': {
    body: () => ({ idempotencyKey: randomUUID() }),
    comm: 'b-send',
  },
  'POST /api/v1/admin/communications/broadcasts/:id/cancel': { body: {}, comm: 'b-cancel' },
  'POST /api/v1/admin/communications/broadcasts/:id/retry': {
    body: () => ({ idempotencyKey: randomUUID() }),
    comm: 'b-retry',
  },
  'POST /api/v1/admin/communications/broadcasts/:id/duplicate': {
    body: {},
    comm: 'b-duplicate',
  },
  'POST /api/v1/admin/communications/broadcasts/:id/archive': { body: {}, comm: 'b-archive' },
  'DELETE /api/v1/admin/communications/broadcasts/:id': { body: {}, comm: 'b-delete' },
  'POST /api/v1/admin/communications/segments': {
    body: { name: `Fake scope audience new ${tag}`, definition: { contactTypes: ['TEAM'] } },
  },
  'PATCH /api/v1/admin/communications/segments/:id': {
    body: { description: 'Fake scope' },
    comm: 'seg',
  },
  'POST /api/v1/admin/communications/segments/:id/count': { body: {}, comm: 'seg' },
  'POST /api/v1/admin/communications/media': {
    body: {
      kind: 'ATTACHMENT',
      fileName: 'fake-scope.pdf',
      contentType: 'application/pdf',
      sizeBytes: 100,
      sha256: 'a'.repeat(64),
    },
  },
  'PATCH /api/v1/admin/communications/template-categories/:id': {
    body: { isActive: true },
    comm: 'cat',
  },
  ...supportWrites(fx),
  ...billingWrites(fx),
  ...integrationsWrites(fx),
};

/** The thread, messages, template and category the communications writes act on (R56). */
async function seedComms(tx: Parameters<Parameters<typeof runInScope>[2]>[0]) {
  const admin = fx.users.admin.id;
  const conv = await tx.commConversation.create({
    data: {
      contactType: 'TEAM',
      contactUserId: admin,
      contactName: 'Fake Scope Admin',
      contactEmail: ADMIN_EMAIL,
    },
  });
  comms['conv'] = conv.id;
  const draft = async (key: string, scheduled = false) => {
    const m = await tx.commMessage.create({
      data: {
        conversationId: conv.id,
        channel: 'EMAIL',
        direction: 'OUTBOUND',
        status: scheduled ? 'SCHEDULED' : 'DRAFT',
        subject: 'Fake scope',
        body: 'Fake scope body',
        ...(scheduled
          ? {
              scheduledAt: new Date(Date.now() + 86_400_000),
              scheduledTimeZone: 'America/New_York',
            }
          : {}),
      },
    });
    const r = await tx.commMessageRecipient.create({
      data: {
        messageId: m.id,
        contactType: 'TEAM',
        contactUserId: admin,
        name: 'Fake Scope Admin',
        address: ADMIN_EMAIL,
      },
    });
    comms[key] = m.id;
    return { m, r };
  };
  for (const key of ['edit', 'send', 'schedule', 'delete']) await draft(key);
  await draft('cancel', true);
  const failed = await draft('retry');
  await tx.commMessage.update({ where: { id: failed.m.id }, data: { status: 'SENDING' } });
  await tx.commMessageRecipient.update({
    where: { id: failed.r.id },
    data: { status: 'FAILED', errorCode: 'invalid_recipient' },
  });
  await tx.commMessage.update({
    where: { id: failed.m.id },
    data: { status: 'FAILED', errorCode: 'delivery_failed' },
  });
  const cat = await tx.commTemplateCategory.create({
    data: { name: `Fake scope category ${tag}`, position: 100 },
  });
  comms['cat'] = cat.id;
  comms['tpl'] = (
    await tx.commTemplate.create({
      data: {
        categoryId: cat.id,
        name: `Fake scope template ${tag}`,
        channel: 'EMAIL',
        subject: 'Fake scope',
        body: 'Fake {{contact.first_name}}',
        mergeFields: ['contact.first_name'],
      },
    })
  ).id;
  await seedBroadcasts(tx);
}

/** An audience of the fixture Super Admin's own team and broadcasts in each state a write needs. */
async function seedBroadcasts(tx: Parameters<Parameters<typeof runInScope>[2]>[0]) {
  const admin = fx.users.admin.id;
  const seg = await tx.commSegment.create({
    data: { name: `Fake scope audience ${tag}`, definition: { contactTypes: ['TEAM'] } },
  });
  comms['seg'] = seg.id;
  const make = async (key: string) => {
    const b = await tx.commBroadcast.create({
      data: { name: `Fake scope broadcast ${key}`, segmentId: seg.id },
    });
    await tx.commBroadcastChannel.create({
      data: { broadcastId: b.id, channel: 'EMAIL', subject: 'Fake scope', body: 'Fake scope' },
    });
    comms[`b-${key}`] = b.id;
    return b.id;
  };
  for (const key of ['patch', 'test', 'schedule', 'send', 'duplicate', 'delete']) await make(key);
  const later = new Date(Date.now() + 86_400_000);
  const scheduled = await make('cancel');
  await tx.commBroadcast.update({
    where: { id: scheduled },
    data: { status: 'SCHEDULED', scheduledAt: later, scheduledTimeZone: 'America/New_York' },
  });
  const done = await make('archive');
  await tx.commBroadcast.update({
    where: { id: done },
    data: { status: 'SCHEDULED', scheduledAt: later, scheduledTimeZone: 'America/New_York' },
  });
  await tx.commBroadcast.update({ where: { id: done }, data: { status: 'CANCELLED' } });
  // A failed broadcast with one failed recipient (the retry sends it again).
  const failed = await make('retry');
  await tx.commBroadcast.update({
    where: { id: failed },
    data: { status: 'SENDING', recipientCount: 1 },
  });
  await tx.commBroadcastChannel.updateMany({
    where: { broadcastId: failed },
    data: { status: 'SENDING' },
  });
  const r = await tx.commBroadcastRecipient.create({
    data: {
      broadcastId: failed,
      channel: 'EMAIL',
      contactType: 'TEAM',
      contactUserId: admin,
      name: 'Fake Scope Admin',
      address: ADMIN_EMAIL,
    },
  });
  await tx.commBroadcastRecipient.update({
    where: { id: r.id },
    data: { status: 'FAILED', errorCode: 'invalid_recipient' },
  });
  await tx.commBroadcastChannel.updateMany({
    where: { broadcastId: failed },
    data: { status: 'FAILED', failedCount: 1 },
  });
  await tx.commBroadcast.update({
    where: { id: failed },
    data: { status: 'FAILED', errorMessage: 'Fake scope failure' },
  });
}

/** The firm an approved application created, or null. */
async function firmOf(applicationId: string): Promise<string | null> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  const row = await runInScope(owner, { kind: 'platform' }, (tx) =>
    tx.firmApplication.findUnique({ where: { id: applicationId }, select: { businessId: true } }),
  );
  await owner.$disconnect();
  return row?.businessId ?? null;
}

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const c of Object.values(WRITES)) {
      if (!c.app || c.app in applications) continue;
      const tag = randomUUID().slice(0, 8);
      const row = await tx.firmApplication.create({
        data: {
          legalName: `Fake Scope Firm ${tag}`,
          contactName: 'Fake Applicant',
          contactEmail: `scope-${tag}@scope.example.test`,
          data: {},
        },
      });
      applications[c.app] = row.id;
    }
    for (const c of Object.values(WRITES)) {
      if (!c.item) continue;
      const row = await tx.platformNotification.create({
        data: {
          recipientUserId: fx.users.admin.id,
          category: 'SYSTEM',
          type: 'system.scope_check',
          title: 'Fake scope check',
          sourceType: 'system',
          eventKey: `scope-${c.item}-${randomUUID()}`,
          requiresAction: true,
          attention: 'ACTION_REQUIRED',
        },
      });
      items[c.item] = row.id;
    }
    await seedComms(tx);
  });
  await owner.$disconnect();
  await prepareSupport(fx);
  await prepareBilling(fx);
  await prepareIntegrations(fx);
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env)],
  })
    // No mail server in tests: the invites and notices go nowhere.
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({ send: () => Promise.resolve() })
    // Support's files go to memory: no bucket in tests.
    .overrideProvider(DOCUMENT_STORAGE)
    .useValue(supportStorage)
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  const db = nest.get<Database>(DATABASE);
  const forBusiness = db.forBusiness.bind(db);
  const withScope = db.withScope.bind(db);
  db.forBusiness = (...args: Parameters<Database['forBusiness']>) => {
    record(args[0]);
    return forBusiness(...args);
  };
  db.withScope = ((scope: Scope, ...rest: [never, never]) => {
    if (scope.kind === 'business') record(scope.businessId);
    return withScope(scope, ...rest);
  }) as Database['withScope'];
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

/** One token per person: a fresh one per call meets the dev token's rate limit as routes grow. */
const tokens = new Map<string, string>();

async function call(
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  email: string,
  firm?: string,
  body?: object,
) {
  let token = tokens.get(email);
  if (!token) {
    token = (
      (await request(app.getHttpServer()).post('/api/v1/dev/token').send({ email }).expect(200))
        .body as { token: string }
    ).token;
    tokens.set(email, token);
  }
  const req = request(app.getHttpServer())[method](path).set('authorization', `Bearer ${token}`);
  const scoped = firm ? req.set('x-business-id', firm) : req;
  return body === undefined ? scoped : scoped.send(body);
}

describe('the admin site never opens a business scope', () => {
  it('every GET under /api/v1/admin, as a Super Admin, with real and unknown firm ids', async () => {
    const admin = apiRoutes(app).filter(
      (r) => r.method === 'GET' && /^\/api\/v1\/admin(\/|$)/i.test(r.path),
    );
    expect(admin.length).toBeGreaterThan(5);
    for (const firm of [fx.firmA.id, randomUUID()]) {
      for (const route of admin) {
        const path = fillPath(route.path, { businessId: firm, id: firm }, randomUUID);
        const res = await call('get', path, fx.users.admin.email);
        expect(res.status, `${route.name} ${path}`).toBeLessThan(500);
      }
    }
    expect(opened().filter((p) => /^\/api\/v1\/admin(\/|$)/i.test(p))).toEqual([]);
  });

  it('every write under /api/v1/admin, as a Super Admin, with a valid body and real records', async () => {
    const writes = apiRoutes(app).filter(
      (r) => r.method !== 'GET' && !r.isPublic && /^\/api\/v1\/admin(\/|$)/i.test(r.path),
    );
    const keys = writes.map((r) => `${r.method} ${r.path}`);
    expect(
      keys.filter((k) => !(k in WRITES)),
      'add the new admin write to WRITES',
    ).toEqual([]);
    const order = Object.keys(WRITES);
    writes.sort(
      (a, b) => order.indexOf(`${a.method} ${a.path}`) - order.indexOf(`${b.method} ${b.path}`),
    );
    const wrong: string[] = [];
    for (const route of writes) {
      const key = `${route.method} ${route.path}`;
      const c = WRITES[key]!;
      const id = c.record
        ? supportRecord(c.record)!
        : c.comm
          ? comms[c.comm]!
          : c.item
            ? items[c.item]!
            : c.app
              ? applications[c.app]!
              : randomUUID();
      const path =
        fillPath(route.path, { businessId: fx.firmA.id, id, ...c.params?.() }) + (c.query ?? '');
      const method = route.method.toLowerCase() as 'post' | 'put' | 'patch' | 'delete';
      const helpers: WriteHelpers = {
        post: (p, b) => call('post', p, fx.users.admin.email, undefined, b),
      };
      const body = typeof c.body === 'function' ? await c.body(helpers) : c.body;
      const from = opens.length;
      const res = await call(method, path, fx.users.admin.email, undefined, body);
      expect(res.status, `${route.name} ${path} ${JSON.stringify(res.body)}`).toBeLessThan(400);
      const created = c.app ? await firmOf(applications[c.app]!) : null;
      for (const o of opens.slice(from)) {
        const allowed = ONBOARDING.has(key) && created !== null && o.businessId === created;
        if (!allowed) wrong.push(`${key}: opened firm ${o.businessId}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('the check sees a business scope when one opens (a firm route)', async () => {
    const res = await call('get', '/api/v1/business/audit-log', fx.users.ownerA.email, fx.firmA.id);
    expect(res.status).toBe(200);
    expect(opened()).toContain('/api/v1/business/audit-log');
  });
});
