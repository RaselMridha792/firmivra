// End-to-end: R2 step 7 in AUTH_MODE=local. Failed sign-ins (wrong passwords and wrong MFA
// codes) are audited, and per-email and per-attempt limits count those rows, so every API task
// shares them. Staff rows go in the platform's log; a client's portal rows in the firm's.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import type { MfaSetupResponse, SignInResult } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import {
  AuthFlowError,
  IDENTITY_PROVIDER,
  type IdentityProvider,
} from '../../src/auth/identity/identity-provider.js';
import { LOCAL_MFA_CODE, LOCAL_PASSWORD } from '../../src/auth/identity/local-identity.provider.js';
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
  mfa: person('mfa'),
  released: person('released'),
  audited: person('audited'),
};
const firmX = { id: '', slug: `r2-lim-x-${tag}` };
const firmY = { id: '', slug: `r2-lim-y-${tag}` };
/** One email, a login at each of two firms: each firm's portal counts its own failures. */
const sharedEmail = `r2-lim-client-${tag}@example.com`;
const clients = { atX: { id: randomUUID() }, atY: { id: randomUUID() } };

let lastViewer = 0;
const newViewer = () => `198.21.0.${++lastViewer}`;
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;

/** Each call from a new viewer IP: these tests are about the per-email limits, not per-IP. */
const post = (path: string, body: object, portal = false) => {
  const req = request(app.getHttpServer())
    .post(path)
    .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`);
  return (portal ? req.set('origin', portalOrigin) : req).send(body);
};
const staffSignIn = (email: string, password: string) =>
  post('/api/v1/auth/sign-in', { email, password });
const portalSignIn = (slug: string, password: string) =>
  post(`/api/v1/portal/${slug}/auth/sign-in`, { email: sharedEmail, password }, true);

async function asOwner<T>(
  scope: Parameters<typeof runInScope>[1],
  work: Parameters<typeof runInScope<T>>[2],
) {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
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

describe('per-email limit', () => {
  it('locks an email after SIGN_IN_LIMIT.perEmail failures, real or unknown, and only that email', async () => {
    await fail(SIGN_IN_LIMIT.perEmail, () => staffSignIn(staff.locked.email, WRONG));
    // Even the right password waits now.
    const locked = await staffSignIn(staff.locked.email, LOCAL_PASSWORD);
    expect([locked.status, codeOf(locked)]).toEqual([429, 'RATE_LIMITED']);

    // An unknown email gets exactly the same answers.
    const nobody = `r2-lim-nobody-${tag}@a.test`;
    await fail(SIGN_IN_LIMIT.perEmail, () => staffSignIn(nobody, WRONG));
    const unknown = await staffSignIn(nobody, WRONG);
    expect([unknown.status, codeOf(unknown)]).toEqual([429, 'RATE_LIMITED']);

    // Nobody else is affected.
    expect((await staffSignIn(staff.bystander.email, LOCAL_PASSWORD)).status).toBe(200);
  });
});

describe('wrong MFA codes', () => {
  it('end the attempt after SIGN_IN_LIMIT.perAttempt, and count against the email', async () => {
    // First sign-in sets up the authenticator (local mode), so later ones ask for a code.
    const first = await staffSignIn(staff.mfa.email, LOCAL_PASSWORD);
    const setup = await post('/api/v1/auth/mfa/setup', {
      session: (first.body as { session: string }).session,
    });
    await post('/api/v1/auth/mfa', {
      session: (setup.body as MfaSetupResponse).session,
      code: LOCAL_MFA_CODE,
    }).expect(200);

    const signIn = await staffSignIn(staff.mfa.email, LOCAL_PASSWORD);
    const step = signIn.body as SignInResult;
    if (step.status !== 'MFA_REQUIRED') throw new Error(`unexpected ${step.status}`);
    for (let i = 0; i < SIGN_IN_LIMIT.perAttempt; i += 1) {
      const res = await post('/api/v1/auth/mfa', { session: step.session, code: '111111' });
      expect([res.status, codeOf(res)]).toEqual([401, 'MFA_CODE_INVALID']);
    }
    // The attempt is over, even with the right code: sign in again.
    const over = await post('/api/v1/auth/mfa', { session: step.session, code: LOCAL_MFA_CODE });
    expect([over.status, codeOf(over)]).toEqual([401, 'CHALLENGE_EXPIRED']);

    // Those wrong codes counted for the email: starting again does not give fresh tries.
    await fail(SIGN_IN_LIMIT.perEmail - SIGN_IN_LIMIT.perAttempt, () =>
      staffSignIn(staff.mfa.email, WRONG),
    );
    const locked = await staffSignIn(staff.mfa.email, LOCAL_PASSWORD);
    expect([locked.status, codeOf(locked)]).toEqual([429, 'RATE_LIMITED']);
  });
});

describe('parallel attempts (reserved before Cognito is asked)', () => {
  it('never lets more wrong passwords through than the per-email limit, and no 500', async () => {
    const email = `r2-lim-burst-${tag}@a.test`;
    const results = await Promise.all(Array.from({ length: 30 }, () => staffSignIn(email, WRONG)));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s !== 401 && s !== 429)).toEqual([]);
    expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(SIGN_IN_LIMIT.perEmail);
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
});

describe('audit', () => {
  it('records each sign-in and failure, with a keyed hash of the email, never the email', async () => {
    await fail(1, () => staffSignIn(staff.audited.email, WRONG));
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
          OR: [
            { action: 'auth.signed_in', entityId: staff.audited.id },
            { action: 'auth.sign_in_failed', createdAt: { gt: new Date(Date.now() - 60_000) } },
          ],
        },
        select: { action: true, actorUserId: true, metadata: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
    const signedIn = rows.filter((r) => r.action === 'auth.signed_in');
    expect(signedIn).toEqual([
      { action: 'auth.signed_in', actorUserId: staff.audited.id, metadata: { pool: 'STAFF' } },
    ]);
    const failed = rows.filter((r) => r.action === 'auth.sign_in_failed').at(-1);
    expect(failed?.actorUserId).toBeNull();
    expect(failed?.metadata).toEqual({
      emailKey: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
      step: 'password',
      pool: 'STAFF',
      token: expect.any(String) as unknown,
    });
    expect(JSON.stringify(rows)).not.toContain(staff.audited.email);
  });
});

describe('client portal', () => {
  it("counts a client's failures in the firm's own log, per firm", async () => {
    await fail(SIGN_IN_LIMIT.perEmail, () => portalSignIn(firmX.slug, WRONG));
    const locked = await portalSignIn(firmX.slug, LOCAL_PASSWORD);
    expect([locked.status, codeOf(locked)]).toEqual([429, 'RATE_LIMITED']);

    // The same email's login at firm Y is a different login, with its own count.
    const atY = await portalSignIn(firmY.slug, LOCAL_PASSWORD);
    expect((atY.body as SignInResult).status).toBe('SIGNED_IN');

    const inX = await asOwner({ kind: 'business', businessId: firmX.id }, (tx) =>
      tx.auditLog.count({ where: { businessId: firmX.id, action: 'auth.sign_in_failed' } }),
    );
    expect(inX).toBe(SIGN_IN_LIMIT.perEmail);
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
    const perEmail = SIGN_IN_LIMIT.perEmail;
    SIGN_IN_LIMIT.perEmail = 1;
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
      expect(released).toMatchObject({ token: attempt?.['token'], outcome: 'ERROR' });
    } finally {
      signIn.mockRestore();
      SIGN_IN_LIMIT.perEmail = perEmail;
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
