// End-to-end: R55, Client Portal Review One, advisory in the portal. BA-CP: the client's own
// read-only Business Advisory under My Services (only what the firm marked for the client: plans
// delivered, recommendations shown, tasks not hidden, resources sent, advisory files shared).
// The client is the session's login, never the URL: another client's or another firm's plan is
// 404. Views are audited. B10: the firm sends a plan in staff review for the client's approval;
// the client approves exactly that version in the portal, which finalizes it; Modify Plan
// withdraws a request or clears an approval. B28: a resource goes by portal or email as a Secure
// Link or a PDF, with a preview and the eligibility checks; the client downloads a PDF one.
// Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, type Prisma, runInScope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  AdvisoryPlanDetail,
  AdvisoryResourceList,
  AdvisoryResourcePreview,
  AdvisoryVersionList,
  MyAdvisory,
  MyAdvisoryPlan,
  MyAdvisoryResourcePdf,
  OkResponse,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { storedType } from '../../src/notifications/notification-text.js';
import { REPORT_FILES, type ReportFiles } from '../../src/reports/report-files.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55ap-${key}-${run}@r55.test` });
const staff = { ownerA: person('owner-a'), adminA: person('admin-a'), ownerB: person('owner-b') };
const logins = {
  /** Client c1's own (PRIMARY) login. */
  x: person('login-x'),
  /** An AUTHORIZED login of c1: sees no advisory. */
  xAuthorized: person('login-x-auth'),
  /** Client c2's login, in the program too. */
  y: person('login-y'),
  /** Client c4's login: not in the program. */
  z: person('login-z'),
  /** Firm B's client. */
  b: person('login-b'),
};
type Who = { email: string };
const firms = {} as Record<'a' | 'b', { id: string; slug: string }>;
const clients = {} as Record<'c1' | 'c2' | 'c3' | 'c4' | 'cB', string>;
const advisory = {} as Record<'a1' | 'a2' | 'aB', string>;
const plans = {} as Record<
  'delivered' | 'draft' | 'finalized' | 'archived' | 'revision' | 'other' | 'firmB',
  string
>;
const docs = {} as Record<'shared' | 'internal' | 'books' | 'trashed', string>;

let app: INestApplication;
/** B28: the report file store, in memory: what was put, by key. */
const stored = new Map<string, { bytes: Uint8Array; contentType: string }>();
const files: ReportFiles = {
  put: (key, bytes, contentType) => {
    stored.set(key, { bytes, contentType });
    return Promise.resolve();
  },
  presignDownload: ({ key }) => Promise.resolve(`https://files.test/${key}?signed=1`),
  remove: (key) => {
    stored.delete(key);
    return Promise.resolve();
  },
};
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.61.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

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
const inFirm = <T>(firm: 'a' | 'b', work: Parameters<typeof runInScope<T>>[2]) =>
  asOwner({ kind: 'business', businessId: firms[firm].id }, work);

async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .set('x-forwarded-for', viewer())
    .send({ email })
    .expect(200);
  const token = (res.body as { token: string }).token;
  tokens.set(email, token);
  return token;
}

/** A portal route of the signed-in client: `/api/v1/portal/{slug}/me/advisory{path}`. */
async function portal(
  method: 'get' | 'post',
  path: string,
  who: Who,
  body?: object,
  firm: 'a' | 'b' = 'a',
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/portal/${firms[firm].slug}/me/advisory${path}`)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`)
    .set('x-forwarded-for', viewer());
  return body === undefined ? req : req.send(body);
}
/** A firm route: `/api/v1/business/advisory{path}`. */
async function firm(
  method: 'get' | 'post' | 'patch',
  path: string,
  who: Who,
  body?: object,
  f: 'a' | 'b' = 'a',
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business/advisory${path}`)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`)
    .set('x-business-id', firms[f].id)
    .set('x-forwarded-for', viewer());
  return body === undefined ? req : req.send(body);
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};
const DAY = 86_400_000;
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const auditOf = (action: string, entityId: string) =>
  inFirm('a', (tx) =>
    tx.auditLog.findMany({
      where: { action, entityId },
      select: { actorUserId: true, metadata: true },
      orderBy: { createdAt: 'asc' },
    }),
  );

/** What a finalized version keeps (advisory-plans.service.ts `Content`). */
const content = (name: string) => ({
  planName: name,
  targetYear: 2026,
  profile: { businessName: 'Sample Bakery (fake)', notes: 'Internal profile note (fake)' },
  assessment: { strengths: ['Internal strength (fake)'] },
  strategy: {
    summary: 'Open a second shop (fake).',
    areas: [
      { area: 'EXPANSION', objective: 'A second shop (fake)', notes: 'Internal area note (fake)' },
    ],
  },
  goals: [
    { title: 'Sign a lease (fake)', area: 'EXPANSION', targetDate: day(120), status: 'PLANNING' },
  ],
  recommendations: [
    {
      title: 'Shown recommendation (fake)',
      rationale: 'Spreads the cost (fake).',
      impactLabel: '+10% Revenue',
      status: 'PROPOSED',
      clientVisible: true,
    },
    {
      title: 'Hidden recommendation (fake)',
      rationale: null,
      impactLabel: null,
      status: 'PROPOSED',
      clientVisible: false,
    },
  ],
  workstreams: [
    { serviceName: 'Business Planning (fake)', status: 'IN_PROGRESS', role: 'PRIMARY' },
    { serviceName: 'Declined service (fake)', status: 'DECLINED', role: 'ADDITIONAL' },
  ],
  financials: [{ revenueCents: 123_456_789 }],
  disclaimer: 'Recommendations are advisory tools, not guarantees (fake).',
});

