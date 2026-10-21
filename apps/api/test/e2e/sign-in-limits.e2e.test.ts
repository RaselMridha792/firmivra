// End-to-end: R2 step 7 in AUTH_MODE=local. Failed sign-ins (wrong passwords and wrong MFA
// codes) are audited, and per-email and per-attempt limits count those rows, so every API task
// shares them. Staff rows go in the platform's log; a client's portal rows in the firm's. On top
// (Rasel, Oct 21), the account lockout: SIGN_IN_LIMIT.perAccount failures from any network lock
// the email for SIGN_IN_LIMIT.lockMs, and a successful password reset lifts it.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { type MfaSetupResponse, type SignInResult, SignInRateLimited } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import {
  AuthFlowError,
  IDENTITY_PROVIDER,
  type IdentityProvider,
} from '../../src/auth/identity/identity-provider.js';
import {
  LOCAL_MFA_CODE,
  LOCAL_PASSWORD,
  LOCAL_RESET_CODE,
} from '../../src/auth/identity/local-identity.provider.js';
import { SIGN_IN_LIMIT } from '../../src/auth/sign-in.service.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
let app: INestApplication;
let portalOrigin = '';
const tag = randomUUID().slice(0, 8);
const WRONG = 'Wrong-password-1';

type Person = { id: string; email: string };
const person = (key: string): Person => ({
  id: randomUUID(),
  email: `r2-lim-${key.toLowerCase()}-${tag}@a.test`,
});
const staff = {
  locked: person('locked'),
  bystander: person('bystander'),
  everywhere: person('everywhere'),
  held: person('held'),
  lifted: person('lifted'),
  reset: person('reset'),
  mfa: person('mfa'),
  mfaLock: person('mfalock'),
  released: person('released'),
  audited: person('audited'),
  lockAudit: person('lockaudit'),
  network: person('network'),
  ceiling: person('ceiling'),
};
const NEW_PASSWORD = 'New-password-2026';
const firmX = { id: '', slug: `r2-lim-x-${tag}` };
const firmY = { id: '', slug: `r2-lim-y-${tag}` };
/** One email, a login at each of two firms: each firm's portal counts its own failures. */
const sharedEmail = `r2-lim-client-${tag}@example.com`;
const clients = { atX: { id: randomUUID() }, atY: { id: randomUUID() } };

let lastViewer = 0;
const newViewer = () => `198.21.0.${++lastViewer}`;
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;

/**
 * Each call from a new viewer IP in one /24, so one network (q20): these tests are about the
 * per-email limits from one network; 'per email and network' changes the network.
 */
