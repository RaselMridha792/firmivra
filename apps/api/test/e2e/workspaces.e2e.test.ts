// End-to-end: R12 step 6, the Bookkeeping and Tax Planning workspaces and their reports
// (contract in packages/types/src/workspaces). Owner and Admin see every workspace, Staff their
// assigned clients' (others are 404), and whoever sees a workspace drafts, edits, publishes,
// unpublishes and deletes (never-published only) its reports. A report's kind fits the
// workspace; its file is the engagement's and never INTERNAL, on attach and again on publish.
// Changes need an open engagement, except unpublish and deleting a never-published draft. The
// client reads the published reports of their own services on the portal. Another firm gets 404
// and changes nothing. Everything is audited with ids, kinds and field names, never text or
// amounts.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { z } from 'zod';
import {
  MemberRef,
  MyReport as MyReportShape,
  Report as ReportShape,
  ReportData,
  Workspace as WorkspaceShape,
  WorkspaceListItem as ItemShape,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

// Strict copies of the contract's shapes, so a leaked field (businessId, status) fails.
const Member = z.strictObject(MemberRef.shape).nullable();
const ClientRef = z.strictObject(ItemShape.shape.client.shape);
const Item = z.strictObject({ ...ItemShape.shape, client: ClientRef, assignedTo: Member });
const ItemList = z.strictObject({ items: z.array(Item), nextCursor: z.string().nullable() });
const Detail = z.strictObject({ ...WorkspaceShape.shape, client: ClientRef, assignedTo: Member });
const Data = z.strictObject({
  summary: z.string().nullable(),
  lines: z.array(z.strictObject(ReportData.shape.lines.element.shape)),
});
const Report = z.strictObject({ ...ReportShape.shape, data: Data, createdBy: Member });
type Report = z.infer<typeof Report>;
const ReportList = z.strictObject({ items: z.array(Report), nextCursor: z.string().nullable() });
const MyReport = z.strictObject({ ...MyReportShape.shape, data: Data });
const MyReportList = z.strictObject({
  items: z.array(MyReport),
  nextCursor: z.string().nullable(),
});

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r12w-${key}-${run}@r12.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  staffA2: person('staff-a2'),
  clientA: person('client-a'),
  spouseA: person('spouse-a'),
  clientA2: person('client-a2'),
  unlinkedA: person('unlinked-a'),
  ownerB: person('owner-b'),
  clientB: person('client-b'),
};
type Person = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', { id: string; slug: string }>;
const clients = {} as Record<'c1' | 'c2' | 'cB', string>;
/** c1's: bk1, tp1, tpPending, at1 (Annual Tax), tpDone, bkCancelled; c2's bk2; firm B's bkB. */
const eng = {} as Record<
  'bk1' | 'tp1' | 'tpPending' | 'at1' | 'bk2' | 'tpDone' | 'bkCancelled' | 'bkB',
  string
>;
/** bk1's shared, internal and client-uploaded files; tp1's; firm B's. */
const docs = {} as Record<'shared' | 'internal' | 'upload' | 'tp' | 'b', string>;

let app: INestApplication;
const tokens = new Map<string, string>();
let lastViewer = 0;
const newViewer = () => `198.18.${Math.floor(++lastViewer / 250)}.${lastViewer % 250}`;

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
const inA = <T>(work: Parameters<typeof runInScope<T>>[2]) =>
  asOwner({ kind: 'business', businessId: firms.a.id }, work);

async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`)
    .send({ email })
    .expect(200);
  const token = (res.body as { token: string }).token;
  tokens.set(email, token);
  return token;
}

/** A firm call under /api/v1/business (Bearer: no cookie, so no Origin needed). */
async function call(
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  who: Person = people.ownerA,
  firm: 'a' | 'b' = 'a',
  body?: object,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', firms[firm].id)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`)
    .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`);
  return body === undefined ? req : req.send(body);
}

/** The signed-in client's published reports of one service, on a firm's portal. */
async function portal(
  who: Person,
  engagementId: string,
  query = '',
  firm: 'a' | 'b' = 'a',
): Promise<Response> {
  return request(app.getHttpServer())
    .get(`/api/v1/portal/${firms[firm].slug}/me/services/${engagementId}/reports${query}`)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`)
    .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res;
};
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);

const workspaces = async (query = '', who: Person = people.ownerA) =>
  ItemList.parse(ok(await call('get', `/workspaces${query}`, who)).body);
const workspaceIds = async (query = '', who: Person = people.ownerA) =>
  (await workspaces(query, who)).items.map((w) => w.engagementId);
const createReport = async (engagementId: string, body: object, who: Person = people.ownerA) =>
  Report.parse(
    ok(await call('post', `/workspaces/${engagementId}/reports`, who, 'a', body), 201).body,
  );
const draft = (engagementId: string, kind: string, title = `Draft ${run}`) =>
  createReport(engagementId, { kind, title });
const reportCall = (
  id: string,
  action: 'update' | 'publish' | 'unpublish' | 'delete',
  who: Person = people.ownerA,
  body: object = { title: 'Changed' },
  firm: 'a' | 'b' = 'a',
) =>
  action === 'update'
    ? call('patch', `/reports/${id}`, who, firm, body)
    : action === 'delete'
      ? call('delete', `/reports/${id}`, who, firm)
      : call('post', `/reports/${id}/${action}`, who, firm);
const act = async (
  id: string,
  action: 'update' | 'publish' | 'unpublish',
  who: Person = people.ownerA,
  body?: object,
) => Report.parse(ok(await reportCall(id, action, who, body)).body);
const reports = async (engagementId: string, query = '', who: Person = people.ownerA) =>
  ReportList.parse(ok(await call('get', `/workspaces/${engagementId}/reports${query}`, who)).body);
const mine = async (who: Person, engagementId: string, query = '') =>
  MyReportList.parse(ok(await portal(who, engagementId, query)).body);
