// End-to-end: client sign-up on a firm's portal (R3 steps 2-3) in AUTH_MODE=local, where every
// code is 000000. The ClientCodeSender is replaced by an outbox. Contract: docs/api/client-auth.yaml.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { portalCookies, SignUpState } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { CLIENT_CODE_SENDER } from '../../src/client-auth/client-code-sender.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
let app: INestApplication;
const slug = `r3-signup-${randomUUID().slice(0, 8)}`;
let firmId = '';
const docIds: string[] = [];
type Sent = { kind: 'email' | 'sms' | 'registered'; to: string; code?: string };
const outbox: Sent[] = [];
/** The portal's own origin: the browser sends it on every POST (cross-site check). */
let portalOrigin = '';

let lastViewer = 0;
const newViewer = () => `198.18.0.${++lastViewer}`;
const base = (s = slug) => `/api/v1/portal/${s}/auth/sign-up`;
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const emailFor = (name: string) => `r3-${name}-${randomUUID().slice(0, 6)}@example.com`;

/** A browser on the sign-up pages: one viewer, one cookie jar, the portal's origin. */
function visitor(firmSlug = slug) {
  const viewer = newViewer();
  let cookie = '';
  const keep = (res: Response) => {
    const raw = res.headers['set-cookie'] as unknown;
    const set = (Array.isArray(raw) ? (raw as string[]) : []).find((c) =>
      c.startsWith(`${portalCookies(firmSlug).signUp}=`),
    );
    if (set) cookie = set.split(';')[0] ?? '';
    return res;
  };
  const send = (method: 'get' | 'post', path: string, body?: object) => {
    let req = request(app.getHttpServer())
      [method](`${base(firmSlug)}${path}`)
      .set('x-forwarded-for', `${viewer}, 10.0.0.5`)
      .set('cookie', cookie);
    if (method === 'post') req = req.set('origin', portalOrigin);
    return (body ? req.send(body) : req).then(keep);
  };
  return {
    signUp: (body: object) => send('post', '', body),
    state: () => send('get', ''),
    post: (path: string, body: object) => send('post', path, body),
    get cookie() {
      return cookie;
    },
    set cookie(value: string) {
      cookie = value;
    },
  };
}

const form = (email: string, fields: Record<string, unknown> = {}) => ({
  name: 'Jane Client',
  email,
  phone: '+1 (770) 555-0199',
  password: 'Client-password-1',
  accountType: 'INDIVIDUAL',
  accepted: { termsVersion: 1, privacyVersion: 1 },
  ...fields,
});

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

