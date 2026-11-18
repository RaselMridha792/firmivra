// End-to-end: Client Portal Review One SP-1 (Services & Pricing S7, S12), a package's public link
// and the page behind it. The firm reads the link (on the portal host from config) and its state;
// the public page shows a package only while it is Active, Visible to Clients and set to Display
// on Website/Portal, with its included and not-included services and, when clients may add them,
// its add-ons; never internal notes. Another firm's slug, or an unknown one, is 404. Synthetic.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { PublicLink, PublicPackage } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const owner = { id: randomUUID(), email: `r56p-owner-${run}@r56.test` };
const firms = { p: { id: '', slug: `r56p-${run}` }, q: { id: '', slug: `r56q-${run}` } };
const ids = {} as Record<string, string>;
const SECRET = 'Fake internal note: never on the public page';
const PORTAL = 'https://portal.example.test';
let app: INestApplication;
let token = '';

async function inFirm<T>(firm: 'p' | 'q', work: (tx: TxClient) => Promise<T>): Promise<T> {
  const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(db, { kind: 'business', businessId: firms[firm].id }, work);
  } finally {
    await db.$disconnect();
  }
}
const publicGet = (slug: string, id: string) =>
  request(app.getHttpServer()).get(`/api/v1/portal/${slug}/packages/${id}`);
const linkOf = (id: string) =>
  request(app.getHttpServer())
    .get(`/api/v1/business/catalog/packages/${id}/public-link`)
    .set('authorization', `Bearer ${token}`)
    .set('x-business-id', firms.p.id);
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const ok = <T>(res: Response, schema: { parse: (v: unknown) => T }): T => {
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return schema.parse(res.body);
};

beforeAll(async () => {
  const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    await runInScope(db, { kind: 'platform' }, async (tx) => {
      await tx.user.create({
        data: {
          id: owner.id,
          cognitoSub: owner.id,
          pool: 'STAFF',
          email: owner.email,
          name: 'Fake owner',
        },
      });
      for (const key of ['p', 'q'] as const) {
        firms[key].id = (
          await tx.business.create({
            data: { slug: firms[key].slug, name: `Fake Firm ${key} ${run}`, status: 'ACTIVE' },
            select: { id: true },
          })
        ).id;
      }
    });
  } finally {
    await db.$disconnect();
  }
  await inFirm('p', async (tx) => {
    const businessId = firms.p.id;
    await tx.membership.create({
      data: { businessId, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
    });
    const service = async (key: string, name: string, cents: number) => {
      ids[key] = (
        await tx.service.create({
          data: {
            businessId,
            kind: 'ANNUAL_TAX',
            name,
            status: 'ACTIVE',
            pricingType: 'FIXED',
            basePriceCents: cents,
          },
        })
      ).id;
    };
    await service('return', `Personal return ${run}`, 30_000);
    await service('planning', `Tax planning ${run}`, 20_000);
    await service('audit', `Audit defense ${run}`, 50_000);
    const pack = async (
      key: string,
      over: Partial<{
        status: 'DRAFT' | 'ACTIVE' | 'INACTIVE';
        visibleToClients: boolean;
        displayOnPortal: boolean;
        allowClientAddOns: boolean;
        archivedAt: Date;
      }>,
    ) => {
      const p = await tx.servicePackage.create({
        data: {
          businessId,
          name: `Family ${key} ${run}`,
          shortDescription: 'Everything for the family return (fake)',
          status: 'ACTIVE',
          packagePriceCents: 40_000,
          visibleToClients: true,
          displayOnPortal: true,
          allowClientAddOns: true,
          internalNotes: SECRET,
          ...over,
        },
      });
      ids[key] = p.id;
      let n = 0;
      for (const [serviceKey, included] of [
        ['return', true],
        ['planning', true],
        ['audit', false],
      ] as const)
        await tx.servicePackageItem.create({
          data: {
            businessId,
            packageId: p.id,
            serviceId: ids[serviceKey]!,
            included,
            sortOrder: n++,
          },
        });
      await tx.servicePackageAddOn.create({
        data: { businessId, packageId: p.id, name: 'Rush filing', priceCents: 7_500 },
      });
    };
    await pack('live', {});
    await pack('noAddOns', { allowClientAddOns: false });
    // Display on Website/Portal needs Visible to Clients (the database refuses one without it).
    await pack('hidden', { visibleToClients: false, displayOnPortal: false });
    await pack('offPortal', { displayOnPortal: false });
    await pack('draft', { status: 'DRAFT' });
    await pack('inactive', { status: 'INACTIVE' });
    await pack('archived', { archivedAt: new Date() });
  });

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
    PORTAL_BASE_URL: PORTAL,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
  token = (
    (
      await request(app.getHttpServer())
        .post('/api/v1/dev/token')
        .send({ email: owner.email })
        .expect(200)
    ).body as { token: string }
  ).token;
});

afterAll(async () => {
  await app.close();
});

