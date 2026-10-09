// End-to-end: R8 step 3, API hardening. Security headers on every response, one JSON body limit,
// errors that carry only { code, message, requestId }, and an explicit, tight rate limit on
// every public route that changes something.
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { apiRoutes } from '../isolation/routes.js';

const fx = inject('fixtures');
let app: INestApplication;

/**
 * Public routes that change something but need no IP limit of their own, with why. A webhook is
 * limited by its signature, not by IP: R19 adds it here when it lands.
 */
const NO_OWN_LIMIT: Record<string, string> = {
  'POST /api/v1/auth/sign-out': 'ends only the caller’s own session',
  'POST /api/v1/admin/auth/sign-out': 'ends only the caller’s own session',
  'POST /api/v1/portal/:firmSlug/auth/sign-out': 'ends only the caller’s own session',
  'POST /api/v1/dev/sign-out': 'AUTH_MODE=local only',
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

describe('body limit', () => {
  it('one JSON limit of 100 KB: 413 PAYLOAD_TOO_LARGE above it, nothing echoed', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ email: `${'a'.repeat(110_000)}@example.test` }));
    expect(res.status).toBe(413);
    expect(res.body).toEqual(requestIdOnly('PAYLOAD_TOO_LARGE', 'The request is too large'));
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
      const limit = reflector.getAllAndOverride<number | undefined>('THROTTLER:LIMITdefault', [
        route.handler,
        route.controller,
      ]);
      if (limit === undefined || limit > PUBLIC_WRITE_LIMIT) problems.push(`${key}: ${limit}`);
    }
    expect(problems).toEqual([]);
  });
});
