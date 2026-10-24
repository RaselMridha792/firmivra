// End-to-end: Settings > Client Portal > Features, the parts without schema (R55; Client Portal
// guide 5 and 7.2, Rasel, Oct 24). Owner and Admin turn five portal tabs on and off; the portal's
// menu reads them; and a hidden tab's routes answer 403 MODULE_OFF to the client, not only the
// menu hiding them. Turning a tab back on restores it; nothing is deleted. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { PortalTabs } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
let app: INestApplication;
const run = randomUUID().slice(0, 8);
/** A firm of this file only: switching its tabs never touches another file's firm. */
const slug = `r55-tabs-${run}`;
let firmId = '';
const person = (key: string) => ({ id: randomUUID(), email: `r55-tabs-${key}-${run}@r55.test` });
const owner = person('owner');
const admin = person('admin');
const staff = person('staff');
const client = person('client');
const ALL_ON = {
  INTAKE_FORMS: true,
  DOCUMENTS: true,
  TAX_RETURNS: true,
  INVOICES_PAYMENTS: true,
  MESSAGES: true,
};

beforeAll(async () => {
  const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  const firm = await runInScope(db, { kind: 'platform' }, async (tx) => {
    for (const [u, pool] of [
      [owner, 'STAFF'],
      [admin, 'STAFF'],
      [staff, 'STAFF'],
      [client, 'CLIENT'],
    ] as const) {
      await tx.user.create({
        data: { id: u.id, cognitoSub: u.id, pool, email: u.email, name: 'Fake R55 tabs' },
      });
    }
    return tx.business.create({ data: { slug, name: slug, status: 'ACTIVE' } });
  });
  firmId = firm.id;
  await runInScope(db, { kind: 'business', businessId: firm.id }, async (tx) => {
    for (const [u, role] of [
      [owner, 'OWNER'],
      [admin, 'ADMIN'],
      [staff, 'STAFF'],
    ] as const) {
      await tx.membership.create({
        data: { businessId: firm.id, userId: u.id, role, status: 'ACTIVE' },
      });
    }
    await tx.clientAccount.create({
      data: { businessId: firm.id, userId: client.id, email: client.email, status: 'ACTIVE' },
    });
  });
  await db.$disconnect();
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
});

/** One token per person: the dev token route allows 30 a minute. */
const tokens = new Map<string, string>();
async function tokenOf(email: string): Promise<string> {
  let token = tokens.get(email);
  if (!token) {
    const res = await request(app.getHttpServer()).post('/api/v1/dev/token').send({ email });
    token = (res.body as { token: string }).token;
    tokens.set(email, token);
  }
  return token;
}
async function send(
  method: 'get' | 'put' | 'post',
  path: string,
  who: { email: string },
  body?: object,
) {
  const token = await tokenOf(who.email);
  const req = request(app.getHttpServer())
    [method](`/api/v1${path}`)
    .set('authorization', `Bearer ${token}`);
  return body ? req.send(body) : req;
}
const code = (res: request.Response) => (res.body as { error?: { code: string } }).error?.code;
const SETTINGS = '/business/settings/portal-tabs';
const save = (who: { email: string }, tabs: object) => send('put', SETTINGS, who, { tabs });

/** One route of each tab, as the portal calls it. */
const tabRoutes = (s: string) =>
  [
    ['INTAKE_FORMS', 'get', `/portal/${s}/me/intakes`],
    ['INTAKE_FORMS', 'get', `/portal/${s}/me/intakes/${randomUUID()}/agreements`],
    ['TAX_RETURNS', 'get', `/portal/${s}/me/tax-returns`],
    ['INVOICES_PAYMENTS', 'get', `/portal/${s}/me/invoices`],
    ['MESSAGES', 'get', `/portal/${s}/me/messages`],
    ['MESSAGES', 'get', `/portal/${s}/me/notes`],
  ] as const;

