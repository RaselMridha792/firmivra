// End-to-end: a client's local office (Client Portal guide 2, 7.4 and 9.1; PRT-1 on R1's
// client_accounts.selected_office_id and clients.office_id). The sign-up form lists the firm's
// active locations with full addresses (public GET .../offices); the person's choice is kept on
// their account, refused unless it is one of them, and becomes the client record's office when
// the firm approves: a new record takes it, a linked record only when staff never set one.
// Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { portalCookies, PortalOffices } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { CLIENT_CODE_SENDER } from '../../src/client-auth/client-code-sender.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
let app: INestApplication;
const run = randomUUID().slice(0, 8);
const slug = `r60-office-${run}`;
const slugB = `r60-office-b-${run}`;
const firms = { a: '', b: '' };
const offices = { auburn: '', lawrenceville: '', closed: '', ofB: '' };
const owner = { id: randomUUID(), email: `r60-office-owner-${run}@r60.test` };
let portalOrigin = '';
let lastViewer = 0;
let lastPhone = 2000;
const phoneFor = () => `+1770555${++lastPhone}`;
const newViewer = () => `198.19.${++lastViewer}.1`;
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
const inFirm = <T>(firm: 'a' | 'b', work: Parameters<typeof runInScope<T>>[2]) =>
  runInScope(db, { kind: 'business', businessId: firms[firm] }, work);

