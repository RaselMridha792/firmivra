// End-to-end: R55 (on R60's start), Leads Review Two (Octavia, Nov 8) R2 18, the funnel and aging
// report (Reports > Leads). Counts leads that came in on the firm's days with the Leads list's
// filters and reach: how many reached each stage (history included), where they are now, closed
// without converting, the conversion rate, and open leads' time in stage and since activity. Every
// number opens its leads. Read only; audited with counts. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { LeadProfile, LeadReport, LeadReportLeads } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55rp-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  staffA: person('staff-a'),
  ownerB: person('owner-b'),
};
const ids = { firmA: '', firmB: '', tax: '', books: '' };
const lead = { ann: '', ben: '', cal: '', dee: '' };
let app: INestApplication;
const tokens = new Map<string, string>();
const owner = createPrismaClient(testDatabaseUrls('test_api').owner);

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
  method: 'get' | 'post' | 'patch',
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
const inFirmA = <T>(fn: (tx: TxClient) => Promise<T>) =>
  runInScope(owner, { kind: 'business', businessId: ids.firmA }, fn);
const qs = (q: Record<string, string>) => `?${new URLSearchParams(q).toString()}`;
async function report(q: Record<string, string> = {}, who = people.ownerA, firm = ids.firmA) {
  const res = await call('get', `/leads/reports/funnel${qs(q)}`, who, undefined, firm);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return LeadReport.parse(res.body);
}
async function drill(metric: string, key: string, q: Record<string, string> = {}) {
  const res = await call(
    'get',
    `/leads/reports/funnel/leads${qs({ ...q, metric, key })}`,
    people.ownerA,
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return LeadReportLeads.parse(res.body);
}
const stageOf = (r: LeadReport, stage: string) => r.funnel.find((f) => f.stage === stage)!;
async function create(name: string, extra: object = {}) {
  const res = await call('post', '/leads', people.ownerA, {
    firstName: name,
    lastName: `Funnel${run}`,
    email: `${name.toLowerCase()}-${run}@example.test`,
    source: 'REFERRAL',
    serviceIds: [ids.tax],
    ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return LeadProfile.parse(res.body).id;
}
async function stage(id: string, to: string) {
  const res = await call('patch', `/leads/${id}`, people.ownerA, { stage: to });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people))
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    ids.firmA = (
      await tx.business.create({ data: { slug: `r55rp-a-${run}`, name: 'A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: `r55rp-b-${run}`, name: 'B', status: 'ACTIVE' } })
    ).id;
  });
  await inFirmA(async (tx) => {
    for (const [p, role] of [
      [people.ownerA, 'OWNER'],
      [people.staffA, 'STAFF'],
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

  // Ann: new, nothing done. Ben: Contacted, Staff's, with a note. Cal: Qualified, then lost.
  // Dee: from the website, for books, Not Qualified.
  lead.ann = await create('Ann');
  lead.ben = await create('Ben', { stage: 'CONTACTED', assignedUserId: people.staffA.id });
  const note = await call('post', `/leads/${lead.ben}/notes`, people.ownerA, {
    text: 'Fake note: called back.',
  });
  expect(note.status, JSON.stringify(note.body)).toBe(201);
  lead.cal = await create('Cal');
  await stage(lead.cal, 'QUALIFIED');
  await stage(lead.cal, 'LOST');
  lead.dee = await create('Dee', { source: 'WEBSITE_FORM', serviceIds: [ids.books] });
  await stage(lead.dee, 'DECLINED');
});

afterAll(async () => {
  await app.close();
  await owner.$disconnect();
});

describe('GET /business/leads/reports/funnel (R2 18)', () => {
  it('counts the funnel with each lead history, the closed leads and aging', async () => {
    const r = await report();
    expect(r.total).toBe(4);
    expect(r.funnel.map((f) => [f.stage, f.reached, f.current])).toEqual([
      ['NEW', 4, 1],
      ['CONTACTED', 2, 1],
      // Cal reached Qualified before it was lost: it counts at every stage up to there.
      ['IN_FOLLOW_UP', 1, 0],
      ['APPOINTMENT_SCHEDULED', 1, 0],
      ['QUALIFIED', 1, 0],
      ['CONVERTED', 0, 0],
    ]);
    expect(r.closed).toEqual({ notQualified: 1, lost: 1 });
    expect(r.conversionRate).toBe(0);
    expect(r.aging.open).toBe(2);
    expect(r.aging.inStage.find((b) => b.bucket === 'D0_7')?.count).toBe(2);
    expect(r.aging.noActivity + r.aging.idle.reduce((n, b) => n + b.count, 0)).toBe(2);
    expect(r.aging.byStage.find((s) => s.stage === 'NEW')).toEqual({
      stage: 'NEW',
      open: 1,
      averageDays: 0,
    });
    const [audit] = await inFirmA((tx) =>
      tx.auditLog.findMany({
        where: { businessId: ids.firmA, action: 'leads.funnel_report_viewed' },
        select: { metadata: true },
      }),
    );
    expect(audit!.metadata).toMatchObject({ total: 4 });
  });

  it('opens the leads behind a number', async () => {
    expect((await drill('REACHED', 'QUALIFIED')).items.map((l) => l.id)).toEqual([lead.cal]);
    expect((await drill('CLOSED', 'LOST')).items.map((l) => l.id)).toEqual([lead.cal]);
    expect((await drill('CLOSED', 'NOT_QUALIFIED')).items.map((l) => l.id)).toEqual([lead.dee]);
    const contacted = await drill('CURRENT', 'CONTACTED');
    expect(contacted.items.map((l) => [l.id, l.owner, l.daysIdle])).toEqual([
      [lead.ben, 'Fake staffA', 0],
    ]);
    const idle = await drill('IDLE', 'NONE');
    expect(idle.items.map((l) => l.id)).toContain(lead.ann);
    expect(idle.items.map((l) => l.id)).not.toContain(lead.ben);
    expect((await drill('REACHED', 'NEW')).total).toBe(4);
    expectError(
      await call(
        'get',
        `/leads/reports/funnel/leads${qs({ metric: 'REACHED', key: 'D0_7' })}`,
        people.ownerA,
      ),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('filters as the Leads list does, and checks the dates', async () => {
    expect((await report({ source: 'WEBSITE_FORM' })).total).toBe(1);
    expect((await report({ serviceId: ids.books })).total).toBe(1);
    expect((await report({ assignedUserId: people.staffA.id })).total).toBe(1);
    const yesterday = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    expect((await report({ from: yesterday, to: yesterday })).total).toBe(0);
    expectError(
      await call(
        'get',
        `/leads/reports/funnel${qs({ from: '2026-02-01', to: '2026-01-01' })}`,
        people.ownerA,
      ),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call(
        'get',
        `/leads/reports/funnel${qs({ from: '2020-01-01', to: '2026-01-01' })}`,
        people.ownerA,
      ),
      400,
      'RANGE_TOO_LONG',
    );
    // Archived leads only when asked for.
    const archived = await call('post', '/leads/bulk', people.ownerA, {
      action: 'ARCHIVE',
      ids: [lead.ann],
    });
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    expect((await report()).total).toBe(3);
    expect((await report({ archived: 'include' })).total).toBe(4);
  });

  it("Staff count only their own leads; firm B none of firm A's", async () => {
    const mine = await report({}, people.staffA);
    expect([mine.total, stageOf(mine, 'CONTACTED').current]).toEqual([1, 1]);
    const staffDrill = await call(
      'get',
      `/leads/reports/funnel/leads${qs({ metric: 'REACHED', key: 'NEW', archived: 'include' })}`,
      people.staffA,
    );
    expect(LeadReportLeads.parse(staffDrill.body).items.map((l) => l.id)).toEqual([lead.ben]);
    expect((await report({ archived: 'include' }, people.ownerB, ids.firmB)).total).toBe(0);
    // Firm A's service as a filter in firm B matches nothing of firm B's and shows nothing of A's.
    const b = await report({ serviceId: ids.books, archived: 'include' }, people.ownerB, ids.firmB);
    expect(b.total).toBe(0);
    expect(JSON.stringify(b)).not.toContain(lead.dee);
  });
});
