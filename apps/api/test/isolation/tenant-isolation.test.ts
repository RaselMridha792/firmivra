// R8 step 2, the tenant isolation suite. Table-driven over every firm and portal route the API
// serves, read from the Nest router at test time (routes.ts), so a new route without a case
// fails here:
// - a member of firm Q gets 404 naming firm P (x-business-id), on every firm route;
// - a member of firm Q gets 404 on firm P's records by id, on every route that takes one;
// - a client of firm P gets 404 at firm Q's portal, on every client route;
// - client Y gets 404 on client X's records in the same firm.
// Adding a route with a record id: add its case to RECORD_CASES (the record its params name and,
// for routes that take a body, a body that passes validation so the lookup is what answers).
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { type ApiRoute, apiRoutes, fillPath } from './routes.js';

/** Firm P's records the cases name; client X's unless the name says otherwise. */
type RecordKey =
  | 'client'
  | 'engagement'
  | 'workspace'
  | 'task'
  | 'report'
  | 'document'
  | 'appointment'
  | 'appointmentType'
  | 'blockedTime'
  | 'content'
  | 'taxStatus'
  | 'staffMembership'
  | 'staffUser'
  | 'pendingClientAccount';

/** Records of the firm a request acts in, for bodies that name one (a service, a status). */
interface OwnIds {
  service: string;
  taxStatus: string;
}

interface RecordCase {
  /** Each record param of the path, and which of firm P's records fills it. */
  params: Record<string, RecordKey>;
  /**
   * A body that passes validation, so the record lookup is what answers; ids in it are the
   * acting firm's own, so only the path's record can be the reason for a 404.
   */
  body?: object | ((own: OwnIds) => object);
}

const later = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

