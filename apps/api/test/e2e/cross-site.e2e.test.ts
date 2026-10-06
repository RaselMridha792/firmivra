// End-to-end: requests from other sites are refused (login CSRF fix from #16), the API sends
// no CORS headers, and the Super Admin site is recognised whatever the path's letter case.
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { type Env, loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
let app: INestApplication;
let env: Env;
let site: { app: string; portal: string; admin: string };

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
/** A sign-in step the API cannot open: a request that gets through answers CHALLENGE_EXPIRED. */
const mfaBody = { session: 'attacker-session', code: '123456' };

beforeAll(async () => {
  env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  site = {
    app: new URL(env.APP_BASE_URL).origin,
    portal: new URL(env.PORTAL_BASE_URL).origin,
    admin: new URL(env.ADMIN_BASE_URL).origin,
  };
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

describe('login CSRF: only JSON from the site itself', () => {
  it('refuses the attack: a form on another site posting a session and code to /auth/mfa', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa')
      .set('origin', 'https://attacker.example')
      .type('form')
      .send(mfaBody);
    expect([res.status, codeOf(res)]).toEqual([415, 'UNSUPPORTED_MEDIA_TYPE']);
    expect((res.body as { error: { requestId: string } }).error.requestId).toBeTruthy();
  });

  it.each([
    ['application/x-www-form-urlencoded', 'session=s&code=123456'],
    ['text/plain', '{"session":"s","code":"123456"}'],
    ['multipart/form-data; boundary=x', '--x--'],
  ])('refuses a %s body even from the site itself', async (type, body) => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa')
      .set('origin', site.app)
      .set('content-type', type)
      .send(body);
    expect([res.status, codeOf(res)]).toEqual([415, 'UNSUPPORTED_MEDIA_TYPE']);
  });

  it('refuses JSON from another origin, and from a sandboxed page', async () => {
    for (const origin of ['https://attacker.example', 'null', site.admin]) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/mfa')
        .set('origin', origin)
        .send(mfaBody);
      expect([origin, res.status, codeOf(res)]).toEqual([origin, 403, 'ORIGIN_NOT_ALLOWED']);
    }
  });

  it("lets each site's own pages through (they reach the handler)", async () => {
    for (const [path, origin] of [
      ['/api/v1/auth/mfa', site.app],
      ['/api/v1/auth/mfa', site.portal],
      ['/api/v1/admin/auth/mfa', site.admin],
    ] as const) {
      const res = await request(app.getHttpServer()).post(path).set('origin', origin).send(mfaBody);
      expect([path, origin, codeOf(res)]).toEqual([path, origin, 'CHALLENGE_EXPIRED']);
    }
  });

  it('keeps the firm site off the Super Admin API', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/admin/auth/mfa')
      .set('origin', site.app)
      .send(mfaBody);
    expect([res.status, codeOf(res)]).toEqual([403, 'ORIGIN_NOT_ALLOWED']);
  });

  it('without Origin, trusts only Sec-Fetch-Site: same-origin', async () => {
    const send = (fetchSite?: string) => {
      const req = request(app.getHttpServer()).post('/api/v1/auth/mfa');
      return (fetchSite ? req.set('sec-fetch-site', fetchSite) : req).send(mfaBody);
    };
    // same-site is still another site: admin.dev and app.dev share the parent domain.
    for (const fetchSite of ['cross-site', 'same-site', 'none']) {
      expect(codeOf(await send(fetchSite))).toBe('ORIGIN_NOT_ALLOWED');
    }
    expect(codeOf(await send('same-origin'))).toBe('CHALLENGE_EXPIRED');
    // Neither header: not a browser (tests, server-side calls), so no CSRF.
    expect(codeOf(await send())).toBe('CHALLENGE_EXPIRED');
  });

  it('checks PUT, PATCH and DELETE too, but never reads', async () => {
    for (const method of ['put', 'patch', 'delete'] as const) {
      const res = await request(app.getHttpServer())
        [method]('/api/v1/auth/sign-out')
        .set('origin', 'https://attacker.example');
      expect([method, res.status]).toEqual([method, 403]);
    }
    await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('origin', 'https://attacker.example')
      .expect(200);
  });

  it('accepts local sign-in from any of the three sites, nobody else', async () => {
    for (const origin of [site.app, site.portal, site.admin]) {
      await request(app.getHttpServer())
        .post('/api/v1/dev/sign-out')
        .set('origin', origin)
        .expect(200);
    }
    await request(app.getHttpServer())
      .post('/api/v1/dev/sign-out')
      .set('origin', 'https://attacker.example')
      .expect(403);
  });
});

describe('no CORS', () => {
  it('answers no other origin, not even the sites (each calls the API on its own host)', async () => {
    const preflight = await request(app.getHttpServer())
      .options('/api/v1/auth/sign-in')
      .set('origin', site.app)
      .set('access-control-request-method', 'POST')
      .set('access-control-request-headers', 'content-type');
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    expect(preflight.headers['access-control-allow-credentials']).toBeUndefined();

    const res = await request(app.getHttpServer()).get('/api/v1/health').set('origin', site.app);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('Super Admin site, whatever the letter case', () => {
  it('reads the admin cookie on /API/V1/Admin/... and never the firm cookie', async () => {
    const signIn = async (email: string) => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/dev/token')
        .send({ email })
        .expect(200);
      const raw = res.headers['set-cookie'] as unknown as string[];
      return raw.map((c) => c.split(';')[0]).join('; ');
    };
    const adminCookie = await signIn(fx.users.admin.email);
    const staffCookie = await signIn(fx.users.ownerA.email);

    for (const path of ['/api/v1/ADMIN/me', '/API/V1/Admin/me']) {
      await request(app.getHttpServer()).get(path).set('cookie', adminCookie).expect(200);
      await request(app.getHttpServer()).get(path).set('cookie', staffCookie).expect(401);
    }
    // The cross-site check sees the admin site too.
    const res = await request(app.getHttpServer())
      .post('/API/V1/Admin/auth/mfa')
      .set('origin', site.app)
      .send(mfaBody);
    expect(codeOf(res)).toBe('ORIGIN_NOT_ALLOWED');
  });
});
