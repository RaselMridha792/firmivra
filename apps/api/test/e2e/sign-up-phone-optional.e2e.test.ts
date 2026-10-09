// End-to-end: the SMS fallback (Rasel, Oct 8). With SIGNUP_PHONE_VERIFICATION=optional (the
// default until SNS SMS registration is approved) a portal sign-up completes once its email is
// verified: no SMS is sent, the phone number is saved unverified, and the firm sees the sign-up
// in its queue and can approve it. sign-up.e2e covers SIGNUP_PHONE_VERIFICATION=required.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { portalCookies, SignUpState } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { portalClient } from '../../src/auth/portal-clients.js';
import { CLIENT_CODE_SENDER } from '../../src/client-auth/client-code-sender.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
let app: INestApplication;
const slug = `r6-sms-off-${randomUUID().slice(0, 8)}`;
let firmId = '';
// The firm's own owner, so the shared fixtures' owners keep exactly their memberships.
const ownerId = randomUUID();
const ownerEmail = `owner-${slug}@example.test`;
const docIds: string[] = [];
const outbox: { kind: 'email' | 'sms' | 'registered'; to: string }[] = [];
let portalOrigin = '';
let lastViewer = 0;
const newViewer = () => `198.19.${++lastViewer}.1`;
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;

function visitor(viewer = newViewer()) {
  let cookie = '';
  const send = (method: 'get' | 'post', path: string, body?: object) => {
    let req = request(app.getHttpServer())
      [method](`/api/v1/portal/${slug}/auth/sign-up${path}`)
      .set('x-forwarded-for', `${viewer}, 10.0.0.5`)
      .set('cookie', cookie);
    if (method === 'post') req = req.set('origin', portalOrigin);
    return (body ? req.send(body) : req).then((res) => {
      const raw = res.headers['set-cookie'] as unknown;
      const set = (Array.isArray(raw) ? (raw as string[]) : []).find((c) =>
        c.startsWith(`${portalCookies(slug).signUp}=`),
      );
      if (set) cookie = set.split(';')[0] ?? '';
      return res;
    });
  };
  return {
    signUp: (body: object) => send('post', '', body),
    state: () => send('get', ''),
    post: (path: string, body: object) => send('post', path, body),
  };
}

async function asOwner<T>(
  scope: Parameters<typeof runInScope>[1],
  work: Parameters<typeof runInScope<T>>[2],
) {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, scope, work);
  } finally {
    await owner.$disconnect();
  }
}