/** `METHOD /api/v1/...` of every route with a record id in its path. */
export const RECORD_CASES: Record<string, RecordCase> = {
  'DELETE /api/v1/business/blocked-times/:id': { params: { id: 'blockedTime' } },
  'DELETE /api/v1/business/content/:id': { params: { id: 'content' } },
  'DELETE /api/v1/business/reports/:id': { params: { id: 'report' } },
  'GET /api/v1/business/appointments/:id': { params: { id: 'appointment' } },
  'GET /api/v1/business/clients/:clientId/documents': { params: { clientId: 'client' } },
  'GET /api/v1/business/clients/:id': { params: { id: 'client' } },
  'GET /api/v1/business/clients/:id/engagements': { params: { id: 'client' } },
  'GET /api/v1/business/clients/:id/tax-years': { params: { id: 'client' } },
  'GET /api/v1/business/clients/:id/tax-years/:year/history': { params: { id: 'client' } },
  'GET /api/v1/business/documents/:id': { params: { id: 'document' } },
  'GET /api/v1/business/documents/:id/download': { params: { id: 'document' } },
  'GET /api/v1/business/engagements/:id': { params: { id: 'engagement' } },
  'GET /api/v1/business/engagements/:id/history': { params: { id: 'engagement' } },
  'GET /api/v1/business/workspaces/:engagementId': { params: { engagementId: 'workspace' } },
  'GET /api/v1/business/workspaces/:engagementId/reports': {
    params: { engagementId: 'workspace' },
  },
  'PATCH /api/v1/business/appointment-types/:id': {
    params: { id: 'appointmentType' },
    body: { name: 'Fake renamed type' },
  },
  'PATCH /api/v1/business/clients/:id': {
    params: { id: 'client' },
    body: { displayName: 'Fake renamed client' },
  },
  'PATCH /api/v1/business/content/:id': {
    params: { id: 'content' },
    body: { title: 'Fake renamed content' },
  },
  'PATCH /api/v1/business/engagements/:id': {
    params: { id: 'engagement' },
    body: { title: 'Fake renamed engagement' },
  },
  'PATCH /api/v1/business/reports/:id': {
    params: { id: 'report' },
    body: { title: 'Fake renamed report' },
  },
  'PATCH /api/v1/business/tasks/:id': {
    params: { id: 'task' },
    body: { title: 'Fake renamed task' },
  },
  'PATCH /api/v1/business/tax-statuses/:id': {
    params: { id: 'taxStatus' },
    body: { name: 'Fake renamed status' },
  },
  'PATCH /api/v1/business/team/:id': { params: { id: 'staffMembership' }, body: { role: 'ADMIN' } },
  'POST /api/v1/business/appointment-types/:id/archive': { params: { id: 'appointmentType' } },
  'POST /api/v1/business/appointment-types/:id/restore': { params: { id: 'appointmentType' } },
  'POST /api/v1/business/appointments/:id/cancel': { params: { id: 'appointment' } },
  'POST /api/v1/business/appointments/:id/complete': { params: { id: 'appointment' } },
  'POST /api/v1/business/appointments/:id/no-show': { params: { id: 'appointment' } },
  'POST /api/v1/business/appointments/:id/reschedule': {
    params: { id: 'appointment' },
    body: { startsAt: later(9) },
  },
  'POST /api/v1/business/clients/:clientId/documents/uploads': {
    params: { clientId: 'client' },
    body: (own) => ({
      serviceId: own.service,
      fileName: 'fake.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1000,
      sha256: createHash('sha256').update('fake').digest('hex'),
    }),
  },
  'POST /api/v1/business/clients/:id/archive': { params: { id: 'client' } },
  'POST /api/v1/business/clients/:id/engagements': {
    params: { id: 'client' },
    body: (own) => ({ serviceId: own.service, title: 'Fake engagement', taxYear: 2025 }),
  },
  'POST /api/v1/business/clients/:id/restore': { params: { id: 'client' } },
  'POST /api/v1/business/content/:id/publish': { params: { id: 'content' } },
  'POST /api/v1/business/content/:id/unpublish': { params: { id: 'content' } },
  'POST /api/v1/business/engagements/:id/cancel': {
    params: { id: 'engagement' },
    body: { reason: 'Fake reason' },
  },
  'POST /api/v1/business/engagements/:id/complete': { params: { id: 'engagement' } },
  'POST /api/v1/business/engagements/:id/reactivate': { params: { id: 'engagement' } },
  'POST /api/v1/business/reports/:id/publish': { params: { id: 'report' } },
  'POST /api/v1/business/reports/:id/unpublish': { params: { id: 'report' } },
  'POST /api/v1/business/tax-statuses/:id/archive': { params: { id: 'taxStatus' } },
  'POST /api/v1/business/team/:id/deactivate': { params: { id: 'staffMembership' } },
  'POST /api/v1/business/team/:id/resend-invite': { params: { id: 'staffMembership' } },
  'POST /api/v1/business/workspaces/:engagementId/reports': {
    params: { engagementId: 'workspace' },
    body: { kind: 'REPORT', title: 'Fake report' },
  },
  'POST /api/v1/client-sign-ups/:clientAccountId/approve': {
    params: { clientAccountId: 'pendingClientAccount' },
    body: {},
  },
  'POST /api/v1/client-sign-ups/:clientAccountId/decline': {
    params: { clientAccountId: 'pendingClientAccount' },
    body: {},
  },
  'PUT /api/v1/business/availability/:userId/working-hours': {
    params: { userId: 'staffUser' },
    body: { hours: [] },
  },
  'PUT /api/v1/business/clients/:id/profile': {
    params: { id: 'client' },
    body: { preferredName: 'Fake' },
  },
  'PUT /api/v1/business/clients/:id/tax-years/:year': {
    params: { id: 'client' },
    body: (own) => ({ taxStatusId: own.taxStatus }),
  },
  // Portal: client Y names client X's records in the same firm.
  'GET /api/v1/portal/:firmSlug/me/services/:engagementId/reports': {
    params: { engagementId: 'workspace' },
  },
  'POST /api/v1/portal/:firmSlug/me/appointments/:id/cancel': { params: { id: 'appointment' } },
  'POST /api/v1/portal/:firmSlug/me/appointments/:id/reschedule': {
    params: { id: 'appointment' },
    body: { startsAt: later(9) },
  },
  'POST /api/v1/portal/:firmSlug/me/services/:id/cancel-request': {
    params: { id: 'engagement' },
    body: { reason: 'Fake reason' },
  },
};

