// End-to-end: a firm's account actions on the Super Admin's firm page (SA-FRM-F02 to F04, Y07,
// Y10) and the firms list's plan filter and sorting (SA-FRM-Y08). Each test acts on fake firms of
// its own, never the shared fixture firms, so other files' firm routes keep working.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { FirmRecord, ListFirmsResponse } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
let app: INestApplication;

/** A word only this file's firms contain, so the list tests see only them. */
const tag = `frmacct${randomUUID().slice(0, 8)}`;
const people = {
  owner: { id: randomUUID(), email: `${tag}-owner@account.example.test` },
  team: { id: randomUUID(), email: `${tag}-team@account.example.test` },
};
/** Fake firms: an Active one with an owner, one still in setup, and three for the list. */
const firms = {
  active: { id: randomUUID(), slug: `${tag}-active`, name: `Sample Account ${tag} Active` },
  setup: { id: randomUUID(), slug: `${tag}-setup`, name: `Sample Account ${tag} Setup` },
  alpha: { id: randomUUID(), slug: `${tag}-alpha`, name: `alpha Tax ${tag}` },
  bravo: { id: randomUUID(), slug: `${tag}-bravo`, name: `Bravo Tax ${tag}` },
  charlie: { id: randomUUID(), slug: `${tag}-charlie`, name: `Charlie Tax ${tag}` },
};
/** A firm closed before closures were recorded: no audit row, only the database's closure time. */
const legacyClosed = {
  id: randomUUID(),
  slug: `older-closed-${randomUUID().slice(0, 8)}`,
  name: 'Sample Older Closed Firm',
};
/** The approved applications behind Bravo (Starter, approved first) and Charlie (Enterprise). */
const apps = { bravo: randomUUID(), charlie: randomUUID() };

const tokens = new Map<string, string>();
async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email })
    .expect(200);
  const { token } = res.body as { token: string };
  tokens.set(email, token);
  return token;
}
const asAdmin = async () => `Bearer ${await tokenFor(fx.users.admin.email)}`;
// Each helper fetches its token before it builds its request, so no request is ever built while
// another is still opening or closing the server (the app also listens on a port of its own).
const get = async (path: string) => {
  const authorization = await asAdmin();
  return request(app.getHttpServer()).get(`/api/v1${path}`).set('authorization', authorization);
};
const act = async (id: string, action: string, body: object, email = fx.users.admin.email) => {
  const token = await tokenFor(email);
  return request(app.getHttpServer())
    .post(`/api/v1/admin/firms/${id}/${action}`)
    .set('authorization', `Bearer ${token}`)
    .send(body);
};
const codeOf = (res: request.Response) => (res.body as { error?: { code?: string } }).error?.code;
/** The firm's owner on one of the firm's own routes. */
const ownerCall = async () => {
  const token = await tokenFor(people.owner.email);
  return request(app.getHttpServer())
    .get('/api/v1/business/audit-log')
    .set('authorization', `Bearer ${token}`)
    .set('x-business-id', firms.active.id);
};

