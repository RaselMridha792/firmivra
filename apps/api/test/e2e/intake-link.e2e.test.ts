// A lead's secure intake link (R55, Intake Forms Review Two ACCESS-01; contract:
// packages/types/src/intake/link.ts). The firm sends a lead a form by email (POST
// /business/intakes/send); the email holds `{PORTAL_BASE_URL}/{slug}/form#token=...` and the intake
// keeps only the token's SHA-256. The lead opens it for a sealed HttpOnly cookie, then reads, saves
// and signs the one form, signed out. These tests are the link's isolation walls too
// (test/isolation/cases/intake-link.ts): another firm's slug, a made-up, replaced or expired token
// and a missing or other firm's cookie are each 410 LINK_INVALID. Synthetic data only.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  INTAKE_FORMS,
  IntakeAgreementBlock,
  intakeStepFields,
  LinkIntake,
  SavedIntakeStep,
  SendIntakeFormResult,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';
import { firmWideVersion, publishFirmWideAgreement, signatureFor } from '../intake-signing.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const outbox: NotifyMessage[] = [];
const owners = {
  a: { id: randomUUID(), email: `r55-il-owner-a-${run}@r55.test` },
  b: { id: randomUUID(), email: `r55-il-owner-b-${run}@r55.test` },
};
const firms = {} as Record<'a' | 'b', { id: string; slug: string }>;
const ids = {} as Record<string, string>;
let app: INestApplication;
let portalOrigin = '';
let portalBase = '';
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.66.${100 + Math.floor(++viewers / 250)}.${viewers % 250}`;
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

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

/** Firm A's owner on the firm's API. */
async function firmCall(method: 'post' | 'patch', path: string, body?: object) {
  // The token first: a request built before it would lose its server to the token's request.
  const token = await tokenFor(owners.a.email);
  const req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', firms.a.id)
    .set('x-forwarded-for', `${viewer()}, 10.0.0.5`)
    .set('authorization', `Bearer ${token}`);
  return body ? req.send(body) : req;
}

/** A browser on one firm's link page: its own IP, its cookie jar and the portal's origin. */
function visitor(slug: string) {
  const ip = viewer();
  const jar = new Map<string, string>();
  const keep = (res: Response) => {
    const raw = res.headers['set-cookie'] as unknown;
    for (const c of Array.isArray(raw) ? (raw as string[]) : []) {
      const [pair] = c.split(';');
      const at = pair!.indexOf('=');
      const name = pair!.slice(0, at);
      if (!name.startsWith('fv_il_')) continue;
      jar.set(name, pair!.slice(at + 1));
    }
    return res;
  };
  const send = (method: 'get' | 'post' | 'put', path: string, body?: object) => {
    let req = request(app.getHttpServer())
      [method](`/api/v1/portal/${slug}/intake-link${path}`)
      .set('x-forwarded-for', `${ip}, 10.0.0.5`)
      .set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
    if (method !== 'get') req = req.set('origin', portalOrigin);
    return (body ? req.send(body) : req).then(keep);
  };
  return {
    jar,
    get: (path = '') => send('get', path),
    post: (path: string, body: object) => send('post', path, body),
    put: (path: string, body: object) => send('put', path, body),
  };
}

/** A complete Tax Planning form (no upload fields), for one person. */
const complete: Record<string, unknown> = {
  fullName: 'Lee Lead',
  phone: '(404) 555-0123',
  email: `lee.${run}@lead.test`,
  planningFor: 'INDIVIDUAL',
  businessStructure: 'SOLE_PROPRIETORSHIP',
  industry: 'CONSTRUCTION',
  operatingStates: ['GA'],
  accountingMethod: 'CASH',
  planningTaxYear: 2026,
  hasBookkeeper: 'NO',
  services: ['INDIVIDUAL'],
  reasons: ['REDUCE_LIABILITY'],
  multipleStates: false,
  filedRecentReturn: 'YES',
  taxIssues: false,
  taxProfessional: 'NO',
};
const FORM = INTAKE_FORMS.TAX_PLANNING!;
const stepAnswers = (key: string) => {
  const keys = new Set(intakeStepFields(FORM.steps.find((s) => s.key === key)!).map((f) => f.key));
  return Object.fromEntries(Object.entries(complete).filter(([k]) => keys.has(k)));
};

/** Sends firm A's Tax Planning form to a lead by email: the intake and the emailed token. */
async function sendTo(leadKey: string) {
  const res = await firmCall('post', '/intakes/send', {
    idempotencyKey: randomUUID(),
    recipient: { kind: 'LEAD', id: ids[leadKey] },
    formId: ids.template,
    channel: 'EMAIL',
    subject: 'Your tax planning form',
    message: 'Please fill this in.',
  });
  const sent = SendIntakeFormResult.parse(ok(res));
  const mail = outbox.filter((m) => m.template === 'intake.lead-link').at(-1)!;
  const link = (mail.data as { link: string }).link;
  const token = /#token=([A-Za-z0-9_-]{43})$/.exec(link)?.[1];
  if (!token) throw new Error('no token in the link');
  return { id: sent.form.id, sent, mail, link, token };
}

beforeAll(async () => {
  process.env['KMS_MODE'] ??= 'local';
  process.env['LOCAL_KMS_KEY'] ??= randomBytes(32).toString('base64');
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const key of ['a', 'b'] as const) {
      const o = owners[key];
      await tx.user.create({
        data: { id: o.id, cognitoSub: o.id, pool: 'STAFF', email: o.email, name: `Fake ${key}` },
      });
      firms[key] = await tx.business.create({
        data: { slug: `r55-il-${key}-${run}`, name: `R55 Link ${key}`, status: 'ACTIVE' },
        select: { id: true, slug: true },
      });
    }
  });
  for (const key of ['a', 'b'] as const) {
    await asOwner({ kind: 'business', businessId: firms[key].id }, (tx) =>
      tx.membership.create({
        data: {
          businessId: firms[key].id,
          userId: owners[key].id,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      }),
    );
  }
  await inFirmA(async (tx) => {
    const businessId = firms.a.id;
    const service = await tx.service.create({
      data: { businessId, kind: 'TAX_PLANNING', name: `Tax Planning ${run}`, status: 'ACTIVE' },
      select: { id: true },
    });
    const form = await tx.intakeForm.create({
      data: {
        businessId,
        serviceId: service.id,
        version: 1,
        title: 'Tax Planning Intake',
        definition: FORM as object,
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
      select: { templateId: true },
    });
    ids.template = form.templateId as string;
    for (const key of ['fill', 'sign', 'refuse', 'resend', 'expire']) {
      ids[key] = (
        await tx.lead.create({
          data: {
            businessId,
            serviceId: service.id,
            status: 'CONTACTED',
            submittedAt: new Date(),
            firstName: 'Lee',
            lastName: `Lead ${key} (fake)`,
            email: `lee-${key}-${run}@lead.test`,
          },
          select: { id: true },
        })
      ).id;
    }
    await publishFirmWideAgreement(tx, businessId, owners.a.id);
  });
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

describe("a lead's secure intake link", () => {
  it('emails the lead a link to the form and keeps only its hash', async () => {
    const { id, sent, mail, link, token } = await sendTo('fill');
    expect(sent.delivery).toMatchObject({ channel: 'EMAIL', status: 'SENT', to: 'l***@lead.test' });
    expect(sent.form.recipient).toMatchObject({ kind: 'LEAD', id: ids.fill });
    expect(mail).toMatchObject({ to: `lee-fill-${run}@lead.test`, businessId: firms.a.id });
    expect(mail.data).toMatchObject({
      formTitle: 'Tax Planning Intake',
      subject: 'Your tax planning form',
      message: 'Please fill this in.',
    });
    expect(link).toBe(`${portalBase}/${firms.a.slug}/form#token=${token}`);
    const intake = await inFirmA((tx) => tx.intake.findUniqueOrThrow({ where: { id } }));
    expect(intake).toMatchObject({
      leadId: ids.fill,
      engagementId: null,
      status: 'SENT',
      deliveryChannel: 'EMAIL',
      accessTokenHash: sha256(token),
    });
    // The link lasts as long as the form (the firm's default expiration).
    expect(intake.accessTokenExpiresAt).toEqual(intake.expiresAt);
    const audit = await inFirmA((tx) => tx.auditLog.findMany({ where: { entityId: id } }));
    expect(audit.map((a) => a.action)).toContain('intake.sent');
    expect(JSON.stringify(audit)).not.toContain(token);
  });

  it('opens with its token for a cookie, then reads, saves and signs the form', async () => {
    const { id, token } = await sendTo('sign');
    const v = visitor(firms.a.slug);
    const opened = await v.post('/open', { token });
    const form = LinkIntake.parse(ok(opened));
    expect(form).toMatchObject({ id, firstName: 'Lee', status: 'SENT', canEdit: true });
    const cookie = String((opened.headers['set-cookie'] as unknown as string[])[0]);
    expect(cookie).toMatch(new RegExp(`^fv_il_${firms.a.slug}=`));
    expect(cookie).toContain(`Path=/api/v1/portal/${firms.a.slug}/intake-link`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).not.toContain(token);

    expect(LinkIntake.parse(ok(await v.get())).id).toBe(id);
    const block = IntakeAgreementBlock.parse(ok(await v.get('/agreements')));
    expect(block).toMatchObject({ ready: true, legal: null });

    for (const step of ['profile', 'finances', 'goals']) {
      SavedIntakeStep.parse(ok(await v.put(`/steps/${step}`, { answers: stepAnswers(step) })));
    }
    expect(LinkIntake.parse(ok(await v.get())).status).toBe('IN_PROGRESS');
    expectError(
      await v.put('/steps/profile', { answers: { email: 'not an email' } }),
      400,
      'VALIDATION_FAILED',
    );

    const signature = signatureFor(
      await inFirmA((tx) => firmWideVersion(tx, firms.a.id)),
      'Lee Lead',
    );
    const done = LinkIntake.parse(ok(await v.post('/submit', { answers: {}, signature })));
    expect(done).toMatchObject({ status: 'SUBMITTED', canEdit: false });
    expect(done.signature?.printedName).toBe('Lee Lead');
    const stored = await inFirmA((tx) =>
      tx.intake.findUniqueOrThrow({
        where: { id },
        include: { submissions: true, signatures: true },
      }),
    );
    expect(stored.submissions[0]?.submittedAt).not.toBeNull();
    expect(stored.signatures.map((s) => s.leadId)).toEqual([ids.sign]);
    // Sent: it reads back, and changes are refused.
    expect(LinkIntake.parse(ok(await v.get())).status).toBe('SUBMITTED');
    expectError(
      await v.put('/steps/profile', { answers: stepAnswers('profile') }),
      409,
      'INTAKE_LOCKED',
    );
    const actions = (
      await inFirmA((tx) =>
        tx.auditLog.findMany({ where: { entityId: id }, select: { action: true } }),
      )
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(['intake.link_opened', 'intake.step_saved', 'intake.submitted']),
    );
  });

  it('refuses another firm, a made-up token and a missing or moved cookie (410 LINK_INVALID)', async () => {
    const { token } = await sendTo('refuse');
    expectError(await visitor(firms.b.slug).post('/open', { token }), 410, 'LINK_INVALID');
    const madeUp = randomBytes(32).toString('base64url');
    expectError(await visitor(firms.a.slug).post('/open', { token: madeUp }), 410, 'LINK_INVALID');
    expectError(
      await visitor(firms.a.slug).post('/open', { token: 'short' }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(await visitor(firms.a.slug).get(), 410, 'LINK_INVALID');
    expectError(await visitor(firms.a.slug).get('/agreements'), 410, 'LINK_INVALID');

    // Firm A's cookie, under firm B's name, opens nothing at firm B.
    const a = visitor(firms.a.slug);
    ok(await a.post('/open', { token }));
    const value = a.jar.get(`fv_il_${firms.a.slug}`)!;
    const b = visitor(firms.b.slug);
    b.jar.set(`fv_il_${firms.b.slug}`, value);
    expectError(await b.get(), 410, 'LINK_INVALID');
    expectError(await b.put('/steps/profile', { answers: {} }), 410, 'LINK_INVALID');
  });

  it('a resend emails a new link that replaces the older one and its cookies', async () => {
    const { id, token } = await sendTo('resend');
    const old = visitor(firms.a.slug);
    ok(await old.post('/open', { token }));
    ok(await firmCall('post', `/intakes/${id}/resend`));
    const mail = outbox.filter((m) => m.template === 'intake.lead-link').at(-1)!;
    expect(mail.to).toBe(`lee-resend-${run}@lead.test`);
    const fresh = /#token=([A-Za-z0-9_-]{43})$/.exec((mail.data as { link: string }).link)?.[1];
    expect(fresh).toBeDefined();
    expect(fresh).not.toBe(token);
    expectError(await old.get(), 410, 'LINK_INVALID');
    expectError(await visitor(firms.a.slug).post('/open', { token }), 410, 'LINK_INVALID');
    const opened = LinkIntake.parse(
      ok(await visitor(firms.a.slug).post('/open', { token: fresh! })),
    );
    expect(opened.id).toBe(id);
  });

  it('an expired link opens nothing', async () => {
    const { id, token } = await sendTo('expire');
    const v = visitor(firms.a.slug);
    ok(await v.post('/open', { token }));
    await inFirmA(
      (tx) =>
        tx.$executeRaw`UPDATE intakes SET access_token_expires_at = now() - interval '1 minute'
                       WHERE id = ${id}::uuid`,
    );
    expectError(await v.get(), 410, 'LINK_INVALID');
    expectError(await visitor(firms.a.slug).post('/open', { token }), 410, 'LINK_INVALID');
  });
});
