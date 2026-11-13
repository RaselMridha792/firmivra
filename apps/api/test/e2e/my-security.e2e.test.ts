// End-to-end: R55, SM14 part B (My Profile's Security card): any staff member, a Staff-tier one
// without Staff Management rights included, lists their own sessions in the firm, signs out
// every other one (this session stays), and changes their own password with the current one
// first. Each is audited, never with a password. Firm B's sessions of the same person are
// untouched. Real local sign-ins, so each session has its id (SM4's key).
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  type MfaSetupResponse,
  MySecurityResult,
  MySessionList,
  type SignInResult,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { LOCAL_MFA_CODE, LOCAL_PASSWORD } from '../../src/auth/identity/local-identity.provider.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55z-${key}-${run}@r55.test` });
/** A Staff-tier member of firm A, also in firm B; and one whose password changes. */
const people = { staff: person('staff'), changer: person('changer'), ownerA: person('owner-a') };
const firms = {} as Record<'a' | 'b', string>;
const member = {} as Record<'staffA' | 'staffB' | 'changerA', string>;
const NEW_PASSWORD = 'Brand-New-Passw0rd';

let app: INestApplication;
let appOrigin = '';
let viewers = 0;
const viewer = () => `198.66.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

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
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};
const cookieNamed = (res: Response, name: string) => {
  const raw = res.headers['set-cookie'] as unknown;
  return (
    (Array.isArray(raw) ? (raw as string[]) : [])
      .map((c) => c.split(';')[0] ?? '')
      .find((c) => c.startsWith(`${name}=`)) ?? ''
  );
};

/** Password, authenticator and code, as the firm's sign-in screens do it: the access cookie. */
async function signIn(email: string, password = LOCAL_PASSWORD): Promise<string> {
  const from = viewer();
  const post = (path: string, body: object) =>
    request(app.getHttpServer())
      .post(`/api/v1/auth${path}`)
      .set('origin', appOrigin)
      .set('x-forwarded-for', from)
      .set('user-agent', UA)
      .send(body);
  let step = ok(await post('/sign-in', { email, password })) as SignInResult;
  if (step.status === 'MFA_SETUP_REQUIRED') {
    const setup = ok(await post('/mfa/setup', { session: step.session })) as MfaSetupResponse;
    step = { status: 'MFA_REQUIRED', session: setup.session };
  }
  if (step.status !== 'MFA_REQUIRED') throw new Error(`unexpected ${step.status}`);
  const done = await post('/mfa', { session: step.session, code: LOCAL_MFA_CODE });
  ok(done);
  return cookieNamed(done, 'fv_access');
}

/** A firm-site call with a session's access cookie (and the site's Origin, as browsers send). */
const as = (
  cookie: string,
  method: 'get' | 'post',
  path: string,
  body?: object,
  firm: 'a' | 'b' = 'a',
) => {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', firms[firm])
    .set('x-forwarded-for', viewer())
    .set('origin', appOrigin)
    .set('user-agent', UA)
    .set('cookie', cookie);
  return body === undefined ? req : req.send(body);
};
const rows = (firm: 'a' | 'b', membershipId: string) =>
  asOwner({ kind: 'business', businessId: firms[firm] }, (tx) =>
    tx.staffSession.findMany({ where: { membershipId } }),
  );

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people))
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    for (const key of ['a', 'b'] as const) {
      const slug = `r55z-${key}-${run}`;
      firms[key] = (
        await tx.business.create({
          data: { slug, name: `Firm ${slug}`, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
  });
  const add = async (firm: 'a' | 'b', userId: string, role: 'OWNER' | 'STAFF') =>
    (
      await asOwner({ kind: 'business', businessId: firms[firm] }, (tx) =>
        tx.membership.create({
          data: { businessId: firms[firm], userId, role, status: 'ACTIVE' },
          select: { id: true },
        }),
      )
    ).id;
  await add('a', people.ownerA.id, 'OWNER');
  member.staffA = await add('a', people.staff.id, 'STAFF');
  member.staffB = await add('b', people.staff.id, 'STAFF');
  member.changerA = await add('a', people.changer.id, 'STAFF');
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

describe('my sessions (SM14 part B)', () => {
  it('lists mine with this one marked, and signs out every other one, in this firm only', async () => {
    const here = await signIn(people.staff.email);
    const phone = await signIn(people.staff.email);
    // Staff Management is closed to a Staff-tier member; their own sessions are not.
    expect((await as(here, 'get', '/staff')).status).toBe(403);
    const mine = MySessionList.parse(ok(await as(here, 'get', '/me/sessions')));
    ok(await as(phone, 'get', '/me/sessions'));
    ok(await as(phone, 'get', '/me/sessions', undefined, 'b'));
    const listed = MySessionList.parse(ok(await as(here, 'get', '/me/sessions')));
    expect(listed.items).toHaveLength(2);
    expect(listed.items.filter((s) => s.current)).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({ device: 'Safari on macOS' });
    expect(mine.items.filter((s) => s.current)).toHaveLength(1);

    // The confirm is required.
    expectError(
      await as(here, 'post', '/me/sessions/sign-out-others', {}),
      400,
      'VALIDATION_FAILED',
    );
    const done = MySecurityResult.parse(
      ok(await as(here, 'post', '/me/sessions/sign-out-others', { confirm: true })),
    );
    expect(done.sessionsRevoked).toBe(1);
    // The other session is over here; this one goes on; firm B is untouched.
    expectError(await as(phone, 'get', '/me/sessions'), 401, 'SESSION_REVOKED');
    expect(MySessionList.parse(ok(await as(here, 'get', '/me/sessions'))).items).toHaveLength(1);
    ok(await as(phone, 'get', '/me/sessions', undefined, 'b'));
    expect((await rows('b', member.staffB)).filter((r) => r.revokedAt)).toHaveLength(0);
    // Audited in firm A, by the member, with the count only.
    const audit = await asOwner({ kind: 'business', businessId: firms.a }, (tx) =>
      tx.auditLog.findFirstOrThrow({
        where: { action: 'staff.own_sessions_signed_out', actorUserId: people.staff.id },
      }),
    );
    expect(audit).toMatchObject({ entityId: member.staffA, metadata: { sessionsRevoked: 1 } });
  });
});

describe('my password (SM14 part B)', () => {
  it('needs the current password, keeps this session, signs out the others, and is audited', async () => {
    const here = await signIn(people.changer.email);
    const other = await signIn(people.changer.email);
    ok(await as(other, 'get', '/me/sessions'));
    ok(await as(here, 'get', '/me/sessions'));
    // A wrong current password: the field says so, and it is audited without the password.
    const wrong = await as(here, 'post', '/me/password', {
      currentPassword: 'Not-the-passw0rd',
      newPassword: NEW_PASSWORD,
    });
    expectError(wrong, 400, 'VALIDATION_FAILED');
    expect((wrong.body as { error: { details: { path: string }[] } }).error.details[0]?.path).toBe(
      'currentPassword',
    );
    // A weak one, or the same one again: refused before anything changes.
    for (const newPassword of ['short', LOCAL_PASSWORD])
      expectError(
        await as(here, 'post', '/me/password', { currentPassword: LOCAL_PASSWORD, newPassword }),
        400,
        'VALIDATION_FAILED',
      );
    const done = MySecurityResult.parse(
      ok(
        await as(here, 'post', '/me/password', {
          currentPassword: LOCAL_PASSWORD,
          newPassword: NEW_PASSWORD,
        }),
      ),
    );
    expect(done.sessionsRevoked).toBe(1);
    expectError(await as(other, 'get', '/me/sessions'), 401, 'SESSION_REVOKED');
    ok(await as(here, 'get', '/me/sessions'));
    // The old password no longer signs in; the new one does.
    const old = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in')
      .set('origin', appOrigin)
      .set('x-forwarded-for', viewer())
      .send({ email: people.changer.email, password: LOCAL_PASSWORD });
    expectError(old, 401, 'INVALID_CREDENTIALS');
    expect(await signIn(people.changer.email, NEW_PASSWORD)).toMatch(/^fv_access=/);
    const audits = await asOwner({ kind: 'business', businessId: firms.a }, (tx) =>
      tx.auditLog.findMany({
        where: {
          actorUserId: people.changer.id,
          action: { in: ['staff.password_change_failed', 'staff.password_changed'] },
        },
        orderBy: { createdAt: 'asc' },
        select: { action: true, metadata: true },
      }),
    );
    expect(audits.map((a) => a.action)).toEqual([
      'staff.password_change_failed',
      'staff.password_changed',
    ]);
    expect(JSON.stringify(audits)).not.toMatch(/Passw0rd|Firmivra-local/);
  });
});
