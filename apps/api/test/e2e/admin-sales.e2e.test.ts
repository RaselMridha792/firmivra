// End-to-end: R60, Super Admin Sales on R0's B5 and D1 tables. Every route under
// /api/v1/admin/sales: the pickers and plans, Add Lead with the duplicate check, edits, stage
// moves (required fields, lost reasons, the transaction lock), owners, bulk actions, the linked
// subscription, outreach, notes, follow-ups (and the Appointment Set move), the pipeline builder,
// tags, the attention settings, targets, the KPIs, analytics, Recent Activity and the report. The
// numbers are checked on a pipeline of this run's own. A firm's session reaches none of it.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  SalesAttentionSettings,
  SalesCenterSummary,
  SalesFeedList,
  SalesFollowUp,
  SalesFollowUpList,
  SalesLeadSources,
  SalesMeta,
  SalesNote,
  SalesOpportunity,
  SalesOpportunityPage,
  SalesOpportunityRecord,
  SalesPipeline,
  SalesPipelineList,
  SalesPipelineSummary,
  SalesPlanList,
  SalesRevenueByPlan,
  SalesStageCounts,
  SalesSubscriptionList,
  SalesTag,
  SalesTarget,
  SalesTargetList,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE } from '../../src/notify/notify.types.js';

const fx = inject('fixtures');
const BASE = '/api/v1/admin/sales';
const run = randomUUID().slice(0, 8);
const RUN = run.toUpperCase().replace(/[^A-Z0-9]/g, 'X');
const rep = { id: randomUUID(), email: `r60-sales-rep-${run}@firmivra.test` };
/** A team member outside Revenue / Sales, with no org-chart row yet: a rep too. */
const member = { id: randomUUID(), email: `r60-sales-member-${run}@firmivra.test` };
const ids = {
  plan: '',
  oldPlan: '',
  closedTeam: '',
  firmA: '',
  firmB: '',
  firmC: '',
  activeSub: '',
  trialSub: '',
  otherSub: '',
};

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.68.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;
const today = () => new Date().toISOString().slice(0, 10);
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const dayIn = (days: number) => inDays(days).slice(0, 10);

async function owner<T>(
  scope: 'platform' | 'admin',
  work: Parameters<typeof runInScope<T>>[2],
): Promise<T> {
  const client = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(
      client,
      scope === 'admin' ? { kind: 'admin', adminUserId: fx.users.admin.id } : { kind: 'platform' },
      work,
    );
  } finally {
    await client.$disconnect();
  }
}

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

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
async function call(
  method: Method,
  path: string,
  body?: object,
  email = fx.users.admin.email,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`${BASE}${path}`)
    .set('authorization', `Bearer ${await tokenFor(email)}`)
    .set('x-forwarded-for', viewer());
  return body === undefined ? req : req.send(body);
}
const code = (res: Response) => (res.body as { error?: { code?: string } }).error?.code;
const expectStatus = (res: Response, status: number) =>
  expect(res.status, JSON.stringify(res.body)).toBe(status);

let leads = 0;
/** A new record (unique firm and email), as Add Lead sends it. */
async function lead(over: Record<string, unknown> = {}): Promise<SalesOpportunity> {
  leads += 1;
  const res = await call('post', '/opportunities', {
    requestId: randomUUID(),
    firmName: `Fake Firm ${run} ${leads}`,
    contactName: `Fake Contact ${leads}`,
    email: `fake-${run}-${leads}@example.test`,
    source: 'WEBSITE',
    allowDuplicate: true,
    ...over,
  });
  expectStatus(res, 201);
  return SalesOpportunity.parse(res.body);
}
const record = async (id: string) =>
  SalesOpportunityRecord.parse((await call('get', `/opportunities/${id}`)).body);
const stageOf = (p: SalesPipeline, name: string) => p.stages.find((s) => s.name === name)!;

let shipped: SalesPipeline;
/** This run's own pipeline (the Firmivra layout): the numbers below count only its records. */
let mine: SalesPipeline;
const r: Record<'alpha' | 'beta' | 'gamma' | 'delta', SalesOpportunity> = {} as never;

beforeAll(async () => {
  await owner('platform', async (tx) => {
    const sales = await tx.platformDepartment.upsert({
      where: { code: 'REVENUE_SALES' },
      create: { code: 'REVENUE_SALES', name: 'Revenue / Sales' },
      update: {},
    });
    const role = await tx.platformRoleDefinition.upsert({
      where: { code: 'REVENUE_SALES_SALES_MANAGER' },
      create: {
        code: 'REVENUE_SALES_SALES_MANAGER',
        title: 'Sales Manager',
        level: 'MANAGER',
        departmentId: sales.id,
        defaultScopeType: 'TEAM',
      },
      update: {},
    });
    await tx.user.create({
      data: {
        id: rep.id,
        cognitoSub: rep.id,
        pool: 'ADMIN',
        email: rep.email,
        name: 'Fake Sales Rep',
      },
    });
    await tx.platformAdmin.create({ data: { userId: rep.id, role: 'TEAM_MEMBER' } });
    await tx.user.create({
      data: {
        id: member.id,
        cognitoSub: member.id,
        pool: 'ADMIN',
        email: member.email,
        name: 'Fake Team Member',
      },
    });
    await tx.platformAdmin.create({ data: { userId: member.id, role: 'TEAM_MEMBER' } });
    await tx.platformMember.create({
      data: {
        userId: rep.id,
        roleDefinitionId: role.id,
        departmentId: sales.id,
        scopeType: 'OWN_RECORDS',
        status: 'ACTIVE',
      },
    });
    ids.closedTeam = (
      await tx.platformDepartment.create({
        data: { code: `CLOSED_${RUN}`, name: `Fake closed team ${run}`, isActive: false },
      })
    ).id;
    for (const key of ['firmA', 'firmB', 'firmC'] as const)
      ids[key] = (
        await tx.business.create({
          data: {
            slug: `sales-${run}-${key.toLowerCase()}`,
            name: `Fake Sales ${key} ${run}`,
            status: 'ACTIVE',
          },
        })
      ).id;
    await tx.salesAttentionSettings.update({
      where: { id: 1 },
      data: {
        noContactHours: 24,
        followUpDueHours: 24,
        noResponseAttempts: 3,
        noActivityDays: 14,
        ownerRequired: true,
        lostOtherNoteRequired: true,
      },
    });
  });
  await owner('admin', async (tx) => {
    ids.plan = (
      await tx.platformPlan.create({
        data: {
          code: `FAKE_${RUN}`,
          name: `Fake Plan ${run}`,
          basePriceCents: 19_900,
          includedSeats: 3,
          maxSeats: 10,
          overagePriceCentsPerSeat: 2_900,
          displayOrder: 900,
          features: { create: [{ featureKey: 'fake_feature', label: 'Fake feature' }] },
        },
      })
    ).id;
    ids.oldPlan = (
      await tx.platformPlan.create({
        data: {
          code: `FAKE_OLD_${RUN}`,
          name: `Fake Old Plan ${run}`,
          basePriceCents: 100,
          includedSeats: 1,
          displayOrder: 901,
          isActive: false,
        },
      })
    ).id;
    const sub = (businessId: string, data: Record<string, unknown>) =>
      tx.platformFirmSubscription.create({
        data: { businessId, planId: ids.plan, seatsIncluded: 3, ...data },
      });
    ids.activeSub = (await sub(ids.firmA, { status: 'ACTIVE', priceCentsOverride: 15_000 })).id;
    ids.trialSub = (
      await sub(ids.firmB, {
        status: 'TRIAL',
        trialStartedAt: new Date(Date.now() - 60_000),
        trialEndsAt: new Date(Date.now() + 14 * 86_400_000),
      })
    ).id;
    ids.otherSub = (await sub(ids.firmC, { status: 'TRIAL' })).id;
  });
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({ send: () => Promise.resolve() })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
  const pipelines = SalesPipelineList.parse((await call('get', '/pipelines')).body).items;
  shipped = pipelines.find((p) => p.isDefault)!;
});

