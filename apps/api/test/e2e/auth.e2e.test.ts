// End-to-end: staff and Super Admin sign-in (R2) in AUTH_MODE=local, the same routes and guards
// as with Cognito. Contract: docs/api/auth.yaml.
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { MfaSetupResponse, SignInResult } from '@firmivra/types';
import {
  LOCAL_MFA_CODE,
  LOCAL_PASSWORD,
  LOCAL_RESET_CODE,
  LOCAL_TOTP_SECRET,
} from '../../src/auth/identity/local-identity.provider.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
let app: INestApplication;

/** The ALB's view: CloudFront's address is the last X-Forwarded-For entry, the viewer before it. */
const CLOUDFRONT = '10.0.0.5';
let lastViewer = 0;
/** A fresh viewer IP per test, so one test's attempts never count against another's limit. */
const newViewer = () => `203.0.113.${++lastViewer}`;

const post = (path: string, body: object, viewer: string) =>
  request(app.getHttpServer())
    .post(path)
    .set('x-forwarded-for', `${viewer}, ${CLOUDFRONT}`)
    .send(body);

const errorCode = (res: Response) => (res.body as { error: { code: string } }).error.code;
const setCookies = (res: Response): string[] => {
  const raw = res.headers['set-cookie'] as unknown;
  return Array.isArray(raw) ? (raw as string[]) : [];
};
/** The cookies a browser would send back. */
const cookieHeader = (res: Response) =>
  setCookies(res)
    .map((c) => c.split(';')[0])
    .join('; ');

/** Password, first-time authenticator setup and the first code, as the screens do it. */
async function signInWithSetup(base: string, email: string, viewer: string) {
  const first = await post(`${base}/sign-in`, { email, password: LOCAL_PASSWORD }, viewer).expect(
    200,
  );
  const step = first.body as SignInResult;
  expect(step.status).toBe('MFA_SETUP_REQUIRED');
  if (step.status !== 'MFA_SETUP_REQUIRED') throw new Error('unreachable');

  const setup = await post(`${base}/mfa/setup`, { session: step.session }, viewer).expect(200);
  const { session } = setup.body as MfaSetupResponse;
  return {
    setup: setup.body as MfaSetupResponse,
    done: await post(`${base}/mfa`, { session, code: LOCAL_MFA_CODE }, viewer).expect(200),
  };
}