const post = (path: string, body: object, portal = false) => {
  const req = request(app.getHttpServer())
    .post(path)
    .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`);
  return (portal ? req.set('origin', portalOrigin) : req).send(body);
};
const staffSignIn = (email: string, password: string) =>
  post('/api/v1/auth/sign-in', { email, password });
/** A staff sign-in from a chosen viewer IP, for the tests about networks. */
const signInFrom = (ip: string, email: string, password: string) =>
  request(app.getHttpServer())
    .post('/api/v1/auth/sign-in')
    .set('x-forwarded-for', `${ip}, 10.0.0.5`)
    .send({ email, password });

/**
 * A locked account's answer (contract `SignInRateLimited`): 429 RATE_LIMITED with when it may try
 * again, in the body and as Retry-After. Returns that time.
 */
function expectLocked(res: Response): number {
  expect([res.status, codeOf(res)]).toEqual([429, 'RATE_LIMITED']);
  const retryAt = Date.parse(SignInRateLimited.parse(res.body).error.details?.retryAt ?? '');
  expect(retryAt).toBeGreaterThan(Date.now());
  expect(retryAt).toBeLessThanOrEqual(Date.now() + SIGN_IN_LIMIT.lockMs);
  const retryAfter = Number(res.headers['retry-after']);
  expect(retryAfter).toBeGreaterThan(0);
  expect(retryAfter).toBeLessThanOrEqual(SIGN_IN_LIMIT.lockMs / 1000);
  return retryAt;
}
const portalSignIn = (slug: string, password: string) =>
  post(`/api/v1/portal/${slug}/auth/sign-in`, { email: sharedEmail, password }, true);

async function asOwner<T>(
  scope: Parameters<typeof runInScope>[1],
  work: Parameters<typeof runInScope<T>>[2],
) {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, scope, work);
  } finally {
    await owner.$disconnect();
  }
}

/** Fails `n` times with a wrong password; each answer is the usual 401. */
async function fail(n: number, attempt: () => Promise<Response>) {
  for (let i = 0; i < n; i += 1) {
    const res = await attempt();
    expect([res.status, codeOf(res)]).toEqual([401, 'INVALID_CREDENTIALS']);
  }
}

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const p of Object.values(staff)) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: 'Fake staff' },
      });
    }
    for (const c of Object.values(clients)) {
      await tx.user.create({
        data: { id: c.id, cognitoSub: c.id, pool: 'CLIENT', email: sharedEmail, name: 'Client' },
      });
    }
    for (const firm of [firmX, firmY]) {
      firm.id = (
        await tx.business.create({ data: { slug: firm.slug, name: firm.slug, status: 'ACTIVE' } })
      ).id;
    }
  });
  for (const [firm, c] of [
    [firmX, clients.atX],
    [firmY, clients.atY],
  ] as const) {
    await asOwner({ kind: 'business', businessId: firm.id }, (tx) =>
      tx.clientAccount.create({
        data: { businessId: firm.id, userId: c.id, email: sharedEmail, status: 'ACTIVE' },
      }),
    );
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
});

describe('account lockout (Rasel, Oct 21)', () => {
  it('locks an email after SIGN_IN_LIMIT.perAccount failures, real or unknown, and only that email', async () => {
    await fail(SIGN_IN_LIMIT.perAccount, () => staffSignIn(staff.locked.email, WRONG));
    // Even the right password waits now, and the answer says until when.
    expectLocked(await staffSignIn(staff.locked.email, LOCAL_PASSWORD));

    // An unknown email gets exactly the same answers.
    const nobody = `r2-lim-nobody-${tag}@a.test`;
    await fail(SIGN_IN_LIMIT.perAccount, () => staffSignIn(nobody, WRONG));
    expectLocked(await staffSignIn(nobody, WRONG));

    // Nobody else is affected.
    expect((await staffSignIn(staff.bystander.email, LOCAL_PASSWORD)).status).toBe(200);
  });

  // This replaces q20's "another network still signs in": the lock is the account's, so the
  // person waits on their own network too.
  it('holds on every network, each failure from its own /24', async () => {
    const who = staff.everywhere;
    for (let i = 1; i <= SIGN_IN_LIMIT.perAccount; i += 1) {
      const res = await signInFrom(`198.34.${i}.1`, who.email, WRONG);
      expect([res.status, codeOf(res)]).toEqual([401, 'INVALID_CREDENTIALS']);
    }
    expectLocked(await signInFrom('198.35.7.1', who.email, LOCAL_PASSWORD));

    // An unknown email: the same answers.
    const nobody = `r2-lim-every-nobody-${tag}@a.test`;
    for (let i = 1; i <= SIGN_IN_LIMIT.perAccount; i += 1) {
      const res = await signInFrom(`198.36.${i}.1`, nobody, WRONG);
      expect([res.status, codeOf(res)]).toEqual([401, 'INVALID_CREDENTIALS']);
    }
    expectLocked(await signInFrom('198.37.1.1', nobody, WRONG));
  });

  it('holds SIGN_IN_LIMIT.lockMs from the failure that locked it, then lifts', async () => {
    // A failure can't be dated in the past through the API, so the open attempts are written
    // directly (the owner may date audit rows), under the email key the API uses. A right
    // password first gives that key; its attempt is closed as passed, so it does not count.
    const keyOf = async (who: Person) => {
      const userAgent = `r2-lim-key-${who.id}`;
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/sign-in')
        .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`)
        .set('user-agent', userAgent)
        .send({ email: who.email, password: LOCAL_PASSWORD });
      expect(res.status).toBe(200);
      const [row] = await asOwner({ kind: 'platform' }, (tx) =>
        tx.auditLog.findMany({
          where: { businessId: null, action: 'auth.sign_in_attempt', userAgent },
          select: { metadata: true },
        }),
      );
      return (row?.metadata as { emailKey: string }).emailKey;
    };
    const failedMinutesAgo = (emailKey: string, minutes: number[]) =>
      asOwner({ kind: 'platform' }, (tx) =>
        tx.auditLog.createMany({
          data: minutes.map((m) => ({
            businessId: null,
            action: 'auth.sign_in_attempt',
            entityType: 'login',
            createdAt: new Date(Date.now() - m * 60_000),
            metadata: { emailKey, step: 'password', pool: 'STAFF', reservationId: randomUUID() },
          })),
        }),
      );

    // Five failures 11 to 16 minutes ago: the first is past the window, but the lock runs 15
    // minutes from the fifth, so about 4 minutes are left.
    await failedMinutesAgo(await keyOf(staff.held), [16, 14, 13, 12, 11]);
    const retryAt = expectLocked(await staffSignIn(staff.held.email, LOCAL_PASSWORD));
    expect(Math.abs(retryAt - (Date.now() + 4 * 60_000))).toBeLessThan(30_000);

    // Five failures 16 to 20 minutes ago: that lock ended a minute ago.
    await failedMinutesAgo(await keyOf(staff.lifted), [20, 19, 18, 17, 16]);
    expect((await staffSignIn(staff.lifted.email, LOCAL_PASSWORD)).status).toBe(200);
  });

  it('a successful password reset lifts it; a failed one does not', async () => {
    const who = staff.reset;
    await fail(SIGN_IN_LIMIT.perAccount, () => staffSignIn(who.email, WRONG));
    expectLocked(await staffSignIn(who.email, LOCAL_PASSWORD));

    const badReset = await post('/api/v1/auth/reset-password', {
      email: who.email,
      code: '123456',
      password: NEW_PASSWORD,
    });
    expect([badReset.status, codeOf(badReset)]).toEqual([400, 'RESET_CODE_INVALID']);
    expectLocked(await staffSignIn(who.email, LOCAL_PASSWORD));

    await post('/api/v1/auth/reset-password', {
      email: who.email,
      code: LOCAL_RESET_CODE,
      password: NEW_PASSWORD,
    }).expect(200);
    const after = await staffSignIn(who.email, NEW_PASSWORD);
    expect(after.status).toBe(200);
    expect((after.body as SignInResult).status).toBe('MFA_SETUP_REQUIRED');
  });
});