describe('a package’s public page (SP-1)', () => {
  it('shows a live package: included, not included, add-ons and price; never internal notes', async () => {
    const res = await publicGet(firms.p.slug, ids.live!);
    const page = ok(res, PublicPackage);
    expect(page.state).toBe('LIVE');
    expect(page.details).toEqual({
      name: `Family live ${run}`,
      shortDescription: 'Everything for the family return (fake)',
      category: null,
      packagePriceCents: 40_000,
      savingsCents: 10_000,
      included: [{ name: `Personal return ${run}` }, { name: `Tax planning ${run}` }],
      notIncluded: [{ name: `Audit defense ${run}` }],
      addOns: [{ name: 'Rush filing', description: null, priceCents: 7_500 }],
      bookingTypeId: null,
    });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain('internalNotes');
  });

  it('leaves the add-ons out when clients may not add them', async () => {
    const page = ok(await publicGet(firms.p.slug, ids.noAddOns!), PublicPackage);
    expect(page.details?.addOns).toEqual([]);
  });

  it('refuses a hidden, off-portal, draft, inactive or archived package and shows nothing of it', async () => {
    for (const [key, state] of [
      ['hidden', 'HIDDEN'],
      ['offPortal', 'HIDDEN'],
      ['draft', 'DRAFT'],
      ['inactive', 'INACTIVE'],
      ['archived', 'ARCHIVED'],
    ] as const) {
      const res = await publicGet(firms.p.slug, ids[key]!);
      expect([key, ok(res, PublicPackage)]).toEqual([key, { id: ids[key], state, details: null }]);
      expect(JSON.stringify(res.body)).not.toContain('Family');
    }
  });

  it('is 404 at another firm’s slug, an unknown slug, or for an id that is no package', async () => {
    for (const res of [
      await publicGet(firms.q.slug, ids.live!),
      await publicGet(`nobody-${run}`, ids.live!),
      await publicGet(firms.p.slug, randomUUID()),
    ])
      expect([res.status, codeOf(res)]).toEqual([404, 'NOT_FOUND']);
  });
});

describe('the package’s public link for the firm (SP-1)', () => {
  it('is on the portal host from config, with the state the public page applies', async () => {
    const live = ok(await linkOf(ids.live!), PublicLink);
    expect(live).toMatchObject({
      kind: 'PACKAGE',
      itemId: ids.live,
      url: `${PORTAL}/${firms.p.slug}/packages/${ids.live}`,
      state: 'LIVE',
    });
    expect(live.embedCode).toContain(`${PORTAL}/${firms.p.slug}/packages/${ids.live}`);
    // The same link while hidden: making it visible again brings it back.
    const hidden = ok(await linkOf(ids.hidden!), PublicLink);
    expect(hidden).toMatchObject({
      url: `${PORTAL}/${firms.p.slug}/packages/${ids.hidden}`,
      state: 'HIDDEN',
    });
    expect(ok(await linkOf(ids.archived!), PublicLink).state).toBe('ARCHIVED');
  });
});

describe('a package’s Booking type (S12)', () => {
  const type = (firm: 'p' | 'q', name: string, over: object = {}) =>
    inFirm(firm, (tx) =>
      tx.appointmentType.create({
        data: {
          businessId: firms[firm].id,
          name,
          durationMinutes: 30,
          clientBookable: true,
          ...over,
        },
        select: { id: true },
      }),
    ).then((t) => t.id);
  const firmCall = (method: 'get' | 'patch', path: string, body?: object) => {
    const req = request(app.getHttpServer())
      [method](`/api/v1/business/catalog/packages${path}`)
      .set('authorization', `Bearer ${token}`)
      .set('x-business-id', firms.p.id);
    return body ? req.send(body) : req;
  };
  const setType = async (id: string, appointmentTypeId: string | null) => {
    const current = (await firmCall('get', `/${id}`)).body as { version: string };
    return firmCall('patch', `/${id}`, { appointmentTypeId, version: current.version });
  };

  it('is one of the firm’s own types, saved and cleared on the package', async () => {
    const consult = await type('p', `Consultation ${run}`);
    const saved = await setType(ids.draft!, consult);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((saved.body as { bookingType: unknown }).bookingType).toEqual({
      id: consult,
      name: `Consultation ${run}`,
      bookable: true,
    });
    const cleared = await setType(ids.draft!, null);
    expect((cleared.body as { bookingType: unknown }).bookingType).toBeNull();
  });

  it('opens on the public page only while clients can book the type online', async () => {
    const consult = await type('p', `Consultation online ${run}`);
    await inFirm('p', (tx) =>
      tx.servicePackage.update({ where: { id: ids.live! }, data: { appointmentTypeId: consult } }),
    );
    expect(ok(await publicGet(firms.p.slug, ids.live!), PublicPackage).details?.bookingTypeId).toBe(
      consult,
    );
    // Not booked online: the page keeps its sign-in and contact path.
    await inFirm('p', (tx) =>
      tx.appointmentType.update({ where: { id: consult }, data: { clientBookable: false } }),
    );
    expect(
      ok(await publicGet(firms.p.slug, ids.live!), PublicPackage).details?.bookingTypeId,
    ).toBeNull();
    await inFirm('p', (tx) =>
      tx.servicePackage.update({ where: { id: ids.live! }, data: { appointmentTypeId: null } }),
    );
  });

  it('refuses another firm’s type or an archived one', async () => {
    const theirs = await type('q', `Their consult ${run}`);
    const archived = await type('p', `Old consult ${run}`, { archivedAt: new Date() });
    for (const id of [theirs, archived]) {
      const res = await setType(ids.draft!, id);
      expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([
        400,
        'VALIDATION_FAILED',
      ]);
    }
  });
});
