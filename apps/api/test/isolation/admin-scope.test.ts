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
import { ADMIN_SECURITY_DEFAULTS } from '@firmivra/types';
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
import { prepareSettings, settingsParams, settingsWrites } from './admin-settings-writes.js';
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
 * notification and `comm` a communications record (R56). Support's writes
 * (admin-support-writes.ts) name their own `record`, may build the body, and may add a query. A
 * body may be a function, read when it runs.
 */
/** Audit & Security records (R55) a write case acts on: seeded once, one per case that changes it. */
type AuditRecord =
  | 'event'
  | 'alertAck'
  | 'alertResolve'
  | 'alertDismiss'
  | 'alertAssign'
  | 'noteEdit'
  | 'noteRetract';
const auditRecords = {} as Record<AuditRecord, string>;

/** The security policy's version now (a save names the version it started from). */
async function policyVersion(): Promise<number> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  const row = await runInScope(owner, { kind: 'platform' }, (tx) =>
    tx.platformSecurityPolicy.findUniqueOrThrow({ where: { id: 1 }, select: { version: true } }),
  );
  await owner.$disconnect();
  return row.version;
}

const WRITES: Record<
  string,
  Omit<SupportWrite, 'body'> & {
    body: SupportWrite['body'] | (() => object);
    app?: string;
    item?: string;
    comm?: string;
    auditRecord?: AuditRecord;
    settingsId?: string;
    params?: Record<string, string>;
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
  'POST /api/v1/admin/audit/exports': { body: { format: 'CSV', query: { view: 'login' } } },
  'PUT /api/v1/admin/audit/policy': {
    body: async () => ({ version: await policyVersion(), settings: ADMIN_SECURITY_DEFAULTS }),
  },
  'POST /api/v1/admin/audit/alerts/:id/acknowledge': { body: {}, auditRecord: 'alertAck' },
  'POST /api/v1/admin/audit/alerts/:id/resolve': {
    body: { note: 'Fake resolution' },
    auditRecord: 'alertResolve',
  },
  'POST /api/v1/admin/audit/alerts/:id/dismiss': { body: {}, auditRecord: 'alertDismiss' },
  'POST /api/v1/admin/audit/alerts/:id/assign': {
    body: { userId: null },
    auditRecord: 'alertAssign',
  },
  'POST /api/v1/admin/audit/notes/:id/edit': {
    body: { text: 'Fake correction' },
    auditRecord: 'noteEdit',
  },
  'POST /api/v1/admin/audit/notes/:id/retract': { body: {}, auditRecord: 'noteRetract' },
  'POST /api/v1/admin/audit/events/:id/respond': {
    body: { action: 'MARK_REVIEWED' },
    auditRecord: 'event',
  },
  'POST /api/v1/admin/audit/events/:id/notes': {
    body: { text: 'Fake note' },
    auditRecord: 'event',
  },
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
  'PATCH /api/v1/admin/communications/template-categories/:id': {
    body: { isActive: true },
    comm: 'cat',
  },
  ...supportWrites(fx),
  ...settingsWrites(fx),
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
    // A platform event, its alerts (one per move) and notes by the Super Admin who calls.
    auditRecords.event = (
      await tx.auditLog.create({
        data: {
          action: 'auth.sign_in_failed',
          entityType: 'login',
          targetLabel: 'Fake scope event',
        },
        select: { id: true },
      })
    ).id;
    for (const key of ['alertAck', 'alertResolve', 'alertDismiss', 'alertAssign'] as const) {
      auditRecords[key] = (
        await tx.securityAlert.create({
          data: {
            auditLogId: auditRecords.event,
            ruleId: 'fake.scope',
            severity: 'MEDIUM',
            title: 'Fake scope alert',
            eventKey: `scope:${key}:${randomUUID()}`,
          },
          select: { id: true },
        })
      ).id;
    }
  });
  // Notes are written as their author (the admin scope's own admin).
  await runInScope(owner, { kind: 'admin', adminUserId: fx.users.admin.id }, async (tx) => {
    for (const key of ['noteEdit', 'noteRetract'] as const) {
      auditRecords[key] = (
        await tx.auditInvestigationNote.create({
          data: {
            auditLogId: auditRecords.event,
            authorUserId: fx.users.admin.id,
            body: 'Fake note',
          },
          select: { id: true },
        })
      ).id;
    }
  });
  await owner.$disconnect();
  await prepareSupport(fx);
  await prepareSettings(fx);
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

/**
 * One token per person for the whole file: a token per call ran into the sign-in rate limit (429)
 * once the admin site had more routes.
 */
const tokens = new Map<string, string>();
async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const { token } = (
    await request(app.getHttpServer()).post('/api/v1/dev/token').send({ email }).expect(200)
  ).body as { token: string };
  tokens.set(email, token);
  return token;
}

async function call(
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  email: string,
  firm?: string,
  body?: object,
) {
  const token = await tokenFor(email);
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
        : c.auditRecord
          ? auditRecords[c.auditRecord]
          : c.comm
            ? comms[c.comm]!
            : c.item
              ? items[c.item]!
              : c.app
                ? applications[c.app]!
                : randomUUID();
      const path =
        fillPath(route.path, { businessId: fx.firmA.id, id, ...settingsParams(c) }) +
        (c.query ?? '');
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
