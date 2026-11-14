// End-to-end: R55, Intake Forms Review Two INTAKE-ACCESS-02 (decisions approved Nov 15). A published
// form has a stable share link and a website button (a link styled as a button: an inline iframe
// can't show on another site yet), turned on by its first publish and off by the Owner or Admin
// (then the link refuses at once), and a Publish in client portal switch (off by default). The
// link starts a Begin Online draft of exactly that form, as a Website Form lead, with a honeypot,
// the start limits and an hourly cap per form. These tests are the routes' isolation walls too
// (test/isolation/cases/begin-online.ts, intake-workspace.ts). Synthetic data only.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  BeginDraft,
  BeginOnlineForm,
  INTAKE_FORMS,
  IntakeAgreementBlock,
  IntakeShare,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { SHARE_STARTS_PER_HOUR } from '../../src/begin-online/begin-online.service.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const outbox: NotifyMessage[] = [];
const person = (key: string) => ({ id: randomUUID(), email: `r55is-${key}-${run}@r55.test` });
const people = { ownerA: person('owner-a'), staffA: person('staff-a'), ownerB: person('owner-b') };
const firms = {} as Record<'a' | 'b', { id: string; slug: string }>;
const ids = {} as Record<'service' | 'shared' | 'draft' | 'fresh' | 'live', string>;
let app: INestApplication;
let portalOrigin = '';
let portalBase = '';
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.71.${100 + Math.floor(++viewers / 250)}.${viewers % 250}`;
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const FORM = INTAKE_FORMS.QUARTERLY_TAX!;

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
const inFirmA = <T>(work: Parameters<typeof runInScope<T>>[2]) =>
  asOwner({ kind: 'business', businessId: firms.a.id }, work);

async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .set('x-forwarded-for', `${viewer()}, 10.0.0.5`)
    .send({ email })
    .expect(200);
  const token = (res.body as { token: string }).token;
  tokens.set(email, token);
  return token;
}
async function firmCall(
  method: 'get' | 'put' | 'post',
  path: string,
  who: { email: string },
  body?: object,
  firm: 'a' | 'b' = 'a',
): Promise<Response> {
  const token = await tokenFor(who.email);
  const req = request(app.getHttpServer())
    [method](`/api/v1/business/intake-forms${path}`)
    .set('x-business-id', firms[firm].id)
    .set('x-forwarded-for', `${viewer()}, 10.0.0.5`)
    .set('authorization', `Bearer ${token}`);
  return body ? req.send(body) : req;
}
const share = (res: Response) => IntakeShare.parse(ok(res));

/** A browser on a firm's Begin Online pages: its own network, cookie jar and the portal's origin. */
function visitor(slug: string) {
  const ip = viewer();
  const jar = new Map<string, string>();
  const keep = (res: Response) => {
    const raw = res.headers['set-cookie'] as unknown;
    for (const c of Array.isArray(raw) ? (raw as string[]) : []) {
      const [pair] = c.split(';');
      const at = pair!.indexOf('=');
      const name = pair!.slice(0, at);
      if (name.startsWith('fv_bo_')) jar.set(name, pair!.slice(at + 1));
    }
    return res;
  };
  const send = (method: 'get' | 'post', path: string, body?: object) => {
    let req = request(app.getHttpServer())
      [method](`/api/v1/portal/${slug}/begin${path}`)
      .set('x-forwarded-for', `${ip}, 10.0.0.5`)
      .set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
    if (method !== 'get') req = req.set('origin', portalOrigin);
    return (body ? req.send(body) : req).then(keep);
  };
  return { get: (p: string) => send('get', p), post: (p: string, b: object) => send('post', p, b) };
}
let emails = 0;
const contact = (extra: object = {}) => ({
  firstName: 'Avery',
  lastName: 'Shared',
  email: `avery.${run}.${++emails}@example.test`,
  phone: '(770) 555-0142',
  ...extra,
});
const tokenOf = (url: string) => /\/start\/([A-Za-z0-9_-]{43})$/.exec(url)![1]!;

beforeAll(async () => {
  process.env['KMS_MODE'] ??= 'local';
  process.env['LOCAL_KMS_KEY'] ??= randomBytes(32).toString('base64');
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    }
    for (const key of ['a', 'b'] as const) {
      firms[key] = await tx.business.create({
        data: { slug: `r55-is-${key}-${run}`, name: `R55 Share ${key}`, status: 'ACTIVE' },
        select: { id: true, slug: true },
      });
    }
  });
  await inFirmA(async (tx) => {
    const businessId = firms.a.id;
    for (const [p, role] of [
      [people.ownerA, 'OWNER'],
      [people.staffA, 'STAFF'],
    ] as const) {
      await tx.membership.create({ data: { businessId, userId: p.id, role, status: 'ACTIVE' } });
    }
    ids.service = (
      await tx.service.create({
        data: { businessId, kind: 'QUARTERLY_TAX', name: `Quarterly ${run}`, status: 'ACTIVE' },
      })
    ).id;
    const template = async (status: 'PUBLISHED' | 'DRAFT', title: string) => {
      const t = await tx.intakeTemplate.create({
        data: { businessId, serviceId: ids.service, createdByUserId: people.ownerA.id },
      });
      await tx.intakeForm.create({
        data: {
          businessId,
          serviceId: ids.service,
          templateId: t.id,
          version: 1,
          title,
          definition: { ...FORM, title } as object,
          status,
          ...(status === 'PUBLISHED' ? { publishedAt: new Date() } : {}),
        },
      });
      return t.id;
    };
    ids.shared = await template('PUBLISHED', 'Quarterly Check-In (shared)');
    ids.draft = await template('DRAFT', 'Quarterly Draft');
    ids.fresh = await template('DRAFT', 'Quarterly First Publish');
  });
  await asOwner({ kind: 'business', businessId: firms.b.id }, (tx) =>
    tx.membership.create({
      data: { businessId: firms.b.id, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    }),
  );
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  portalOrigin = new URL(env.PORTAL_BASE_URL).origin;
  portalBase = env.PORTAL_BASE_URL.replace(/\/+$/, '');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({
      send: (message: NotifyMessage) => {
        outbox.push(message);
        return Promise.resolve();
      },
    })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.init();
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('Share & Publish (firm)', () => {
  it('the Owner shares a published form; Staff read it; a draft is not shared', async () => {
    const before = share(await firmCall('get', `/${ids.shared}/share`, people.staffA));
    expect(before).toMatchObject({
      main: false,
      shareable: true,
      sharing: false,
      portalPublished: false,
      link: null,
    });
    expectError(
      await firmCall('put', `/${ids.shared}/share`, people.staffA, {
        sharing: true,
        portalPublished: false,
      }),
      403,
      'FORBIDDEN',
    );
    const on = share(
      await firmCall('put', `/${ids.shared}/share`, people.ownerA, {
        sharing: true,
        portalPublished: true,
      }),
    );
    expect(on).toMatchObject({ sharing: true, portalPublished: true });
    const url = on.link!.url;
    expect(url).toMatch(new RegExp(`^${portalBase}/${firms.a.slug}/start/[A-Za-z0-9_-]{43}$`));
    // A website button that opens the link; never an iframe that another site can't show.
    expect(on.link!.embedCode).toMatch(/^<a href="[^"]+" target="_blank" rel="noopener"/);
    expect(on.link!.embedCode).toContain('>Quarterly Check-In (shared)</a>');
    expect(on.link!.embedCode).not.toContain('iframe');
    expect(on.link!.state).toBe('LIVE');
    // Stable: the same link every time; only its hash is stored.
    expect(share(await firmCall('get', `/${ids.shared}/share`, people.ownerA)).link!.url).toBe(url);
    const stored = await inFirmA((tx) =>
      tx.intakeTemplate.findUniqueOrThrow({ where: { id: ids.shared } }),
    );
    expect(stored.shareTokenHash).toBe(sha256(tokenOf(url)));
    expectError(
      await firmCall('put', `/${ids.draft}/share`, people.ownerA, {
        sharing: true,
        portalPublished: false,
      }),
      409,
      'NOT_SHAREABLE',
    );
    // Firm B finds none of firm A's forms.
    expectError(
      await firmCall('get', `/${ids.shared}/share`, people.ownerB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
    const audit = await inFirmA((tx) =>
      tx.auditLog.findMany({
        where: { entityId: ids.shared, action: 'intake_form.share_changed' },
      }),
    );
    expect(audit[0]!.metadata).toEqual({ sharing: true, portalPublished: true });
  });

  it("a form's first publish turns its link on; archiving turns both switches off", async () => {
    expect(share(await firmCall('get', `/${ids.fresh}/share`, people.ownerA))).toMatchObject({
      shareable: false,
      sharing: false,
    });
    ok(await firmCall('post', `/${ids.fresh}/publish`, people.ownerA));
    const published = share(await firmCall('get', `/${ids.fresh}/share`, people.ownerA));
    expect(published).toMatchObject({ shareable: true, sharing: true });
    ok(
      await firmCall('put', `/${ids.fresh}/share`, people.ownerA, {
        sharing: true,
        portalPublished: true,
      }),
    );
    ok(await firmCall('post', `/${ids.fresh}/archive`, people.ownerA));
    expect(share(await firmCall('get', `/${ids.fresh}/share`, people.ownerA))).toMatchObject({
      shareable: false,
      sharing: false,
      portalPublished: false,
      link: null,
    });
  });
});

describe('the shared link (public)', () => {
  it('starts a Begin Online draft of exactly that form, as a Website Form lead', async () => {
    const on = share(await firmCall('get', `/${ids.shared}/share`, people.ownerA));
    const token = tokenOf(on.link!.url);
    const v = visitor(firms.a.slug);
    const form = BeginOnlineForm.parse(ok(await v.get(`/share/${token}`)));
    expect(form).toMatchObject({ form: 'QUARTERLY_TAX', title: 'Quarterly Check-In (shared)' });
    const draft = BeginDraft.parse(ok(await v.post(`/share/${token}/draft`, contact()), 201));
    expect(draft).toMatchObject({ form: 'QUARTERLY_TAX', title: 'Quarterly Check-In (shared)' });
    // It goes on as any draft of its kind, through the same cookie.
    expect(BeginDraft.parse(ok(await v.get('/quarterly-tax/draft'))).version).toBe(draft.version);
    IntakeAgreementBlock.parse(ok(await v.get('/quarterly-tax/draft/agreements')));
    const lead = await inFirmA((tx) =>
      tx.lead.findFirstOrThrow({
        where: { businessId: firms.a.id, email: draft.contact.email },
        include: { intakes: { include: { form: { select: { templateId: true } } } } },
      }),
    );
    expect([lead.status, lead.source, lead.serviceId]).toEqual([
      'DRAFT',
      'WEBSITE_FORM',
      ids.service,
    ]);
    expect(lead.intakes[0]!.form.templateId).toBe(ids.shared);
    const started = await inFirmA((tx) =>
      tx.auditLog.findFirstOrThrow({
        where: { entityId: lead.id, action: 'begin_online.draft_started' },
      }),
    );
    expect(started.metadata).toMatchObject({ templateId: ids.shared });
  });

  it('refuses a honeypot, a made-up link, another firm, and a link turned off at once', async () => {
    const on = share(await firmCall('get', `/${ids.shared}/share`, people.ownerA));
    const token = tokenOf(on.link!.url);
    const v = visitor(firms.a.slug);
    expectError(
      await v.post(`/share/${token}/draft`, contact({ website: 'https://spam.example' })),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await v.get(`/share/${randomBytes(32).toString('base64url')}`),
      410,
      'LINK_INVALID',
    );
    expectError(await v.get('/share/short'), 400, 'VALIDATION_FAILED');
    expectError(await visitor(firms.b.slug).get(`/share/${token}`), 410, 'LINK_INVALID');
    ok(
      await firmCall('put', `/${ids.shared}/share`, people.ownerA, {
        sharing: false,
        portalPublished: true,
      }),
    );
    expectError(await v.get(`/share/${token}`), 410, 'LINK_INVALID');
    expectError(await v.post(`/share/${token}/draft`, contact()), 410, 'LINK_INVALID');
    // On again: the same link works again.
    ok(
      await firmCall('put', `/${ids.shared}/share`, people.ownerA, {
        sharing: true,
        portalPublished: true,
      }),
    );
    BeginOnlineForm.parse(ok(await v.get(`/share/${token}`)));
  });

  it('takes at most its hourly cap of starts', async () => {
    const on = share(await firmCall('get', `/${ids.shared}/share`, people.ownerA));
    const token = tokenOf(on.link!.url);
    // The hour's starts so far, as the start's audit rows record them (another network each).
    await inFirmA((tx) =>
      tx.auditLog.createMany({
        data: Array.from({ length: SHARE_STARTS_PER_HOUR }, (_, n) => ({
          businessId: firms.a.id,
          action: 'begin_online.draft_started',
          entityType: 'lead',
          entityId: randomUUID(),
          metadata: { templateId: ids.shared, net: `10.${n}.0.0/24` },
        })),
      }),
    );
    const res = await visitor(firms.a.slug).post(`/share/${token}/draft`, contact());
    expectError(res, 429, 'RATE_LIMITED');
  });
});
