// End-to-end: the Client Portal module, API part 2 (Client Portal developer instructions 15, 16,
// 18, 20 and 26): Portal Content & Visibility for one client (on top of the firm's switches,
// enforced on the portal API and menu), Deactivate and Reactivate Portal, Reset Client Access,
// MFA reset and the Documents and Intake Forms KPIs. Owner and Admin change; firm B never.
// Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  ClientPortalAccessResult,
  ClientPortalDocumentsSummary,
  ClientPortalFormsSummary,
  ClientPortalPreview,
  ClientPortalVisibility,
  PortalTabs,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
let app: INestApplication;
const run = randomUUID().slice(0, 8);
const firms = { a: { id: '', slug: `r60-cpa-a-${run}` }, b: { id: '', slug: `r60-cpa-b-${run}` } };
type Who = { id: string; email: string };
const person = (key: string): Who => ({
  id: randomUUID(),
  email: `r60-cpa-${key}-${run}@r60.test`,
});
const owner = person('owner');
const staff = person('staff');
const ownerB = person('ownerb');
const login = person('x');
const clients = { x: '', n: '' };
const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
const inFirm = <T>(work: Parameters<typeof runInScope<T>>[2]) =>
  runInScope(db, { kind: 'business', businessId: firms.a.id }, work);

const tokens = new Map<string, string>();
async function send(method: 'get' | 'put' | 'post', path: string, who: Who, body?: object) {
  let token = tokens.get(who.email);
  if (!token) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/dev/token')
      .send({ email: who.email });
    token = (res.body as { token: string }).token;
    tokens.set(who.email, token);
  }
  const req = request(app.getHttpServer())
    [method](`/api/v1${path}`)
    .set('authorization', `Bearer ${token}`);
  return method === 'get' ? req : req.send(body ?? {});
}
const code = (res: request.Response) => (res.body as { error?: { code: string } }).error?.code;
const cp = (clientId: string, path = '') => `/business/client-portal/clients/${clientId}${path}`;
const audited = (action: string) =>
  inFirm((tx) =>
    tx.auditLog.findMany({
      where: { businessId: firms.a.id, action, entityId: clients.x },
      select: { metadata: true },
    }),
  );

