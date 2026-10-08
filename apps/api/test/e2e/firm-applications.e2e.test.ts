// End-to-end: the Super Admin's read side of firm applications (R4 step 1 and T05): the list
// with filters and pages, counts, the review page with history and checks, firms, the dashboard.
// Applications are written the way the app writes them: submitted in platform scope, reviewed in
// admin scope (the database records the history).
import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, type Prisma, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import {
  AdminDashboard,
  FirmApplicationCounts,
  FirmApplicationRecord,
  FirmCounts,
  FirmRecord,
  ListFirmApplicationsResponse,
  ListFirmsResponse,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
let app: INestApplication;
let adminToken: string;

/** A word only this file's applications contain, so other tests' rows never disturb the lists. */
const tag = `r4e2e${randomUUID().slice(0, 8)}`;
const ids = {
  pending: randomUUID(),
  asked: randomUUID(),
  approved: randomUUID(),
  declined: randomUUID(),
};
const firm = { id: randomUUID(), slug: `${tag}-approved-tax` };

/**
 * Applications whose stored form isn't in the stored shape (`data` is plain JSON the database
 * doesn't check: an older row, or one fixed by hand), and readable ones with a website that isn't
 * an address or a free email address. A word of their own, so the lists above stay as they are.
 */
const odd = `r4odd${randomUUID().slice(0, 8)}`;
const oddIds = {
  empty: randomUUID(),
  // Shaped like LVP's seeded id (RFC 9562 since R0's #89).
  legacy: `00000000-0000-4005-8000-${randomBytes(6).toString('hex')}`,
  badWebsite: randomUUID(),
  freeMail: randomUUID(),
};
const oddFirm = { id: randomUUID(), slug: `${odd}-older-tax` };

/**
 * Names with a LIKE wildcard in them, and one a `_` would match if it were a wildcard: search and
 * the duplicate checks read `%` and `_` as plain characters. A word of their own as well.
 */
const wild = `r4wild${randomUUID().slice(0, 8)}`;
const wildIds = { percent: randomUUID(), underscore: randomUUID(), lookalike: randomUUID() };
const wildFirm = { id: randomUUID(), slug: `${wild}-percent-tax`, name: `Sample 100% Tax ${wild}` };

/** An admins-pool login without a platform_admins row (for example removed from the team). */
const adminPoolOnly = { id: randomUUID(), email: `r4-admin-pool-${randomUUID()}@firmivra.test` };

/**
 * The stored form (`data`), as submit writes it: the review page's groups, without any part of
 * the EIN (R0's #80 refuses a key starting with "ein" in it; the last 4 have their own column).
 */
const stored = (n: number, email: string) => ({
  business: {
    practiceType: 'TAX_ACCOUNTING',
    legalName: `Sample Tax ${tag} ${n}`,
    dbaName: null,
    entityType: 'LLC',
    email: null,
    phone: null,
    website: n === 1 ? 'https://sample.example.test' : null,
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
    fullName: `Jordan Sample ${n}`,
    email,
    phone: '+14045550101',
    title: null,
    preferredContact: 'EMAIL',
    alternatePhone: null,
  },
  account: {
    requestedPlan: 'PROFESSIONAL',
    teamSize: 3,
    clientVolume: 'FROM_250',
    heardFrom: null,
    requestedStartDate: null,
    additionalInfo: null,
  },
  credentials: [],
});

async function tokenFor(email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email })
    .expect(200);
  return (res.body as { token: string }).token;
}
const get = (path: string, token = adminToken) =>
  request(app.getHttpServer()).get(`/api/v1${path}`).set('authorization', `Bearer ${token}`);
