// End-to-end: R10 step 7, tax returns (contract in packages/types/src/tax-returns). The firm keeps
// one row per annual return or quarterly estimate, with the status the client sees, the filed date
// and the return PDF; the client reads their own in the portal, the PDF only once its scan is
// CLEAN and never an internal one. Staff reach only their own clients; another firm gets 404. A
// filed return never goes back to IN_PROGRESS, and one that was ever filed is never deleted.
// Reads and changes are audited with ids, counts and field names, never a value.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { z } from 'zod';
import { DocumentRef, MyTaxReturn as MineShape, TaxReturn as ReturnShape } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { refusalOf } from '../../src/tax-returns/tax-return-rules.js';

// Strict copies of the contract's shapes, so a leaked field (businessId, firstFiledAt, a client
// or engagement id in the portal, a document's scan state) fails the parse.
const Doc = z.strictObject(DocumentRef.shape);
const Return = z.strictObject({ ...ReturnShape.shape, document: Doc.nullable() });
const Returns = z.strictObject({ items: z.array(Return) });
const Mine = z.strictObject({
  items: z.array(z.strictObject({ ...MineShape.shape, document: Doc.nullable() })),
});
type Return = z.infer<typeof Return>;

const PDF = 'Fake Return.pdf';
const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r10r-${key}-${run}@r10.test` });
const people = {
  ownerA: person('owner-a'),
  staffA: person('staff-a'),
  staffA2: person('staff-a2'),
  clientA: person('client-a'),
  otherClientA: person('other-client-a'),
  unlinkedClientA: person('unlinked-client-a'),
  ownerB: person('owner-b'),
};
const ids = {
  firmA: '',
  firmB: '',
  slugA: `r10r-a-${run}`,
  slugB: `r10r-b-${run}`,
  /** Assigned to staffA; clientA's login. */
  one: '',
  /** Assigned to staffA2; otherClientA's login. */
  two: '',
  /** Archived while a change waits (races). */
  three: '',
  /** Archived, with a return that was never filed. */
  old: '',
  oldReturn: '',
  engOne: '',
  engTwo: '',
  docClean: '',
  docPending: '',
  docInfected: '',
  docFailed: '',
  docInternal: '',
  docTwo: '',
  clientB: '',
  engB: '',
  docB: '',
  returnB: '',
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

type Who = { email: string };

async function firm(
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  who: Who,
  body?: object,
  businessId = ids.firmA,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', businessId)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}

const list = (clientId: string, who: Who = people.ownerA, businessId = ids.firmA) =>
  firm('get', `/clients/${clientId}/tax-returns`, who, undefined, businessId);
const create = (clientId: string, body: object, who: Who = people.ownerA, businessId = ids.firmA) =>
  firm('post', `/clients/${clientId}/tax-returns`, who, body, businessId);
const patch = (id: string, body: object, who: Who = people.ownerA, businessId = ids.firmA) =>
  firm('patch', `/tax-returns/${id}`, who, body, businessId);
const remove = (id: string, who: Who = people.ownerA, businessId = ids.firmA) =>
  firm('delete', `/tax-returns/${id}`, who, {}, businessId);
const portal = async (who: Who, query = '', slug = ids.slugA) =>
  request(app.getHttpServer())
    .get(`/api/v1/portal/${slug}/me/tax-returns${query}`)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res;
};
const refused = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const made = async (clientId: string, body: object, who: Who = people.ownerA): Promise<Return> =>
  Return.parse(ok(await create(clientId, body, who), 201).body);
const changed = async (id: string, body: object, who: Who = people.ownerA): Promise<Return> =>
  Return.parse(ok(await patch(id, body, who)).body);
const firmList = async (clientId: string) => Returns.parse(ok(await list(clientId)).body).items;
const mine = async (who: Who, query = '') => Mine.parse(ok(await portal(who, query)).body).items;
/** A calendar day relative to today (UTC), as the API compares them. */
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  try {
    return await runInScope(owner, { kind: 'business', businessId }, fn);
  } finally {
    await owner.$disconnect();
  }
}

/** A document in the firm's vault, scanned when `scan` is given (it starts PENDING). */
async function addDocument(
  tx: TxClient,
  businessId: string,
  clientId: string,
  engagementId: string,
  direction: 'FIRM_TO_CLIENT' | 'INTERNAL',
  scan?: 'CLEAN' | 'INFECTED' | 'FAILED',
): Promise<string> {
  const { id } = await tx.document.create({
    data: {
      businessId,
      clientId,
      engagementId,
      direction,
      fileName: PDF,
      contentType: 'application/pdf',
      sizeBytes: 2048,
      sha256: 'a'.repeat(64),
      s3Key: `tenant/${businessId}/${randomUUID()}`,
    },
  });
  if (scan) {
    await tx.document.update({ where: { id }, data: { scanStatus: scan, scannedAt: new Date() } });
  }
  return id;
}

async function addEngagement(tx: TxClient, businessId: string, clientIds: string[]) {
  const service = await tx.service.create({
    data: { businessId, kind: 'ANNUAL_TAX', name: `Fake annual tax ${run}` },
  });
  const out: string[] = [];
  for (const clientId of clientIds) {
    const e = await tx.engagement.create({
      data: { businessId, clientId, serviceId: service.id, title: 'Fake 2024 Personal Tax' },
    });
    out.push(e.id);
  }
  return out;
}

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      const pool = key.toLowerCase().includes('client') ? 'CLIENT' : 'STAFF';
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool, email: p.email, name: `Fake R10r ${key}` },
      });
    }
    ids.firmA = (
      await tx.business.create({ data: { slug: ids.slugA, name: 'A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: ids.slugB, name: 'B', status: 'ACTIVE' } })
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
    const client = async (displayName: string, extra: object = {}) =>
      (await tx.client.create({ data: { ...A, displayName, ...extra } })).id;
    ids.one = await client('Fake One', { assignedUserId: people.staffA.id });
    ids.two = await client('Fake Two', { assignedUserId: people.staffA2.id });
    ids.three = await client('Fake Three');
    ids.old = await client('Fake Old', { archivedAt: new Date() });
    for (const [p, clientId] of [
      [people.clientA, ids.one],
      [people.otherClientA, ids.two],
      [people.unlinkedClientA, null],
    ] as const) {
      await tx.clientAccount.create({
        data: { ...A, userId: p.id, clientId, email: p.email, status: 'ACTIVE' },
      });
    }
    [ids.engOne, ids.engTwo] = (await addEngagement(tx, ids.firmA, [ids.one, ids.two])) as [
      string,
      string,
    ];
    const doc = (
      clientId: string,
      engagementId: string,
      direction: 'FIRM_TO_CLIENT' | 'INTERNAL',
      scan?: 'CLEAN' | 'INFECTED' | 'FAILED',
    ) => addDocument(tx, ids.firmA, clientId, engagementId, direction, scan);
    ids.docClean = await doc(ids.one, ids.engOne, 'FIRM_TO_CLIENT', 'CLEAN');
    ids.docPending = await doc(ids.one, ids.engOne, 'FIRM_TO_CLIENT');
    ids.docInfected = await doc(ids.one, ids.engOne, 'FIRM_TO_CLIENT', 'INFECTED');
    ids.docFailed = await doc(ids.one, ids.engOne, 'FIRM_TO_CLIENT', 'FAILED');
    ids.docInternal = await doc(ids.one, ids.engOne, 'INTERNAL', 'CLEAN');
    ids.docTwo = await doc(ids.two, ids.engTwo, 'FIRM_TO_CLIENT', 'CLEAN');
    ids.oldReturn = (
      await tx.taxReturn.create({
        data: { ...A, clientId: ids.old, taxYear: 2024, filingType: 'INDIVIDUAL' },
      })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    const B = { businessId: ids.firmB };
    await tx.membership.create({
      data: { ...B, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.clientB = (await tx.client.create({ data: { ...B, displayName: 'Fake B' } })).id;
    [ids.engB] = (await addEngagement(tx, ids.firmB, [ids.clientB])) as [string];
    ids.docB = await addDocument(tx, ids.firmB, ids.clientB, ids.engB, 'FIRM_TO_CLIENT', 'CLEAN');
    ids.returnB = (
      await tx.taxReturn.create({
        data: { ...B, clientId: ids.clientB, taxYear: 2024, filingType: 'INDIVIDUAL' },
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

describe('firm: tax returns per client and year', () => {
  it('creates annual returns and quarterly estimates; lists newest year first, annual before quarters', async () => {
    const filed = await made(ids.one, {
      taxYear: 2024,
      filingType: 'INDIVIDUAL',
      formType: '1040',
      status: 'FILED',
      filedOn: '2025-04-12',
      engagementId: ids.engOne,
      documentId: ids.docClean,
    });
    expect(filed).toMatchObject({
      clientId: ids.one,
      engagementId: ids.engOne,
      taxYear: 2024,
      filingType: 'INDIVIDUAL',
      quarter: null,
      formType: '1040',
      status: 'FILED',
      filedOn: '2025-04-12',
      document: { id: ids.docClean, fileName: PDF },
    });
    const q3 = await made(ids.one, {
      taxYear: 2025,
      filingType: 'INDIVIDUAL',
      quarter: 3,
      formType: '1040-ES',
    });
    expect(q3).toMatchObject({
      status: 'IN_PROGRESS',
      quarter: 3,
      filedOn: null,
      engagementId: null,
      document: null,
    });
    const q1 = await made(ids.one, { taxYear: 2025, filingType: 'INDIVIDUAL', quarter: 1 });
    const annual = await made(ids.one, {
      taxYear: 2025,
      filingType: 'BUSINESS',
      formType: '1120-S',
    });
    const made4 = new Set([filed.id, q3.id, q1.id, annual.id]);
    const items = (await firmList(ids.one)).filter((r) => made4.has(r.id));
    expect(items.map((r) => r.id)).toEqual([annual.id, q1.id, q3.id, filed.id]);
    expect(items.find((r) => r.id === filed.id)).toEqual(filed);
  });

  it('refuses bad input before anything else (400)', async () => {
    const r = await made(ids.one, { taxYear: 2011, filingType: 'INDIVIDUAL' });
    const base = { taxYear: 2024, filingType: 'INDIVIDUAL' };
    const cases: [Promise<Response>, string][] = [
      [create(ids.one, { ...base, quarter: 5 }), 'quarter 5'],
      [create(ids.one, { ...base, status: 'FILED' }), 'FILED without a date'],
      [create(ids.one, { ...base, status: 'ACCEPTED', filedOn: '2999-04-15' }), 'far future'],
      [create(ids.one, { ...base, status: 'FILED', filedOn: day(1) }), 'tomorrow'],
      [create(ids.one, { ...base, taxYear: 1999 }), 'year 1999'],
      [create(ids.one, { ...base, formType: 'x'.repeat(21) }), 'long form'],
      [create(ids.one, { ...base, businessId: ids.firmB }), 'businessId'],
      [create(ids.one, { ...base, clientId: ids.two }), 'clientId'],
      [create(ids.one, { ...base, documentId: 'nope' }), 'bad document id'],
      [create('nope', base), 'bad client id'],
      [patch(r.id, {}), 'empty change'],
      [patch(r.id, { status: 'FILED', filedOn: null }), 'FILED clearing the date'],
      [patch(r.id, { filedOn: day(1) }), 'tomorrow'],
      [patch(r.id, { clientId: ids.two }), 'move to another client'],
      [patch('nope', { formType: '1040' }), 'bad return id'],
      [firm('delete', '/tax-returns/nope', people.ownerA, {}), 'bad return id'],
    ];
    for (const [res, what] of cases) {
      const answer = await res;
      expect([what, answer.status, codeOf(answer)]).toEqual([what, 400, 'VALIDATION_FAILED']);
    }
    // Nothing was written: client one still has only the first test's 2024 return.
    expect((await firmList(ids.one)).filter((x) => x.taxYear === 2024)).toHaveLength(1);
  });

  it('FILED and ACCEPTED need the filed date, never a future one; clearing it is refused', async () => {
    const r = await made(ids.one, { taxYear: 2023, filingType: 'INDIVIDUAL' });
    const missing = await patch(r.id, { status: 'FILED' });
    refused(missing, 400, 'VALIDATION_FAILED');
    expect((missing.body as { error: { details: unknown } }).error.details).toEqual([
      { path: 'filedOn', message: 'Enter the date it was filed' },
    ]);
    const filed = await changed(r.id, { status: 'FILED', filedOn: day(0) });
    expect(filed).toMatchObject({ status: 'FILED', filedOn: day(0) });
    const accepted = await changed(r.id, { status: 'ACCEPTED' });
    expect(accepted.filedOn).toBe(day(0));
    refused(await patch(r.id, { filedOn: '' }), 400, 'VALIDATION_FAILED');
    expect((await changed(r.id, { filedOn: '2024-04-15' })).filedOn).toBe('2024-04-15');
  });

  it('a filed, accepted or completed return never goes back to IN_PROGRESS; a rejected one can', async () => {
    const r = await made(ids.one, {
      taxYear: 2022,
      filingType: 'INDIVIDUAL',
      status: 'FILED',
      filedOn: '2023-03-28',
    });
    refused(await patch(r.id, { status: 'IN_PROGRESS' }), 409, 'INVALID_STATUS');
    for (const status of ['ACCEPTED', 'COMPLETED']) {
      expect((await changed(r.id, { status })).status).toBe(status);
      refused(
        await patch(r.id, { status: 'IN_PROGRESS', formType: '1040' }),
        409,
        'INVALID_STATUS',
      );
    }
    expect((await changed(r.id, { status: 'REJECTED' })).status).toBe('REJECTED');
    expect((await changed(r.id, { status: 'IN_PROGRESS' })).status).toBe('IN_PROGRESS');
    expect((await firmList(ids.one)).find((x) => x.id === r.id)?.formType).toBeNull();
  });

  it('null or "" clears a field; a change that changes nothing writes nothing', async () => {
    const r = await made(ids.one, {
      taxYear: 2021,
      filingType: 'INDIVIDUAL',
      quarter: 2,
      formType: '1040-ES',
      engagementId: ids.engOne,
      documentId: ids.docPending,
    });
    const cleared = await changed(r.id, {
      quarter: null,
      formType: '',
      engagementId: null,
      documentId: null,
    });
    expect(cleared).toMatchObject({
      quarter: null,
      formType: null,
      engagementId: null,
      document: null,
    });
    const same = await changed(r.id, { taxYear: 2021, formType: '', status: 'IN_PROGRESS' });
    expect(same).toEqual(cleared);
  });

  it("links only this client's own documents, never an internal one, and only this client's engagements", async () => {
    const r = await made(ids.one, { taxYear: 2020, filingType: 'INDIVIDUAL' });
    const base = { taxYear: 2020, filingType: 'BUSINESS' };
    for (const documentId of [ids.docInternal, ids.docTwo, ids.docInfected]) {
      refused(await create(ids.one, { ...base, documentId }), 409, 'INVALID_DOCUMENT');
      refused(await patch(r.id, { documentId }), 409, 'INVALID_DOCUMENT');
    }
    // Staff never learn of a document of a client they can't reach: 404, not 409.
    refused(
      await create(ids.one, { ...base, documentId: ids.docTwo }, people.staffA),
      404,
      'NOT_FOUND',
    );
    refused(await patch(r.id, { documentId: ids.docTwo }, people.staffA), 404, 'NOT_FOUND');
    for (const documentId of [ids.docB, randomUUID()]) {
      refused(await create(ids.one, { ...base, documentId }), 404, 'NOT_FOUND');
      refused(await patch(r.id, { documentId }), 404, 'NOT_FOUND');
    }
    for (const engagementId of [ids.engTwo, ids.engB, randomUUID()]) {
      refused(await create(ids.one, { ...base, engagementId }), 404, 'NOT_FOUND');
      refused(await patch(r.id, { engagementId }), 404, 'NOT_FOUND');
    }
    const linked = await changed(r.id, { documentId: ids.docPending, engagementId: ids.engOne });
    // The firm sees its own PDF before the scan; the client only once it is CLEAN.
    expect(linked).toMatchObject({
      engagementId: ids.engOne,
      document: { id: ids.docPending, fileName: PDF },
    });
    expect((await firmList(ids.one)).filter((x) => x.taxYear === 2020)).toHaveLength(1);
  });

  it('deletes a return that was never filed; one that was ever filed is never deleted', async () => {
    const draft = await made(ids.one, { taxYear: 2019, filingType: 'INDIVIDUAL' });
    expect(ok(await remove(draft.id)).body).toEqual({ ok: true });
    refused(await remove(draft.id), 404, 'NOT_FOUND');
    refused(await patch(draft.id, { formType: '1040' }), 404, 'NOT_FOUND');
    const completed = await made(ids.one, {
      taxYear: 2019,
      filingType: 'INDIVIDUAL',
      status: 'COMPLETED',
    });
    refused(await remove(completed.id), 409, 'RETURN_LOCKED');
    // Filed, rejected and back in progress: it was filed once, so it stays.
    const again = await made(ids.one, {
      taxYear: 2019,
      filingType: 'BUSINESS',
      status: 'FILED',
      filedOn: '2020-03-16',
    });
    await changed(again.id, { status: 'REJECTED' });
    await changed(again.id, { status: 'IN_PROGRESS' });
    refused(await remove(again.id), 409, 'RETURN_LOCKED');
    const left = await inFirm(ids.firmA, (tx) =>
      tx.taxReturn.findMany({
        where: { id: { in: [draft.id, completed.id, again.id] } },
        select: { id: true },
      }),
    );
    expect(left.map((x) => x.id).sort()).toEqual([completed.id, again.id].sort());
  });

  it("an archived client's returns are read, never changed (409 CLIENT_ARCHIVED)", async () => {
    expect(Returns.parse(ok(await list(ids.old)).body).items.map((r) => r.id)).toEqual([
      ids.oldReturn,
    ]);
    refused(
      await create(ids.old, { taxYear: 2025, filingType: 'INDIVIDUAL' }),
      409,
      'CLIENT_ARCHIVED',
    );
    refused(await patch(ids.oldReturn, { formType: '1040' }), 409, 'CLIENT_ARCHIVED');
    refused(await remove(ids.oldReturn), 409, 'CLIENT_ARCHIVED');
    expect(Returns.parse(ok(await list(ids.old)).body).items).toMatchObject([
      { id: ids.oldReturn, formType: null },
    ]);
  });

  it("Staff reach only their own clients' returns", async () => {
    const own = await made(ids.one, { taxYear: 2018, filingType: 'INDIVIDUAL' }, people.staffA);
    expect((await changed(own.id, { formType: '1040' }, people.staffA)).formType).toBe('1040');
    ok(await list(ids.one, people.staffA));
    const theirs = await made(ids.two, { taxYear: 2018, filingType: 'INDIVIDUAL' });
    refused(await list(ids.two, people.staffA), 404, 'NOT_FOUND');
    refused(
      await create(ids.two, { taxYear: 2018, filingType: 'INDIVIDUAL' }, people.staffA),
      404,
      'NOT_FOUND',
    );
    refused(await patch(theirs.id, { formType: '1040' }, people.staffA), 404, 'NOT_FOUND');
    refused(await remove(theirs.id, people.staffA), 404, 'NOT_FOUND');
    ok(await remove(own.id, people.staffA));
  });

  it("another firm gets 404 on every route; a client's login is not firm staff", async () => {
    const r = await made(ids.one, { taxYear: 2017, filingType: 'INDIVIDUAL' });
    const body = { taxYear: 2017, filingType: 'INDIVIDUAL' };
    for (const res of [
      await list(ids.one, people.ownerB, ids.firmB),
      await create(ids.one, body, people.ownerB, ids.firmB),
      await patch(r.id, { formType: '1040' }, people.ownerB, ids.firmB),
      await remove(r.id, people.ownerB, ids.firmB),
      await list(ids.clientB),
      await create(ids.clientB, body),
      await patch(ids.returnB, { formType: '1040' }),
      await remove(ids.returnB),
      await list(ids.clientB, people.ownerA, ids.firmB),
    ]) {
      refused(res, 404, 'NOT_FOUND');
    }
    expect((await list(ids.one, people.clientA)).status).toBe(403);
    const untouched = await inFirm(ids.firmB, (tx) =>
      tx.taxReturn.findMany({ where: { businessId: ids.firmB }, select: { id: true } }),
    );
    expect(untouched.map((x) => x.id)).toEqual([ids.returnB]);
    expect((await firmList(ids.one)).find((x) => x.id === r.id)).toEqual(r);
  });
});

describe("portal: the client's own returns", () => {
  it('lists only their own returns, newest year first, without client or engagement ids', async () => {
    ok(await create(ids.two, { taxYear: 2024, filingType: 'BUSINESS', status: 'COMPLETED' }), 201);
    const ownIds = (await firmList(ids.one)).map((r) => r.id);
    expect((await mine(people.clientA)).map((r) => r.id)).toEqual(ownIds);
    const theirs = (await mine(people.otherClientA)).map((r) => r.id);
    expect(theirs).toEqual((await firmList(ids.two)).map((r) => r.id));
    expect(theirs.filter((id) => ownIds.includes(id))).toEqual([]);
    expect(await mine(people.unlinkedClientA)).toEqual([]);
  });

  it("filters by year, annual or quarterly, and filing type (the Taxes tab's cards)", async () => {
    const all = await mine(people.clientA);
    const pick = (keep: (r: (typeof all)[number]) => boolean) => all.filter(keep).map((r) => r.id);
    const cases: [string, string[]][] = [
      ['?taxYear=2025', pick((r) => r.taxYear === 2025)],
      ['?kind=quarterly', pick((r) => r.quarter !== null)],
      [
        '?kind=annual&filingType=INDIVIDUAL',
        pick((r) => !r.quarter && r.filingType === 'INDIVIDUAL'),
      ],
      [
        '?taxYear=2025&kind=annual&filingType=BUSINESS',
        pick((r) => r.taxYear === 2025 && !r.quarter && r.filingType === 'BUSINESS'),
      ],
    ];
    for (const [query, expected] of cases) {
      expect(expected.length, query).toBeGreaterThan(0);
      expect(
        (await mine(people.clientA, query)).map((r) => r.id),
        query,
      ).toEqual(expected);
    }
    for (const query of [
      '?taxYear=1999',
      '?kind=monthly',
      '?filingType=OTHER',
      `?clientId=${ids.two}`,
    ]) {
      refused(await portal(people.clientA, query), 400, 'VALIDATION_FAILED');
    }
  });

  it("shows the PDF only once its scan is CLEAN, never an internal or another client's document", async () => {
    const add = (taxYear: number, filingType: string, documentId?: string) =>
      made(ids.one, {
        taxYear,
        filingType,
        status: 'COMPLETED',
        ...(documentId ? { documentId } : {}),
      });
    const clean = await add(2016, 'INDIVIDUAL', ids.docClean);
    const pending = await add(2016, 'BUSINESS', ids.docPending);
    // An INFECTED file can't be linked (409). Real life: a file linked while its scan was still
    // pending, whose scan then comes back INFECTED (scan results are one-way).
    const lateInfected = await inFirm(ids.firmA, (tx) =>
      addDocument(tx, ids.firmA, ids.one, ids.engOne, 'FIRM_TO_CLIENT'),
    );
    const infected = await add(2015, 'INDIVIDUAL', lateInfected);
    await inFirm(ids.firmA, (tx) =>
      tx.document.update({
        where: { id: lateInfected },
        data: { scanStatus: 'INFECTED', scannedAt: new Date() },
      }),
    );
    const failed = await add(2015, 'BUSINESS', ids.docFailed);
    const internal = await add(2014, 'INDIVIDUAL');
    const others = await add(2014, 'BUSINESS');
    // The database refuses these two links: its rules are switched off here (superuser) to show
    // that the portal still never shows such a document.
    await inFirm(ids.firmA, async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.taxReturn.update({
        where: { id: internal.id },
        data: { documentId: ids.docInternal },
      });
      await tx.taxReturn.update({ where: { id: others.id }, data: { documentId: ids.docTwo } });
    });
    const seen = async () => new Map((await mine(people.clientA)).map((r) => [r.id, r.document]));
    const before = await seen();
    expect(before.get(clean.id)).toEqual({ id: ids.docClean, fileName: PDF });
    for (const r of [pending, infected, failed, internal, others]) {
      expect(before.get(r.id), `${r.taxYear} ${r.filingType}`).toBeNull();
    }
    // The firm sees every link.
    const firmView = new Map((await firmList(ids.one)).map((r) => [r.id, r.document?.id]));
    expect([pending, infected, failed, internal, others].map((r) => firmView.get(r.id))).toEqual([
      ids.docPending,
      lateInfected,
      ids.docFailed,
      ids.docInternal,
      ids.docTwo,
    ]);
    // The scan comes back CLEAN: now the client sees it.
    await inFirm(ids.firmA, (tx) =>
      tx.document.update({
        where: { id: ids.docPending },
        data: { scanStatus: 'CLEAN', scannedAt: new Date() },
      }),
    );
    expect((await seen()).get(pending.id)).toEqual({ id: ids.docPending, fileName: PDF });
  });

  it('staff sessions, other firms and firm routes are refused', async () => {
    // Portal routes take only the clients pool: a staff token is no session there.
    expect((await portal(people.ownerA)).status).toBe(401);
    refused(await portal(people.clientA, '', ids.slugB), 404, 'NOT_FOUND');
    expect(
      (await create(ids.one, { taxYear: 2024, filingType: 'INDIVIDUAL' }, people.clientA)).status,
    ).toBe(403);
  });
});

describe('audit', () => {
  it('logs every read and change with ids, counts and field names, never a value', async () => {
    const rows = await inFirm(ids.firmA, (tx) =>
      tx.auditLog.findMany({
        where: {
          businessId: ids.firmA,
          OR: [{ entityType: 'tax_return' }, { action: { contains: 'tax_returns' } }],
        },
      }),
    );
    const byAction = (action: string) => rows.filter((r) => r.action === action);
    for (const [action, type] of [
      ['client.tax_returns_viewed', 'client'],
      ['tax_return.created', 'tax_return'],
      ['tax_return.updated', 'tax_return'],
      ['tax_return.deleted', 'tax_return'],
      ['portal.tax_returns_viewed', 'client'],
    ] as const) {
      expect(byAction(action).length, action).toBeGreaterThan(0);
      expect(new Set(byAction(action).map((r) => r.entityType)), action).toEqual(new Set([type]));
    }
    const all = JSON.stringify(rows.map((r) => r.metadata));
    for (const value of [
      PDF,
      '1040-ES',
      '1120-S',
      '2025-04-12',
      '"FILED"',
      '"COMPLETED"',
      '"BUSINESS"',
    ]) {
      expect(all, value).not.toContain(value);
    }
    expect(byAction('tax_return.created').map((r) => r.metadata)).toContainEqual({
      clientId: ids.one,
      fields: [
        'documentId',
        'engagementId',
        'filedOn',
        'filingType',
        'formType',
        'status',
        'taxYear',
      ],
    });
    expect(byAction('tax_return.updated').map((r) => r.metadata)).toContainEqual({
      clientId: ids.one,
      fields: ['documentId', 'engagementId', 'formType', 'quarter'],
    });
    for (const r of byAction('tax_return.deleted')) {
      expect(r.metadata).toEqual({ clientId: ids.one });
    }
    for (const r of [
      ...byAction('client.tax_returns_viewed'),
      ...byAction('portal.tax_returns_viewed'),
    ]) {
      expect(Object.keys(r.metadata as object)).toEqual(['count']);
    }
    expect(byAction('portal.tax_returns_viewed').every((r) => r.actorUserId !== null)).toBe(true);
  });
});

/**
 * Runs `during` in an owner transaction (a change in progress elsewhere) and keeps it open until
 * `release()`, so a request can be made to wait on its locks.
 */
async function hold(during: (tx: TxClient) => Promise<unknown>) {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  let letGo!: () => void;
  const released = new Promise<void>((resolve) => (letGo = resolve));
  let held!: (pid: number) => void;
  const pid = new Promise<number>((resolve) => (held = resolve));
  const holder = runInScope(
    owner,
    { kind: 'business', businessId: ids.firmA },
    async (tx) => {
      await during(tx);
      const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      held(row!.pid);
      await released;
    },
    { timeout: 30_000 },
  );
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

describe('changes at the same time', () => {
  it('a client archived while a new return waits: 409 CLIENT_ARCHIVED, nothing written', async () => {
    const held = await hold(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM clients WHERE id = ${ids.three}::uuid FOR UPDATE`;
      await tx.client.update({ where: { id: ids.three }, data: { archivedAt: new Date() } });
    });
    const post = create(ids.three, { taxYear: 2025, filingType: 'INDIVIDUAL' });
    await held.waitedOn();
    await held.release();
    refused(await post, 409, 'CLIENT_ARCHIVED');
    const count = await inFirm(ids.firmA, (tx) =>
      tx.taxReturn.count({ where: { clientId: ids.three } }),
    );
    expect(count).toBe(0);
  });

  it('a rejected return filed again while a change back to IN_PROGRESS waits: 409 INVALID_STATUS', async () => {
    const r = await made(ids.one, { taxYear: 2012, filingType: 'INDIVIDUAL', status: 'REJECTED' });
    const held = await hold(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM tax_returns WHERE id = ${r.id}::uuid FOR UPDATE`;
      await tx.taxReturn.update({
        where: { id: r.id },
        data: { status: 'FILED', filedOn: new Date('2013-04-15') },
      });
    });
    const back = patch(r.id, { status: 'IN_PROGRESS' });
    await held.waitedOn();
    await held.release();
    refused(await back, 409, 'INVALID_STATUS');
    expect((await firmList(ids.one)).find((x) => x.id === r.id)?.status).toBe('FILED');
  });

  it('a return filed while its delete waits: 409 RETURN_LOCKED, the return stays', async () => {
    const r = await made(ids.one, { taxYear: 2013, filingType: 'INDIVIDUAL' });
    const held = await hold(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM tax_returns WHERE id = ${r.id}::uuid FOR UPDATE`;
      await tx.taxReturn.update({
        where: { id: r.id },
        data: { status: 'FILED', filedOn: new Date('2014-04-15') },
      });
    });
    const del = remove(r.id);
    await held.waitedOn();
    await held.release();
    refused(await del, 409, 'RETURN_LOCKED');
    expect((await firmList(ids.one)).some((x) => x.id === r.id)).toBe(true);
  });
});