afterAll(async () => {
  await app.close();
});

describe('the pickers', () => {
  it('a firm Owner’s session gets 401', async () => {
    expect((await call('get', '/meta', undefined, fx.users.ownerA.email)).status).toBe(401);
    expect((await call('get', '/opportunities', undefined, fx.users.ownerA.email)).status).toBe(
      401,
    );
  });

  it('GET /meta: every right, the reps, the plans and the default pipeline', async () => {
    const meta = SalesMeta.parse((await call('get', '/meta')).body);
    expect(meta.me.id).toBe(fx.users.admin.id);
    expect(Object.values(meta.permissions).every(Boolean)).toBe(true);
    expect(meta.recordScope).toBe('COMPANY');
    expect(meta.reps.find((r) => r.id === rep.id)).toMatchObject({
      role: 'Sales Manager',
      active: true,
    });
    expect(meta.reps.find((r) => r.id === fx.users.admin.id)?.active).toBe(true);
    expect(meta.reps.find((r) => r.id === member.id)).toMatchObject({
      role: 'Team member',
      active: true,
    });
    expect(meta.plans.find((p) => p.id === ids.plan)).toMatchObject({
      code: `FAKE_${RUN}`,
      active: true,
    });
    expect(meta.defaultPipelineId).toBe(shipped.id);
    expect(meta.today).toBe(today());
    expect(meta.teams.some((t) => t.id === ids.closedTeam)).toBe(false);
    expect(meta.attention).toMatchObject({ noContactHours: 24, lostOtherNoteRequired: true });
  });

  it('GET /plans: the ladder with features', async () => {
    const plans = SalesPlanList.parse((await call('get', '/plans')).body).items;
    expect(plans.find((p) => p.id === ids.plan)).toMatchObject({
      priceCents: 19_900,
      includedSeats: 3,
      maxSeats: 10,
      seatPriceCents: 2_900,
      features: [{ key: 'fake_feature', label: 'Fake feature' }],
    });
  });

  it('GET /pipelines: the shipped pipeline with its ten stages and keys', async () => {
    expect(shipped.stages.map((s) => s.systemKey)).toEqual([
      'new_lead',
      'attempted_contact',
      'contacted',
      'qualified',
      'appointment_set',
      'nurturing',
      'active_client',
      'under_contract',
      'closed_past_client',
      'unqualified_lost',
    ]);
    expect(stageOf(shipped, 'Under Contract')).toMatchObject({
      type: 'TRANSACTION_SYNCED',
      requires: ['TRANSACTION'],
      tone: 'teal',
    });
  });
});