/** Path params that are not records: fixed values valid for any firm. */
const FIXED_PARAMS: Record<string, string> = {
  year: '2025',
  kind: 'TERMS',
  version: '1',
  key: 'tax-bracket',
  step: 'branding',
};

/** Routes outside a firm's or a client's data: sign-in, sign-up, the platform's own pages. */
const isFirmRoute = (r: ApiRoute) =>
  !r.isPublic &&
  r.roles.some((role) => ['OWNER', 'ADMIN', 'STAFF'].includes(role)) &&
  !r.path.startsWith('/api/v1/portal/');
const isPortalRoute = (r: ApiRoute) =>
  !r.isPublic && r.path.startsWith('/api/v1/portal/:firmSlug/') && r.roles.includes('CLIENT');
const RECORD_PARAMS = /:(id|clientId|engagementId|clientAccountId|userId)\b/;
const keyOf = (r: ApiRoute) => `${r.method} ${r.path}`;

const fx = inject('fixtures');
const tag = randomUUID().slice(0, 8);
let app: INestApplication;
const rec = {} as Record<RecordKey, string>;
const own = {} as Record<'p' | 'q', OwnIds>;
const firms = {} as Record<'p' | 'q', { id: string; slug: string }>;
const user = (key: string) => ({ id: randomUUID(), email: `iso-${key}-${tag}@iso.test` });
const people = {
  ownerP: user('owner-p'),
  staffP: user('staff-p'),
  clientX: user('client-x'),
  clientY: user('client-y'),
  pending: user('pending'),
  ownerQ: user('owner-q'),
  clientQ: user('client-q'),
};
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
  route: ApiRoute,
  path: string,
  who: { email: string },
  firmHeader?: string,
  body?: object,
): Promise<Response> {
  const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
  let req = request(app.getHttpServer())
    [method](path)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  if (firmHeader) req = req.set('x-business-id', firmHeader);
  return route.method === 'GET' || route.method === 'DELETE' ? req : req.send(body ?? {});
}

const show = (res: Response) => `${res.status} ${JSON.stringify(res.body).slice(0, 300)}`;