beforeAll(async () => {
  await runInScope(db, { kind: 'platform' }, async (tx) => {
    firms.a = (
      await tx.business.create({ data: { slug, name: 'Fake Office Firm', status: 'ACTIVE' } })
    ).id;
    firms.b = (
      await tx.business.create({ data: { slug: slugB, name: 'Fake Firm B', status: 'ACTIVE' } })
    ).id;
    await tx.user.create({
      data: {
        id: owner.id,
        cognitoSub: owner.id,
        pool: 'STAFF',
        email: owner.email,
        name: 'Fake owner',
      },
    });
  });
  await inFirm('a', async (tx) => {
    const businessId = firms.a;
    await tx.membership.create({
      data: { businessId, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
    });
    for (const kind of ['TERMS', 'PRIVACY'] as const) {
      await tx.firmLegalDocument.create({
        data: {
          businessId,
          kind,
          version: 1,
          body: `# ${kind}`,
          publishedByUserId: fx.users.ownerA.id,
        },
      });
    }
    const office = async (name: string, extra: object = {}) =>
      (await tx.firmOffice.create({ data: { businessId, name, ...extra }, select: { id: true } }))
        .id;
    offices.lawrenceville = await office('Lawrenceville Office', {
      addressLine1: '456 Fake Pine Rd',
      addressLine2: 'Suite 200',
      city: 'Lawrenceville',
      state: 'GA',
      postalCode: '30046',
    });
    offices.auburn = await office('Auburn Office', {
      isMain: true,
      addressLine1: '123 Fake Main St',
      city: 'Auburn',
      state: 'GA',
    });
    offices.closed = await office('Closed Office', { city: 'Nowhere' });
    await tx.firmOffice.update({ where: { id: offices.closed }, data: { status: 'INACTIVE' } });
  });
  offices.ofB = await inFirm(
    'b',
    async (tx) =>
      (
        await tx.firmOffice.create({
          data: { businessId: firms.b, name: 'B Office' },
          select: { id: true },
        })
      ).id,
  );

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    SIGNUP_PHONE_VERIFICATION: 'required',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  portalOrigin = new URL(env.PORTAL_BASE_URL).origin;
  const quiet = () => Promise.resolve();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(CLIENT_CODE_SENDER)
    .useValue({ emailCode: quiet, smsCode: quiet, alreadyRegistered: quiet, signUpApproved: quiet })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.init();
  app = nest;
});

afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

/** A browser on the sign-up pages: one viewer, one cookie jar, the portal's origin. */
function visitor(firmSlug = slug) {
  const viewer = newViewer();
  let cookie = '';
  const send = async (path: string, body: object) => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/portal/${firmSlug}/auth/sign-up${path}`)
      .set('x-forwarded-for', `${viewer}, 10.0.0.5`)
      .set('origin', portalOrigin)
      .set('cookie', cookie)
      .send(body);
    const raw = res.headers['set-cookie'] as unknown;
    const set = (Array.isArray(raw) ? (raw as string[]) : []).find((c) =>
      c.startsWith(`${portalCookies(firmSlug).signUp}=`),
    );
    if (set) cookie = set.split(';')[0] ?? '';
    return res;
  };
  return { send };
}
const form = (email: string, officeId?: string) => ({
  name: 'Fake Office Client',
  email,
  phone: phoneFor(),
  password: 'Client-password-1',
  accountType: 'INDIVIDUAL',
  accepted: { termsVersion: 1, privacyVersion: 1 },
  ...(officeId ? { officeId } : {}),
});
const emailFor = (key: string) => `r60-office-${key}-${randomUUID().slice(0, 6)}@example.com`;
const accountOf = (email: string) =>
  inFirm('a', (tx) =>
    tx.clientAccount.findFirstOrThrow({
      where: { businessId: firms.a, email },
      select: { id: true, version: true, selectedOfficeId: true, clientId: true },
    }),
  );
/** Signs up with `officeId` through both codes, leaving it for the firm to approve. */
async function signUp(key: string, officeId?: string) {
  const email = emailFor(key);
  const v = visitor();
  expect((await v.send('', form(email, officeId))).status).toBe(200);
  expect((await v.send('/verify-email', { code: '000000' })).status).toBe(200);
  expect((await v.send('/verify-phone', { code: '000000' })).status).toBe(200);
  return email;
}
async function approve(email: string, clientId?: string) {
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email: owner.email });
  const token = (res.body as { token: string }).token;
  const account = await accountOf(email);
  return request(app.getHttpServer())
    .post(`/api/v1/client-sign-ups/${account.id}/approve`)
    .set('authorization', `Bearer ${token}`)
    .set('x-business-id', firms.a)
    .send({
      version: account.version,
      idempotencyKey: randomUUID(),
      ...(clientId ? { clientId } : {}),
    });
}
const officeOfClient = (clientId: string) =>
  inFirm(
    'a',
    async (tx) =>
      (await tx.client.findUniqueOrThrow({ where: { id: clientId }, select: { officeId: true } }))
        .officeId,
  );

describe('GET /portal/{slug}/offices', () => {
  it('lists the active locations with full addresses, primary first, and nothing of another firm', async () => {
    const res = await request(app.getHttpServer()).get(`/api/v1/portal/${slug}/offices`);
    expect(res.status).toBe(200);
    const { offices: list } = PortalOffices.parse(res.body);
    expect(list).toEqual([
      {
        id: offices.auburn,
        name: 'Auburn Office',
        addressLines: ['123 Fake Main St', 'Auburn, GA'],
      },
      {
        id: offices.lawrenceville,
        name: 'Lawrenceville Office',
        addressLines: ['456 Fake Pine Rd', 'Suite 200', 'Lawrenceville, GA 30046'],
      },
    ]);
    expect(JSON.stringify(list)).not.toMatch(/Closed Office|B Office/);
    expect(
      (await request(app.getHttpServer()).get('/api/v1/portal/no-such-firm-x/offices')).status,
    ).toBe(404);
  });
});

describe('the office chosen at sign-up', () => {
  it('refuses an office that is not one of the firm’s active locations', async () => {
    for (const officeId of [offices.closed, offices.ofB, randomUUID()]) {
      const res = await visitor().send('', form(emailFor('bad'), officeId));
      expect([res.status, codeOf(res)]).toEqual([400, 'OFFICE_NOT_AVAILABLE']);
    }
  });

  it('keeps the choice, and a new client record takes it on approval', async () => {
    const email = await signUp('new', offices.lawrenceville);
    expect((await accountOf(email)).selectedOfficeId).toBe(offices.lawrenceville);
    const res = await approve(email);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { clientId } = res.body as { clientId: string };
    expect(await officeOfClient(clientId)).toBe(offices.lawrenceville);
  });

  it('a sign-up without a choice still works and leaves no office', async () => {
    const email = await signUp('none');
    expect((await accountOf(email)).selectedOfficeId).toBeNull();
    const { clientId } = (await approve(email)).body as { clientId: string };
    expect(await officeOfClient(clientId)).toBeNull();
  });

  it('a linked record takes the choice only when staff never set its office', async () => {
    const make = (email: string, officeId: string | null) =>
      inFirm(
        'a',
        async (tx) =>
          (
            await tx.client.create({
              data: { businessId: firms.a, displayName: 'Fake Linked Record', email, officeId },
              select: { id: true },
            })
          ).id,
      );
    const bare = await signUp('bare', offices.lawrenceville);
    const bareRecord = await make(bare, null);
    expect((await approve(bare, bareRecord)).status).toBe(200);
    expect(await officeOfClient(bareRecord)).toBe(offices.lawrenceville);

    const set = await signUp('set', offices.lawrenceville);
    const setRecord = await make(set, offices.auburn);
    expect((await approve(set, setRecord)).status).toBe(200);
    expect(await officeOfClient(setRecord)).toBe(offices.auburn);
  });

  it('drops a choice whose office closed before approval, never failing the approval', async () => {
    const email = await signUp('closing', offices.lawrenceville);
    await inFirm('a', (tx) =>
      tx.firmOffice.update({ where: { id: offices.lawrenceville }, data: { status: 'INACTIVE' } }),
    );
    try {
      const res = await approve(email);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await officeOfClient((res.body as { clientId: string }).clientId)).toBeNull();
    } finally {
      await inFirm('a', (tx) =>
        tx.firmOffice.update({ where: { id: offices.lawrenceville }, data: { status: 'ACTIVE' } }),
      );
    }
  });
});
