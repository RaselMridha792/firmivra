// End-to-end: the client portal's public reads (R3 step 2): GET /portal/{firmSlug}/info and
// /legal/{kind}. Contract: docs/api/client-auth.yaml.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { LegalDocument, PortalInfo } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import {
  DEFAULT_ACCENT_COLOR,
  DEFAULT_PRIMARY_COLOR,
} from '../../src/client-auth/portal-info.controller.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
let app: INestApplication;
/** A firm of this file only, with its own settings and legal documents. */
const slug = `r3-portal-${randomUUID().slice(0, 8)}`;

const get = (path: string) => request(app.getHttpServer()).get(path);

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  const firm = await runInScope(owner, { kind: 'platform' }, (tx) =>
    tx.business.create({
      data: { slug, name: 'R3 Test Firm', status: 'ACTIVE' },
      select: { id: true },
    }),
  );
  await runInScope(owner, { kind: 'business', businessId: firm.id }, async (tx) => {
    await tx.businessSettings.create({
      data: {
        businessId: firm.id,
        brandColor: '#123456',
        portalName: 'R3 Portal',
        portalHeader: 'Welcome to R3',
        welcomeMessage: 'Your documents, in one place.',
      },
    });
    for (const [kind, version] of [
      ['TERMS', 1],
      ['TERMS', 2],
      ['PRIVACY', 1],
    ] as const) {
      await tx.firmLegalDocument.create({
        data: {
          businessId: firm.id,
          kind,
          version,
          body: `# ${kind} v${version}`,
          publishedByUserId: fx.users.ownerA.id,
        },
      });
    }
  });
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

describe('GET /portal/{firmSlug}/info', () => {
  it("gives the layout the firm's branding and the current legal versions, signed out", async () => {
    for (const path of [
      `/api/v1/portal/${slug}/info`,
      `/api/v1/portal/${slug.toUpperCase()}/info`,
    ]) {
      const res = await get(path).expect(200);
      expect(PortalInfo.parse(res.body)).toEqual({
        business: { slug, name: 'R3 Test Firm' },
        branding: {
          logoUrl: null,
          primaryColor: '#123456',
          accentColor: DEFAULT_ACCENT_COLOR,
          portalName: 'R3 Portal',
          header: 'Welcome to R3',
          welcomeMessage: 'Your documents, in one place.',
        },
        signUpOpen: true,
        legal: {
          terms: { version: 2, publishedAt: expect.any(String) },
          privacy: { version: 1, publishedAt: expect.any(String) },
        },
      });
      // Nothing beyond the contract, such as the documents' ids.
      expect(Object.keys((res.body as { legal: { terms: object } }).legal.terms).sort()).toEqual([
        'publishedAt',
        'version',
      ]);
    }
  });

  it('falls back to defaults, and keeps sign-up closed without Terms and Privacy', async () => {
    const res = await get(`/api/v1/portal/${fx.firmB.slug}/info`).expect(200);
    expect(PortalInfo.parse(res.body)).toMatchObject({
      branding: {
        primaryColor: DEFAULT_PRIMARY_COLOR,
        accentColor: DEFAULT_ACCENT_COLOR,
        portalName: `${fx.firmB.slug} Client Portal`,
        header: null,
        welcomeMessage: null,
      },
      signUpOpen: false,
      legal: { terms: null, privacy: null },
    });
  });

  it('answers 404 for a firm that is not active, or does not exist', async () => {
    for (const s of [fx.suspended.slug, 'no-such-firm']) {
      const res = await get(`/api/v1/portal/${s}/info`).expect(404);
      expect((res.body as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    }
  });
});

describe('GET /portal/{firmSlug}/legal/{kind}', () => {
  it('gives the current text of each document', async () => {
    const terms = LegalDocument.parse(
      (await get(`/api/v1/portal/${slug}/legal/terms`).expect(200)).body,
    );
    expect(terms).toMatchObject({ kind: 'terms', version: 2, body: '# TERMS v2' });
    const privacy = LegalDocument.parse(
      (await get(`/api/v1/portal/${slug}/legal/privacy`).expect(200)).body,
    );
    expect(privacy).toMatchObject({ kind: 'privacy', version: 1 });
  });

  it('answers 404 for an unknown kind, or a document the firm has not published', async () => {
    await get(`/api/v1/portal/${slug}/legal/cookies`).expect(404);
    await get(`/api/v1/portal/${fx.firmB.slug}/legal/terms`).expect(404);
    await get(`/api/v1/portal/${fx.suspended.slug}/legal/terms`).expect(404);
  });
});