async function firmCall(method: 'get' | 'post', path: string, body?: object) {
  const { token } = (
    await request(app.getHttpServer())
      .post('/api/v1/dev/token')
      .send({ email: ownerEmail })
      .expect(200)
  ).body as { token: string };
  const req = request(app.getHttpServer())
    [method](`/api/v1/client-sign-ups${path}`)
    .set('authorization', `Bearer ${token}`)
    .set('x-business-id', firmId)
    .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`);
  return body ? req.send(body) : req;
}

beforeAll(async () => {
  firmId = (
    await asOwner({ kind: 'platform' }, async (tx) => {
      await tx.user.create({
        data: {
          id: ownerId,
          cognitoSub: ownerId,
          pool: 'STAFF',
          email: ownerEmail,
          name: 'Fake owner',
        },
      });
      return tx.business.create({
        data: { slug, name: 'R6 SMS Fallback Firm', status: 'ACTIVE' },
      });
    })
  ).id;
  await asOwner({ kind: 'business', businessId: firmId }, async (tx) => {
    await tx.membership.create({
      data: { businessId: firmId, userId: ownerId, role: 'OWNER', status: 'ACTIVE' },
    });
    for (const kind of ['TERMS', 'PRIVACY'] as const) {
      const doc = await tx.firmLegalDocument.create({
        data: {
          businessId: firmId,
          kind,
          version: 1,
          body: `# ${kind}`,
          publishedByUserId: ownerId,
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
    SIGNUP_PHONE_VERIFICATION: 'optional',
  });
  portalOrigin = new URL(env.PORTAL_BASE_URL).origin;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(CLIENT_CODE_SENDER)
    .useValue({
      emailCode: (m: { to: string }) => (
        outbox.push({ kind: 'email', to: m.to }),
        Promise.resolve()
      ),
      smsCode: (m: { to: string }) => (outbox.push({ kind: 'sms', to: m.to }), Promise.resolve()),
      alreadyRegistered: (m: { to: string }) => (
        outbox.push({ kind: 'registered', to: m.to }),
        Promise.resolve()
      ),
      signUpApproved: () => Promise.resolve(),
      signUpDeclined: () => Promise.resolve(),
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

describe('SIGNUP_PHONE_VERIFICATION', () => {
  it('defaults to optional; required is the only other choice', () => {
    const base = { ...process.env, NODE_ENV: 'test', AUTH_MODE: 'local' } as const;
    expect(
      loadEnv({ ...base, SIGNUP_PHONE_VERIFICATION: undefined }).SIGNUP_PHONE_VERIFICATION,
    ).toBe('optional');
    expect(
      loadEnv({ ...base, SIGNUP_PHONE_VERIFICATION: 'required' }).SIGNUP_PHONE_VERIFICATION,
    ).toBe('required');
    expect(() => loadEnv({ ...base, SIGNUP_PHONE_VERIFICATION: 'off' })).toThrow();
  });
});

describe('sign-up with the phone code optional (SMS fallback)', () => {
  it('completes once the email is verified: no SMS, phone saved unverified, the firm can approve', async () => {
    const email = `r6-fallback-${randomUUID().slice(0, 6)}@example.test`;
    const v = visitor();
    const res = await v.signUp({
      name: 'Jane Fallback',
      email,
      phone: '+17705550142',
      password: 'Client-password-1',
      accountType: 'INDIVIDUAL',
      accepted: { termsVersion: 1, privacyVersion: 1 },
    });
    expect(SignUpState.parse(res.body)).toMatchObject({ step: 'VERIFY_EMAIL' });
    expect(codeOf(await v.post('/verify-email', { code: '111111' }))).toBe('CODE_INVALID');
    expect((await v.post('/verify-email', { code: '000000' })).body).toMatchObject({
      step: 'DONE',
      resendAvailableAt: null,
    });
    expect((await v.state()).body).toMatchObject({ step: 'DONE' });
    expect(codeOf(await v.post('/verify-phone', { code: '000000' }))).toBe('WRONG_STEP');
    // A completed sign-up's phone is fixed: no rewrite of users.phone or Cognito, no SMS.
    const changed = await v.post('/change-phone', { phone: '+17705550199' });
    expect(changed.status).toBe(409);
    expect(codeOf(changed)).toBe('ALREADY_VERIFIED');
    // Email verification stays required; no SMS goes out.
    expect(outbox.filter((m) => m.kind === 'sms')).toEqual([]);
    expect(outbox.filter((m) => m.to === email)).toEqual([{ kind: 'email', to: email }]);

    const account = await asOwner({ kind: 'business', businessId: firmId }, (tx) =>
      tx.clientAccount.findFirstOrThrow({ where: { email }, include: { user: true } }),
    );
    expect(account.status).toBe('PENDING_APPROVAL');
    expect(account.emailVerifiedAt).not.toBeNull();
    expect(account.phoneVerifiedAt).toBeNull();
    expect(account.user.phone).toBe('+17705550142');
    const [acceptances, audits] = await asOwner({ kind: 'business', businessId: firmId }, (tx) =>
      Promise.all([
        tx.legalAcceptance.findMany({ where: { clientAccountId: account.id } }),
        tx.auditLog.findMany({ where: { entityId: account.id }, orderBy: { createdAt: 'asc' } }),
      ]),
    );
    expect(acceptances.map((a) => a.legalDocumentId).sort()).toEqual([...docIds].sort());
    expect(audits.map((a) => a.action)).toEqual([
      'client_account.signed_up',
      'client_account.email_verified',
      'client_account.verified',
    ]);
    expect(audits[2]?.metadata).toEqual({ phoneVerified: false });

    // Complete, whatever the setting is later: may sign in (to the waiting page) ...
    const db = createDatabase(fx.appUrl, TEST_CLIENT_OPTIONS);
    try {
      expect(await portalClient(db, firmId, { email })).toMatchObject({
        clientAccountId: account.id,
        status: 'PENDING_APPROVAL',
      });
    } finally {
      await db.disconnect();
    }
    // ... and waits in the firm's queue, which can approve it.
    const queue = await firmCall('get', '?status=PENDING_APPROVAL');
    expect(queue.status, JSON.stringify(queue.body)).toBe(200);
    expect(
      (queue.body as { items: { clientAccountId: string }[] }).items.map((i) => i.clientAccountId),
    ).toContain(account.id);
    const approved = await firmCall('post', `/${account.id}/approve`, {});
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body).toMatchObject({ clientAccountId: account.id, status: 'ACTIVE' });
  });

  it('an unverified email is still not a sign-up: not in the queue, cannot sign in', async () => {
    const email = `r6-halfway-${randomUUID().slice(0, 6)}@example.test`;
    await visitor().signUp({
      name: 'Half Way',
      email,
      phone: '+17705550143',
      password: 'Client-password-1',
      accountType: 'INDIVIDUAL',
      accepted: { termsVersion: 1, privacyVersion: 1 },
    });
    const account = await asOwner({ kind: 'business', businessId: firmId }, (tx) =>
      tx.clientAccount.findFirstOrThrow({ where: { email } }),
    );
    const queue = await firmCall('get', '?status=PENDING_APPROVAL');
    expect(
      (queue.body as { items: { clientAccountId: string }[] }).items.map((i) => i.clientAccountId),
    ).not.toContain(account.id);
    expect(codeOf(await firmCall('post', `/${account.id}/approve`, {}))).toBe('NOT_FOUND');
    const db = createDatabase(fx.appUrl, TEST_CLIENT_OPTIONS);
    try {
      expect(await portalClient(db, firmId, { email })).toBeUndefined();
    } finally {
      await db.disconnect();
    }
  });

  it('answers an email whose sign-up completed at the email step exactly like a new one', async () => {
    const tag = randomUUID().slice(0, 6);
    const form = (email: string) => ({
      name: 'Same Answer',
      email,
      phone: '+17705550144',
      password: 'Client-password-1',
      accountType: 'INDIVIDUAL',
      accepted: { termsVersion: 1, privacyVersion: 1 },
    });
    // A sign-up completed without the phone code (legal acceptances written, phone unverified).
    const takenEmail = `r6-taken-${tag}@example.test`;
    const first = visitor();
    await first.signUp(form(takenEmail));
    expect((await first.post('/verify-email', { code: '000000' })).body).toMatchObject({
      step: 'DONE',
    });
    const before = await asOwner({ kind: 'business', businessId: firmId }, (tx) =>
      tx.clientAccount.findFirstOrThrow({ where: { email: takenEmail } }),
    );
    const freshEmail = `r6-fresh-${tag}@example.test`;
    // Same length, so the cookies can be compared to the character.
    expect(freshEmail.length).toBe(takenEmail.length);

    const taken = visitor();
    const fresh = visitor();
    const strip = (r: Response) => {
      const body = r.body as { email?: string; resendAvailableAt?: string | null; error?: object };
      return {
        status: r.status,
        body: {
          ...body,
          email: undefined,
          resendAvailableAt: body.resendAvailableAt === null,
          error: body.error ? { ...body.error, requestId: undefined } : undefined,
        },
        cookie: ((r.headers['set-cookie'] as unknown as string[] | undefined) ?? [])
          .map((c) => c.split(';')[0]?.length)
          .join(','),
      };
    };
    const pair = async (call: (v: ReturnType<typeof visitor>) => Promise<Response>) => {
      const [a, b] = [await call(taken), await call(fresh)];
      expect(strip(a)).toEqual(strip(b));
      return a;
    };
    expect(
      (await pair((v) => v.signUp(form(v === taken ? takenEmail : freshEmail)))).body,
    ).toMatchObject({ step: 'VERIFY_EMAIL' });
    expect((await pair((v) => v.state())).body).toMatchObject({ step: 'VERIFY_EMAIL' });
    expect(codeOf(await pair((v) => v.post('/verify-email', { code: '111111' })))).toBe(
      'CODE_INVALID',
    );
    expect(codeOf(await pair((v) => v.post('/verify-phone', { code: '000000' })))).toBe(
      'WRONG_STEP',
    );

    // The owner of the email hears about it; the completed sign-up is not taken over.
    expect(outbox.filter((m) => m.to === takenEmail).map((m) => m.kind)).toEqual([
      'email',
      'registered',
    ]);
    expect(codeOf(await taken.post('/verify-email', { code: '000000' }))).toBe('CODE_INVALID');
    const after = await asOwner({ kind: 'business', businessId: firmId }, (tx) =>
      tx.clientAccount.findFirstOrThrow({ where: { email: takenEmail } }),
    );
    expect([after.userId, after.status]).toEqual([before.userId, 'PENDING_APPROVAL']);
  });
});