/** An approved application of `plan`, for `businessId`, as the app writes one. */
const form = (plan: string, email: string, legalName: string) => ({
  business: {
    practiceType: 'TAX_ACCOUNTING',
    legalName,
    dbaName: null,
    entityType: 'LLC',
    email: null,
    phone: null,
    website: null,
    address: {
      line1: '1 Example Way',
      line2: null,
      city: 'Atlanta',
      state: 'GA',
      postalCode: '30301',
    },
    services: ['TAX_PREPARATION'],
  },
  primaryAdmin: {
    fullName: 'Jordan Sample',
    email,
    phone: '+14045550101',
    title: null,
    preferredContact: 'EMAIL',
    alternatePhone: null,
  },
  account: {
    requestedPlan: plan,
    teamSize: 3,
    clientVolume: 'FROM_250',
    heardFrom: null,
    requestedStartDate: null,
    additionalInfo: null,
  },
  credentials: [],
});

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    await tx.user.create({
      data: {
        id: people.owner.id,
        cognitoSub: people.owner.id,
        pool: 'STAFF',
        email: people.owner.email,
        name: 'Fake Account Owner',
      },
    });
    await tx.user.create({
      data: {
        id: people.team.id,
        cognitoSub: people.team.id,
        pool: 'ADMIN',
        email: people.team.email,
        name: 'Fake Team Member',
      },
    });
    await tx.platformAdmin.create({ data: { userId: people.team.id, role: 'TEAM_MEMBER' } });
    await tx.business.create({ data: { ...firms.active, status: 'ACTIVE' } });
    await tx.business.create({ data: { ...legacyClosed, status: 'CLOSED' } });
    for (const f of [firms.setup, firms.alpha, firms.bravo, firms.charlie]) {
      await tx.business.create({ data: { ...f, status: 'PENDING_SETUP' } });
    }
    for (const [id, plan, firm] of [
      [apps.bravo, 'STARTER', firms.bravo],
      [apps.charlie, 'ENTERPRISE', firms.charlie],
    ] as const) {
      const email = `${firm.slug}@account.example.test`;
      await tx.firmApplication.create({
        data: {
          id,
          legalName: firm.name,
          contactName: 'Jordan Sample',
          contactEmail: email,
          contactPhone: '+14045550101',
          data: form(plan, email, firm.name),
        },
      });
    }
  });
  await runInScope(owner, { kind: 'business', businessId: firms.active.id }, (tx) =>
    tx.membership.create({
      data: {
        businessId: firms.active.id,
        userId: people.owner.id,
        role: 'OWNER',
        status: 'ACTIVE',
      },
    }),
  );
  // Approved as the Super Admin (the database records when), Bravo first; then linked to the firm.
  for (const id of [apps.bravo, apps.charlie]) {
    await runInScope(owner, { kind: 'admin', adminUserId: fx.users.admin.id }, (tx) =>
      tx.firmApplication.update({
        where: { id },
        data: { status: 'APPROVED', reviewedByUserId: fx.users.admin.id, reviewedAt: new Date() },
      }),
    );
    // Never the same millisecond, so the approval order is the order here.
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    await tx.firmApplication.update({
      where: { id: apps.bravo },
      data: { businessId: firms.bravo.id },
    });
    await tx.firmApplication.update({
      where: { id: apps.charlie },
      data: { businessId: firms.charlie.id },
    });
  });
  await owner.$disconnect();

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
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('SA-FRM-F02 to F04, Y07, Y10: the firm account actions', () => {
  it('Suspend refuses the firm’s people, Reactivate lets them back, and the history keeps both reasons', async () => {
    expect((await ownerCall()).status).toBe(200);
    const before = FirmRecord.parse((await get(`/admin/firms/${firms.active.id}`)).body);
    expect(before.can).toEqual({ suspend: true, reactivate: false, close: true });
    expect(before.accountHistory?.map((e) => e.type)).toEqual(['ACTIVATED']);

    const suspended = await act(firms.active.id, 'suspend', { reason: 'Fake: unpaid invoices' });
    expect(suspended.status, JSON.stringify(suspended.body)).toBe(200);
    const s = FirmRecord.parse(suspended.body);
    expect(s.status).toBe('SUSPENDED');
    expect(s.can).toEqual({ suspend: false, reactivate: true, close: true });
    expect(s.accountHistory?.[0]).toMatchObject({
      type: 'SUSPENDED',
      reason: 'Fake: unpaid invoices',
      by: { userId: fx.users.admin.id },
    });
    const refused = await ownerCall();
    expect(refused.status).toBe(403);
    expect(codeOf(refused)).toBe('BUSINESS_INACTIVE');
    // A second click a moment later meets the new status.
    const again = await act(firms.active.id, 'suspend', { reason: 'Fake: again' });
    expect(again.status).toBe(409);
    expect(codeOf(again)).toBe('FIRM_STATUS_CHANGED');

    const back = await act(firms.active.id, 'reactivate', { reason: 'Fake: paid in full' });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    const r = FirmRecord.parse(back.body);
    // It had finished setup, so it is Active again; its first activation time stays.
    expect(r.status).toBe('ACTIVE');
    expect(r.activatedAt).toBe(before.activatedAt);
    expect(r.accountHistory?.map((e) => [e.type, e.reason])).toEqual([
      ['REACTIVATED', 'Fake: paid in full'],
      ['SUSPENDED', 'Fake: unpaid invoices'],
      ['ACTIVATED', null],
    ]);
    expect((await ownerCall()).status).toBe(200);
    expect((await act(firms.active.id, 'reactivate', { reason: 'Fake' })).status).toBe(409);
  });

  it('a firm suspended during setup goes back to Pending Setup', async () => {
    const s = await act(firms.setup.id, 'suspend', { reason: 'Fake: checking the licence' });
    expect(FirmRecord.parse(s.body).status).toBe('SUSPENDED');
    const r = FirmRecord.parse(
      (await act(firms.setup.id, 'reactivate', { reason: 'Fake: licence checked' })).body,
    );
    expect(r.status).toBe('PENDING_SETUP');
    expect(r.activatedAt).toBeNull();
    expect(r.can).toEqual({ suspend: true, reactivate: false, close: true });
  });

  it('Close is final: the closure time is recorded and nothing reopens the firm', async () => {
    const closed = await act(firms.setup.id, 'close', { reason: 'Fake: the owner asked to close' });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    const c = FirmRecord.parse(closed.body);
    expect(c.status).toBe('CLOSED');
    expect(c.closedAt).not.toBeNull();
    expect(c.can).toEqual({ suspend: false, reactivate: false, close: false });
    expect(c.accountHistory?.[0]).toMatchObject({
      type: 'CLOSED',
      reason: 'Fake: the owner asked to close',
      by: { userId: fx.users.admin.id },
    });
    // One closure, the Super Admin's (not a second one from the closure time).
    expect(c.accountHistory?.filter((e) => e.type === 'CLOSED')).toHaveLength(1);
    for (const action of ['suspend', 'reactivate', 'close']) {
      const res = await act(firms.setup.id, action, { reason: 'Fake' });
      expect(res.status, action).toBe(409);
      expect(codeOf(res), action).toBe('FIRM_STATUS_CHANGED');
    }
    // Listed with its own status under Inactive.
    const inactive = ListFirmsResponse.parse(
      (await get(`/admin/firms?status=INACTIVE&search=${tag}&pageSize=100`)).body,
    );
    expect(inactive.items.map((f) => [f.id, f.status])).toEqual([[firms.setup.id, 'CLOSED']]);
  });

  it('a firm closed before closures were recorded still shows its closure (Y07)', async () => {
    const f = FirmRecord.parse((await get(`/admin/firms/${legacyClosed.id}`)).body);
    expect(f.status).toBe('CLOSED');
    expect(f.closedAt).not.toBeNull();
    expect(f.accountHistory).toEqual([{ type: 'CLOSED', at: f.closedAt, by: null, reason: null }]);
    expect(f.can).toEqual({ suspend: false, reactivate: false, close: false });
  });

  it('needs a reason, a known firm and a Super Admin', async () => {
    const empty = await act(firms.alpha.id, 'suspend', { reason: '   ' });
    expect(empty.status).toBe(400);
    expect(codeOf(empty)).toBe('VALIDATION_FAILED');
    expect((await act(firms.alpha.id, 'suspend', {})).status).toBe(400);
    expect((await act(randomUUID(), 'suspend', { reason: 'Fake' })).status).toBe(404);
    expect((await act('not-an-id', 'close', { reason: 'Fake' })).status).toBe(400);
    // A platform team member (not a Super Admin) and a firm's Owner are refused; nothing changes.
    for (const email of [people.team.email, people.owner.email]) {
      const res = await act(firms.alpha.id, 'close', { reason: 'Fake' }, email);
      expect([401, 403], email).toContain(res.status);
    }
    const alpha = FirmRecord.parse((await get(`/admin/firms/${firms.alpha.id}`)).body);
    expect(alpha.status).toBe('PENDING_SETUP');
    expect(alpha.accountHistory).toEqual([]);
  });
});

