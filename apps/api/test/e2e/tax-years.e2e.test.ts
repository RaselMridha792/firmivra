// End-to-end: R10 step 5, a client's tax status per year (contract in packages/types/src/clients).
// The firm sets a year's status (its own statuses, T04) and the note the client sees; the
// database writes the history. Staff reach only their own clients; another firm gets 404; the
// client reads only their own years in the portal. Reads and changes are audited without the note.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { z } from 'zod';
import { ClientTaxYear as YearShape, MyTaxYearList as MineShape } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { taxYearLockKey } from '../../src/clients/tax-years.service.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

// Strict copies of the contract's shapes, so a leaked field (businessId, clientId) fails.
const Year = z.strictObject(YearShape.shape);
const Years = z.strictObject({ items: z.array(Year) });
const HistoryItem = z.strictObject({
  status: z.strictObject({ id: z.uuid(), name: z.string() }),
  clientNote: z.string().nullable(),
  changedBy: z.strictObject({ userId: z.uuid(), name: z.string() }).nullable(),
  changedAt: z.iso.datetime({ offset: true }),
});
const History = z.strictObject({ items: z.array(HistoryItem) });
const Mine = z.strictObject({
  items: z.array(z.strictObject(MineShape.shape.items.element.shape)),
});

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r10y-${key}-${run}@r10.test` });
const people = {
  ownerA: person('owner-a'),
  staffA: person('staff-a'),
  staffA2: person('staff-a2'),
  clientA: person('client-a'),
  otherClientA: person('other-client-a'),
  ownerB: person('owner-b'),
};
const ids = {
  firmA: '',
  firmB: '',
  slugA: `r10y-a-${run}`,
  client1: '',
  client2: '',
  archivedClient: '',
  client3: '',
  clientB: '',
  preparing: '',
  filed: '',
  oldStatus: '',
  laterArchived: '',
  soonGone: '',
  statusB: '',
};

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

async function firm(
  method: 'get' | 'put',
  path: string,
  who: { email: string },
  businessId = ids.firmA,
  body?: object,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business/clients${path}`)
    .set('x-business-id', businessId)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}