const codeOf = (res: request.Response) => (res.body as { error?: { code?: string } }).error?.code;

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  const rows: [string, number, string][] = [
    [ids.pending, 1, 'jordan1@sample.example.test'],
    [ids.asked, 2, 'jordan2@mail.example.test'],
    [ids.approved, 3, 'jordan3@mail.example.test'],
    // Same email as the pending one: the DUPLICATE_EMAIL check warns on both.
    [ids.declined, 4, 'jordan1@sample.example.test'],
  ];
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [id, n, email] of rows) {
      const data = stored(n, email);
      await tx.firmApplication.create({
        data: {
          id,
          legalName: data.business.legalName,
          contactName: data.primaryAdmin.fullName,
          contactEmail: email,
          contactPhone: data.primaryAdmin.phone,
          data,
          // The EIN's last 4 and its keyed hash live in their own columns (R0's #80, set together),
          // never in `data`. A synthetic hash: these tests don't compute it.
          ...(id === ids.asked
            ? { einLast4: '6789', einHash: new Uint8Array(randomBytes(32)) }
            : {}),
        },
      });
    }
    await tx.business.create({
      data: { id: firm.id, slug: firm.slug, name: `Sample Tax ${tag} 3`, status: 'PENDING_SETUP' },
    });
  });
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    const older = (
      id: string,
      n: number,
      email: string,
      data: Prisma.InputJsonValue,
      contactPhone: string | null,
    ) =>
      tx.firmApplication.create({
        data: {
          id,
          legalName: `Sample Older ${odd} ${n}`,
          contactName: `Jordan Sample ${n}`,
          contactEmail: email,
          contactPhone,
          data,
        },
      });
    /** A readable stored form with this website. */
    const form = (n: number, email: string, website: string | null) => {
      const data = stored(n, email);
      const business = { ...data.business, legalName: `Sample Older ${odd} ${n}`, website };
      return { ...data, business };
    };
    // The same email on the first two: the duplicate checks still run, from the columns.
    const shared = `${odd}.older@older.example.test`;
    await older(oddIds.empty, 5, shared, {}, '+14045550105');
    // Like LVP's seeded application: an older shape and no phone column.
    await older(oddIds.legacy, 6, shared, { businessType: 'Tax and accounting firm' }, null);
    const site = `${odd}.site@older.example.test`;
    await older(oddIds.badWebsite, 7, site, form(7, site, 'not a website'), '+14045550107');
    const free = `${odd}@gmail.com`;
    await older(oddIds.freeMail, 8, free, form(8, free, null), '+14045550108');
    await tx.business.create({
      data: {
        id: oddFirm.id,
        slug: oddFirm.slug,
        name: `Sample Older ${odd} 6`,
        status: 'PENDING_SETUP',
      },
    });
  });
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    const wildRows: [string, number, string, string][] = [
      [wildIds.percent, 9, `Sample 100% Tax ${wild}`, `${wild}.percent@wild.example.test`],
      [wildIds.underscore, 10, `Sample Tax_Group ${wild}`, `jordan_${wild}@wild.example.test`],
      // What the `_` in the name and the email above would match as a wildcard.
      [wildIds.lookalike, 11, `Sample Tax-Group ${wild}`, `jordan-${wild}@wild.example.test`],
    ];
    for (const [id, n, legalName, email] of wildRows) {
      const data = stored(n, email);
      await tx.firmApplication.create({
        data: {
          id,
          legalName,
          contactName: data.primaryAdmin.fullName,
          contactEmail: email,
          contactPhone: data.primaryAdmin.phone,
          data: { ...data, business: { ...data.business, legalName } },
        },
      });
    }
    await tx.business.create({ data: { ...wildFirm, status: 'PENDING_SETUP' } });
    await tx.user.create({
      data: {
        id: adminPoolOnly.id,
        cognitoSub: adminPoolOnly.id,
        pool: 'ADMIN',
        email: adminPoolOnly.email,
        name: 'Fake R4 admins-pool login',
      },
    });
  });
  const asAdmin = { kind: 'admin', adminUserId: fx.users.admin.id } as const;
  const review = (id: string, data: Record<string, unknown>) =>
    runInScope(owner, asAdmin, (tx) =>
      tx.firmApplication.update({
        where: { id },
        data: { reviewedByUserId: fx.users.admin.id, reviewedAt: new Date(), ...data },
      }),
    );
  // Request Information keeps it pending and sets the message (the trigger writes history).
  await review(ids.asked, { decisionReason: 'Please send your PTIN.' });
  await review(ids.approved, { decisionReason: 'Please send your PTIN.' });
  await review(ids.approved, { status: 'APPROVED' });
  await review(ids.declined, { status: 'DECLINED', decisionReason: 'Not a tax practice.' });
  await review(oddIds.legacy, { status: 'APPROVED' });
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    await tx.firmApplication.update({ where: { id: ids.approved }, data: { businessId: firm.id } });
    await tx.firmApplication.update({
      where: { id: oddIds.legacy },
      data: { businessId: oddFirm.id },
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
  await nest.init();
  app = nest;
  adminToken = await tokenFor(fx.users.admin.email);
});

afterAll(async () => {
  await app.close();
});

