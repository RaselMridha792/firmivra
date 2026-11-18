// End-to-end: Client Portal BK-CP4 (R55), a bookkeeping client's Portal Defaults ("Shown in the
// client portal": Reports, Tasks, Documents, Notes) decide what the portal shows of that
// Bookkeeping service, in the portal's API itself: Reports off hides the service's reports, their
// files and the new-report notice; Documents off hides the firm's documents of the service (never
// the client's own uploads); Notes off refuses Share with Client for a note of the service. A
// default never saved is shown, and the Settings screen reads it so. Other services and other
// clients are untouched. Synthetic data only.
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  BookkeepingClientWorkspace,
  InternalNote,
  MyDocumentList,
  MyReportList,
  Report,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `bkcp4-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  clientA: person('client-a'),
  clientA2: person('client-a2'),
};
type Who = (typeof people)[keyof typeof people];
const firm = {} as { id: string; slug: string };
const clients = {} as Record<'c1' | 'c2', string>;
const bk = {} as Record<'c1' | 'c2', BookkeepingClientWorkspace>;
/** c1's other (Annual Tax) engagement. */
let annual = '';
/** c1's: the firm's shared file and the client's upload on the books, a report's file, the tax file; c2's shared file. */
const docs = {} as Record<'shared' | 'upload' | 'reportFile' | 'tax' | 'c2Shared', string>;
let report = '';

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.68.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

async function inFirm<T>(work: (tx: TxClient) => Promise<T>): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, { kind: 'business', businessId: firm.id }, work);
  } finally {
    await owner.$disconnect();
  }
}
async function asPlatform<T>(work: (tx: TxClient) => Promise<T>): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, { kind: 'platform' }, work);
  } finally {
    await owner.$disconnect();
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

/** A firm call under /api/v1/business. */
async function business(
  method: 'get' | 'post' | 'patch',
  path: string,
  body?: object,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', firm.id)
    .set('x-forwarded-for', viewer())
    .set('authorization', `Bearer ${await tokenFor(people.ownerA.email)}`);
  return body === undefined ? req : req.send(body);
}
/** A portal read under /api/v1/portal/{slug}/me. */
async function portal(path: string, who: Who = people.clientA): Promise<Response> {
  return request(app.getHttpServer())
    .get(`/api/v1/portal/${firm.slug}/me${path}`)
    .set('x-forwarded-for', viewer())
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};

const setDefaults = async (key: 'c1' | 'c2', portalDefaults: object) =>
  BookkeepingClientWorkspace.parse(
    ok(await business('patch', `/bookkeeping/clients/${bk[key].id}`, { portalDefaults })),
  ).portalDefaults;
const firmFiles = async (who: Who = people.clientA) =>
  MyDocumentList.parse(ok(await portal('/documents?source=FIRM&limit=100', who))).items.map(
    (d) => d.id,
  );
const myFiles = async () =>
  MyDocumentList.parse(ok(await portal('/documents?source=MINE&limit=100'))).items.map((d) => d.id);
const reportsOf = async (engagementId: string) =>
  MyReportList.parse(ok(await portal(`/services/${engagementId}/reports`))).items.map((r) => r.id);

beforeAll(async () => {
  await asPlatform(async (tx) => {
    for (const [key, p] of Object.entries(people))
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: key.startsWith('client') ? 'CLIENT' : 'STAFF',
          email: p.email,
          name: `Fake Bkcp4 ${key}`,
        },
      });
    const slug = `bkcp4-${run}`;
    Object.assign(
      firm,
      await tx.business.create({
        data: { slug, name: `Firm ${slug}`, status: 'ACTIVE' },
        select: { id: true, slug: true },
      }),
    );
  });
  await inFirm(async (tx) => {
    const businessId = firm.id;
    await tx.membership.create({
      data: { businessId, userId: people.ownerA.id, role: 'OWNER', status: 'ACTIVE' },
    });
    await tx.service.create({
      data: { businessId, kind: 'BOOKKEEPING', name: `Fake books ${run}`, status: 'ACTIVE' },
    });
    const client = (name: string) =>
      tx.client.create({ data: { businessId, displayName: name }, select: { id: true } });
    clients.c1 = (await client(`Fake Maple Studio ${run}`)).id;
    clients.c2 = (await client(`Fake Birch Co ${run}`)).id;
    for (const [who, clientId] of [
      [people.clientA, clients.c1],
      [people.clientA2, clients.c2],
    ] as const)
      await tx.clientAccount.create({
        data: { businessId, userId: who.id, email: who.email, clientId, status: 'ACTIVE' },
      });
    const tax = await tx.service.create({
      data: { businessId, kind: 'ANNUAL_TAX', name: `Fake annual ${run}` },
      select: { id: true },
    });
    annual = (
      await tx.engagement.create({
        data: {
          businessId,
          clientId: clients.c1,
          serviceId: tax.id,
          title: `Fake 2025 return ${run}`,
        },
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

  for (const key of ['c1', 'c2'] as const)
    bk[key] = BookkeepingClientWorkspace.parse(
      ok(
        await business('post', '/bookkeeping/clients', { clientId: clients[key], plan: 'Growth' }),
        201,
      ),
    );
  await inFirm(async (tx) => {
    const file = (
      clientId: string,
      engagementId: string,
      direction: 'FIRM_TO_CLIENT' | 'CLIENT_TO_FIRM',
      name: string,
    ) =>
      tx.document
        .create({
          data: {
            businessId: firm.id,
            clientId,
            engagementId,
            direction,
            fileName: name,
            contentType: 'application/pdf',
            sizeBytes: 9,
            sha256: createHash('sha256')
              .update(name + run)
              .digest('hex'),
            s3Key: `tenant/${firm.id}/documents/${randomUUID()}`,
          },
          select: { id: true },
        })
        .then((d) => d.id);
    docs.shared = await file(clients.c1, bk.c1.engagementId, 'FIRM_TO_CLIENT', 'Fake ledger.pdf');
    docs.upload = await file(clients.c1, bk.c1.engagementId, 'CLIENT_TO_FIRM', 'Fake bank.pdf');
    docs.reportFile = await file(clients.c1, bk.c1.engagementId, 'FIRM_TO_CLIENT', 'Fake pnl.pdf');
    docs.tax = await file(clients.c1, annual, 'FIRM_TO_CLIENT', 'Fake 1040.pdf');
    docs.c2Shared = await file(clients.c2, bk.c2.engagementId, 'FIRM_TO_CLIENT', 'Fake c2.pdf');
    report = (
      await tx.engagementReport.create({
        data: {
          businessId: firm.id,
          engagementId: bk.c1.engagementId,
          documentId: docs.reportFile,
          kind: 'REPORT',
          title: `Fake October P&L ${run}`,
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
        select: { id: true },
      })
    ).id;
  });
});

afterAll(async () => {
  await app.close();
});

describe('BK-CP4: per-client Portal Defaults decide what the portal shows', () => {
  it('shows everything while no default is saved, and the Settings screen reads them as shown', async () => {
    expect(bk.c1.portalDefaults).toEqual({
      reports: true,
      tasks: true,
      documents: true,
      notes: true,
    });
    expect(await reportsOf(bk.c1.engagementId)).toEqual([report]);
    expect(await firmFiles()).toEqual(
      expect.arrayContaining([docs.shared, docs.reportFile, docs.tax]),
    );
    expect(await myFiles()).toContain(docs.upload);
  });

  it("Reports off hides the service's reports, their files and the new-report notice, by address too", async () => {
    expect(await setDefaults('c1', { reports: false })).toEqual({
      reports: false,
      tasks: true,
      documents: true,
      notes: true,
    });
    expect(await reportsOf(bk.c1.engagementId)).toEqual([]);
    const files = await firmFiles();
    expect(files).not.toContain(docs.reportFile);
    expect(files).toEqual(expect.arrayContaining([docs.shared, docs.tax]));
    expectError(await portal(`/documents/${docs.reportFile}`), 404, 'NOT_FOUND');
    expectError(await portal(`/documents/${docs.reportFile}/download`), 404, 'NOT_FOUND');
    // A report published now tells the client nothing (BK-CP2's notice follows the default).
    const quiet = Report.parse(
      ok(
        await business('post', `/workspaces/${bk.c1.engagementId}/reports`, {
          kind: 'REPORT',
          title: `Fake November P&L ${run}`,
        }),
        201,
      ),
    );
    ok(await business('post', `/reports/${quiet.id}/publish`));
    expect(
      await inFirm((tx) =>
        tx.notification.count({
          where: { businessId: firm.id, eventKey: `report.published:${quiet.id}` },
        }),
      ),
    ).toBe(0);
    // Another client's service is untouched.
    expect(await firmFiles(people.clientA2)).toEqual([docs.c2Shared]);
    await setDefaults('c1', { reports: true });
    expect(await reportsOf(bk.c1.engagementId)).toContain(report);
  });

  it("Documents off hides the firm's documents of the service, never the client's own uploads", async () => {
    await setDefaults('c1', { documents: false });
    const files = await firmFiles();
    expect(files).not.toContain(docs.shared);
    expect(files).not.toContain(docs.reportFile);
    // Another service's documents still show; the client's own uploads are theirs.
    expect(files).toContain(docs.tax);
    expect(await myFiles()).toContain(docs.upload);
    expectError(await portal(`/documents/${docs.shared}`), 404, 'NOT_FOUND');
    ok(await portal(`/documents/${docs.upload}`));
    // The service's reports are a separate default: still shown.
    expect(await reportsOf(bk.c1.engagementId)).toContain(report);
    expect(await firmFiles(people.clientA2)).toEqual([docs.c2Shared]);
    await setDefaults('c1', { documents: true });
    expect(await firmFiles()).toContain(docs.shared);
  });

  it('Notes off refuses Share with Client for a note of the service; a note of no service still shares', async () => {
    const note = (engagementId?: string) =>
      business('post', `/clients/${clients.c1}/notes`, {
        body: `Fake note ${run}`,
        ...(engagementId ? { engagementId } : {}),
      }).then((res) => InternalNote.parse(ok(res, 201)));
    const books = await note(bk.c1.engagementId);
    const general = await note();
    await setDefaults('c1', { notes: false });
    expectError(
      await business('post', `/notes/${books.id}/share`, { updatedAt: books.updatedAt }),
      409,
      'NOTES_HIDDEN_IN_PORTAL',
    );
    expect(
      await inFirm((tx) =>
        tx.messageThread.count({ where: { businessId: firm.id, clientId: clients.c1 } }),
      ),
    ).toBe(0);
    ok(await business('post', `/notes/${general.id}/share`, { updatedAt: general.updatedAt }));
    await setDefaults('c1', { notes: true });
    ok(await business('post', `/notes/${books.id}/share`, { updatedAt: books.updatedAt }));
  });
});