beforeAll(async () => {
  const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    await runInScope(db, { kind: 'platform' }, async (tx) => {
      for (const [key, p] of Object.entries(people)) {
        const pool = key.startsWith('client') || key === 'pending' ? 'CLIENT' : 'STAFF';
        await tx.user.create({
          data: { id: p.id, cognitoSub: p.id, pool, email: p.email, name: `Fake ${key}` },
        });
      }
      for (const k of ['p', 'q'] as const) {
        firms[k] = await tx.business.create({
          data: { slug: `iso-${k}-${tag}`, name: `Fake Firm ${k} ${tag}`, status: 'ACTIVE' },
          select: { id: true, slug: true },
        });
      }
    });
    const inFirm = <T>(k: 'p' | 'q', fn: Parameters<typeof runInScope<T>>[2]) =>
      runInScope(db, { kind: 'business', businessId: firms[k].id }, fn);

    await inFirm('p', async (tx) => {
      const businessId = firms.p.id;
      await tx.membership.create({
        data: { businessId, userId: people.ownerP.id, role: 'OWNER', status: 'ACTIVE' },
      });
      rec.staffMembership = (
        await tx.membership.create({
          data: { businessId, userId: people.staffP.id, role: 'STAFF', status: 'ACTIVE' },
        })
      ).id;
      rec.staffUser = people.staffP.id;
      const clientOf = async (p: { id: string; email: string }, name: string) => {
        const client = await tx.client.create({
          data: { businessId, displayName: name, email: p.email },
        });
        await tx.clientAccount.create({
          data: { businessId, userId: p.id, clientId: client.id, email: p.email, status: 'ACTIVE' },
        });
        return client.id;
      };
      rec.client = await clientOf(people.clientX, 'Fake Client X');
      await clientOf(people.clientY, 'Fake Client Y');
      rec.pendingClientAccount = (
        await tx.clientAccount.create({
          data: { businessId, userId: people.pending.id, email: people.pending.email },
        })
      ).id;
      const service = await tx.service.create({
        data: { businessId, kind: 'ANNUAL_TAX', name: 'Fake annual tax' },
      });
      own.p = { service: service.id, taxStatus: '' };
      rec.engagement = (
        await tx.engagement.create({
          data: {
            businessId,
            clientId: rec.client,
            serviceId: service.id,
            title: 'Fake 2025 return',
            taxYear: 2025,
          },
        })
      ).id;
      rec.task = (
        await tx.task.create({
          data: {
            businessId,
            clientId: rec.client,
            engagementId: rec.engagement,
            title: 'Fake task',
          },
        })
      ).id;
      const books = await tx.service.create({
        data: { businessId, kind: 'BOOKKEEPING', name: 'Fake bookkeeping' },
      });
      rec.workspace = (
        await tx.engagement.create({
          data: { businessId, clientId: rec.client, serviceId: books.id, title: 'Fake books' },
        })
      ).id;
      rec.report = (
        await tx.engagementReport.create({
          data: { businessId, engagementId: rec.workspace, kind: 'REPORT', title: 'Fake report' },
        })
      ).id;
      rec.document = (
        await tx.document.create({
          data: {
            businessId,
            clientId: rec.client,
            engagementId: rec.engagement,
            direction: 'FIRM_TO_CLIENT',
            fileName: 'fake.pdf',
            contentType: 'application/pdf',
            sizeBytes: 100,
            sha256: createHash('sha256').update(tag).digest('hex'),
            s3Key: `tenant/${businessId}/iso/${tag}/fake.pdf`,
          },
        })
      ).id;
      // As the scanner would: a clean file can be downloaded.
      await tx.document.update({
        where: { id: rec.document },
        data: { scanStatus: 'CLEAN', scannedAt: new Date() },
      });
      rec.appointmentType = (
        await tx.appointmentType.create({
          data: { businessId, name: 'Fake meeting', durationMinutes: 30, clientBookable: true },
        })
      ).id;
      const startsAt = new Date(Date.now() + 7 * 86_400_000);
      rec.appointment = (
        await tx.appointment.create({
          data: {
            businessId,
            clientId: rec.client,
            staffUserId: people.staffP.id,
            typeId: rec.appointmentType,
            startsAt,
            endsAt: new Date(startsAt.getTime() + 30 * 60_000),
            locationKind: 'VIDEO',
          },
        })
      ).id;
      rec.blockedTime = (
        await tx.blockedTime.create({
          data: {
            businessId,
            startsAt: new Date(Date.now() + 3 * 86_400_000),
            endsAt: new Date(Date.now() + 3 * 86_400_000 + 3_600_000),
          },
        })
      ).id;
      rec.content = (
        await tx.contentItem.create({
          data: { businessId, kind: 'TIP', title: 'Fake tip', body: 'Fake body' },
        })
      ).id;
      rec.taxStatus = (await tx.taxStatus.create({ data: { businessId, name: 'Fake status' } })).id;
      own.p.taxStatus = rec.taxStatus;
    });
    await inFirm('q', async (tx) => {
      const businessId = firms.q.id;
      await tx.membership.create({
        data: { businessId, userId: people.ownerQ.id, role: 'OWNER', status: 'ACTIVE' },
      });
      const client = await tx.client.create({
        data: { businessId, displayName: 'Fake Client Q', email: people.clientQ.email },
      });
      own.q = {
        service: (
          await tx.service.create({
            data: { businessId, kind: 'ANNUAL_TAX', name: 'Fake annual tax' },
          })
        ).id,
        taxStatus: (await tx.taxStatus.create({ data: { businessId, name: 'Fake status' } })).id,
      };
      await tx.clientAccount.create({
        data: {
          businessId,
          userId: people.clientQ.id,
          clientId: client.id,
          email: people.clientQ.email,
          status: 'ACTIVE',
        },
      });
    });
  } finally {
    await db.$disconnect();
  }

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
  await app?.close();
});