describe('the contract', () => {
  it('every answer parses with the schema the web client uses', async () => {
    const checks = [
      ...[tag, odd, wild].map(
        (word) =>
          [`/admin/firm-applications?search=${word}`, ListFirmApplicationsResponse] as const,
      ),
      ['/admin/firm-applications/counts', FirmApplicationCounts],
      ...[...Object.values(ids), ...Object.values(oddIds), ...Object.values(wildIds)].map(
        (id) => [`/admin/firm-applications/${id}`, FirmApplicationRecord] as const,
      ),
      ...[tag, odd, wild].map(
        (word) => [`/admin/firms?search=${word}`, ListFirmsResponse] as const,
      ),
      ['/admin/firms/counts', FirmCounts],
      ...[firm.id, oddFirm.id, wildFirm.id].map(
        (id) => [`/admin/firms/${id}`, FirmRecord] as const,
      ),
      ['/admin/dashboard', AdminDashboard],
    ] as const;
    for (const [path, schema] of checks) {
      const res = await get(path).expect(200);
      expect(schema.safeParse(res.body).error?.issues ?? [], path).toEqual([]);
    }
  });
});

describe('who may read', () => {
  it('answers Super Admins only: firm and client sessions get 401 on admin routes', async () => {
    for (const email of [fx.users.ownerA.email, fx.users.clientA.email]) {
      const token = await tokenFor(email);
      for (const path of ['/admin/firm-applications', '/admin/firms', '/admin/dashboard']) {
        expect((await get(path, token)).status).toBe(401);
      }
    }
    expect((await request(app.getHttpServer()).get('/api/v1/admin/firm-applications')).status).toBe(
      401,
    );
  });

  it('answers 403 to an admins-pool login without a platform_admins row, and opens nothing', async () => {
    const token = await tokenFor(adminPoolOnly.email);
    for (const path of [
      '/admin/firm-applications',
      '/admin/firm-applications/counts',
      `/admin/firm-applications/${ids.pending}`,
      '/admin/firms',
      '/admin/firms/counts',
      `/admin/firms/${firm.id}`,
      '/admin/dashboard',
    ]) {
      const res = await get(path, token);
      expect([res.status, codeOf(res)], path).toEqual([403, 'FORBIDDEN']);
    }
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    try {
      const opened = await runInScope(owner, { kind: 'platform' }, (tx) =>
        tx.auditLog.count({
          where: {
            actorUserId: adminPoolOnly.id,
            action: { in: ['firm_application.viewed', 'business.viewed_by_admin'] },
          },
        }),
      );
      expect(opened).toBe(0);
    } finally {
      await owner.$disconnect();
    }
  });
});

describe('GET /admin/firm-applications', () => {
  it('lists newest first, with the stored form flattened into each row', async () => {
    const res = await get(`/admin/firm-applications?search=${tag}`).expect(200);
    const body = res.body as ListFirmApplicationsResponse;
    expect(body.total).toBe(4);
    expect(body.items.map((i) => i.id)).toEqual([
      ids.declined,
      ids.approved,
      ids.asked,
      ids.pending,
    ]);
    const pending = body.items.find((i) => i.id === ids.pending)!;
    expect(pending).toMatchObject({
      status: 'PENDING_REVIEW',
      formReadable: true,
      practiceType: 'TAX_ACCOUNTING',
      services: ['TAX_PREPARATION'],
      requestedPlan: 'PROFESSIONAL',
      contactEmail: 'jordan1@sample.example.test',
      decidedAt: null,
    });
    expect(body.items.find((i) => i.id === ids.approved)?.decidedAt).not.toBeNull();
  });

  it('filters by status (an information request stays pending), and pages', async () => {
    const pending = (await get(`/admin/firm-applications?search=${tag}&status=PENDING_REVIEW`))
      .body as ListFirmApplicationsResponse;
    expect(pending.items.map((i) => i.id).sort()).toEqual([ids.asked, ids.pending].sort());
    const page2 = (
      await get(`/admin/firm-applications?search=${tag}&order=oldest&page=2&pageSize=3`)
    ).body as ListFirmApplicationsResponse;
    expect([page2.total, page2.items.map((i) => i.id)]).toEqual([4, [ids.declined]]);
    const none = (await get(`/admin/firm-applications?search=${tag}&to=2000-01-01T00:00:00Z`))
      .body as ListFirmApplicationsResponse;
    expect(none.total).toBe(0);
  });

  it('refuses bad filters with 400', async () => {
    for (const q of [
      'status=INFO_REQUESTED',
      'pageSize=500',
      'businessId=x',
      'from=2026-10-07T00:00:00Z&to=2026-10-01T00:00:00Z',
    ]) {
      expect((await get(`/admin/firm-applications?${q}`)).status).toBe(400);
    }
  });

  it('counts every status (this file adds two pending, one approved, one declined)', async () => {
    const c = (await get('/admin/firm-applications/counts').expect(200))
      .body as FirmApplicationCounts;
    expect(c.pendingReview).toBeGreaterThanOrEqual(2);
    expect(c.approvedThisMonth).toBeGreaterThanOrEqual(1);
    expect(c.declinedThisMonth).toBeGreaterThanOrEqual(1);
    expect(c.all).toBe(c.pendingReview + c.approved + c.declined);
  });
});