describe('per email and network (q20)', () => {
  // The network limit stays under the account lockout; it shows when the account limit is higher.
  it('locks one network (its /24) for an email, while another network still signs in', async () => {
    const perAccount = SIGN_IN_LIMIT.perAccount;
    SIGN_IN_LIMIT.perAccount = 100;
    try {
      const who = staff.network;
      // Failures from addresses across one /24 count together.
      for (let i = 1; i <= SIGN_IN_LIMIT.perEmailNetwork; i += 1) {
        const res = await signInFrom(`198.30.1.${i}`, who.email, WRONG);
        expect([res.status, codeOf(res)]).toEqual([401, 'INVALID_CREDENTIALS']);
      }
      const locked = await signInFrom('198.30.1.200', who.email, LOCAL_PASSWORD);
      expect([locked.status, codeOf(locked)]).toEqual([429, 'RATE_LIMITED']);
      // A network's limit says no time: only an account lock does.
      expect(SignInRateLimited.parse(locked.body).error.details).toBeUndefined();
      // Under the raised account limit, another network still signs in.
      const elsewhere = await signInFrom('198.31.7.1', who.email, LOCAL_PASSWORD);
      expect(elsewhere.status).toBe(200);
      expect((elsewhere.body as SignInResult).status).toBe('MFA_SETUP_REQUIRED');

      // An unknown email: the same answers, network by network.
      const nobody = `r2-lim-net-nobody-${tag}@a.test`;
      for (let i = 1; i <= SIGN_IN_LIMIT.perEmailNetwork; i += 1) {
        const res = await signInFrom(`198.32.1.${i}`, nobody, WRONG);
        expect([res.status, codeOf(res)]).toEqual([401, 'INVALID_CREDENTIALS']);
      }
      expect((await signInFrom('198.32.1.99', nobody, WRONG)).status).toBe(429);
      expect((await signInFrom('198.33.1.1', nobody, WRONG)).status).toBe(401);
    } finally {
      SIGN_IN_LIMIT.perAccount = perAccount;
    }
  });

  it('past the per-email ceiling every network is slowed, never locked out', async () => {
    const { perEmailCeiling, ceilingDelayMs } = SIGN_IN_LIMIT;
    SIGN_IN_LIMIT.perEmailCeiling = 3;
    SIGN_IN_LIMIT.ceilingDelayMs = 400;
    try {
      const who = staff.ceiling;
      for (let n = 1; n <= 3; n += 1) {
        const res = await signInFrom(`198.40.${n}.1`, who.email, WRONG);
        expect(res.status).toBe(401);
      }
      let started = Date.now();
      const wrong = await signInFrom('198.40.4.1', who.email, WRONG);
      expect([wrong.status, codeOf(wrong)]).toEqual([401, 'INVALID_CREDENTIALS']);
      expect(Date.now() - started).toBeGreaterThanOrEqual(400);
      started = Date.now();
      const right = await signInFrom('198.40.5.1', who.email, LOCAL_PASSWORD);
      expect((right.body as SignInResult).status).toBe('MFA_SETUP_REQUIRED');
      expect(Date.now() - started).toBeGreaterThanOrEqual(400);

      // An unknown email past the ceiling: slowed the same way, never locked, the same answer.
      const nobody = `r2-lim-ceil-nobody-${tag}@a.test`;
      for (let n = 1; n <= 3; n += 1) {
        const res = await signInFrom(`198.41.${n}.1`, nobody, WRONG);
        expect([res.status, codeOf(res)]).toEqual([401, 'INVALID_CREDENTIALS']);
      }
      for (let n = 4; n <= 5; n += 1) {
        started = Date.now();
        const unknown = await signInFrom(`198.41.${n}.1`, nobody, WRONG);
        expect([unknown.status, codeOf(unknown)]).toEqual([401, 'INVALID_CREDENTIALS']);
        expect(Date.now() - started).toBeGreaterThanOrEqual(400);
      }
    } finally {
      SIGN_IN_LIMIT.perEmailCeiling = perEmailCeiling;
      SIGN_IN_LIMIT.ceilingDelayMs = ceilingDelayMs;
    }
  });

  it('parallel guesses from two networks: no more than the account limit in all, no 500', async () => {
    const email = `r2-lim-net-burst-${tag}@a.test`;
    const burst = (net: string) =>
      Array.from({ length: 20 }, (_, i) => signInFrom(`${net}.${i + 1}`, email, WRONG));
    const [a, b] = await Promise.all([
      Promise.all(burst('198.50.1')),
      Promise.all(burst('198.50.2')),
    ]);
    const statuses = [...a, ...b].map((r) => r.status);
    expect(statuses.filter((s) => s !== 401 && s !== 429)).toEqual([]);
    expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(SIGN_IN_LIMIT.perAccount);
  });
});