const fill = (route: ApiRoute, firmSlug: string, records: Record<string, string> = {}) =>
  fillPath(route.path, { firmSlug, ...FIXED_PARAMS, ...records }, randomUUID);

const bodyOf = (c: RecordCase | undefined, firm: 'p' | 'q') =>
  typeof c?.body === 'function' ? c.body(own[firm]) : c?.body;

const recordsOf = (c: RecordCase) =>
  Object.fromEntries(Object.entries(c.params).map(([param, key]) => [param, rec[key]]));

describe('tenant isolation (R8 step 2)', () => {
  it('every route with a record id has a case, and every case a route', () => {
    const routes = apiRoutes(app).filter((r) => isFirmRoute(r) || isPortalRoute(r));
    const needed = routes.filter((r) => RECORD_PARAMS.test(r.path)).map(keyOf);
    expect(
      needed.filter((k) => !(k in RECORD_CASES)),
      'add these to RECORD_CASES',
    ).toEqual([]);
    expect(Object.keys(RECORD_CASES).filter((k) => !needed.includes(k))).toEqual([]);
  });

  it("the records are real: firm P's own people find each one", async () => {
    const failures: string[] = [];
    for (const route of apiRoutes(app).filter((r) => r.method === 'GET')) {
      const c = RECORD_CASES[keyOf(route)];
      if (!c) continue;
      const portal = isPortalRoute(route);
      const res = await call(
        route,
        fill(route, firms.p.slug, recordsOf(c)),
        portal ? people.clientX : people.ownerP,
        portal ? undefined : firms.p.id,
      );
      // Found: a download may still answer 503 here, with no file store in tests.
      if (res.status === 404 || res.status === 400) failures.push(`${keyOf(route)}: ${show(res)}`);
    }
    expect(failures).toEqual([]);
  });

  it('a member of firm Q gets 404 naming firm P, on every firm route', async () => {
    const failures: string[] = [];
    for (const route of apiRoutes(app).filter(isFirmRoute)) {
      const c = RECORD_CASES[keyOf(route)];
      const path = fill(route, firms.p.slug, c ? recordsOf(c) : {});
      const res = await call(route, path, people.ownerQ, firms.p.id, bodyOf(c, 'p'));
      if (res.status !== 404) failures.push(`${keyOf(route)}: ${show(res)}`);
    }
    expect(failures).toEqual([]);
  });

  it("a member of firm Q gets 404 on firm P's records by id, in firm Q", async () => {
    const failures: string[] = [];
    for (const route of apiRoutes(app).filter(isFirmRoute)) {
      const c = RECORD_CASES[keyOf(route)];
      if (!c) continue;
      const res = await call(
        route,
        fill(route, firms.q.slug, recordsOf(c)),
        people.ownerQ,
        firms.q.id,
        bodyOf(c, 'q'),
      );
      if (res.status !== 404) failures.push(`${keyOf(route)}: ${show(res)}`);
    }
    expect(failures).toEqual([]);
  });

  it("a client of firm P gets 404 at firm Q's portal, on every client route", async () => {
    const failures: string[] = [];
    for (const route of apiRoutes(app).filter(isPortalRoute)) {
      const c = RECORD_CASES[keyOf(route)];
      const res = await call(
        route,
        fill(route, firms.q.slug, c ? recordsOf(c) : {}),
        people.clientX,
        undefined,
        bodyOf(c, 'q'),
      );
      if (res.status !== 404) failures.push(`${keyOf(route)}: ${show(res)}`);
    }
    expect(failures).toEqual([]);
  });

  it("client Y gets 404 on client X's records in the same firm", async () => {
    const failures: string[] = [];
    for (const route of apiRoutes(app).filter(isPortalRoute)) {
      const c = RECORD_CASES[keyOf(route)];
      if (!c) continue;
      const res = await call(
        route,
        fill(route, firms.p.slug, recordsOf(c)),
        people.clientY,
        undefined,
        bodyOf(c, 'p'),
      );
      if (res.status !== 404) failures.push(`${keyOf(route)}: ${show(res)}`);
    }
    expect(failures).toEqual([]);
  });
});