beforeAll(async () => {
  await runInScope(db, { kind: 'platform' }, async (tx) => {
    for (const firm of [firms.a, firms.b]) {
      firm.id = (
        await tx.business.create({ data: { slug: firm.slug, name: firm.slug, status: 'ACTIVE' } })
      ).id;
    }
    for (const [u, pool] of [
      [owner, 'STAFF'],
      [staff, 'STAFF'],
      [ownerB, 'STAFF'],
      [login, 'CLIENT'],
    ] as const) {
      await tx.user.create({
        data: { id: u.id, cognitoSub: u.id, pool, email: u.email, name: 'Fake R60 access' },
      });
    }
  });
  await runInScope(db, { kind: 'business', businessId: firms.b.id }, (tx) =>
    tx.membership.create({
      data: { businessId: firms.b.id, userId: ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    }),
  );
  await inFirm(async (tx) => {
    const businessId = firms.a.id;
    for (const [u, role] of [
      [owner, 'OWNER'],
      [staff, 'STAFF'],
    ] as const) {
      await tx.membership.create({ data: { businessId, userId: u.id, role, status: 'ACTIVE' } });
    }
    clients.x = (
      await tx.client.create({
        data: { businessId, displayName: 'Fake Access Client', assignedUserId: staff.id },
      })
    ).id;
    clients.n = (await tx.client.create({ data: { businessId, displayName: 'Fake No Login' } })).id;
    await tx.clientAccount.create({
      data: {
        businessId,
        userId: login.id,
        email: login.email,
        clientId: clients.x,
        portalRole: 'PRIMARY',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        phoneVerifiedAt: new Date(),
      },
    });
    const service = await tx.service.create({
      data: { businessId, kind: 'ANNUAL_TAX', name: 'Fake Personal Tax' },
    });
    const engagement = await tx.engagement.create({
      data: { businessId, clientId: clients.x, serviceId: service.id, title: 'Fake return' },
    });
    for (const direction of ['CLIENT_TO_FIRM', 'CLIENT_TO_FIRM', 'FIRM_TO_CLIENT'] as const) {
      const tag = randomUUID();
      await tx.document.create({
        data: {
          businessId,
          clientId: clients.x,
          engagementId: engagement.id,
          direction,
          fileName: 'fake.pdf',
          contentType: 'application/pdf',
          sizeBytes: 100,
          sha256: tag.replace(/-/g, '').padEnd(64, '0'),
          s3Key: `tenant/${businessId}/e2e/${tag}.pdf`,
          reviewStatus: direction === 'CLIENT_TO_FIRM' ? 'NEEDS_REVIEW' : null,
        },
      });
    }
    await tx.documentRequest.create({
      data: { businessId, clientId: clients.x, engagementId: engagement.id, title: 'Fake W-2' },
    });
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
  await nest.init();
  app = nest;
});

afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

describe('Portal Content & Visibility', () => {
  it("hides an area from this client's menu and routes only, on top of the firm's switches", async () => {
    const start = ClientPortalVisibility.parse(
      (await send('get', cp(clients.x, '/visibility'), staff)).body,
    );
    expect(start.canChange).toBe(false);
    expect(start.areas.every((a) => a.visible && a.firmOn && a.clientOn)).toBe(true);
    expect(start.areas).toHaveLength(8);

    const set = await send('put', cp(clients.x, '/visibility'), owner, {
      areas: { APPOINTMENTS: false, MESSAGES: false },
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const after = ClientPortalVisibility.parse(set.body);
    expect(after.areas.filter((a) => !a.visible).map((a) => a.module)).toEqual([
      'APPOINTMENTS',
      'MESSAGES',
    ]);
    expect((await audited('client_portal.visibility_changed')).map((r) => r.metadata)).toEqual([
      { shown: [], hidden: ['APPOINTMENTS', 'MESSAGES'] },
    ]);
    // The same again writes nothing.
    await send('put', cp(clients.x, '/visibility'), owner, { areas: { MESSAGES: false } });
    expect(await audited('client_portal.visibility_changed')).toHaveLength(1);

    const menu = PortalTabs.parse(
      (await send('get', `/portal/${firms.a.slug}/me/tabs`, login)).body,
    );
    expect(menu.tabs.MESSAGES).toBe(false);
    expect(menu.tabs.DOCUMENTS).toBe(true);
    expect(menu.more).toEqual({ APPOINTMENTS: false, TASKS_REQUESTS: true, REPORTS: true });
    for (const path of ['me/appointments', 'me/messages']) {
      const res = await send('get', `/portal/${firms.a.slug}/${path}`, login);
      expect([path, res.status, code(res)]).toEqual([path, 403, 'MODULE_OFF']);
    }
    await send('put', cp(clients.x, '/visibility'), owner, {
      areas: { APPOINTMENTS: true, MESSAGES: true },
    });
    expect((await send('get', `/portal/${firms.a.slug}/me/appointments`, login)).status).toBe(200);

    // The firm's switch off wins over the client's on.
    await send('put', '/business/settings/portal-tabs', owner, { tabs: { TAX_RETURNS: false } });
    const firmOff = ClientPortalVisibility.parse(
      (await send('get', cp(clients.x, '/visibility'), owner)).body,
    ).areas.find((a) => a.module === 'TAX_RETURNS');
    expect(firmOff).toEqual({
      module: 'TAX_RETURNS',
      firmOn: false,
      clientOn: true,
      visible: false,
    });
    await send('put', '/business/settings/portal-tabs', owner, { tabs: { TAX_RETURNS: true } });
  });

  it('is Owner and Admin to change, and never another firm or client', async () => {
    expect(
      (await send('put', cp(clients.x, '/visibility'), staff, { areas: { REPORTS: false } }))
        .status,
    ).toBe(403);
    expect((await send('get', cp(clients.x, '/visibility'), ownerB)).status).toBe(404);
    expect(
      (await send('put', cp(clients.x, '/visibility'), ownerB, { areas: { REPORTS: false } }))
        .status,
    ).toBe(404);
    expect((await send('get', cp(clients.n, '/visibility'), staff)).status).toBe(404);
    for (const body of [
      { areas: {} },
      { areas: { ROBOTS: false } },
      { areas: { REPORTS: 'no' } },
    ]) {
      expect((await send('put', cp(clients.x, '/visibility'), owner, body)).status).toBe(400);
    }
  });
});

describe('access actions', () => {
  it('deactivates every active login at once and reactivates the same ones', async () => {
    const off = await send('post', cp(clients.x, '/deactivate'), owner);
    expect(ClientPortalAccessResult.parse(off.body)).toEqual({ changed: 1 });
    expect((await send('get', `/portal/${firms.a.slug}/me/tabs`, login)).status).toBe(404);
    expect(code(await send('post', cp(clients.x, '/deactivate'), owner))).toBe('NO_ACTIVE_LOGIN');

    const on = await send('post', cp(clients.x, '/reactivate'), owner);
    expect(ClientPortalAccessResult.parse(on.body)).toEqual({ changed: 1 });
    expect((await send('get', `/portal/${firms.a.slug}/me/tabs`, login)).status).toBe(200);
    expect(code(await send('post', cp(clients.x, '/reactivate'), owner))).toBe('NOT_DEACTIVATED');
    expect(await audited('client_portal.deactivated')).toHaveLength(1);
    expect(await audited('client_portal.reactivated')).toHaveLength(1);
  });

  it('resets access and MFA for the active logins, audited, and refuses a client with none', async () => {
    for (const path of ['/reset-access', '/mfa/reset']) {
      const res = await send('post', cp(clients.x, path), owner);
      expect([path, res.status, res.body]).toEqual([path, 200, { changed: 1 }]);
      expect(code(await send('post', cp(clients.n, path), owner))).toBe('NO_ACTIVE_LOGIN');
      expect((await send('post', cp(clients.x, path), staff)).status).toBe(403);
      expect((await send('post', cp(clients.x, path), ownerB)).status).toBe(404);
    }
    expect(await audited('client_portal.access_reset')).toHaveLength(1);
    expect(await audited('client_portal.mfa_reset')).toHaveLength(1);
    const staffRows = await inFirm((tx) =>
      tx.clientPortalActivity.findMany({
        where: { clientId: clients.x, actorKind: 'STAFF' },
        orderBy: { occurredAt: 'asc' },
        select: { type: true },
      }),
    );
    expect(staffRows.map((r) => r.type)).toEqual([
      'portal.visibility_changed',
      'portal.visibility_changed',
      'portal.deactivated',
      'portal.reactivated',
      'portal.access_reset',
      'portal.mfa_reset',
    ]);
  });
});

describe('Open Client Portal preview', () => {
  it("shows the firm's portal text and the client's areas, audited, never firm B's", async () => {
    const res = await send('get', cp(clients.x, '/preview'), staff);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const p = ClientPortalPreview.parse(res.body);
    expect(p.clientName).toBe('Fake Access Client');
    expect(p.firmName).toBe(firms.a.slug);
    expect(p.areas).toHaveLength(8);
    expect(await audited('client_portal.preview_opened')).toHaveLength(1);
    expect((await send('get', cp(clients.x, '/preview'), ownerB)).status).toBe(404);
    expect((await send('get', cp(clients.n, '/preview'), staff)).status).toBe(404);
  });
});

describe('KPIs', () => {
  it("counts the client's documents and forms, for Staff on their own client", async () => {
    const docs = await send('get', cp(clients.x, '/documents/summary'), staff);
    expect(ClientPortalDocumentsSummary.parse(docs.body)).toEqual({
      total: 3,
      clientUploaded: 2,
      firmShared: 1,
      pendingReview: 2,
      requested: 1,
    });
    const forms = await send('get', cp(clients.x, '/forms/summary'), owner);
    expect(ClientPortalFormsSummary.parse(forms.body)).toEqual({
      total: 0,
      completed: 0,
      needsReview: 0,
      inProgress: 0,
      notStarted: 0,
      archived: 0,
    });
    expect((await send('get', cp(clients.x, '/forms/summary'), ownerB)).status).toBe(404);
  });
});