describe('the database keeps the same rules', () => {
  it("its refusals answer with the contract's codes, never a 500", async () => {
    const insert = (data: object) =>
      inFirm(ids.firmA, (tx) =>
        tx.taxReturn.create({
          data: {
            businessId: ids.firmA,
            clientId: ids.one,
            taxYear: 2024,
            filingType: 'INDIVIDUAL',
            ...data,
          },
        }),
      ).then(
        () => undefined,
        (error: unknown) => error,
      );
    const cases: [object, number, string][] = [
      [{ documentId: ids.docInternal }, 409, 'INVALID_DOCUMENT'],
      [{ documentId: ids.docTwo }, 409, 'INVALID_DOCUMENT'],
      [{ status: 'ACCEPTED' }, 400, 'VALIDATION_FAILED'],
      [{ filedOn: new Date('2999-04-15') }, 400, 'VALIDATION_FAILED'],
      [{ quarter: 5 }, 400, 'VALIDATION_FAILED'],
      [{ engagementId: ids.engTwo }, 404, 'NOT_FOUND'],
    ];
    for (const [data, status, code] of cases) {
      const answer = refusalOf(await insert(data));
      const response = answer?.getResponse() as { code?: string } | undefined;
      expect([answer?.getStatus(), response?.code], JSON.stringify(data)).toEqual([status, code]);
    }
  });

  it('as the API role, a return that was ever filed is not deleted', async () => {
    const r = await made(ids.one, {
      taxYear: 2010,
      filingType: 'INDIVIDUAL',
      status: 'FILED',
      filedOn: '2011-04-15',
    });
    const appClient = createPrismaClient(fx.appUrl);
    try {
      const { count } = await runInScope(
        appClient,
        { kind: 'business', businessId: ids.firmA },
        (tx) => tx.taxReturn.deleteMany({ where: { id: r.id } }),
      );
      expect(count).toBe(0);
    } finally {
      await appClient.$disconnect();
    }
  });
});
