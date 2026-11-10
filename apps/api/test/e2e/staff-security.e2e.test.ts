// End-to-end: R55, Staff Account Access & Security (contract in packages/types/src/staff): the
// sign-in rules, Active Sessions, Login History, activity, and the password and MFA resets.
// Owner and Admin; a change needs a role the actor manages; firm B reaches none of firm A's.
// SM4: a real sign-in opens a session row per firm, and a session the firm ends answers 401.
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  type MfaSetupResponse,
  type SignInResult,
  StaffActionResult,
  StaffActivityPage,
  StaffLoginHistory,
  StaffSecurity,
  StaffSessionList,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import {
  LOCAL_MFA_CODE,
  LOCAL_PASSWORD,
  LOCAL_RESET_CODE,
} from '../../src/auth/identity/local-identity.provider.js';
import { BACKGROUND_HEADER, FIRM_SESSION_STARTED } from '../../src/auth/staff-sessions.js';
import { TokenService } from '../../src/auth/token.service.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55x-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  admin2A: person('admin2-a'),
  staffA: person('staff-a'),
  managerA: person('manager-a'),
  invitedA: person('invited-a'),
  ownerB: person('owner-b'),
  /** SM4: signs in for real; an Admin in firm A and in firm B. */
  both: person('both'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', string>;

let app: INestApplication;
/** The firm site's origin: browsers send it with every change. */
let appOrigin = '';
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.64.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

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

type Method = 'get' | 'post' | 'put';
async function call(
  method: Method,
  path: string,
  who: Who,
  body?: object,
  firm: 'a' | 'b' = 'a',
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', firms[firm])
    .set('x-forwarded-for', viewer())
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};
const { ownerA, adminA, staffA, ownerB } = people;
const member = {} as Record<keyof typeof people, string>;
const session = {} as Record<'recent' | 'old' | 'gone' | 'manager', string>;

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people))
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: 'STAFF',
          email: p.email,
          name: `Fake R55x ${key}`,
        },
      });
    for (const key of ['a', 'b'] as const) {
      const slug = `r55x-${key}-${run}`;
      firms[key] = (
        await tx.business.create({
          data: { slug, name: `Firm ${slug}`, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
  });
  for (const [firm, key, role, status] of [
    ['a', 'ownerA', 'OWNER', 'ACTIVE'],
    ['a', 'adminA', 'ADMIN', 'ACTIVE'],
    ['a', 'admin2A', 'ADMIN', 'ACTIVE'],
    ['a', 'staffA', 'STAFF', 'ACTIVE'],
    ['a', 'managerA', 'MANAGER', 'ACTIVE'],
    ['a', 'invitedA', 'STAFF', 'INVITED'],
    ['b', 'ownerB', 'OWNER', 'ACTIVE'],
    ['a', 'both', 'ADMIN', 'ACTIVE'],
  ] as const) {
    member[key] = (
      await inFirm(firm, (tx) =>
        tx.membership.create({
          data: { businessId: firms[firm], userId: people[key].id, role, status },
          select: { id: true },
        }),
      )
    ).id;
  }
  await inFirm('a', async (tx) => {
    const businessId = firms.a;
    const add = (key: keyof typeof session, membershipId: string, lastActiveAt: Date) =>
      tx.staffSession
        .create({
          data: {
            businessId,
            membershipId,
            tokenHash: createHash('sha256').update(`${key}-${run}`).digest('hex'),
            device: `Chrome on macOS ${key}`,
            ip: '203.0.113.7',
            lastActiveAt,
          },
          select: { id: true },
        })
        .then((s) => (session[key] = s.id));
    await add('recent', member.staffA, new Date());
    await add('old', member.staffA, new Date(Date.now() - 10 * 86_400_000));
    await add('gone', member.staffA, new Date());
    await tx.staffSession.update({ where: { id: session.gone }, data: { revokedAt: new Date() } });
    await add('manager', member.managerA, new Date());
    // Sign-in rows in the firm's log, and a change made to staffA by the owner.
    for (const action of [
      FIRM_SESSION_STARTED,
      'auth.sign_in_failed',
      FIRM_SESSION_STARTED,
      FIRM_SESSION_STARTED,
      FIRM_SESSION_STARTED,
    ])
      await tx.auditLog.create({
        data: {
          businessId,
          actorUserId: staffA.id,
          action,
          entityType: 'user',
          entityId: staffA.id,
          ip: '203.0.113.9',
          userAgent: 'Fake browser',
        },
      });
    await tx.auditLog.create({
      data: {
        businessId,
        actorUserId: people.ownerA.id,
        action: 'membership.role_changed',
        entityType: 'membership',
        entityId: member.staffA,
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
  appOrigin = new URL(env.APP_BASE_URL).origin;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('sign-in rules', () => {
  it("shows the defaults before anything is saved, and saves the Owner's changes", async () => {
    const before = StaffSecurity.parse(
      ok(await call('get', `/staff/${member.managerA}/security`, adminA)),
    );
    expect(before).toMatchObject({
      status: 'ACTIVE',
      role: 'MANAGER',
      mfaRequired: true,
      accessLocation: 'ANYWHERE',
      maxConcurrentSessions: 1,
      requirePasswordChange: true,
      notices: { lockouts: true },
    });
    const saved = StaffSecurity.parse(
      ok(
        await call('put', `/staff/${member.managerA}/security`, adminA, {
          autoLogoutMinutes: 30,
          accessLocation: 'ALLOWED_IPS',
          allowedIps: ['203.0.113.0/24'],
          disableOn: '2027-01-31',
          recoveryEmail: `r55x-recovery-${run}@r55.test`,
          notices: {
            newDeviceLogin: false,
            failedLogins: true,
            passwordChanges: true,
            securityAlerts: true,
            lockouts: false,
          },
        }),
      ),
    );
    expect(saved).toMatchObject({
      autoLogoutMinutes: 30,
      accessLocation: 'ALLOWED_IPS',
      allowedIps: ['203.0.113.0/24'],
      disableOn: '2027-01-31',
      recoveryEmailVerified: false,
      notices: { newDeviceLogin: false, lockouts: false },
    });
    const audit = await inFirm('a', (tx) =>
      tx.auditLog.findFirstOrThrow({
        where: { businessId: firms.a, entityId: member.managerA, action: 'staff.security_saved' },
      }),
    );
    expect(JSON.stringify(audit.metadata)).not.toContain('203.0.113');
    expect(JSON.stringify(audit.metadata)).not.toContain(`r55x-recovery-${run}`);
  });

  it('refuses a location rule with an empty list', async () => {
    expectError(
      await call('put', `/staff/${member.staffA}/security`, ownerA, {
        accessLocation: 'ALLOWED_COUNTRIES',
      }),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('never changes yourself or another Admin, and is not for Staff', async () => {
    expectError(
      await call('put', `/staff/${member.adminA}/security`, adminA, { autoLogoutMinutes: 10 }),
      409,
      'CANNOT_CHANGE_SELF',
    );
    expectError(
      await call('put', `/staff/${member.admin2A}/security`, adminA, { autoLogoutMinutes: 10 }),
      403,
      'FORBIDDEN',
    );
    expectError(await call('get', `/staff/${member.managerA}/security`, staffA), 403, 'FORBIDDEN');
  });
});

describe('Active Sessions', () => {
  it('lists the open sessions of the last 7 days', async () => {
    const list = StaffSessionList.parse(
      ok(await call('get', `/staff/${member.staffA}/sessions`, ownerA)),
    );
    expect(list.items.map((s) => s.id)).toEqual([session.recent]);
    expect(list.items[0]).toMatchObject({ activeNow: true, ip: '203.0.113.7' });
  });

  it("signs one out (harmless to repeat), and never another member's", async () => {
    const path = `/staff/${member.staffA}/sessions/${session.recent}/revoke`;
    expect(StaffActionResult.parse(ok(await call('post', path, adminA))).sessionsRevoked).toBe(1);
    expect(StaffActionResult.parse(ok(await call('post', path, adminA))).sessionsRevoked).toBe(0);
    expectError(
      await call('post', `/staff/${member.staffA}/sessions/${session.manager}/revoke`, adminA),
      404,
      'NOT_FOUND',
    );
  });

  it('signs all out, with the confirm', async () => {
    expectError(
      await call('post', `/staff/${member.managerA}/sessions/revoke-all`, ownerA, {}),
      400,
      'VALIDATION_FAILED',
    );
    const all = StaffActionResult.parse(
      ok(
        await call('post', `/staff/${member.managerA}/sessions/revoke-all`, ownerA, {
          reason: 'Lost laptop',
          confirm: true,
        }),
      ),
    );
    expect(all).toMatchObject({ status: 'ACTIVE', sessionsRevoked: 1 });
  });
});

describe('Login History and activity', () => {
  it("pages the firm's sign-ins, newest first, and never a failed attempt (SM4)", async () => {
    const first = StaffLoginHistory.parse(
      ok(await call('get', `/staff/${member.staffA}/login-history?limit=3`, ownerA)),
    );
    expect(first.items.map((i) => i.outcome)).toEqual(['SUCCESS', 'SUCCESS', 'SUCCESS']);
    expect(first.items[0]).toMatchObject({
      ip: '203.0.113.9',
      device: 'Fake browser',
      place: null,
    });
    const next = StaffLoginHistory.parse(
      ok(
        await call(
          'get',
          `/staff/${member.staffA}/login-history?limit=3&cursor=${first.nextCursor}`,
          ownerA,
        ),
      ),
    );
    expect(next.items.map((i) => i.outcome)).toEqual(['SUCCESS']);
    expect(next.nextCursor).toBeNull();
    expectError(
      await call('get', `/staff/${member.staffA}/login-history?cursor=not-a-cursor`, ownerA),
      400,
      'VALIDATION_FAILED',
    );
  });

  it("shows what the member did and what was done to them, with the other person's name", async () => {
    const page = StaffActivityPage.parse(
      ok(await call('get', `/staff/${member.staffA}/activity`, ownerA)),
    );
    const changed = page.items.find((i) => i.action === 'membership.role_changed');
    expect(changed).toMatchObject({ label: 'Role changed', actorName: 'Fake R55x ownerA' });
    const signedIn = page.items.find((i) => i.action === FIRM_SESSION_STARTED);
    expect(signedIn).toMatchObject({ label: 'Logged in', actorName: null });
  });
});

describe('resets', () => {
  it('sends a password reset to someone who can sign in, never to an invitee', async () => {
    const res = StaffActionResult.parse(
      ok(await call('post', `/staff/${member.staffA}/reset-password`, adminA, { confirm: true })),
    );
    expect(res.status).toBe('ACTIVE');
    const settings = await inFirm('a', (tx) =>
      tx.staffSecuritySettings.findUniqueOrThrow({
        where: { businessId_membershipId: { businessId: firms.a, membershipId: member.staffA } },
      }),
    );
    expect(settings.requirePasswordChange).toBe(true);
    expectError(
      await call('post', `/staff/${member.invitedA}/reset-password`, adminA, { confirm: true }),
      409,
      'NOT_ACTIVE',
    );
  });

  it('resets MFA and signs the sessions out', async () => {
    const res = StaffActionResult.parse(
      ok(
        await call('post', `/staff/${member.staffA}/reset-mfa`, ownerA, {
          reason: 'New phone',
          confirm: true,
        }),
      ),
    );
    expect(res.status).toBe('ACTIVE');
    const audit = await inFirm('a', (tx) =>
      tx.auditLog.findFirstOrThrow({
        where: { businessId: firms.a, entityId: member.staffA, action: 'staff.mfa_reset' },
      }),
    );
    expect(audit.metadata).toMatchObject({ reasonGiven: true });
    expect(JSON.stringify(audit.metadata)).not.toContain('New phone');
  });
});

describe('firm B', () => {
  it("reaches none of firm A's members or sessions", async () => {
    for (const [method, path, body] of [
      ['get', `/staff/${member.staffA}/security`, undefined],
      ['put', `/staff/${member.staffA}/security`, { autoLogoutMinutes: 10 }],
      ['get', `/staff/${member.staffA}/sessions`, undefined],
      ['post', `/staff/${member.staffA}/sessions/${session.old}/revoke`, undefined],
      ['post', `/staff/${member.staffA}/sessions/revoke-all`, { confirm: true }],
      ['get', `/staff/${member.staffA}/login-history`, undefined],
      ['get', `/staff/${member.staffA}/activity`, undefined],
      ['post', `/staff/${member.staffA}/reset-password`, { confirm: true }],
      ['post', `/staff/${member.staffA}/reset-mfa`, { confirm: true }],
    ] as const)
      expectError(await call(method, path, ownerB, body, 'b'), 404, 'NOT_FOUND');
  });
});

describe('a real sign-in: the session row per firm and the revoke check (SM4)', () => {
  const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
  let inB = '';

  beforeAll(async () => {
    inB = (
      await inFirm('b', (tx) =>
        tx.membership.create({
          data: { businessId: firms.b, userId: people.both.id, role: 'ADMIN', status: 'ACTIVE' },
          select: { id: true },
        }),
      )
    ).id;
  });

  /** "name=value" of one cookie the response set. */
  const cookieNamed = (res: Response, name: string) => {
    const raw = res.headers['set-cookie'] as unknown;
    return (
      (Array.isArray(raw) ? (raw as string[]) : [])
        .map((c) => c.split(';')[0] ?? '')
        .find((c) => c.startsWith(`${name}=`)) ?? ''
    );
  };

  /** Password, authenticator and code, as the firm's sign-in screens do it. */
  async function signIn(email: string) {
    const from = viewer();
    const post = (path: string, body: object) =>
      request(app.getHttpServer())
        .post(`/api/v1/auth${path}`)
        .set('origin', appOrigin)
        .set('x-forwarded-for', from)
        .set('user-agent', UA)
        .send(body);
    let step = ok(await post('/sign-in', { email, password: LOCAL_PASSWORD })) as SignInResult;
    if (step.status === 'MFA_SETUP_REQUIRED') {
      const setup = ok(await post('/mfa/setup', { session: step.session })) as MfaSetupResponse;
      step = { status: 'MFA_REQUIRED', session: setup.session };
    }
    if (step.status !== 'MFA_REQUIRED') throw new Error(`unexpected ${step.status}`);
    const done = await post('/mfa', { session: step.session, code: LOCAL_MFA_CODE });
    ok(done);
    return { access: cookieNamed(done, 'fv_access'), refresh: cookieNamed(done, 'fv_refresh') };
  }

  /** The browser: its access cookie on a firm route of firm A or B. */
  const browse = (access: string, firm: 'a' | 'b') =>
    request(app.getHttpServer())
      .get('/api/v1/business/staff/summary')
      .set('x-business-id', firms[firm])
      .set('x-forwarded-for', viewer())
      .set('user-agent', UA)
      .set('cookie', access);
  const rowsIn = (firm: 'a' | 'b', membershipId: string) =>
    inFirm(firm, (tx) =>
      tx.staffSession.findMany({ where: { membershipId }, orderBy: { createdAt: 'asc' } }),
    );

  it('opens one row per firm, keyed by a hash, with a sign-in in that firm’s Login History', async () => {
    const web = await signIn(people.both.email);
    expect(web.access).toMatch(/^fv_access=/);
    ok(await browse(web.access, 'a'));
    ok(await browse(web.access, 'a'));
    ok(await browse(web.access, 'b'));
    const [a, ...moreA] = await rowsIn('a', member.both);
    const [b, ...moreB] = await rowsIn('b', inB);
    expect([moreA.length, moreB.length]).toEqual([0, 0]);
    expect(a).toMatchObject({ device: 'Chrome on Windows', revokedAt: null });
    expect(a?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // Each firm's row has its own key, and neither is any part of a token.
    expect(b?.tokenHash).not.toBe(a?.tokenHash);
    expect(`${web.access}${web.refresh}`).not.toContain(a?.tokenHash ?? '-');
    // Two requests within a minute: lastActiveAt did not move.
    expect(a?.lastActiveAt.getTime()).toBe(a?.createdAt.getTime());

    const list = StaffSessionList.parse(
      ok(await call('get', `/staff/${member.both}/sessions`, ownerA)),
    );
    expect(list.items.map((i) => i.id)).toEqual([a?.id]);
    const history = StaffLoginHistory.parse(
      ok(await call('get', `/staff/${member.both}/login-history`, ownerA)),
    );
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({ outcome: 'SUCCESS', device: 'Chrome on Windows' });
    // Firm B's sign-in is firm B's own row.
    expect(
      await inFirm('b', (tx) =>
        tx.auditLog.count({
          where: { businessId: firms.b, action: FIRM_SESSION_STARTED, actorUserId: people.both.id },
        }),
      ),
    ).toBe(1);
    // A dev token is no sign-in: it opens no session.
    expect(await rowsIn('a', member.ownerA)).toHaveLength(0);

    // A refresh keeps the session: the same row, seen again after a minute.
    const renewed = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('origin', appOrigin)
      .set('cookie', web.refresh);
    ok(renewed);
    const access = cookieNamed(renewed, 'fv_access');
    expect(access).toMatch(/^fv_access=/);
    await inFirm('a', (tx) =>
      tx.staffSession.update({
        where: { id: a?.id ?? '' },
        data: { lastActiveAt: new Date(Date.now() - 2 * 60_000) },
      }),
    );
    ok(await browse(access, 'a'));
    const [again, ...extra] = await rowsIn('a', member.both);
    expect(extra).toHaveLength(0);
    expect(again?.id).toBe(a?.id);
    expect(Date.now() - (again?.lastActiveAt.getTime() ?? 0)).toBeLessThan(60_000);
  });

  it('a session firm A ended answers 401 SESSION_REVOKED there; firm B can neither see nor end it', async () => {
    const web = await signIn(people.both.email);
    ok(await browse(web.access, 'a'));
    ok(await browse(web.access, 'b'));
    const open = (await rowsIn('a', member.both)).filter((r) => !r.revokedAt);
    const [mine] = open.slice(-1);
    // Firm B: firm A's member and session are not there to see or end.
    expectError(
      await call('get', `/staff/${member.both}/sessions`, ownerB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', `/staff/${inB}/sessions/${mine?.id}/revoke`, ownerB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
    ok(await browse(web.access, 'a'));

    // Revoke this one session: its next request is 401, also after a refresh.
    const one = StaffActionResult.parse(
      ok(await call('post', `/staff/${member.both}/sessions/${mine?.id}/revoke`, ownerA)),
    );
    expect(one.sessionsRevoked).toBe(1);
    expectError(await browse(web.access, 'a'), 401, 'SESSION_REVOKED');
    const renewed = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('origin', appOrigin)
      .set('cookie', web.refresh);
    expectError(await browse(cookieNamed(renewed, 'fv_access'), 'a'), 401, 'SESSION_REVOKED');
    // Firm A ended it in firm A only.
    ok(await browse(web.access, 'b'));

    // Sign out all: every session of this member in firm A, none in firm B.
    const other = await signIn(people.both.email);
    ok(await browse(other.access, 'a'));
    ok(await browse(other.access, 'b'));
    const all = StaffActionResult.parse(
      ok(
        await call('post', `/staff/${member.both}/sessions/revoke-all`, ownerA, {
          reason: 'Lost laptop',
          confirm: true,
        }),
      ),
    );
    expect(all.sessionsRevoked).toBeGreaterThanOrEqual(2);
    expect((await rowsIn('a', member.both)).filter((r) => !r.revokedAt)).toHaveLength(0);
    expectError(await browse(other.access, 'a'), 401, 'SESSION_REVOKED');
    ok(await browse(other.access, 'b'));
    expect((await rowsIn('b', inB)).filter((r) => r.revokedAt)).toHaveLength(0);

    // A new sign-in is a new session, and it works.
    const fresh = await signIn(people.both.email);
    ok(await browse(fresh.access, 'a'));
  });

  it('15 minutes without activity end the session (SEC-4); a background request is no activity', async () => {
    const web = await signIn(people.both.email);
    ok(await browse(web.access, 'a'));
    const [row] = (await rowsIn('a', member.both)).filter((r) => !r.revokedAt).slice(-1);
    const setIdle = (minutes: number) =>
      inFirm('a', (tx) =>
        tx.staffSession.update({
          where: { id: row?.id ?? '' },
          data: { lastActiveAt: new Date(Date.now() - minutes * 60_000) },
        }),
      );
    // A background request (the bell polling) is checked but does not count as activity.
    await setIdle(2);
    ok(await browse(web.access, 'a').set(BACKGROUND_HEADER, '1'));
    const after = await inFirm('a', (tx) =>
      tx.staffSession.findUniqueOrThrow({ where: { id: row?.id ?? '' } }),
    );
    expect(Date.now() - after.lastActiveAt.getTime()).toBeGreaterThan(90_000);
    // Past 15 minutes: 401 SESSION_IDLE, and the session stays ended.
    await setIdle(16);
    expectError(await browse(web.access, 'a'), 401, 'SESSION_IDLE');
    expectError(await browse(web.access, 'a'), 401, 'SESSION_REVOKED');
    // Only this firm's session ended.
    ok(await browse(web.access, 'b'));
  });

  it('8 hours after sign-in the session ends, whatever the activity (SEC-4)', async () => {
    const tokens = app.get(TokenService);
    const signedIn = Math.floor(Date.now() / 1000) - 8 * 3600 - 60;
    const { token } = await tokens.signLocal(people.both.id, 'STAFF', randomUUID(), signedIn);
    expectError(await browse(`fv_access=${token}`, 'a'), 401, 'SESSION_EXPIRED');
    const { token: recent } = await tokens.signLocal(
      people.both.id,
      'STAFF',
      randomUUID(),
      Math.floor(Date.now() / 1000) - 7 * 3600,
    );
    ok(await browse(`fv_access=${recent}`, 'a'));
  });

  it('a new password signs the person out of every firm (SEC-5)', async () => {
    const web = await signIn(people.both.email);
    ok(await browse(web.access, 'a'));
    ok(await browse(web.access, 'b'));
    ok(
      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .set('origin', appOrigin)
        .set('x-forwarded-for', viewer())
        .send({ email: people.both.email, code: LOCAL_RESET_CODE, password: LOCAL_PASSWORD }),
    );
    expectError(await browse(web.access, 'a'), 401, 'SESSION_REVOKED');
    expectError(await browse(web.access, 'b'), 401, 'SESSION_REVOKED');
    expect((await rowsIn('a', member.both)).filter((r) => !r.revokedAt)).toHaveLength(0);
    expect((await rowsIn('b', inB)).filter((r) => !r.revokedAt)).toHaveLength(0);
  });
});
