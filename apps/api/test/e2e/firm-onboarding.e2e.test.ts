// End-to-end: the whole firm onboarding path (R4 step 6). A firm applies on the public form, the
// Super Admin reviews (information request, notes) and approves, the owner activates the link
// from the approval email (local auth), finishes first-time setup, and the firm is ACTIVE. Every
// action leaves its audit row, in the platform's log or the new firm's; firm B sees none of it and
// the new firm's people can't act in firm B. The NotifyService is replaced by a recorder.
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { createPrismaClient, runInScope, type Scope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  FirmApplicationRecord,
  ListFirmApplicationsResponse,
  type MfaSetupResponse,
  type SignInResult,
} from '@firmivra/types';
import { LOCAL_MFA_CODE } from '../../src/auth/identity/local-identity.provider.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { EIN_HASH_KEY, loadEinHashKey } from '../../src/firm-applications/ein-hash.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';

const fx = inject('fixtures');
let app: INestApplication;
let origin = '';
let adminToken = '';
const sent: NotifyMessage[] = [];

const tag = `r16onb${randomUUID().slice(0, 8)}`;
const ownerEmail = `pat@${tag}.example.test`;
const legalName = `Sample Onboarding ${tag}`;

async function as<T>(scope: Scope, fn: (tx: TxClient) => Promise<T>, url?: string): Promise<T> {
  const client = createPrismaClient(url ?? testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(client, scope, fn);
  } finally {
    await client.$disconnect();
  }
}
/** As the API's database role, under row-level security. */
const asApp = <T>(businessId: string, fn: (tx: TxClient) => Promise<T>) =>
  as({ kind: 'business', businessId }, fn, fx.appUrl);

async function tokenFor(email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email })
    .expect(200);
  return (res.body as { token: string }).token;
}
const admin = (method: 'get' | 'post' | 'put', path: string) =>
  request(app.getHttpServer())
    [method](`/api/v1/admin${path}`)
    .set('authorization', `Bearer ${adminToken}`);
/** A firm-site call as `who`: a session's cookies (with the site's Origin) or a dev token. */
const inFirm = (
  who: { cookie: string } | { bearer: string },
  firmId: string,
  method: 'get' | 'put' | 'post',
  path: string,
) => {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', firmId);
  return 'cookie' in who
    ? req.set('origin', origin).set('cookie', who.cookie)
    : req.set('authorization', `Bearer ${who.bearer}`);
};
const viewer = (path: string) =>
  request(app.getHttpServer())
    .post(`/api/v1${path}`)
    .set('origin', origin)
    .set('x-forwarded-for', 'fd16:6:6::1, 10.0.0.5');
const PASSWORD = 'Owner-password-2026';
/** The cookies a browser would send back. */
const cookiesOf = (res: Response) =>
  ((res.headers['set-cookie'] as unknown as string[] | undefined) ?? [])
    .map((c) => c.split(';')[0])
    .join('; ');
/** An MFA step finished with the local code: first-time authenticator setup, or a code. */
async function finishMfa(step: SignInResult): Promise<Response> {
  let session: string;
  if (step.status === 'MFA_SETUP_REQUIRED') {
    const setup = await viewer('/auth/mfa/setup').send({ session: step.session }).expect(200);
    session = (setup.body as MfaSetupResponse).session;
  } else if (step.status === 'MFA_REQUIRED') {
    session = step.session;
  } else {
    throw new Error(`unexpected ${step.status}`);
  }
  return viewer('/auth/mfa').send({ session, code: LOCAL_MFA_CODE }).expect(200);
}

beforeAll(async () => {
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  origin = new URL(env.APP_BASE_URL).origin;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(EIN_HASH_KEY)
    .useValue(loadEinHashKey({ EIN_HASH_KEY: randomBytes(32).toString('hex') }))
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({
      send: (m: NotifyMessage) => {
        sent.push(m);
        return Promise.resolve();
      },
    })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.init();
  app = nest;
  adminToken = await tokenFor(fx.users.admin.email);
});

afterAll(async () => {
  await app.close();
});