beforeAll(async () => {
  firmId = (
    await asOwner({ kind: 'platform' }, (tx) =>
      tx.business.create({ data: { slug, name: 'R3 Sign-up Firm', status: 'ACTIVE' } }),
    )
  ).id;
  await asOwner({ kind: 'business', businessId: firmId }, async (tx) => {
    for (const kind of ['TERMS', 'PRIVACY'] as const) {
      const doc = await tx.firmLegalDocument.create({
        data: {
          businessId: firmId,
          kind,
          version: 1,
          body: `# ${kind}`,
          publishedByUserId: fx.users.ownerA.id,
        },
      });
      docIds.push(doc.id);
    }
  });

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  portalOrigin = new URL(env.PORTAL_BASE_URL).origin;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(CLIENT_CODE_SENDER)
    .useValue({
      emailCode: (m: { to: string; code: string }) => {
        outbox.push({ kind: 'email', to: m.to, code: m.code });
        return Promise.resolve();
      },
      smsCode: (m: { to: string; code: string }) => {
        outbox.push({ kind: 'sms', to: m.to, code: m.code });
        return Promise.resolve();
      },
      alreadyRegistered: (m: { to: string }) => {
        outbox.push({ kind: 'registered', to: m.to });
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

const sentTo = (to: string) => outbox.filter((m) => m.to === to).map((m) => m.kind);

describe('client sign-up', () => {
  it('signs up, verifies the email then the phone, and waits for the firm', async () => {
    const email = emailFor('happy');
    const v = visitor();
    const res = await v
      .signUp(form(email.toUpperCase(), { accountType: 'BUSINESS' }))
      .then((r) => r);
    expect(res.status).toBe(200);
    expect(SignUpState.parse(res.body)).toMatchObject({
      step: 'VERIFY_EMAIL',
      email,
      phoneMasked: '(770) ***-0199',
    });
    const raw = (res.headers['set-cookie'] as unknown as string[]).join('\n');
    expect(raw).toMatch(
      new RegExp(
        `^${portalCookies(slug).signUp}=.*; Path=/api/v1/portal/${slug}/auth/sign-up;.*HttpOnly.*SameSite=Strict`,
        'm',
      ),
    );
    expect(outbox.filter((m) => m.to === email)).toEqual([
      { kind: 'email', to: email, code: '000000' },
    ]);

    expect((await v.state()).body).toMatchObject({ step: 'VERIFY_EMAIL' });
    expect(codeOf(await v.post('/verify-phone', { code: '000000' }))).toBe('WRONG_STEP');
    expect(codeOf(await v.post('/verify-email', { code: '111111' }))).toBe('CODE_INVALID');
    expect((await v.post('/verify-email', { code: '000 000' })).body).toMatchObject({
      step: 'VERIFY_PHONE',
    });
    expect(outbox.at(-1)).toEqual({ kind: 'sms', to: '+17705550199', code: '000000' });
    expect(codeOf(await v.post('/resend', { channel: 'phone' }))).toBe('RATE_LIMITED');
    expect(codeOf(await v.post('/change-email', { email: emailFor('late') }))).toBe(
      'ALREADY_VERIFIED',
    );
    expect((await v.post('/verify-phone', { code: '000000' })).body).toMatchObject({
      step: 'DONE',
      resendAvailableAt: null,
    });

    const account = await asOwner({ kind: 'business', businessId: firmId }, (tx) =>
      tx.clientAccount.findFirstOrThrow({
        where: { email },
        include: { user: true },
      }),
    );
    expect(account).toMatchObject({ status: 'PENDING_APPROVAL', accountType: 'BUSINESS' });
    expect(account.emailVerifiedAt).not.toBeNull();
    expect(account.phoneVerifiedAt).not.toBeNull();
    expect(account.user).toMatchObject({
      pool: 'CLIENT',
      name: 'Jane Client',
      phone: '+17705550199',
    });
    const [acceptances, audits] = await asOwner({ kind: 'business', businessId: firmId }, (tx) =>
      Promise.all([
        tx.legalAcceptance.findMany({ where: { clientAccountId: account.id } }),
        tx.auditLog.findMany({ where: { entityId: account.id }, orderBy: { createdAt: 'asc' } }),
      ]),
    );
    expect(acceptances.map((a) => a.legalDocumentId).sort()).toEqual([...docIds].sort());
    expect(audits.map((a) => [a.action, a.businessId, a.actorUserId])).toEqual([
      ['client_account.signed_up', firmId, account.userId],
      ['client_account.verified', firmId, account.userId],
    ]);
  });

  it('answers an email that already has an account here exactly like a new one', async () => {
    const email = emailFor('taken');
    const first = visitor();
    await first.signUp(form(email));
    await first.post('/verify-email', { code: '000000' });

    const fresh = await visitor().signUp(form(emailFor('fresh')));
    const v = visitor();
    const again = await v.signUp(form(email, { name: 'Someone Else' }));
    expect(again.status).toBe(fresh.status);
    expect(Object.keys(again.body as object).sort()).toEqual(
      Object.keys(fresh.body as object).sort(),
    );
    expect(again.body).toMatchObject({ step: 'VERIFY_EMAIL', email });
    expect(sentTo(email)).toEqual(['email', 'registered']);
    // The session goes nowhere: no code ever matches.
    expect(codeOf(await v.post('/verify-email', { code: '000000' }))).toBe('CODE_INVALID');
    const count = await asOwner({ kind: 'business', businessId: firmId }, (tx) =>
      tx.clientAccount.count({ where: { email } }),
    );
    expect(count).toBe(1);
  });

  it('starts an unverified sign-up again with the new details', async () => {
    const email = emailFor('again');
    await visitor().signUp(form(email, { name: 'First Try' }));
    const v = visitor();
    const res = await v.signUp(form(email, { name: 'Second Try', phone: '+14045550100' }));
    expect(res.body).toMatchObject({ step: 'VERIFY_EMAIL', phoneMasked: '(404) ***-0100' });
    const accounts = await asOwner({ kind: 'business', businessId: firmId }, (tx) =>
      tx.clientAccount.findMany({ where: { email }, include: { user: true } }),
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.user).toMatchObject({ name: 'Second Try', phone: '+14045550100' });
    expect((await v.post('/verify-email', { code: '000000' })).body).toMatchObject({
      step: 'VERIFY_PHONE',
    });
  });

  it('stops a code after 5 wrong tries', async () => {
    const v = visitor();
    await v.signUp(form(emailFor('guess')));
    for (let i = 0; i < 5; i += 1) {
      expect(codeOf(await v.post('/verify-email', { code: '111111' }))).toBe('CODE_INVALID');
    }
    expect(codeOf(await v.post('/verify-email', { code: '000000' }))).toBe('CODE_INVALID');
  });

  it('sends the code to a changed email', async () => {
    const v = visitor();
    await v.signUp(form(emailFor('typo')));
    const fixed = emailFor('fixed');
    expect((await v.post('/change-email', { email: fixed })).body).toMatchObject({
      step: 'VERIFY_EMAIL',
      email: fixed,
    });
    expect(sentTo(fixed)).toEqual(['email']);
    expect((await v.post('/verify-email', { code: '000000' })).body).toMatchObject({
      step: 'VERIFY_PHONE',
      email: fixed,
    });
  });

  it('refuses outdated terms, a closed or unknown firm, and a weak password', async () => {
    const v = visitor();
    const outdated = await v.signUp(
      form(emailFor('old'), { accepted: { termsVersion: 2, privacyVersion: 1 } }),
    );
    expect([outdated.status, codeOf(outdated)]).toEqual([409, 'TERMS_OUTDATED']);
    const closed = await visitor(fx.firmB.slug).signUp(form(emailFor('closed')));
    expect([closed.status, codeOf(closed)]).toEqual([403, 'SIGN_UP_CLOSED']);
    expect((await visitor('no-such-firm').signUp(form(emailFor('none')))).status).toBe(404);
    const weak = await v.signUp(form(emailFor('weak'), { password: 'weak' }));
    expect([weak.status, codeOf(weak)]).toEqual([400, 'VALIDATION_FAILED']);
  });

  it("needs this firm's own sign-up cookie", async () => {
    expect(codeOf(await visitor().state())).toBe('SIGN_UP_EXPIRED');
    const v = visitor();
    await v.signUp(form(emailFor('cookie')));
    const sealed = v.cookie.split('=').slice(1).join('=');
    const other = visitor(fx.firmA.slug);
    other.cookie = `${portalCookies(fx.firmA.slug).signUp}=${sealed}`;
    expect(codeOf(await other.state())).toBe('SIGN_UP_EXPIRED');
    v.cookie = `${portalCookies(slug).signUp}=${sealed.slice(0, -4)}AAAA`;
    expect(codeOf(await v.state())).toBe('SIGN_UP_EXPIRED');
  });
});
