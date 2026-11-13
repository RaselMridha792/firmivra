// End-to-end: the firm workspace's Client Portal module, part 1 (Client Portal developer
// instructions 1 to 5, 13 to 15, 17, 24 and 26): the header and status strip, Recent Clients, the
// Portal Summary, Pending Client Actions, the portal Activity and Login History. Canonical records
// only, one client the member may see (Staff: their own); firm B never. AUTH_MODE local: every
// password is the local one. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  ClientPortalActivityPage,
  ClientPortalHeader,
  ClientPortalLogins,
  ClientPortalSummary,
  INTAKE_FORMS,
  PendingClientActions,
  RecentPortalClients,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { LOCAL_PASSWORD } from '../../src/auth/identity/local-identity.provider.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
let app: INestApplication;
let portalOrigin = '';
const run = randomUUID().slice(0, 8);
const firms = { a: { id: '', slug: `r60-cpm-a-${run}` }, b: { id: '', slug: `r60-cpm-b-${run}` } };
type Who = { id: string; email: string };
const person = (key: string): Who => ({
  id: randomUUID(),
  email: `r60-cpm-${key}-${run}@r60.test`,
});
const owner = person('owner');
const admin = person('admin');
const staff = person('staff');
const ownerB = person('owner-b');
const login = person('x');
/** X: Staff's client with a portal login and work; N: no login, nobody's. */
const clients = { x: '', n: '' };
const ids = { request: '', intakeWaiting: '', intakeSubmitted: '', invoice: '', task: '' };
const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
const inFirm = <T>(firm: 'a' | 'b', work: Parameters<typeof runInScope<T>>[2]) =>
  runInScope(db, { kind: 'business', businessId: firms[firm].id }, work);
const DAY = 24 * 60 * 60 * 1000;
const PORTAL_SINCE = new Date('2026-01-12T15:00:00.000Z');
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;

const tokens = new Map<string, string>();
async function call(who: Who, path: string) {
  let token = tokens.get(who.email);
  if (!token) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/dev/token')
      .send({ email: who.email });
    token = (res.body as { token: string }).token;
    tokens.set(who.email, token);
  }
  return request(app.getHttpServer())
    .get(`/api/v1/business/client-portal${path}`)
    .set('authorization', `Bearer ${token}`);
}
const portalSignIn = (password: string) =>
  request(app.getHttpServer())
    .post(`/api/v1/portal/${firms.a.slug}/auth/sign-in`)
    .set('x-forwarded-for', '198.19.61.7, 10.0.0.5')
    .set('origin', portalOrigin)
    .send({ email: login.email, password });
const audited = (action: string) =>
  inFirm('a', (tx) =>
    tx.auditLog.count({ where: { businessId: firms.a.id, action, entityId: clients.x } }),
  );

