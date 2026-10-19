// End-to-end: R55, the Tax Returns workspace part 1 (contract packages/types/src/tax-returns/
// workspace.ts): the overview (tabs, filters, search, KPI cards), Create New Return, a return's
// workspace (Next Steps, Change Status with the database's rules), Edit Details, history,
// activity, archive, amend and carry forward. Staff reach their own clients; firm B sees nothing.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  TaxReturnActivityList,
  TaxReturnDetail,
  TaxReturnHistoryList,
  TaxReturnPage,
  TaxReturnSummary,
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
  ownerB: person('owner-b'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', string>;
let app: INestApplication;
const tokens = new Map<string, string>();
const ids = {} as Record<string, string>;

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

async function call(
  method: 'get' | 'post' | 'patch',
  path: string,
  who: Who | undefined,
  body?: object,
  firm: 'a' | 'b' = 'a',
): Promise<Response> {
  let req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', firms[firm]);
  if (who) {
    let token = tokens.get(who.email);
    if (!token) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/dev/token')
        .send({ email: who.email })
        .expect(200);
      token = (res.body as { token: string }).token;
      tokens.set(who.email, token);
    }
    req = req.set('authorization', `Bearer ${token}`);
  }
  return body === undefined ? req : req.send(body);
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const ok = <T>(res: Response, parse: { parse: (v: unknown) => T }, status = 200): T => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return parse.parse(res.body);
};
const { ownerA, adminA, staffA, ownerB } = people;

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
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
    ['b', ownerB.id, 'OWNER'],
  ] as const) {
    await inFirm(firm, (tx) =>
      tx.membership.create({ data: { businessId: firms[firm], userId, role, status: 'ACTIVE' } }),
    );
  }
  await inFirm('a', async (tx) => {
    const businessId = firms.a;
    const c1 = await tx.client.create({
      data: { businessId, displayName: 'Cora One (fake)', assignedUserId: staffA.id },
    });
    await tx.clientProfile.create({ data: { businessId, clientId: c1.id, ssnLast4: '1234' } });
    const c2 = await tx.client.create({
      data: { businessId, displayName: 'Bayside Bakery (fake)', accountType: 'BUSINESS' },
    });
    ids.c1 = c1.id;
    ids.c2 = c2.id;
    // A 2024 return already filed (R10's way: status FILED with its date).
    ids.filed = (
      await tx.taxReturn.create({
        data: {
          businessId,
          clientId: c1.id,
          taxYear: 2024,
          filingType: 'INDIVIDUAL',
          formType: '1040',
          status: 'FILED',
          filedOn: new Date('2025-04-10T00:00:00Z'),
        },
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

describe('Create New Return and the overview', () => {
  it('creates returns, refuses a duplicate and what the member does not reach', async () => {
    const r = ok(
      await call('post', '/tax-returns', adminA, {
        clientId: ids.c1,
        taxYear: 2025,
        filingType: 'INDIVIDUAL',
        formType: '1040',
        filingStatus: 'SINGLE',
        states: ['NY'],
        preparerUserId: staffA.id,
        reviewerUserId: adminA.id,
        dueOn: '2026-04-15',
      }),
      TaxReturnDetail,
      201,
    );
    ids.r = r.id;
    expect(r).toMatchObject({
      workflowStatus: 'IN_PREPARATION',
      status: 'IN_PROGRESS',
      client: { id: ids.c1, maskedId: '***-**-1234', accountType: 'INDIVIDUAL' },
      preparer: { userId: staffA.id },
      reviewer: { userId: adminA.id },
      filingStatus: 'SINGLE',
      blockers: [],
      estimate: null,
    });
    expect(r.canMoveTo).toContain('READY_FOR_REVIEW');
    expectError(
      await call('post', '/tax-returns', ownerA, {
        clientId: ids.c1,
        taxYear: 2025,
        filingType: 'INDIVIDUAL',
        formType: '1040',
      }),
      409,
      'DUPLICATE_RETURN',
    );
    expectError(
      await call('post', '/tax-returns', staffA, {
        clientId: ids.c2,
        taxYear: 2025,
        filingType: 'BUSINESS',
      }),
      404,
      'NOT_FOUND',
    );
    expect(
      (
        await call('post', '/tax-returns', ownerA, {
          clientId: ids.c2,
          taxYear: 2025,
          filingType: 'BUSINESS',
          filingStatus: 'SINGLE',
        })
      ).status,
    ).toBe(400);
    const q = ok(
      await call('post', '/tax-returns', ownerA, {
        clientId: ids.c2,
        taxYear: 2025,
        filingType: 'BUSINESS',
        formType: '941',
        quarter: 1,
        dueOn: '2025-04-30',
      }),
      TaxReturnDetail,
      201,
    );
    ids.q = q.id;
    expect(q.estimate).toMatchObject({ amountCents: null, overdue: true });
  });

  it('lists by tab, filter and search, within reach, and counts the cards', async () => {
    const list = async (query: string, who: Who = ownerA) =>
      ok(await call('get', `/tax-returns?${query}`, who), TaxReturnPage).items.map((r) => r.id);
    expect((await list('pageSize=100')).sort()).toEqual([ids.r, ids.q, ids.filed].sort());
    expect(await list('tab=quarterly')).toEqual([ids.q]);
    expect((await list('tab=personal')).sort()).toEqual([ids.r, ids.filed].sort());
    expect((await list('search=1234')).sort()).toEqual([ids.r, ids.filed].sort());
    expect(await list('clientType=BUSINESS')).toEqual([ids.q]);
    expect(await list(`assignedUserId=${staffA.id}`)).toEqual([ids.r]);
    expect((await list('pageSize=100', staffA)).sort()).toEqual([ids.r, ids.filed].sort());
    expect((await call('get', '/tax-returns?tab=nope', ownerA)).status).toBe(400);
    const s = ok(await call('get', '/tax-returns/summary?taxYear=2025', ownerA), TaxReturnSummary);
    expect(s).toMatchObject({ taxYear: 2025, total: { value: 2 }, inPreparation: { value: 2 } });
    expect(s.progress).toEqual([{ workflowStatus: 'IN_PREPARATION', count: 2 }]);
  });
});

describe('a return', () => {
  it('edits details and estimates within the rules', async () => {
    ok(
      await call('patch', `/tax-returns/${ids.r}/details`, ownerA, { preparerUserId: adminA.id }),
      TaxReturnDetail,
    );
    expectError(
      await call('patch', `/tax-returns/${ids.r}/details`, ownerA, {
        estimateStatus: 'CALCULATED',
      }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', `/tax-returns/${ids.q}/details`, ownerA, { estimateStatus: 'PAID' }),
      400,
      'VALIDATION_FAILED',
    );
    const paid = ok(
      await call('patch', `/tax-returns/${ids.q}/details`, ownerA, {
        estimateAmountCents: 125000,
        estimateStatus: 'PAID',
        estimatePaidOn: '2025-04-20',
      }),
      TaxReturnDetail,
    );
    expect(paid.estimate).toEqual({
      amountCents: 125000,
      status: 'PAID',
      paidOn: '2025-04-20',
      overdue: false,
    });
    expectError(
      await call('patch', `/tax-returns/${ids.r}/details`, ownerA, { reviewerUserId: ownerB.id }),
      409,
      'NOT_A_MEMBER',
    );
    const activity = ok(
      await call('get', `/tax-returns/${ids.r}/activity`, ownerA),
      TaxReturnActivityList,
    );
    expect(activity.items.map((a) => a.kind)).toEqual(['ASSIGNED', 'CREATED']);
  });

  it('moves through the workflow as the database allows', async () => {
    const id = ids.r!;
    ok(
      await call('post', `/tax-returns/${id}/status`, staffA, {
        workflowStatus: 'READY_FOR_REVIEW',
      }),
      TaxReturnDetail,
    );
    expectError(
      await call('post', `/tax-returns/${id}/status`, staffA, { workflowStatus: 'IN_PREPARATION' }),
      400,
      'REASON_REQUIRED',
    );
    const back = ok(
      await call('post', `/tax-returns/${id}/status`, staffA, {
        workflowStatus: 'IN_PREPARATION',
        reason: 'Missing a 1099',
      }),
      TaxReturnDetail,
    );
    expect(back).toMatchObject({
      workflowStatus: 'IN_PREPARATION',
      statusReason: 'Missing a 1099',
    });
    expectError(
      await call('post', `/tax-returns/${id}/status`, staffA, { workflowStatus: 'READY_TO_FILE' }),
      403,
      'FORBIDDEN',
    );
    const ready = ok(
      await call('post', `/tax-returns/${id}/status`, adminA, { workflowStatus: 'READY_TO_FILE' }),
      TaxReturnDetail,
    );
    expect(ready.blockers).toEqual(['NO_FILING_TRANSMITTED']);
    const blocked = await call('post', `/tax-returns/${id}/status`, adminA, {
      workflowStatus: 'TRANSMITTED',
    });
    expectError(blocked, 409, 'STATUS_BLOCKED');
    expect(
      (blocked.body as { error: { details: { blockers: string[] } } }).error.details.blockers,
    ).toEqual(['NO_FILING_TRANSMITTED']);
    const history = ok(
      await call('get', `/tax-returns/${id}/history`, ownerA),
      TaxReturnHistoryList,
    );
    expect(history.items.map((h) => h.workflowStatus).slice(0, 4)).toEqual([
      'READY_TO_FILE',
      'IN_PREPARATION',
      'READY_FOR_REVIEW',
      'IN_PREPARATION',
    ]);
    expect(history.items[1]?.reason).toBe('Missing a 1099');
    const filed = ok(await call('get', `/tax-returns/${ids.filed}`, ownerA), TaxReturnDetail);
    expect(filed.canMoveTo).toEqual(['ACCEPTED', 'REJECTED', 'CLOSED']);
    expectError(
      await call('post', `/tax-returns/${ids.filed}/status`, ownerA, {
        workflowStatus: 'IN_PREPARATION',
        reason: 'x',
      }),
      409,
      'STATUS_BLOCKED',
    );
  });

  it('amends a filed return, carries forward, archives and restores', async () => {
    expectError(
      await call('post', `/tax-returns/${ids.r}/amend`, ownerA, { reason: 'x' }),
      409,
      'ORIGINAL_NOT_FILED',
    );
    const amended = ok(
      await call('post', `/tax-returns/${ids.filed}/amend`, ownerA, {
        reason: 'Missed a 1099-INT',
      }),
      TaxReturnDetail,
      201,
    );
    expect(amended).toMatchObject({
      amends: { id: ids.filed, taxYear: 2024 },
      amendReason: 'Missed a 1099-INT',
      workflowStatus: 'IN_PREPARATION',
    });
    expect(
      ok(await call('get', '/tax-returns?tab=amended', ownerA), TaxReturnPage).items.map(
        (r) => r.id,
      ),
    ).toEqual([amended.id]);
    const next = ok(
      await call('post', `/tax-returns/${ids.r}/carry-forward`, ownerA, { taxYear: 2026 }),
      TaxReturnDetail,
      201,
    );
    expect(next).toMatchObject({
      taxYear: 2026,
      formType: '1040',
      preparer: { userId: adminA.id },
    });
    expectError(
      await call('post', `/tax-returns/${ids.r}/carry-forward`, ownerA, { taxYear: 2026 }),
      409,
      'DUPLICATE_RETURN',
    );
    expect(
      (await call('post', `/tax-returns/${ids.r}/carry-forward`, ownerA, { taxYear: 2025 })).status,
    ).toBe(400);
    const archived = ok(
      await call('post', `/tax-returns/${next.id}/archive`, ownerA),
      TaxReturnDetail,
    );
    expect(archived.archivedAt).toBeTruthy();
    expect(
      ok(await call('get', '/tax-returns?archived=true', ownerA), TaxReturnPage).items.map(
        (r) => r.id,
      ),
    ).toEqual([next.id]);
    expectError(
      await call('patch', `/tax-returns/${next.id}/details`, ownerA, { dueOn: '2027-04-15' }),
      409,
      'RETURN_LOCKED',
    );
    expect(
      ok(await call('post', `/tax-returns/${next.id}/restore`, ownerA), TaxReturnDetail).archivedAt,
    ).toBeNull();
  });
});

describe('another firm', () => {
  it('reaches none of it', async () => {
    for (const [method, path, body] of [
      ['get', `/tax-returns/${ids.r}`, undefined],
      ['patch', `/tax-returns/${ids.r}/details`, { dueOn: '2026-04-15' }],
      ['post', `/tax-returns/${ids.r}/status`, { workflowStatus: 'WAITING_ON_CLIENT' }],
      ['get', `/tax-returns/${ids.r}/history`, undefined],
      ['post', `/tax-returns/${ids.r}/archive`, undefined],
      ['post', `/tax-returns/${ids.filed}/amend`, { reason: 'x' }],
      ['post', `/tax-returns/${ids.r}/carry-forward`, { taxYear: 2030 }],
    ] as const) {
      expectError(await call(method, path, ownerB, body, 'b'), 404, 'NOT_FOUND');
    }
    expectError(
      await call(
        'post',
        '/tax-returns',
        ownerB,
        { clientId: ids.c1, taxYear: 2025, filingType: 'INDIVIDUAL' },
        'b',
      ),
      404,
      'NOT_FOUND',
    );
    expect(ok(await call('get', '/tax-returns', ownerB, undefined, 'b'), TaxReturnPage).total).toBe(
      0,
    );
  });
});