const portal = async (who: { email: string }, slug = ids.slugA) =>
  request(app.getHttpServer())
    .get(`/api/v1/portal/${slug}/me/tax-years`)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const setYear = async (clientId: string, year: number, body: object, who = people.ownerA) => {
  const res = await firm('put', `/${clientId}/tax-years/${year}`, who, ids.firmA, body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return Year.parse(res.body);
};

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      const pool = key.toLowerCase().includes('client') ? 'CLIENT' : 'STAFF';
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool, email: p.email, name: `Fake R10y ${key}` },
      });
    }
    ids.firmA = (
      await tx.business.create({ data: { slug: ids.slugA, name: 'A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: `r10y-b-${run}`, name: 'B', status: 'ACTIVE' } })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const A = { businessId: ids.firmA };
    for (const [userId, role] of [
      [people.ownerA.id, 'OWNER'],
      [people.staffA.id, 'STAFF'],
      [people.staffA2.id, 'STAFF'],
    ] as const) {
      await tx.membership.create({ data: { ...A, userId, role, status: 'ACTIVE' } });
    }
    ids.client1 = (
      await tx.client.create({
        data: { ...A, displayName: 'One', assignedUserId: people.staffA.id },
      })
    ).id;
    ids.client2 = (
      await tx.client.create({
        data: { ...A, displayName: 'Two', assignedUserId: people.staffA2.id },
      })
    ).id;
    ids.archivedClient = (
      await tx.client.create({ data: { ...A, displayName: 'Old', archivedAt: new Date() } })
    ).id;
    for (const [userId, clientId, email] of [
      [people.clientA.id, ids.client1, people.clientA.email],
      [people.otherClientA.id, ids.client2, people.otherClientA.email],
    ] as const) {
      await tx.clientAccount.create({ data: { ...A, userId, clientId, email, status: 'ACTIVE' } });
    }
    const status = (name: string, archivedAt?: Date) =>
      tx.taxStatus.create({ data: { ...A, name, archivedAt } });
    ids.preparing = (await status('In preparation')).id;
    ids.filed = (await status('Filed')).id;
    ids.oldStatus = (await status('Old status', new Date())).id;
    ids.laterArchived = (await status('Later archived')).id;
    ids.soonGone = (await status('Soon gone')).id;
    ids.client3 = (await tx.client.create({ data: { ...A, displayName: 'Three' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmB, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.clientB = (
      await tx.client.create({ data: { businessId: ids.firmB, displayName: 'B' } })
    ).id;
    ids.statusB = (
      await tx.taxStatus.create({ data: { businessId: ids.firmB, name: 'Filed' } })
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

describe('firm: tax status per year', () => {
  it('sets a year, keeps the note when left out, clears it with "", lists newest first', async () => {
    const first = await setYear(ids.client1, 2024, {
      taxStatusId: ids.filed,
      clientNote: 'Filed on time.',
    });
    expect(first).toMatchObject({
      taxYear: 2024,
      status: { id: ids.filed, name: 'Filed' },
      clientNote: 'Filed on time.',
      updatedBy: { userId: people.ownerA.id, name: 'Fake R10y ownerA' },
    });
    await setYear(ids.client1, 2025, { taxStatusId: ids.preparing, clientNote: 'Working on it.' });
    const kept = await setYear(ids.client1, 2025, { taxStatusId: ids.filed });
    expect(kept.clientNote).toBe('Working on it.');
    const cleared = await setYear(ids.client1, 2025, { taxStatusId: ids.filed, clientNote: '' });
    expect(cleared.clientNote).toBeNull();

    const list = Years.parse((await firm('get', `/${ids.client1}/tax-years`, people.ownerA)).body);
    expect(list.items.map((y) => y.taxYear)).toEqual([2025, 2024]);
  });

  it('history lists every change of status or note, newest first, by whom', async () => {
    await setYear(ids.client1, 2023, { taxStatusId: ids.preparing });
    await setYear(
      ids.client1,
      2023,
      { taxStatusId: ids.filed, clientNote: 'Done.' },
      people.staffA,
    );
    const res = await firm('get', `/${ids.client1}/tax-years/2023/history`, people.ownerA);
    const items = History.parse(res.body).items;
    expect(items.map((h) => [h.status.name, h.clientNote, h.changedBy?.userId])).toEqual([
      ['Filed', 'Done.', people.staffA.id],
      ['In preparation', null, people.ownerA.id],
    ]);
  });

  it('archived statuses: never newly assigned (409), but a year keeps one it already has', async () => {
    const res = await firm('put', `/${ids.client1}/tax-years/2022`, people.ownerA, ids.firmA, {
      taxStatusId: ids.oldStatus,
    });
    expect([res.status, codeOf(res)]).toEqual([409, 'TAX_STATUS_ARCHIVED']);

    await setYear(ids.client1, 2020, { taxStatusId: ids.laterArchived });
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    await runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
      tx.taxStatus.update({ where: { id: ids.laterArchived }, data: { archivedAt: new Date() } }),
    );
    await owner.$disconnect();
    const kept = await setYear(ids.client1, 2020, {
      taxStatusId: ids.laterArchived,
      clientNote: 'Still this status.',
    });
    expect(kept).toMatchObject({
      status: { id: ids.laterArchived, name: 'Later archived' },
      clientNote: 'Still this status.',
    });
  });

  it("refuses an archived client (409), another firm's status or client (404), bad input (400)", async () => {
    const archived = await firm(
      'put',
      `/${ids.archivedClient}/tax-years/2025`,
      people.ownerA,
      ids.firmA,
      {
        taxStatusId: ids.filed,
      },
    );
    expect([archived.status, codeOf(archived)]).toEqual([409, 'CLIENT_ARCHIVED']);
    const otherStatus = await firm(
      'put',
      `/${ids.client1}/tax-years/2025`,
      people.ownerA,
      ids.firmA,
      {
        taxStatusId: ids.statusB,
      },
    );
    expect([otherStatus.status, codeOf(otherStatus)]).toEqual([404, 'NOT_FOUND']);
    for (const [method, path] of [
      ['get', `/${ids.client1}/tax-years`],
      ['put', `/${ids.client1}/tax-years/2025`],
      ['get', `/${ids.client1}/tax-years/2025/history`],
    ] as const) {
      const res = await firm(method, path, people.ownerB, ids.firmB, { taxStatusId: ids.statusB });
      expect([res.status, codeOf(res)]).toEqual([404, 'NOT_FOUND']);
    }
    for (const [path, body] of [
      [`/${ids.client1}/tax-years/1999`, { taxStatusId: ids.filed }],
      [`/${ids.client1}/tax-years/2025`, { taxStatusId: ids.filed, businessId: ids.firmB }],
      [`/${ids.client1}/tax-years/2025`, { taxStatusId: 'nope' }],
    ] as const) {
      const res = await firm('put', path, people.ownerA, ids.firmA, body);
      expect([res.status, codeOf(res)]).toEqual([400, 'VALIDATION_FAILED']);
    }
  });

  it("Staff reach only their own clients' years", async () => {
    expect((await firm('get', `/${ids.client1}/tax-years`, people.staffA)).status).toBe(200);
    for (const [method, path] of [
      ['get', `/${ids.client2}/tax-years`],
      ['put', `/${ids.client2}/tax-years/2025`],
      ['get', `/${ids.client2}/tax-years/2025/history`],
    ] as const) {
      const res = await firm(method, path, people.staffA, ids.firmA, { taxStatusId: ids.filed });
      expect([res.status, codeOf(res)]).toEqual([404, 'NOT_FOUND']);
    }
  });
});

describe('portal: the client reads only their own years', () => {
  it("shows the status name and the firm's note; another client's login sees theirs only", async () => {
    await setYear(ids.client2, 2025, { taxStatusId: ids.preparing, clientNote: 'For client two.' });
    const mine = Mine.parse((await portal(people.clientA)).body).items;
    expect(mine.map((y) => y.taxYear)).toEqual([2025, 2024, 2023, 2020]);
    expect(mine[0]).toMatchObject({ status: 'Filed', clientNote: null });
    const theirs = Mine.parse((await portal(people.otherClientA)).body).items;
    expect(theirs).toEqual([
      expect.objectContaining({
        taxYear: 2025,
        status: 'In preparation',
        clientNote: 'For client two.',
      }),
    ]);
  });

  it('staff and other firms are refused; a client is not firm staff', async () => {
    // Portal routes take only the clients pool (AuthGuard, #62): a staff token is not a session there.
    expect((await portal(people.ownerA)).status).toBe(401);
    expect((await portal(people.clientA, `r10y-b-${run}`)).status).toBe(404);
    expect((await firm('get', `/${ids.client1}/tax-years`, people.clientA)).status).toBe(403);
  });
});

describe('audit', () => {
  it('logs reads and changes with the year and what changed, never the note', async () => {
    await setYear(ids.client1, 2021, { taxStatusId: ids.filed, clientNote: 'Secret-ish note' });
    await firm('get', `/${ids.client1}/tax-years/2021/history`, people.ownerA);
    await portal(people.clientA);
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    const rows = await runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
      tx.auditLog.findMany({ where: { businessId: ids.firmA, entityId: ids.client1 } }),
    );
    await owner.$disconnect();
    const actions = new Set(rows.map((r) => r.action));
    for (const action of [
      'client.tax_year_set',
      'client.tax_years_viewed',
      'client.tax_year_history_viewed',
      'portal.tax_years_viewed',
    ]) {
      expect(actions.has(action)).toBe(true);
    }
    expect(JSON.stringify(rows.map((r) => r.metadata))).not.toContain('Secret-ish');
    expect(
      rows.find(
        (r) =>
          r.action === 'client.tax_year_set' &&
          (r.metadata as { taxYear?: number }).taxYear === 2021,
      )?.metadata,
    ).toEqual({ taxYear: 2021, statusChanged: true, noteChanged: true });
  });
});

/**
 * Runs `change` in a firm A transaction and keeps it open, with the locks it took, until
 * released: a change at the same time as a PUT, committed while the PUT waits on it.
 */
async function holdChange(change: (tx: TxClient) => Promise<unknown>) {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  let letGo!: () => void;
  const released = new Promise<void>((resolve) => (letGo = resolve));
  let held!: (pid: number) => void;
  const pid = new Promise<number>((resolve) => (held = resolve));
  const holder = runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    await change(tx);
    const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    held(row!.pid);
    await released;
  });
  const holderPid = await pid;
  return {
    /** Resolves once another session waits on the holding transaction. */
    async waitedOn() {
      for (let i = 0; i < 500; i++) {
        const [row] = await owner.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE ${holderPid}::int = ANY (pg_blocking_pids(pid))`;
        if (row!.n > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('nothing waited on the held change');
    },
    async release() {
      letGo();
      await holder;
      await owner.$disconnect();
    },
  };
}

/**
 * Holds what a change of this year waits for: the service's lock and the year's row (fea6692's
 * PUT waited on the row after its reads). `during` runs in the holding transaction.
 */
function holdYear(clientId: string, taxYear: number, during?: (tx: TxClient) => Promise<unknown>) {
  return holdChange(async (tx) => {
    const key = taxYearLockKey(ids.firmA, clientId, taxYear);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    await tx.$executeRaw`
      SELECT 1 FROM client_tax_statuses
      WHERE business_id = ${ids.firmA}::uuid AND client_id = ${clientId}::uuid AND tax_year = ${taxYear}
      FOR UPDATE`;
    await during?.(tx);
  });
}

async function inFirmA<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  try {
    return await runInScope(owner, { kind: 'business', businessId: ids.firmA }, fn);
  } finally {
    await owner.$disconnect();
  }
}

describe('changes at the same time', () => {
  it('a status archived while a change waits: 409 TAX_STATUS_ARCHIVED, not 500', async () => {
    await setYear(ids.client1, 2019, { taxStatusId: ids.filed });
    const hold = await holdYear(ids.client1, 2019);
    const put = firm('put', `/${ids.client1}/tax-years/2019`, people.ownerA, ids.firmA, {
      taxStatusId: ids.soonGone,
    });
    await hold.waitedOn();
    await inFirmA((tx) =>
      tx.taxStatus.update({ where: { id: ids.soonGone }, data: { archivedAt: new Date() } }),
    );
    await hold.release();
    const res = await put;
    expect([res.status, codeOf(res)]).toEqual([409, 'TAX_STATUS_ARCHIVED']);
  });

  it('a status-only change keeps a note changed while it waited', async () => {
    await setYear(ids.client1, 2018, { taxStatusId: ids.preparing, clientNote: 'Old note.' });
    const hold = await holdYear(ids.client1, 2018, (tx) =>
      tx.clientTaxStatus.update({
        where: {
          businessId_clientId_taxYear: {
            businessId: ids.firmA,
            clientId: ids.client1,
            taxYear: 2018,
          },
        },
        data: { clientNote: 'New note.', updatedByUserId: people.ownerA.id },
      }),
    );
    const put = firm('put', `/${ids.client1}/tax-years/2018`, people.ownerA, ids.firmA, {
      taxStatusId: ids.filed,
    });
    await hold.waitedOn();
    await hold.release();
    const res = await put;
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(Year.parse(res.body)).toMatchObject({
      status: { id: ids.filed },
      clientNote: 'New note.',
    });
    const list = Years.parse((await firm('get', `/${ids.client1}/tax-years`, people.ownerA)).body);
    expect(list.items.find((y) => y.taxYear === 2018)?.clientNote).toBe('New note.');
  });

  it('a client archived while a change waits: 409 CLIENT_ARCHIVED, nothing written', async () => {
    await setYear(ids.client3, 2025, { taxStatusId: ids.filed });
    const hold = await holdYear(ids.client3, 2025);
    const put = firm('put', `/${ids.client3}/tax-years/2025`, people.ownerA, ids.firmA, {
      taxStatusId: ids.preparing,
    });
    await hold.waitedOn();
    await inFirmA((tx) =>
      tx.client.update({ where: { id: ids.client3 }, data: { archivedAt: new Date() } }),
    );
    await hold.release();
    const res = await put;
    expect([res.status, codeOf(res)]).toEqual([409, 'CLIENT_ARCHIVED']);
    const row = await inFirmA((tx) =>
      tx.clientTaxStatus.findFirst({ where: { clientId: ids.client3, taxYear: 2025 } }),
    );
    expect(row?.taxStatusId).toBe(ids.filed);
  });

  it('a Staff change that waited on a reassignment away is 404, nothing written', async () => {
    const { id } = await inFirmA((tx) =>
      tx.client.create({
        data: {
          businessId: ids.firmA,
          displayName: 'Reassigned',
          assignedUserId: people.staffA.id,
        },
        select: { id: true },
      }),
    );
    // Not yet committed when staffA's PUT reads the client, so only the locked read sees it.
    const reassigning = await holdChange((tx) =>
      tx.client.update({ where: { id }, data: { assignedUserId: people.staffA2.id } }),
    );
    const put = firm('put', `/${id}/tax-years/2025`, people.staffA, ids.firmA, {
      taxStatusId: ids.filed,
    });
    await reassigning.waitedOn();
    await reassigning.release();
    const res = await put;
    expect([res.status, codeOf(res)]).toEqual([404, 'NOT_FOUND']);
    const written = await inFirmA(async (tx) => [
      await tx.clientTaxStatus.count({ where: { clientId: id } }),
      await tx.clientTaxStatusHistory.count({ where: { clientId: id } }),
    ]);
    expect(written).toEqual([0, 0]);
  });

  it('a change that changes nothing writes nothing', async () => {
    const before = await setYear(ids.client1, 2017, {
      taxStatusId: ids.filed,
      clientNote: 'Same.',
    });
    const again = await setYear(
      ids.client1,
      2017,
      { taxStatusId: ids.filed, clientNote: 'Same.' },
      people.staffA,
    );
    expect(again).toEqual(before);
    const res = await firm('get', `/${ids.client1}/tax-years/2017/history`, people.ownerA);
    expect(History.parse(res.body).items).toHaveLength(1);
  });

  it('a year in the path is exactly four digits', async () => {
    for (const year of ['02026', '2026.0', '0x7EA', '2.026e3']) {
      const res = await firm('put', `/${ids.client1}/tax-years/${year}`, people.ownerA, ids.firmA, {
        taxStatusId: ids.filed,
      });
      expect([year, res.status, codeOf(res)]).toEqual([year, 400, 'VALIDATION_FAILED']);
    }
  });
});