describe('SA-FRM-Y08: the firms list’s plan filter and sorting', () => {
  const names = (r: ListFirmsResponse) =>
    r.items.filter((f) =>
      ([firms.alpha.id, firms.bravo.id, firms.charlie.id] as string[]).includes(f.id),
    );

  it('filters by the plan the application asked for', async () => {
    const starter = ListFirmsResponse.parse(
      (await get(`/admin/firms?search=${tag}&plan=STARTER&pageSize=100`)).body,
    );
    expect(starter.items.map((f) => f.id)).toEqual([firms.bravo.id]);
    expect(starter.total).toBe(1);
    const enterprise = ListFirmsResponse.parse(
      (await get(`/admin/firms?search=${tag}&plan=ENTERPRISE&pageSize=100`)).body,
    );
    expect(enterprise.items.map((f) => f.id)).toEqual([firms.charlie.id]);
    expect((await get('/admin/firms?plan=GOLD')).status).toBe(400);
  });

  it('sorts by firm name, ignoring case, either way', async () => {
    const byName = async (order: string) =>
      names(
        ListFirmsResponse.parse(
          (await get(`/admin/firms?search=Tax%20${tag}&sort=name&order=${order}&pageSize=100`))
            .body,
        ),
      ).map((f) => f.id);
    expect(await byName('asc')).toEqual([firms.alpha.id, firms.bravo.id, firms.charlie.id]);
    expect(await byName('desc')).toEqual([firms.charlie.id, firms.bravo.id, firms.alpha.id]);
  });

  it('sorts by approval day, the never-approved last either way', async () => {
    const byApproval = async (order: string) =>
      names(
        ListFirmsResponse.parse(
          (await get(`/admin/firms?search=Tax%20${tag}&sort=approved&order=${order}&pageSize=100`))
            .body,
        ),
      ).map((f) => f.id);
    expect(await byApproval('asc')).toEqual([firms.bravo.id, firms.charlie.id, firms.alpha.id]);
    expect(await byApproval('desc')).toEqual([firms.charlie.id, firms.bravo.id, firms.alpha.id]);
    expect((await get('/admin/firms?sort=plan')).status).toBe(400);
  });
});