describe('wrong MFA codes', () => {
  /** Sets up the person's authenticator (local mode), then signs in up to the code step. */
  async function atCodeStep(who: Person): Promise<string> {
    const first = await staffSignIn(who.email, LOCAL_PASSWORD);
    const setup = await post('/api/v1/auth/mfa/setup', {
      session: (first.body as { session: string }).session,
    });
    await post('/api/v1/auth/mfa', {
      session: (setup.body as MfaSetupResponse).session,
      code: LOCAL_MFA_CODE,
    }).expect(200);
    const signIn = await staffSignIn(who.email, LOCAL_PASSWORD);
    const step = signIn.body as SignInResult;
    if (step.status !== 'MFA_REQUIRED') throw new Error(`unexpected ${step.status}`);
    return step.session;
  }

  it('end the attempt after SIGN_IN_LIMIT.perAttempt, and count against the email', async () => {
    // The attempt's and the network's limits, under a raised account limit.
    const perAccount = SIGN_IN_LIMIT.perAccount;
    SIGN_IN_LIMIT.perAccount = 100;
    try {
      const session = await atCodeStep(staff.mfa);
      for (let i = 0; i < SIGN_IN_LIMIT.perAttempt; i += 1) {
        const res = await post('/api/v1/auth/mfa', { session, code: '111111' });
        expect([res.status, codeOf(res)]).toEqual([401, 'MFA_CODE_INVALID']);
      }
      // The attempt is over, even with the right code: sign in again.
      const over = await post('/api/v1/auth/mfa', { session, code: LOCAL_MFA_CODE });
      expect([over.status, codeOf(over)]).toEqual([401, 'CHALLENGE_EXPIRED']);

      // Those wrong codes counted for the email: starting again does not give fresh tries.
      await fail(SIGN_IN_LIMIT.perEmailNetwork - SIGN_IN_LIMIT.perAttempt, () =>
        staffSignIn(staff.mfa.email, WRONG),
      );
      const locked = await staffSignIn(staff.mfa.email, LOCAL_PASSWORD);
      expect([locked.status, codeOf(locked)]).toEqual([429, 'RATE_LIMITED']);
    } finally {
      SIGN_IN_LIMIT.perAccount = perAccount;
    }
  });

  it('count toward the account lock, with wrong passwords (Rasel, Oct 21)', async () => {
    const who = staff.mfaLock;
    const session = await atCodeStep(who);
    const codes = SIGN_IN_LIMIT.perAccount - 2;
    for (let i = 0; i < codes; i += 1) {
      const res = await post('/api/v1/auth/mfa', { session, code: '111111' });
      expect([res.status, codeOf(res)]).toEqual([401, 'MFA_CODE_INVALID']);
    }
    await fail(2, () => staffSignIn(who.email, WRONG));
    expectLocked(await staffSignIn(who.email, LOCAL_PASSWORD));
    // The code step still open waits too, even with the right code.
    expectLocked(await post('/api/v1/auth/mfa', { session, code: LOCAL_MFA_CODE }));
  });
});