beforeAll(async () => {
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
  await nest.init();
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('staff sign-in (firm site)', () => {
  it('sets up the authenticator on first sign-in, then asks for a code', async () => {
    const viewer = newViewer();
    const email = fx.users.ownerA.email.toUpperCase();
    const first = await post('/api/v1/auth/sign-in', { email, password: LOCAL_PASSWORD }, viewer);
    const { session } = first.body as { session: string };

    // A code before setup is the wrong step.
    const early = await post('/api/v1/auth/mfa', { session, code: LOCAL_MFA_CODE }, viewer);
    expect(early.status).toBe(400);

    const setup = await post('/api/v1/auth/mfa/setup', { session }, viewer).expect(200);
    const body = setup.body as MfaSetupResponse;
    expect(body.secret).toBe(LOCAL_TOTP_SECRET);
    expect(body.otpauthUri).toContain(`otpauth://totp/Firmivra%3Aowner-a%40a.test?`);

    const wrong = await post('/api/v1/auth/mfa', { session: body.session, code: '111111' }, viewer);
    expect(wrong.status).toBe(401);
    expect(errorCode(wrong)).toBe('MFA_CODE_INVALID');

    // Locally the session survives a wrong code (with Cognito the API may answer CHALLENGE_EXPIRED).
    const done = await post(
      '/api/v1/auth/mfa',
      { session: body.session, code: '000 000' },
      viewer,
    ).expect(200);
    const result = done.body as SignInResult;
    expect(result.status).toBe('SIGNED_IN');
    if (result.status !== 'SIGNED_IN') throw new Error('unreachable');
    expect(result.me.user.email).toBe(fx.users.ownerA.email);
    expect(result.me.memberships).toEqual([
      expect.objectContaining({
        role: 'OWNER',
        business: expect.objectContaining({ id: fx.firmA.id }),
      }),
    ]);

    const [access, refresh] = setCookies(done);
    expect(setCookies(done)).toHaveLength(2);
    expect(access).toMatch(/^fv_access=.*; Path=\/;.*HttpOnly.*SameSite=Lax/i);
    expect(refresh).toMatch(/^fv_refresh=.*; Max-Age=604800; Path=\/api\/v1\/auth;/i);
    expect(refresh).toMatch(/HttpOnly.*SameSite=Strict/i);
    for (const c of setCookies(done)) expect(c).not.toMatch(/Domain=/i);

    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('cookie', cookieHeader(done))
      .expect(200);

    // Second sign-in: the authenticator is set up, so a code is enough.
    const again = await post(
      '/api/v1/auth/sign-in',
      { email, password: LOCAL_PASSWORD },
      viewer,
    ).expect(200);
    const next = again.body as SignInResult;
    expect(next.status).toBe('MFA_REQUIRED');
    if (next.status !== 'MFA_REQUIRED') throw new Error('unreachable');
    const signedIn = await post(
      '/api/v1/auth/mfa',
      { session: next.session, code: LOCAL_MFA_CODE },
      viewer,
    ).expect(200);
    expect((signedIn.body as SignInResult).status).toBe('SIGNED_IN');
  });

  it('answers a wrong password and an unknown email the same way', async () => {
    const viewer = newViewer();
    const wrong = await post(
      '/api/v1/auth/sign-in',
      { email: fx.users.staffA.email, password: 'Not-the-password-1' },
      viewer,
    ).expect(401);
    const unknown = await post(
      '/api/v1/auth/sign-in',
      { email: 'nobody@a.test', password: LOCAL_PASSWORD },
      viewer,
    ).expect(401);
    const strip = (res: Response) => ({ ...(res.body as { error: object }).error, requestId: 0 });
    expect(strip(wrong)).toEqual(strip(unknown));
    expect(errorCode(wrong)).toBe('INVALID_CREDENTIALS');
  });

  it('never signs in a client or a Super Admin on the firm site', async () => {
    const viewer = newViewer();
    for (const email of [fx.users.clientA.email, fx.users.admin.email]) {
      const res = await post('/api/v1/auth/sign-in', { email, password: LOCAL_PASSWORD }, viewer);
      expect(res.status).toBe(401);
      expect(errorCode(res)).toBe('INVALID_CREDENTIALS');
    }
  });

  it('refuses a forged session', async () => {
    const res = await post(
      '/api/v1/auth/mfa',
      { session: 'not-a-session', code: LOCAL_MFA_CODE },
      newViewer(),
    ).expect(401);
    expect(errorCode(res)).toBe('CHALLENGE_EXPIRED');
  });
});

describe('Super Admin sign-in (admin site)', () => {
  it('signs in with its own cookie, which only works on /api/v1/admin/*', async () => {
    const viewer = newViewer();
    const { setup, done } = await signInWithSetup(
      '/api/v1/admin/auth',
      fx.users.admin.email,
      viewer,
    );
    expect(setup.otpauthUri).toContain('otpauth://totp/Firmivra%20Admin%3A');
    expect(setCookies(done)).toEqual([
      expect.stringMatching(/^fv_admin_access=/),
      expect.stringMatching(/^fv_admin_refresh=.*; Max-Age=86400; Path=\/api\/v1\/admin\/auth;/),
    ]);
    const cookie = cookieHeader(done);

    const me = await request(app.getHttpServer())
      .get('/api/v1/admin/me')
      .set('cookie', cookie)
      .expect(200);
    expect((me.body as { platformAdmin: boolean }).platformAdmin).toBe(true);

    // An admin session never authenticates on the firm API.
    await request(app.getHttpServer()).get('/api/v1/me').set('cookie', cookie).expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/business')
      .set('cookie', cookie)
      .set('x-business-id', fx.firmA.id)
      .expect(401);
  });

  it('never signs in staff on the admin site, and staff cookies do not work there', async () => {
    const viewer = newViewer();
    const res = await post(
      '/api/v1/admin/auth/sign-in',
      { email: fx.users.ownerB.email, password: LOCAL_PASSWORD },
      viewer,
    ).expect(401);
    expect(errorCode(res)).toBe('INVALID_CREDENTIALS');

    const { done } = await signInWithSetup('/api/v1/auth', fx.users.ownerB.email, viewer);
    await request(app.getHttpServer())
      .get('/api/v1/admin/me')
      .set('cookie', cookieHeader(done))
      .expect(401);
  });

  it('does not accept a firm-site session on the admin site', async () => {
    const viewer = newViewer();
    const first = await post(
      '/api/v1/auth/sign-in',
      { email: fx.users.staffA.email, password: LOCAL_PASSWORD },
      viewer,
    ).expect(200);
    const { session } = first.body as { session: string };
    const res = await post('/api/v1/admin/auth/mfa/setup', { session }, viewer).expect(401);
    expect(errorCode(res)).toBe('CHALLENGE_EXPIRED');
  });
});

describe('rate limits use the viewer IP behind CloudFront and the ALB', () => {
  const attempt = (xff: string) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/sign-in')
      .set('x-forwarded-for', xff)
      .send({ email: 'nobody@a.test', password: 'Wrong-password-1' });

  it('limits one viewer without locking out the others', async () => {
    const viewer = newViewer();
    for (let i = 0; i < 10; i += 1) {
      await attempt(`${viewer}, ${CLOUDFRONT}`).expect(401);
    }
    const blocked = await attempt(`${viewer}, ${CLOUDFRONT}`).expect(429);
    expect(errorCode(blocked)).toBe('RATE_LIMITED');

    // Same CloudFront edge, another viewer: not affected.
    await attempt(`${newViewer()}, ${CLOUDFRONT}`).expect(401);
    // Addresses a client adds in front are ignored: still the same viewer.
    await attempt(`198.51.100.77, ${viewer}, ${CLOUDFRONT}`).expect(429);
  });
});

/** Signs in whatever the step: first-time setup or a code. */
async function signInFully(base: string, email: string, viewer: string, password = LOCAL_PASSWORD) {
  const first = await post(`${base}/sign-in`, { email, password }, viewer).expect(200);
  let step = first.body as SignInResult;
  if (step.status === 'MFA_SETUP_REQUIRED') {
    const setup = await post(`${base}/mfa/setup`, { session: step.session }, viewer).expect(200);
    step = { status: 'MFA_REQUIRED', session: (setup.body as MfaSetupResponse).session };
  }
  if (step.status !== 'MFA_REQUIRED') throw new Error(`unexpected ${step.status}`);
  return post(`${base}/mfa`, { session: step.session, code: LOCAL_MFA_CODE }, viewer).expect(200);
}

/** "name=value" of one cookie the response set. */
const cookieNamed = (res: Response, name: string) =>
  setCookies(res)
    .map((c) => c.split(';')[0] ?? '')
    .find((c) => c.startsWith(`${name}=`)) ?? '';

describe('sessions: refresh and sign-out', () => {
  it('renews the access cookie from the refresh cookie alone', async () => {
    const done = await signInFully('/api/v1/auth', fx.users.staffA.email, newViewer());
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('cookie', cookieNamed(done, 'fv_refresh'))
      .expect(200);
    expect(res.body).toEqual({ ok: true });
    const access = cookieNamed(res, 'fv_access');
    expect(access).toMatch(/^fv_access=.+/);
    // No rotation: the refresh cookie keeps its original expiry.
    expect(cookieNamed(res, 'fv_refresh')).toBe('');
    await request(app.getHttpServer()).get('/api/v1/me').set('cookie', access).expect(200);
  });

  it('answers 401 and clears the cookies without a valid refresh cookie', async () => {
    for (const cookie of ['', 'fv_refresh=forged']) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('cookie', cookie)
        .expect(401);
      expect(errorCode(res)).toBe('UNAUTHENTICATED');
      expect(setCookies(res).join('\n')).toMatch(/^fv_refresh=; Path=\/api\/v1\/auth;/m);
    }
  });

  it('never refreshes a Super Admin session on the firm site', async () => {
    const done = await signInFully('/api/v1/admin/auth', fx.users.admin.email, newViewer());
    const sealed = cookieNamed(done, 'fv_admin_refresh').slice('fv_admin_refresh='.length);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('cookie', `fv_refresh=${sealed}`)
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/admin/auth/refresh')
      .set('cookie', `fv_admin_refresh=${sealed}`)
      .expect(200);
  });

  it('signs out by clearing all three cookies, even when already signed out', async () => {
    const done = await signInFully('/api/v1/auth', fx.users.staffA.email, newViewer());
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-out')
      .set('cookie', cookieHeader(done))
      .send({ everywhere: true })
      .expect(200);
    expect(res.body).toEqual({ ok: true });
    const cleared = setCookies(res).join('\n');
    expect(cleared).toMatch(/^fv_access=; Path=\/; Expires=Thu, 01 Jan 1970/m);
    expect(cleared).toMatch(/^fv_id=; Path=\/; Expires=Thu, 01 Jan 1970/m);
    expect(cleared).toMatch(/^fv_refresh=; Path=\/api\/v1\/auth; Expires=Thu, 01 Jan 1970/m);

    await request(app.getHttpServer()).post('/api/v1/auth/sign-out').expect(200);
    await request(app.getHttpServer()).post('/api/v1/admin/auth/sign-out').expect(200);
  });
});

describe('forgot and reset password', () => {
  it('answers forgot-password the same for known and unknown emails', async () => {
    const viewer = newViewer();
    for (const email of [fx.users.staffA.email, 'nobody@a.test']) {
      const res = await post('/api/v1/auth/forgot-password', { email }, viewer).expect(200);
      expect(res.body).toEqual({ ok: true });
    }
  });

  it('resets the password with the code; the old one stops working', async () => {
    const viewer = newViewer();
    const email = fx.users.ownerSuspended.email;
    const newPassword = 'Brand-new-password-7';

    const wrongCode = await post(
      '/api/v1/auth/reset-password',
      { email, code: '123456', password: newPassword },
      viewer,
    ).expect(400);
    expect(errorCode(wrongCode)).toBe('RESET_CODE_INVALID');

    const unknown = await post(
      '/api/v1/auth/reset-password',
      { email: 'nobody@a.test', code: LOCAL_RESET_CODE, password: newPassword },
      viewer,
    ).expect(400);
    expect(errorCode(unknown)).toBe('RESET_CODE_INVALID');

    const weak = await post(
      '/api/v1/auth/reset-password',
      { email, code: LOCAL_RESET_CODE, password: 'weak' },
      viewer,
    ).expect(400);
    expect(errorCode(weak)).toBe('VALIDATION_FAILED');

    await post(
      '/api/v1/auth/reset-password',
      { email, code: LOCAL_RESET_CODE, password: newPassword },
      viewer,
    ).expect(200);

    const old = await post('/api/v1/auth/sign-in', { email, password: LOCAL_PASSWORD }, viewer);
    expect(errorCode(old)).toBe('INVALID_CREDENTIALS');
    await signInFully('/api/v1/auth', email, viewer, newPassword);
  });
});
