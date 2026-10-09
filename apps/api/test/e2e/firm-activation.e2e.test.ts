// End-to-end: the approved firm's owner activates (R4 step 4). The owner's link from the approval
// email (a recording NotifyService) sets a password (local auth), setup's four steps and Finish
// make the firm ACTIVE, and the Super Admin's review page shows FIRM_ACTIVATED with the firm active.
// The owner works with the session from signing in with the password the link set (cookies), not
// a dev token, so the walk proves the activated login works.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  FirmApplicationRecord,
  ListFirmsResponse,
  type MfaSetupResponse,
  type SignInResult,
} from '@firmivra/types';
import { LOCAL_MFA_CODE } from '../../src/auth/identity/local-identity.provider.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';

const fx = inject('fixtures');
let app: INestApplication;
let adminToken: string;
const sent: NotifyMessage<'firm-application.approved'>[] = [];

const tag = `r16act${randomUUID().slice(0, 8)}`;
const applicationId = randomUUID();
const ownerEmail = `owner@${tag}.example.test`;
const legalName = `Sample Activation ${tag}`;

async function asPlatform<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, { kind: 'platform' }, fn);
  } finally {
    await owner.$disconnect();
  }
}

async function tokenFor(email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email })
    .expect(200);
  return (res.body as { token: string }).token;
}

const asAdmin = (method: 'get' | 'post', path: string) =>
  request(app.getHttpServer())
    [method](`/api/v1${path}`)
    .set('authorization', `Bearer ${adminToken}`);
let appOrigin = '';
/** The firm site's call with the session's cookies, as the browser sends it. */
const inFirm = (cookie: string, firmId: string, method: 'get' | 'put' | 'post', path: string) =>
  request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('origin', appOrigin)
    .set('cookie', cookie)
    .set('x-business-id', firmId);
const PASSWORD = 'Owner-password-2026';
const viewer = (path: string, body: object) =>
  request(app.getHttpServer())
    .post(`/api/v1/auth${path}`)
    .set('origin', appOrigin)
    .set('x-forwarded-for', '203.0.113.41, 10.0.0.5')
    .send(body);
/** The cookies a browser would send back. */
const cookiesOf = (res: Response) =>
  ((res.headers['set-cookie'] as unknown as string[] | undefined) ?? [])
    .map((c) => c.split(';')[0])
    .join('; ');
/** An MFA step finished with the local code: first-time authenticator setup, or a code. */
async function finishMfa(step: SignInResult): Promise<Response> {
  let session: string;
  if (step.status === 'MFA_SETUP_REQUIRED') {
    session = (
      (await viewer('/mfa/setup', { session: step.session }).expect(200)).body as MfaSetupResponse
    ).session;
  } else if (step.status === 'MFA_REQUIRED') {
    session = step.session;
  } else {
    throw new Error(`unexpected ${step.status}`);
  }
  return viewer('/mfa', { session, code: LOCAL_MFA_CODE }).expect(200);
}

beforeAll(async () => {
  await asPlatform((tx) =>
    tx.firmApplication.create({
      data: {
        id: applicationId,
        legalName,
        contactName: 'Morgan Sample',
        contactEmail: ownerEmail,
        data: {},
      },
    }),
  );
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({
      send: (m: NotifyMessage<'firm-application.approved'>) => {
        sent.push(m);
        return Promise.resolve();
      },
    })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.init();
  app = nest;
  appOrigin = new URL(env.APP_BASE_URL).origin;
  adminToken = await tokenFor(fx.users.admin.email);
});

afterAll(async () => {
  await app.close();
});

describe('Owner activation', () => {
  it('ends at first-time setup, and Finish makes the firm ACTIVE on the review page', async () => {
    const approved = FirmApplicationRecord.parse(
      (
        await asAdmin('post', `/admin/firm-applications/${applicationId}/approve`)
          .send({})
          .expect(200)
      ).body,
    );
    const firm = approved.firm!;
    expect(firm.status).toBe('PENDING_SETUP');

    // The owner opens the approval email's link and sets a password.
    const link = sent.find((m) => m.to === ownerEmail)?.data.link ?? '';
    const token = new URL(link).hash.replace('#token=', '');
    const check = await request(app.getHttpServer())
      .post('/api/v1/auth/activation/check')
      .set('x-forwarded-for', '203.0.113.41, 10.0.0.5')
      .send({ token })
      .expect(200);
    expect(check.body).toMatchObject({
      role: 'OWNER',
      business: { id: firm.id },
      hasAccount: false,
    });
    const activated = await viewer('/activate', { token, password: PASSWORD }).expect(200);
    await finishMfa(activated.body as SignInResult);

    // Later, the owner signs in with that password and lands in first-time setup.
    const signIn = await viewer('/sign-in', { email: ownerEmail, password: PASSWORD }).expect(200);
    const signedIn = await finishMfa(signIn.body as SignInResult);
    expect((signedIn.body as SignInResult).status).toBe('SIGNED_IN');
    const owner = cookiesOf(signedIn);
    const setup = await inFirm(owner, firm.id, 'get', '/setup').expect(200);
    expect(setup.body).toMatchObject({ completedAt: null });
    expect(
      (await asAdmin('get', `/admin/firm-applications/${applicationId}`).expect(200)).body,
    ).toMatchObject({ firm: { status: 'PENDING_SETUP' } });
    // The owner joined: no new link is needed.
    const resend = await asAdmin('post', `/admin/firm-applications/${applicationId}/owner-invite`)
      .send({})
      .expect(409);
    expect(resend.body.error.code).toBe('INVITE_NOT_NEEDED');

    for (const step of ['branding', 'businessDetails', 'team', 'clientPortal']) {
      await inFirm(owner, firm.id, 'put', `/setup/steps/${step}`).expect(200);
    }
    await inFirm(owner, firm.id, 'post', '/setup/complete').expect(200);

    const record = FirmApplicationRecord.parse(
      (await asAdmin('get', `/admin/firm-applications/${applicationId}`).expect(200)).body,
    );
    expect(record.firm).toEqual({ ...firm, status: 'ACTIVE' });
    expect(record.history[0]).toMatchObject({ type: 'FIRM_ACTIVATED', by: null, message: null });
    const activatedAt = (
      await asPlatform((tx) => tx.business.findUniqueOrThrow({ where: { id: firm.id } }))
    ).activatedAt;
    expect(record.history[0]?.at).toBe(activatedAt?.toISOString());

    const firms = ListFirmsResponse.parse(
      (await asAdmin('get', `/admin/firms?search=${encodeURIComponent(legalName)}`).expect(200))
        .body,
    );
    expect(firms.items).toEqual([expect.objectContaining({ id: firm.id, status: 'ACTIVE' })]);

    // Activation and Finish are audited in the new firm, by the owner.
    const ownerId = (
      await asPlatform((tx) =>
        tx.user.findFirstOrThrow({ where: { email: ownerEmail, pool: 'STAFF' } }),
      )
    ).id;
    const audit = await asPlatform((tx) =>
      tx.auditLog.findMany({
        where: {
          businessId: firm.id,
          action: { in: ['membership.activated', 'setup.step_completed', 'setup.finished'] },
        },
        orderBy: { createdAt: 'asc' },
      }),
    );
    expect(audit.map((a) => [a.action, a.actorUserId])).toEqual([
      ['membership.activated', ownerId],
      ...Array.from({ length: 4 }, () => ['setup.step_completed', ownerId]),
      ['setup.finished', ownerId],
    ]);
  });
});