const stored = (id: string) => inA((tx) => tx.engagementReport.findUnique({ where: { id } }));
/** A report written straight to the database (to test what the API meets, not what it makes). */
const insertReport = (data: {
  engagementId: string;
  kind: 'REPORT' | 'RECONCILIATION' | 'ESTIMATE' | 'PROJECTION';
  title: string;
  status?: 'DRAFT' | 'PUBLISHED';
  documentId?: string;
}) =>
  inA((tx) =>
    tx.engagementReport.create({
      data: {
        businessId: firms.a.id,
        ...data,
        ...(data.status === 'PUBLISHED' ? { publishedAt: new Date() } : {}),
      },
      select: { id: true },
    }),
  ).then((r) => r.id);
/** Every page of a list, following nextCursor. */
async function allPages<T>(
  page: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>,
) {
  const items: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 50; i++) {
    const res = await page(cursor);
    items.push(...res.items);
    cursor = res.nextCursor;
    if (!cursor) return items;
  }
  throw new Error('too many pages');
}

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: /client|spouse|unlinked/i.test(key) ? 'CLIENT' : 'STAFF',
          email: p.email,
          name: `Fake R12w ${key}`,
        },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r12w-${key}-${run}`;
      firms[key] = await tx.business.create({
        data: { slug, name: slug, status: 'ACTIVE' },
        select: { id: true, slug: true },
      });
    }
  });
  const members = [
    [firms.a.id, people.ownerA.id, 'OWNER'],
    [firms.a.id, people.adminA.id, 'ADMIN'],
    [firms.a.id, people.staffA.id, 'STAFF'],
    [firms.a.id, people.staffA2.id, 'STAFF'],
    [firms.b.id, people.ownerB.id, 'OWNER'],
  ] as const;
  for (const [businessId, userId, role] of members) {
    await asOwner({ kind: 'business', businessId }, (tx) =>
      tx.membership.create({ data: { businessId, userId, role, status: 'ACTIVE' } }),
    );
  }

  const setUp = async (businessId: string, work: (tx: TxClient) => Promise<void>) =>
    asOwner({ kind: 'business', businessId }, work);
  const file = (
    tx: TxClient,
    businessId: string,
    clientId: string,
    engagementId: string,
    direction: 'FIRM_TO_CLIENT' | 'CLIENT_TO_FIRM' | 'INTERNAL',
  ) =>
    tx.document
      .create({
        data: {
          businessId,
          clientId,
          engagementId,
          direction,
          fileName: 'statement.pdf',
          contentType: 'application/pdf',
          sizeBytes: 1024,
          sha256: 'a'.repeat(64),
          s3Key: `tenant/${businessId}/${randomUUID()}`,
        },
        select: { id: true },
      })
      .then((d) => d.id);

  await setUp(firms.a.id, async (tx) => {
    const businessId = firms.a.id;
    const client = (name: string, assignedUserId: string) =>
      tx.client
        .create({ data: { businessId, displayName: name, assignedUserId }, select: { id: true } })
        .then((c) => c.id);
    clients.c1 = await client(`Wren Sample ${run} (fake)`, people.staffA.id);
    clients.c2 = await client(`Quill Example ${run} (fake)`, people.staffA2.id);
    const login = (who: Person, clientId: string | null, portalRole: 'PRIMARY' | 'SPOUSE') =>
      tx.clientAccount.create({
        data: {
          businessId,
          userId: who.id,
          email: who.email,
          clientId,
          portalRole,
          status: 'ACTIVE',
        },
      });
    await login(people.clientA, clients.c1, 'PRIMARY');
    await login(people.spouseA, clients.c1, 'SPOUSE');
    await login(people.clientA2, clients.c2, 'PRIMARY');
    await login(people.unlinkedA, null, 'PRIMARY');

    const service = (
      kind: 'BOOKKEEPING' | 'TAX_PLANNING' | 'ANNUAL_TAX',
      name: string,
      stages: string[],
    ) =>
      tx.service
        .create({ data: { businessId, kind, name, stages }, select: { id: true } })
        .then((s) => s.id);
    const bookkeeping = await service('BOOKKEEPING', 'Bookkeeping', ['Intake', 'Monthly close']);
    const planning = await service('TAX_PLANNING', 'Tax Planning', [
      'Discovery',
      'Projection',
      'Review',
    ]);
    const annual = await service('ANNUAL_TAX', 'Annual Tax', []);
    const start = Date.now() - 3_600_000;
    let minute = 0;
    const engagement = (data: {
      clientId: string;
      serviceId: string;
      title: string;
      status?: 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
      stage?: string;
      assignedUserId?: string;
      taxYear?: number;
      periodStart?: Date;
      periodEnd?: Date;
      completedAt?: Date;
      cancelledAt?: Date;
    }) =>
      tx.engagement
        .create({
          // A minute apart, so "newest activity first" has one order.
          data: { businessId, ...data, updatedAt: new Date(start + ++minute * 60_000) },
          select: { id: true },
        })
        .then((e) => e.id);
    eng.bk1 = await engagement({
      clientId: clients.c1,
      serviceId: bookkeeping,
      title: `Bookkeeping ${run}`,
      stage: 'Monthly close',
      assignedUserId: people.staffA.id,
      periodStart: new Date('2026-01-01T00:00:00.000Z'),
      periodEnd: new Date('2026-12-31T00:00:00.000Z'),
    });
    eng.tp1 = await engagement({
      clientId: clients.c1,
      serviceId: planning,
      title: `Tax Planning ${run}`,
      taxYear: 2026,
    });
    eng.tpPending = await engagement({
      clientId: clients.c1,
      serviceId: planning,
      title: `Pending Planning ${run}`,
      status: 'PENDING',
    });
    eng.at1 = await engagement({ clientId: clients.c1, serviceId: annual, title: `Annual ${run}` });
    eng.bk2 = await engagement({
      clientId: clients.c2,
      serviceId: bookkeeping,
      title: `Second Books ${run}`,
    });
    eng.tpDone = await engagement({
      clientId: clients.c1,
      serviceId: planning,
      title: `Done Planning ${run}`,
      status: 'COMPLETED',
      completedAt: new Date(),
    });
    eng.bkCancelled = await engagement({
      clientId: clients.c1,
      serviceId: bookkeeping,
      title: `Cancelled Books ${run}`,
      status: 'CANCELLED',
      cancelledAt: new Date(),
    });
    docs.shared = await file(tx, businessId, clients.c1, eng.bk1, 'FIRM_TO_CLIENT');
    docs.internal = await file(tx, businessId, clients.c1, eng.bk1, 'INTERNAL');
    docs.upload = await file(tx, businessId, clients.c1, eng.bk1, 'CLIENT_TO_FIRM');
    docs.tp = await file(tx, businessId, clients.c1, eng.tp1, 'FIRM_TO_CLIENT');

    const task = (engagementId: string | null, dueOn: string | null) =>
      tx.task.create({
        data: {
          businessId,
          clientId: clients.c1,
          engagementId,
          title: 'Workspace task (fake)',
          dueOn: dueOn ? new Date(`${dueOn}T00:00:00.000Z`) : null,
        },
      });
    await task(eng.bk1, '2026-11-05');
    await task(eng.bk1, '2026-11-02');
    await task(eng.bk1, null);
    await tx.task.create({
      data: {
        businessId,
        clientId: clients.c1,
        engagementId: eng.bk1,
        title: 'Done long ago (fake)',
        dueOn: new Date('2026-10-01T00:00:00.000Z'),
        status: 'DONE',
        completedAt: new Date(),
      },
    });
    await task(null, '2026-10-10');
    await task(eng.tp1, '2026-12-01');
  });
  await setUp(firms.b.id, async (tx) => {
    const businessId = firms.b.id;
    clients.cB = (
      await tx.client.create({
        data: { businessId, displayName: 'Other Firm Client (fake)' },
        select: { id: true },
      })
    ).id;
    await tx.clientAccount.create({
      data: {
        businessId,
        userId: people.clientB.id,
        email: people.clientB.email,
        clientId: clients.cB,
        status: 'ACTIVE',
      },
    });
    const service = await tx.service.create({
      data: { businessId, kind: 'BOOKKEEPING', name: 'Bookkeeping' },
      select: { id: true },
    });
    eng.bkB = (
      await tx.engagement.create({
        data: { businessId, clientId: clients.cB, serviceId: service.id, title: `B Books ${run}` },
        select: { id: true },
      })
    ).id;
    docs.b = await file(tx, businessId, clients.cB, eng.bkB, 'FIRM_TO_CLIENT');
  });

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env)],
  }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('workspaces', () => {
  it('lists open Bookkeeping and Tax Planning work with open tasks and the next due date', async () => {
    const list = await workspaces();
    expect(list.items.map((w) => w.engagementId)).toEqual([eng.bk2, eng.tp1, eng.bk1]);
    expect(list.nextCursor).toBeNull();
    const byId = new Map(list.items.map((w) => [w.engagementId, w]));
    expect(byId.get(eng.bk1)).toEqual({
      engagementId: eng.bk1,
      kind: 'BOOKKEEPING',
      title: `Bookkeeping ${run}`,
      client: { id: clients.c1, displayName: `Wren Sample ${run} (fake)` },
      serviceName: 'Bookkeeping',
      status: 'ACTIVE',
      stage: 'Monthly close',
      assignedTo: { userId: people.staffA.id, name: 'Fake R12w staffA' },
      taxYear: null,
      periodStart: '2026-01-01',
      periodEnd: '2026-12-31',
      openTasks: 3,
      nextDueOn: '2026-11-02',
      updatedAt: expect.any(String) as string,
    });
    expect(byId.get(eng.tp1)).toMatchObject({
      kind: 'TAX_PLANNING',
      serviceName: 'Tax Planning',
      taxYear: 2026,
      assignedTo: null,
      openTasks: 1,
      nextDueOn: '2026-12-01',
    });
    expect(byId.get(eng.bk2)).toMatchObject({ openTasks: 0, nextDueOn: null });

    expect(await workspaceIds('?kind=BOOKKEEPING')).toEqual([eng.bk2, eng.bk1]);
    expect(await workspaceIds('?kind=TAX_PLANNING')).toEqual([eng.tp1]);
    expect(await workspaceIds('?status=PENDING')).toEqual([eng.tpPending]);
    expect(await workspaceIds('?status=COMPLETED')).toEqual([eng.tpDone]);
    expect(await workspaceIds('?status=CANCELLED&kind=BOOKKEEPING')).toEqual([eng.bkCancelled]);
    expect(await workspaceIds(`?assignedUserId=${people.staffA.id}`)).toEqual([eng.bk1]);
    expect(await workspaceIds(`?search=${encodeURIComponent('quill example')}`)).toEqual([eng.bk2]);
    expect(await workspaceIds(`?search=${encodeURIComponent(`tax planning ${run}`)}`)).toEqual([
      eng.tp1,
    ]);
    expect(await workspaceIds(`?search=${encodeURIComponent('%')}`)).toEqual([]);
    expect(await workspaceIds('?search=_')).toEqual([]);

    const first = await workspaces('?limit=2');
    expect(first.items.map((w) => w.engagementId)).toEqual([eng.bk2, eng.tp1]);
    const second = await workspaces(`?limit=2&cursor=${first.nextCursor}`);
    expect([second.items.map((w) => w.engagementId), second.nextCursor]).toEqual([[eng.bk1], null]);
  });

  it("Staff see only their clients' workspaces; Admin sees all", async () => {
    expect(await workspaceIds('', people.staffA)).toEqual([eng.tp1, eng.bk1]);
    expect(await workspaceIds('', people.staffA2)).toEqual([eng.bk2]);
    expect(await workspaceIds(`?assignedUserId=${people.staffA2.id}`, people.staffA)).toEqual([]);
    expect(await workspaceIds('', people.adminA)).toEqual([eng.bk2, eng.tp1, eng.bk1]);
    expectError(await call('get', `/workspaces/${eng.bk2}`, people.staffA), 404, 'NOT_FOUND');
    expectError(await call('get', `/workspaces/${eng.bk1}`, people.staffA2), 404, 'NOT_FOUND');
    expect(
      Detail.parse(ok(await call('get', `/workspaces/${eng.bk1}`, people.staffA)).body)
        .engagementId,
    ).toBe(eng.bk1);
  });

  it('the detail is the list item with the stages; other kinds and firms are 404', async () => {
    const item = (await workspaces()).items.find((w) => w.engagementId === eng.bk1);
    const detail = Detail.parse(ok(await call('get', `/workspaces/${eng.bk1}`)).body);
    expect(detail).toEqual({ ...item, stages: ['Intake', 'Monthly close'] });
    expect(Detail.parse(ok(await call('get', `/workspaces/${eng.tpDone}`)).body)).toMatchObject({
      status: 'COMPLETED',
      stages: ['Discovery', 'Projection', 'Review'],
    });
    for (const id of [eng.at1, eng.bkB, randomUUID()]) {
      expectError(await call('get', `/workspaces/${id}`), 404, 'NOT_FOUND');
    }
    expectError(await call('get', `/workspaces/${eng.bk1}`, people.ownerB, 'b'), 404, 'NOT_FOUND');
    expectError(await call('get', '/workspaces', people.ownerB, 'a'), 404, 'NOT_FOUND');
    const other = ItemList.parse(ok(await call('get', '/workspaces', people.ownerB, 'b')).body);
    expect(other.items.map((w) => w.engagementId)).toEqual([eng.bkB]);
    expectError(await call('get', '/workspaces/not-a-uuid'), 400, 'VALIDATION_FAILED');
    expectError(await call('get', '/workspaces', people.clientA), 403, 'FORBIDDEN');
  });

  it('refuses bad queries with 400', async () => {
    for (const query of [
      '?kind=ANNUAL_TAX',
      '?status=OPEN',
      '?search=%00',
      '?search=a%01b',
      `?search=${'x'.repeat(101)}`,
      '?limit=0',
      '?limit=101',
      '?cursor=nope',
      `?cursor=${Buffer.from(`t|0000-01-01T00:00:00.000Z|${eng.bk1}`).toString('base64url')}`,
      '?unknown=1',
    ]) {
      expectError(await call('get', `/workspaces${query}`), 400, 'VALIDATION_FAILED');
    }
  });
});

describe('reports', () => {
  it('creates drafts whose kind fits the workspace, with figures and a file', async () => {
    const r = await createReport(eng.bk1, {
      kind: 'REPORT',
      title: 'September close (fake)',
      periodLabel: 'September 2026',
      data: {
        summary: 'All accounts reconciled.\nNothing open.',
        lines: [
          { label: 'Revenue', amountCents: 4_825_000 },
          { label: 'Expenses', amountCents: -3_112_050, note: 'Includes payroll' },
          { label: 'Pending', amountCents: null, note: '' },
        ],
      },
      documentId: docs.shared,
    });
    expect(r).toEqual({
      id: expect.any(String) as string,
      engagementId: eng.bk1,
      kind: 'REPORT',
      title: 'September close (fake)',
      periodLabel: 'September 2026',
      status: 'DRAFT',
      data: {
        summary: 'All accounts reconciled.\nNothing open.',
        lines: [
          { label: 'Revenue', amountCents: 4_825_000, note: null },
          { label: 'Expenses', amountCents: -3_112_050, note: 'Includes payroll' },
          { label: 'Pending', amountCents: null, note: null },
        ],
      },
      documentId: docs.shared,
      publishedAt: null,
      firstPublishedAt: null,
      createdBy: { userId: people.ownerA.id, name: 'Fake R12w ownerA' },
      createdAt: expect.any(String) as string,
      updatedAt: expect.any(String) as string,
    });
    const bare = await createReport(eng.bk1, {
      kind: 'RECONCILIATION',
      title: 'Bank rec 😀',
      periodLabel: '',
    });
    expect(bare).toMatchObject({
      title: 'Bank rec 😀',
      periodLabel: null,
      data: { summary: null, lines: [] },
    });
    expect(
      (
        await createReport(eng.bk1, {
          kind: 'REPORT',
          title: 'Their upload',
          documentId: docs.upload,
        })
      ).documentId,
    ).toBe(docs.upload);
    for (const kind of ['ESTIMATE', 'PROJECTION'] as const) {
      expect(
        (await createReport(eng.tp1, { kind, title: `${kind} (fake)` }, people.adminA)).kind,
      ).toBe(kind);
    }

    expectError(
      await call('post', `/workspaces/${eng.bk1}/reports`, people.ownerA, 'a', {
        kind: 'ESTIMATE',
        title: 'X',
      }),
      409,
      'WRONG_REPORT_KIND',
    );
    expectError(
      await call('post', `/workspaces/${eng.tp1}/reports`, people.ownerA, 'a', {
        kind: 'REPORT',
        title: 'X',
      }),
      409,
      'WRONG_REPORT_KIND',
    );
    for (const id of [eng.at1, eng.bkB, randomUUID()]) {
      expectError(
        await call('post', `/workspaces/${id}/reports`, people.ownerA, 'a', {
          kind: 'REPORT',
          title: 'X',
        }),
        404,
        'NOT_FOUND',
      );
    }
  });

  it("a report's file is the engagement's and never INTERNAL, on attach and on publish", async () => {
    const post = (documentId: string) =>
      call('post', `/workspaces/${eng.bk1}/reports`, people.ownerA, 'a', {
        kind: 'REPORT',
        title: 'With a file',
        documentId,
      });
    for (const documentId of [docs.tp, docs.b, randomUUID()]) {
      expectError(await post(documentId), 409, 'DOCUMENT_MISMATCH');
    }
    expectError(await post(docs.internal), 409, 'INTERNAL_DOCUMENT');

    const r = await draft(eng.bk1, 'REPORT');
    expectError(
      await reportCall(r.id, 'update', people.ownerA, { documentId: docs.internal }),
      409,
      'INTERNAL_DOCUMENT',
    );
    expectError(
      await reportCall(r.id, 'update', people.ownerA, { documentId: docs.tp }),
      409,
      'DOCUMENT_MISMATCH',
    );
    expect((await act(r.id, 'update', people.ownerA, { documentId: docs.shared })).documentId).toBe(
      docs.shared,
    );
    expect((await act(r.id, 'update', people.ownerA, { documentId: null })).documentId).toBeNull();
    expect((await stored(r.id))?.documentId).toBeNull();

    // Written around the API: publishing checks the file again.
    const sneaky = await insertReport({
      engagementId: eng.bk1,
      kind: 'REPORT',
      title: 'Internal file (fake)',
      documentId: docs.internal,
    });
    expectError(await reportCall(sneaky, 'publish'), 409, 'INTERNAL_DOCUMENT');
    expect((await stored(sneaky))?.status).toBe('DRAFT');
  });

  it('publish, unpublish and delete; a report once published is never deleted', async () => {
    const r = await createReport(eng.bk1, {
      kind: 'REPORT',
      title: 'Lifecycle (fake)',
      documentId: docs.shared,
    });
    const published = await act(r.id, 'publish');
    expect(published).toMatchObject({ status: 'PUBLISHED', documentId: docs.shared });
    expect(published.publishedAt).not.toBeNull();
    expect(published.firstPublishedAt).toBe(published.publishedAt);
    expect((await act(r.id, 'publish')).publishedAt).toBe(published.publishedAt);

    const hidden = await act(r.id, 'unpublish');
    expect(hidden).toMatchObject({
      status: 'DRAFT',
      publishedAt: null,
      firstPublishedAt: published.firstPublishedAt,
    });
    expect((await act(r.id, 'unpublish')).status).toBe('DRAFT');
    expectError(await reportCall(r.id, 'delete'), 409, 'REPORT_WAS_PUBLISHED');
    const again = await act(r.id, 'publish');
    expect(again.firstPublishedAt).toBe(published.firstPublishedAt);
    expect(again.publishedAt).not.toBe(published.publishedAt);
    // A published report can still be edited; the client sees the change at once.
    expect(
      await act(r.id, 'update', people.ownerA, { title: 'Lifecycle, edited', periodLabel: 'Q3' }),
    ).toMatchObject({
      status: 'PUBLISHED',
      title: 'Lifecycle, edited',
      periodLabel: 'Q3',
    });

    const d = await draft(eng.bk1, 'RECONCILIATION');
    expect(ok(await reportCall(d.id, 'delete')).body).toEqual({ ok: true });
    expect(await stored(d.id)).toBeNull();
    expect((await reports(eng.bk1, '?limit=100')).items.map((i) => i.id)).not.toContain(d.id);
    for (const action of ['update', 'publish', 'unpublish', 'delete'] as const) {
      expectError(await reportCall(d.id, action), 404, 'NOT_FOUND');
    }
  });

  it('a closed engagement: only unpublish, and deleting a never-published draft', async () => {
    const published = await insertReport({
      engagementId: eng.tpDone,
      kind: 'PROJECTION',
      title: 'Year end',
      status: 'PUBLISHED',
    });
    const kept = await insertReport({
      engagementId: eng.tpDone,
      kind: 'PROJECTION',
      title: 'Still shown',
      status: 'PUBLISHED',
    });
    const neverShown = await insertReport({
      engagementId: eng.tpDone,
      kind: 'ESTIMATE',
      title: 'Never shown',
    });
    const once = await insertReport({
      engagementId: eng.tpDone,
      kind: 'ESTIMATE',
      title: 'Shown once',
      status: 'PUBLISHED',
    });
    await inA((tx) =>
      tx.engagementReport.update({
        where: { id: once },
        data: { status: 'DRAFT', publishedAt: null },
      }),
    );

    for (const id of [eng.tpDone, eng.bkCancelled]) {
      const kind = id === eng.tpDone ? 'ESTIMATE' : 'REPORT';
      expectError(
        await call('post', `/workspaces/${id}/reports`, people.ownerA, 'a', {
          kind,
          title: 'Late',
        }),
        409,
        'ENGAGEMENT_CLOSED',
      );
    }
    expectError(await reportCall(neverShown, 'update'), 409, 'ENGAGEMENT_CLOSED');
    expectError(await reportCall(neverShown, 'publish'), 409, 'ENGAGEMENT_CLOSED');
    expectError(await reportCall(published, 'update'), 409, 'ENGAGEMENT_CLOSED');
    expect((await act(published, 'unpublish')).status).toBe('DRAFT');
    expectError(await reportCall(published, 'publish'), 409, 'ENGAGEMENT_CLOSED');
    expectError(await reportCall(once, 'delete'), 409, 'REPORT_WAS_PUBLISHED');
    expect(ok(await reportCall(neverShown, 'delete')).body).toEqual({ ok: true });
    expect((await stored(kept))?.status).toBe('PUBLISHED');
    // The client keeps seeing what is still published on the closed service.
    expect((await mine(people.clientA, eng.tpDone)).items.map((i) => i.id)).toEqual([kept]);

    // PENDING is open.
    const pending = await createReport(eng.tpPending, {
      kind: 'ESTIMATE',
      title: 'Early estimate',
    });
    expect((await act(pending.id, 'publish')).status).toBe('PUBLISHED');
  });

  it('lists newest first, by status, paged', async () => {
    const before = await reports(eng.bk1, '?limit=100');
    const all = await allPages((cursor) =>
      reports(eng.bk1, `?limit=2${cursor ? `&cursor=${cursor}` : ''}`),
    );
    expect(all.map((r) => r.id)).toEqual(before.items.map((r) => r.id));
    expect(all.length).toBeGreaterThan(4);
    const created = all.map((r) => r.createdAt);
    expect([...created].sort().reverse()).toEqual(created);
    const published = (await reports(eng.bk1, '?status=PUBLISHED&limit=100')).items;
    const drafts = (await reports(eng.bk1, '?status=DRAFT&limit=100')).items;
    expect(published.every((r) => r.status === 'PUBLISHED')).toBe(true);
    expect(drafts.every((r) => r.status === 'DRAFT')).toBe(true);
    expect(published.length + drafts.length).toBe(all.length);
    expect(published.length).toBeGreaterThan(0);
    for (const query of ['?status=BAD', '?limit=101', '?cursor=bad', '?unknown=1']) {
      expectError(
        await call('get', `/workspaces/${eng.bk1}/reports${query}`),
        400,
        'VALIDATION_FAILED',
      );
    }
    // Bad input is 400 before an unknown workspace is 404.
    expectError(
      await call('get', `/workspaces/${randomUUID()}/reports?status=BAD`),
      400,
      'VALIDATION_FAILED',
    );
    expectError(await call('get', `/workspaces/${randomUUID()}/reports`), 404, 'NOT_FOUND');
  });

  it('refuses bad input with 400: whole cents, plain text, no NUL or half surrogate pairs', async () => {
    const r = await draft(eng.bk1, 'REPORT');
    const line = (fields: object) => ({
      kind: 'REPORT',
      title: 'Figures',
      data: { lines: [{ label: 'Revenue', ...fields }] },
    });
    for (const body of [
      {},
      { kind: 'REPORT' },
      { kind: 'BAD', title: 'X' },
      { kind: 'REPORT', title: '' },
      { kind: 'REPORT', title: 'Nul \u0000' },
      { kind: 'REPORT', title: 'Half \ud800' },
      { kind: 'REPORT', title: 'Tab\there' },
      { kind: 'REPORT', title: 'X', periodLabel: 'p'.repeat(61) },
      { kind: 'REPORT', title: 'X', status: 'PUBLISHED' },
      { kind: 'REPORT', title: 'X', documentId: 'not-a-uuid' },
      { kind: 'REPORT', title: 'X', data: { summary: 'Half \udbff' } },
      { kind: 'REPORT', title: 'X', data: { summary: 'Nul \u0000' } },
      { kind: 'REPORT', title: 'X', data: { lines: [], extra: 1 } },
      {
        kind: 'REPORT',
        title: 'X',
        data: { lines: Array.from({ length: 201 }, () => ({ label: 'L' })) },
      },
      line({ amountCents: 1.5 }),
      line({ amountCents: '100' }),
      line({ amountCents: 1e15 }),
      line({ label: '' }),
      line({ label: 'Nul \u0000' }),
      line({ label: 'Half \udc00' }),
      line({ note: 'Half \ud800 note' }),
      line({ currency: 'USD' }),
    ]) {
      const res = await call('post', `/workspaces/${eng.bk1}/reports`, people.ownerA, 'a', body);
      expectError(res, 400, 'VALIDATION_FAILED');
    }
    for (const body of [
      {},
      { title: '' },
      { status: 'PUBLISHED' },
      { kind: 'RECONCILIATION' },
      { title: 'Half \ud801' },
    ]) {
      expectError(await reportCall(r.id, 'update', people.ownerA, body), 400, 'VALIDATION_FAILED');
    }
    for (const action of ['update', 'publish', 'unpublish', 'delete'] as const) {
      expectError(await reportCall('not-a-uuid', action), 400, 'VALIDATION_FAILED');
      expectError(await reportCall(randomUUID(), action), 404, 'NOT_FOUND');
    }
    expectError(
      await call('post', '/workspaces/not-a-uuid/reports', people.ownerA, 'a', {
        kind: 'REPORT',
        title: 'X',
      }),
      400,
      'VALIDATION_FAILED',
    );
    expect((await stored(r.id))?.title).toBe(`Draft ${run}`);
  });
});

describe('who changes reports', () => {
  it("Staff draft, edit, publish, unpublish and delete on their clients' workspaces only", async () => {
    const r = await createReport(eng.bk1, { kind: 'REPORT', title: 'By staff' }, people.staffA);
    expect(r.createdBy).toEqual({ userId: people.staffA.id, name: 'Fake R12w staffA' });
    expect((await act(r.id, 'update', people.staffA, { title: 'By staff, edited' })).title).toBe(
      'By staff, edited',
    );
    expect((await act(r.id, 'publish', people.staffA)).status).toBe('PUBLISHED');
    expect((await act(r.id, 'unpublish', people.staffA)).status).toBe('DRAFT');
    const d = await draft(eng.tp1, 'ESTIMATE');
    expect(ok(await reportCall(d.id, 'delete', people.staffA)).body).toEqual({ ok: true });
    expect((await reports(eng.bk1, '?limit=100', people.staffA)).items.map((i) => i.id)).toContain(
      r.id,
    );

    const theirs = await draft(eng.bk2, 'REPORT', 'Not for staffA');
    expectError(
      await call('get', `/workspaces/${eng.bk2}/reports`, people.staffA),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', `/workspaces/${eng.bk2}/reports`, people.staffA, 'a', {
        kind: 'REPORT',
        title: 'X',
      }),
      404,
      'NOT_FOUND',
    );
    for (const action of ['update', 'publish', 'unpublish', 'delete'] as const) {
      expectError(await reportCall(theirs.id, action, people.staffA), 404, 'NOT_FOUND');
    }
    expect(await stored(theirs.id)).toMatchObject({ title: 'Not for staffA', status: 'DRAFT' });
    expect((await act(theirs.id, 'publish', people.staffA2)).status).toBe('PUBLISHED');
  });

  it('another firm gets 404 on every route and changes nothing', async () => {
    const r = await createReport(eng.bk1, {
      kind: 'REPORT',
      title: 'Firm A only',
      documentId: docs.shared,
    });
    await act(r.id, 'publish');
    const before = await stored(r.id);
    expectError(
      await call('get', `/workspaces/${eng.bk1}/reports`, people.ownerB, 'b'),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', `/workspaces/${eng.bk1}/reports`, people.ownerB, 'b', {
        kind: 'REPORT',
        title: 'X',
      }),
      404,
      'NOT_FOUND',
    );
    for (const action of ['update', 'publish', 'unpublish', 'delete'] as const) {
      expectError(
        await reportCall(r.id, action, people.ownerB, { title: 'Taken' }, 'b'),
        404,
        'NOT_FOUND',
      );
    }
    expect(await stored(r.id)).toEqual(before);
    // Firm B cannot attach firm A's file to its own report either.
    expectError(
      await call('post', `/workspaces/${eng.bkB}/reports`, people.ownerB, 'b', {
        kind: 'REPORT',
        title: 'X',
        documentId: docs.shared,
      }),
      409,
      'DOCUMENT_MISMATCH',
    );
    expect(
      Report.parse(
        ok(
          await call('post', `/workspaces/${eng.bkB}/reports`, people.ownerB, 'b', {
            kind: 'REPORT',
            title: 'B',
            documentId: docs.b,
          }),
          201,
        ).body,
      ).documentId,
    ).toBe(docs.b);
  });

  it('changes at the same time never answer 500', async () => {
    const r = await draft(eng.bk1, 'REPORT', 'Race');
    const [published, deleted] = await Promise.all([
      reportCall(r.id, 'publish'),
      reportCall(r.id, 'delete'),
    ]);
    const outcome = [published.status, deleted.status];
    expect([
      [200, 409],
      [404, 200],
    ]).toContainEqual(outcome);
    if (deleted.status === 409) expect(codeOf(deleted)).toBe('REPORT_WAS_PUBLISHED');
    expect((await stored(r.id)) === null).toBe(deleted.status === 200);

    const s = await draft(eng.bk1, 'REPORT', 'Busy');
    const results = await Promise.all([
      reportCall(s.id, 'publish'),
      reportCall(s.id, 'update', people.ownerA, { title: 'Busy 1' }),
      reportCall(s.id, 'unpublish'),
      reportCall(s.id, 'update', people.ownerA, { title: 'Busy 2' }),
      reportCall(s.id, 'publish'),
    ]);
    expect(results.map((res) => res.status)).toEqual([200, 200, 200, 200, 200]);
  });
});

describe("the portal: a client's published reports", () => {
  it('the client sees the published reports of their own service, newest published first', async () => {
    const first = await createReport(eng.bk1, {
      kind: 'REPORT',
      title: 'Portal one',
      data: { lines: [{ label: 'Revenue', amountCents: 1200 }] },
    });
    const second = await createReport(eng.bk1, {
      kind: 'RECONCILIATION',
      title: 'Portal two',
      documentId: docs.shared,
    });
    const hidden = await draft(eng.bk1, 'REPORT', 'Portal draft');
    const withdrawn = await draft(eng.bk1, 'REPORT', 'Portal withdrawn');
    await act(second.id, 'publish');
    await act(first.id, 'publish');
    await act(withdrawn.id, 'publish');
    await act(withdrawn.id, 'unpublish');

    const seen = await allPages((cursor) =>
      mine(people.clientA, eng.bk1, `?limit=2${cursor ? `&cursor=${cursor}` : ''}`),
    );
    const published = await inA((tx) =>
      tx.engagementReport.findMany({
        where: { engagementId: eng.bk1, status: 'PUBLISHED' },
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      }),
    );
    expect(seen.map((r) => r.id)).toEqual(published.map((r) => r.id));
    expect(seen.slice(0, 2).map((r) => r.id)).toEqual([first.id, second.id]);
    for (const id of [hidden.id, withdrawn.id]) expect(seen.map((r) => r.id)).not.toContain(id);
    expect(seen[0]).toEqual({
      id: first.id,
      kind: 'REPORT',
      title: 'Portal one',
      periodLabel: null,
      data: { summary: null, lines: [{ label: 'Revenue', amountCents: 1200, note: null }] },
      documentId: null,
      publishedAt: expect.any(String) as string,
    });
    expect(seen[1]?.documentId).toBe(docs.shared);
    // A spouse's login on the same client record sees the same reports.
    expect((await mine(people.spouseA, eng.bk1, '?limit=50')).items.map((r) => r.id)).toEqual(
      seen.slice(0, 50).map((r) => r.id),
    );
    // Their own service without a workspace has none; a firm-only file is never shown.
    expect(await mine(people.clientA, eng.at1)).toEqual({ items: [], nextCursor: null });
    const leaked = await insertReport({
      engagementId: eng.bk1,
      kind: 'REPORT',
      title: 'Written around the API',
      status: 'PUBLISHED',
      documentId: docs.internal,
    });
    const top = (await mine(people.clientA, eng.bk1, '?limit=1')).items[0];
    expect([top?.id, top?.documentId]).toEqual([leaked, null]);
  });

  it("another client's service, another firm's, or no client record is 404", async () => {
    for (const id of [eng.bk2, eng.bkB, randomUUID()]) {
      expectError(await portal(people.clientA, id), 404, 'NOT_FOUND');
    }
    expectError(await portal(people.clientA2, eng.bk1), 404, 'NOT_FOUND');
    expectError(await portal(people.unlinkedA, eng.bk1), 404, 'NOT_FOUND');
    expectError(await portal(people.clientB, eng.bk1, '', 'b'), 404, 'NOT_FOUND');
    expectError(await portal(people.clientB, eng.bkB, '', 'a'), 404, 'NOT_FOUND');
    expect(ok(await portal(people.clientB, eng.bkB, '', 'b')).body).toEqual({
      items: [],
      nextCursor: null,
    });
    // Staff sessions never open portal routes.
    expectError(await portal(people.ownerA, eng.bk1), 401, 'UNAUTHENTICATED');
    for (const query of ['?limit=51', '?limit=0', '?cursor=bad', '?status=PUBLISHED']) {
      expectError(await portal(people.clientA, eng.bk1, query), 400, 'VALIDATION_FAILED');
    }
    expectError(await portal(people.clientA, 'not-a-uuid'), 400, 'VALIDATION_FAILED');
  });
});

describe('audit', () => {
  it('logs reads and changes with ids, kinds and field names, never text or amounts', async () => {
    const marker = `Secret-${run}`;
    const r = await createReport(eng.bk1, {
      kind: 'REPORT',
      title: `${marker} title`,
      periodLabel: `${marker} period`,
      data: {
        summary: `${marker} summary`,
        lines: [{ label: `${marker} line`, amountCents: 987_654_321 }],
      },
      documentId: docs.shared,
    });
    await act(r.id, 'update', people.ownerA, { title: `${marker} again`, data: { lines: [] } });
    await act(r.id, 'publish');
    await act(r.id, 'unpublish');
    const d = await draft(eng.bk1, 'REPORT', `${marker} draft`);
    ok(await reportCall(d.id, 'delete'));
    await reports(eng.bk1, '?status=DRAFT');
    await workspaces('?kind=BOOKKEEPING');
    ok(await call('get', `/workspaces/${eng.bk1}`));
    await mine(people.clientA, eng.bk1);

    const rows = await inA((tx) =>
      tx.auditLog.findMany({
        where: {
          businessId: firms.a.id,
          OR: [{ entityId: { in: [r.id, d.id, eng.bk1] } }, { action: 'workspaces.listed' }],
        },
      }),
    );
    const actions = rows.map((row) => row.action);
    for (const action of [
      'report.created',
      'report.updated',
      'report.published',
      'report.unpublished',
      'report.deleted',
      'reports.listed',
      'workspaces.listed',
      'workspace.viewed',
      'portal.reports_viewed',
    ]) {
      expect(actions).toContain(action);
    }
    const text = JSON.stringify(rows.map((row) => row.metadata));
    expect(text).not.toContain(marker);
    expect(text).not.toContain('987654321');
    const of = (action: string, id: string) =>
      rows.find((row) => row.action === action && row.entityId === id)?.metadata;
    expect(of('report.created', r.id)).toEqual({
      engagementId: eng.bk1,
      clientId: clients.c1,
      kind: 'REPORT',
      documentAttached: true,
      lines: 1,
    });
    expect(of('report.updated', r.id)).toEqual({
      engagementId: eng.bk1,
      clientId: clients.c1,
      status: 'DRAFT',
      fields: ['data', 'title'],
    });
    expect(of('report.published', r.id)).toEqual({
      engagementId: eng.bk1,
      clientId: clients.c1,
      firstTime: true,
    });
    expect(of('report.deleted', d.id)).toEqual({ engagementId: eng.bk1, clientId: clients.c1 });
    expect(
      rows.filter((row) => row.action === 'portal.reports_viewed').map((row) => row.actorUserId),
    ).toContain(people.clientA.id);
  });
});

describe('#109 review', () => {
  it('takes the largest report the contract allows, in 3-byte characters (201)', async () => {
    const wide = (n: number) => '日'.repeat(n);
    const body = {
      kind: 'REPORT',
      title: wide(160),
      periodLabel: wide(60),
      data: {
        summary: wide(2_000),
        lines: Array.from({ length: 50 }, () => ({
          label: wide(120),
          amountCents: -123_456_789,
          note: wide(400),
        })),
      },
    };
    expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(80_000);
    const created = await createReport(eng.bk1, body);
    expect([created.data.lines.length, created.data.lines[49]?.note]).toEqual([50, wide(400)]);
  });

  it('answers 413 PAYLOAD_TOO_LARGE for a body over the 2 MB limit, and 400 for one not JSON', async () => {
    const huge = await call('post', `/workspaces/${eng.bk1}/reports`, people.ownerA, 'a', {
      kind: 'REPORT',
      title: 'Too large',
      data: { summary: 'x'.repeat(2_200_000) },
    });
    expectError(huge, 413, 'PAYLOAD_TOO_LARGE');
    const broken = await request(app.getHttpServer())
      .post(`/api/v1/business/workspaces/${eng.bk1}/reports`)
      .set('x-business-id', firms.a.id)
      .set('authorization', `Bearer ${await tokenFor(people.ownerA.email)}`)
      .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`)
      .set('content-type', 'application/json')
      .send('{"kind":');
    expectError(broken, 400, 'BAD_REQUEST');
  });

  it('waits for a reassignment of the client under way, then answers as it says (q5)', async () => {
    // c1 is staffA's; a reassignment to staffA2 is under way when staffA publishes.
    const r = await draft(eng.bk1, 'REPORT', `Race q5 ${run}`);
    const reassigning = asOwner({ kind: 'business', businessId: firms.a.id }, async (tx) => {
      await tx.client.update({
        where: { id: clients.c1 },
        data: { assignedUserId: people.staffA2.id },
      });
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const res = await reportCall(r.id, 'publish', people.staffA);
      await reassigning;
      expectError(res, 404, 'NOT_FOUND');
      expect((await stored(r.id))?.status).toBe('DRAFT');
    } finally {
      await reassigning.catch(() => undefined);
      await inA((tx) =>
        tx.client.update({ where: { id: clients.c1 }, data: { assignedUserId: people.staffA.id } }),
      );
    }
  });

  it("shows no reports of the client's service without a workspace, whatever a row says", async () => {
    await insertReport({
      engagementId: eng.at1,
      kind: 'REPORT',
      title: `Stray ${run}`,
      status: 'PUBLISHED',
    });
    expect((await mine(people.clientA, eng.at1)).items).toEqual([]);
  });

  it('a publish and a delete of its attached document at the same time never deadlock', async () => {
    const r = await createReport(eng.bk1, {
      kind: 'REPORT',
      title: `Document race ${run}`,
      documentId: docs.upload,
    });
    // As a document delete does: the document's row first, then the reports that refer to it.
    const deleting = asOwner({ kind: 'business', businessId: firms.a.id }, async (tx) => {
      await tx.$queryRaw`SELECT id FROM documents WHERE id = ${docs.upload}::uuid FOR UPDATE`;
      await new Promise((resolve) => setTimeout(resolve, 300));
      await tx.document.delete({ where: { id: docs.upload } });
    }).then(
      () => 'deleted',
      (e: unknown) => (/deadlock|40P01|P2034/i.test(String(e)) ? 'deadlock' : 'refused'),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    const res = await reportCall(r.id, 'publish');
    // The publish lands; the delete then meets the report's foreign key and is refused.
    expect([res.status, await deleting], JSON.stringify(res.body)).toEqual([200, 'refused']);
  });
});
