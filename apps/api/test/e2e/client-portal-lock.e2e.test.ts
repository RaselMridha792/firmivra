// End-to-end: the Client Portal module's Lock and Unlock Portal Access, and the copy of a client's
// own portal actions into `client_portal_activity` (Client Portal developer instructions 15, 24
// and 26). A locked client is refused at sign-in, on refresh, by `GET me` and on every portal
// request; unlocked, they sign in again. Owner and Admin only; firm B is never touched. AUTH_MODE
// local: every password is the local one. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, type Database, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { ClientPortalLock, portalCookies, type SignInResult } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { AuditService } from '../../src/audit/audit.service.js';
import { LOCAL_PASSWORD } from '../../src/auth/identity/local-identity.provider.js';
import { requestContext, type RequestStore } from '../../src/common/request-context.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { DATABASE } from '../../src/database/database.module.js';

const fx = inject('fixtures');
let app: INestApplication;
let portalOrigin = '';
const run = randomUUID().slice(0, 8);
const firms = {
  a: { id: '', slug: `r60-lock-a-${run}` },
  b: { id: '', slug: `r60-lock-b-${run}` },
};
type Who = { id: string; email: string };
const person = (key: string): Who => ({
  id: randomUUID(),
  email: `r60-lock-${key}-${run}@r60.test`,
});
const owner = person('owner');
const admin = person('admin');
const staff = person('staff');
const ownerB = person('owner-b');
/** Client X (locked in the tests), client Y of the same firm, client Z of firm B. */
const logins = { x: person('x'), y: person('y'), z: person('z') };
const clients = { x: '', y: '', z: '' };
const accounts = { x: '', y: '', z: '' };
const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
const inFirm = <T>(firm: 'a' | 'b', work: Parameters<typeof runInScope<T>>[2]) =>
  runInScope(db, { kind: 'business', businessId: firms[firm].id }, work);

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const setCookies = (res: Response): string[] => {
  const raw = res.headers['set-cookie'] as unknown;
  return Array.isArray(raw) ? (raw as string[]) : [];
};

let lastViewer = 0;
/** A browser on a firm's portal: its own viewer IP, the portal origin and a cookie jar. */
function browser() {
  const viewer = `198.19.60.${++lastViewer}`;
  const jar: Record<string, string> = {};
  const keep = (res: Response) => {
    for (const c of setCookies(res)) {
      const pair = c.split(';')[0] ?? '';
      const at = pair.indexOf('=');
      const [name, value] = [pair.slice(0, at), pair.slice(at + 1)];
      if (value) jar[name] = value;
      else delete jar[name];
    }
    return res;
  };
  const cookie = () =>
    Object.entries(jar)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  return {
    viewer,
    jar,
    post: (path: string, body?: object) => {
      const req = request(app.getHttpServer())
        .post(`/api/v1/portal/${path}`)
        .set('x-forwarded-for', `${viewer}, 10.0.0.5`)
        .set('origin', portalOrigin)
        .set('cookie', cookie());
      return (body ? req.send(body) : req).then(keep);
    },
    get: (path: string) =>
      request(app.getHttpServer())
        .get(`/api/v1/portal/${path}`)
        .set('x-forwarded-for', `${viewer}, 10.0.0.5`)
        .set('cookie', cookie())
        .then(keep),
  };
}
const signIn = (b: ReturnType<typeof browser>, firm: { slug: string }, who: Who) =>
  b.post(`${firm.slug}/auth/sign-in`, { email: who.email, password: LOCAL_PASSWORD });
const signedIn = (res: Response) =>
  (res.body as SignInResult).status === 'SIGNED_IN' ? res.status : JSON.stringify(res.body);

const tokens = new Map<string, string>();
async function staffCall(who: Who, action: 'lock' | 'unlock', clientId: string, body?: object) {
  let token = tokens.get(who.email);
  if (!token) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/dev/token')
      .send({ email: who.email });
    token = (res.body as { token: string }).token;
    tokens.set(who.email, token);
  }
  return request(app.getHttpServer())
    .post(`/api/v1/business/client-portal/clients/${clientId}/${action}`)
    .set('authorization', `Bearer ${token}`)
    .send(body ?? {});
}

const auditRows = (action: string) =>
  inFirm('a', (tx) =>
    tx.auditLog.findMany({
      where: { businessId: firms.a.id, action, entityId: clients.x },
      select: { metadata: true },
    }),
  );