describe('the pipeline builder', () => {
  it('POST /pipelines: the Firmivra layout (without the shipped keys) or New, Won, Lost', async () => {
    const res = await call('post', '/pipelines', { name: `Fake Pipeline ${run}` });
    expectStatus(res, 201);
    mine = SalesPipeline.parse(res.body);
    expect(mine.stages.map((s) => s.name)).toEqual(shipped.stages.map((s) => s.name));
    expect(mine.stages.every((s) => s.systemKey === null)).toBe(true);
    expect(mine.terminatedReturnStageId).toBe(stageOf(mine, 'Active Client').id);
    const basic = SalesPipeline.parse(
      (await call('post', '/pipelines', { name: `Fake Basic ${run}`, template: 'BASIC' })).body,
    );
    expect(basic.stages.map((s) => [s.name, s.type])).toEqual([
      ['New', 'ACTIVE'],
      ['Won', 'CONVERTED'],
      ['Lost', 'LOST'],
    ]);
    const twice = await call('post', '/pipelines', { name: `fake pipeline ${run}` });
    expect([twice.status, code(twice)]).toEqual([409, 'DUPLICATE_NAME']);
  });

  it('PUT /pipelines/:id: renames, reorders, adds, and moves records out of a removed stage', async () => {
    let p = SalesPipeline.parse(
      (await call('post', '/pipelines', { name: `Fake Builder ${run}`, template: 'BASIC' })).body,
    );
    const [newStage, won, lost] = p.stages as [
      SalesPipeline['stages'][number],
      SalesPipeline['stages'][number],
      SalesPipeline['stages'][number],
    ];
    const held = await lead({ pipelineId: p.id });
    p = SalesPipeline.parse(
      (await call('get', '/pipelines')).body.items.find((x: SalesPipeline) => x.id === p.id),
    );
    const layout = (stages: object[], removed: object[] = []) => ({
      expectedUpdatedAt: p.updatedAt,
      name: `Fake Builder ${run} renamed`,
      stages,
      removed,
    });
    const keep = [
      { id: newStage.id, name: 'New', type: 'ACTIVE', active: true },
      { name: 'Proposal', type: 'ACTIVE', active: true, requires: ['VALUE'] },
      { name: 'Call back', type: 'ACTIVE', active: true, onEnter: ['CREATE_FOLLOW_UP'] },
      { id: won.id, name: 'Won deal', type: 'CONVERTED', active: true },
      { id: lost.id, name: 'Lost', type: 'LOST', active: true },
    ];
    const stale = await call('put', `/pipelines/${p.id}`, {
      ...layout(keep),
      expectedUpdatedAt: shipped.updatedAt,
    });
    expect([stale.status, code(stale)]).toEqual([409, 'CONFLICT']);
    const notYet = await call(
      'put',
      `/pipelines/${p.id}`,
      layout([
        ...keep.slice(0, 2),
        { name: 'Ping', type: 'ACTIVE', active: true, onEnter: ['NOTIFY_OWNER'] },
        ...keep.slice(3),
      ]),
    );
    expect([notYet.status, code(notYet)]).toEqual([422, 'NOT_SUPPORTED_YET']);
    const retype = await call(
      'put',
      `/pipelines/${p.id}`,
      layout([{ ...keep[0], type: 'CONVERTED' }, ...keep.slice(1)]),
    );
    expect([retype.status, code(retype)]).toEqual([422, 'STAGE_HAS_RECORDS']);
    const saved = SalesPipeline.parse((await call('put', `/pipelines/${p.id}`, layout(keep))).body);
    expect(saved.name).toBe(`Fake Builder ${run} renamed`);
    expect(saved.stages.map((s) => [s.name, s.position, s.records])).toEqual([
      ['New', 0, 1],
      ['Proposal', 1, 0],
      ['Call back', 2, 0],
      ['Won deal', 3, 0],
      ['Lost', 4, 0],
    ]);
    p = saved;
    const after = keep.slice(1).map((s, i) => ({ ...s, id: saved.stages[i + 1]!.id }));
    const noTarget = await call('put', `/pipelines/${p.id}`, layout(after));
    expect([noTarget.status, code(noTarget)]).toEqual([422, 'STAGE_HAS_RECORDS']);
    const needsValue = await call(
      'put',
      `/pipelines/${p.id}`,
      layout(after, [{ id: newStage.id, moveTo: after[0]!.id }]),
    );
    expect([needsValue.status, code(needsValue)]).toEqual([422, 'VALUE_REQUIRED']);
    const moved = SalesPipeline.parse(
      (
        await call(
          'put',
          `/pipelines/${p.id}`,
          layout(after, [{ id: newStage.id, moveTo: after[2]!.id }]),
        )
      ).body,
    );
    expect(moved.stages.map((s) => [s.name, s.records])).toEqual([
      ['Proposal', 0],
      ['Call back', 0],
      ['Won deal', 1],
      ['Lost', 0],
    ]);
    const history = await record(held.id);
    expect(history.opportunity.stageName).toBe('Won deal');
    expect(history.activity.find((e) => e.kind === 'WON')).toMatchObject({
      fromStage: 'New',
      toStage: 'Won deal',
    });
    // Entering "Call back" runs its action: a follow-up for the owner.
    const callBack = moved.stages.find((s) => s.name === 'Call back')!;
    const caller = await lead({ pipelineId: p.id, stageId: callBack.id });
    expect((await record(caller.id)).followUps.map((f) => f.title)).toEqual([
      'Follow up: Call back',
    ]);
  });

  it('PUT /pipelines/:id: a shipped stage is switched off, never removed', async () => {
    const res = await call('put', `/pipelines/${shipped.id}`, {
      expectedUpdatedAt: shipped.updatedAt,
      name: shipped.name,
      description: shipped.description,
      stages: shipped.stages
        .filter((s) => s.systemKey !== 'nurturing')
        .map((s) => ({
          id: s.id,
          name: s.name,
          type: s.type,
          active: s.active,
          requires: s.requires,
        })),
    });
    expect([res.status, code(res)]).toEqual([422, 'SHIPPED_STAGE']);
  });
});