describe('Settings > Client Portal > Features (portal tabs)', () => {
  it('starts with every tab on, for the firm and in the portal menu', async () => {
    const firm = await send('get', SETTINGS, owner);
    expect(firm.status).toBe(200);
    expect(PortalTabs.parse(firm.body)).toEqual({ tabs: ALL_ON });
    const menu = await send('get', `/portal/${slug}/me/tabs`, client);
    expect(PortalTabs.parse(menu.body)).toEqual({ tabs: ALL_ON });
  });

  it('lets Owner and Admin switch tabs, audited by tab, and never Staff or a client', async () => {
    expect((await save(staff, { TAX_RETURNS: false })).status).toBe(403);
    expect((await send('get', SETTINGS, staff)).status).toBe(403);
    expect((await save(client, { TAX_RETURNS: false })).status).toBe(403);
    for (const bad of [{}, { REPORTS: false }, { TAX_RETURNS: 'no' }]) {
      expect(code(await save(owner, bad))).toBe('VALIDATION_FAILED');
    }

    const off = await save(admin, { TAX_RETURNS: false, MESSAGES: false });
    expect(off.status).toBe(200);
    expect(PortalTabs.parse(off.body).tabs).toEqual({
      ...ALL_ON,
      TAX_RETURNS: false,
      MESSAGES: false,
    });
    // Saving the same again changes nothing and logs nothing.
    await save(owner, { TAX_RETURNS: false, INTAKE_FORMS: true });
    const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
    const logs = await runInScope(db, { kind: 'business', businessId: firmId }, (tx) =>
      tx.auditLog.findMany({
        where: { action: 'portal.tabs_changed' },
        select: { actorUserId: true, metadata: true },
      }),
    );
    await db.$disconnect();
    expect(logs).toEqual([
      { actorUserId: admin.id, metadata: { turnedOn: [], turnedOff: ['TAX_RETURNS', 'MESSAGES'] } },
    ]);
    const menu = await send('get', `/portal/${slug}/me/tabs`, client);
    expect(PortalTabs.parse(menu.body).tabs).toMatchObject({ TAX_RETURNS: false, MESSAGES: false });
  });

  it("refuses a hidden tab's routes with 403 MODULE_OFF, and opens them again when it is on", async () => {
    await save(owner, {
      INTAKE_FORMS: false,
      INVOICES_PAYMENTS: false,
      TAX_RETURNS: false,
      MESSAGES: false,
    });
    for (const [tab, method, path] of tabRoutes(slug)) {
      const res = await send(method, path, client);
      expect([tab, res.status, code(res)]).toEqual([tab, 403, 'MODULE_OFF']);
    }
    // Pay an invoice too (checkout).
    const pay = await send(
      'post',
      `/portal/${slug}/me/invoices/${randomUUID()}/checkout`,
      client,
      {},
    );
    expect([pay.status, code(pay)]).toEqual([403, 'MODULE_OFF']);

    await save(owner, ALL_ON);
    for (const [tab, method, path] of tabRoutes(slug)) {
      const res = await send(method, path, client);
      expect([tab, code(res)]).not.toEqual([tab, 'MODULE_OFF']);
    }
  });

  it('with Upload Documents off, refuses a free upload but takes a file the firm requested', async () => {
    await save(owner, { DOCUMENTS: false });
    const file = {
      serviceId: randomUUID(),
      fileName: 'w2.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1000,
      sha256: 'a'.repeat(64),
    };
    const free = await send('post', `/portal/${slug}/me/documents/uploads`, client, file);
    expect([free.status, code(free)]).toEqual([403, 'MODULE_OFF']);
    const requested = await send('post', `/portal/${slug}/me/documents/uploads`, client, {
      ...file,
      requestId: randomUUID(),
    });
    // Past the switch: the unknown service and request answer as before.
    expect(code(requested)).not.toBe('MODULE_OFF');
    // Firm documents stay readable (the Business Documents & Resources tab uses them).
    expect((await send('get', `/portal/${slug}/me/documents`, client)).status).toBe(200);
    await save(owner, { DOCUMENTS: true });
  });

  it("keeps each firm's tabs its own", async () => {
    await save(owner, { MESSAGES: false });
    const other = await send('get', `/portal/${fx.firmA.slug}/me/tabs`, fx.users.clientA);
    expect(PortalTabs.parse(other.body)).toEqual({ tabs: ALL_ON });
    expect(
      code(await send('get', `/portal/${fx.firmA.slug}/me/messages`, fx.users.clientA)),
    ).not.toBe('MODULE_OFF');
    // Another firm's client never reads this firm's tabs.
    expect((await send('get', `/portal/${slug}/me/tabs`, fx.users.clientA)).status).toBe(404);
    await save(owner, { MESSAGES: true });
  });
});