describe('GET /admin/firm-applications/{id}', () => {
  it('shows the review page: history newest first, checks, the suggested address', async () => {
    const res = await get(`/admin/firm-applications/${ids.asked}`).expect(200);
    const a = res.body as FirmApplicationRecord;
    expect(a.status).toBe('PENDING_REVIEW');
    expect(a.formReadable).toBe(true);
    // From the ein_last4 column only, never from the stored form.
    expect(a.business?.einLast4).toBe('6789');
    expect(JSON.stringify(a)).not.toMatch(/"ein"/);
    expect(a.history.map((h) => [h.type, h.message, h.by?.userId ?? null])).toEqual([
      ['INFO_REQUESTED', 'Please send your PTIN.', fx.users.admin.id],
      ['SUBMITTED', null, null],
    ]);
    expect(a.decision).toBeNull();
    expect(a.suggestedSlug).toBe(`sample-tax-${tag}-2`);
    expect(a.documents).toEqual([]);
  });

  it('gives the decline reason, but no reason for an approval (only its history)', async () => {
    const declined = (await get(`/admin/firm-applications/${ids.declined}`))
      .body as FirmApplicationRecord;
    expect(declined.decision).toMatchObject({
      reason: 'Not a tax practice.',
      by: { userId: fx.users.admin.id },
    });
    expect(declined.checks.find((c) => c.key === 'DUPLICATE_EMAIL')?.result).toBe('WARN');
    expect(declined.suggestedSlug).toBeNull();

    const approved = (await get(`/admin/firm-applications/${ids.approved}`))
      .body as FirmApplicationRecord;
    expect(approved.decision?.reason).toBeNull();
    expect(approved.firm).toEqual({
      id: firm.id,
      slug: firm.slug,
      name: `Sample Tax ${tag} 3`,
      status: 'PENDING_SETUP',
    });
    expect(approved.history.map((h) => h.type)).toEqual([
      'APPROVED',
      'INFO_REQUESTED',
      'SUBMITTED',
    ]);
  });

  it('runs the checks: the email domain against the website, duplicates', async () => {
    const a = (await get(`/admin/firm-applications/${ids.pending}`)).body as FirmApplicationRecord;
    // No EIN on this one: no last 4.
    expect(a.business?.einLast4).toBeNull();
    expect(Object.fromEntries(a.checks.map((c) => [c.key, c.result]))).toEqual({
      DUPLICATE_EIN: 'SKIPPED',
      DUPLICATE_NAME: 'PASS',
      DUPLICATE_EMAIL: 'WARN',
      EMAIL_DOMAIN: 'PASS',
    });
  });

  it('audits who opened it, with ids only', async () => {
    await get(`/admin/firm-applications/${ids.pending}`).expect(200);
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    try {
      const rows = await runInScope(owner, { kind: 'platform' }, (tx) =>
        tx.auditLog.findMany({
          where: { action: 'firm_application.viewed', entityId: ids.pending },
        }),
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]).toMatchObject({
        businessId: null,
        actorUserId: fx.users.admin.id,
        metadata: null,
      });
    } finally {
      await owner.$disconnect();
    }
  });

  it('answers 404 for an unknown id and 400 for a bad one', async () => {
    expect((await get(`/admin/firm-applications/${randomUUID()}`)).status).toBe(404);
    expect((await get('/admin/firm-applications/not-an-id')).status).toBe(400);
  });
});

