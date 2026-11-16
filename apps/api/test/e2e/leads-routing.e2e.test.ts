// End-to-end: R55, Leads Review Two (Octavia, Nov 8) R2 17, ownership and routing rules. Settings >
// Lead assignment (Owner, Admin) saves ordered rules, the switch and a fallback; a new lead with no
// owner goes by the first matching rule whose assignee is active, else the fallback; the lead names
// the rule; a manual assignment clears it; saving rules moves no lead. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { LeadProfile, LeadRouting } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55rt-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  staffA: person('staff-a'),
  staff2A: person('staff2-a'),
  // R2 17b: a member who becomes unavailable after the rules are saved.
  awayA: person('away-a'),
  ownerB: person('owner-b'),
};
const ids = { firmA: '', firmB: '', tax: '', books: '', serviceB: '' };
let app: INestApplication;
const tokens = new Map<string, string>();

async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email })
    .expect(200);
  const token = (res.body as { token: string }).token;
  tokens.set(email, token);
  return token;
}
async function call(
  method: 'get' | 'post' | 'put' | 'patch',
  path: string,
  who: { email: string },
  body?: object,
  businessId = ids.firmA,
): Promise<Response> {
  const token = await tokenFor(who.email);
  const req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', businessId)
    .set('authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body);
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const routing = (res: Response) => {
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return LeadRouting.parse(res.body);
};
let n = 0;
async function newLead(extra: object = {}) {
  n += 1;
  const res = await call('post', '/leads', people.ownerA, {
    firstName: 'Rae',
    lastName: `Route${n}x${run}`,
    email: `rae-${n}-${run}@example.test`,
    source: 'REFERRAL',
    serviceIds: [ids.tax],
    ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return LeadProfile.parse(res.body);
}

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people))
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    ids.firmA = (
      await tx.business.create({ data: { slug: `r55rt-a-${run}`, name: 'A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: `r55rt-b-${run}`, name: 'B', status: 'ACTIVE' } })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    for (const [p, role] of [
      [people.ownerA, 'OWNER'],
      [people.staffA, 'STAFF'],
      [people.staff2A, 'STAFF'],
      [people.awayA, 'STAFF'],
    ] as const) {
      await tx.membership.create({
        data: { businessId: ids.firmA, userId: p.id, role, status: 'ACTIVE' },
      });
    }
    ids.tax = (
      await tx.service.create({
        data: { businessId: ids.firmA, kind: 'ANNUAL_TAX', name: `Tax ${run}` },
      })
    ).id;
    ids.books = (
      await tx.service.create({
        data: { businessId: ids.firmA, kind: 'BOOKKEEPING', name: `Books ${run}` },
      })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmB, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.serviceB = (
      await tx.service.create({
        data: { businessId: ids.firmB, kind: 'ANNUAL_TAX', name: `Tax B ${run}` },
      })
    ).id;
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

describe('Leads R2 17: routing', () => {
  const rules = () => [
    { name: 'Referrals', sources: ['REFERRAL'], assigneeUserId: people.staffA.id },
    { name: 'Books', serviceIds: [ids.books], assigneeUserId: people.staff2A.id },
  ];

  it("Owner saves the rules in order; Staff can't; another firm's member or service is refused", async () => {
    expect(routing(await call('get', '/lead-routing', people.ownerA))).toEqual({
      enabled: false,
      fallback: null,
      rules: [],
    });
    expectError(await call('get', '/lead-routing', people.staffA), 403, 'FORBIDDEN');
    const saved = routing(
      await call('put', '/lead-routing', people.ownerA, {
        enabled: true,
        fallbackUserId: people.staff2A.id,
        rules: rules(),
      }),
    );
    expect(saved.rules.map((r) => [r.name, r.assignee.userId])).toEqual([
      ['Referrals', people.staffA.id],
      ['Books', people.staff2A.id],
    ]);
    expect(saved.fallback?.userId).toBe(people.staff2A.id);
    for (const body of [
      { enabled: true, fallbackUserId: people.ownerB.id, rules: [] },
      {
        enabled: true,
        fallbackUserId: null,
        rules: [{ name: 'X', assigneeUserId: people.ownerB.id }],
      },
      {
        enabled: true,
        fallbackUserId: null,
        rules: [{ name: 'X', serviceIds: [ids.serviceB], assigneeUserId: people.staffA.id }],
      },
    ]) {
      expectError(await call('put', '/lead-routing', people.ownerA, body), 404, 'NOT_FOUND');
    }
    // Refused saves changed nothing.
    expect(routing(await call('get', '/lead-routing', people.ownerA)).rules).toHaveLength(2);
    expectError(
      await call('put', '/lead-routing', people.staffA, {
        enabled: false,
        fallbackUserId: null,
        rules: [],
      }),
      403,
      'FORBIDDEN',
    );
  });

  it('routes a new lead with no owner: first matching rule, else the fallback; manual wins; rules move no lead', async () => {
    const referral = await newLead();
    expect(referral.assignedTo?.userId).toBe(people.staffA.id);
    expect(referral.assignedByRule?.name).toBe('Referrals');
    const books = await newLead({ source: 'WEBSITE_FORM', serviceIds: [ids.books] });
    expect(books.assignedTo?.userId).toBe(people.staff2A.id);
    expect(books.assignedByRule?.name).toBe('Books');
    const fallback = await newLead({ source: 'OTHER' });
    expect(fallback.assignedTo?.userId).toBe(people.staff2A.id);
    expect(fallback.assignedByRule ?? null).toBeNull();
    // An owner chosen on Add New Lead is kept.
    const chosen = await newLead({ assignedUserId: people.ownerA.id });
    expect(chosen.assignedTo?.userId).toBe(people.ownerA.id);
    expect(chosen.assignedByRule ?? null).toBeNull();
    // A manual assignment clears the rule.
    const changed = LeadProfile.parse(
      (
        await call('patch', `/leads/${referral.id}`, people.ownerA, {
          assignedUserId: people.ownerA.id,
        })
      ).body,
    );
    expect(changed.assignedByRule ?? null).toBeNull();
    // Saving rules moves no lead: Books is archived, its lead keeps its owner and names the rule.
    routing(
      await call('put', '/lead-routing', people.ownerA, {
        enabled: false,
        fallbackUserId: null,
        rules: [rules()[0]],
      }),
    );
    const kept = LeadProfile.parse(
      (await call('get', `/leads/${books.id}/profile`, people.ownerA)).body,
    );
    expect(kept.assignedTo?.userId).toBe(people.staff2A.id);
    expect(kept.assignedByRule?.name).toBe('Books');
    // Routing off: a new lead stays unassigned.
    expect((await newLead()).assignedTo).toBeNull();
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    const audit = await runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
      tx.auditLog.findMany({
        where: { action: 'lead.routed', entityId: { in: [referral.id, books.id, fallback.id] } },
      }),
    );
    await owner.$disconnect();
    expect(audit).toHaveLength(3);
  });

  it('R2 17a: a rule\'s assignment shows in the lead\'s activity as "Assigned by rule: <name>"; a lead no rule matches has none', async () => {
    const saved = routing(
      await call('put', '/lead-routing', people.ownerA, {
        enabled: true,
        fallbackUserId: people.staff2A.id,
        rules: [{ name: 'Referral desk', sources: ['REFERRAL'], assigneeUserId: people.staffA.id }],
      }),
    );
    const rule = saved.rules[0]!;
    const activityOf = async (id: string) => {
      const res = await call('get', `/leads/${id}/activity`, people.ownerA);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return (res.body as { items: { kind: string; label: string; by: unknown }[] }).items;
    };
    const routed = await newLead();
    expect(routed.assignedByRule?.name).toBe('Referral desk');
    const items = await activityOf(routed.id);
    const assigned = items.filter((a) => a.kind === 'ASSIGNED');
    // One line for the change, by its rule, from the system (the trigger's plain row is replaced).
    expect(assigned).toEqual([
      expect.objectContaining({ label: 'Assigned by rule: Referral desk', by: null }),
    ]);
    expect(routed.recentActivity.map((a) => a.label)).toContain('Assigned by rule: Referral desk');
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    const rows = await runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
      tx.leadActivity.findMany({
        where: { businessId: ids.firmA, leadId: routed.id, kind: 'ASSIGNED' },
      }),
    );
    await owner.$disconnect();
    // The trigger's row and the rule's row, written at the same moment by the same change.
    expect(rows).toHaveLength(2);
    const byRule = rows.find((r) => (r.metadata as { ruleId?: string }).ruleId);
    const trigger = rows.find((r) => r !== byRule);
    expect(byRule?.metadata).toEqual({
      assigned: true,
      ruleId: rule.id,
      ruleName: 'Referral desk',
      replaces: trigger?.id,
    });
    expect(trigger?.metadata).toEqual({ assigned: true });
    expect(byRule?.occurredAt).toEqual(trigger?.occurredAt);

    // No rule matches: the fallback takes it, and no activity names a rule.
    const unmatched = await newLead({ source: 'OTHER' });
    expect(unmatched.assignedTo?.userId).toBe(people.staff2A.id);
    expect(unmatched.assignedByRule ?? null).toBeNull();
    const plain = await activityOf(unmatched.id);
    expect(plain.filter((a) => a.label.startsWith('Assigned by rule'))).toEqual([]);
    expect(plain.filter((a) => a.kind === 'ASSIGNED').map((a) => a.label)).toEqual([
      'Lead assigned',
    ]);
  });

  it('R2 17b: an unavailable assignee is skipped for the next matching rule, and an unavailable fallback leaves the lead unassigned', async () => {
    const saved = routing(
      await call('put', '/lead-routing', people.ownerA, {
        enabled: true,
        fallbackUserId: people.awayA.id,
        rules: [
          { name: 'Walk-in desk', sources: ['WALK_IN'], assigneeUserId: people.awayA.id },
          { name: 'Walk-in backup', sources: ['WALK_IN'], assigneeUserId: people.staffA.id },
        ],
      }),
    );
    expect(saved.fallback?.userId).toBe(people.awayA.id);
    // While available, the first rule and the fallback take their leads.
    expect((await newLead({ source: 'WALK_IN' })).assignedByRule?.name).toBe('Walk-in desk');
    expect((await newLead({ source: 'EVENT' })).assignedTo?.userId).toBe(people.awayA.id);
    // The member leaves the firm (deactivated); the rules stay as saved.
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    await runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
      tx.membership.updateMany({
        where: { businessId: ids.firmA, userId: people.awayA.id },
        data: { status: 'DEACTIVATED' },
      }),
    );
    await owner.$disconnect();
    const walkIn = await newLead({ source: 'WALK_IN' });
    expect(walkIn.assignedTo?.userId).toBe(people.staffA.id);
    expect(walkIn.assignedByRule?.name).toBe('Walk-in backup');
    const unmatched = await newLead({ source: 'EVENT' });
    expect(unmatched.assignedTo).toBeNull();
    expect(unmatched.assignedByRule ?? null).toBeNull();
  });

  it("firm B's owner sees and changes none of firm A's routing", async () => {
    expect(
      routing(await call('get', '/lead-routing', people.ownerB, undefined, ids.firmB)),
    ).toEqual({
      enabled: false,
      fallback: null,
      rules: [],
    });
  });
});
