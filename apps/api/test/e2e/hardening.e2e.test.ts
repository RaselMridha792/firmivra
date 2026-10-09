// End-to-end: R8 step 3, API hardening. Security headers on every response, one JSON body limit,
// errors that carry only { code, message, requestId }, and an explicit, tight rate limit on
// every public route that changes something.
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { EsignPutFieldsBody, PublishLegalDocumentRequest } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp, JSON_BODY_LIMIT_BYTES } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { apiRoutes } from '../isolation/routes.js';

const fx = inject('fixtures');
let app: INestApplication;

/** Public routes that change something but need no IP limit of their own, with why. */
const NO_OWN_LIMIT: Record<string, string> = {
  'POST /api/v1/auth/sign-out': 'ends only the caller’s own session',
  'POST /api/v1/admin/auth/sign-out': 'ends only the caller’s own session',
  'POST /api/v1/portal/:firmSlug/auth/sign-out': 'ends only the caller’s own session',
  'POST /api/v1/dev/sign-out': 'AUTH_MODE=local only',
  'POST /api/v1/webhooks/stripe': 'limited by its Stripe signature, not by IP',
};
/** The most a public route that changes something may take from one IP in a minute. */
const PUBLIC_WRITE_LIMIT = 30;

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

const requestIdOnly = (code: string, message: string) => ({
  error: { code, message, requestId: expect.any(String) as unknown },
});

describe('security headers', () => {
  it('a strict CSP, HSTS, nosniff, no-store and no X-Powered-By on API responses', async () => {
    for (const path of ['/api/v1/health', '/api/v1/no-such-route', '/api/v1/me']) {
      const res = await request(app.getHttpServer()).get(path);
      expect(res.headers['content-security-policy'], path).toBe(
        "default-src 'none';frame-ancestors 'none';base-uri 'none';form-action 'none'",
      );
      expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-powered-by']).toBeUndefined();
    }
  });

  it('Swagger UI (not in production) keeps the CSP its scripts need', async () => {
    const res = await request(app.getHttpServer()).get('/api/docs/');
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
  });
});

/** A JSON body of exactly `bytes` bytes. */
const bodyOf = (bytes: number) => {
  const shell = JSON.stringify({ email: '' });
  return JSON.stringify({ email: 'a'.repeat(bytes - shell.length) });
};
const utf8 = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

describe('body limit', () => {
  it('one JSON limit of 2 MB: 413 PAYLOAD_TOO_LARGE above it, nothing echoed', async () => {
    const over = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .set('content-type', 'application/json')
      .send(bodyOf(JSON_BODY_LIMIT_BYTES + 1));
    expect(over.status).toBe(413);
    expect(over.body).toEqual(requestIdOnly('PAYLOAD_TOO_LARGE', 'The request is too large'));
    // At the limit the body is read, and the route's own validation answers (Express's default
    // limit of 100 KB would have refused it).
    const at = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .set('content-type', 'application/json')
      .send(bodyOf(JSON_BODY_LIMIT_BYTES));
    expect(at.status).toBe(400);
  });

  // Not every contract fits yet: EsignPutFieldsBody lets 500 DROPDOWN fields carry 50 options of
  // 100 characters each (3 MB in ASCII, 8.7 MB in three-byte characters). No route takes it yet;
  // the cap is asked of R13 (R8-hardening.md, Needs from others).
  it('the largest Terms, 500 TEXT fields and an adopt fit under it', async () => {
    // Three-byte characters wherever text is free: the most bytes per allowed character.
    const wide = (n: number) => '€'.repeat(n);
    const terms = { body: wide(100_000) };
    expect(PublishLegalDocumentRequest.safeParse(terms).success).toBe(true);
    expect(utf8(terms)).toBeLessThan(JSON_BODY_LIMIT_BYTES);

    const field = (i: number) => ({
      id: `0199b6e0-0000-7000-8000-${String(i).padStart(12, '0')}`,
      recipientId: null,
      type: 'TEXT',
      pageIndex: 0,
      x: 0.123456789,
      y: 0.123456789,
      w: 0.123456789,
      h: 0.123456789,
      required: true,
      label: wide(200),
      groupKey: 'g'.repeat(40),
      value: wide(500),
    });
    const fields = { fields: Array.from({ length: 500 }, (_, i) => field(i)) };
    const parsed = EsignPutFieldsBody.safeParse(fields);
    expect(parsed.error?.issues[0]).toBeUndefined();
    expect(utf8(fields)).toBeLessThan(JSON_BODY_LIMIT_BYTES);

    // A signer's adopt: two base64 PNGs of up to 273,068 characters (contract in R13's PRs).
    const adopt = { signature: 'A'.repeat(273_068), initials: 'A'.repeat(273_068) };
    expect(utf8(adopt)).toBeLessThan(JSON_BODY_LIMIT_BYTES);

    // And the Terms body goes through the real route.
    const res = await request(app.getHttpServer())
      .post('/api/v1/dev/token')
      .send({ email: fx.users.ownerA.email })
      .expect(200);
    const published = await request(app.getHttpServer())
      .post('/api/v1/business/legal/terms/versions')
      .set('authorization', `Bearer ${(res.body as { token: string }).token}`)
      .set('x-business-id', fx.firmA.id)
      .send(terms);
    expect(published.status, JSON.stringify(published.body).slice(0, 200)).toBe(201);
  });
});

describe('errors that leak nothing', () => {
  it('an unknown route or method is a plain 404, without the path', async () => {
    for (const [method, path] of [
      ['get', '/api/v1/no-such-route/secret-path'],
      ['delete', '/api/v1/health'],
    ] as const) {
      const res = await request(app.getHttpServer())[method](path);
      expect(res.status).toBe(404);
      expect(res.body).toEqual(requestIdOnly('NOT_FOUND', 'Not found'));
    }
  });

  it('a body that is not JSON is a plain 400, without the parser’s words', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .set('content-type', 'application/json')
      .send('{"email": "x@example.test",');
    expect(res.status).toBe(400);
    expect(Object.keys((res.body as { error: object }).error).sort()).toEqual([
      'code',
      'message',
      'requestId',
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/JSON|position|Unexpected|at /);
  });
});

describe('rate limits', () => {
  it('every public route that changes something has its own tight limit, or a reason', () => {
    const reflector = app.get(Reflector);
    const problems: string[] = [];
    for (const route of apiRoutes(app)) {
      if (!route.isPublic || route.method === 'GET') continue;
      const key = `${route.method} ${route.path}`;
      if (key in NO_OWN_LIMIT) continue;
      const read = <T>(name: string) =>
        reflector.getAllAndOverride<T | undefined>(`THROTTLER:${name}default`, [
          route.handler,
          route.controller,
        ]);
      if (read<boolean>('SKIP')) {
        problems.push(`${key}: skips the throttler`);
        continue;
      }
      const limit = read<unknown>('LIMIT');
      const ttl = read<unknown>('TTL');
      // Per minute, whatever window the route names. A limit worked out per request (a function)
      // can't be checked here, so it fails too.
      const perMinute =
        typeof limit === 'number' && typeof ttl === 'number' && ttl > 0
          ? (limit * 60_000) / ttl
          : undefined;
      if (perMinute === undefined || perMinute > PUBLIC_WRITE_LIMIT) {
        problems.push(`${key}: ${limit} per ${ttl} ms`);
      }
    }
    expect(problems).toEqual([]);
  });
});