/** A plan of an advisory client, with its versions (`delivered` sets the delivery facts). */
async function makePlan(
  tx: TxClient,
  input: {
    businessId: string;
    advisoryClientId: string;
    name: string;
    status: 'DRAFT' | 'IN_REVIEW' | 'FINALIZED' | 'SENT' | 'IN_PROGRESS';
    versions: { delivered: boolean }[];
    archived?: boolean;
    createdBy: string;
  },
): Promise<string> {
  const plan = await tx.advisoryPlan.create({
    data: {
      businessId: input.businessId,
      advisoryClientId: input.advisoryClientId,
      name: input.name,
      targetYear: 2026,
      status: input.archived ? 'ARCHIVED' : input.status,
      currentVersion: input.versions.length,
      finalizedAt: input.versions.length ? new Date() : null,
      sentAt: input.versions.some((v) => v.delivered) ? new Date() : null,
      archivedAt: input.archived ? new Date() : null,
      createdByUserId: input.createdBy,
    },
    select: { id: true },
  });
  for (const [i, v] of input.versions.entries()) {
    await tx.advisoryPlanVersion.create({
      data: {
        businessId: input.businessId,
        planId: plan.id,
        versionNo: i + 1,
        content: content(input.name),
        createdByUserId: input.createdBy,
        ...(v.delivered
          ? {
              deliveredAt: new Date(Date.now() - (input.versions.length - i) * 60_000),
              deliveredChannel: 'portal',
              deliveredByUserId: input.createdBy,
            }
          : {}),
      },
    });
  }
  return plan.id;
}

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(staff)) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    }
    for (const [key, p] of Object.entries(logins)) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'CLIENT', email: p.email, name: `Fake ${key}` },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r55ap-${key}-${run}`;
      const row = await tx.business.create({
        data: { slug, name: `Firm ${slug}`, status: 'ACTIVE' },
        select: { id: true },
      });
      firms[key] = { id: row.id, slug };
    }
  });
  for (const [f, userId, role] of [
    ['a', staff.ownerA.id, 'OWNER'],
    ['a', staff.adminA.id, 'ADMIN'],
    ['b', staff.ownerB.id, 'OWNER'],
  ] as const) {
    await inFirm(f, (tx) =>
      tx.membership.create({
        data: { businessId: firms[f].id, userId, role, status: 'ACTIVE' },
      }),
    );
  }
  const login = (
    tx: TxClient,
    businessId: string,
    who: { id: string; email: string },
    clientId: string,
    portalRole: 'PRIMARY' | 'AUTHORIZED' = 'PRIMARY',
  ) =>
    tx.clientAccount.create({
      data: {
        businessId,
        userId: who.id,
        clientId,
        email: who.email,
        portalRole,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        phoneVerifiedAt: new Date(),
      },
    });
  await inFirm('a', async (tx) => {
    const businessId = firms.a.id;
    const client = async (key: 'c1' | 'c2' | 'c3' | 'c4', name: string) => {
      clients[key] = (
        await tx.client.create({
          data: { businessId, displayName: name, email: `${key}-${run}@client.test` },
          select: { id: true },
        })
      ).id;
    };
    await client('c1', 'Jamie Sample (fake)');
    await client('c2', 'Riley Example (fake)');
    await client('c3', 'Casey No Login (fake)');
    await client('c4', 'Nora Not Advisory (fake)');
    await login(tx, businessId, logins.x, clients.c1);
    await login(tx, businessId, logins.xAuthorized, clients.c1, 'AUTHORIZED');
    await login(tx, businessId, logins.y, clients.c2);
    await login(tx, businessId, logins.z, clients.c4);
    await tx.clientProfile.create({
      data: { clientId: clients.c1, businessId, businessName: 'Sample Bakery (fake)' },
    });
    const service = (name: string, kind: 'BUSINESS_DEVELOPMENT' | 'BOOKKEEPING') =>
      tx.service.create({
        data: { businessId, kind, name: `${name} ${run}`, status: 'ACTIVE' },
        select: { id: true },
      });
    const s1 = await service('Business Planning', 'BUSINESS_DEVELOPMENT');
    const s2 = await service('Funding Readiness', 'BUSINESS_DEVELOPMENT');
    const books = await service('Bookkeeping', 'BOOKKEEPING');
    const e1 = await tx.engagement.create({
      data: { businessId, clientId: clients.c1, serviceId: s1.id, title: 'Advisory (fake)' },
    });
    const eBooks = await tx.engagement.create({
      data: { businessId, clientId: clients.c1, serviceId: books.id, title: 'Books (fake)' },
    });
    const a = async (
      key: 'a1' | 'a2',
      clientId: string,
      over: Partial<Prisma.AdvisoryClientUncheckedCreateInput> = {},
    ) => {
      advisory[key] = (
        await tx.advisoryClient.create({
          data: { businessId, clientId, ...over },
          select: { id: true },
        })
      ).id;
      await tx.advisoryWorkstream.create({
        data: {
          businessId,
          advisoryClientId: advisory[key],
          serviceId: s1.id,
          role: 'PRIMARY',
          status: 'IN_PROGRESS',
        },
      });
    };
    await a('a1', clients.c1, { advisorUserId: staff.adminA.id, engagementId: e1.id });
    await a('a2', clients.c2);
    await tx.advisoryWorkstream.create({
      data: {
        businessId,
        advisoryClientId: advisory.a1,
        serviceId: s2.id,
        role: 'ADDITIONAL',
        status: 'DECLINED',
      },
    });
    const by = staff.ownerA.id;
    const base = { businessId, advisoryClientId: advisory.a1, createdBy: by };
    plans.delivered = await makePlan(tx, {
      ...base,
      name: `Delivered plan ${run}`,
      status: 'SENT',
      versions: [{ delivered: true }, { delivered: false }],
    });
    plans.draft = await makePlan(tx, {
      ...base,
      name: `Draft plan ${run}`,
      status: 'DRAFT',
      versions: [],
    });
    plans.finalized = await makePlan(tx, {
      ...base,
      name: `Finalized plan ${run}`,
      status: 'FINALIZED',
      versions: [{ delivered: false }],
    });
    plans.archived = await makePlan(tx, {
      ...base,
      name: `Archived plan ${run}`,
      status: 'SENT',
      versions: [{ delivered: true }],
      archived: true,
    });
    plans.revision = await makePlan(tx, {
      ...base,
      name: `Revision plan ${run}`,
      status: 'DRAFT',
      versions: [{ delivered: true }],
    });
    plans.other = await makePlan(tx, {
      ...base,
      advisoryClientId: advisory.a2,
      name: `Other client plan ${run}`,
      status: 'SENT',
      versions: [{ delivered: true }],
    });
    const rec = (title: string, clientVisible: boolean) =>
      tx.advisoryRecommendation.create({
        data: {
          businessId,
          advisoryClientId: advisory.a1,
          title,
          rationale: `${title} why`,
          impactLabel: '+5% Profit',
          clientVisible,
          createdByUserId: by,
        },
      });
    await rec('Visible recommendation (fake)', true);
    await rec('Hidden recommendation (fake)', false);
    const task = (title: string, clientVisible: boolean, over: object = {}) =>
      tx.advisoryActionItem.create({
        data: {
          businessId,
          advisoryClientId: advisory.a1,
          title,
          clientVisible,
          assigneeKind: 'TEAM',
          createdByUserId: by,
          ...over,
        },
      });
    await task('Your overdue step (fake)', true, {
      assigneeKind: 'CLIENT',
      dueOn: new Date(`${day(-10)}T00:00:00Z`),
      details: 'Three quotes (fake).',
    });
    await task('Firm step (fake)', true, { assigneeKind: 'TEAM' });
    await task('Cancelled step (fake)', true, { status: 'CANCELLED' });
    await task('Hidden step (fake)', false);
    const doc = async (
      engagementId: string,
      direction: 'FIRM_TO_CLIENT' | 'INTERNAL',
      fileName: string,
      over: object = {},
    ) => {
      const tag = randomUUID();
      return (
        await tx.document.create({
          data: {
            businessId,
            clientId: clients.c1,
            engagementId,
            direction,
            fileName,
            contentType: 'application/pdf',
            sizeBytes: 100,
            sha256: tag.replace(/-/g, '').padEnd(64, '0'),
            s3Key: `tenant/${businessId}/e2e/${tag}.pdf`,
            ...over,
          },
          select: { id: true },
        })
      ).id;
    };
    docs.shared = await doc(e1.id, 'FIRM_TO_CLIENT', 'Advisory budget (fake).pdf');
    docs.internal = await doc(e1.id, 'INTERNAL', 'Internal memo (fake).pdf');
    docs.books = await doc(eBooks.id, 'FIRM_TO_CLIENT', 'Ledger (fake).pdf');
    docs.trashed = await doc(e1.id, 'FIRM_TO_CLIENT', 'Trashed (fake).pdf', {
      trashedAt: new Date(),
    });
    // B10: current figures, so a plan of c1's is ready to go for approval.
    await tx.advisoryFinancialSnapshot.create({
      data: {
        businessId,
        advisoryClientId: advisory.a1,
        periodStart: new Date('2025-01-01T00:00:00Z'),
        periodEnd: new Date('2025-12-31T00:00:00Z'),
        revenueCents: 1_234_567,
        asOf: new Date(`${day(-5)}T00:00:00Z`),
        createdByUserId: by,
      },
    });
  });
  await inFirm('b', async (tx) => {
    const businessId = firms.b.id;
    clients.cB = (
      await tx.client.create({
        data: { businessId, displayName: 'Firm B Client (fake)' },
        select: { id: true },
      })
    ).id;
    await login(tx, businessId, logins.b, clients.cB);
    advisory.aB = (
      await tx.advisoryClient.create({
        data: { businessId, clientId: clients.cB },
        select: { id: true },
      })
    ).id;
    plans.firmB = await makePlan(tx, {
      businessId,
      advisoryClientId: advisory.aB,
      name: `Firm B plan ${run}`,
      status: 'SENT',
      versions: [{ delivered: true }],
      createdBy: staff.ownerB.id,
    });
  });

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(REPORT_FILES)
    .useValue(files)
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;

  // A resource the firm sent c1 through the library (its audit row is what the portal lists).
  OkResponse.parse(
    ok(
      await firm('post', '/resources/funding-readiness-checklist/send', staff.ownerA, {
        advisoryClientId: advisory.a1,
        channel: 'PORTAL_MESSAGE',
      }),
    ),
  );
});

afterAll(async () => {
  await app?.close();
});

describe("BA-CP: the client's Business Advisory in the portal", () => {
  it('shows the client only what the firm marked for them, and audits the view', async () => {
    const res = await portal('get', '', logins.x);
    const mine = MyAdvisory.parse(ok(res));
    expect(mine).toMatchObject({
      enrolled: true,
      businessName: 'Sample Bakery (fake)',
      advisor: 'Fake adminA',
    });
    // A declined service never shows.
    expect(mine.services).toEqual([{ name: `Business Planning ${run}`, status: 'IN_PROGRESS' }]);
    // Delivered plans only (never a draft, a version never delivered, or an archived plan), each
    // at its newest delivered version; a revision in staff hands still shows what was delivered.
    expect(mine.plans.map((p) => [p.id, p.version, p.state]).sort()).toEqual(
      [
        [plans.delivered, 1, 'DELIVERED'],
        [plans.revision, 1, 'IN_PREPARATION'],
      ].sort(),
    );
    expect(mine.recommendations.map((r) => r.title)).toEqual(['Visible recommendation (fake)']);
    expect(mine.recommendations[0]).toMatchObject({
      rationale: 'Visible recommendation (fake) why',
      impactLabel: '+5% Profit',
    });
    expect(mine.tasks.map((t) => [t.title, t.forYou, t.overdue])).toEqual([
      ['Your overdue step (fake)', true, true],
      ['Firm step (fake)', false, false],
    ]);
    expect(mine.tasks[0]?.details).toBe('Three quotes (fake).');
    expect(mine.resources.map((r) => [r.key, r.title])).toEqual([
      ['funding-readiness-checklist', 'Funding Readiness Checklist'],
    ]);
    // Only the advisory engagement's live shared files: never an internal, trashed or other one.
    expect(mine.files.map((f) => f.id)).toEqual([docs.shared]);
    const raw = JSON.stringify(res.body);
    for (const word of [
      'Hidden',
      'Internal',
      'Cancelled step',
      'Ledger',
      'healthScore',
      'revenueCents',
      'note',
    ]) {
      expect(raw).not.toContain(word);
    }
    expect(Object.keys(res.body as object).sort()).toEqual(Object.keys(mine).sort());

    const audited = await auditOf('advisory_client.viewed', advisory.a1);
    expect(audited.at(-1)).toEqual({
      actorUserId: logins.x.id,
      metadata: { advisoryClientId: advisory.a1, by: 'CLIENT' },
    });
  });

  it('opens a delivered plan read-only at the version delivered, without the firm’s notes or hidden items', async () => {
    const res = await portal('get', `/plans/${plans.delivered}`, logins.x);
    const plan = MyAdvisoryPlan.parse(ok(res));
    expect(plan).toMatchObject({
      id: plans.delivered,
      name: `Delivered plan ${run}`,
      version: 1,
      state: 'DELIVERED',
      businessName: 'Sample Bakery (fake)',
      summary: 'Open a second shop (fake).',
      focusAreas: [{ area: 'EXPANSION', objective: 'A second shop (fake)' }],
      goals: [{ title: 'Sign a lease (fake)', status: 'PLANNING' }],
      recommendations: [{ title: 'Shown recommendation (fake)', impactLabel: '+10% Revenue' }],
      services: [{ name: 'Business Planning (fake)', status: 'IN_PROGRESS' }],
    });
    const raw = JSON.stringify(res.body);
    for (const word of ['Internal', 'Hidden', 'Declined', '123456789', 'clientVisible', 'notes']) {
      expect(raw).not.toContain(word);
    }
    expect(Object.keys(res.body as object).sort()).toEqual(Object.keys(plan).sort());
    // A revision in staff hands still opens the version delivered.
    expect(
      MyAdvisoryPlan.parse(ok(await portal('get', `/plans/${plans.revision}`, logins.x))),
    ).toMatchObject({ version: 1, state: 'IN_PREPARATION' });
    // Never a draft, a version never delivered, or an archived plan.
    for (const id of [plans.draft, plans.finalized, plans.archived]) {
      expectError(await portal('get', `/plans/${id}`, logins.x), 404, 'NOT_FOUND');
    }
    expect((await auditOf('advisory_plan.viewed', plans.delivered)).at(-1)).toEqual({
      actorUserId: logins.x.id,
      metadata: { advisoryClientId: advisory.a1, version: 1, by: 'CLIENT' },
    });
  });

  it('is 404 for another client’s or another firm’s plan, and empty for anyone not in the program', async () => {
    // Client Y sees their own plan only, never X's.
    const y = MyAdvisory.parse(ok(await portal('get', '', logins.y)));
    expect(y.plans.map((p) => p.id)).toEqual([plans.other]);
    expect(y.recommendations).toEqual([]);
    expectError(await portal('get', `/plans/${plans.delivered}`, logins.y), 404, 'NOT_FOUND');
    expectError(await portal('get', `/plans/${plans.other}`, logins.x), 404, 'NOT_FOUND');
    // An AUTHORIZED login of X's household sees nothing; a client outside the program neither.
    for (const who of [logins.xAuthorized, logins.z]) {
      const none = MyAdvisory.parse(ok(await portal('get', '', who)));
      expect(none).toMatchObject({ enrolled: false, plans: [], files: [], resources: [] });
      expectError(await portal('get', `/plans/${plans.delivered}`, who), 404, 'NOT_FOUND');
    }
    // Firm B's client never reaches firm A's plan, nor firm A's client firm B's.
    expectError(
      await portal('get', `/plans/${plans.delivered}`, logins.b, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
    expect(
      MyAdvisory.parse(ok(await portal('get', '', logins.b, undefined, 'b'))).plans.map(
        (p) => p.id,
      ),
    ).toEqual([plans.firmB]);
    const elsewhere = await portal('get', `/plans/${plans.firmB}`, logins.x, undefined, 'b');
    expect([401, 403, 404]).toContain(elsewhere.status);
    // A staff session is never a portal session.
    expect([401, 403]).toContain((await portal('get', '', staff.ownerA)).status);
    // A bad id is a validation error, never a lookup.
    expectError(await portal('get', '/plans/not-a-uuid', logins.x), 400, 'VALIDATION_FAILED');
  });

  it('shows nothing once the firm archives the client from the program', async () => {
    ok(await firm('post', `/clients/${advisory.a2}/archive`, staff.ownerA));
    expect(MyAdvisory.parse(ok(await portal('get', '', logins.y)))).toMatchObject({
      enrolled: false,
      plans: [],
    });
    expectError(await portal('get', `/plans/${plans.other}`, logins.y), 404, 'NOT_FOUND');
    ok(await firm('post', `/clients/${advisory.a2}/restore`, staff.ownerA));
  });
});

describe("B10: the client's approval of the business plan, before it is finalized", () => {
  /** A plan of c1's ready to finalize (name, type, summary, focus, a goal; c1 has figures). */
  const readyPlan = (name: string, status: 'DRAFT' | 'IN_REVIEW' = 'IN_REVIEW', goal = true) =>
    inFirm('a', async (tx) => {
      const p = await tx.advisoryPlan.create({
        data: {
          businessId: firms.a.id,
          advisoryClientId: advisory.a1,
          name: `${name} ${run}`,
          targetYear: 2026,
          planType: 'growth',
          status,
          step: 5,
          profile: { businessName: 'Sample Bakery (fake)' },
          strategy: { summary: 'Grow the bakery (fake).', noFocusArea: true },
          createdByUserId: staff.ownerA.id,
        },
        select: { id: true },
      });
      if (goal) {
        await tx.advisoryGoal.create({
          data: {
            businessId: firms.a.id,
            advisoryClientId: advisory.a1,
            planId: p.id,
            title: `Goal of ${name} (fake)`,
          },
        });
      }
      return p.id;
    });
  const detail = async (id: string) =>
    AdvisoryPlanDetail.parse(ok(await firm('get', `/plans/${id}`, staff.ownerA)));
  const ask = async (id: string, who: Who = staff.ownerA, message?: string) =>
    firm('post', `/plans/${id}/request-approval`, who, {
      etag: (await detail(id)).etag,
      ...(message ? { message } : {}),
    });
  const setStatus = async (id: string, status: string) =>
    firm('post', `/plans/${id}/status`, staff.ownerA, { status, etag: (await detail(id)).etag });
  const approval = (id: string) =>
    inFirm('a', (tx) =>
      tx.advisoryPlan.findFirstOrThrow({
        where: { id },
        select: {
          status: true,
          clientApprovedAt: true,
          clientApprovedByUserId: true,
          clientApprovedVersion: true,
        },
      }),
    );

  it('sends a plan in staff review for approval: the version is kept, the plan locked, the client told', async () => {
    const id = await readyPlan('Approval plan');
    // Only from staff review, only a ready plan, only to a client with a portal login.
    const draft = await readyPlan('Draft for approval', 'DRAFT');
    expectError(await ask(draft), 409, 'INVALID_STATUS');
    const notReady = await readyPlan('Not ready for approval', 'IN_REVIEW', false);
    expectError(await ask(notReady), 409, 'PLAN_NOT_READY');
    const noLogin = await inFirm('a', async (tx) => {
      const a3 = await tx.advisoryClient.create({
        data: { businessId: firms.a.id, clientId: clients.c3 },
        select: { id: true },
      });
      const p = await tx.advisoryPlan.create({
        data: {
          businessId: firms.a.id,
          advisoryClientId: a3.id,
          name: `No login plan ${run}`,
          targetYear: 2026,
          planType: 'growth',
          status: 'IN_REVIEW',
          profile: { businessName: 'Casey Co (fake)' },
          strategy: { summary: 'Fake.', noFocusArea: true },
          createdByUserId: staff.ownerA.id,
        },
        select: { id: true },
      });
      await tx.advisoryGoal.create({
        data: { businessId: firms.a.id, advisoryClientId: a3.id, planId: p.id, title: 'Fake goal' },
      });
      await tx.advisoryFinancialSnapshot.create({
        data: {
          businessId: firms.a.id,
          advisoryClientId: a3.id,
          periodStart: new Date('2025-01-01T00:00:00Z'),
          periodEnd: new Date('2025-12-31T00:00:00Z'),
          revenueCents: 1_000,
          asOf: new Date(`${day(-5)}T00:00:00Z`),
          createdByUserId: staff.ownerA.id,
        },
      });
      return p.id;
    });
    const refused = await ask(noLogin);
    expectError(refused, 409, 'NO_PORTAL_LOGIN');
    expect(JSON.stringify(refused.body)).toContain('portal invitation');
    // Another firm never reaches it; a stale etag is a conflict.
    expectError(
      await firm('post', `/plans/${id}/request-approval`, staff.ownerB, { etag: 'x' }, 'b'),
      404,
      'NOT_FOUND',
    );
    expectError(
      await firm('post', `/plans/${id}/request-approval`, staff.ownerA, { etag: 'stale' }),
      409,
      'SAVE_CONFLICT',
    );

    const sent = AdvisoryPlanDetail.parse(ok(await ask(id, staff.ownerA, 'Have a look (fake)')));
    expect(sent).toMatchObject({ status: 'AWAITING_CLIENT_APPROVAL', clientApproval: null });
    expect(sent.finalizedAt).toBeNull();
    expect(sent.sentAt).not.toBeNull();
    const versions = AdvisoryVersionList.parse(
      ok(await firm('get', `/plans/${id}/versions`, staff.ownerA)),
    ).items;
    expect(versions.map((v) => [v.versionNo, v.deliveredChannel])).toEqual([[1, 'portal']]);
    // Locked while the client reads it: no edit, no finalize, no other send, no second request.
    expectError(
      await firm('patch', `/plans/${id}`, staff.ownerA, {
        etag: (await detail(id)).etag,
        name: 'Renamed (fake)',
      }),
      409,
      'PLAN_LOCKED',
    );
    expectError(
      await firm('post', `/plans/${id}/finalize`, staff.ownerA, { etag: (await detail(id)).etag }),
      409,
      'INVALID_STATUS',
    );
    expectError(
      await firm('post', `/plans/${id}/send`, staff.ownerA, { channel: 'DOWNLOAD' }),
      409,
      'INVALID_STATUS',
    );
    expectError(await ask(id), 409, 'INVALID_STATUS');

    // The client's portal message links to the plan; the client sees it waiting for them.
    const thread = await inFirm('a', (tx) =>
      tx.messageThread.findFirstOrThrow({
        where: { clientId: clients.c1, subject: { contains: `Approval plan ${run}` } },
        include: { messages: true },
      }),
    );
    expect(thread.subject).toMatch(/^Please review your business plan/);
    expect(thread.messages[0]?.body).toContain(`/${firms.a.slug}/services/advisory/plans/${id}`);
    expect(thread.messages[0]?.body).toContain('Have a look (fake)');
    const mine = MyAdvisory.parse(ok(await portal('get', '', logins.x)));
    expect(mine.plans.find((p) => p.id === id)).toMatchObject({
      version: 1,
      state: 'AWAITING_APPROVAL',
      approval: null,
    });
    const plan = MyAdvisoryPlan.parse(ok(await portal('get', `/plans/${id}`, logins.x)));
    expect(plan).toMatchObject({ version: 1, can: { approve: true } });
    expect(JSON.stringify(plan)).not.toContain('1234567');

    expect(await auditOf('advisory_plan.approval_requested', id)).toEqual([
      { actorUserId: staff.ownerA.id, metadata: { advisoryClientId: advisory.a1, version: 1 } },
    ]);
  });

  it('takes the client’s approval of exactly that version: finalized, shown to the firm, the firm told, audited', async () => {
    const id = await readyPlan('Approve me');
    ok(await ask(id));
    // Never another client, an AUTHORIZED login, another firm's portal, or a bad body.
    expectError(
      await portal('post', `/plans/${id}/approve`, logins.y, { version: 1 }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await portal('post', `/plans/${id}/approve`, logins.xAuthorized, { version: 1 }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await portal('post', `/plans/${id}/approve`, logins.b, { version: 1 }, 'b'),
      404,
      'NOT_FOUND',
    );
    expectError(
      await portal('post', `/plans/${id}/approve`, logins.x, {}),
      400,
      'VALIDATION_FAILED',
    );
    // Only the version sent for approval; a plan not waiting is refused.
    expectError(
      await portal('post', `/plans/${id}/approve`, logins.x, { version: 2 }),
      409,
      'INVALID_STATUS',
    );
    expectError(
      await portal('post', `/plans/${plans.delivered}/approve`, logins.x, { version: 1 }),
      409,
      'INVALID_STATUS',
    );
    expect((await approval(id)).clientApprovedAt).toBeNull();

    const approved = MyAdvisoryPlan.parse(
      ok(await portal('post', `/plans/${id}/approve`, logins.x, { version: 1 })),
    );
    expect(approved).toMatchObject({
      state: 'APPROVED',
      approval: { version: 1 },
      can: { approve: false },
    });
    expect(await approval(id)).toMatchObject({
      status: 'FINALIZED',
      clientApprovedByUserId: logins.x.id,
      clientApprovedVersion: 1,
    });
    const firmSide = await detail(id);
    expect(firmSide).toMatchObject({
      status: 'FINALIZED',
      currentVersion: 1,
      clientApproval: { version: 1, approvedBy: 'Fake x' },
    });
    expect(firmSide.finalizedAt).not.toBeNull();
    expectError(
      await portal('post', `/plans/${id}/approve`, logins.x, { version: 1 }),
      409,
      'INVALID_STATUS',
    );
    expect(await auditOf('advisory_plan.client_approved', id)).toEqual([
      {
        actorUserId: logins.x.id,
        metadata: {
          advisoryClientId: advisory.a1,
          version: 1,
          from: 'AWAITING_CLIENT_APPROVAL',
          to: 'FINALIZED',
          by: 'CLIENT',
        },
      },
    ]);
    // The advisor and the member who sent it each get a bell item.
    const bells = await inFirm('a', (tx) =>
      tx.notification.findMany({
        where: { entityId: id, type: storedType('advisory-plan.client-approved') },
        select: { recipientUserId: true },
      }),
    );
    expect(bells.map((b) => b.recipientUserId).sort()).toEqual(
      [staff.adminA.id, staff.ownerA.id].sort(),
    );
  });

  it('Modify Plan withdraws a request or clears an approval: a revision needs approving again', async () => {
    // An approval is cleared by the revision, and the next version needs its own.
    const id = await readyPlan('Revise me');
    ok(await ask(id));
    ok(await portal('post', `/plans/${id}/approve`, logins.x, { version: 1 }));
    expect(AdvisoryPlanDetail.parse(ok(await setStatus(id, 'DRAFT')))).toMatchObject({
      status: 'DRAFT',
      clientApproval: null,
    });
    expect(await approval(id)).toMatchObject({
      clientApprovedAt: null,
      clientApprovedByUserId: null,
      clientApprovedVersion: null,
    });
    expect(
      MyAdvisory.parse(ok(await portal('get', '', logins.x))).plans.find((p) => p.id === id),
    ).toMatchObject({ state: 'IN_PREPARATION', approval: null });
    ok(await setStatus(id, 'IN_REVIEW'));
    ok(await ask(id));
    expectError(
      await portal('post', `/plans/${id}/approve`, logins.x, { version: 1 }),
      409,
      'INVALID_STATUS',
    );
    expect(
      MyAdvisoryPlan.parse(
        ok(await portal('post', `/plans/${id}/approve`, logins.x, { version: 2 })),
      ),
    ).toMatchObject({ state: 'APPROVED', approval: { version: 2 } });

    // A request still open is withdrawn: the client can no longer approve it.
    const other = await readyPlan('Withdraw me');
    ok(await ask(other));
    expect(AdvisoryPlanDetail.parse(ok(await setStatus(other, 'DRAFT'))).status).toBe('DRAFT');
    expectError(
      await portal('post', `/plans/${other}/approve`, logins.x, { version: 1 }),
      409,
      'INVALID_STATUS',
    );
    expect(
      MyAdvisoryPlan.parse(ok(await portal('get', `/plans/${other}`, logins.x))),
    ).toMatchObject({ state: 'IN_PREPARATION', can: { approve: false } });
  });

  it('Finalize waits for the client’s approval when the client has a portal login; without one it finalizes as before', async () => {
    const finalize = async (id: string) =>
      firm('post', `/plans/${id}/finalize`, staff.ownerA, { etag: (await detail(id)).etag });
    // With a login (c1): refused until the client approves; the approval finalizes the plan.
    const id = await readyPlan('Gated plan');
    expect(await detail(id)).toMatchObject({ clientApprovalRequired: true, clientApproval: null });
    const refused = await finalize(id);
    expectError(refused, 409, 'CLIENT_APPROVAL_REQUIRED');
    expect(JSON.stringify(refused.body)).toContain('Send it for approval');
    expect((await detail(id)).status).toBe('IN_REVIEW');
    ok(await ask(id));
    ok(await portal('post', `/plans/${id}/approve`, logins.x, { version: 1 }));
    expect(await detail(id)).toMatchObject({
      status: 'FINALIZED',
      currentVersion: 1,
      clientApproval: { version: 1 },
    });
    // The approval stands until a revision: then Finalize waits for a new one.
    ok(await setStatus(id, 'DRAFT'));
    expectError(await finalize(id), 409, 'CLIENT_APPROVAL_REQUIRED');

    // Without a login (c3): Finalize works as before.
    const a3 = await inFirm('a', async (tx) => {
      const found = await tx.advisoryClient.findFirst({
        where: { clientId: clients.c3 },
        select: { id: true },
      });
      const advisoryClientId =
        found?.id ??
        (
          await tx.advisoryClient.create({
            data: { businessId: firms.a.id, clientId: clients.c3 },
            select: { id: true },
          })
        ).id;
      const figures = await tx.advisoryFinancialSnapshot.count({ where: { advisoryClientId } });
      if (figures === 0) {
        await tx.advisoryFinancialSnapshot.create({
          data: {
            businessId: firms.a.id,
            advisoryClientId,
            periodStart: new Date('2025-01-01T00:00:00Z'),
            periodEnd: new Date('2025-12-31T00:00:00Z'),
            revenueCents: 1_000,
            asOf: new Date(`${day(-5)}T00:00:00Z`),
            createdByUserId: staff.ownerA.id,
          },
        });
      }
      const plan = await tx.advisoryPlan.create({
        data: {
          businessId: firms.a.id,
          advisoryClientId,
          name: `Ungated plan ${run}`,
          targetYear: 2026,
          planType: 'growth',
          status: 'IN_REVIEW',
          profile: { businessName: 'Casey Co (fake)' },
          strategy: { summary: 'Fake.', noFocusArea: true },
          createdByUserId: staff.ownerA.id,
        },
        select: { id: true },
      });
      await tx.advisoryGoal.create({
        data: {
          businessId: firms.a.id,
          advisoryClientId,
          planId: plan.id,
          title: 'Fake goal',
        },
      });
      return plan.id;
    });
    expect((await detail(a3)).clientApprovalRequired).toBe(false);
    expect(AdvisoryPlanDetail.parse(ok(await finalize(a3)))).toMatchObject({
      status: 'FINALIZED',
      currentVersion: 1,
      clientApproval: null,
    });
    // The list says the same, per plan.
    const rows = (await firm('get', `/plans?pageSize=100&search=${run}`, staff.ownerA)).body as {
      items: { id: string; clientApprovalRequired: boolean }[];
    };
    expect(rows.items.find((r) => r.id === id)?.clientApprovalRequired).toBe(true);
    expect(rows.items.find((r) => r.id === a3)?.clientApprovalRequired).toBe(false);
  });
});

describe('B28: advisory resources by portal or email, as a Secure Link or a PDF, with a preview', () => {
  const preview = (key: string, body: object, who: Who = staff.ownerA) =>
    firm('post', `/resources/${key}/preview`, who, body);
  const send = (key: string, body: object, who: Who = staff.ownerA) =>
    firm('post', `/resources/${key}/send`, who, body);
  /** c3 has no portal login; it joins the program here. */
  const noLogin = async () => {
    const found = await inFirm('a', (tx) =>
      tx.advisoryClient.findFirst({ where: { clientId: clients.c3 }, select: { id: true } }),
    );
    if (found) return found.id;
    return inFirm(
      'a',
      async (tx) =>
        (
          await tx.advisoryClient.create({
            data: { businessId: firms.a.id, clientId: clients.c3 },
            select: { id: true },
          })
        ).id,
    );
  };

  it('lists the formats each resource offers', async () => {
    const items = AdvisoryResourceList.parse(
      ok(await firm('get', '/resources', staff.ownerA)),
    ).items;
    expect(items.find((r) => r.key === 'cash-flow-basics')?.formats).toEqual([
      'SECURE_LINK',
      'PDF',
    ]);
  });

  it('previews what the client receives and every check, without sending or auditing', async () => {
    const before = await auditOf('advisory_resource.sent', advisory.a1);
    const res = await preview('cash-flow-basics', {
      advisoryClientId: advisory.a1,
      channel: 'EMAIL',
      format: 'PDF',
      message: 'Read before Tuesday (fake)',
    });
    const view = AdvisoryResourcePreview.parse(ok(res));
    expect(view).toMatchObject({
      channel: 'EMAIL',
      format: 'PDF',
      to: { name: 'Jamie Sample (fake)', email: logins.x.email },
      subject: 'Cash Flow Basics',
      eligible: true,
      problems: [],
    });
    expect(view.body).toContain('How to read and forecast your cash flow.');
    expect(view.body).toContain('A PDF copy is ready to download in your portal');
    expect(view.body).toContain(`/${firms.a.slug}/services/advisory#cash-flow-basics`);
    expect(view.body).toContain('Read before Tuesday (fake)');
    // A Secure Link is the default.
    expect(
      AdvisoryResourcePreview.parse(
        ok(
          await preview('cash-flow-basics', {
            advisoryClientId: advisory.a1,
            channel: 'PORTAL_MESSAGE',
          }),
        ),
      ).body,
    ).toContain('Open it in your portal (sign in first)');
    // No portal login: both channels are refused, and said why.
    const a3 = await noLogin();
    for (const channel of ['PORTAL_MESSAGE', 'EMAIL']) {
      const refused = AdvisoryResourcePreview.parse(
        ok(await preview('cash-flow-basics', { advisoryClientId: a3, channel })),
      );
      expect(refused).toMatchObject({ eligible: false, to: { email: null } });
      expect(refused.problems.map((p) => p.code)).toEqual(['NO_PORTAL_LOGIN']);
      expect(refused.problems[0]?.message).toContain('Send them a portal invitation first');
    }
    // A staff-only resource is listed as a problem too.
    expect(
      AdvisoryResourcePreview.parse(
        ok(
          await preview('advisory-health-score-reference', {
            advisoryClientId: advisory.a1,
            channel: 'PORTAL_MESSAGE',
          }),
        ),
      ).problems.map((p) => p.code),
    ).toEqual(['RESOURCE_NOT_CLIENT_FACING']);
    // Another firm's client, an unknown resource, a bad format: 404 and 400.
    expectError(
      await preview('cash-flow-basics', { advisoryClientId: advisory.aB, channel: 'EMAIL' }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await preview('no-such-resource', { advisoryClientId: advisory.a1, channel: 'EMAIL' }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await preview('cash-flow-basics', {
        advisoryClientId: advisory.a1,
        channel: 'EMAIL',
        format: 'FAX',
      }),
      400,
      'VALIDATION_FAILED',
    );
    expect(await auditOf('advisory_resource.sent', advisory.a1)).toEqual(before);
  });

  it('sends as the preview said, refuses what it refused, and records the format', async () => {
    const a3 = await noLogin();
    expectError(
      await send('cash-flow-basics', { advisoryClientId: a3, channel: 'PORTAL_MESSAGE' }),
      409,
      'NO_PORTAL_LOGIN',
    );
    OkResponse.parse(
      ok(
        await send('cash-flow-basics', {
          advisoryClientId: advisory.a1,
          channel: 'EMAIL',
          format: 'PDF',
        }),
      ),
    );
    const thread = await inFirm('a', (tx) =>
      tx.messageThread.findFirstOrThrow({
        where: { clientId: clients.c1, subject: 'Cash Flow Basics' },
        include: { messages: true },
      }),
    );
    expect(thread.messages[0]?.body).toContain('A PDF copy is ready to download in your portal');
    // By email, the email carries the text (where the platform allows it).
    expect(thread.messages[0]?.emailIncludesBody).toBe(true);
    const rows = await inFirm('a', (tx) =>
      tx.auditLog.findMany({
        where: {
          action: 'advisory_resource.sent',
          metadata: { path: ['resourceKey'], equals: 'cash-flow-basics' },
        },
        select: { metadata: true },
      }),
    );
    expect(rows.map((r) => r.metadata)).toEqual([
      {
        advisoryClientId: advisory.a1,
        resourceKey: 'cash-flow-basics',
        channel: 'EMAIL',
        format: 'PDF',
      },
    ]);
  });

  it('lets the client download a resource sent as a PDF, and only that one', async () => {
    const mine = MyAdvisory.parse(ok(await portal('get', '', logins.x)));
    expect(mine.resources.find((r) => r.key === 'cash-flow-basics')?.format).toBe('PDF');
    // Sent before the choice existed (no format): a link.
    expect(mine.resources.find((r) => r.key === 'funding-readiness-checklist')?.format).toBe(
      'SECURE_LINK',
    );
    const link = MyAdvisoryResourcePdf.parse(
      ok(await portal('get', '/resources/cash-flow-basics/pdf', logins.x)),
    );
    const key = link.url.replace('https://files.test/', '').replace('?signed=1', '');
    expect(key).toMatch(new RegExp(`^tenant/${firms.a.id}/reports/advisory-resource-`));
    const file = stored.get(key);
    expect(file?.contentType).toBe('application/pdf');
    expect(Buffer.from(file!.bytes).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await auditOf('advisory_resource.downloaded', advisory.a1)).at(-1)).toEqual({
      actorUserId: logins.x.id,
      metadata: {
        advisoryClientId: advisory.a1,
        resourceKey: 'cash-flow-basics',
        format: 'PDF',
        by: 'CLIENT',
      },
    });
    // A Secure Link resource, one never sent, another client's: 404.
    expectError(
      await portal('get', '/resources/funding-readiness-checklist/pdf', logins.x),
      404,
      'NOT_FOUND',
    );
    expectError(
      await portal('get', '/resources/brand-basics-guide/pdf', logins.x),
      404,
      'NOT_FOUND',
    );
    expectError(await portal('get', '/resources/cash-flow-basics/pdf', logins.y), 404, 'NOT_FOUND');
    expectError(
      await portal('get', '/resources/cash-flow-basics/pdf', logins.xAuthorized),
      404,
      'NOT_FOUND',
    );
    expectError(
      await portal('get', '/resources/cash-flow-basics/pdf', logins.b, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
  });
});
