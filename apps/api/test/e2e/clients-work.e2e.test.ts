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
import {
  BulkClientsResponse,
  ClientExportLink,
  ClientsSummary,
  ListClientsResponse,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { TokenService } from '../../src/auth/token.service.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { REPORT_FILES, type ReportFiles } from '../../src/reports/report-files.js';

/** The reports file store in memory (the export's CSV). */
class MemoryFiles implements ReportFiles {
  readonly objects = new Map<string, Buffer>();
  put(key: string, bytes: Uint8Array) {
    this.objects.set(key, Buffer.from(bytes));
    return Promise.resolve();
  }
  presignDownload(input: { key: string }) {
    return Promise.resolve(`memory:${input.key}`);
  }
  remove(key: string) {
    this.objects.delete(key);
    return Promise.resolve();
  }
}
const files = new MemoryFiles();

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
const nyDay = (offset: number) => {
  // Calendar days from today in New York, not 24-hour steps (a daylight-saving change between
  // would land on the wrong day).
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
    new Date(),
  );
  const d = new Date(`${today}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
/** 16:00 UTC on that New York day: 11:00 or 12:00 there, so never on another calendar day. */
const onDay = (offset: number) => new Date(`${nyDay(offset)}T16:00:00.000Z`);

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

const ids = {} as Record<
  'w1' | 'w2' | 'w3' | 'w4' | 'w5' | 'b1' | 'personal' | 'books' | 'tag',
  string
>;

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
    // w1's own portal login: a client of this firm, refused on the firm's routes (403).
    await tx.clientAccount.create({
      data: {
        businessId,
        userId: people.clientA.id,
        email: people.clientA.email,
        clientId: ids.w1,
        status: 'ACTIVE',
      },
    });
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
        completedAt: new Date(),
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
          statusNote: status === 'REJECTED' ? 'Fake: the page is unreadable' : null,
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
          cancelledAt: status === 'CANCELLED' ? new Date() : null,
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
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(REPORT_FILES)
    .useValue(files)
    .compile();
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
    // The owner client sees every firm's rows, so the firm is named (row order is not).
    const svcB = await inFirm('b', (tx) =>
      tx.service.findFirstOrThrow({ where: { businessId: firms.b.id }, select: { id: true } }),
    );
    expect((await list(`?serviceId=${svcB.id}`)).items).toEqual([]);
    const first = await list('?page=1&limit=3');
    const second = await list('?page=2&limit=3');
    expect(first.items).toHaveLength(3);
    expect(second.items).toHaveLength(1);
    expect([first.total, second.total, first.nextCursor]).toEqual([4, 4, null]);
    const both = await call('get', '?page=1&cursor=abc', people.ownerA);
    expect([both.status, codeOf(both.body)]).toEqual([400, 'VALIDATION_FAILED']);
  });

  it('filters to the clients the Pending Documents and Balances Due cards count (E1)', async () => {
    // A settled invoice owes nothing: w2's is paid in full.
    await inFirm('a', async (tx) => {
      const { id } = await tx.invoice.create({
        data: { businessId: firms.a.id, clientId: ids.w2, number: `INV-${randomUUID()}` },
      });
      await tx.invoiceLine.create({
        data: {
          businessId: firms.a.id,
          invoiceId: id,
          description: 'Fake',
          unitAmountCents: 9_000,
        },
      });
      await tx.invoice.update({ where: { id }, data: { status: 'OPEN', issuedAt: new Date() } });
      await tx.offlinePayment.create({
        data: {
          businessId: firms.a.id,
          invoiceId: id,
          recordedByUserId: people.ownerA.id,
          method: 'CASH',
          amountCents: 9_000,
          receivedOn: new Date(`${nyDay(0)}T00:00:00.000Z`),
          idempotencyKey: randomUUID(),
        },
      });
    });
    const s = await summary(people.ownerA);
    const docs = await list('?owes=DOCUMENTS');
    const owed = await list('?owes=BALANCE');
    expect(docs.items.map((r) => r.id)).toEqual([ids.w1]);
    expect(owed.items.map((r) => r.id)).toEqual([ids.w1]);
    // Each card's number is its list's total.
    expect([docs.total, owed.total]).toEqual([
      s.kpis.pendingDocuments.value,
      s.kpis.balancesDue.value,
    ]);
    // Staff see only their own; firm B's owing clients never appear in firm A.
    expect((await list('?owes=BALANCE', people.staffA)).items.map((r) => r.id)).toEqual([ids.w1]);
    expect((await list('?owes=DOCUMENTS&clientStatus=NEW')).items).toEqual([]);
    const bad = await call('get', '?owes=OVERDUE', people.ownerA);
    expect([bad.status, codeOf(bad.body)]).toEqual([400, 'VALIDATION_FAILED']);
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

describe('services from advisory enrollment (E3)', () => {
  it('counts an enrolled advisory workstream as the service, in the row, the filter and the tab', async () => {
    const svc = await inFirm('a', async (tx) => {
      const service = await tx.service.create({
        data: { businessId: firms.a.id, kind: 'BUSINESS_DEVELOPMENT', name: 'Growth Advisory' },
      });
      // w5 is enrolled (no engagement: the advisory module keeps it as a workstream); w2 only
      // showed interest, which is not an enrolment.
      for (const [clientId, status] of [
        [ids.w5, 'ACCEPTED'],
        [ids.w2, 'PROPOSED'],
      ] as const) {
        const advisory = await tx.advisoryClient.create({
          data: { businessId: firms.a.id, clientId },
        });
        await tx.advisoryWorkstream.create({
          data: {
            businessId: firms.a.id,
            advisoryClientId: advisory.id,
            serviceId: service.id,
            status,
          },
        });
      }
      return service.id;
    });
    const filtered = await list(`?serviceId=${svc}`);
    expect(filtered.items.map((r) => r.id)).toEqual([ids.w5]);
    expect(filtered.items[0]?.services.map((s) => s.name)).toContain('Growth Advisory');
    const s = await summary(people.ownerA);
    expect(s.counts.byService.find((b) => b.id === svc)).toMatchObject({ count: 1 });
    // Firm B's tabs never see firm A's enrolments.
    const b = await summary(people.ownerB, 'b');
    expect(b.counts.byService.some((x) => x.id === svc)).toBe(false);
  });
});

describe("E2: a client's Last Activity is its latest event", () => {
  const e = {} as Record<'msg' | 'doc' | 'task' | 'note' | 'held' | 'both' | 'none', string>;

  beforeAll(async () => {
    await inFirm('a', async (tx) => {
      const businessId = firms.a.id;
      const owner = people.ownerA.id;
      for (const key of Object.keys({
        msg: 1,
        doc: 1,
        task: 1,
        note: 1,
        held: 1,
        both: 1,
        none: 1,
      })) {
        e[key as keyof typeof e] = (
          await tx.client.create({ data: { businessId, displayName: `Activity ${key} (fake)` } })
        ).id;
      }
      const message = async (clientId: string, at: Date) => {
        const thread = await tx.messageThread.create({
          data: { businessId, clientId, subject: 'Fake thread' },
        });
        await tx.message.create({
          data: {
            businessId,
            threadId: thread.id,
            senderUserId: owner,
            direction: 'FIRM_TO_CLIENT',
            body: 'Fake message',
            createdAt: at,
          },
        });
      };
      const note = (clientId: string, at: Date) =>
        tx.note.create({
          data: { businessId, clientId, body: 'Fake note', authorUserId: owner, createdAt: at },
        });
      await message(e.msg, onDay(-3));
      const engagement = await tx.engagement.create({
        data: { businessId, clientId: e.doc, serviceId: ids.personal, title: 'Fake activity' },
      });
      const tag = randomUUID();
      await tx.document.create({
        data: {
          businessId,
          clientId: e.doc,
          engagementId: engagement.id,
          direction: 'CLIENT_TO_FIRM',
          fileName: 'fake.pdf',
          contentType: 'application/pdf',
          sizeBytes: 100,
          sha256: tag.replace(/-/g, '').padEnd(64, '0'),
          s3Key: `tenant/${businessId}/e2e/${tag}.pdf`,
          createdAt: onDay(-4),
        },
      });
      await tx.task.create({
        data: {
          businessId,
          clientId: e.task,
          title: 'Fake done task',
          status: 'DONE',
          completedAt: onDay(-5),
        },
      });
      await note(e.note, onDay(-6));
      const visit = (
        clientId: string,
        startsAt: Date,
        status: 'COMPLETED' | 'SCHEDULED' | 'CANCELLED',
      ) =>
        tx.appointment.create({
          data: {
            businessId,
            clientId,
            staffUserId: owner,
            startsAt,
            endsAt: new Date(startsAt.getTime() + 3_600_000),
            locationKind: 'PHONE',
            status,
            cancelledAt: status === 'CANCELLED' ? new Date() : null,
          },
        });
      await visit(e.held, onDay(-7), 'COMPLETED');
      // The latest of several: a note 6 days ago, then a message 2 days ago.
      await note(e.both, onDay(-6));
      await message(e.both, onDay(-2));
      // None of these is activity: a canceled visit, one still to come, an open task, a draft.
      await visit(e.none, onDay(-1), 'CANCELLED');
      await visit(e.none, onDay(9), 'SCHEDULED');
      await tx.task.create({ data: { businessId, clientId: e.none, title: 'Fake open task' } });
      await tx.invoice.create({
        data: { businessId, clientId: e.none, number: `INV-${randomUUID()}` },
      });
    });
  });

  it('is each kind of event, the latest of several, and null for none', async () => {
    const rows = (await list('?limit=100')).items;
    const at = (id: string) => rows.find((r) => r.id === id)?.lastActivityAt;
    expect(at(e.msg)).toBe(onDay(-3).toISOString());
    expect(at(e.doc)).toBe(onDay(-4).toISOString());
    expect(at(e.task)).toBe(onDay(-5).toISOString());
    expect(at(e.note)).toBe(onDay(-6).toISOString());
    expect(at(e.held)).toBe(onDay(-7).toISOString());
    expect(at(e.both)).toBe(onDay(-2).toISOString());
    expect(at(e.none)).toBeNull();
  });

  it("filters on the firm's days, both ends included, by the latest event only", async () => {
    const mine = Object.values(e);
    const within = async (from: number, to: number) =>
      (await list(`?limit=100&lastActivityFrom=${nyDay(from)}&lastActivityTo=${nyDay(to)}`)).items
        .map((r) => r.id)
        .filter((id) => mine.includes(id))
        .sort();
    expect(await within(-5, -4)).toEqual([e.doc, e.task].sort());
    expect(await within(-4, -4)).toEqual([e.doc]);
    expect(await within(-3, -2)).toEqual([e.msg, e.both].sort());
    // Its note 6 days ago is not its latest event: the both-client is not in that day.
    expect(await within(-6, -6)).toEqual([e.note]);
    expect(await within(-30, 0)).toEqual(mine.filter((id) => id !== e.none).sort());
  });
});

describe('More Filters and Added Last 30 Days (E2 additions)', () => {
  const f = {} as Record<'a' | 'b' | 'c', string>;

  beforeAll(async () => {
    await inFirm('a', async (tx) => {
      const businessId = firms.a.id;
      const tag = await tx.tag.create({ data: { businessId, name: `Fake VIP ${run}` } });
      ids.tag = tag.id;
      f.a = (
        await tx.client.create({
          data: {
            businessId,
            displayName: 'Filter A (fake)',
            accountType: 'BUSINESS',
            priority: 'HIGH',
            source: 'REFERRAL',
          },
        })
      ).id;
      await tx.clientProfile.create({
        data: { businessId, clientId: f.a, state: 'TX', city: 'Fake Austin' },
      });
      await tx.clientTag.create({ data: { businessId, clientId: f.a, tagId: tag.id } });
      f.b = (
        await tx.client.create({
          data: { businessId, displayName: 'Filter B (fake)', createdAt: onDay(-60) },
        })
      ).id;
      await tx.clientProfile.create({
        data: { businessId, clientId: f.b, state: 'GA', county: 'Fake Fulton' },
      });
      f.c = (await tx.client.create({ data: { businessId, displayName: 'Filter C (fake)' } })).id;
      const deadline = (clientId: string, status: 'UPCOMING' | 'COMPLETED') =>
        tx.complianceDeadline.create({
          data: {
            businessId,
            clientId,
            name: 'Fake 941',
            type: 'TAX_FILING',
            dueOn: new Date(`${nyDay(5)}T00:00:00.000Z`),
            status,
            completedAt: status === 'COMPLETED' ? new Date() : null,
          },
        });
      await deadline(f.b, 'UPCOMING');
      await deadline(f.c, 'COMPLETED');
      const visit = (clientId: string, status: 'SCHEDULED' | 'CANCELLED') =>
        tx.appointment.create({
          data: {
            businessId,
            clientId,
            staffUserId: people.adminA.id,
            startsAt: onDay(3),
            endsAt: new Date(onDay(3).getTime() + 3_600_000),
            locationKind: 'PHONE',
            status,
            cancelledAt: status === 'CANCELLED' ? new Date() : null,
          },
        });
      await visit(f.b, 'SCHEDULED');
      await visit(f.c, 'CANCELLED');
    });
  });

  const mine = (items: { id: string }[]) =>
    items
      .map((r) => r.id)
      .filter((id) => Object.values(f).includes(id))
      .sort();
  const only = async (query: string) => mine((await list(`?limit=100&${query}`)).items);

  it('narrows by type, place, priority, source, tag and when the client was added', async () => {
    expect(await only('accountType=BUSINESS')).toEqual([f.a]);
    expect(await only('state=tx')).toEqual([f.a]);
    expect(await only('place=austin')).toEqual([f.a]);
    expect(await only('place=fulton')).toEqual([f.b]);
    expect(await only('priority=HIGH')).toEqual([f.a]);
    expect(await only('source=REFERRAL')).toEqual([f.a]);
    expect(await only(`tagId=${ids.tag}`)).toEqual([f.a]);
    // Added Last 30 Days: by the creation date, not the New stage.
    expect(await only(`addedFrom=${nyDay(-29)}`)).toEqual([f.a, f.c].sort());
  });

  it('narrows by an open deadline and a scheduled appointment on those days', async () => {
    expect(await only(`deadlineFrom=${nyDay(4)}&deadlineTo=${nyDay(6)}`)).toEqual([f.b]);
    expect(await only(`deadlineFrom=${nyDay(6)}`)).toEqual([]);
    expect(await only(`appointmentFrom=${nyDay(3)}&appointmentTo=${nyDay(3)}`)).toEqual([f.b]);
    expect(await only(`appointmentTo=${nyDay(2)}`)).toEqual([]);
  });

  it('narrows by a balance due or documents owed, or none', async () => {
    const has = async (query: string, id: string) =>
      (await list(`?limit=100&${query}`)).items.some((r) => r.id === id);
    expect([await has('balance=DUE', ids.w1), await has('balance=DUE', f.a)]).toEqual([
      true,
      false,
    ]);
    expect([await has('balance=NONE', ids.w1), await has('balance=NONE', f.a)]).toEqual([
      false,
      true,
    ]);
    expect([await has('documents=MISSING', ids.w1), await has('documents=MISSING', f.a)]).toEqual([
      true,
      false,
    ]);
    expect([await has('documents=NONE', ids.w1), await has('documents=NONE', f.a)]).toEqual([
      false,
      true,
    ]);
  });

  it('refuses a bad filter as 400', async () => {
    for (const query of [
      'state=Georgia',
      'balance=SOME',
      'priority=URGENT',
      'tagId=nope',
      `deadlineFrom=${nyDay(5)}&deadlineTo=${nyDay(1)}`,
    ]) {
      const res = await call('get', `?${query}`, people.ownerA);
      expect(res.status, query).toBe(400);
    }
  });
});

describe('POST /business/clients/export (E2 additions)', () => {
  it("exports the list's clients with minimal fields, for those with EXPORT, audited", async () => {
    const formula = await inFirm('a', (tx) =>
      tx.client.create({ data: { businessId: firms.a.id, displayName: '=Fake formula' } }),
    );
    const res = await call('post', '/export', people.ownerA, 'a', { search: 'Filter A' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const link = ClientExportLink.parse(res.body);
    expect(link.rowCount).toBe(1);
    expect(link.fileName).toMatch(/^clients-\d{4}-\d{2}-\d{2}\.csv$/);
    const key = link.url.replace(/^memory:/, '');
    expect(key.startsWith(`tenant/${firms.a.id}/reports/`)).toBe(true);
    const csv = files.objects.get(key)!.toString('utf8');
    const [head, row] = csv
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    expect(head).toBe(
      '"Client","Type","Email","Phone","Stage","Services","Assigned to","Missing documents","Balance due","Last activity","Next appointment","Added","Archived"',
    );
    expect(row).toContain('"Filter A (fake)","Business"');
    // A name a spreadsheet would read as a formula starts with a quote.
    const all = ClientExportLink.parse(
      (await call('post', '/export', people.ownerA, 'a', { search: 'Fake formula' })).body,
    );
    const text = files.objects.get(all.url.replace(/^memory:/, ''))!.toString('utf8');
    expect(text).toContain(`"'=Fake formula"`);
    expect(formula.id).toBeTruthy();
    // Staff's default grid has no Clients EXPORT; a client login none either.
    expect((await call('post', '/export', people.staffA, 'a', {})).status).toBe(403);
    // Bad filters are 400, before anything is written.
    expect((await call('post', '/export', people.ownerA, 'a', { state: 'Georgia' })).status).toBe(
      400,
    );
    const [audit] = await inFirm('a', (tx) =>
      tx.auditLog.findMany({
        where: { businessId: firms.a.id, action: 'clients.exported' },
        orderBy: { createdAt: 'asc' },
        select: { metadata: true },
      }),
    );
    expect(audit?.metadata).toEqual({ rows: 1, filters: ['search', 'status'] });
  });
});
