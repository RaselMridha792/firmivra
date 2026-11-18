// End-to-end: R55, Client Portal Review One, advisory in the portal. BA-CP: the client's own
// read-only Business Advisory under My Services (only what the firm marked for the client: plans
// delivered, recommendations shown, tasks not hidden, resources sent, advisory files shared).
// The client is the session's login, never the URL: another client's or another firm's plan is
// 404. Views are audited. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, type Prisma, runInScope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { MyAdvisory, MyAdvisoryPlan, OkResponse } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

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
  method: 'get' | 'post',
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
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
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