describe('GET /admin/firms and /admin/dashboard', () => {
  it('lists firms with the owner from the application until the owner joins', async () => {
    const res = await get(`/admin/firms?search=${tag}`).expect(200);
    const body = res.body as ListFirmsResponse;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: firm.id,
      status: 'PENDING_SETUP',
      owner: { name: 'Jordan Sample 3', email: 'jordan3@mail.example.test' },
      plan: 'PROFESSIONAL',
    });
    expect(body.items[0]?.approvedAt).not.toBeNull();
  });

  it('filters by status: INACTIVE is suspended or closed', async () => {
    const inactive = (await get('/admin/firms?status=INACTIVE&pageSize=100'))
      .body as ListFirmsResponse;
    expect(inactive.items.map((f) => f.id)).toContain(fx.suspended.id);
    expect(inactive.items.every((f) => f.status === 'SUSPENDED' || f.status === 'CLOSED')).toBe(
      true,
    );
  });

  it('opens a firm with its application, and counts firms', async () => {
    const f = (await get(`/admin/firms/${firm.id}`).expect(200)).body as FirmRecord;
    expect(f.application?.id).toBe(ids.approved);
    const plain = (await get(`/admin/firms/${fx.firmA.id}`).expect(200)).body as FirmRecord;
    expect(plain.application).toBeNull();
    expect((await get(`/admin/firms/${randomUUID()}`)).status).toBe(404);
    const counts = (await get('/admin/firms/counts').expect(200)).body as Record<string, number>;
    expect(counts.total).toBe(counts.active! + counts.pendingSetup! + counts.inactive!);
  });

  it('gives the dashboard counts it can read (user counts wait for R0)', async () => {
    const d = (await get('/admin/dashboard').expect(200)).body as AdminDashboard;
    expect(d.pendingApplications).toBeGreaterThanOrEqual(2);
    expect(d.activeFirms).toBeGreaterThanOrEqual(2);
    expect([d.totalUsers, d.newUsersThisWeek, d.monthlyRevenueCents]).toEqual([null, null, null]);
  });
});

describe('an application whose stored form cannot be read', () => {
  const list = async (query = '') =>
    (await get(`/admin/firm-applications?search=${odd}${query}`).expect(200))
      .body as ListFirmApplicationsResponse;

  it("lists it from the table's own columns, and filters it by status like any other", async () => {
    const body = await list();
    expect(body.total).toBe(4);
    expect(body.items.find((i) => i.id === oddIds.legacy)).toEqual({
      id: oddIds.legacy,
      status: 'APPROVED',
      legalName: `Sample Older ${odd} 6`,
      dbaName: null,
      formReadable: false,
      practiceType: null,
      entityType: null,
      services: [],
      requestedPlan: null,
      contactName: 'Jordan Sample 6',
      contactEmail: `${odd}.older@older.example.test`,
      contactPhone: null,
      submittedAt: expect.any(String) as string,
      decidedAt: expect.any(String) as string,
    });
    const unreadable = body.items.filter((i) => !i.formReadable).map((i) => i.id);
    expect(unreadable.sort()).toEqual([oddIds.empty, oddIds.legacy].sort());
    expect((await list('&status=APPROVED')).items.map((i) => i.id)).toEqual([oddIds.legacy]);
    expect((await list('&status=PENDING_REVIEW')).items.map((i) => i.id).sort()).toEqual(
      [oddIds.empty, oddIds.badWebsite, oddIds.freeMail].sort(),
    );
  });

  it('opens its review page: the columns, no form groups, and the checks from the columns', async () => {
    for (const id of [oddIds.empty, oddIds.legacy]) {
      const a = (await get(`/admin/firm-applications/${id}`).expect(200))
        .body as FirmApplicationRecord;
      expect(a).toMatchObject({
        formReadable: false,
        business: null,
        primaryAdmin: null,
        account: null,
        credentials: [],
        contactEmail: `${odd}.older@older.example.test`,
      });
      expect(Object.fromEntries(a.checks.map((c) => [c.key, c.result]))).toEqual({
        DUPLICATE_EIN: 'SKIPPED',
        DUPLICATE_NAME: 'PASS',
        DUPLICATE_EMAIL: 'WARN',
        EMAIL_DOMAIN: 'SKIPPED',
      });
    }
    const legacy = (await get(`/admin/firm-applications/${oddIds.legacy}`))
      .body as FirmApplicationRecord;
    expect(legacy).toMatchObject({
      status: 'APPROVED',
      legalName: `Sample Older ${odd} 6`,
      contactName: 'Jordan Sample 6',
      contactPhone: null,
      firm: { id: oddFirm.id },
    });
  });

  it('opens the firm it belongs to, without the owner and plan only the form has', async () => {
    const f = (await get(`/admin/firms/${oddFirm.id}`).expect(200)).body as FirmRecord;
    expect(f).toMatchObject({
      owner: null,
      plan: null,
      application: { id: oddIds.legacy, formReadable: false, business: null },
    });
    const firms = (await get(`/admin/firms?search=${odd}`).expect(200)).body as ListFirmsResponse;
    expect(firms.items.map((i) => [i.id, i.owner, i.plan])).toEqual([[oddFirm.id, null, null]]);
  });

  it("lists and opens it by an id like the seed's, which the web client's schemas take", async () => {
    const approved = ListFirmApplicationsResponse.parse(await list('&status=APPROVED'));
    expect(approved.items.map((i) => i.id)).toEqual([oddIds.legacy]);
    const a = await get(`/admin/firm-applications/${oddIds.legacy}`).expect(200);
    expect(FirmApplicationRecord.parse(a.body).id).toBe(oddIds.legacy);
    const f = await get(`/admin/firms/${oddFirm.id}`).expect(200);
    expect(FirmRecord.parse(f.body).application?.id).toBe(oddIds.legacy);
  });
});