describe('records', () => {
  it('POST /opportunities: creates a record, once per request id', async () => {
    const body = {
      requestId: randomUUID(),
      pipelineId: mine.id,
      firmName: `Fake Alpha ${run}`,
      contactName: 'Fake Avery',
      email: `Fake-Alpha-${run}@Example.TEST`,
      phone: '(555) 010-0123',
      source: 'REFERRAL',
      planId: ids.plan,
      valueCents: 120_000,
      ownerId: rep.id,
      note: 'Fake first call booked.',
    };
    const res = await call('post', '/opportunities', body);
    expectStatus(res, 201);
    r.alpha = SalesOpportunity.parse(res.body);
    expect(r.alpha).toMatchObject({
      stageName: 'New Lead',
      email: `fake-alpha-${run}@example.test`,
      phone: '+15550100123',
      plan: { id: ids.plan, priceCents: 19_900 },
      owner: { id: rep.id },
      attention: [],
    });
    const again = await call('post', '/opportunities', body);
    expect((again.body as SalesOpportunity).id).toBe(r.alpha.id);
    expect((await record(r.alpha.id)).notes.map((n) => n.body)).toEqual([
      'Fake first call booked.',
    ]);
  });

  it('POST /opportunities/duplicate-check and the 409 on Add Lead', async () => {
    const res = await call('post', '/opportunities/duplicate-check', {
      email: `fake-alpha-${run}@example.test`,
      phone: '5550100123',
      firmName: `FAKE ALPHA ${run}`,
    });
    expectStatus(res, 200);
    expect(
      (res.body as { items: { opportunityId: string; matchedOn: string[] }[] }).items[0],
    ).toMatchObject({
      opportunityId: r.alpha.id,
      matchedOn: ['EMAIL', 'PHONE', 'FIRM_NAME'],
    });
    const dup = await call('post', '/opportunities', {
      requestId: randomUUID(),
      firmName: `Fake Alpha ${run}`,
      contactName: 'Fake Someone',
      email: `fake-other-${run}@example.test`,
      source: 'WEBSITE',
    });
    expect([dup.status, code(dup)]).toEqual([409, 'POSSIBLE_DUPLICATE']);
  });

  it('POST /opportunities: refuses what the starting stage or the pickers refuse', async () => {
    const base = {
      requestId: randomUUID(),
      firmName: `Fake Refused ${run}`,
      contactName: 'Fake',
      email: `refused-${run}@example.test`,
      source: 'EVENT',
      allowDuplicate: true,
    };
    const tries: [object, number, string][] = [
      [{ stageId: stageOf(shipped, 'Unqualified / Lost').id }, 422, 'LOST_REASON_REQUIRED'],
      [
        { stageId: stageOf(shipped, 'Unqualified / Lost').id, lostReason: 'OTHER' },
        422,
        'LOST_NOTE_REQUIRED',
      ],
      [{ stageId: stageOf(shipped, 'Under Contract').id }, 422, 'TRANSACTION_LOCKED'],
      [{ lostReason: 'BUDGET' }, 422, 'LOST_REASON_NOT_ALLOWED'],
      [{ ownerId: randomUUID() }, 422, 'INACTIVE_CHOICE'],
      [{ planId: ids.oldPlan }, 422, 'INACTIVE_CHOICE'],
      [{ tagIds: [randomUUID()] }, 422, 'INACTIVE_CHOICE'],
      [{ stageId: stageOf(mine, 'New Lead').id }, 422, 'INACTIVE_CHOICE'],
      [{ email: '', phone: '' }, 400, 'VALIDATION_FAILED'],
    ];
    for (const [over, status, c] of tries) {
      const res = await call('post', '/opportunities', {
        ...base,
        requestId: randomUUID(),
        ...over,
      });
      expect([res.status, code(res)], JSON.stringify(over)).toEqual([status, c]);
    }
  });

  it('PATCH /opportunities/:id: the record and its contact, field by field', async () => {
    const tag = SalesTag.parse((await call('post', '/tags', { name: `Fake Hot ${run}` })).body);
    const res = await call('patch', `/opportunities/${r.alpha.id}`, {
      contactName: 'Fake Avery Example',
      phone: '',
      tagIds: [tag.id],
    });
    expectStatus(res, 200);
    expect(SalesOpportunity.parse(res.body)).toMatchObject({
      contactName: 'Fake Avery Example',
      phone: null,
      tags: [{ id: tag.id }],
      valueCents: 120_000,
    });
    const bad = await call('patch', `/opportunities/${r.alpha.id}`, { planId: ids.oldPlan });
    expect([bad.status, code(bad)]).toEqual([422, 'INACTIVE_CHOICE']);
    expect(
      (await call('patch', `/opportunities/${randomUUID()}`, { source: 'EVENT' })).status,
    ).toBe(404);
    expect((await call('patch', `/opportunities/${r.alpha.id}`, {})).status).toBe(400);
  });

  it('POST /opportunities/:id/stage: required fields, lost reasons, and conversion', async () => {
    r.beta = await lead({ pipelineId: mine.id, firmName: `Fake Beta ${run}`, ownerId: rep.id });
    const lost = stageOf(mine, 'Unqualified / Lost').id;
    const noReason = await call('post', `/opportunities/${r.beta.id}/stage`, { stageId: lost });
    expect([noReason.status, code(noReason)]).toEqual([422, 'LOST_REASON_REQUIRED']);
    const other = await call('post', `/opportunities/${r.beta.id}/stage`, {
      stageId: lost,
      lostReason: 'OTHER',
    });
    expect([other.status, code(other)]).toEqual([422, 'LOST_NOTE_REQUIRED']);
    const wrongPipe = await call('post', `/opportunities/${r.beta.id}/stage`, {
      stageId: stageOf(shipped, 'Contacted').id,
    });
    expect([wrongPipe.status, code(wrongPipe)]).toEqual([422, 'INACTIVE_CHOICE']);
    const res = await call('post', `/opportunities/${r.beta.id}/stage`, {
      stageId: lost,
      lostReason: 'BUDGET',
    });
    expectStatus(res, 200);
    expect(SalesOpportunity.parse(res.body)).toMatchObject({
      stageType: 'LOST',
      lostReason: 'BUDGET',
      attention: [],
    });
    const won = SalesOpportunity.parse(
      (
        await call('post', `/opportunities/${r.alpha.id}/stage`, {
          stageId: stageOf(mine, 'Active Client').id,
        })
      ).body,
    );
    expect(won.stageType).toBe('CONVERTED');
    expect(won.convertedAt).not.toBeNull();
    const same = await call('post', `/opportunities/${r.alpha.id}/stage`, {
      stageId: stageOf(mine, 'Active Client').id,
    });
    expect((same.body as SalesOpportunity).stageEnteredAt).toBe(won.stageEnteredAt);
  });

  it('POST /opportunities/:id/assign: owners, with the history', async () => {
    r.gamma = await lead({
      pipelineId: mine.id,
      firmName: `Fake Gamma ${run}`,
      valueCents: 50_000,
    });
    expect(r.gamma.attention).toEqual(['UNASSIGNED']);
    const res = await call('post', `/opportunities/${r.gamma.id}/assign`, { ownerId: rep.id });
    expectStatus(res, 200);
    expect(SalesOpportunity.parse(res.body)).toMatchObject({
      owner: { id: rep.id },
      attention: [],
    });
    const bad = await call('post', `/opportunities/${r.gamma.id}/assign`, {
      ownerId: fx.users.ownerA.id,
    });
    expect([bad.status, code(bad)]).toEqual([422, 'INACTIVE_CHOICE']);
    const feed = (await record(r.gamma.id)).activity;
    expect(feed.find((e) => e.kind === 'ASSIGNED')).toMatchObject({
      toOwner: 'Fake Sales Rep',
      source: 'MANUAL',
    });
  });

  it('POST /opportunities/:id/transaction: link, follow the subscription, and the lock', async () => {
    const res = await call('post', `/opportunities/${r.alpha.id}/transaction`, {
      subscriptionId: ids.activeSub,
    });
    expectStatus(res, 200);
    const linked = SalesOpportunity.parse(res.body);
    expect(linked).toMatchObject({
      stageName: 'Under Contract',
      stageType: 'TRANSACTION_SYNCED',
      transaction: { kind: 'PLATFORM_SUBSCRIPTION', id: ids.activeSub, status: 'UNDER_CONTRACT' },
      firm: { id: ids.firmA },
    });
    const byHand = await call('post', `/opportunities/${r.alpha.id}/stage`, {
      stageId: stageOf(mine, 'Nurturing').id,
    });
    expect([byHand.status, code(byHand)]).toEqual([422, 'TRANSACTION_LOCKED']);
    const unlink = await call('post', `/opportunities/${r.alpha.id}/transaction`, {
      subscriptionId: null,
    });
    expect([unlink.status, code(unlink)]).toEqual([409, 'UNLINK_UNDER_CONTRACT']);
    const inUse = await call('post', `/opportunities/${r.gamma.id}/transaction`, {
      subscriptionId: ids.activeSub,
    });
    expect([inUse.status, code(inUse)]).toEqual([409, 'TRANSACTION_IN_USE']);
    const trial = SalesOpportunity.parse(
      (
        await call('post', `/opportunities/${r.gamma.id}/transaction`, {
          subscriptionId: ids.trialSub,
        })
      ).body,
    );
    expect(trial).toMatchObject({
      stageName: 'New Lead',
      transaction: { status: 'OPEN' },
      trial: { active: true },
    });
    const mismatch = await call('post', `/opportunities/${r.gamma.id}/transaction`, {
      subscriptionId: ids.otherSub,
    });
    expect([mismatch.status, code(mismatch)]).toEqual([422, 'FIRM_MISMATCH']);
    const basic = SalesPipelineList.parse((await call('get', '/pipelines')).body).items.find(
      (p) => p.name === `Fake Basic ${run}`,
    )!;
    const noSync = await lead({ pipelineId: basic.id });
    const refused = await call('post', `/opportunities/${noSync.id}/transaction`, {
      subscriptionId: ids.otherSub,
    });
    expect([refused.status, code(refused)]).toEqual([422, 'SYNC_STAGE_REQUIRED']);
    const nothing = await call('post', `/opportunities/${noSync.id}/transaction`, {
      subscriptionId: null,
    });
    expectStatus(nothing, 200);
    const feed = (await record(r.alpha.id)).activity.map((e) => e.kind);
    expect(feed).toEqual(expect.arrayContaining(['CREATED', 'WON', 'UNDER_CONTRACT']));
  });

  it('GET /subscriptions: the picker, with what is already linked', async () => {
    const list = SalesSubscriptionList.parse(
      (await call('get', `/subscriptions?search=${encodeURIComponent(`Fake Sales firmA ${run}`)}`))
        .body,
    );
    expect(list.items).toEqual([
      expect.objectContaining({
        id: ids.activeSub,
        status: 'ACTIVE',
        linkedOpportunityId: r.alpha.id,
      }),
    ]);
  });

  it('POST /opportunities/:id/activities: outreach and the contact counters', async () => {
    let res = await call('post', `/opportunities/${r.gamma.id}/activities`, {
      kind: 'CALL',
      outcome: 'NO_ANSWER',
    });
    expectStatus(res, 201);
    expect(SalesOpportunity.parse(res.body)).toMatchObject({ attempts: 1, contactedAt: null });
    res = await call('post', `/opportunities/${r.gamma.id}/activities`, {
      kind: 'EMAIL',
      direction: 'INBOUND',
      summary: 'Fake reply about pricing',
    });
    expect(SalesOpportunity.parse(res.body)).toMatchObject({ attempts: 0 });
    expect((res.body as SalesOpportunity).contactedAt).not.toBeNull();
    const future = await call('post', `/opportunities/${r.gamma.id}/activities`, {
      kind: 'CALL',
      occurredAt: inDays(1),
    });
    expect(future.status).toBe(400);
    const otherFollowUp = await call('post', `/opportunities/${r.gamma.id}/activities`, {
      kind: 'CALL',
      followUpId: randomUUID(),
    });
    expect(otherFollowUp.status).toBe(404);
    const comms = (await record(r.gamma.id)).communications;
    expect(comms.map((c) => [c.kind, c.direction])).toEqual([
      ['EMAIL', 'INBOUND'],
      ['CALL', 'OUTBOUND'],
    ]);
  });

  it('POST /opportunities/:id/notes, PATCH and DELETE /notes/:id: only the author changes one', async () => {
    const res = await call('post', `/opportunities/${r.gamma.id}/notes`, { body: 'Fake note' });
    expectStatus(res, 201);
    const note = SalesNote.parse(res.body);
    expect(note).toMatchObject({ mine: true, author: { id: fx.users.admin.id } });
    const edited = await call('patch', `/notes/${note.id}`, { body: 'Fake note, edited' });
    expectStatus(edited, 200);
    expect(SalesNote.parse(edited.body).body).toBe('Fake note, edited');
    const theirs = await owner('platform', (tx) =>
      tx.salesNote.create({
        data: { opportunityId: r.gamma.id, authorUserId: rep.id, body: 'Fake rep note' },
      }),
    );
    const refused = await call('patch', `/notes/${theirs.id}`, { body: 'Fake takeover' });
    expect([refused.status, code(refused)]).toEqual([403, 'NOT_AUTHOR']);
    expect(code(await call('delete', `/notes/${theirs.id}`))).toBe('NOT_AUTHOR');
    expectStatus(await call('delete', `/notes/${note.id}`), 200);
    expect((await call('delete', `/notes/${note.id}`)).status).toBe(404);
    expect((await record(r.gamma.id)).notes.map((n) => [n.body, n.mine])).toEqual([
      ['Fake rep note', false],
    ]);
  });

  it('POST /opportunities/:id/follow-ups and PATCH, complete, cancel /follow-ups/:id', async () => {
    const add = await call('post', `/opportunities/${r.gamma.id}/follow-ups`, {
      kind: 'FOLLOW_UP',
      title: 'Fake send the proposal',
      dueAt: inDays(5),
    });
    expectStatus(add, 201);
    const f = SalesFollowUp.parse(add.body);
    expect(f).toMatchObject({ status: 'SCHEDULED', assignee: { id: rep.id }, overdue: false });
    const moved = await call('patch', `/follow-ups/${f.id}`, {
      dueAt: inDays(6),
      location: 'Fake office',
    });
    expect(SalesFollowUp.parse(moved.body)).toMatchObject({ location: 'Fake office' });
    const backwards = await call('patch', `/follow-ups/${f.id}`, { endsAt: inDays(1) });
    expect(backwards.status).toBe(400);
    const done = await call('post', `/follow-ups/${f.id}/complete`);
    expectStatus(done, 200);
    expect(SalesFollowUp.parse(done.body).completedAt).not.toBeNull();
    const again = await call('post', `/follow-ups/${f.id}/complete`);
    expect([again.status, code(again)]).toEqual([409, 'FOLLOW_UP_CLOSED']);
    const extra = SalesFollowUp.parse(
      (
        await call('post', `/opportunities/${r.gamma.id}/follow-ups`, {
          kind: 'CALL',
          title: 'Fake call',
          dueAt: inDays(7),
        })
      ).body,
    );
    expect(
      SalesFollowUp.parse((await call('post', `/follow-ups/${extra.id}/cancel`)).body).status,
    ).toBe('CANCELLED');
    const feed = (await record(r.gamma.id)).activity;
    expect(feed.find((e) => e.kind === 'FOLLOW_UP_COMPLETED')).toMatchObject({
      actor: { kind: 'USER' },
      followUp: { title: 'Fake send the proposal' },
    });
  });

  it('a demo moves a record to Appointment Set (an automation)', async () => {
    const x = await lead({ firmName: `Fake Demo ${run}`, ownerId: rep.id });
    expect(x.stageName).toBe('New Lead');
    const res = await call('post', `/opportunities/${x.id}/follow-ups`, {
      kind: 'DEMO',
      title: 'Fake demo',
      dueAt: inDays(3),
    });
    expectStatus(res, 201);
    const after = await record(x.id);
    expect(after.opportunity).toMatchObject({
      stageName: 'Appointment Set',
      nextAppointment: { kind: 'DEMO' },
    });
    expect(after.activity.find((e) => e.kind === 'STAGE_CHANGED')).toMatchObject({
      source: 'AUTOMATION',
      toStage: 'Appointment Set',
    });
    r.delta = await lead({ pipelineId: mine.id, firmName: `Fake Delta ${run}`, source: 'EVENT' });
    await call('post', `/opportunities/${r.delta.id}/follow-ups`, {
      kind: 'DEMO',
      title: 'Fake demo',
      dueAt: inDays(3),
    });
    expect((await record(r.delta.id)).opportunity.stageName).toBe('New Lead');
  });

  it('POST /opportunities/bulk: tags, owners and stages, on the confirmed count', async () => {
    const basic = SalesPipelineList.parse((await call('get', '/pipelines')).body).items.find(
      (p) => p.name === `Fake Basic ${run}`,
    )!;
    const a = await lead({ pipelineId: basic.id });
    const b = await lead({ pipelineId: basic.id });
    const tag = SalesTag.parse((await call('post', '/tags', { name: `Fake Bulk ${run}` })).body);
    const bulk = (action: object, list = [a.id, b.id]) =>
      call('post', '/opportunities/bulk', { ids: list, confirmedCount: list.length, action });
    let res = await bulk({ type: 'ADD_TAG', tagId: tag.id });
    expectStatus(res, 200);
    expect(res.body).toEqual({ updated: 2, unchanged: 0 });
    expect((await bulk({ type: 'ADD_TAG', tagId: tag.id })).body).toEqual({
      updated: 0,
      unchanged: 2,
    });
    expect((await bulk({ type: 'REMOVE_TAG', tagId: tag.id }, [a.id])).body).toEqual({
      updated: 1,
      unchanged: 0,
    });
    expect((await bulk({ type: 'ASSIGN', ownerId: rep.id })).body).toEqual({
      updated: 2,
      unchanged: 0,
    });
    const lostStage = stageOf(basic, 'Lost').id;
    res = await bulk({ type: 'STAGE', stageId: lostStage });
    expect([res.status, code(res)]).toEqual([422, 'LOST_REASON_REQUIRED']);
    res = await bulk({ type: 'STAGE', stageId: lostStage, lostReason: 'TIMING' });
    expect(res.body).toEqual({ updated: 2, unchanged: 0 });
    expect((await record(a.id)).opportunity).toMatchObject({
      lostReason: 'TIMING',
      owner: { id: rep.id },
    });
    const wrong = await call('post', '/opportunities/bulk', {
      ids: [a.id, b.id],
      confirmedCount: 1,
      action: { type: 'ASSIGN', ownerId: null },
    });
    expect(wrong.status).toBe(400);
    expect((await bulk({ type: 'ASSIGN', ownerId: null }, [a.id, randomUUID()])).status).toBe(404);
  });
});