beforeAll(async () => {
  await runInScope(db, { kind: 'platform' }, async (tx) => {
    for (const firm of [firms.a, firms.b]) {
      firm.id = (
        await tx.business.create({ data: { slug: firm.slug, name: firm.slug, status: 'ACTIVE' } })
      ).id;
    }
    for (const [u, pool] of [
      [owner, 'STAFF'],
      [admin, 'STAFF'],
      [staff, 'STAFF'],
      [ownerB, 'STAFF'],
      [login, 'CLIENT'],
    ] as const) {
      await tx.user.create({
        data: {
          id: u.id,
          cognitoSub: u.id,
          pool,
          email: u.email,
          name: `Fake ${u.email.split('-')[2]}`,
        },
      });
    }
  });
  await inFirm('b', (tx) =>
    tx.membership.create({
      data: { businessId: firms.b.id, userId: ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    }),
  );
  await inFirm('a', async (tx) => {
    const businessId = firms.a.id;
    for (const [u, role] of [
      [owner, 'OWNER'],
      [admin, 'ADMIN'],
      [staff, 'STAFF'],
    ] as const) {
      await tx.membership.create({ data: { businessId, userId: u.id, role, status: 'ACTIVE' } });
    }
    const x = await tx.client.create({
      data: {
        businessId,
        displayName: 'Fake Jane Portal',
        email: 'jane.portal@example.test',
        phone: '+14045550187',
        assignedUserId: staff.id,
        clientSince: new Date('2024-01-12'),
      },
    });
    clients.x = x.id;
    clients.n = (await tx.client.create({ data: { businessId, displayName: 'Fake No Login' } })).id;
    await tx.clientAccount.create({
      data: {
        businessId,
        userId: login.id,
        email: login.email,
        clientId: x.id,
        portalRole: 'PRIMARY',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        phoneVerifiedAt: new Date(),
        approvedAt: PORTAL_SINCE,
      },
    });
    const service = await tx.service.create({
      data: { businessId, kind: 'ANNUAL_TAX', name: 'Fake Personal Tax' },
    });
    const engagement = await tx.engagement.create({
      data: { businessId, clientId: x.id, serviceId: service.id, title: 'Fake 2025 return' },
    });
    const doc = (createdAt: Date, review: 'NEEDS_REVIEW' | null) => {
      const tag = randomUUID();
      return tx.document.create({
        data: {
          businessId,
          clientId: x.id,
          engagementId: engagement.id,
          direction: 'CLIENT_TO_FIRM',
          fileName: 'fake.pdf',
          contentType: 'application/pdf',
          sizeBytes: 100,
          sha256: tag.replace(/-/g, '').padEnd(64, '0'),
          s3Key: `tenant/${businessId}/e2e/${tag}.pdf`,
          createdAt,
          reviewStatus: review,
        },
      });
    };
    await doc(new Date(), 'NEEDS_REVIEW');
    await doc(new Date(Date.now() - 60 * DAY), null);
    ids.request = (
      await tx.documentRequest.create({
        data: {
          businessId,
          clientId: x.id,
          engagementId: engagement.id,
          title: 'Fake W-2 request',
          dueOn: new Date(Date.now() - 2 * DAY),
        },
      })
    ).id;
    const form = await tx.intakeForm.create({
      data: {
        businessId,
        serviceId: service.id,
        version: 1,
        title: 'Fake Individual Tax Intake',
        definition: INTAKE_FORMS.ANNUAL_TAX as object,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        createdByUserId: owner.id,
      },
    });
    const intake = (status: 'SENT' | 'SUBMITTED', dueOn: Date) =>
      tx.intake.create({
        data: {
          businessId,
          formId: form.id,
          engagementId: engagement.id,
          status,
          dueOn,
          sentAt: new Date(),
        },
      });
    ids.intakeWaiting = (await intake('SENT', new Date(Date.now() + 10 * DAY))).id;
    ids.intakeSubmitted = (await intake('SUBMITTED', new Date(Date.now() + 20 * DAY))).id;
    const inv = await tx.invoice.create({
      data: { businessId, clientId: x.id, number: `INV-${run}` },
    });
    await tx.invoiceLine.create({
      data: { businessId, invoiceId: inv.id, description: 'Fake', unitAmountCents: 29000 },
    });
    await tx.invoice.update({
      where: { id: inv.id },
      data: { status: 'OPEN', issuedAt: new Date(), dueOn: new Date(Date.now() + 9 * DAY) },
    });
    ids.invoice = inv.id;
    const startsAt = new Date(Date.now() + 5 * DAY);
    await tx.appointment.create({
      data: {
        businessId,
        clientId: x.id,
        staffUserId: owner.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3_600_000),
        locationKind: 'PHONE',
        status: 'SCHEDULED',
      },
    });
    const thread = await tx.messageThread.create({
      data: { businessId, clientId: x.id, subject: 'Fake question' },
    });
    await tx.message.create({
      data: {
        businessId,
        threadId: thread.id,
        senderUserId: login.id,
        direction: 'CLIENT_TO_FIRM',
        body: 'Fake question about estimated taxes',
      },
    });
    await tx.taxReturn.create({
      data: { businessId, clientId: x.id, taxYear: 2025, filingType: 'INDIVIDUAL' },
    });
    ids.task = (
      await tx.task.create({
        data: { businessId, clientId: x.id, title: 'Fake upload your ID', clientVisible: true },
      })
    ).id;
    // Staff-only work never shows as the client's.
    await tx.task.create({ data: { businessId, clientId: x.id, title: 'Fake internal task' } });
    // A member's portal action, a day ago.
    await tx.clientPortalActivity.create({
      data: {
        businessId,
        clientId: x.id,
        type: 'portal.locked',
        entityType: 'client',
        entityId: x.id,
        actorKind: 'STAFF',
        actorUserId: owner.id,
        ip: '198.19.61.250',
        occurredAt: new Date(Date.now() - DAY),
      },
    });
  });
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  portalOrigin = new URL(env.PORTAL_BASE_URL).origin;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.init();
  app = nest;
  // The client signs in once (copied into the activity), then mistypes the password once.
  expect((await portalSignIn(LOCAL_PASSWORD)).status).toBe(200);
  expect((await portalSignIn('Wrong-password-1')).status).toBe(401);
});

afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