describe('parallel attempts (reserved before Cognito is asked)', () => {
  it('never lets more wrong passwords through than the account limit, and no 500', async () => {
    const email = `r2-lim-burst-${tag}@a.test`;
    const results = await Promise.all(Array.from({ length: 30 }, () => staffSignIn(email, WRONG)));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s !== 401 && s !== 429)).toEqual([]);
    expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(SIGN_IN_LIMIT.perAccount);
    // And the limit holds afterwards for the right password too (unknown email: still 429).
    const after = await staffSignIn(email, WRONG);
    expect(after.status === 401 || after.status === 429).toBe(true);
  });

  it('never lets more wrong MFA codes through than the per-attempt limit', async () => {
    const who = person('mfaburst');
    await asOwner({ kind: 'platform' }, (tx) =>
      tx.user.create({
        data: { id: who.id, cognitoSub: who.id, pool: 'STAFF', email: who.email, name: 'Fake' },
      }),
    );
    const first = await staffSignIn(who.email, LOCAL_PASSWORD);
    const setup = await post('/api/v1/auth/mfa/setup', {
      session: (first.body as { session: string }).session,
    });
    await post('/api/v1/auth/mfa', {
      session: (setup.body as MfaSetupResponse).session,
      code: LOCAL_MFA_CODE,
    }).expect(200);
    const signIn = await staffSignIn(who.email, LOCAL_PASSWORD);
    const step = signIn.body as SignInResult;
    if (step.status !== 'MFA_REQUIRED') throw new Error(`unexpected ${step.status}`);
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        post('/api/v1/auth/mfa', { session: step.session, code: '111111' }),
      ),
    );
    const codes = results.map((r) => [r.status, codeOf(r)]);
    expect(codes.filter(([s]) => s !== 401 && s !== 429)).toEqual([]);
    expect(codes.filter(([, c]) => c === 'MFA_CODE_INVALID').length).toBeLessThanOrEqual(
      SIGN_IN_LIMIT.perAttempt,
    );
  });

  it('holds the per-attempt limit for codes sent from many networks at once (q20 review)', async () => {
    const who = person('mfanets');
    await asOwner({ kind: 'platform' }, (tx) =>
      tx.user.create({
        data: { id: who.id, cognitoSub: who.id, pool: 'STAFF', email: who.email, name: 'Fake' },
      }),
    );
    const first = await staffSignIn(who.email, LOCAL_PASSWORD);
    const setup = await post('/api/v1/auth/mfa/setup', {
      session: (first.body as { session: string }).session,
    });
    await post('/api/v1/auth/mfa', {
      session: (setup.body as MfaSetupResponse).session,
      code: LOCAL_MFA_CODE,
    }).expect(200);
    const signIn = await staffSignIn(who.email, LOCAL_PASSWORD);
    const step = signIn.body as SignInResult;
    if (step.status !== 'MFA_REQUIRED') throw new Error(`unexpected ${step.status}`);
    // One challenge, each wrong code from its own /24, so no (email, network) lock is shared.
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        request(app.getHttpServer())
          .post('/api/v1/auth/mfa')
          .set('x-forwarded-for', `198.60.${i + 1}.1, 10.0.0.5`)
          .send({ session: step.session, code: '111111' }),
      ),
    );
    const codes = results.map((r) => [r.status, codeOf(r)] as const);
    expect(codes.filter(([s]) => s >= 500)).toEqual([]);
    expect(codes.filter(([, c]) => c === 'MFA_CODE_INVALID').length).toBeLessThanOrEqual(
      SIGN_IN_LIMIT.perAttempt,
    );
    // The rest are refused: busy (429) or the attempt is over (sign in again).
    const answers = new Set(['401 MFA_CODE_INVALID', '401 CHALLENGE_EXPIRED', '429 RATE_LIMITED']);
    expect(codes.map(([s, c]) => `${s} ${c}`).filter((a) => !answers.has(a))).toEqual([]);
  });
});

