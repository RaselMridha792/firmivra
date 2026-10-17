// End-to-end: R55, Tax Planning & Strategy (contract in packages/types/src/tax-planning): plans
// with figures, strategies, estimates and authorized overrides, documents, status, finalize and
// send with immutable versions; the strategy library; the opportunity queue with explicit review
// actions and the screening run; the Tax Savings Calculator and saved scenarios; the overview,
// Clients tab, Tax Calendar and Resources. Staff reach only their assigned clients; firm B sees
// none of firm A's. Nothing in an audit row holds a figure or a note.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  CalculatorResult,
  OkResponse,
  PlanInputCatalog,
  PlanVersionDetail,
  PlanVersionList,
  PlanningCalendar,
  PlanningClientPage,
  PlanningResourceList,
  PlanningStrategy,
  PlanningStrategyPage,
  RunScreeningResult,
  TaxOpportunityDetail,
  TaxOpportunityEventList,
  TaxOpportunityPage,
  TaxPlanDetail,
  TaxPlanPage,
  TaxPlanningOverview,
  TaxScenario,
  TaxScenarioPage,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55t-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  preparerA: person('preparer-a'),
  ownerB: person('owner-b'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', string>;
const clients = {} as Record<'c1' | 'c2' | 'c3' | 'c4' | 'cB', string>;
const docs = {} as Record<'c1' | 'c2', string>;

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.57.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

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
  asOwner({ kind: 'business', businessId: firms[firm] }, work);

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

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
async function call(
  method: Method,
  path: string,
  who: Who | undefined,
  body?: object,
  firm: 'a' | 'b' = 'a',
): Promise<Response> {
  let req = request(app.getHttpServer())
    [method](`/api/v1/business/tax-planning${path}`)
    .set('x-business-id', firms[firm])
    .set('x-forwarded-for', viewer());
  if (who) req = req.set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};
const mark = (what: string) => `${what} ${run} ${randomUUID().slice(0, 6)}`;
const { ownerA, adminA, staffA, preparerA, ownerB } = people;

const plan = async (id: string, who: Who = ownerA) =>
  TaxPlanDetail.parse(ok(await call('get', `/plans/${id}`, who)));
const createPlan = async (over: object = {}, who: Who = ownerA) =>
  TaxPlanDetail.parse(
    ok(
      await call('post', '/plans', who, {
        clientId: clients.c1,
        planYear: 2026,
        name: mark('Plan'),
        filingStatus: 'SINGLE',
        ...over,
      }),
      201,
    ),
  );
const changePlan = async (id: string, body: object, who: Who = ownerA) => {
  const cur = await plan(id, who);
  return call('patch', `/plans/${id}`, who, { etag: cur.etag, ...body });
};
const withEtag = async (id: string, body: object = {}) => ({
  ...body,
  etag: (await plan(id)).etag,
});
const addLibrary = async (id: string, strategyId: string, who: Who = ownerA) =>
  call('post', `/plans/${id}/strategies`, who, { kind: 'LIBRARY', strategyId });
const createLibrary = async (over: object = {}) =>
  PlanningStrategy.parse(
    ok(
      await call('post', '/strategies', ownerA, {
        name: mark('Strategy'),
        category: 'RETIREMENT',
        requiredInputs: ['retirement_contributions'],
        ...over,
      }),
      201,
    ),
  );
const money = (key: string, amountCents: number, kind = 'PROJECTED', taxYear = 2026) => ({
  key,
  kind,
  taxYear,
  amountCents,
  source: 'Client estimate',
});
const saveInputs = async (id: string, inputs: object[], who: Who = ownerA) =>
  call('put', `/plans/${id}/inputs`, who, await withEtag(id, { inputs }));

const auditRows = (entityId: string) =>
  inFirm('a', (tx) =>
    tx.auditLog.findMany({
      where: { entityId },
      select: { action: true, metadata: true },
      orderBy: { createdAt: 'asc' },
    }),
  );

const DAY = 86_400_000;
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: 'STAFF',
          email: p.email,
          name: `Fake R55t ${key}`,
        },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r55t-${key}-${run}`;
      firms[key] = (
        await tx.business.create({
          data: { slug, name: `Firm ${slug}`, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
  });
  for (const [firm, userId, role] of [
    ['a', ownerA.id, 'OWNER'],
    ['a', adminA.id, 'ADMIN'],
    ['a', staffA.id, 'STAFF'],
    ['a', preparerA.id, 'TAX_PREPARER'],
    ['b', ownerB.id, 'OWNER'],
  ] as const) {
    await inFirm(firm, (tx) =>
      tx.membership.create({ data: { businessId: firms[firm], userId, role, status: 'ACTIVE' } }),
    );
  }
  await inFirm('a', async (tx) => {
    const businessId = firms.a;
    await tx.businessSettings.create({ data: { businessId, timezone: 'America/New_York' } });
    const service = await tx.service.create({
      data: { businessId, kind: 'BOOKKEEPING', name: 'Bookkeeping' },
      select: { id: true },
    });
    const client = async (key: 'c1' | 'c2' | 'c3' | 'c4', name: string, over: object = {}) => {
      clients[key] = (
        await tx.client.create({
          data: { businessId, displayName: name, email: `${key}-${run}@client.test`, ...over },
          select: { id: true },
        })
      ).id;
    };
    await client('c1', 'Jamie Sample (fake)', { assignedUserId: staffA.id });
    await client('c2', 'Riley Example (fake)', { accountType: 'BUSINESS' });
    await client('c3', 'Casey Planner (fake)', { assignedUserId: preparerA.id });
    await client('c4', 'Nora Nobody (fake)');
    for (const key of ['c1', 'c2'] as const) {
      const engagement = await tx.engagement.create({
        data: {
          businessId,
          clientId: clients[key],
          serviceId: service.id,
          title: 'Bookkeeping (fake)',
        },
        select: { id: true },
      });
      docs[key] = (
        await tx.document.create({
          data: {
            businessId,
            clientId: clients[key],
            engagementId: engagement.id,
            direction: 'CLIENT_TO_FIRM',
            fileName: `Fake plan document ${key}.pdf`,
            contentType: 'application/pdf',
            sizeBytes: 1234,
            sha256: 'c'.repeat(64),
            s3Key: `tenant/${businessId}/documents/${randomUUID()}`,
          },
          select: { id: true },
        })
      ).id;
    }
  });
  await inFirm('b', async (tx) => {
    clients.cB = (
      await tx.client.create({
        data: { businessId: firms.b, displayName: 'Firm B Client (fake)' },
        select: { id: true },
      })
    ).id;
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
});

afterAll(async () => {
  await app.close();
});

// The plan the first tests build on.
const shared = {} as {
  planId: string;
  lib: string;
  lib2: string;
  custom: string;
  prepPlan: string;
};

describe('plans', () => {
  it('creates a draft plan, lists and reads it, and changes it with an etag', async () => {
    const goalNote = 'Buy a boat (fake)';
    const created = await createPlan({
      name: mark('Main plan'),
      goals: ['REDUCE_TAXABLE_INCOME', 'OTHER'],
      otherGoal: goalNote,
      assignedUserId: adminA.id,
      targetCompletionOn: day(30),
    });
    shared.planId = created.id;
    expect(created).toMatchObject({
      status: 'DRAFT',
      planYear: 2026,
      planType: 'COMPREHENSIVE',
      client: { id: clients.c1 },
      assignedTo: { userId: adminA.id },
      strategies: [],
      documents: [],
      inputs: [],
      canEdit: true,
      canOverride: true,
      canSend: true,
      archived: false,
      version: 0,
    });
    expect(created.disclaimer).toMatch(/Estimates are based/);

    // One live plan per client, year and name; a duplicate is for Owner, Admin or a planning admin.
    expectError(
      await call('post', '/plans', ownerA, {
        clientId: clients.c1,
        planYear: 2026,
        name: created.name.toUpperCase(),
      }),
      409,
      'DUPLICATE_PLAN',
    );
    expectError(
      await call('post', '/plans', staffA, {
        clientId: clients.c1,
        planYear: 2026,
        name: created.name,
        allowDuplicate: true,
      }),
      403,
      'FORBIDDEN',
    );
    ok(
      await call('post', '/plans', adminA, {
        clientId: clients.c1,
        planYear: 2026,
        name: created.name,
        allowDuplicate: true,
      }),
      201,
    );

    // Validation and reach.
    expectError(
      await call('post', '/plans', ownerA, {
        clientId: clients.c1,
        planYear: 2026,
        name: mark('Bad'),
        otherGoal: 'Something',
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', '/plans', ownerA, {
        clientId: clients.c1,
        planYear: 2026,
        name: mark('Bad'),
        surprise: true,
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', '/plans', ownerA, {
        clientId: clients.c1,
        planYear: 2026,
        name: `Bad \u0000 ${run}`,
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', '/plans', ownerA, {
        clientId: clients.cB,
        planYear: 2026,
        name: mark('Other firm'),
      }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', '/plans', ownerA, {
        clientId: clients.c1,
        planYear: 2026,
        name: mark('Not a member'),
        assignedUserId: ownerB.id,
      }),
      409,
      'NOT_A_MEMBER',
    );

    const list = TaxPlanPage.parse(
      ok(await call('get', `/plans?clientId=${clients.c1}&status=DRAFT`, ownerA)),
    );
    expect(list.items.map((p) => p.id)).toContain(created.id);
    expect(list.items.every((p) => p.client.id === clients.c1 && p.status === 'DRAFT')).toBe(true);
    const found = TaxPlanPage.parse(
      ok(
        await call('get', `/plans?search=${encodeURIComponent(created.name.slice(0, 12))}`, ownerA),
      ),
    );
    expect(found.total).toBeGreaterThanOrEqual(2);

    // A change needs the current etag; the note stays out of the audit log.
    const note = 'Internal: client is nervous about audits (fake)';
    const changed = TaxPlanDetail.parse(
      ok(
        await call('patch', `/plans/${created.id}`, ownerA, {
          etag: created.etag,
          notes: note,
          clientNotes: 'We will talk in the spring.',
          nextDiscussionOn: day(10),
        }),
      ),
    );
    expect(changed).toMatchObject({
      notes: note,
      clientNotes: 'We will talk in the spring.',
      nextDiscussionOn: day(10),
    });
    expectError(
      await call('patch', `/plans/${created.id}`, ownerA, { etag: created.etag, notes: 'late' }),
      409,
      'SAVE_CONFLICT',
    );
    expectError(
      await changePlan(created.id, { clientNotes: 'x'.repeat(2_001) }),
      400,
      'VALIDATION_FAILED',
    );
    // Dropping Other drops the goal described with it.
    const noOther = TaxPlanDetail.parse(
      ok(await changePlan(created.id, { goals: ['PURCHASE_HOME'] })),
    );
    expect(noOther).toMatchObject({ goals: ['PURCHASE_HOME'], otherGoal: null });
    expectError(
      await changePlan(created.id, { goals: ['PURCHASE_HOME'], otherGoal: 'Back again' }),
      400,
      'VALIDATION_FAILED',
    );
    const rows = await auditRows(created.id);
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(['tax_plan.created', 'tax_plan.updated']),
    );
    const log = JSON.stringify(rows);
    expect(log).not.toContain('nervous');
    expect(log).not.toContain('spring');
    expect(log).not.toContain(goalNote);
  });

  it('keeps Staff to their assigned clients, and the grid roles to what the grid gives', async () => {
    const mine = await createPlan({ name: mark('Staff plan') }, staffA);
    expect(mine.client.id).toBe(clients.c1);
    const other = await createPlan({ clientId: clients.c2, name: mark('Unassigned plan') });
    expectError(await call('get', `/plans/${other.id}`, staffA), 404, 'NOT_FOUND');
    expectError(
      await call('post', '/plans', staffA, {
        clientId: clients.c2,
        planYear: 2026,
        name: mark('Nope'),
      }),
      404,
      'NOT_FOUND',
    );
    const list = TaxPlanPage.parse(ok(await call('get', '/plans', staffA)));
    expect(list.items.some((p) => p.client.id === clients.c2)).toBe(false);
    expect(list.items.some((p) => p.id === mine.id)).toBe(true);
    expectError(
      await call('patch', `/plans/${other.id}`, staffA, { etag: other.etag, notes: 'x' }),
      404,
      'NOT_FOUND',
    );

    // A Tax Preparer may look (View) at the plans of the clients assigned to them, but not create or
    // change, and does not see the figures.
    const prep = await createPlan({ clientId: clients.c3, name: mark('Preparer plan') });
    ok(await saveInputs(prep.id, [money('agi', 9_000_000)]));
    ok(
      await call('post', `/plans/${prep.id}/strategies`, ownerA, {
        kind: 'CUSTOM',
        name: mark('Prep idea'),
        category: 'BUSINESS',
      }),
      201,
    );
    ok(await call('post', `/plans/${prep.id}/finalize`, ownerA, await withEtag(prep.id)));
    shared.prepPlan = prep.id;
    expectError(await call('get', `/plans/${shared.planId}`, preparerA), 404, 'NOT_FOUND');
    const seen = await plan(prep.id, preparerA);
    expect(seen).toMatchObject({
      inputs: null,
      canEdit: false,
      canOverride: false,
      canSend: false,
    });
    expectError(
      await call('post', '/plans', preparerA, {
        clientId: clients.c1,
        planYear: 2026,
        name: mark('Nope'),
      }),
      403,
      'FORBIDDEN',
    );

    // Firm B sees nothing of firm A's.
    expectError(
      await call('get', `/plans/${shared.planId}`, ownerB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
    const bList = TaxPlanPage.parse(ok(await call('get', '/plans', ownerB, undefined, 'b')));
    expect(bList.total).toBe(0);
    expectError(await call('get', `/plans/${randomUUID()}`, ownerA), 404, 'NOT_FOUND');
    expectError(await call('get', '/plans/not-a-uuid', ownerA), 400, 'VALIDATION_FAILED');
    expectError(await call('get', '/plans', undefined), 401, 'UNAUTHENTICATED');
  });

  it('keeps the plan’s figures, each with its year, kind and source, and refuses what does not fit', async () => {
    const catalog = PlanInputCatalog.parse(ok(await call('get', '/input-catalog', ownerA)));
    expect(catalog.items.map((i) => i.key)).toEqual(
      expect.arrayContaining(['taxable_income', 'retirement_contributions', 'agi']),
    );
    const id = shared.planId;
    expectError(await saveInputs(id, [money('not_a_figure', 1_000)]), 400, 'VALIDATION_FAILED');
    expectError(
      await saveInputs(id, [money('agi', 1_000, 'HISTORICAL', 2026)]),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await saveInputs(id, [money('agi', 1_000, 'PROJECTED', 2025)]),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await saveInputs(id, [{ key: 'agi', kind: 'PROJECTED', taxYear: 2026, source: 'x' }]),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await saveInputs(
        id,
        [
          {
            ...money('agi', 1_000),
            kind: 'ADJUSTMENT',
            note: 'Client says so (fake)',
          },
        ],
        staffA,
      ),
      403,
      'OVERRIDE_NOT_ALLOWED',
    );
    expectError(await saveInputs(id, [money('agi', 1_000)], preparerA), 403, 'FORBIDDEN');
    expectError(
      await call('put', `/plans/${id}/inputs`, ownerA, {
        inputs: [money('agi', 1_000)],
        etag: '2000-01-01T00:00:00.000Z',
      }),
      409,
      'SAVE_CONFLICT',
    );

    const saved = TaxPlanDetail.parse(
      ok(
        await saveInputs(id, [
          money('taxable_income', 10_000_000),
          money('retirement_contributions', 1_000_000),
          { ...money('agi', 11_500_000, 'HISTORICAL', 2025), source: 'Tax return 2025' },
          { key: 'state', kind: 'PROJECTED', taxYear: 2026, textValue: 'GA', source: 'Client' },
        ]),
      ),
    );
    expect(saved.inputs?.map((i) => i.key).sort()).toEqual([
      'agi',
      'retirement_contributions',
      'state',
      'taxable_income',
    ]);
    expect(saved.inputs?.find((i) => i.key === 'agi')).toMatchObject({
      kind: 'HISTORICAL',
      taxYear: 2025,
      source: 'Tax return 2025',
      amountCents: 11_500_000,
    });
    // An authorized adjustment, and the figure is replaced (not duplicated) when saved again.
    const again = TaxPlanDetail.parse(
      ok(await saveInputs(id, [money('retirement_contributions', 1_000_000)])),
    );
    expect(again.inputs?.filter((i) => i.key === 'retirement_contributions')).toHaveLength(1);
    const adjusted = TaxPlanDetail.parse(
      ok(
        await saveInputs(id, [
          {
            ...money('other_income', 500_000),
            kind: 'ADJUSTMENT',
            note: 'Client expects a bonus (fake)',
          },
        ]),
      ),
    );
    expect(adjusted.inputs?.find((i) => i.key === 'other_income')?.kind).toBe('ADJUSTMENT');
    expect(JSON.stringify(await auditRows(id))).not.toContain('bonus');
    expect(adjusted.staleData).toBe(false);
  });
});

describe('the strategy library and the plan’s strategies', () => {
  it('manages the library with Manage Strategies, and keeps names unique', async () => {
    const lib = await createLibrary({
      name: mark('401(k) catch-up'),
      eligibility: ['Has earned income'],
      requiredDocuments: ['Pay stub'],
      implementationChecklist: ['Call the plan administrator'],
    });
    shared.lib = lib.id;
    expect(lib).toMatchObject({
      category: 'RETIREMENT',
      defaultPriority: 'MEDIUM',
      eligibility: ['Has earned income'],
      requiredInputs: ['retirement_contributions'],
      requiredDocuments: ['Pay stub'],
      implementationChecklist: ['Call the plan administrator'],
      active: true,
      archived: false,
      planCount: 0,
      openOpportunityCount: 0,
    });
    expectError(
      await call('post', '/strategies', staffA, { name: mark('Nope'), category: 'CREDITS' }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('post', '/strategies', ownerA, {
        name: lib.name.toUpperCase(),
        category: 'CREDITS',
      }),
      409,
      'DUPLICATE_NAME',
    );
    expectError(
      await call('post', '/strategies', ownerA, {
        name: mark('Bad input'),
        category: 'CREDITS',
        requiredInputs: ['made_up'],
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', '/strategies', ownerA, { name: 'x'.repeat(121), category: 'CREDITS' }),
      400,
      'VALIDATION_FAILED',
    );

    const second = await createLibrary({
      name: mark('HSA contributions'),
      category: 'DEDUCTIONS',
      requiredInputs: ['hsa_contributions'],
    });
    shared.lib2 = second.id;
    const page = PlanningStrategyPage.parse(
      ok(
        await call(
          'get',
          `/strategies?category=RETIREMENT&search=${encodeURIComponent('catch-up')}`,
          staffA,
        ),
      ),
    );
    expect(page.items.map((s) => s.id)).toEqual([lib.id]);
    const patched = PlanningStrategy.parse(
      ok(
        await call('patch', `/strategies/${lib.id}`, ownerA, {
          description: 'Raise the deferral',
          defaultPriority: 'HIGH',
        }),
      ),
    );
    expect(patched).toMatchObject({ description: 'Raise the deferral', defaultPriority: 'HIGH' });
    expectError(
      await call('patch', `/strategies/${lib.id}`, staffA, { defaultPriority: 'LOW' }),
      403,
      'FORBIDDEN',
    );

    // Archiving makes it inactive; it cannot be switched on again until restored.
    const spare = await createLibrary({
      name: mark('Spare'),
      category: 'TIMING',
      requiredInputs: [],
    });
    const archived = PlanningStrategy.parse(
      ok(await call('post', `/strategies/${spare.id}/archive`, ownerA)),
    );
    expect(archived).toMatchObject({ archived: true, active: false });
    expectError(
      await call('patch', `/strategies/${spare.id}`, ownerA, { active: true }),
      409,
      'INVALID_STATUS',
    );
    expect(
      PlanningStrategyPage.parse(
        ok(await call('get', '/strategies?search=Spare', ownerA)),
      ).items.map((s) => s.id),
    ).not.toContain(spare.id);
    const restored = PlanningStrategy.parse(
      ok(await call('post', `/strategies/${spare.id}/restore`, ownerA)),
    );
    expect(restored).toMatchObject({ archived: false, active: true });
    expectError(
      await call('get', `/strategies/${lib.id}`, ownerB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
  });

  it('estimates from the plan’s figures, never invents one, and counts overlapping savings once', async () => {
    const id = shared.planId;
    const withLibrary = TaxPlanDetail.parse(ok(await addLibrary(id, shared.lib), 201));
    const s1 = withLibrary.strategies[0];
    // Single, 2026: taxable income $100,000, $10,000 deferred, so $14,500 of room under the
    // $24,500 limit, all taxed in the 22% band: $3,190.
    expect(s1).toMatchObject({
      custom: false,
      selected: true,
      status: 'PROPOSED',
      priority: 'HIGH',
      category: 'RETIREMENT',
      position: 0,
    });
    expect(s1?.estimate).toMatchObject({
      cents: 319_000,
      modelCents: 319_000,
      overridden: false,
      dataYear: 2026,
      unavailableReason: null,
    });
    expect(s1?.estimate.basis).toMatch(/Based on 2026 figures/);
    expect(withLibrary.projectedSavingsCents).toBe(319_000);

    expectError(await addLibrary(id, shared.lib), 409, 'DUPLICATE_STRATEGY');
    expectError(await addLibrary(id, randomUUID()), 404, 'NOT_FOUND');

    // A strategy with no figure to read is unavailable, with the reason, not a guess.
    const withHsa = TaxPlanDetail.parse(ok(await addLibrary(id, shared.lib2), 201));
    const hsa = withHsa.strategies.find((s) => s.strategyId === shared.lib2);
    expect(hsa?.estimate).toMatchObject({ cents: null, modelCents: null, overridden: false });
    expect(hsa?.estimate.unavailableReason).toMatch(/HSA contributions/);
    expect(withHsa.projectedSavingsCents).toBe(319_000);

    // A custom strategy; an estimate on it needs the override permission.
    expectError(
      await call('post', `/plans/${id}/strategies`, staffA, {
        kind: 'CUSTOM',
        name: mark('Custom'),
        category: 'BUSINESS',
        estimatedSavingsCents: 100_000,
      }),
      403,
      'OVERRIDE_NOT_ALLOWED',
    );
    const customName = mark('Custom retirement idea');
    const withCustom = TaxPlanDetail.parse(
      ok(
        await call('post', `/plans/${id}/strategies`, ownerA, {
          kind: 'CUSTOM',
          name: customName,
          category: 'RETIREMENT',
          estimatedSavingsCents: 100_000,
          assumptions: 'Based on a conversation (fake)',
        }),
        201,
      ),
    );
    const custom = withCustom.strategies.find((s) => s.name === customName);
    expect(custom).toMatchObject({ custom: true, strategyId: null, category: 'RETIREMENT' });
    expect(custom?.estimate).toMatchObject({ cents: 100_000, overridden: true, modelCents: null });
    expectError(
      await call('post', `/plans/${id}/strategies`, ownerA, {
        kind: 'CUSTOM',
        name: customName.toUpperCase(),
        category: 'BUSINESS',
      }),
      409,
      'DUPLICATE_STRATEGY',
    );
    // Two retirement strategies share one limit: only the larger counts.
    expect(withCustom.projectedSavingsCents).toBe(319_000);
    expect(withCustom.overlapNotes.join(' ')).toMatch(/only the largest/);
    const customRow = withCustom.strategies.find((s) => s.name === customName);
    expect(JSON.stringify(await auditRows(id))).not.toContain('319000');
    expect(customRow?.id).toBeTruthy();
    shared.custom = customRow?.id ?? '';
  });

  it('changes a strategy, overrides an estimate only with the permission and a reason, and reorders', async () => {
    const id = shared.planId;
    const d = await plan(id);
    const s1 = d.strategies.find((s) => s.strategyId === shared.lib);
    const patch = async (sid: string, body: object, who: Who = ownerA) =>
      call('patch', `/plans/${id}/strategies/${sid}`, who, await withEtag(id, body));
    expectError(
      await patch(
        s1?.id ?? '',
        { overrideSavingsCents: 500_000, overrideReason: 'Client agreed' },
        staffA,
      ),
      403,
      'OVERRIDE_NOT_ALLOWED',
    );
    expectError(
      await patch(s1?.id ?? '', { overrideSavingsCents: 500_000 }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await patch(s1?.id ?? '', { overrideReason: 'No amount' }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(await patch(randomUUID(), { selected: false }), 404, 'NOT_FOUND');
    expectError(
      await call('patch', `/plans/${id}/strategies/${s1?.id}`, ownerA, {
        etag: '2000-01-01T00:00:00.000Z',
        selected: false,
      }),
      409,
      'SAVE_CONFLICT',
    );
    const reason = 'Agreed with the client after the review (fake)';
    const over = TaxPlanDetail.parse(
      ok(await patch(s1?.id ?? '', { overrideSavingsCents: 500_000, overrideReason: reason })),
    );
    const o1 = over.strategies.find((s) => s.id === s1?.id);
    expect(o1?.estimate).toMatchObject({ cents: 500_000, modelCents: 319_000, overridden: true });
    expect(o1).toMatchObject({ overrideReason: reason, overriddenBy: { userId: ownerA.id } });
    expect(JSON.stringify(await auditRows(id))).not.toContain('Agreed with the client');
    const cleared = TaxPlanDetail.parse(
      ok(await patch(s1?.id ?? '', { overrideSavingsCents: null })),
    );
    expect(cleared.strategies.find((s) => s.id === s1?.id)?.estimate).toMatchObject({
      cents: 319_000,
      overridden: false,
    });

    // Status, priority, the day it was implemented, and dropping it from the total.
    const implemented = TaxPlanDetail.parse(
      ok(await patch(s1?.id ?? '', { status: 'IN_PROGRESS', priority: 'LOW' })),
    );
    expect(implemented.strategies.find((s) => s.id === s1?.id)).toMatchObject({
      status: 'IN_PROGRESS',
      priority: 'LOW',
      implementedOn: null,
    });
    expectError(await patch(s1?.id ?? '', { implementedOn: day(-1) }), 400, 'VALIDATION_FAILED');
    const done = TaxPlanDetail.parse(ok(await patch(s1?.id ?? '', { status: 'IMPLEMENTED' })));
    expect(done.strategies.find((s) => s.id === s1?.id)?.implementedOn).toBe(day(0));
    const back = TaxPlanDetail.parse(ok(await patch(s1?.id ?? '', { status: 'IN_PROGRESS' })));
    expect(back.strategies.find((s) => s.id === s1?.id)?.implementedOn).toBeNull();
    const dropped = TaxPlanDetail.parse(ok(await patch(shared.custom, { selected: false })));
    expect(dropped.overlapNotes).toEqual([]);
    const kept = TaxPlanDetail.parse(ok(await patch(shared.custom, { selected: true })));
    expect(kept.overlapNotes).toHaveLength(1);

    // Reordering takes every strategy once.
    const ids = (await plan(id)).strategies.map((s) => s.id);
    expectError(
      await call(
        'put',
        `/plans/${id}/strategies/order`,
        ownerA,
        await withEtag(id, { ids: ids.slice(1) }),
      ),
      400,
      'VALIDATION_FAILED',
    );
    const reversed = TaxPlanDetail.parse(
      ok(
        await call(
          'put',
          `/plans/${id}/strategies/order`,
          ownerA,
          await withEtag(id, { ids: [...ids].reverse() }),
        ),
      ),
    );
    expect(reversed.strategies.map((s) => s.id)).toEqual([...ids].reverse());

    // Recalculating reads the changed figures; earlier versions are not touched.
    ok(await saveInputs(id, [money('retirement_contributions', 2_000_000)]));
    const recalculated = TaxPlanDetail.parse(
      ok(await call('post', `/plans/${id}/recalculate`, ownerA)),
    );
    // $4,500 of room at 22%: $990.
    expect(recalculated.strategies.find((s) => s.id === s1?.id)?.estimate.cents).toBe(99_000);
    expectError(await call('post', `/plans/${id}/recalculate`, preparerA), 403, 'FORBIDDEN');
  });
});

describe('documents, status, versions and delivery', () => {
  it('links only the plan client’s documents', async () => {
    const id = shared.planId;
    expectError(
      await call('post', `/plans/${id}/documents`, ownerA, { documentId: docs.c2 }),
      409,
      'DOCUMENT_NOT_ALLOWED',
    );
    expectError(
      await call('post', `/plans/${id}/documents`, ownerA, { documentId: randomUUID() }),
      409,
      'DOCUMENT_NOT_ALLOWED',
    );
    expectError(
      await call('post', `/plans/${id}/documents`, ownerA, {
        documentId: docs.c1,
        planStrategyId: randomUUID(),
      }),
      404,
      'NOT_FOUND',
    );
    const linked = TaxPlanDetail.parse(
      ok(
        await call('post', `/plans/${id}/documents`, ownerA, {
          documentId: docs.c1,
          category: 'Supporting',
        }),
        201,
      ),
    );
    expect(linked.documents).toHaveLength(1);
    expect(linked.documents[0]).toMatchObject({
      documentId: docs.c1,
      fileName: 'Fake plan document c1.pdf',
      category: 'Supporting',
      addedBy: { userId: ownerA.id },
    });
    ok(await call('post', `/plans/${id}/documents`, ownerA, { documentId: docs.c1 }), 201);
    expect((await plan(id)).documents).toHaveLength(1);
    const gone = TaxPlanDetail.parse(
      ok(await call('delete', `/plans/${id}/documents/${docs.c1}`, ownerA)),
    );
    expect(gone.documents).toEqual([]);
    expectError(
      await call('delete', `/plans/${id}/documents/${docs.c1}`, ownerA),
      404,
      'NOT_FOUND',
    );
  });

  it('moves the plan along only in ways that fit, and finalizes and sends it with immutable versions', async () => {
    const fresh = await createPlan({ name: mark('Empty plan') });
    const setStatus = async (pid: string, status: string, who: Who = ownerA) =>
      call('post', `/plans/${pid}/status`, who, await withEtag(pid, { status }));
    expectError(await setStatus(fresh.id, 'IMPLEMENTED'), 409, 'INVALID_STATUS');
    expectError(await setStatus(fresh.id, 'DRAFT'), 409, 'INVALID_STATUS');
    expectError(
      await call('post', `/plans/${fresh.id}/status`, ownerA, {
        status: 'SCHEDULED',
        etag: '2000-01-01T00:00:00.000Z',
      }),
      409,
      'SAVE_CONFLICT',
    );
    expect(TaxPlanDetail.parse(ok(await setStatus(fresh.id, 'IN_PROGRESS'))).status).toBe(
      'IN_PROGRESS',
    );
    // Nothing to finalize or send yet.
    const notReady = await call(
      'post',
      `/plans/${fresh.id}/finalize`,
      ownerA,
      await withEtag(fresh.id),
    );
    expectError(notReady, 409, 'PLAN_NOT_READY');
    expect(JSON.stringify(notReady.body)).toMatch(/Select at least one strategy/);
    expectError(
      await call('post', `/plans/${fresh.id}/send`, ownerA, { channel: 'PORTAL_MESSAGE' }),
      409,
      'PLAN_NOT_READY',
    );

    // The main plan: finalize, change it, and find that it has to be finalized again before sending.
    const id = shared.planId;
    expectError(await setStatus(id, 'IMPLEMENTED'), 409, 'INVALID_STATUS');
    ok(await setStatus(id, 'IN_PROGRESS'));
    const implemented = TaxPlanDetail.parse(ok(await setStatus(id, 'IMPLEMENTED')));
    expect(implemented.status).toBe('IMPLEMENTED');
    ok(await setStatus(id, 'IN_PROGRESS'));
    expectError(
      await call('post', `/plans/${id}/send`, ownerA, { channel: 'PORTAL_MESSAGE' }),
      409,
      'PLAN_NOT_READY',
    );
    const finalized = TaxPlanDetail.parse(
      ok(await call('post', `/plans/${id}/finalize`, ownerA, await withEtag(id))),
    );
    expect(finalized.version).toBe(1);
    expectError(await setStatus(id, 'DRAFT'), 409, 'INVALID_STATUS');
    ok(await changePlan(id, { notes: 'Edited after it was finalized (fake)' }));
    expectError(
      await call('post', `/plans/${id}/send`, ownerA, { channel: 'PORTAL_MESSAGE' }),
      409,
      'PLAN_NOT_READY',
    );
    ok(await call('post', `/plans/${id}/finalize`, ownerA, await withEtag(id)));
    expectError(
      await call('post', `/plans/${id}/send`, preparerA, { channel: 'EMAIL' }),
      403,
      'FORBIDDEN',
    );

    const v1Before = PlanVersionDetail.parse(
      ok(await call('get', `/plans/${id}/versions/1`, ownerA)),
    );
    const sent = TaxPlanDetail.parse(
      ok(
        await call('post', `/plans/${id}/send`, staffA, {
          channel: 'PORTAL_MESSAGE',
          message: 'Hello (fake)',
        }),
      ),
    );
    expect(sent.version).toBe(3);
    const versions = PlanVersionList.parse(ok(await call('get', `/plans/${id}/versions`, ownerA)));
    expect(versions.items.map((v) => [v.version, v.event])).toEqual([
      [3, 'SENT'],
      [2, 'FINALIZED'],
      [1, 'FINALIZED'],
    ]);

    // The client got the client-facing plan: client notes, strategies and the disclaimer, never the internal notes.
    const thread = await inFirm('a', (tx) =>
      tx.messageThread.findFirstOrThrow({
        where: { clientId: clients.c1, subject: { contains: '2026 tax plan' } },
        include: { messages: true },
      }),
    );
    const body = thread.messages[0]?.body ?? '';
    expect(body).toMatch(/We will talk in the spring/);
    expect(body).toMatch(/Hello \(fake\)/);
    expect(body).toMatch(/Estimates are based on the information provided/);
    expect(body).not.toMatch(/Edited after it was finalized|nervous/);

    // Later changes never rewrite what was delivered.
    const pid = (await plan(id)).strategies[0]?.id ?? '';
    ok(
      await call(
        'patch',
        `/plans/${id}/strategies/${pid}`,
        ownerA,
        await withEtag(id, {
          overrideSavingsCents: 123_456,
          overrideReason: 'Changed later (fake)',
        }),
      ),
    );
    const v1After = PlanVersionDetail.parse(
      ok(await call('get', `/plans/${id}/versions/1`, ownerA)),
    );
    expect(v1After).toEqual(v1Before);
    expect(v1After.strategies.length).toBeGreaterThan(0);
    expect(v1After.inputs?.length).toBeGreaterThan(0);
    expect(v1After.disclaimer).toMatch(/Estimates/);
    expectError(await call('get', `/plans/${id}/versions/9`, ownerA), 404, 'NOT_FOUND');
    // A role that cannot see the figures does not get them from a version either.
    const seen = PlanVersionDetail.parse(
      ok(await call('get', `/plans/${shared.prepPlan}/versions/1`, preparerA)),
    );
    expect(seen.inputs).toBeNull();

    // Archive and restore; an archived plan is not changed.
    const archived = TaxPlanDetail.parse(ok(await call('post', `/plans/${id}/archive`, ownerA)));
    expect(archived.archived).toBe(true);
    expectError(await changePlan(id, { notes: 'x' }), 409, 'PLAN_ARCHIVED');
    expectError(
      await call('post', `/plans/${id}/documents`, ownerA, { documentId: docs.c1 }),
      409,
      'PLAN_ARCHIVED',
    );
    expect(
      TaxPlanPage.parse(ok(await call('get', `/plans?clientId=${clients.c1}`, ownerA))).items.map(
        (p) => p.id,
      ),
    ).not.toContain(id);
    ok(await call('post', `/plans/${id}/restore`, ownerA));
    expect((await plan(id)).archived).toBe(false);
    const actions = (await auditRows(id)).map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'tax_plan.finalized',
        'tax_plan.sent',
        'tax_plan.status_changed',
        'tax_plan.archived',
        'tax_plan.restored',
        'tax_plan.document_attached',
      ]),
    );
    expect(JSON.stringify(await auditRows(id))).not.toContain('Hello (fake)');
  });
});

const opp = async (id: string, who: Who = ownerA, query = '') =>
  TaxOpportunityDetail.parse(ok(await call('get', `/opportunities/${id}${query}`, who)));
const act = async (id: string, body: object, who: Who = ownerA) =>
  call('post', `/opportunities/${id}/actions`, who, body);
const acted = async (id: string, body: object, who: Who = ownerA) =>
  TaxOpportunityDetail.parse(ok(await act(id, body, who)));
const newOpp = async (over: object = {}, who: Who = ownerA) =>
  TaxOpportunityDetail.parse(
    ok(
      await call('post', '/opportunities', who, {
        clientId: clients.c1,
        name: mark('Opp'),
        category: 'RETIREMENT',
        taxYear: 2026,
        ...over,
      }),
      201,
    ),
  );

describe('opportunities', () => {
  const o = {} as { lib: string; high: string; mid: string; low: string };

  it('queues opportunities without recommending them, and reading one changes nothing', async () => {
    const lib = await createLibrary({
      name: mark('Opportunity strategy'),
      category: 'DEDUCTIONS',
      requiredInputs: [],
    });
    o.lib = lib.id;
    const mid = await newOpp(
      {
        strategyId: lib.id,
        estimatedSavingsCents: 250_000,
        estimateBasis: 'Based on current year data',
        recommendedActions: ['Call the client'],
        documentsNeeded: ['Statement', 'ID'],
      },
      staffA,
    );
    o.mid = mid.id;
    expect(mid).toMatchObject({
      status: 'NEW',
      source: 'STAFF',
      reviewed: false,
      reviewedBy: null,
      canReview: true,
      dataComplete: true,
      estimatedSavingsCents: 250_000,
      recommendedActions: ['Call the client'],
      documentsNeeded: [
        { index: 0, label: 'Statement', received: false },
        { index: 1, label: 'ID', received: false },
      ],
      clientDataUsed: [],
      planId: null,
    });
    expect(mid.estimate).toMatchObject({ cents: 250_000, dataYear: 2026, overridden: false });
    expect(mid.disclaimer).toMatch(/Estimates/);

    // One open opportunity per client, strategy and year.
    const dup = await call('post', '/opportunities', ownerA, {
      clientId: clients.c1,
      strategyId: lib.id,
      name: mark('Again'),
      category: 'DEDUCTIONS',
      taxYear: 2026,
    });
    expectError(dup, 409, 'DUPLICATE_OPPORTUNITY');
    expect(JSON.stringify(dup.body)).toContain(mid.id);
    expectError(
      await call('post', '/opportunities', staffA, {
        clientId: clients.c2,
        name: mark('Not mine'),
        category: 'CREDITS',
        taxYear: 2026,
      }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', '/opportunities', ownerA, {
        clientId: clients.c1,
        strategyId: randomUUID(),
        name: mark('No such strategy'),
        category: 'CREDITS',
        taxYear: 2026,
      }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', '/opportunities', preparerA, {
        clientId: clients.c3,
        name: mark('Read only'),
        category: 'CREDITS',
        taxYear: 2026,
      }),
      403,
      'FORBIDDEN',
    );

    const high = await newOpp({
      clientId: clients.c3,
      strategyId: lib.id,
      estimatedSavingsCents: 400_000,
      priority: 'HIGH',
    });
    const low = await newOpp({ estimatedSavingsCents: 100_000, priority: 'LOW' });
    o.high = high.id;
    o.low = low.id;
    expect(low).toMatchObject({ source: 'MANUAL', strategyId: null });

    const queue = `?search=${run}&sort=savings&direction=desc`;
    const page = TaxOpportunityPage.parse(ok(await call('get', `/opportunities${queue}`, ownerA)));
    expect(page.items.map((x) => x.id)).toEqual([high.id, mid.id, low.id]);
    const byClient = TaxOpportunityPage.parse(
      ok(await call('get', `/opportunities?clientId=${clients.c3}&group=open`, ownerA)),
    );
    expect(byClient.items.map((x) => x.id)).toEqual([high.id]);
    const staffPage = TaxOpportunityPage.parse(
      ok(await call('get', `/opportunities${queue}`, staffA)),
    );
    expect(staffPage.items.map((x) => x.id)).toEqual([mid.id, low.id]);
    expect(
      TaxOpportunityPage.parse(
        ok(await call('get', `/opportunities?search=${run}&sort=priority&direction=desc`, ownerA)),
      ).items[0]?.id,
    ).toBe(high.id);
    expect(
      TaxOpportunityPage.parse(
        ok(await call('get', `/opportunities?priority=LOW&search=${run}`, ownerA)),
      ).items.map((x) => x.id),
    ).toEqual([low.id]);

    // Previous and Next follow the queue the caller came from, and reading changes nothing.
    const first = await opp(mid.id, ownerA, queue);
    expect([first.previousId, first.nextId]).toEqual([high.id, low.id]);
    const second = await opp(mid.id, ownerA, queue);
    expect(second.etag).toBe(first.etag);
    expect(second.status).toBe('NEW');
    expect([
      (await opp(high.id, ownerA, queue)).previousId,
      (await opp(low.id, ownerA, queue)).nextId,
    ]).toEqual([null, null]);
    expectError(
      await call('get', `/opportunities/${mid.id}`, ownerB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
    expectError(await call('get', `/opportunities/${high.id}`, staffA), 404, 'NOT_FOUND');
    expect(
      TaxOpportunityPage.parse(ok(await call('get', '/opportunities', ownerB, undefined, 'b')))
        .total,
    ).toBe(0);
  });

  it('changes an opportunity only by explicit, audited actions that fit its status', async () => {
    const id = o.mid;
    expectError(await act(id, { action: 'MARK_IMPLEMENTED', on: day(0) }), 409, 'INVALID_STATUS');
    expectError(await act(id, { action: 'CLOSE' }), 409, 'INVALID_STATUS');
    expectError(await act(id, { action: 'REOPEN' }), 409, 'INVALID_STATUS');
    expectError(await act(id, { action: 'MAKE_IT_SO' }), 400, 'VALIDATION_FAILED');
    expectError(await act(id, { action: 'DISMISS' }), 400, 'VALIDATION_FAILED');
    expectError(await act(id, { action: 'START_REVIEW' }, preparerA), 403, 'FORBIDDEN');
    expectError(await act(randomUUID(), { action: 'START_REVIEW' }), 404, 'NOT_FOUND');

    const started = await acted(id, { action: 'START_REVIEW' }, staffA);
    expect(started).toMatchObject({
      status: 'UNDER_REVIEW',
      reviewed: true,
      reviewedBy: { name: 'Fake R55t staffA' },
    });
    expectError(await act(id, { action: 'START_REVIEW' }, staffA), 409, 'INVALID_STATUS');
    expectError(
      await act(id, { action: 'ADD_NOTE', note: 'late', etag: '2000-01-01T00:00:00.000Z' }),
      409,
      'SAVE_CONFLICT',
    );

    // Assign, schedule a discussion, and the document checklist.
    expectError(await act(id, { action: 'ASSIGN', userId: ownerB.id }), 409, 'NOT_A_MEMBER');
    const assigned = await acted(id, { action: 'ASSIGN', userId: adminA.id });
    expect(assigned).toMatchObject({ status: 'ASSIGNED', assignedTo: { userId: adminA.id } });
    expect((await acted(id, { action: 'ASSIGN', userId: null })).status).toBe('UNDER_REVIEW');
    expectError(
      await act(id, { action: 'SCHEDULE_DISCUSSION', on: day(7), appointmentId: randomUUID() }),
      404,
      'NOT_FOUND',
    );
    // Another firm's appointment and plan are not found, whatever the id.
    const foreign = await inFirm('b', async (tx) => {
      const appointment = await tx.appointment.create({
        data: {
          businessId: firms.b,
          clientId: clients.cB,
          staffUserId: ownerB.id,
          startsAt: new Date(Date.now() + DAY),
          endsAt: new Date(Date.now() + DAY + 3_600_000),
          locationKind: 'PHONE',
        },
        select: { id: true },
      });
      const otherPlan = await tx.taxPlan.create({
        data: { businessId: firms.b, clientId: clients.cB, name: mark('B plan'), planYear: 2026 },
        select: { id: true },
      });
      return { appointment: appointment.id, plan: otherPlan.id };
    });
    expectError(
      await act(id, {
        action: 'SCHEDULE_DISCUSSION',
        on: day(7),
        appointmentId: foreign.appointment,
      }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await act(o.low, { action: 'ADD_TO_PLAN', planId: foreign.plan }),
      404,
      'NOT_FOUND',
    );
    const talk = await acted(id, { action: 'SCHEDULE_DISCUSSION', on: day(7) });
    expect(talk).toMatchObject({ status: 'DISCUSSION_SCHEDULED', discussionOn: day(7) });
    expectError(
      await act(id, { action: 'SET_DOCUMENT', index: 5, received: true }),
      400,
      'VALIDATION_FAILED',
    );
    const missing = await acted(id, { action: 'SET_DOCUMENT', index: 0, received: false });
    expect(missing.status).toBe('NEEDS_DOCUMENTS');
    await acted(id, { action: 'SET_DOCUMENT', index: 0, received: true });
    const complete = await acted(id, { action: 'SET_DOCUMENT', index: 1, received: true });
    expect(complete.status).toBe('UNDER_REVIEW');
    expect(complete.documentsNeeded.every((d) => d.received)).toBe(true);

    // Adding to a plan links it without a duplicate, and carries the estimate.
    const added = await acted(id, { action: 'ADD_TO_PLAN' }, staffA);
    expect(added.status).toBe('ADDED_TO_PLAN');
    expect(added.plan?.id).toBeTruthy();
    const target = await plan(added.plan?.id ?? '');
    const linked = target.strategies.filter((x) => x.strategyId === o.lib);
    expect(linked).toHaveLength(1);
    expect(linked[0]?.estimate).toMatchObject({ cents: 250_000, dataYear: 2026 });
    expectError(await act(id, { action: 'ADD_TO_PLAN' }), 409, 'INVALID_STATUS');
    expectError(
      await act(o.low, { action: 'ADD_TO_PLAN', planId: randomUUID() }),
      404,
      'NOT_FOUND',
    );
    const custom = await acted(o.low, { action: 'ADD_TO_PLAN', planId: shared.planId });
    expect(custom.planId).toBe(shared.planId);
    const withCustom = await plan(shared.planId);
    expect(withCustom.strategies.find((x) => x.name === custom.name)?.estimate.cents).toBe(100_000);

    // Dismissing needs a reason and may hold screening off; it can be reopened.
    const reason = 'Client already did this elsewhere (fake)';
    expectError(await act(o.high, { action: 'DISMISS', reason: '  ' }), 400, 'VALIDATION_FAILED');
    const dismissed = await acted(o.high, {
      action: 'DISMISS',
      reason,
      suppressedUntil: day(30),
    });
    expect(dismissed).toMatchObject({
      status: 'DISMISSED',
      dispositionReason: reason,
      suppressedUntil: day(30),
      reviewed: true,
    });
    expectError(
      await act(o.high, { action: 'MARK_NOT_APPLICABLE', reason: 'Again (fake)' }),
      409,
      'INVALID_STATUS',
    );
    expectError(await act(o.high, { action: 'CLOSE' }), 409, 'INVALID_STATUS');
    const reopened = await acted(o.high, { action: 'REOPEN' });
    expect(reopened).toMatchObject({
      status: 'UNDER_REVIEW',
      dispositionReason: null,
      suppressedUntil: null,
    });

    // Implemented, then closed: final.
    const done = await acted(o.high, {
      action: 'MARK_IMPLEMENTED',
      on: day(-1),
      note: 'Done (fake)',
    });
    expect(done).toMatchObject({ status: 'IMPLEMENTED', implementedOn: day(-1) });
    expectError(await act(o.high, { action: 'REOPEN' }), 409, 'INVALID_STATUS');
    expectError(
      await act(o.high, { action: 'DISMISS', reason: 'Too late (fake)' }),
      409,
      'INVALID_STATUS',
    );
    expect((await acted(o.high, { action: 'CLOSE', note: 'Filed away (fake)' })).status).toBe(
      'CLOSED',
    );
    expectError(await act(o.high, { action: 'CLOSE' }), 409, 'INVALID_STATUS');
    const noted = await acted(o.high, { action: 'ADD_NOTE', note: 'A last word (fake)' });
    expect(noted.status).toBe('CLOSED');
    // A closed opportunity frees its place: the same strategy and year can be raised again.
    const again = await newOpp({
      clientId: clients.c3,
      strategyId: o.lib,
      estimatedSavingsCents: 1,
    });
    expect(again.status).toBe('NEW');

    // The history, newest first, and what the audit log holds (ids, actions and statuses).
    const events = TaxOpportunityEventList.parse(
      ok(await call('get', `/opportunities/${o.high}/events`, ownerA)),
    ).items;
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(['STATUS', 'NOTE']));
    expect(events[0]).toMatchObject({ kind: 'NOTE', reason: 'A last word (fake)' });
    expect(events.find((e) => e.toStatus === 'DISMISSED')).toMatchObject({
      fromStatus: 'NEW',
      reason,
      actor: { userId: ownerA.id },
    });
    const rows = await auditRows(o.high);
    expect(rows.map((r) => r.action)).toContain('tax_opportunity.action');
    expect(JSON.stringify(rows)).not.toMatch(/already did this|Filed away|last word/);
    expect(
      (await auditRows(id)).some((r) =>
        JSON.stringify(r.metadata).includes('"action":"ADD_TO_PLAN"'),
      ),
    ).toBe(true);
    expectError(
      await call('get', `/opportunities/${o.high}/events`, ownerB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
  });
});

describe('screening', () => {
  it('finds opportunities from the plan’s figures, leaves reviewed ones alone and honours suppression', async () => {
    const screenPlan = await createPlan({
      clientId: clients.c3,
      planYear: 2025,
      name: mark('2025 plan'),
    });
    ok(
      await saveInputs(screenPlan.id, [
        money('taxable_income', 10_000_000, 'PROJECTED', 2025),
        money('retirement_contributions', 1_000_000, 'PROJECTED', 2025),
      ]),
    );
    const screen = (body: object, who: Who = ownerA) => call('post', '/screening/run', who, body);
    expectError(await screen({ clientId: clients.c3, taxYear: 2025 }, staffA), 403, 'FORBIDDEN');
    expectError(await screen({ clientId: randomUUID(), taxYear: 2025 }), 404, 'NOT_FOUND');
    expectError(await screen({ taxYear: 1999 }), 400, 'VALIDATION_FAILED');
    const first = RunScreeningResult.parse(
      ok(await screen({ clientId: clients.c3, taxYear: 2025 })),
    );
    expect(first).toEqual({
      clientsScreened: 1,
      created: 1,
      updated: 0,
      skippedSuppressed: 0,
      queued: false,
    });
    const found = TaxOpportunityPage.parse(
      ok(await call('get', `/opportunities?clientId=${clients.c3}&taxYear=2025`, ownerA)),
    ).items;
    expect(found).toHaveLength(1);
    const detail = await opp(found[0]?.id ?? '');
    // $13,500 of room at 22%: $2,970. Not a recommendation until staff review it.
    expect(detail).toMatchObject({
      source: 'SYSTEM',
      ruleId: 'retirement-room',
      status: 'NEW',
      reviewed: false,
      dataComplete: true,
      estimatedSavingsCents: 297_000,
      impact: { suggestedActionCents: 1_350_000, newTaxableIncomeCents: 8_650_000 },
    });
    expect(detail.whyExplanation).toMatch(/below the annual limit/);
    expect(detail.clientDataUsed?.map((p) => p.label)).toEqual([
      'Taxable income',
      'Retirement contributions so far',
      'Room under the annual limit',
    ]);
    expect(detail.impact.effectiveRateBeforeBp).toBeGreaterThan(
      detail.impact.effectiveRateAfterBp ?? 0,
    );
    expect(detail.eligibility).toEqual([
      { text: expect.stringMatching(/below the annual limit/), met: true },
    ]);

    // Same figures: nothing new. A changed figure refreshes an opportunity nobody has touched.
    expect(
      RunScreeningResult.parse(ok(await screen({ clientId: clients.c3, taxYear: 2025 }))),
    ).toMatchObject({ created: 0, updated: 0 });
    ok(
      await saveInputs(screenPlan.id, [
        money('retirement_contributions', 1_500_000, 'PROJECTED', 2025),
      ]),
    );
    expect(
      RunScreeningResult.parse(ok(await screen({ clientId: clients.c3, taxYear: 2025 }))),
    ).toMatchObject({ created: 0, updated: 1 });
    expect((await opp(detail.id)).estimatedSavingsCents).toBe(187_000);

    // Once a person has reviewed it, a new run leaves it as it is.
    await acted(detail.id, { action: 'START_REVIEW' });
    ok(
      await saveInputs(screenPlan.id, [
        money('retirement_contributions', 500_000, 'PROJECTED', 2025),
      ]),
    );
    expect(
      RunScreeningResult.parse(ok(await screen({ clientId: clients.c3, taxYear: 2025 }))),
    ).toMatchObject({ created: 0, updated: 0 });
    expect((await opp(detail.id)).estimatedSavingsCents).toBe(187_000);

    // A dismissed one is not raised again before its date.
    ok(await saveInputs(screenPlan.id, [money('hsa_contributions', 0, 'PROJECTED', 2025)]));
    const hsa = RunScreeningResult.parse(ok(await screen({ clientId: clients.c3, taxYear: 2025 })));
    expect(hsa.created).toBe(1);
    const hsaOpp = TaxOpportunityPage.parse(
      ok(
        await call('get', `/opportunities?clientId=${clients.c3}&taxYear=2025&status=NEW`, ownerA),
      ),
    ).items;
    expect(hsaOpp).toHaveLength(1);
    expect(hsaOpp[0]?.estimatedSavingsCents).toBe(94_600);
    await acted(hsaOpp[0]?.id ?? '', {
      action: 'DISMISS',
      reason: 'Not eligible (fake)',
      suppressedUntil: day(30),
    });
    expect(
      RunScreeningResult.parse(ok(await screen({ clientId: clients.c3, taxYear: 2025 }))),
    ).toMatchObject({ created: 0, updated: 0, skippedSuppressed: 1 });

    // A run across the firm.
    const all = RunScreeningResult.parse(ok(await screen({}, adminA)));
    expect(all.clientsScreened).toBeGreaterThanOrEqual(4);
    expect(all.queued).toBe(false);
    expect(JSON.stringify(await auditRows(detail.id))).not.toMatch(/2970|297000/);
  });
});

describe('the Tax Savings Calculator', () => {
  const baseline = { wagesCents: 10_000_000 };
  const calc = (over: object = {}, who: Who = ownerA) =>
    call('post', '/calculator/calculate', who, {
      taxYear: 2026,
      filingStatus: 'SINGLE',
      baseline,
      strategy: { retirementContributionCents: 1_000_000 },
      ...over,
    });

  it('works out the saving from the tables, and says why when it cannot', async () => {
    // $100,000 of wages, $16,100 standard deduction: tax on $83,900 is $13,170; with $10,000 in a
    // retirement plan, on $73,900 it is $10,970.
    const result = CalculatorResult.parse(ok(await calc()));
    expect(result).toMatchObject({
      baselineTaxCents: 1_317_000,
      modeledTaxCents: 1_097_000,
      differenceCents: 220_000,
      unavailableReason: null,
    });
    expect(result.assumptions.join(' ')).toMatch(/Federal ordinary income tax only/);
    expect(result.disclaimer).toMatch(/Estimates/);
    // Credits are taken off both.
    expect(
      CalculatorResult.parse(
        ok(
          await calc({
            baseline: { ...baseline, creditsCents: 200_000 },
            strategy: { additionalCreditCents: 50_000 },
          }),
        ),
      ),
    ).toMatchObject({
      baselineTaxCents: 1_117_000,
      modeledTaxCents: 1_067_000,
      differenceCents: 50_000,
    });
    // Married filing jointly has its own bands and deduction: $100,000 - $32,200 = $67,800, taxed
    // 10% on $24,800 and 12% on $43,000.
    expect(
      CalculatorResult.parse(ok(await calc({ filingStatus: 'MARRIED_FILING_JOINTLY' })))
        .baselineTaxCents,
    ).toBe(248_000 + 516_000);

    for (const [over, reason] of [
      [{ filingStatus: undefined }, /filing status/],
      [{ taxYear: 2030 }, /Tax tables for 2030/],
      [{ baseline: {} }, /income figure/],
      [{ baseline: { wagesCents: 1, capitalGainsCents: 5 } }, /Capital gains/],
    ] as const) {
      const r = CalculatorResult.parse(ok(await calc(over)));
      expect(r.differenceCents, reason.source).toBeNull();
      expect(r.unavailableReason).toMatch(reason);
    }
    expect(
      CalculatorResult.parse(
        ok(await calc({ baseline: { ...baseline, state: 'GA' } })),
      ).assumptions.join(' '),
    ).toMatch(/State tax for GA is not modelled/);
    expectError(await calc({ baseline: { wagesCents: -1 } }), 400, 'VALIDATION_FAILED');
    expectError(await calc({ surprise: 1 }), 400, 'VALIDATION_FAILED');
    expectError(await calc({ clientId: clients.c2 }, staffA), 404, 'NOT_FOUND');
    expectError(await calc({}, preparerA), 403, 'FORBIDDEN');
    expectError(
      await call('get', '/calculator/scenarios', preparerA),
      403,
      'FINANCIAL_INPUTS_RESTRICTED',
    );
  });

  it('saves scenarios, to a plan as snapshots, and shows them only to who may see them', async () => {
    const standalone = TaxScenario.parse(
      ok(
        await call('post', '/calculator/scenarios', ownerA, {
          name: mark('What if'),
          calculation: {
            taxYear: 2026,
            filingStatus: 'SINGLE',
            baseline,
            strategy: { hsaContributionCents: 430_000 },
          },
        }),
        201,
      ),
    );
    expect(standalone).toMatchObject({
      client: null,
      plan: null,
      savedToPlanAt: null,
      baseline,
      strategy: { hsaContributionCents: 430_000 },
      result: { unavailableReason: null },
    });
    expect(standalone.result.differenceCents).toBe(
      (standalone.result.baselineTaxCents ?? 0) - (standalone.result.modeledTaxCents ?? 0),
    );

    const toPlan = TaxScenario.parse(
      ok(
        await call('post', '/calculator/scenarios', staffA, {
          planId: shared.planId,
          calculation: {
            taxYear: 2026,
            filingStatus: 'SINGLE',
            baseline,
            strategy: { retirementContributionCents: 1_000_000 },
          },
        }),
        201,
      ),
    );
    expect(toPlan).toMatchObject({
      client: { id: clients.c1 },
      plan: { id: shared.planId },
      result: { differenceCents: 220_000 },
    });
    expect(toPlan.savedToPlanAt).not.toBeNull();
    expectError(
      await call('post', '/calculator/scenarios', ownerA, {
        planId: shared.planId,
        calculation: {
          clientId: clients.c2,
          taxYear: 2026,
          filingStatus: 'SINGLE',
          baseline,
          strategy: {},
        },
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', '/calculator/scenarios', staffA, {
        planId: randomUUID(),
        calculation: { taxYear: 2026, baseline, strategy: {} },
      }),
      404,
      'NOT_FOUND',
    );

    // An unavailable result is kept as unavailable, with the reason.
    const unavailable = TaxScenario.parse(
      ok(
        await call('post', '/calculator/scenarios', ownerA, {
          calculation: { taxYear: 2030, filingStatus: 'SINGLE', baseline, strategy: {} },
        }),
        201,
      ),
    );
    expect(unavailable.result).toMatchObject({ baselineTaxCents: null, differenceCents: null });
    expect(unavailable.result.unavailableReason).toMatch(/2030/);

    // Staff see their clients' and their own; Owner sees all; firm B none; the audit log no figures.
    const staffList = TaxScenarioPage.parse(ok(await call('get', '/calculator/scenarios', staffA)));
    expect(staffList.items.map((s) => s.id)).toEqual([toPlan.id]);
    const ownerList = TaxScenarioPage.parse(ok(await call('get', '/calculator/scenarios', ownerA)));
    expect(ownerList.items.map((s) => s.id)).toEqual(
      expect.arrayContaining([standalone.id, toPlan.id, unavailable.id]),
    );
    expect(
      TaxScenarioPage.parse(
        ok(await call('get', `/calculator/scenarios?planId=${shared.planId}`, ownerA)),
      ).items.map((s) => s.id),
    ).toEqual([toPlan.id]);
    expectError(
      await call('get', `/calculator/scenarios/${standalone.id}`, staffA),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('get', `/calculator/scenarios/${standalone.id}`, ownerB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
    expect(
      TaxScenario.parse(ok(await call('get', `/calculator/scenarios/${toPlan.id}`, staffA))).id,
    ).toBe(toPlan.id);
    expect(JSON.stringify(await auditRows(toPlan.id))).not.toMatch(/1317000|10000000|220000/);
  });
});

describe('the overview, Clients tab, calendar and resources', () => {
  it('shows the overview, to Staff for their clients only', async () => {
    const overview = TaxPlanningOverview.parse(ok(await call('get', '/overview', ownerA)));
    expect(overview.activePlanningClients.value).toBeGreaterThanOrEqual(3);
    expect(overview.recentClients.length).toBeLessThanOrEqual(5);
    expect(overview.recentClients[0]?.planId).toBeTruthy();
    expect(overview.deadlines.map((d) => d.kind)).toContain('PLANNING_MILESTONE');
    expect(overview.resources).toHaveLength(5);
    expect(overview).toMatchObject({ canCreatePlan: true, canSend: true });
    expect(overview.disclaimer).toMatch(/Estimates/);
    expect(overview.projectedSavings.value).toBeGreaterThan(0);

    const staffView = TaxPlanningOverview.parse(ok(await call('get', '/overview', staffA)));
    expect(staffView.recentClients.every((r) => r.client.id === clients.c1)).toBe(true);
    expect(staffView.activePlanningClients.value).toBe(1);
    const reader = TaxPlanningOverview.parse(ok(await call('get', '/overview', preparerA)));
    expect(reader).toMatchObject({ canCreatePlan: false, canSend: false });
    const b = TaxPlanningOverview.parse(ok(await call('get', '/overview', ownerB, undefined, 'b')));
    // Firm B has the one plan the opportunity test made there, and none of firm A's.
    expect(b.activePlanningClients.value).toBe(1);
    expect(b.recentClients.map((r) => r.client.id)).toEqual([clients.cB]);
    expect(b.topOpportunities).toEqual([]);
  });

  it('lists the clients in planning with filters and sorting', async () => {
    const all = PlanningClientPage.parse(ok(await call('get', '/clients?pageSize=100', ownerA)));
    expect(all.items.map((r) => r.client.id)).toEqual(
      expect.arrayContaining([clients.c1, clients.c2, clients.c3, clients.c4]),
    );
    const none = PlanningClientPage.parse(ok(await call('get', '/clients?hasPlan=false', ownerA)));
    expect(none.items.map((r) => r.client.id)).toContain(clients.c4);
    expect(none.items.every((r) => r.planId === null)).toBe(true);
    const c1 = all.items.find((r) => r.client.id === clients.c1);
    expect(c1).toMatchObject({
      status: 'IN_PROGRESS',
      planYear: 2026,
      entityLabel: 'Individual',
    });
    expect(c1?.openOpportunities).toBeGreaterThanOrEqual(1);
    expect(all.items.find((r) => r.client.id === clients.c2)?.entityLabel).toBe('Business');
    const byStatus = PlanningClientPage.parse(
      ok(await call('get', '/clients?status=IN_PROGRESS', ownerA)),
    );
    expect(byStatus.items.every((r) => r.status === 'IN_PROGRESS')).toBe(true);
    const bySavings = PlanningClientPage.parse(
      ok(await call('get', '/clients?sort=savings&direction=desc&pageSize=100', ownerA)),
    );
    const figures = bySavings.items.map((r) => r.potentialSavingsCents);
    const known = figures.filter((f): f is number => f !== null);
    expect(known).toEqual([...known].sort((x, y) => y - x));
    expect(figures.slice(known.length).every((f) => f === null)).toBe(true);
    const paged = PlanningClientPage.parse(
      ok(await call('get', '/clients?pageSize=1&page=2', ownerA)),
    );
    expect(paged).toMatchObject({ page: 2, pageSize: 1 });
    expect(paged.items).toHaveLength(1);
    expect(
      PlanningClientPage.parse(ok(await call('get', '/clients?search=jamie', ownerA))).items.map(
        (r) => r.client.id,
      ),
    ).toEqual([clients.c1]);
    const staffClients = PlanningClientPage.parse(ok(await call('get', '/clients', staffA)));
    expect(staffClients.items.map((r) => r.client.id)).toEqual([clients.c1]);
    const bClients = PlanningClientPage.parse(
      ok(await call('get', '/clients', ownerB, undefined, 'b')),
    );
    expect(bClients.items.map((r) => r.client.id)).toEqual([clients.cB]);
    expectError(await call('get', '/clients?status=NOPE', ownerA), 400, 'VALIDATION_FAILED');
  });

  it('shows tax deadlines and planning milestones in a range', async () => {
    const name = `Form 1040 ${run}`;
    await inFirm('a', async (tx) => {
      for (const clientId of [clients.c1, clients.c2]) {
        await tx.complianceDeadline.create({
          data: {
            businessId: firms.a,
            clientId,
            name,
            type: 'TAX_FILING',
            dueOn: new Date(`${day(20)}T00:00:00.000Z`),
          },
        });
      }
      await tx.complianceDeadline.create({
        data: {
          businessId: firms.a,
          clientId: clients.c1,
          name: `Payroll ${run}`,
          type: 'PAYROLL',
          dueOn: new Date(`${day(21)}T00:00:00.000Z`),
        },
      });
    });
    const range = `from=${day(0)}&to=${day(60)}`;
    const owner = PlanningCalendar.parse(ok(await call('get', `/calendar?${range}`, ownerA))).items;
    const filing = owner.filter((d) => d.title === name);
    expect(filing).toHaveLength(1);
    expect(filing[0]).toMatchObject({
      kind: 'TAX_DEADLINE',
      date: day(20),
      scope: 'Business & Individual Clients (2)',
    });
    expect(owner.some((d) => d.title.startsWith('Payroll'))).toBe(false);
    expect(owner.filter((d) => d.kind === 'PLANNING_MILESTONE').length).toBeGreaterThan(0);
    expect(owner.map((d) => d.date)).toEqual([...owner.map((d) => d.date)].sort());
    const staff = PlanningCalendar.parse(ok(await call('get', `/calendar?${range}`, staffA))).items;
    expect(staff.find((d) => d.title === name)?.scope).toBe('Individual Clients (1)');
    const one = PlanningCalendar.parse(
      ok(await call('get', `/calendar?${range}&clientId=${clients.c1}`, ownerA)),
    ).items;
    expect(one.find((d) => d.title === name)?.scope).toBeNull();
    expectError(
      await call('get', `/calendar?${range}&clientId=${clients.c2}`, staffA),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('get', `/calendar?from=${day(0)}&to=${day(500)}`, ownerA),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('get', `/calendar?from=${day(5)}&to=${day(0)}`, ownerA),
      400,
      'VALIDATION_FAILED',
    );
    expect(
      PlanningCalendar.parse(ok(await call('get', `/calendar?${range}`, ownerB, undefined, 'b')))
        .items,
    ).toEqual([]);
  });

  it('lists the approved resources and sends a client-facing one to a client', async () => {
    const all = PlanningResourceList.parse(ok(await call('get', '/resources', staffA))).items;
    expect(all.length).toBeGreaterThanOrEqual(5);
    expect(all.some((r) => !r.clientFacing)).toBe(true);
    expect(
      PlanningResourceList.parse(
        ok(await call('get', '/resources?kind=CHECKLIST', staffA)),
      ).items.every((r) => r.kind === 'CHECKLIST'),
    ).toBe(true);
    expect(
      PlanningResourceList.parse(ok(await call('get', '/resources?search=retirement', staffA)))
        .items,
    ).toHaveLength(1);

    const key = 'year-end-planning-checklist';
    const sent = OkResponse.parse(
      ok(
        await call('post', `/resources/${key}/send`, staffA, {
          clientId: clients.c1,
          channel: 'PORTAL_MESSAGE',
          message: 'For our meeting (fake)',
        }),
      ),
    );
    expect(sent.ok).toBe(true);
    const thread = await inFirm('a', (tx) =>
      tx.messageThread.findFirstOrThrow({
        where: { clientId: clients.c1, subject: 'Year-End Tax Planning Checklist' },
        include: { messages: true },
      }),
    );
    expect(thread.messages[0]?.body).toMatch(/For our meeting/);
    expectError(
      await call('post', '/resources/staff-screening-rules-reference/send', ownerA, {
        clientId: clients.c1,
        channel: 'EMAIL',
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', '/resources/no-such-resource/send', ownerA, {
        clientId: clients.c1,
        channel: 'EMAIL',
      }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', `/resources/${key}/send`, staffA, {
        clientId: clients.c2,
        channel: 'EMAIL',
      }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', `/resources/${key}/send`, preparerA, {
        clientId: clients.c3,
        channel: 'EMAIL',
      }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('post', `/resources/${key}/send`, ownerA, {
        clientId: clients.cB,
        channel: 'EMAIL',
      }),
      404,
      'NOT_FOUND',
    );
  });
});