describe('Firm onboarding, from application to an active firm', () => {
  it('applies, is reviewed and approved, activates, finishes setup, and every step is audited', async () => {
    // 1. The public form.
    await request(app.getHttpServer())
      .post('/api/v1/firm-applications')
      .set('origin', origin)
      .set('x-forwarded-for', 'fd16:5:5::1, 10.0.0.5')
      .send({
        business: {
          practiceType: 'TAX_ACCOUNTING',
          legalName,
          entityType: 'PARTNERSHIP',
          ein: '00-1234567',
          phone: '(404) 555-0101',
          address: { line1: '1 Example Way', city: 'Atlanta', state: 'GA', postalCode: '30301' },
          services: ['TAX_PREPARATION'],
        },
        primaryAdmin: { fullName: 'Pat Sample', email: ownerEmail, phone: '+1 404 555 0102' },
        account: { requestedPlan: 'STARTER', teamSize: 4, clientVolume: 'UNDER_100' },
        credentials: [],
        agreement: { acceptedTerms: true, certifiedAccurate: true },
      })
      .expect(200);
    await vi.waitFor(() =>
      expect(sent.map((m) => m.template)).toContain('firm-application.received'),
    );

    // 2. The Super Admin finds it, asks for information, keeps a note and approves.
    const list = ListFirmApplicationsResponse.parse(
      (await admin('get', `/firm-applications?search=${tag}`).expect(200)).body,
    );
    expect(list.items).toHaveLength(1);
    const id = list.items[0]!.id;
    await admin('get', `/firm-applications/${id}`).expect(200);
    await admin('post', `/firm-applications/${id}/request-info`)
      .send({ message: 'Please send your PTIN.' })
      .expect(200);
    await admin('put', `/firm-applications/${id}/notes`)
      .send({ notes: 'PTIN received.' })
      .expect(200);
    const approved = FirmApplicationRecord.parse(
      (await admin('post', `/firm-applications/${id}/approve`).send({}).expect(200)).body,
    );
    const firm = approved.firm!;
    expect(approved.ownerInvite?.status).toBe('SENT');

    // 3. The owner activates from the approval email and finishes first-time setup.
    const approval = sent.find((m) => m.template === 'firm-application.approved');
    expect(approval?.to).toBe(ownerEmail);
    const link = (approval?.data as { link: string }).link;
    const token = new URL(link).hash.replace('#token=', '');
    const activated = await viewer('/auth/activate')
      .send({ token, password: PASSWORD })
      .expect(200);
    await finishMfa(activated.body as SignInResult);
    // The owner signs in with the password the link set; a wrong one is refused.
    const wrong = await viewer('/auth/sign-in')
      .send({ email: ownerEmail, password: 'Not-the-password-1' })
      .expect(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    const signIn = await viewer('/auth/sign-in')
      .send({ email: ownerEmail, password: PASSWORD })
      .expect(200);
    const signedIn = await finishMfa(signIn.body as SignInResult);
    expect((signedIn.body as SignInResult).status).toBe('SIGNED_IN');
    const owner = { cookie: cookiesOf(signedIn) };
    for (const step of ['branding', 'businessDetails', 'team', 'clientPortal']) {
      await inFirm(owner, firm.id, 'put', `/setup/steps/${step}`).expect(200);
    }
    await inFirm(owner, firm.id, 'post', '/setup/complete').expect(200);

    // 4. The firm is ACTIVE on the review page.
    const record = FirmApplicationRecord.parse(
      (await admin('get', `/firm-applications/${id}`).expect(200)).body,
    );
    expect(record.firm?.status).toBe('ACTIVE');
    expect(record.ownerInvite?.status).toBe('ACCEPTED');
    expect(record.history.map((h) => h.type)).toEqual([
      'FIRM_ACTIVATED',
      'OWNER_INVITED',
      'APPROVED',
      'INFO_REQUESTED',
      'SUBMITTED',
    ]);
    expect(sent.map((m) => [m.template, m.to])).toEqual([
      ['firm-application.received', ownerEmail],
      ['firm-application.info-requested', ownerEmail],
      ['firm-application.approved', ownerEmail],
    ]);

    // The firm's page on the Super Admin site lists it as active (opening it is audited).
    const firmPage = await admin('get', `/firms/${firm.id}`).expect(200);
    expect(firmPage.body).toMatchObject({ id: firm.id, status: 'ACTIVE' });

    // 5. Every action is audited: the platform's log (no firm) and the new firm's own.
    const platformRows = await as({ kind: 'platform' }, (tx) =>
      tx.auditLog.findMany({
        where: { businessId: null, entityId: { in: [id, firm.id] } },
        orderBy: { createdAt: 'asc' },
      }),
    );
    expect(platformRows.map((a) => [a.action, a.actorUserId])).toEqual([
      ['firm_application.submitted', null],
      ['firm_application.viewed', fx.users.admin.id],
      ['firm_application.info_requested', fx.users.admin.id],
      ['firm_application.notes_saved', fx.users.admin.id],
      ['firm_application.approved', fx.users.admin.id],
      ['business.created', fx.users.admin.id],
      ['firm_application.viewed', fx.users.admin.id],
      ['business.viewed_by_admin', fx.users.admin.id],
    ]);
    // No EIN, notes or message in any row.
    expect(JSON.stringify(platformRows)).not.toMatch(/1234567|PTIN/);
    const firmRows = await asApp(firm.id, (tx) =>
      tx.auditLog.findMany({ where: { businessId: firm.id }, orderBy: { createdAt: 'asc' } }),
    );
    expect(firmRows.map((a) => a.action)).toEqual([
      'settings.copied_from_application',
      'membership.invited',
      'membership.activated',
      'setup.step_completed',
      'setup.step_completed',
      'setup.step_completed',
      'setup.step_completed',
      'setup.finished',
    ]);
    expect(JSON.stringify(firmRows)).not.toMatch(/1234567|Owner-password/);
    // The activation token is in no audit row, of the platform or the firm.
    expect(JSON.stringify([platformRows, firmRows])).not.toContain(token);

    // 6. Firm B: sees nothing of the new firm, and neither side acts in the other (404: the
    // tenant guard doesn't say the firm exists).
    for (const count of [
      (tx: TxClient) => tx.auditLog.count({ where: { businessId: firm.id } }),
      (tx: TxClient) => tx.businessSettings.count({ where: { businessId: firm.id } }),
      (tx: TxClient) => tx.membership.count({ where: { businessId: firm.id } }),
      (tx: TxClient) => tx.invite.count({ where: { businessId: firm.id } }),
    ]) {
      expect(await asApp(fx.firmB.id, count)).toBe(0);
    }
    expect((await inFirm(owner, fx.firmB.id, 'get', '/setup')).status).toBe(404);
    const ownerB = { bearer: await tokenFor(fx.users.ownerB.email) };
    expect((await inFirm(ownerB, firm.id, 'get', '/settings')).status).toBe(404);
    expect((await inFirm(ownerB, firm.id, 'post', '/setup/complete')).status).toBe(404);
  });
});