const activityOf = (firm: 'a' | 'b', clientId: string) =>
  inFirm(firm, (tx) =>
    tx.clientPortalActivity.findMany({
      where: { clientId },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
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
      [admin, 'STAFF'],
      [staff, 'STAFF'],
      [ownerB, 'STAFF'],
      [logins.x, 'CLIENT'],
      [logins.y, 'CLIENT'],
      [logins.z, 'CLIENT'],
    ] as const) {
      await tx.user.create({
        data: { id: u.id, cognitoSub: u.id, pool, email: u.email, name: 'Fake R60 lock' },
      });
    }
  });
  for (const [firm, people] of [
    [
      'a',
      [
        [owner, 'OWNER'],
        [admin, 'ADMIN'],
        [staff, 'STAFF'],
      ],
    ],
    ['b', [[ownerB, 'OWNER']]],
  ] as const) {
    await inFirm(firm, async (tx) => {
      for (const [u, role] of people) {
        await tx.membership.create({
          data: { businessId: firms[firm].id, userId: u.id, role, status: 'ACTIVE' },
        });
      }
    });
  }
  for (const [key, firm] of [
    ['x', 'a'],
    ['y', 'a'],
    ['z', 'b'],
  ] as const) {
    await inFirm(firm, async (tx) => {
      const businessId = firms[firm].id;
      clients[key] = (
        await tx.client.create({
          data: { businessId, displayName: `Fake Lock Client ${key.toUpperCase()}` },
          select: { id: true },
        })
      ).id;
      accounts[key] = (
        await tx.clientAccount.create({
          data: {
            businessId,
            userId: logins[key].id,
            email: logins[key].email,
            clientId: clients[key],
            portalRole: 'PRIMARY',
            status: 'ACTIVE',
            emailVerifiedAt: new Date(),
            phoneVerifiedAt: new Date(),
          },
          select: { id: true },
        })
      ).id;
    });
  }
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  portalOrigin = new URL(env.PORTAL_BASE_URL).origin;
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

describe('Lock Portal Access', () => {
  it('refuses a locked client at sign-in, on refresh, by me and on every portal request, and lets them back once unlocked', async () => {
    const a = firms.a;
    const b = browser();
    expect(signedIn(await signIn(b, a, logins.x))).toBe(200);
    expect((await b.get(`${a.slug}/me/tabs`)).status).toBe(200);
    const access = b.jar[portalCookies(a.slug).access] ?? '';

    const locked = await staffCall(owner, 'lock', clients.x, { reason: 'Fake: asked by phone' });
    expect(locked.status, JSON.stringify(locked.body)).toBe(200);
    expect(ClientPortalLock.parse(locked.body)).toMatchObject({
      clientId: clients.x,
      locked: true,
      lockedBy: 'Fake R60 lock',
      reason: 'Fake: asked by phone',
    });

    // The session they had ends at once: every portal request, `me` and the refresh.
    const tabs = await b.get(`${a.slug}/me/tabs`);
    expect([tabs.status, codeOf(tabs)]).toEqual([404, 'NOT_FOUND']);
    const me = await request(app.getHttpServer())
      .get(`/api/v1/portal/${a.slug}/me`)
      .set('cookie', `${portalCookies(a.slug).access}=${access}`);
    expect([me.status, codeOf(me)]).toEqual([401, 'UNAUTHENTICATED']);
    const refreshed = await b.post(`${a.slug}/auth/refresh`);
    expect([refreshed.status, codeOf(refreshed)]).toEqual([401, 'UNAUTHENTICATED']);
    // A new sign-in gets a wrong password's answer, so the lock never shows to a guesser.
    const again = await signIn(browser(), a, logins.x);
    expect([again.status, codeOf(again)]).toEqual([401, 'INVALID_CREDENTIALS']);
    expect(setCookies(again)).toEqual([]);

    // Client Y of the same firm and client Z of firm B carry on.
    for (const [firm, who] of [
      [a, logins.y],
      [firms.b, logins.z],
    ] as const) {
      const other = browser();
      expect(signedIn(await signIn(other, firm, who))).toBe(200);
      expect((await other.get(`${firm.slug}/me/tabs`)).status).toBe(200);
    }

    const unlocked = await staffCall(admin, 'unlock', clients.x);
    expect(ClientPortalLock.parse(unlocked.body)).toEqual({
      clientId: clients.x,
      locked: false,
      lockedAt: null,
      lockedBy: null,
      reason: null,
    });
    const back = browser();
    expect(signedIn(await signIn(back, a, logins.x))).toBe(200);
    expect((await back.get(`${a.slug}/me/tabs`)).status).toBe(200);

    // Audited without the reason; the client's activity shows both, by a member.
    expect((await auditRows('client_portal.locked')).map((r) => r.metadata)).toEqual([
      { reasonGiven: true },
    ]);
    expect(await auditRows('client_portal.unlocked')).toHaveLength(1);
    const staffRows = (await activityOf('a', clients.x)).filter((r) => r.actorKind === 'STAFF');
    expect(staffRows.map((r) => [r.type, r.actorUserId])).toEqual([
      ['portal.locked', owner.id],
      ['portal.unlocked', admin.id],
    ]);
  });

  it('is Owner and Admin only; firm B gets 404 and changes nothing; twice writes once', async () => {
    expect((await staffCall(staff, 'lock', clients.x)).status).toBe(403);
    const foreign = await staffCall(ownerB, 'lock', clients.x);
    expect([foreign.status, codeOf(foreign)]).toEqual([404, 'NOT_FOUND']);
    expect((await staffCall(ownerB, 'unlock', clients.x)).status).toBe(404);
    expect(
      await inFirm('a', (tx) => tx.clientPortalLock.count({ where: { clientId: clients.x } })),
    ).toBe(0);
    expect((await staffCall(owner, 'lock', randomUUID())).status).toBe(404);
    for (const body of [{ reason: 'x'.repeat(201) }, { reason: 'ok', extra: true }]) {
      expect((await staffCall(owner, 'lock', clients.x, body)).status).toBe(400);
    }

    const before = (await auditRows('client_portal.locked')).length;
    await staffCall(owner, 'lock', clients.x);
    const twice = await staffCall(admin, 'lock', clients.x);
    expect(ClientPortalLock.parse(twice.body)).toMatchObject({ locked: true, reason: null });
    expect(await auditRows('client_portal.locked')).toHaveLength(before + 1);
    await staffCall(owner, 'unlock', clients.x);
    await staffCall(owner, 'unlock', clients.x);
    expect(await auditRows('client_portal.unlocked')).toHaveLength(2);
  });
});