describe('the Client Portal module', () => {
  it('shows the header and status strip from the canonical records, audited, and remembers the client', async () => {
    const res = await call(owner, `/clients/${clients.x}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const h = ClientPortalHeader.parse(res.body);
    expect(h.client).toMatchObject({
      id: clients.x,
      name: 'Fake Jane Portal',
      accountType: 'INDIVIDUAL',
      email: 'jane.portal@example.test',
      clientSince: '2024-01-12',
      archived: false,
    });
    expect(h.client.number).toMatch(/^CL-\d+$/);
    expect(h.portal).toMatchObject({
      status: 'ACTIVE',
      portalSince: PORTAL_SINCE.toISOString(),
      mfa: 'NOT_ENROLLED',
      invitationBlocked: 'HAS_LOGIN',
      link: expect.stringMatching(new RegExp(`/${firms.a.slug}$`)) as unknown as string,
    });
    expect(h.portal.logins.map((l) => [l.email, l.status])).toEqual([[login.email, 'ACTIVE']]);
    expect(h.portal.lastLogin).not.toBeNull();
    expect(h.portal.lastActivity?.type).toBe('portal.signed_in');
    expect(h.can).toEqual({ manageAccess: true, invite: true });
    expect(await audited('client_portal.viewed')).toBe(1);

    const forStaff = ClientPortalHeader.parse((await call(staff, `/clients/${clients.x}`)).body);
    expect(forStaff.can).toEqual({ manageAccess: false, invite: true });

    const none = ClientPortalHeader.parse((await call(owner, `/clients/${clients.n}`)).body);
    expect(none.portal).toMatchObject({
      status: 'NOT_ACTIVATED',
      logins: [],
      mfa: null,
      lastLogin: null,
      portalSince: null,
      invitationBlocked: 'NO_EMAIL',
    });

    const recent = RecentPortalClients.parse((await call(owner, '/recent')).body);
    expect(recent.items.map((r) => r.id)).toEqual([clients.n, clients.x]);
    // Staff never reached N, so their list has only X.
    const staffRecent = RecentPortalClients.parse((await call(staff, '/recent')).body);
    expect(staffRecent.items.map((r) => r.id)).toEqual([clients.x]);
  });

  it('shows LOCKED while the client is locked', async () => {
    const token = (
      (await request(app.getHttpServer()).post('/api/v1/dev/token').send({ email: admin.email }))
        .body as { token: string }
    ).token;
    const post = (action: string) =>
      request(app.getHttpServer())
        .post(`/api/v1/business/client-portal/clients/${clients.x}/${action}`)
        .set('authorization', `Bearer ${token}`)
        .send({});
    expect((await post('lock')).status).toBe(200);
    const h = ClientPortalHeader.parse((await call(owner, `/clients/${clients.x}`)).body);
    expect([h.portal.status, h.portal.lock.locked, h.portal.lock.lockedBy]).toEqual([
      'LOCKED',
      true,
      'Fake admin',
    ]);
    expect((await post('unlock')).status).toBe(200);
  });

  it('counts the six cards over the range, and as of now where the card says so', async () => {
    const res = await call(owner, `/clients/${clients.x}/summary`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(ClientPortalSummary.parse(res.body)).toEqual({
      days: 30,
      documents: { added: 1, pendingReview: 1 },
      messages: { inRange: 1, unread: 1 },
      appointments: { upcoming: 1, next: expect.any(String) as unknown as string },
      taxReturns: { total: 1, inProgress: 1 },
      invoices: { issued: 1, outstandingCents: 29000 },
      intakeForms: { sent: 2, pending: 1, needsReview: 1 },
    });
    const ninety = ClientPortalSummary.parse(
      (await call(owner, `/clients/${clients.x}/summary?days=90`)).body,
    );
    expect(ninety.documents).toEqual({ added: 2, pendingReview: 1 });
    expect((await call(owner, `/clients/${clients.x}/summary?days=12`)).status).toBe(400);
  });

  it('lists what waits on the client, one row per kind with items', async () => {
    const res = await call(owner, `/clients/${clients.x}/pending-actions`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const items = PendingClientActions.parse(res.body).items;
    expect(items.map((i) => [i.kind, i.count, i.title, i.recordId, i.overdue])).toEqual([
      ['DOCUMENTS_REQUESTED', 1, 'Fake W-2 request', ids.request, true],
      ['INTAKE_INCOMPLETE', 1, 'Fake Individual Tax Intake', ids.intakeWaiting, false],
      ['INTAKE_SUBMITTED', 1, 'Fake Individual Tax Intake', ids.intakeSubmitted, false],
      ['INVOICE_OUTSTANDING', 1, `INV-${run}`, ids.invoice, false],
      ['APPOINTMENT_UPCOMING', 1, 'Appointment', expect.any(String), false],
      ['TASK_OPEN', 1, 'Fake upload your ID', ids.task, false],
    ]);
    expect(items.find((i) => i.kind === 'INVOICE_OUTSTANDING')?.amountCents).toBe(29000);
    expect(items.find((i) => i.kind === 'APPOINTMENT_UPCOMING')?.at).not.toBeNull();
  });

  it('pages the activity newest first, filters it, and shows the IP to Owner and Admin only', async () => {
    const res = await call(owner, `/clients/${clients.x}/activity`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const page = ClientPortalActivityPage.parse(res.body);
    // The Admin's lock and unlock (the test before), the client's sign-in, the seeded lock.
    expect(page.items.map((i) => [i.type, i.actor.kind, i.actor.name])).toEqual([
      ['portal.unlocked', 'STAFF', 'Fake admin'],
      ['portal.locked', 'STAFF', 'Fake admin'],
      ['portal.signed_in', 'CLIENT', 'Fake x'],
      ['portal.locked', 'STAFF', 'Fake owner'],
    ]);
    expect(page.items.slice(2).map((i) => i.ip)).toEqual(['198.19.61.7', '198.19.61.250']);
    const forStaff = ClientPortalActivityPage.parse(
      (await call(staff, `/clients/${clients.x}/activity`)).body,
    );
    expect(forStaff.items.map((i) => i.ip)).toEqual([null, null, null, null]);

    const first = ClientPortalActivityPage.parse(
      (await call(owner, `/clients/${clients.x}/activity?limit=2`)).body,
    );
    expect(first.items.map((i) => i.type)).toEqual(['portal.unlocked', 'portal.locked']);
    const second = ClientPortalActivityPage.parse(
      (await call(owner, `/clients/${clients.x}/activity?limit=2&cursor=${first.nextCursor}`)).body,
    );
    expect([second.items.map((i) => i.type), second.nextCursor]).toEqual([
      ['portal.signed_in', 'portal.locked'],
      null,
    ]);
    const clientOnly = ClientPortalActivityPage.parse(
      (await call(owner, `/clients/${clients.x}/activity?actor=CLIENT&type=portal`)).body,
    );
    expect(clientOnly.items.map((i) => i.type)).toEqual(['portal.signed_in']);
    const locks = ClientPortalActivityPage.parse(
      (await call(owner, `/clients/${clients.x}/activity?type=portal.locked`)).body,
    );
    expect(locks.items).toHaveLength(2);
    expect(await audited('client_portal.activity_viewed')).toBeGreaterThanOrEqual(5);
  });

  it("lists the client's sign-ins and failed attempts, never another email's", async () => {
    const res = await call(admin, `/clients/${clients.x}/logins`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const items = ClientPortalLogins.parse(res.body).items;
    expect(items.map((i) => [i.event, i.email, i.ip])).toEqual([
      ['SIGN_IN_FAILED', login.email, '198.19.61.7'],
      ['SIGNED_IN', login.email, '198.19.61.7'],
    ]);
    const forStaff = ClientPortalLogins.parse(
      (await call(staff, `/clients/${clients.x}/logins`)).body,
    );
    expect(forStaff.items.map((i) => i.ip)).toEqual([null, null]);
    expect(
      ClientPortalLogins.parse((await call(owner, `/clients/${clients.n}/logins`)).body).items,
    ).toEqual([]);
    expect(await audited('client_portal.logins_viewed')).toBe(2);
  });

  it("refuses firm B's Owner and Staff's other clients (404), and bad input (400)", async () => {
    for (const path of ['', '/summary', '/pending-actions', '/activity', '/logins']) {
      const foreign = await call(ownerB, `/clients/${clients.x}${path}`);
      expect([path, foreign.status, codeOf(foreign)]).toEqual([path, 404, 'NOT_FOUND']);
      const notTheirs = await call(staff, `/clients/${clients.n}${path}`);
      expect([path, notTheirs.status]).toEqual([path, 404]);
    }
    expect(RecentPortalClients.parse((await call(ownerB, '/recent')).body).items).toEqual([]);
    for (const query of ['?limit=0', '?actor=ROBOT', '?type=Bad', '?from=2026-13-01', '?extra=1']) {
      expect([query, (await call(owner, `/clients/${clients.x}/activity${query}`)).status]).toEqual(
        [query, 400],
      );
    }
    expect((await call(owner, `/clients/not-a-uuid`)).status).toBe(400);
  });
});