describe('the EMAIL_DOMAIN check', () => {
  const open = async (id: string) =>
    (await get(`/admin/firm-applications/${id}`).expect(200)).body as FirmApplicationRecord;
  const emailDomain = (a: FirmApplicationRecord) => a.checks.find((c) => c.key === 'EMAIL_DOMAIN');

  it('warns on a free email address, also without a website', async () => {
    const a = await open(oddIds.freeMail);
    expect([a.formReadable, a.business?.website]).toEqual([true, null]);
    expect(emailDomain(a)).toEqual({
      key: 'EMAIL_DOMAIN',
      result: 'WARN',
      note: 'A free email address',
    });
  });

  it('skips a stored website that is not an address, instead of failing the page', async () => {
    const a = await open(oddIds.badWebsite);
    expect([a.formReadable, a.business?.website]).toEqual([true, 'not a website']);
    expect(emailDomain(a)).toEqual({
      key: 'EMAIL_DOMAIN',
      result: 'SKIPPED',
      note: "The website isn't a valid address",
    });
  });
});

describe('% and _ in a search or a compared name are plain characters', () => {
  const applications = async (term: string) =>
    (
      (await get(`/admin/firm-applications?search=${encodeURIComponent(term)}&pageSize=100`))
        .body as ListFirmApplicationsResponse
    ).items;

  it('the applications search: % or _ matches only applications that contain it', async () => {
    const withChar = { '%': wildIds.percent, _: wildIds.underscore };
    for (const [char, id] of Object.entries(withChar)) {
      const items = await applications(char);
      const found = items.map((i) => i.id);
      expect(found, char).toContain(id);
      const without = items
        .filter(
          (i) =>
            ![i.legalName, i.dbaName, i.contactName, i.contactEmail].some((v) => v?.includes(char)),
        )
        .map((i) => i.legalName);
      expect(without, char).toEqual([]);
    }
    // As a wildcard, the _ would match the lookalike's "-" as well.
    expect((await applications(`Tax_Group ${wild}`)).map((i) => i.id)).toEqual([
      wildIds.underscore,
    ]);
  });

  it('the firms search (in memory): % matches only firms that contain it', async () => {
    const { items } = (await get(`/admin/firms?search=${encodeURIComponent('%')}&pageSize=100`))
      .body as ListFirmsResponse;
    expect(items.map((f) => f.id)).toContain(wildFirm.id);
    const without = items.filter(
      (f) => ![f.name, f.owner?.name, f.owner?.email].some((v) => v?.includes('%')),
    );
    expect(without.map((f) => f.name)).toEqual([]);
  });

  it('the duplicate checks: a _ in the name or the email matches only a _', async () => {
    const a = (await get(`/admin/firm-applications/${wildIds.underscore}`).expect(200))
      .body as FirmApplicationRecord;
    expect(Object.fromEntries(a.checks.map((c) => [c.key, c.result]))).toMatchObject({
      DUPLICATE_NAME: 'PASS',
      DUPLICATE_EMAIL: 'PASS',
    });
  });
});