describe('the portal activity copy', () => {
  it("copies a client's sign-in and sign-out with their login and IP, and no content", async () => {
    const before = (await activityOf('a', clients.y)).length;
    const b = browser();
    expect(signedIn(await signIn(b, firms.a, logins.y))).toBe(200);
    await b.post(`${firms.a.slug}/auth/sign-out`, {});
    const rows = (await activityOf('a', clients.y)).slice(before);
    expect(rows.map((r) => r.type)).toEqual(['portal.signed_in', 'portal.signed_out']);
    for (const r of rows) {
      expect(r).toMatchObject({
        businessId: firms.a.id,
        clientAccountId: accounts.y,
        actorKind: 'CLIENT',
        actorUserId: null,
        entityType: 'user',
        entityId: logins.y.id,
        ip: b.viewer,
      });
    }
  });

  it('copies only the listed actions of a client login of that firm, never staff, and rolls back with the action', async () => {
    const audit = app.get(AuditService);
    const database = app.get<Database>(DATABASE);
    const asClient = (store: Partial<RequestStore>, work: () => Promise<void>) =>
      requestContext.run({ requestId: randomUUID(), ip: '198.19.60.200', ...store }, work);
    const clientStore = (key: 'y' | 'z', firm: 'a' | 'b'): Partial<RequestStore> => ({
      auth: { userId: logins[key].id, cognitoSub: logins[key].id, pool: 'CLIENT' },
      tenant: {
        businessId: firms[firm].id,
        role: 'CLIENT',
        kind: 'client',
        clientAccountId: accounts[key],
      },
    });
    const thread = randomUUID();
    const firmRows = () => inFirm('a', (tx) => tx.clientPortalActivity.count());
    const before = (await activityOf('a', clients.y)).length;
    const firmBefore = await firmRows();

    // Listed, by client Y: copied, with the entity and none of the metadata.
    await asClient(clientStore('y', 'a'), () =>
      audit.log('message.sent', { type: 'message_thread', id: thread }, { body: 'Fake secret' }),
    );
    // Not listed (a view): nothing.
    await asClient(clientStore('y', 'a'), () =>
      audit.log('portal.profile_viewed', { type: 'client', id: clients.y }),
    );
    // A member's listed action: nothing.
    await asClient(
      {
        auth: { userId: owner.id, cognitoSub: owner.id, pool: 'STAFF' },
        tenant: { businessId: firms.a.id, role: 'OWNER', kind: 'staff' },
      },
      () => audit.log('message.sent', { type: 'message_thread', id: thread }),
    );
    // Firm B's client named as the actor of a row in firm A: not firm A's login, nothing.
    await asClient({}, () =>
      audit.log(
        'auth.signed_in',
        { type: 'user', id: logins.z.id },
        {},
        { businessId: firms.a.id, actorUserId: logins.z.id },
      ),
    );
    // In the action's transaction: rolled back with it.
    await expect(
      asClient(clientStore('y', 'a'), () =>
        database.withScope({ kind: 'business', businessId: firms.a.id }, async (tx) => {
          await audit.logIn(tx, 'intake.submitted', { type: 'intake', id: randomUUID() });
          throw new Error('fake failure after the action');
        }),
      ),
    ).rejects.toThrow('fake failure');

    const rows = (await activityOf('a', clients.y)).slice(before);
    expect(rows.map((r) => [r.type, r.entityType, r.entityId, r.ip])).toEqual([
      ['message.sent', 'message_thread', thread, '198.19.60.200'],
    ]);
    expect(Object.keys(rows[0] ?? {})).not.toContain('metadata');
    // Nothing else anywhere in firm A: not for the member, firm B's login or the rolled-back one.
    expect(await firmRows()).toBe(firmBefore + 1);
  });
});
