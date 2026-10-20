// End-to-end (R1, Oct 20): the clients list's work fields and filters, GET /business/clients/summary
// and POST /business/clients/bulk (contract in packages/types/src/clients). Each firm's rows,
// counts and changes are its own: firm B's clients, services, invoices and appointments never
// reach firm A's answers, and firm B's ids in a request are 404. Staff count only their own
// clients; bulk is Owner and Admin. Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { BulkClientsResponse, ClientsSummary, ListClientsResponse } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { TokenService } from '../../src/auth/token.service.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r1w-${key}-${run}@r1w.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  clientA: person('client-a'),
  ownerB: person('owner-b'),
};
type Person = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', { id: string }>;
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
/** The firm's calendar day (no settings row: America/New_York). */
const nyDay = (offset: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
    new Date(Date.now() + offset * DAY),
  );

let app: INestApplication;
const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
const inFirm = <T>(k: 'a' | 'b', work: (tx: TxClient) => Promise<T>) =>
  runInScope(
    db,
    {
      kind: 'business',
      businessId: firms[k].id,
      actorUserId: (k === 'a' ? people.ownerA : people.ownerB).id,
    },
    work,
  );

async function call(
  method: 'get' | 'post',
  path: string,
  who: Person,
  firm: 'a' | 'b' = 'a',
  body?: object,
  pool: 'STAFF' | 'CLIENT' = 'STAFF',
) {
  const { token } = await app.get(TokenService).signLocal(who.id, pool);
  const req = request(app.getHttpServer())
    [method](`/api/v1/business/clients${path}`)
    .set('x-business-id', firms[firm].id)
    .set('authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body);
}
const codeOf = (body: unknown) => (body as { error?: { code: string } }).error?.code;
async function list(query: string, who: Person = people.ownerA) {
  const res = await call('get', query, who);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return ListClientsResponse.parse(res.body);
}
async function summary(who: Person, firm: 'a' | 'b' = 'a') {
  const res = await call('get', '/summary', who, firm);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return ClientsSummary.parse(res.body);
}

const ids = {} as Record<'w1' | 'w2' | 'w3' | 'w4' | 'w5' | 'b1' | 'personal' | 'books', string>;

beforeAll(async () => {
  await runInScope(db, { kind: 'platform' }, async (tx) => {
    await tx.user.createMany({
      data: Object.entries(people).map(([key, p]) => ({
        ...p,
        cognitoSub: p.id,
        pool: key === 'clientA' ? 'CLIENT' : 'STAFF',
        name: `Fake R1W ${key}`,
      })),
    });
    for (const key of ['a', 'b'] as const) {
      const slug = `r1w-${key}-${run}`;
      firms[key] = await tx.business.create({
        data: { slug, name: slug, status: 'ACTIVE' },
        select: { id: true },
      });
    }
  });
  for (const [k, userId, role] of [
    ['a', people.ownerA.id, 'OWNER'],
    ['a', people.adminA.id, 'ADMIN'],
    ['a', people.staffA.id, 'STAFF'],
    ['b', people.ownerB.id, 'OWNER'],
  ] as const) {
    await runInScope(db, { kind: 'business', businessId: firms[k].id }, (tx) =>
      tx.membership.create({ data: { businessId: firms[k].id, userId, role, status: 'ACTIVE' } }),
    );
  }

  /** An OPEN invoice of `cents` with `paid` cents received in cash. */
  const invoice = async (
    tx: TxClient,
    businessId: string,
    clientId: string,
    cents: number,
    paid: number,
    by: string,
  ) => {
    const { id } = await tx.invoice.create({
      data: { businessId, clientId, number: `INV-${randomUUID()}` },
    });
    await tx.invoiceLine.create({
      data: { businessId, invoiceId: id, description: 'Fake', unitAmountCents: cents },
    });
    await tx.invoice.update({ where: { id }, data: { status: 'OPEN', issuedAt: new Date() } });
    if (paid > 0) {
      await tx.offlinePayment.create({
        data: {
          businessId,
          invoiceId: id,
          recordedByUserId: by,
          method: 'CASH',
          amountCents: paid,
          receivedOn: new Date(`${nyDay(0)}T00:00:00.000Z`),
          idempotencyKey: randomUUID(),
        },
      });
    }
  };

  // Firm A: w1 is Staff's, active, with open work; w2 new and unassigned; w3 archived; w4 has
  // only a completed engagement; w5 is at the Inactive stage (still listed).
  await inFirm('a', async (tx) => {
    const businessId = firms.a.id;
    const client = (key: string, extra: object = {}) =>
      tx.client
        .create({ data: { businessId, displayName: `Work ${key} (fake)`, ...extra } })
        .then((c) => c.id);
    ids.w1 = await client('w1', {
      assignedUserId: people.staffA.id,
      status: 'ACTIVE',
      lastActivityAt: ago(2),
    });
    ids.w2 = await client('w2');
    ids.w3 = await client('w3', { archivedAt: new Date() });
    ids.w4 = await client('w4', { status: 'PENDING_DOCUMENTS', lastActivityAt: ago(40) });
    ids.w5 = await client('w5', { status: 'INACTIVE' });
    ids.personal = (
      await tx.service.create({ data: { businessId, kind: 'ANNUAL_TAX', name: 'Personal Tax' } })
    ).id;
    ids.books = (
      await tx.service.create({ data: { businessId, kind: 'BOOKKEEPING', name: 'Bookkeeping' } })
    ).id;
    const open = await tx.engagement.create({
      data: { businessId, clientId: ids.w1, serviceId: ids.personal, title: 'Fake 2025 return' },
    });
    await tx.engagement.create({
      data: {
        businessId,
        clientId: ids.w4,
        serviceId: ids.books,
        title: 'Fake bookkeeping',
        status: 'COMPLETED',
      },
    });
    for (const status of ['REQUESTED', 'REJECTED', 'ACCEPTED'] as const) {
      await tx.documentRequest.create({
        data: {
          businessId,
          clientId: ids.w1,
          engagementId: open.id,
          title: `Fake ${status}`,
          status,
        },
      });
    }
    await invoice(tx, businessId, ids.w1, 50_000, 20_000, people.ownerA.id);
    const visit = (startsAt: Date, status: 'SCHEDULED' | 'CANCELLED' = 'SCHEDULED') =>
      tx.appointment.create({
        data: {
          businessId,
          clientId: ids.w1,
          staffUserId: people.ownerA.id,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3_600_000),
          locationKind: 'PHONE',
          status,
        },
      });
    await visit(ago(5));
    await visit(new Date(Date.now() + 2 * DAY), 'CANCELLED');
    await visit(new Date(Date.now() + 4 * DAY));
  });

  // Firm B: one client with an open Personal Tax engagement and a balance.
  await inFirm('b', async (tx) => {
    const businessId = firms.b.id;
    ids.b1 = (
      await tx.client.create({
        data: { businessId, displayName: 'Work B (fake)', status: 'ACTIVE' },
      })
    ).id;
    const svc = await tx.service.create({
      data: { businessId, kind: 'ANNUAL_TAX', name: 'Personal Tax' },
    });
    await tx.engagement.create({
      data: { businessId, clientId: ids.b1, serviceId: svc.id, title: 'Fake B return' },
    });
    await invoice(tx, businessId, ids.b1, 70_000, 0, people.ownerB.id);
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
  await db.$disconnect();
});

describe('GET /business/clients: the work around each client', () => {
  it('sends the stage, open services, missing documents, balance, last activity and next appointment', async () => {
    const page = await list('?limit=100');
    const w1 = page.items.find((r) => r.id === ids.w1);
    expect(w1).toMatchObject({
      status: 'ACTIVE',
      services: [{ id: ids.personal, name: 'Personal Tax', kind: 'ANNUAL_TAX' }],
      missingDocuments: 2,
      balanceDueCents: 30_000,
    });
    expect(w1?.lastActivityAt).not.toBeNull();
    // The next SCHEDULED visit, not the canceled one before it or the past one.
    expect(Date.parse(w1!.nextAppointmentAt!)).toBeGreaterThan(Date.now() + 3 * DAY);
    const w4 = page.items.find((r) => r.id === ids.w4);
    expect(w4).toMatchObject({
      status: 'PENDING_DOCUMENTS',
      services: [],
      missingDocuments: 0,
      balanceDueCents: 0,
      nextAppointmentAt: null,
    });
    // Firm B's client never appears; the total counts firm A's live clients.
    expect(page.items.map((r) => r.id)).not.toContain(ids.b1);
    expect(page.total).toBe(4);
  });

  it('filters by stage, service and last-activity days, and pages by number with the total', async () => {
    expect((await list('?clientStatus=NEW')).items.map((r) => r.id)).toEqual([ids.w2]);
    expect((await list(`?serviceId=${ids.personal}`)).items.map((r) => r.id)).toEqual([ids.w1]);
    const recent = await list(`?lastActivityFrom=${nyDay(-10)}&lastActivityTo=${nyDay(0)}`);
    expect(recent.items.map((r) => r.id)).toEqual([ids.w1]);
    // Firm B's service id names nothing in firm A: no rows, not an error.
    const svcB = await inFirm('b', (tx) => tx.service.findFirstOrThrow({ select: { id: true } }));
    expect((await list(`?serviceId=${svcB.id}`)).items).toEqual([]);
    const first = await list('?page=1&limit=3');
    const second = await list('?page=2&limit=3');
    expect(first.items).toHaveLength(3);
    expect(second.items).toHaveLength(1);
    expect([first.total, second.total, first.nextCursor]).toEqual([4, 4, null]);
    const both = await call('get', '?page=1&cursor=abc', people.ownerA);
    expect([both.status, codeOf(both.body)]).toEqual([400, 'VALIDATION_FAILED']);
  });

  it('gives Staff only their own clients, with the same work fields', async () => {
    const page = await list('', people.staffA);
    expect(page.items.map((r) => r.id)).toEqual([ids.w1]);
    expect(page.total).toBe(1);
  });
});

describe('GET /business/clients/summary', () => {
  it("counts the firm's cards and tabs; archived clients are in none of them", async () => {
    const s = await summary(people.ownerA);
    expect(s.kpis).toEqual({
      totalClients: { value: 4, previous: 0 },
      newClients: { value: 5, previous: 0 },
      activeClients: { value: 1, previous: null },
      pendingDocuments: { value: 1, previous: null },
      balancesDue: { value: 1, previous: null },
      inactiveClients: { value: 1, previous: null },
    });
    expect(s.counts).toMatchObject({ all: 4, active: 1, new: 1, inactive: 1 });
    expect(s.counts.byService).toEqual([
      { id: ids.books, name: 'Bookkeeping', kind: 'BOOKKEEPING', count: 0 },
      { id: ids.personal, name: 'Personal Tax', kind: 'ANNUAL_TAX', count: 1 },
    ]);
  });

  it('gives Staff their own counts, keeps each firm to its own and refuses a client', async () => {
    const staff = await summary(people.staffA);
    expect(staff.kpis.totalClients.value).toBe(1);
    expect(staff.counts.byService.find((x) => x.id === ids.personal)?.count).toBe(1);
    const b = await summary(people.ownerB, 'b');
    expect(b.kpis.totalClients.value).toBe(1);
    expect(b.kpis.balancesDue.value).toBe(1);
    expect(b.counts.byService.map((x) => x.id)).not.toContain(ids.personal);
    expect((await call('get', '/summary', people.ownerB, 'a')).status).toBe(404);
    expect((await call('get', '/summary', people.clientA, 'a', undefined, 'CLIENT')).status).toBe(
      403,
    );
  });
});

describe('POST /business/clients/bulk', () => {
  const bulk = (who: Person, body: object, firm: 'a' | 'b' = 'a') =>
    call('post', '/bulk', who, firm, body);

  it('assigns several clients, each audited on its own; an archived one is skipped', async () => {
    const res = await bulk(people.adminA, {
      action: 'ASSIGN',
      clientIds: [ids.w2, ids.w4, ids.w3],
      assignedUserId: people.staffA.id,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(BulkClientsResponse.parse(res.body)).toEqual({
      updated: 2,
      skipped: [{ clientId: ids.w3, code: 'CLIENT_ARCHIVED' }],
    });
    const after = await inFirm('a', async (tx) => ({
      assigned: await tx.client.findMany({
        where: { id: { in: [ids.w2, ids.w4, ids.w3] } },
        select: { id: true, assignedUserId: true },
      }),
      audit: await tx.auditLog.findMany({
        where: {
          businessId: firms.a.id,
          action: 'client.updated',
          entityId: { in: [ids.w2, ids.w4] },
        },
      }),
      bulk: await tx.auditLog.findFirst({
        where: { businessId: firms.a.id, action: 'clients.bulk_changed' },
      }),
    }));
    const byId = Object.fromEntries(after.assigned.map((c) => [c.id, c.assignedUserId]));
    expect([byId[ids.w2], byId[ids.w4], byId[ids.w3]]).toEqual([
      people.staffA.id,
      people.staffA.id,
      null,
    ]);
    expect(after.audit).toHaveLength(2);
    expect(after.bulk?.metadata).toEqual({ action: 'ASSIGN', updated: 2, skipped: 1 });
  });

  it('archives and restores several clients', async () => {
    const archive = await bulk(people.ownerA, { action: 'ARCHIVE', clientIds: [ids.w2, ids.w4] });
    expect(BulkClientsResponse.parse(archive.body)).toEqual({ updated: 2, skipped: [] });
    const restore = await bulk(people.ownerA, { action: 'RESTORE', clientIds: [ids.w2, ids.w4] });
    expect(BulkClientsResponse.parse(restore.body)).toEqual({ updated: 2, skipped: [] });
    const rows = await inFirm('a', (tx) =>
      tx.client.findMany({
        where: { id: { in: [ids.w2, ids.w4] } },
        select: { archivedAt: true },
      }),
    );
    expect(rows.every((r) => r.archivedAt === null)).toBe(true);
  });

  it("refuses another firm's client or member as a whole (404) and changes nothing", async () => {
    const before = await inFirm('a', (tx) =>
      tx.client.findUniqueOrThrow({ where: { id: ids.w2 }, select: { archivedAt: true } }),
    );
    const mixed = await bulk(people.ownerA, { action: 'ARCHIVE', clientIds: [ids.w2, ids.b1] });
    expect([mixed.status, codeOf(mixed.body)]).toEqual([404, 'NOT_FOUND']);
    const member = await bulk(people.ownerA, {
      action: 'ASSIGN',
      clientIds: [ids.w2],
      assignedUserId: people.ownerB.id,
    });
    expect([member.status, codeOf(member.body)]).toEqual([404, 'NOT_FOUND']);
    const after = await inFirm('a', (tx) =>
      tx.client.findUniqueOrThrow({ where: { id: ids.w2 }, select: { archivedAt: true } }),
    );
    expect(after.archivedAt).toEqual(before.archivedAt);
    const bClient = await inFirm('b', (tx) =>
      tx.client.findUniqueOrThrow({ where: { id: ids.b1 }, select: { archivedAt: true } }),
    );
    expect(bClient.archivedAt).toBeNull();
  });

  it('is Owner and Admin only, and refuses bad input before anything changes', async () => {
    expect((await bulk(people.staffA, { action: 'ARCHIVE', clientIds: [ids.w1] })).status).toBe(
      403,
    );
    const empty = await bulk(people.ownerA, { action: 'ARCHIVE', clientIds: [] });
    expect([empty.status, codeOf(empty.body)]).toEqual([400, 'VALIDATION_FAILED']);
    const tooMany = await bulk(people.ownerA, {
      action: 'ARCHIVE',
      clientIds: Array.from({ length: 101 }, () => randomUUID()),
    });
    expect(tooMany.status).toBe(400);
    const leaked = await bulk(people.ownerA, {
      action: 'ARCHIVE',
      clientIds: [ids.w2],
      businessId: firms.b.id,
    });
    expect(leaked.status).toBe(400);
  });
});
