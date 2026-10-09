// End-to-end: the Firm Sign signer routes, slices 1 and 2 (portal/{slug}/sign), through the real guard
// stack. The signer tables come with r0_esign, so this covers what answers before the
// repository: 404 LINK_INVALID without a cookie, with a forged or other firm's cookie, for an
// unknown or inactive firm and while Firm Sign is off (the contract's one answer for signer
// routes, never MODULE_OFF), and 400 for a bad body. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
let app: INestApplication;
/** A firm of this file only, with Firm Sign on. */
const onSlug = `r13-sign-${randomUUID().slice(0, 8)}`;
const TOKEN = 'A'.repeat(43);
const FIELD = randomUUID();
const TYPED = { printedName: 'Fake Signer', method: 'TYPED', typedSignature: 'Fake Signer' };
/** Every signer route that reads the cookie, with a valid body (code/send: its own test). */
const COOKIE_ROUTES = [
  ['get', 'state', undefined],
  ['post', 'code/verify', { code: '123456' }],
  ['post', 'access-code', { code: 'FAKE1234' }],
  ['get', 'consent', undefined],
  ['post', 'consent', { versionId: randomUUID(), agree: true }],
  ['get', 'envelope', undefined],
  ['get', 'packet', undefined],
  ['post', 'adopt', { signature: TYPED }],
  ['post', 'finish', { values: [] }],
  ['post', 'decline', {}],
] as const;

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  const firm = await runInScope(owner, { kind: 'platform' }, (tx) =>
    tx.business.create({ data: { slug: onSlug, name: onSlug, status: 'ACTIVE' } }),
  );
  await runInScope(owner, { kind: 'business', businessId: firm.id }, (tx) =>
    tx.businessSettings.create({ data: { businessId: firm.id, enabledModules: ['esign'] } }),
  );
  await owner.$disconnect();
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

function send(method: 'get' | 'post', slug: string, path: string, body?: object, cookie?: string) {
  const req = request(app.getHttpServer())[method](`/api/v1/portal/${slug}/sign/${path}`);
  if (cookie) req.set('cookie', cookie);
  return body ? req.send(body) : req;
}
const answer = (res: request.Response) =>
  `${res.status} ${(res.body as { error?: { code: string } }).error?.code}`;

describe('Firm Sign signer routes', () => {
  it('answer 404 LINK_INVALID without a cookie, or with a forged or moved one', async () => {
    const forged = `fv_sign_${onSlug}=not-a-sealed-cookie`;
    const moved = `fv_sign_${fx.firmA.slug}=not-a-sealed-cookie`;
    for (const [method, path, body] of COOKIE_ROUTES) {
      expect(answer(await send(method, onSlug, path, body))).toBe('404 LINK_INVALID');
      expect(answer(await send(method, onSlug, path, body, forged))).toBe('404 LINK_INVALID');
      expect(answer(await send(method, onSlug, path, body, moved))).toBe('404 LINK_INVALID');
    }
  });

  it('answer 404 LINK_INVALID while Firm Sign is off, and for an unknown or suspended firm', async () => {
    for (const slug of [fx.firmA.slug, fx.firmB.slug, fx.suspended.slug, 'no-such-firm-r13']) {
      expect(answer(await send('post', slug, 'session', { token: TOKEN }))).toBe(
        '404 LINK_INVALID',
      );
      for (const [method, path, body] of COOKIE_ROUTES) {
        expect(answer(await send(method, slug, path, body))).toBe('404 LINK_INVALID');
      }
    }
  });

  it("a client's portal session is not a signer session", async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/dev/token').send({
      email: fx.users.clientA.email,
    });
    const token = (res.body as { token: string }).token;
    const state = await request(app.getHttpServer())
      .get(`/api/v1/portal/${onSlug}/sign/state`)
      .set('authorization', `Bearer ${token}`);
    expect(answer(state)).toBe('404 LINK_INVALID');
  });

  it('validate the body (400)', async () => {
    const bad = [
      ['session', {}],
      ['session', { token: 'short' }],
      ['session', { token: TOKEN, extra: 1 }],
      ['code/verify', { code: '12345' }],
      ['code/verify', { code: 'abcdef' }],
      ['access-code', { code: '!!' }],
      ['consent', { versionId: randomUUID(), agree: false }],
      ['consent', { versionId: 'nope', agree: true }],
      ['decline', { reason: 'x'.repeat(501) }],
      ['decline', { extra: true }],
      ['adopt', {}],
      [
        'adopt',
        { signature: { printedName: 'Fake Signer', method: 'TYPED', typedSignature: 'Other' } },
      ],
      ['adopt', { signature: { printedName: 'Fake', method: 'DRAWN', imagePng: 'not-a-png' } }],
      ['adopt', { signature: TYPED, initials: { method: 'TYPED', text: 'x'.repeat(11) } }],
      ['finish', {}],
      ['finish', { values: [{ fieldId: 'nope', value: 'x' }] }],
      [
        'finish',
        {
          values: [
            { fieldId: FIELD, value: 'a' },
            { fieldId: FIELD, value: 'b' },
          ],
        },
      ],
      ['finish', { values: [{ fieldId: FIELD, value: 'x'.repeat(1001) }] }],
    ] as const;
    for (const [path, body] of bad) {
      expect(answer(await send('post', onSlug, path, body))).toBe('400 VALIDATION_FAILED');
    }
  });

  it('rate-limit code/send per IP (5 a minute), before anything else', async () => {
    const answers = [];
    for (let i = 0; i < 6; i++) answers.push(answer(await send('post', onSlug, 'code/send', {})));
    expect(answers).toEqual([...Array<string>(5).fill('404 LINK_INVALID'), '429 RATE_LIMITED']);
  });

  it('session/end clears the cookie on its path', async () => {
    const res = await send('post', onSlug, 'session/end', {});
    expect(res.status).toBe(200);
    expect(String(res.headers['set-cookie'])).toContain(
      `fv_sign_${onSlug}=; Path=/api/v1/portal/${onSlug}/sign;`,
    );
  });
});
