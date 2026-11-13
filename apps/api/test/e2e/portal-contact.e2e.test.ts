// End-to-end: Settings > Client Portal > Contact Information (Client Portal guide 4, 7.2 and 9.4;
// PRT-3 on R1's client_portal_settings). Owner and Admin switch the corporate office, the client's
// local office and five contact methods; the portal's card for a signed-in client shows only what
// is switched on, with details from Company Profile and Locations. Texts only to a client who
// opted in; messages only while the Messages tab is on. Firm B never sees firm A. Synthetic data.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { MyPortalContact, PortalContactSettings } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
let app: INestApplication;
const run = randomUUID().slice(0, 8);
const slugA = `r60-pc-a-${run}`;
const slugB = `r60-pc-b-${run}`;
const firms = { a: '', b: '' };
const offices = { auburn: '', lawrenceville: '', closed: '' };
const person = (key: string) => ({ id: randomUUID(), email: `r60-pc-${key}-${run}@r60.test` });
const owner = person('owner');
const admin = person('admin');
const staff = person('staff');
const client = person('client');
const pending = person('pending');
const ownerB = person('owner-b');
const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
let clientId = '';

beforeAll(async () => {
  await runInScope(db, { kind: 'platform' }, async (tx) => {
    for (const [u, pool] of [
      [owner, 'STAFF'],
      [admin, 'STAFF'],
      [staff, 'STAFF'],
      [client, 'CLIENT'],
      [pending, 'CLIENT'],
      [ownerB, 'STAFF'],
    ] as const) {
      await tx.user.create({
        data: { id: u.id, cognitoSub: u.id, pool, email: u.email, name: 'Fake R60 contact' },
      });
    }
    firms.a = (
      await tx.business.create({
        data: { slug: slugA, name: 'Fake Contact Firm', status: 'ACTIVE' },
      })
    ).id;
    firms.b = (
      await tx.business.create({ data: { slug: slugB, name: 'Fake Firm B', status: 'ACTIVE' } })
    ).id;
  });
  await runInScope(db, { kind: 'business', businessId: firms.a }, async (tx) => {
    const businessId = firms.a;
    for (const [u, role] of [
      [owner, 'OWNER'],
      [admin, 'ADMIN'],
      [staff, 'STAFF'],
    ] as const) {
      await tx.membership.create({ data: { businessId, userId: u.id, role, status: 'ACTIVE' } });
    }
    await tx.businessSettings.create({
      data: {
        businessId,
        contactPhone: '+14045550100',
        contactEmail: 'hello@contact.example.test',
        addressLine1: '1 Fake Main St',
        city: 'Auburn',
        state: 'GA',
        postalCode: '30011',
      },
    });
    const office = (name: string, extra: object = {}) =>
      tx.firmOffice.create({
        data: { businessId, name, city: 'Fake City', state: 'GA', ...extra },
        select: { id: true },
      });
    offices.auburn = (await office('Auburn Office', { isMain: true, phone: '+14045550101' })).id;
    offices.lawrenceville = (
      await office('Lawrenceville Office', {
        phone: '+14045550102',
        email: 'law@contact.example.test',
        addressLine1: '456 Fake Pine Rd',
      })
    ).id;
    offices.closed = (await office('Closed Office', { phone: '+14045550103' })).id;
    const record = await tx.client.create({
      data: { businessId, displayName: 'Fake Contact Client', officeId: offices.lawrenceville },
      select: { id: true },
    });
    clientId = record.id;
    await tx.clientAccount.create({
      data: { businessId, userId: client.id, email: client.email, clientId, status: 'ACTIVE' },
    });
    // Signed up, no client record yet: the office they chose stands in.
    await tx.clientAccount.create({
      data: {
        businessId,
        userId: pending.id,
        email: pending.email,
        status: 'ACTIVE',
        selectedOfficeId: offices.auburn,
      },
    });
    // Deactivated after it was chosen: kept, but never shown for new choices.
    await tx.firmOffice.update({ where: { id: offices.closed }, data: { status: 'INACTIVE' } });
  });
  await runInScope(db, { kind: 'business', businessId: firms.b }, (tx) =>
    tx.membership.create({
      data: { businessId: firms.b, userId: ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    }),
  );
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
  await db.$disconnect();
});

/** One token per person: the dev token route allows 30 a minute. */
const tokens = new Map<string, string>();
async function tokenOf(email: string): Promise<string> {
  let token = tokens.get(email);
  if (!token) {
    const res = await request(app.getHttpServer()).post('/api/v1/dev/token').send({ email });
    token = (res.body as { token: string }).token;
    tokens.set(email, token);
  }
  return token;
}
async function send(method: 'get' | 'put', path: string, who: { email: string }, body?: object) {
  const token = await tokenOf(who.email);
  const req = request(app.getHttpServer())
    [method](`/api/v1${path}`)
    .set('authorization', `Bearer ${token}`);
  return body ? req.send(body) : req;
}
const code = (res: request.Response) => (res.body as { error?: { code: string } }).error?.code;
const SETTINGS = '/business/settings/portal-contact';
const settings = async (who = owner) => {
  const res = await send('get', SETTINGS, who);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return PortalContactSettings.parse(res.body);
};
const save = async (body: object, who = owner) => {
  const res = await send('put', SETTINGS, who, body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return PortalContactSettings.parse(res.body);
};
const mine = async (who: { email: string } = client, slug = slugA) => {
  const res = await send('get', `/portal/${slug}/me/contact`, who);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return MyPortalContact.parse(res.body);
};
const audits = () =>
  runInScope(db, { kind: 'business', businessId: firms.a }, (tx) =>
    tx.auditLog.findMany({
      where: { businessId: firms.a, action: 'client_portal.contact_updated' },
      orderBy: { createdAt: 'asc' },
    }),
  );

describe('Settings > Client Portal > Contact Information', () => {
  it('starts with the defaults and shows the corporate office and the active locations', async () => {
    const s = await settings();
    expect(s.switches).toEqual({
      showCorporateOffice: true,
      showLocalOffice: true,
      allowPhone: true,
      allowSms: false,
      allowEmail: true,
      allowSecureMessage: true,
      allowAppointmentLink: false,
    });
    expect(s.updatedAt).toBeNull();
    // Company Profile, under the firm's name.
    expect(s.corporate).toMatchObject({
      id: null,
      name: 'Fake Contact Firm',
      phone: '+14045550100',
      email: 'hello@contact.example.test',
      addressLines: ['1 Fake Main St', 'Auburn, GA 30011'],
    });
    // Active locations only, the primary first.
    expect(s.offices.map((o) => o.name)).toEqual(['Auburn Office', 'Lawrenceville Office']);
    expect(s.offices[1]).toMatchObject({
      id: offices.lawrenceville,
      phone: '+14045550102',
      addressLines: ['456 Fake Pine Rd', 'Fake City, GA'],
    });
  });

  it('changes only what is sent, audits what changed, and writes nothing for no change', async () => {
    const s = await save({ allowSms: true, allowAppointmentLink: true, allowPhone: true });
    expect(s.switches).toMatchObject({
      allowSms: true,
      allowAppointmentLink: true,
      allowPhone: true,
    });
    expect(s.updatedAt).not.toBeNull();
    const [row] = await audits();
    expect(row?.metadata).toEqual({ changed: { allowSms: true, allowAppointmentLink: true } });
    await save({ allowSms: true }, admin);
    expect(await audits()).toHaveLength(1);
  });

  it('refuses an empty or unknown change, and Staff and clients', async () => {
    for (const bad of [{}, { showOfficeHours: true }, { allowSms: 'yes' }]) {
      expect(code(await send('put', SETTINGS, owner, bad))).toBe('VALIDATION_FAILED');
    }
    expect((await send('get', SETTINGS, staff)).status).toBe(403);
    expect((await send('put', SETTINGS, staff, { allowSms: false })).status).toBe(403);
    expect((await send('get', SETTINGS, client)).status).toBe(403);
  });
});

describe('GET /portal/{slug}/me/contact', () => {
  it('shows the corporate office and the client’s assigned office with the allowed methods', async () => {
    const c = await mine();
    expect(c.corporate?.name).toBe('Fake Contact Firm');
    expect(c.local).toMatchObject({ id: offices.lawrenceville, name: 'Lawrenceville Office' });
    // Texts are allowed, but this client never opted in.
    expect(c.methods).toEqual({
      phone: true,
      sms: false,
      email: true,
      secureMessage: true,
      appointment: true,
    });
  });

  it('offers texts only once the client opted in, and messages only while Messages is on', async () => {
    await runInScope(db, { kind: 'business', businessId: firms.a }, async (tx) => {
      await tx.communicationConsent.create({
        data: {
          businessId: firms.a,
          clientId,
          channel: 'SMS',
          status: 'OPTED_IN',
          source: 'portal',
        },
      });
    });
    expect((await mine()).methods.sms).toBe(true);
    expect(
      (await send('put', '/business/settings/portal-tabs', owner, { tabs: { MESSAGES: false } }))
        .status,
    ).toBe(200);
    expect((await mine()).methods.secureMessage).toBe(false);
    await send('put', '/business/settings/portal-tabs', owner, { tabs: { MESSAGES: true } });
    await save({ allowSms: false });
    expect((await mine()).methods.sms).toBe(false);
  });

  it('follows the switches: each office hides on its own', async () => {
    await save({ showLocalOffice: false });
    const noLocal = await mine();
    expect([noLocal.corporate?.name, noLocal.local]).toEqual(['Fake Contact Firm', null]);
    await save({ showLocalOffice: true, showCorporateOffice: false });
    const noCorporate = await mine();
    expect([noCorporate.corporate, noCorporate.local?.name]).toEqual([
      null,
      'Lawrenceville Office',
    ]);
    await save({ showCorporateOffice: true });
  });

  it('uses the office chosen at registration until a client record has one', async () => {
    expect((await mine(pending)).local?.name).toBe('Auburn Office');
  });

  it('shows no local office once the assigned one is no longer active', async () => {
    await runInScope(db, { kind: 'business', businessId: firms.a }, (tx) =>
      tx.client.update({ where: { id: clientId }, data: { officeId: offices.auburn } }),
    );
    await runInScope(db, { kind: 'business', businessId: firms.a }, (tx) =>
      tx.firmOffice.update({
        where: { id: offices.auburn },
        data: { status: 'INACTIVE', isMain: false },
      }),
    );
    const c = await mine();
    expect(c.local).toBeNull();
    // The corporate office still comes from Company Profile.
    expect(c.corporate?.phone).toBe('+14045550100');
  });

  it('is the firm’s own: firm B has the defaults and nothing of firm A, and A’s client is refused there', async () => {
    const b = await settings(ownerB);
    expect(b.updatedAt).toBeNull();
    expect(b.switches.allowSms).toBe(false);
    expect(b.offices).toEqual([]);
    expect(JSON.stringify(b)).not.toMatch(/Fake Contact|Lawrenceville|hello@contact/);
    const res = await send('get', `/portal/${slugB}/me/contact`, client);
    expect([401, 403, 404]).toContain(res.status);
  });
});