describe('audit', () => {
  it('records each sign-in and failure, with a keyed hash of the email, never the email', async () => {
    // Its own User-Agent finds its rows, whatever other test files write at the same time.
    const userAgent = `r2-lim-audited-${tag}`;
    const wrong = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in')
      .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`)
      .set('user-agent', userAgent)
      .send({ email: staff.audited.email, password: WRONG });
    expect([wrong.status, codeOf(wrong)]).toEqual([401, 'INVALID_CREDENTIALS']);
    const first = await staffSignIn(staff.audited.email, LOCAL_PASSWORD);
    const setup = await post('/api/v1/auth/mfa/setup', {
      session: (first.body as { session: string }).session,
    });
    await post('/api/v1/auth/mfa', {
      session: (setup.body as MfaSetupResponse).session,
      code: LOCAL_MFA_CODE,
    }).expect(200);

    const rows = await asOwner({ kind: 'platform' }, (tx) =>
      tx.auditLog.findMany({
        where: {
          businessId: null,
          OR: [{ action: 'auth.signed_in', entityId: staff.audited.id }, { userAgent }],
        },
        select: { action: true, actorUserId: true, metadata: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
    const signedIn = rows.filter((r) => r.action === 'auth.signed_in');
    expect(signedIn).toEqual([
      { action: 'auth.signed_in', actorUserId: staff.audited.id, metadata: { pool: 'STAFF' } },
    ]);
    const failed = rows.filter((r) => r.action === 'auth.sign_in_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.actorUserId).toBeNull();
    expect(failed[0]?.metadata).toEqual({
      emailKey: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
      step: 'password',
      pool: 'STAFF',
      reservationId: expect.any(String) as unknown,
    });
    // Its attempt row carries the same reservation and email key.
    const attempt = rows.find((r) => r.action === 'auth.sign_in_attempt');
    expect(attempt?.metadata).toMatchObject({
      emailKey: (failed[0]?.metadata as { emailKey?: string }).emailKey,
      netKey: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
      reservationId: (failed[0]?.metadata as { reservationId?: string }).reservationId,
    });
    expect(JSON.stringify(rows)).not.toContain(staff.audited.email);
    // A keyed hash of the network, never the address, in the metadata.
    expect(JSON.stringify(rows.map((r) => r.metadata))).not.toContain('198.21.0.');
  });

  it('records the lock once, as auth.locked with lockedUntil, and a refused attempt writes nothing', async () => {
    const userAgent = `r2-lim-lockaudit-${tag}`;
    const tagged = (password: string) =>
      request(app.getHttpServer())
        .post('/api/v1/auth/sign-in')
        .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`)
        .set('user-agent', userAgent)
        .send({ email: staff.lockAudit.email, password });
    await fail(SIGN_IN_LIMIT.perAccount, () => tagged(WRONG));
    const retryAt = expectLocked(await tagged(LOCAL_PASSWORD));

    const rows = await asOwner({ kind: 'platform' }, (tx) =>
      tx.auditLog.findMany({
        where: { businessId: null, userAgent },
        select: { action: true, actorUserId: true, metadata: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
    const locks = rows.filter((r) => r.action === 'auth.locked');
    expect(locks).toHaveLength(1);
    expect(locks[0]?.actorUserId).toBeNull();
    const { emailKey } = rows[0]?.metadata as { emailKey: string };
    expect(locks[0]?.metadata).toEqual({
      emailKey,
      pool: 'STAFF',
      lockedUntil: new Date(retryAt).toISOString(),
    });
    // Five attempts and their failures, the lock, and nothing for the refused sixth.
    expect(rows.filter((r) => r.action === 'auth.sign_in_attempt')).toHaveLength(
      SIGN_IN_LIMIT.perAccount,
    );
    expect(JSON.stringify(rows)).not.toContain(staff.lockAudit.email);
  });
});

describe('client portal', () => {
  it("counts a client's failures in the firm's own log, per firm", async () => {
    await fail(SIGN_IN_LIMIT.perAccount, () => portalSignIn(firmX.slug, WRONG));
    expectLocked(await portalSignIn(firmX.slug, LOCAL_PASSWORD));

    // The same email's login at firm Y is a different login, with its own count.
    const atY = await portalSignIn(firmY.slug, LOCAL_PASSWORD);
    expect((atY.body as SignInResult).status).toBe('SIGNED_IN');

    const inX = await asOwner({ kind: 'business', businessId: firmX.id }, (tx) =>
      tx.auditLog.groupBy({
        by: ['action'],
        where: { businessId: firmX.id, action: { in: ['auth.sign_in_failed', 'auth.locked'] } },
        _count: true,
      }),
    );
    // The lock is in the firm's log too.
    expect(Object.fromEntries(inX.map((g) => [g.action, g._count]))).toEqual({
      'auth.sign_in_failed': SIGN_IN_LIMIT.perAccount,
      'auth.locked': 1,
    });
    const inY = await asOwner({ kind: 'business', businessId: firmY.id }, (tx) =>
      tx.auditLog.findMany({
        where: { businessId: firmY.id },
        select: { action: true, actorUserId: true },
      }),
    );
    // Firm Y's log: that one sign-in (its attempt, passed, and the sign-in), nothing of firm X's.
    expect(inY.map((r) => r.action).sort()).toEqual([
      'auth.sign_in_attempt',
      'auth.sign_in_passed',
      'auth.signed_in',
    ]);
    expect(inY.filter((r) => r.action === 'auth.signed_in')).toEqual([
      { action: 'auth.signed_in', actorUserId: clients.atY.id },
    ]);
  });
});

describe('audit rows', () => {
  it('keep at most 512 characters of the User-Agent, anonymous attempts too (#84 review)', async () => {
    const userAgent = `r2-lim-ua-${tag} ${'x'.repeat(2000)}`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in')
      .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`)
      .set('user-agent', userAgent)
      .send({ email: `r2-lim-ua-${tag}@a.test`, password: WRONG });
    expect([res.status, codeOf(res)]).toEqual([401, 'INVALID_CREDENTIALS']);
    const rows = await asOwner({ kind: 'platform' }, (tx) =>
      tx.auditLog.findMany({
        where: { businessId: null, userAgent: { startsWith: `r2-lim-ua-${tag}` } },
        select: { action: true, userAgent: true },
      }),
    );
    expect(rows.map((r) => r.action)).toContain('auth.sign_in_attempt');
    for (const row of rows) expect(row.userAgent).toBe(userAgent.slice(0, 512));
  });
});

describe('outcomes that say nothing about the credential (#84 follow-up)', () => {
  it('never count an error of ours against the email, and close it as released', async () => {
    const email = `r2-lim-release-${tag}@a.test`;
    const userAgent = `r2-lim-release-${tag}`;
    const perEmail = SIGN_IN_LIMIT.perEmailNetwork;
    SIGN_IN_LIMIT.perEmailNetwork = 1;
    const identity = app.get<IdentityProvider>(IDENTITY_PROVIDER);
    const signIn = vi
      .spyOn(identity, 'signIn')
      .mockRejectedValueOnce(new Error('Cognito is unreachable for a moment'));
    try {
      const failed = await request(app.getHttpServer())
        .post('/api/v1/auth/sign-in')
        .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`)
        .set('user-agent', userAgent)
        .send({ email, password: WRONG });
      expect(failed.status).toBe(500);
      // Released: the next wrong password is still answered, and only then the limit holds.
      const wrong = await staffSignIn(email, WRONG);
      expect([wrong.status, codeOf(wrong)]).toEqual([401, 'INVALID_CREDENTIALS']);
      const over = await staffSignIn(email, WRONG);
      expect([over.status, codeOf(over)]).toEqual([429, 'RATE_LIMITED']);
      // The failed request's rows: its attempt, closed by its own action, never "passed".
      const rows = await asOwner({ kind: 'platform' }, (tx) =>
        tx.auditLog.findMany({
          where: { businessId: null, userAgent },
          select: { action: true, metadata: true },
          orderBy: { createdAt: 'asc' },
        }),
      );
      expect(rows.map((r) => r.action)).toEqual(['auth.sign_in_attempt', 'auth.sign_in_released']);
      const [attempt, released] = rows.map((r) => r.metadata as Record<string, unknown>);
      expect(released).toMatchObject({
        reservationId: attempt?.['reservationId'],
        outcome: 'ERROR',
      });
    } finally {
      signIn.mockRestore();
      SIGN_IN_LIMIT.perEmailNetwork = perEmail;
    }
  });

  it('never count an expired MFA session against the attempt', async () => {
    const first = await staffSignIn(staff.released.email, LOCAL_PASSWORD);
    const setup = await post('/api/v1/auth/mfa/setup', {
      session: (first.body as { session: string }).session,
    });
    await post('/api/v1/auth/mfa', {
      session: (setup.body as MfaSetupResponse).session,
      code: LOCAL_MFA_CODE,
    }).expect(200);
    const signIn = await staffSignIn(staff.released.email, LOCAL_PASSWORD);
    const step = signIn.body as SignInResult;
    if (step.status !== 'MFA_REQUIRED') throw new Error(`unexpected ${step.status}`);

    const perAttempt = SIGN_IN_LIMIT.perAttempt;
    SIGN_IN_LIMIT.perAttempt = 1;
    const identity = app.get<IdentityProvider>(IDENTITY_PROVIDER);
    const answer = vi
      .spyOn(identity, 'answerMfa')
      .mockRejectedValueOnce(new AuthFlowError('CHALLENGE_EXPIRED'));
    try {
      const expired = await post('/api/v1/auth/mfa', { session: step.session, code: '111111' });
      expect([expired.status, codeOf(expired)]).toEqual([401, 'CHALLENGE_EXPIRED']);
      // Released: the next code is still checked, and only a wrong one ends the attempt.
      const wrong = await post('/api/v1/auth/mfa', { session: step.session, code: '111111' });
      expect([wrong.status, codeOf(wrong)]).toEqual([401, 'MFA_CODE_INVALID']);
      const over = await post('/api/v1/auth/mfa', { session: step.session, code: LOCAL_MFA_CODE });
      expect([over.status, codeOf(over)]).toEqual([401, 'CHALLENGE_EXPIRED']);
    } finally {
      answer.mockRestore();
      SIGN_IN_LIMIT.perAttempt = perAttempt;
    }
  });
});

describe('the reservation key (#84 follow-up)', () => {
  it("still counts an open attempt written before the rename, under the old key 'token'", async () => {
    const email = `r2-lim-oldkey-${tag}@a.test`;
    const perEmail = SIGN_IN_LIMIT.perEmailNetwork;
    SIGN_IN_LIMIT.perEmailNetwork = 2;
    try {
      // One failure now gives the email key its value as the API writes it. Its own User-Agent
      // finds its row, whatever other test files write at the same time.
      const userAgent = `r2-lim-oldkey-${tag}`;
      const first = await request(app.getHttpServer())
        .post('/api/v1/auth/sign-in')
        .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`)
        .set('user-agent', userAgent)
        .send({ email, password: WRONG });
      expect([first.status, codeOf(first)]).toEqual([401, 'INVALID_CREDENTIALS']);
      const [row] = await asOwner({ kind: 'platform' }, (tx) =>
        tx.auditLog.findMany({
          where: { businessId: null, action: 'auth.sign_in_attempt', userAgent },
          select: { metadata: true },
        }),
      );
      const { emailKey, netKey } = row?.metadata as { emailKey?: string; netKey?: string };
      // An attempt still open from before the rename: its key is 'token'.
      await asOwner({ kind: 'platform' }, (tx) =>
        tx.auditLog.create({
          data: {
            businessId: null,
            action: 'auth.sign_in_attempt',
            entityType: 'login',
            metadata: { emailKey, netKey, step: 'password', pool: 'STAFF', token: randomUUID() },
          },
        }),
      );
      const over = await staffSignIn(email, WRONG);
      expect([over.status, codeOf(over)]).toEqual([429, 'RATE_LIMITED']);
    } finally {
      SIGN_IN_LIMIT.perEmailNetwork = perEmail;
    }
  });
});