describe('the lists and the numbers (this run’s pipeline)', () => {
  const range = () => `from=${today()}&to=${dayIn(30)}`;

  it('GET /opportunities: one query for the board and the list, filtered and paged', async () => {
    const all = SalesOpportunityPage.parse(
      (await call('get', `/opportunities?pipelineId=${mine.id}`)).body,
    );
    expect(all.total).toBe(4);
    expect(all.items.map((v) => v.firmName)).toEqual([
      `Fake Delta ${run}`,
      `Fake Gamma ${run}`,
      `Fake Alpha ${run}`,
      `Fake Beta ${run}`,
    ]);
    const inProgress = SalesOpportunityPage.parse(
      (await call('get', `/opportunities?pipelineId=${mine.id}&set=IN_PROGRESS&sort=FIRM`)).body,
    );
    expect(inProgress.items.map((v) => v.firmName)).toEqual([
      `Fake Delta ${run}`,
      `Fake Gamma ${run}`,
    ]);
    const search = SalesOpportunityPage.parse(
      (await call('get', `/opportunities?pipelineId=${mine.id}&search=gamma`)).body,
    );
    expect(search.items.map((v) => v.id)).toEqual([r.gamma.id]);
    const unassigned = SalesOpportunityPage.parse(
      (await call('get', `/opportunities?pipelineId=${mine.id}&unassigned=true`)).body,
    );
    expect(unassigned.items.map((v) => v.id)).toEqual([r.delta.id]);
    const stages = SalesOpportunityPage.parse(
      (
        await call(
          'get',
          `/opportunities?pipelineId=${mine.id}&stageIds=${stageOf(mine, 'Unqualified / Lost').id},${stageOf(mine, 'Under Contract').id}`,
        )
      ).body,
    );
    expect(stages.total).toBe(2);
    const paged = SalesOpportunityPage.parse(
      (await call('get', `/opportunities?pipelineId=${mine.id}&pageSize=3&page=2`)).body,
    );
    expect([paged.page, paged.items.length, paged.total]).toEqual([2, 1, 4]);
    expect((await call('get', '/opportunities?colour=red')).status).toBe(400);
  });

  it('GET /opportunities/:id: the record page', async () => {
    const page = await record(r.gamma.id);
    expect(page.pipeline.id).toBe(mine.id);
    expect(page.followUps.map((f) => f.status)).toEqual(['COMPLETED', 'CANCELLED']);
    expect(page.activity[0]!.at >= page.activity.at(-1)!.at).toBe(true);
    expect((await call('get', `/opportunities/${randomUUID()}`)).status).toBe(404);
    expect((await call('get', '/opportunities/not-a-uuid')).status).toBe(400);
  });

  it('GET /summary: B5’s KPIs over the filtered records', async () => {
    const s = SalesPipelineSummary.parse(
      (await call('get', `/summary?pipelineId=${mine.id}`)).body,
    );
    expect(s).toMatchObject({
      pipelineId: mine.id,
      totalOpportunities: 4,
      inProgress: 2,
      pipelineValueCents: 170_000,
      closedRevenueCents: 0,
      activeClients: 1,
      needsAttention: 1,
      conversion: { converted: 1, eligible: 4, rateBp: 2500 },
      attention: { UNASSIGNED: 1, OVERDUE: 0 },
      trends: { totalOpportunities: null },
    });
    const empty = SalesPipelineSummary.parse(
      (await call('get', `/summary?pipelineId=${mine.id}&search=nobody-${run}`)).body,
    );
    expect(empty).toMatchObject({
      totalOpportunities: 0,
      pipelineValueCents: 0,
      conversion: { rateBp: 0 },
    });
  });

  it('GET /center: D1’s numbers for a period, against the one before', async () => {
    const c = SalesCenterSummary.parse(
      (await call('get', `/center?pipelineId=${mine.id}&${range()}`)).body,
    );
    expect(c).toMatchObject({
      from: today(),
      totalLeads: { value: 4, trend: null },
      demosScheduled: { value: 1 },
      trialsStarted: { value: 1 },
      activeTrials: { value: 1, trend: null },
      wonDeals: { value: 1 },
      lostDeals: { value: 1 },
      revenueWonCents: { value: 120_000 },
      projectedMrrCents: { value: 15_000 + 19_900 },
    });
    expect((await call('get', `/center?period=THIS_MONTH&${range()}`)).status).toBe(400);
    const all = SalesCenterSummary.parse((await call('get', '/center?period=LAST_7_DAYS')).body);
    expect(all.totalLeads.value).toBeGreaterThanOrEqual(4);
  });

  it('GET /analytics/stages: records per stage open in the period, and lost reasons', async () => {
    const counts = SalesStageCounts.parse(
      (await call('get', `/analytics/stages?pipelineId=${mine.id}&${range()}`)).body,
    );
    const by = Object.fromEntries(counts.stages.map((s) => [s.name, [s.count, s.valueCents]]));
    expect(by).toMatchObject({
      'New Lead': [2, 50_000],
      'Under Contract': [1, 120_000],
      'Unqualified / Lost': [1, 0],
      Nurturing: [0, 0],
    });
    expect(counts.lostReasons).toHaveLength(8);
    expect(counts.lostReasons.find((l) => l.reason === 'BUDGET')?.count).toBe(1);
    const shippedCounts = SalesStageCounts.parse((await call('get', '/analytics/stages')).body);
    expect(shippedCounts.pipelineId).toBe(shipped.id);
  });

  it('GET /analytics/revenue-by-plan and /analytics/lead-sources', async () => {
    const revenue = SalesRevenueByPlan.parse(
      (await call('get', `/analytics/revenue-by-plan?pipelineId=${mine.id}&${range()}`)).body,
    );
    expect(revenue.slices.find((s) => s.planId === ids.plan)).toMatchObject({
      cents: 120_000,
      deals: 1,
    });
    expect(revenue.slices.some((s) => s.planId === ids.oldPlan)).toBe(false);
    expect(revenue.totalCents).toBe(120_000);
    const sources = SalesLeadSources.parse(
      (await call('get', `/analytics/lead-sources?pipelineId=${mine.id}&${range()}`)).body,
    );
    expect(sources).toMatchObject({
      total: 4,
      items: [
        { source: 'WEBSITE', count: 2, percent: 50 },
        { source: 'EVENT', count: 1, percent: 25 },
        { source: 'REFERRAL', count: 1, percent: 25 },
      ],
    });
  });

  it('GET /activity: Recent Activity, newest first, by kind', async () => {
    const feed = SalesFeedList.parse(
      (await call('get', `/activity?pipelineId=${mine.id}&kinds=WON,LOST,TRIAL_STARTED`)).body,
    );
    expect(feed.items.map((e) => [e.kind, e.firmName]).sort()).toEqual(
      [
        ['LOST', `Fake Beta ${run}`],
        ['TRIAL_STARTED', `Fake Gamma ${run}`],
        ['WON', `Fake Alpha ${run}`],
      ].sort(),
    );
    const limited = SalesFeedList.parse(
      (await call('get', `/activity?pipelineId=${mine.id}&limit=2`)).body,
    );
    expect(limited.items).toHaveLength(2);
    expect((await call('get', '/activity?kinds=PROPOSAL_SENT')).status).toBe(400);
  });

  it('GET /follow-ups: scheduled from now on, soonest first', async () => {
    const list = SalesFollowUpList.parse(
      (await call('get', `/follow-ups?pipelineId=${mine.id}&kinds=DEMO`)).body,
    );
    expect(list.items.map((f) => [f.opportunityId, f.kind])).toEqual([[r.delta.id, 'DEMO']]);
  });

  it('GET /report: the records created in the period, as CSV', async () => {
    const res = await call('get', `/report?pipelineId=${mine.id}&${range()}`);
    expectStatus(res, 200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe('Firm,Contact,Email,Stage,Owner,Source,Plan,Value (USD),Created');
    expect(lines).toHaveLength(5);
    expect(lines.find((l) => l.startsWith(`Fake Alpha ${run}`))).toContain(
      `Under Contract,Fake Sales Rep,Referral,Fake Plan ${run},1200.00,${today()}`,
    );
  });
});

describe('tags, settings and targets', () => {
  it('POST, PATCH and DELETE /tags', async () => {
    const res = await call('post', '/tags', { name: `Fake Tag ${run}`, colorKey: 'accent-blue' });
    expectStatus(res, 201);
    const tag = SalesTag.parse(res.body);
    const twice = await call('post', '/tags', { name: `FAKE TAG ${run}` });
    expect([twice.status, code(twice)]).toEqual([409, 'DUPLICATE_NAME']);
    const renamed = await call('patch', `/tags/${tag.id}`, {
      name: `Fake Tag ${run} 2`,
      colorKey: null,
    });
    expect(SalesTag.parse(renamed.body)).toMatchObject({
      name: `Fake Tag ${run} 2`,
      colorKey: null,
    });
    expectStatus(await call('delete', `/tags/${tag.id}`), 200);
    expect((await call('delete', `/tags/${tag.id}`)).status).toBe(404);
  });

  it('GET and PUT /attention-settings', async () => {
    const body = {
      noContactHours: 24,
      followUpDueHours: 24,
      noResponseAttempts: 3,
      noActivityDays: 14,
      ownerRequired: true,
      lostOtherNoteRequired: true,
    };
    const res = await call('put', '/attention-settings', body);
    expectStatus(res, 200);
    expect(SalesAttentionSettings.parse(res.body)).toMatchObject({
      ...body,
      updatedBy: 'Fake admin',
    });
    expect(
      SalesAttentionSettings.parse((await call('get', '/attention-settings')).body),
    ).toMatchObject(body);
    expect(
      (await call('put', '/attention-settings', { ...body, noActivityDays: 400 })).status,
    ).toBe(400);
  });

  it('POST /targets, GET /targets, PATCH /targets/:id and POST /targets/:id/archive', async () => {
    const res = await call('post', '/targets', {
      name: 'Fake rep wins',
      scope: 'REP',
      repId: rep.id,
      metric: 'WON_DEALS',
      targetValue: 2,
      periodType: 'CUSTOM',
      periodStart: today(),
      periodEnd: dayIn(30),
    });
    expectStatus(res, 201);
    const target = SalesTarget.parse(res.body);
    expect(target).toMatchObject({
      rep: { id: rep.id },
      attainment: { actual: 1, progressBp: 5000 },
    });
    const twice = await call('post', '/targets', {
      name: 'Fake rep wins again',
      scope: 'REP',
      repId: rep.id,
      metric: 'WON_DEALS',
      targetValue: 3,
      periodType: 'CUSTOM',
      periodStart: today(),
      periodEnd: dayIn(30),
    });
    expect([twice.status, code(twice)]).toEqual([409, 'TARGET_EXISTS']);
    const closed = await call('post', '/targets', {
      name: 'Fake closed team',
      scope: 'TEAM',
      teamId: ids.closedTeam,
      metric: 'NEW_LEADS',
      targetValue: 5,
      periodType: 'CUSTOM',
      periodStart: today(),
      periodEnd: today(),
    });
    expect([closed.status, code(closed)]).toEqual([422, 'TEAM_INACTIVE']);
    const list = SalesTargetList.parse(
      (await call('get', `/targets?scope=REP&on=${today()}`)).body,
    );
    expect(list.items.map((t) => t.id)).toContain(target.id);
    const edited = await call('patch', `/targets/${target.id}`, {
      targetValue: 4,
      note: 'Fake stretch',
    });
    expect(SalesTarget.parse(edited.body)).toMatchObject({
      targetValue: 4,
      note: 'Fake stretch',
      attainment: { progressBp: 2500 },
    });
    const rate = SalesTarget.parse(
      (
        await call('post', '/targets', {
          name: 'Fake rate',
          scope: 'REP',
          repId: rep.id,
          metric: 'CONVERSION_RATE',
          targetValue: 2500,
          periodType: 'CUSTOM',
          periodStart: today(),
          periodEnd: dayIn(30),
        })
      ).body,
    );
    const tooHigh = await call('patch', `/targets/${rate.id}`, { targetValue: 20_000 });
    expect([tooHigh.status, code(tooHigh)]).toEqual([422, 'INVALID_TARGET_VALUE']);
    const archived = await call('post', `/targets/${target.id}/archive`);
    expectStatus(archived, 200);
    expect(SalesTarget.parse(archived.body).archivedAt).not.toBeNull();
    const after = await call('patch', `/targets/${target.id}`, { name: 'Fake renamed' });
    expect([after.status, code(after)]).toEqual([409, 'TARGET_ARCHIVED']);
    expect(
      SalesTargetList.parse((await call('get', '/targets?scope=REP')).body).items.map((t) => t.id),
    ).not.toContain(target.id);
  });
});
