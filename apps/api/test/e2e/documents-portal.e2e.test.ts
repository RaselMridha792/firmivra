// End-to-end: R5 part 2. The portal's documents (lists, view, download, categories, upload
// targets, uploads and confirm) with the household rules (Rasel, q12), the document requests on
// both sides with their state machine, the request path of confirm, the scan results that reopen
// a request (q22) or accept a password-protected PDF unscanned (q24), isolation between clients,
// logins and firms, and the audit (ids only). Storage is in memory here (CI has no s3mock).
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import type { z } from 'zod';
import {
  FirmDocument,
  FirmDocumentRequest,
  FirmDocumentRequestList,
  MyDocument,
  MyDocumentCategoryList,
  MyDocumentList,
  MyDocumentRequest,
  MyDocumentRequestList,
  PORTAL_BLOCKED_TEXT,
  UploadTargets,
  UploadTicket,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig } from '../../src/storage/config.js';
import { DOCUMENT_STORAGE, type DocumentStorage } from '../../src/storage/document-storage.js';
import { ScanResultsService, type ScanResult } from '../../src/storage/scan-results.service.js';
import { DOCX, office, pdf, sha256 } from '../office-files.js';

/** Storage in memory: `objects.set(key, bytes)` is the browser's PUT. */
class MemoryStorage implements DocumentStorage {
  readonly objects = new Map<string, Buffer>();
  presignUpload(file: { key: string; contentType: string }) {
    return Promise.resolve({
      url: `memory:${file.key}`,
      headers: { 'content-type': file.contentType },
    });
  }
  head(key: string, { checksum = false } = {}) {
    const b = this.objects.get(key);
    const found = b && {
      sizeBytes: b.length,
      sha256: checksum ? sha256(b) : null,
      contentEncoding: null,
    };
    return Promise.resolve(found ?? null);
  }
  read(key: string) {
    return Promise.resolve(this.objects.get(key) ?? null);
  }
  remove(key: string) {
    this.objects.delete(key);
    return Promise.resolve();
  }
  presignDownload(file: { key: string }) {
    return Promise.resolve(`memory:${file.key}?download`);
  }
}
const storage = new MemoryStorage();
/** SCAN_MODE: local marks a confirmed file CLEAN; guardduty leaves it PENDING for a result. */
const config: DocumentsConfig = {
  bucket: 'unused',
  region: 'us-east-1',
  forcePathStyle: true,
  scanMode: 'local',
};
const outbox: NotifyMessage[] = [];

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string, pool: 'STAFF' | 'CLIENT' = 'CLIENT') => ({
  id: randomUUID(),
  email: `r5p-${key}-${run}@r5.test`,
  name: `Fake R5 ${key}`,
  pool,
});
const people = {
  ownerA: person('owner-a', 'STAFF'),
  staffA: person('staff-a', 'STAFF'),
  staffA2: person('staff-a2', 'STAFF'),
  ownerB: person('owner-b', 'STAFF'),
  primary: person('primary'),
  spouse: person('spouse'),
  authorized: person('authorized'),
  other: person('other'),
  stop: person('stop'),
  clientB: person('client-b'),
};
type Person = (typeof people)[keyof typeof people];
type Firm = 'a' | 'b';
const firms = {} as Record<Firm, { id: string; slug: string }>;
/** c1 is staffA's with three logins; c2 has `other`; c3 (`stop`) has only a PENDING service. */
const ids = {} as Record<
  'c1' | 'c2' | 'c3' | 'cB' | 'e1' | 'e1b' | 'e1p' | 'e2' | 'e3p' | 'eB' | 'cat' | 'old',
  string
>;
const accounts = {} as Record<'primary' | 'spouse' | 'authorized', string>;

let app: INestApplication;
let scans: ScanResultsService;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.51.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.6`;

async function asOwner<T>(businessId: string | null, work: Parameters<typeof runInScope<T>>[2]) {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    const scope = businessId
      ? ({ kind: 'business', businessId } as const)
      : ({ kind: 'platform' } as const);
    return await runInScope(owner, scope, work);
  } finally {
    await owner.$disconnect();
  }
}

async function tokenFor(who: Person): Promise<string> {
  const cached = tokens.get(who.email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .set('x-forwarded-for', viewer())
    .send({ email: who.email });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const { token } = res.body as { token: string };
  tokens.set(who.email, token);
  return token;
}

/** A portal call (`/me...` on the firm's portal) or a firm call (`/business...`). */
async function call(
  method: 'get' | 'post',
  path: string,
  who: Person,
  body?: object,
  firm: Firm = 'a',
) {
  const portal = path.startsWith('/me');
  const req = request(app.getHttpServer())
    [method](portal ? `/api/v1/portal/${firms[firm].slug}${path}` : `/api/v1/business${path}`)
    .set('authorization', `Bearer ${await tokenFor(who)}`)
    .set('x-forwarded-for', viewer());
  if (!portal) req.set('x-business-id', firms[firm].id);
  return body === undefined ? req : req.send(body);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string; message: string } }).error;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)?.code], JSON.stringify(res.body)).toEqual([status, code]);
/** Parses with the contract and refuses anything it does not name (a leaked field fails). */
function exact<S extends z.ZodType>(schema: S, res: Response): z.output<S> {
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const parsed = schema.parse(res.body);
  expect(parsed).toEqual(res.body);
  return parsed;
}

const facts = (bytes: Buffer, fileName = 'W-2_2025.pdf', contentType = 'application/pdf') => ({
  fileName,
  contentType,
  sizeBytes: bytes.length,
  sha256: sha256(bytes),
});
/** Step 1, the PUT and step 3 (portal for client logins, firm route for staff); or step 1's error. */
async function upload(
  who: Person,
  body: Record<string, unknown>,
  bytes: Buffer = pdf(),
  firm: Firm = 'a',
) {
  const portal = who.pool === 'CLIENT';
  const { clientId = ids.c1, ...rest } = body;
  const described = {
    ...facts(bytes, rest['fileName'] as string, rest['contentType'] as string),
    ...rest,
  };
  const start = await call(
    'post',
    portal ? '/me/documents/uploads' : `/clients/${clientId as string}/documents/uploads`,
    who,
    described,
    firm,
  );
  if (start.status !== 200) return { res: start, key: '', token: '' };
  const ticket = exact(UploadTicket, start);
  const key = ticket.url.slice('memory:'.length);
  storage.objects.set(key, bytes);
  const confirm = portal ? '/me/documents/uploads/confirm' : '/documents/uploads/confirm';
  const res = await call('post', confirm, who, { uploadToken: ticket.uploadToken }, firm);
  return { res, key, token: ticket.uploadToken };
}
const mine = async (who: Person, body: Record<string, unknown>, bytes?: Buffer) =>
  exact(MyDocument, (await upload(who, { serviceId: ids.e1, ...body }, bytes)).res);
const firmFile = async (body: Record<string, unknown>, bytes?: Buffer) =>
  exact(FirmDocument, (await upload(people.ownerA, { serviceId: ids.e1, ...body }, bytes)).res);
const newRequest = async (body: Record<string, unknown> = {}, who: Person = people.ownerA) =>
  exact(
    FirmDocumentRequest,
    await call('post', `/clients/${ids.c1}/document-requests`, who, {
      serviceId: ids.e1,
      title: 'W-2 from your employer',
      ...body,
    }),
  );
const decide = (id: string, action: 'accept' | 'reject' | 'cancel', who: Person = people.ownerA) =>
  call(
    'post',
    `/document-requests/${id}/${action}`,
    who,
    action === 'reject' ? { reason: 'Pages are missing' } : {},
  );
const requestRow = (id: string) =>
  asOwner(firms.a.id, (tx) => tx.documentRequest.findUniqueOrThrow({ where: { id } }));
const keyOf = async (documentId: string) =>
  (await asOwner(firms.a.id, (tx) => tx.document.findUniqueOrThrow({ where: { id: documentId } })))
    .s3Key;
const scan = async (documentId: string, status: ScanResult['status'], reasons?: string[]) =>
  scans.recordScanResult({ key: await keyOf(documentId), status, reasons });
const auditOf = (entityId: string) =>
  asOwner(firms.a.id, (tx) =>
    tx.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } }),
  );
const myList = async (who: Person, query = '') =>
  exact(MyDocumentList, await call('get', `/me/documents${query}`, who));
/** Holds SCAN_MODE=guardduty (files stay PENDING) while `work` runs. */
async function scanned<T>(work: () => Promise<T>): Promise<T> {
  config.scanMode = 'guardduty';
  try {
    return await work();
  } finally {
    config.scanMode = 'local';
  }
}

/**
 * Holds the request's row lock (FOR UPDATE, another session) while `work` starts, until `waiters`
 * sessions wait behind it (directly or behind each other), then lets them all go at once: the
 * calls race for the request, whatever their timing.
 */
async function racing<T>(requestId: string, waiters: number, work: () => Promise<T>): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  let started: Promise<T> | undefined;
  try {
    await runInScope(
      owner,
      { kind: 'business', businessId: firms.a.id },
      async (tx) => {
        const [me] = await tx.$queryRaw<{ pid: number }[]>`
          SELECT pg_backend_pid() AS pid FROM document_requests
          WHERE id = ${requestId}::uuid FOR UPDATE`;
        started = work();
        for (let i = 0; i < 200; i++) {
          const [row] = await owner.$queryRaw<{ n: number }[]>`
            WITH w AS (SELECT pid, pg_blocking_pids(pid) AS b FROM pg_stat_activity)
            SELECT count(*)::int AS n FROM w
            WHERE ${me?.pid}::int = ANY(w.b)
               OR EXISTS (SELECT 1 FROM w AS v WHERE ${me?.pid}::int = ANY(v.b) AND v.pid = ANY(w.b))`;
          if ((row?.n ?? 0) >= waiters) return;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error('the calls never waited on the request');
      },
      { timeout: 20_000 },
    );
    return await started!;
  } finally {
    await owner.$disconnect();
  }
}

beforeAll(async () => {
  await asOwner(null, async (tx) => {
    for (const { id, pool, email, name } of Object.values(people)) {
      await tx.user.create({ data: { id, cognitoSub: id, pool, email, name } });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r5p-${key}-${run}`;
      firms[key] = await tx.business.create({
        data: { slug, name: slug, status: 'ACTIVE' },
        select: { id: true, slug: true },
      });
    }
  });
  const staff = [
    ['a', people.ownerA, 'OWNER'],
    ['a', people.staffA, 'STAFF'],
    ['a', people.staffA2, 'STAFF'],
    ['b', people.ownerB, 'OWNER'],
  ] as const;
  for (const [firm, p, role] of staff) {
    const businessId = firms[firm].id;
    await asOwner(businessId, (tx) =>
      tx.membership.create({ data: { businessId, userId: p.id, role, status: 'ACTIVE' } }),
    );
  }
  const setUp = (firm: Firm) => {
    const businessId = firms[firm].id;
    return asOwner(businessId, async (tx) => {
      const client = (assignedUserId: string | null = null) =>
        tx.client
          .create({ data: { businessId, displayName: 'R5 Client (fake)', assignedUserId } })
          .then((c) => c.id);
      const login = (
        who: Person,
        clientId: string,
        portalRole: 'PRIMARY' | 'SPOUSE' | 'AUTHORIZED' = 'PRIMARY',
      ) =>
        tx.clientAccount
          .create({
            data: {
              businessId,
              userId: who.id,
              email: who.email,
              clientId,
              portalRole,
              status: 'ACTIVE',
            },
          })
          .then((a) => a.id);
      const service = (kind: 'ANNUAL_TAX' | 'BOOKKEEPING') =>
        tx.service.create({ data: { businessId, kind, name: kind } }).then((s) => s.id);
      const engagement = (
        clientId: string,
        serviceId: string,
        status: 'ACTIVE' | 'PENDING' = 'ACTIVE',
      ) =>
        tx.engagement
          .create({
            data: { businessId, clientId, serviceId, title: 'R5 (fake)', taxYear: 2025, status },
          })
          .then((e) => e.id);
      const tax = await service('ANNUAL_TAX');
      if (firm === 'b') {
        ids.cB = await client();
        await login(people.clientB, ids.cB);
        ids.eB = await engagement(ids.cB, tax);
        return;
      }
      [ids.c1, ids.c2, ids.c3] = [await client(people.staffA.id), await client(), await client()];
      accounts.primary = await login(people.primary, ids.c1);
      accounts.spouse = await login(people.spouse, ids.c1, 'SPOUSE');
      accounts.authorized = await login(people.authorized, ids.c1, 'AUTHORIZED');
      await login(people.other, ids.c2);
      await login(people.stop, ids.c3);
      ids.e1 = await engagement(ids.c1, tax);
      ids.e1b = await engagement(ids.c1, await service('BOOKKEEPING'));
      ids.e1p = await engagement(ids.c1, tax, 'PENDING');
      ids.e2 = await engagement(ids.c2, tax);
      ids.e3p = await engagement(ids.c3, tax, 'PENDING');
      const category = (name: string, archivedAt: Date | null) =>
        tx.documentCategory.create({ data: { businessId, name, archivedAt } }).then((c) => c.id);
      ids.cat = await category('Tax Documents', null);
      ids.old = await category('Old', new Date());
    });
  };
  await setUp('a');
  await setUp('b');

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(DOCUMENT_STORAGE)
    .useValue(storage)
    .overrideProvider(DOCUMENTS_CONFIG)
    .useValue(config)
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({
      send: (message: NotifyMessage) => {
        outbox.push(message);
        return Promise.resolve();
      },
    })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
  scans = nest.get(ScanResultsService);
});

afterAll(async () => {
  await app.close();
});

describe('portal uploads (household rules, q12)', () => {
  it('records the login, names the uploader for the household and defaults the tax year', async () => {
    const { res, key } = await upload(people.primary, { serviceId: ids.e1, categoryId: ids.cat });
    const doc = exact(MyDocument, res);
    expect(doc).toMatchObject({
      source: 'MINE',
      status: 'READY',
      taxYear: 2025,
      requestId: null,
      category: { id: ids.cat, name: 'Tax Documents' },
      uploadedBy: { name: people.primary.name },
    });
    const row = await asOwner(firms.a.id, (tx) =>
      tx.document.findUniqueOrThrow({ where: { id: doc.id } }),
    );
    expect([row.direction, row.uploadedByUserId, row.s3Key]).toEqual([
      'CLIENT_TO_FIRM',
      people.primary.id,
      key,
    ]);
    const uploaded = (await auditOf(doc.id)).find((a) => a.action === 'document.uploaded');
    expect(uploaded?.metadata).toMatchObject({
      clientId: ids.c1,
      clientAccountId: accounts.primary,
    });
    expect(JSON.stringify(uploaded?.metadata)).not.toMatch(/W-2|tenant\//);

    // PRIMARY and SPOUSE see the same: the spouse sees it with the uploader's name.
    const forSpouse = await myList(people.spouse);
    expect(forSpouse.items.find((d) => d.id === doc.id)?.uploadedBy).toEqual({
      name: people.primary.name,
    });
    exact(MyDocument, await call('get', `/me/documents/${doc.id}`, people.spouse));
    // An AUTHORIZED login sees only its own uploads.
    expect((await myList(people.authorized)).items.map((d) => d.id)).not.toContain(doc.id);
    expectError(await call('get', `/me/documents/${doc.id}`, people.authorized), 404, 'NOT_FOUND');
    expectError(
      await call('get', `/me/documents/${doc.id}/download`, people.authorized),
      404,
      'NOT_FOUND',
    );
  });

  it('checks the service, request and category: 404 first, then the 409s', async () => {
    const theirs = exact(
      FirmDocumentRequest,
      await call('post', `/clients/${ids.c2}/document-requests`, people.ownerA, {
        serviceId: ids.e2,
        title: 'Theirs',
      }),
    );
    const r = await newRequest();
    const start = (body: Record<string, unknown>, who: Person = people.primary) =>
      call('post', '/me/documents/uploads', who, { ...facts(pdf()), serviceId: ids.e1, ...body });
    expectError(await start({ serviceId: ids.e2 }), 404, 'NOT_FOUND');
    expectError(await start({ serviceId: ids.eB }), 404, 'NOT_FOUND');
    expectError(await start({ requestId: theirs.id }), 404, 'NOT_FOUND');
    expectError(await start({ categoryId: randomUUID() }), 404, 'NOT_FOUND');
    expectError(await start({ serviceId: ids.e1p }), 409, 'NO_OPEN_SERVICE');
    expectError(await start({ serviceId: ids.e1b, requestId: r.id }), 409, 'REQUEST_CLOSED');
    expectError(await start({ categoryId: ids.old }), 409, 'CATEGORY_ARCHIVED');
    expectError(await start({ serviceId: ids.e3p }, people.stop), 409, 'NO_OPEN_SERVICE');
    expectError(await start({ businessId: firms.b.id }), 400, 'VALIDATION_FAILED');
  });

  it('answers a request in the confirm: SUBMITTED, audited, and no second file for it', async () => {
    const r = await newRequest();
    const doc = await mine(people.authorized, { requestId: r.id });
    expect([doc.requestId, doc.uploadedBy]).toEqual([r.id, { name: people.authorized.name }]);
    const row = await requestRow(r.id);
    expect(row.status).toBe('SUBMITTED');
    const submitted = (await auditOf(r.id)).find((a) => a.action === 'document_request.submitted');
    expect(submitted?.metadata).toEqual({
      clientId: ids.c1,
      documentId: doc.id,
      from: 'REQUESTED',
      clientAccountId: accounts.authorized,
    });
    // The same transaction as the document.
    const [docXmin, reqXmin] = await asOwner(firms.a.id, async (tx) => {
      const [d] = await tx.$queryRaw<
        { x: string }[]
      >`SELECT xmin::text AS x FROM documents WHERE id = ${doc.id}::uuid`;
      const [q] = await tx.$queryRaw<
        { x: string }[]
      >`SELECT xmin::text AS x FROM document_requests WHERE id = ${r.id}::uuid`;
      return [d?.x, q?.x];
    });
    expect(docXmin).toBe(reqXmin);
    const again = await upload(people.primary, { serviceId: ids.e1, requestId: r.id });
    expectError(again.res, 409, 'REQUEST_CLOSED');
    // The AUTHORIZED login sees its own upload.
    expect((await myList(people.authorized)).items.map((d) => d.id)).toContain(doc.id);
  });

  it('refuses at confirm a request closed after the ticket, deleting and auditing the upload', async () => {
    const r = await newRequest();
    const bytes = pdf('closed later');
    const start = await call('post', '/me/documents/uploads', people.primary, {
      ...facts(bytes),
      serviceId: ids.e1,
      requestId: r.id,
    });
    const ticket = exact(UploadTicket, start);
    const key = ticket.url.slice('memory:'.length);
    storage.objects.set(key, bytes);
    exact(FirmDocumentRequest, await decide(r.id, 'cancel'));
    const res = await call('post', '/me/documents/uploads/confirm', people.primary, {
      uploadToken: ticket.uploadToken,
    });
    expectError(res, 409, 'REQUEST_CLOSED');
    expect(storage.objects.has(key)).toBe(false);
    const refused = await asOwner(firms.a.id, (tx) =>
      tx.auditLog.findFirst({
        where: {
          action: 'document.upload_refused',
          metadata: { path: ['uploadId'], equals: key.slice(key.lastIndexOf('/') + 1) },
        },
      }),
    );
    expect(refused?.metadata).toMatchObject({ code: 'REQUEST_CLOSED' });
    expect((await requestRow(r.id)).status).toBe('CANCELLED');
  });

  it('binds the token to the login, and re-checks the household rule at confirm', async () => {
    const bytes = pdf('bound');
    const ticketOf = async (who: Person, body: Record<string, unknown> = {}) => {
      const t = exact(
        UploadTicket,
        await call('post', '/me/documents/uploads', who, {
          ...facts(bytes),
          serviceId: ids.e1,
          ...body,
        }),
      );
      storage.objects.set(t.url.slice('memory:'.length), bytes);
      return t;
    };
    const t = await ticketOf(people.primary);
    const confirm = (who: Person, uploadToken: string) =>
      call('post', '/me/documents/uploads/confirm', who, { uploadToken });
    expectError(await confirm(people.spouse, t.uploadToken), 410, 'UPLOAD_EXPIRED');
    expectError(
      await call('post', '/documents/uploads/confirm', people.ownerA, {
        uploadToken: t.uploadToken,
      }),
      410,
      'UPLOAD_EXPIRED',
    );
    expectError(await confirm(people.clientB, t.uploadToken), 404, 'NOT_FOUND'); // no login at firm A
    // A login made AUTHORIZED after its ticket may no longer upload without a request: 403, deleted.
    const t2 = await ticketOf(people.spouse);
    const setRole = (portalRole: 'SPOUSE' | 'AUTHORIZED') =>
      asOwner(firms.a.id, (tx) =>
        tx.clientAccount.update({ where: { id: accounts.spouse }, data: { portalRole } }),
      );
    await setRole('AUTHORIZED');
    try {
      expectError(await confirm(people.spouse, t2.uploadToken), 403, 'FORBIDDEN');
      expect(storage.objects.has(t2.url.slice('memory:'.length))).toBe(false);
    } finally {
      await setRole('SPOUSE');
    }
    exact(MyDocument, await confirm(people.primary, t.uploadToken));
    expectError(await confirm(people.primary, t.uploadToken), 410, 'UPLOAD_EXPIRED');
  });
});

describe('portal lists, views and downloads', () => {
  it('shows the household the firm shared files, never INTERNAL ones, and AUTHORIZED no FIRM files', async () => {
    const shared = await firmFile({ shareWithClient: true, fileName: 'Engagement_Letter.pdf' });
    const internal = await firmFile({ fileName: 'Worksheet.pdf' });
    const firm = await myList(people.primary, '?source=FIRM');
    expect(firm.items.map((d) => d.id)).toContain(shared.id);
    expect(firm.items.map((d) => d.id)).not.toContain(internal.id);
    const item = firm.items.find((d) => d.id === shared.id);
    expect([item?.source, item?.uploadedBy]).toEqual(['FIRM', null]); // no staff names
    expect((await myList(people.primary)).items.map((d) => d.id)).not.toContain(shared.id);
    expect(await myList(people.authorized, '?source=FIRM')).toEqual({
      items: [],
      nextCursor: null,
      years: [],
    });
    for (const who of [people.primary, people.authorized, people.other]) {
      expectError(await call('get', `/me/documents/${internal.id}`, who), 404, 'NOT_FOUND');
      expectError(
        await call('get', `/me/documents/${internal.id}/download`, who),
        404,
        'NOT_FOUND',
      );
    }
    expectError(
      await call('get', `/me/documents/${shared.id}`, people.authorized),
      404,
      'NOT_FOUND',
    );
    exact(MyDocument, await call('get', `/me/documents/${shared.id}`, people.spouse));
    const viewed = (await auditOf(shared.id)).filter((a) => a.action === 'document.viewed');
    expect(viewed.at(-1)?.metadata).toEqual({ clientId: ids.c1, clientAccountId: accounts.spouse });
  });

  it('keeps client A from client B and firm A from firm B', async () => {
    const doc = await mine(people.primary, {});
    expectError(await call('get', `/me/documents/${doc.id}`, people.other), 404, 'NOT_FOUND');
    expectError(
      await call('get', `/me/documents/${doc.id}/download`, people.other),
      404,
      'NOT_FOUND',
    );
    expect((await myList(people.other)).items).toEqual([]);
    // Client B at firm B: firm A's document is not there; firm A's portal is not theirs.
    expectError(
      await call('get', `/me/documents/${doc.id}`, people.clientB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('get', `/me/documents/${doc.id}/download`, people.clientB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
    expectError(await call('get', '/me/documents', people.clientB), 404, 'NOT_FOUND');
    expectError(
      await call('get', `/me/documents/${doc.id}`, people.primary, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
    // Staff sessions never reach the portal routes (401), clients never the firm's (403).
    expect((await call('get', '/me/documents', people.ownerA)).status).toBe(401);
    expect((await call('get', `/clients/${ids.c1}/documents`, people.primary)).status).toBe(403);
  });

  it('downloads only CLEAN files and says BLOCKED in the words the client may see', async () => {
    const { pending, failedFirm, changed } = await scanned(async () => ({
      pending: await mine(people.primary, { fileName: 'Pending.pdf' }),
      failedFirm: await firmFile({ shareWithClient: true }),
      changed: await mine(people.primary, { fileName: 'Changed.pdf' }),
    }));
    expect(pending.status).toBe('CHECKING');
    expectError(
      await call('get', `/me/documents/${pending.id}/download`, people.primary),
      409,
      'SCAN_PENDING',
    );
    expect(await scan(pending.id, 'THREATS_FOUND')).toBe('INFECTED');
    const blocked = await call('get', `/me/documents/${pending.id}/download`, people.primary);
    expectError(blocked, 409, 'FILE_BLOCKED');
    expect(codeOf(blocked)?.message).toBe(PORTAL_BLOCKED_TEXT.MINE);
    expect(
      exact(MyDocument, await call('get', `/me/documents/${pending.id}`, people.primary)).status,
    ).toBe('BLOCKED');
    expect(await scan(failedFirm.id, 'UNSUPPORTED', ['OBJECT_SIZE_LIMIT_EXCEEDED'])).toBe('FAILED');
    const firmBlocked = await call('get', `/me/documents/${failedFirm.id}/download`, people.spouse);
    expect(codeOf(firmBlocked)?.message).toBe(PORTAL_BLOCKED_TEXT.FIRM);
    // The firm's own words stay the contract's; it sees the exact status.
    expect(
      exact(FirmDocument, await call('get', `/documents/${failedFirm.id}`, people.ownerA))
        .scanStatus,
    ).toBe('FAILED');
    // A stored object that is no longer the confirmed one is FILE_BLOCKED, as on the firm side.
    expect(await scan(changed.id, 'NO_THREATS_FOUND')).toBe('CLEAN');
    const key = await keyOf(changed.id);
    const original = storage.objects.get(key)!;
    storage.objects.set(key, Buffer.concat([original, Buffer.from(' ')]));
    expect(
      codeOf(await call('get', `/me/documents/${changed.id}/download`, people.primary))?.message,
    ).toBe(PORTAL_BLOCKED_TEXT.MINE);
    storage.objects.set(key, original);
    const link = await call('get', `/me/documents/${changed.id}/download`, people.spouse);
    expect(link.status, JSON.stringify(link.body)).toBe(200);
    const issued = (await auditOf(changed.id)).filter(
      (a) => a.action === 'document.download_link_issued',
    );
    expect(issued.at(-1)?.metadata).toMatchObject({
      clientId: ids.c1,
      clientAccountId: accounts.spouse,
    });
  });

  it('filters, sorts by name, pages and lists the source years; 400 for a bad cursor or search', async () => {
    for (const fileName of ['b-sorted.pdf', 'a-sorted.pdf', 'c-sorted.pdf']) {
      await mine(people.spouse, { fileName, taxYear: 2024 });
    }
    const page1 = await myList(people.primary, '?sort=name&search=-sorted&limit=2');
    expect(page1.items.map((d) => d.fileName)).toEqual(['a-sorted.pdf', 'b-sorted.pdf']);
    expect(page1.years).toEqual(expect.arrayContaining([2025, 2024]));
    const page2 = await myList(
      people.primary,
      `?sort=name&search=-sorted&limit=2&cursor=${page1.nextCursor}`,
    );
    expect([page2.items.map((d) => d.fileName), page2.nextCursor]).toEqual([
      ['c-sorted.pdf'],
      null,
    ]);
    const newest = await myList(people.primary, '?search=-sorted&taxYear=2024&limit=1');
    expect(newest.items.map((d) => d.fileName)).toEqual(['c-sorted.pdf']);
    const next = await myList(
      people.primary,
      `?search=-sorted&taxYear=2024&limit=1&cursor=${newest.nextCursor}`,
    );
    expect(next.items.map((d) => d.fileName)).toEqual(['a-sorted.pdf']);
    expect(
      (await myList(people.primary, `?categoryId=${ids.cat}`)).items.every(
        (d) => d.category?.id === ids.cat,
      ),
    ).toBe(true);
    expectError(
      await call('get', '/me/documents?sort=name&cursor=bm9wZQ', people.primary),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('get', '/me/documents?search=a%00b', people.primary),
      400,
      'VALIDATION_FAILED',
    );
    const listed = await asOwner(firms.a.id, (tx) =>
      tx.auditLog.findFirst({
        where: { action: 'documents.listed', entityId: ids.c1 },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(listed?.metadata).toMatchObject({ source: 'MINE', clientAccountId: accounts.primary });
  });

  it('lists the active categories, and the open services with their open requests (STOP: empty)', async () => {
    const categories = exact(
      MyDocumentCategoryList,
      await call('get', '/me/document-categories', people.authorized),
    );
    expect(categories.items.map((c) => c.id)).toEqual([ids.cat]);
    const r = await newRequest({ title: 'Targets', dueOn: '2026-11-30' });
    const targets = exact(
      UploadTargets,
      await call('get', '/me/documents/upload-targets', people.primary),
    );
    expect(targets.tax.map((t) => t.serviceId)).toEqual([ids.e1]);
    expect(targets.business.map((t) => t.serviceId)).toEqual([ids.e1b]);
    expect(targets.tax[0]?.openRequests).toContainEqual({
      id: r.id,
      title: 'Targets',
      dueOn: '2026-11-30',
    });
    // AUTHORIZED: only services with an open request.
    const forAuthorized = exact(
      UploadTargets,
      await call('get', '/me/documents/upload-targets', people.authorized),
    );
    expect([forAuthorized.tax.map((t) => t.serviceId), forAuthorized.business]).toEqual([
      [ids.e1],
      [],
    ]);
    expect(
      exact(UploadTargets, await call('get', '/me/documents/upload-targets', people.stop)),
    ).toEqual({ tax: [], business: [] });
    expectError(
      await call('post', '/me/documents/uploads', people.authorized, {
        ...facts(pdf()),
        serviceId: ids.e1,
      }),
      403,
      'FORBIDDEN',
    );
  });
});

describe('document requests', () => {
  it('creates for an open service and emails the logins; Staff only their clients, firm B nothing', async () => {
    outbox.length = 0;
    const r = await newRequest({
      categoryId: ids.cat,
      dueOn: '2026-12-01',
      instructions: 'One per employer.',
    });
    expect(r).toMatchObject({
      clientId: ids.c1,
      status: 'REQUESTED',
      dueOn: '2026-12-01',
      category: { id: ids.cat },
      requestedBy: { userId: people.ownerA.id, name: people.ownerA.name },
      documents: [],
      resolvedAt: null,
    });
    expect(outbox.map((m) => [m.template, m.to]).sort()).toEqual(
      [people.primary, people.spouse, people.authorized]
        .map((p) => ['document.requested', p.email])
        .sort(),
    );
    const created = (await auditOf(r.id)).find((a) => a.action === 'document_request.created');
    expect(JSON.stringify(created?.metadata)).not.toMatch(/W-2|employer/);
    const create = (
      body: Record<string, unknown>,
      who: Person = people.ownerA,
      clientId = ids.c1,
      firm: Firm = 'a',
    ) =>
      call(
        'post',
        `/clients/${clientId}/document-requests`,
        who,
        { serviceId: ids.e1, title: 'X', ...body },
        firm,
      );
    expectError(await create({ serviceId: ids.e2 }), 404, 'NOT_FOUND');
    expectError(await create({ serviceId: ids.e1p }), 409, 'NO_OPEN_SERVICE');
    expectError(await create({ categoryId: ids.old }), 409, 'CATEGORY_ARCHIVED');
    expectError(await create({}, people.staffA2), 404, 'NOT_FOUND');
    expectError(await create({}, people.ownerB, ids.c1, 'b'), 404, 'NOT_FOUND');
    expect((await create({}, people.primary)).status).toBe(403);
    exact(FirmDocumentRequest, await create({}, people.staffA));

    const list = (who: Person, query = '', firm: Firm = 'a') =>
      call('get', `/clients/${ids.c1}/document-requests${query}`, who, undefined, firm);
    const items = exact(
      FirmDocumentRequestList,
      await list(people.staffA, '?status=REQUESTED'),
    ).items;
    expect(items.map((i) => i.id)).toContain(r.id);
    expect(items.every((i) => i.status === 'REQUESTED')).toBe(true);
    expectError(await list(people.staffA2), 404, 'NOT_FOUND');
    expectError(await list(people.ownerB, '', 'b'), 404, 'NOT_FOUND');
    for (const action of ['accept', 'reject', 'cancel'] as const) {
      expectError(await decide(r.id, action, people.staffA2), 404, 'NOT_FOUND');
      expectError(
        await call(
          'post',
          `/document-requests/${r.id}/${action}`,
          people.ownerB,
          { reason: 'x' },
          'b',
        ),
        404,
        'NOT_FOUND',
      );
    }
    // The portal: client B and another client never see or answer it.
    const theirs = exact(
      MyDocumentRequestList,
      await call('get', '/me/document-requests', people.other),
    );
    expect(theirs.items.map((i) => i.id)).not.toContain(r.id);
    const answer = (who: Person, firm: Firm = 'a') =>
      call('post', `/me/document-requests/${r.id}/not-available`, who, { reason: 'None' }, firm);
    expectError(await answer(people.other), 404, 'NOT_FOUND');
    expectError(await answer(people.clientB, 'b'), 404, 'NOT_FOUND');
    expectError(await answer(people.authorized), 403, 'FORBIDDEN');
  });

  it('accepts only a CLEAN newest file: NOTHING_SUBMITTED, SCAN_PENDING, then ACCEPTED and closed', async () => {
    const r = await newRequest();
    expectError(await decide(r.id, 'accept'), 409, 'NOTHING_SUBMITTED');
    expectError(await decide(r.id, 'reject'), 409, 'NOTHING_SUBMITTED');
    const doc = await scanned(() => mine(people.primary, { requestId: r.id }));
    expectError(await decide(r.id, 'accept'), 409, 'SCAN_PENDING');
    expect(await scan(doc.id, 'NO_THREATS_FOUND')).toBe('CLEAN');
    const accepted = exact(FirmDocumentRequest, await decide(r.id, 'accept', people.staffA));
    expect(accepted).toMatchObject({ status: 'ACCEPTED', documents: [{ id: doc.id }] });
    expect(accepted.resolvedAt).not.toBeNull();
    for (const action of ['accept', 'reject', 'cancel'] as const) {
      expectError(await decide(r.id, action), 409, 'REQUEST_CLOSED');
    }
    expectError(
      await call('post', `/me/document-requests/${r.id}/not-available`, people.primary, {
        reason: 'x',
      }),
      409,
      'REQUEST_CLOSED',
    );
    const entry = (await auditOf(r.id)).find((a) => a.action === 'document_request.accepted');
    expect(entry?.metadata).toEqual({ clientId: ids.c1, from: 'SUBMITTED', documentId: doc.id });
  });

  it('marks missing (the client sees why and answers again), takes "I don\'t have this", cancels', async () => {
    const r = await newRequest();
    await mine(people.spouse, { requestId: r.id });
    const rejected = exact(FirmDocumentRequest, await decide(r.id, 'reject'));
    expect([rejected.status, rejected.statusNote]).toEqual(['REJECTED', 'Pages are missing']);
    const seen = exact(
      MyDocumentRequestList,
      await call('get', '/me/document-requests', people.authorized),
    );
    expect(seen.items.find((i) => i.id === r.id)).toMatchObject({
      status: 'REJECTED',
      statusNote: 'Pages are missing',
    });
    // Open again: a new upload answers it, and the old reason goes.
    await mine(people.primary, { requestId: r.id });
    expect(await requestRow(r.id)).toMatchObject({ status: 'SUBMITTED', statusNote: null });
    exact(FirmDocumentRequest, await decide(r.id, 'reject'));
    const na = exact(
      MyDocumentRequest,
      await call('post', `/me/document-requests/${r.id}/not-available`, people.spouse, {
        reason: 'We had none',
      }),
    );
    expect([na.status, na.statusNote]).toEqual(['NOT_AVAILABLE', 'We had none']);
    expectError(
      await call('post', `/me/document-requests/${r.id}/not-available`, people.primary, {
        reason: 'x',
      }),
      409,
      'REQUEST_CLOSED',
    );
    expectError(
      (await upload(people.primary, { serviceId: ids.e1, requestId: r.id })).res,
      409,
      'REQUEST_CLOSED',
    );
    expectError(await decide(r.id, 'accept'), 409, 'NOTHING_SUBMITTED');
    // AUTHORIZED sees only open requests; the household sees the answered one too.
    expect(
      exact(
        MyDocumentRequestList,
        await call('get', '/me/document-requests', people.authorized),
      ).items.map((i) => i.id),
    ).not.toContain(r.id);
    expect(
      exact(
        MyDocumentRequestList,
        await call('get', '/me/document-requests', people.primary),
      ).items.map((i) => i.id),
    ).toContain(r.id);
    const cancelled = exact(FirmDocumentRequest, await decide(r.id, 'cancel'));
    expect(cancelled.status).toBe('CANCELLED');
    expectError(await decide(r.id, 'cancel'), 409, 'REQUEST_CLOSED');
    expect(
      exact(
        MyDocumentRequestList,
        await call('get', '/me/document-requests', people.primary),
      ).items.map((i) => i.id),
    ).not.toContain(r.id);
    const actions = (await auditOf(r.id)).map((a) => a.action);
    expect(actions).toEqual([
      'document_request.created',
      'document_request.submitted',
      'document_request.rejected',
      'document_request.submitted',
      'document_request.rejected',
      'document_request.not_available',
      'document_request.cancelled',
    ]);
    const answered = (await auditOf(r.id)).find(
      (a) => a.action === 'document_request.not_available',
    );
    expect(answered?.metadata).toEqual({
      clientId: ids.c1,
      from: 'REJECTED',
      clientAccountId: accounts.spouse,
    });
  });

  it('lists open requests first for the household', async () => {
    const items = exact(
      MyDocumentRequestList,
      await call('get', '/me/document-requests', people.primary),
    ).items;
    const open = items.map((i) => ['REQUESTED', 'REJECTED'].includes(i.status));
    expect(open).toEqual([...open].sort((a, b) => Number(b) - Number(a)));
    expect(items.some((i) => i.status === 'CANCELLED')).toBe(false);
  });

  it('takes no "I don\'t have this" from an archived client: 404 first, then NO_OPEN_SERVICE', async () => {
    const r = await newRequest();
    const theirs = exact(
      FirmDocumentRequest,
      await call('post', `/clients/${ids.c2}/document-requests`, people.ownerA, {
        serviceId: ids.e2,
        title: 'Their W-2',
      }),
    );
    const answer = (id: string) =>
      call('post', `/me/document-requests/${id}/not-available`, people.primary, {
        reason: 'We had none',
      });
    const setArchived = (archivedAt: Date | null) =>
      asOwner(firms.a.id, (tx) =>
        tx.client.update({ where: { id: ids.c1 }, data: { archivedAt } }),
      );
    await setArchived(new Date());
    try {
      expectError(await answer(theirs.id), 404, 'NOT_FOUND');
      expectError(await answer(r.id), 409, 'NO_OPEN_SERVICE');
    } finally {
      await setArchived(null);
    }
    expect(await requestRow(r.id)).toMatchObject({ status: 'REQUESTED', statusNote: null });
    expect((await auditOf(r.id)).map((a) => a.action)).toEqual(['document_request.created']);
    expect(exact(MyDocumentRequest, await answer(r.id)).status).toBe('NOT_AVAILABLE');
  });

  it('takes one answer per request when two logins confirm at once (the request lock)', async () => {
    const r = await newRequest();
    const ticketOf = async (who: Person, label: string) => {
      const bytes = pdf(label);
      const t = exact(
        UploadTicket,
        await call('post', '/me/documents/uploads', who, {
          ...facts(bytes),
          serviceId: ids.e1,
          requestId: r.id,
        }),
      );
      const key = t.url.slice('memory:'.length);
      storage.objects.set(key, bytes);
      return { who, key, uploadToken: t.uploadToken };
    };
    const tickets = [
      await ticketOf(people.primary, 'race 1'),
      await ticketOf(people.spouse, 'race 2'),
    ];
    const results = await racing(r.id, 2, () =>
      Promise.all(
        tickets.map((t) =>
          call('post', '/me/documents/uploads/confirm', t.who, { uploadToken: t.uploadToken }),
        ),
      ),
    );
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    const refused = results.findIndex((res) => res.status === 409);
    expectError(results[refused]!, 409, 'REQUEST_CLOSED');
    expect(storage.objects.has(tickets[refused]!.key)).toBe(false);
    expect(storage.objects.has(tickets[1 - refused]!.key)).toBe(true);
    const submitted = (await auditOf(r.id)).filter(
      (a) => a.action === 'document_request.submitted',
    );
    expect(submitted).toHaveLength(1);
    expect((await requestRow(r.id)).status).toBe('SUBMITTED');
    const saved = await asOwner(firms.a.id, (tx) =>
      tx.document.count({ where: { requestId: r.id } }),
    );
    expect(saved).toBe(1);
  });

  it('keeps a cancel and a confirm at once consistent', async () => {
    const r = await newRequest();
    const bytes = pdf('cancel race');
    const t = exact(
      UploadTicket,
      await call('post', '/me/documents/uploads', people.primary, {
        ...facts(bytes),
        serviceId: ids.e1,
        requestId: r.id,
      }),
    );
    const key = t.url.slice('memory:'.length);
    storage.objects.set(key, bytes);
    const [cancel, confirm] = await racing(r.id, 2, () =>
      Promise.all([
        decide(r.id, 'cancel'),
        call('post', '/me/documents/uploads/confirm', people.primary, {
          uploadToken: t.uploadToken,
        }),
      ]),
    );
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    expect((await requestRow(r.id)).status).toBe('CANCELLED');
    const actions = (await auditOf(r.id)).map((a) => a.action);
    const saved = await asOwner(firms.a.id, (tx) =>
      tx.document.count({ where: { requestId: r.id } }),
    );
    if (confirm.status === 200) {
      // The upload came first: saved and SUBMITTED, then cancelled.
      expect(actions).toEqual([
        'document_request.created',
        'document_request.submitted',
        'document_request.cancelled',
      ]);
      expect([saved, storage.objects.has(key)]).toEqual([1, true]);
    } else {
      expectError(confirm, 409, 'REQUEST_CLOSED');
      expect(actions).toEqual(['document_request.created', 'document_request.cancelled']);
      expect([saved, storage.objects.has(key)]).toEqual([0, false]);
    }
  });
});

describe('scan results (q22, q24)', () => {
  it('puts a request back to REQUESTED when its newest file ends INFECTED or FAILED', async () => {
    const r = await newRequest();
    const first = await scanned(() => mine(people.primary, { requestId: r.id }));
    expect(await scan(first.id, 'THREATS_FOUND')).toBe('INFECTED');
    expect(await requestRow(r.id)).toMatchObject({ status: 'REQUESTED' });
    expectError(await decide(r.id, 'accept'), 409, 'NOTHING_SUBMITTED');
    const reopened = (await auditOf(r.id)).find((a) => a.action === 'document_request.reopened');
    expect(reopened?.metadata).toEqual({
      clientId: ids.c1,
      documentId: first.id,
      scanStatus: 'INFECTED',
    });
    const targets = exact(
      UploadTargets,
      await call('get', '/me/documents/upload-targets', people.authorized),
    );
    expect(targets.tax[0]?.openRequests.map((o) => o.id)).toContain(r.id);
    // A result is set once.
    expect(await scan(first.id, 'NO_THREATS_FOUND')).toBe('IGNORED');

    // An older file's result never reopens a request a newer file answers.
    const second = await scanned(() => mine(people.primary, { requestId: r.id }));
    exact(FirmDocumentRequest, await decide(r.id, 'reject'));
    const third = await scanned(() => mine(people.primary, { requestId: r.id }));
    expect(await scan(second.id, 'UNSUPPORTED', ['EXTRACTED_FILE_COUNT_LIMIT_EXCEEDED'])).toBe(
      'FAILED',
    );
    expect((await requestRow(r.id)).status).toBe('SUBMITTED');
    expect(await scan(third.id, 'UNSUPPORTED', ['PASSWORD_PROTECTED'])).toBe('UNSCANNED');
    exact(FirmDocumentRequest, await decide(r.id, 'accept'));
  });

  it('reopens only a SUBMITTED request: cancelled, missing and "I don\'t have this" stay', async () => {
    const [cancelled, missing, none] = [await newRequest(), await newRequest(), await newRequest()];
    const files = await scanned(async () => [
      await mine(people.primary, { requestId: cancelled.id }),
      await mine(people.primary, { requestId: missing.id }),
      await mine(people.primary, { requestId: none.id }),
    ]);
    exact(FirmDocumentRequest, await decide(cancelled.id, 'cancel'));
    exact(FirmDocumentRequest, await decide(missing.id, 'reject'));
    exact(FirmDocumentRequest, await decide(none.id, 'reject'));
    exact(
      MyDocumentRequest,
      await call('post', `/me/document-requests/${none.id}/not-available`, people.primary, {
        reason: 'We had none',
      }),
    );
    for (const file of files) expect(await scan(file.id, 'THREATS_FOUND')).toBe('INFECTED');
    expect(await requestRow(cancelled.id)).toMatchObject({ status: 'CANCELLED' });
    expect(await requestRow(missing.id)).toMatchObject({
      status: 'REJECTED',
      statusNote: 'Pages are missing',
    });
    expect(await requestRow(none.id)).toMatchObject({
      status: 'NOT_AVAILABLE',
      statusNote: 'We had none',
    });
    for (const r of [cancelled, missing, none]) {
      const actions = (await auditOf(r.id)).map((a) => a.action);
      expect(actions).not.toContain('document_request.reopened');
    }
  });

  it('answers UNKNOWN (for redelivery) to a result that comes before the confirm, then records it', async () => {
    const r = await newRequest();
    const bytes = pdf('early result');
    const t = await scanned(async () =>
      exact(
        UploadTicket,
        await call('post', '/me/documents/uploads', people.primary, {
          ...facts(bytes),
          serviceId: ids.e1,
          requestId: r.id,
        }),
      ),
    );
    const key = t.url.slice('memory:'.length);
    storage.objects.set(key, bytes);
    expect(await scans.recordScanResult({ key, status: 'NO_THREATS_FOUND' })).toBe('UNKNOWN');
    const doc = await scanned(async () =>
      exact(
        MyDocument,
        await call('post', '/me/documents/uploads/confirm', people.primary, {
          uploadToken: t.uploadToken,
        }),
      ),
    );
    expect(doc.status).toBe('CHECKING');
    expectError(await decide(r.id, 'accept'), 409, 'SCAN_PENDING');
    // The redelivered message.
    expect(await scans.recordScanResult({ key, status: 'NO_THREATS_FOUND' })).toBe('CLEAN');
    exact(FirmDocumentRequest, await decide(r.id, 'accept'));
  });

  it('accepts a password-protected PDF unscanned, fails other file reasons, and waits on our side', async () => {
    const { pdfFile, docx, ours, denied } = await scanned(async () => ({
      pdfFile: await mine(people.primary, {}),
      docx: await mine(
        people.primary,
        { fileName: 'Lease.docx', contentType: DOCX },
        office('docx'),
      ),
      ours: await mine(people.primary, {}),
      denied: await mine(people.primary, {}),
    }));
    expect(await scan(pdfFile.id, 'UNSUPPORTED', ['PASSWORD_PROTECTED'])).toBe('UNSCANNED');
    expect(
      exact(MyDocument, await call('get', `/me/documents/${pdfFile.id}`, people.primary)).status,
    ).toBe('READY');
    const entry = (await auditOf(pdfFile.id)).find((a) => a.action === 'document.scanned');
    expect(entry?.metadata).toEqual({
      clientId: ids.c1,
      scanStatus: 'CLEAN',
      result: 'UNSUPPORTED',
      reasons: ['PASSWORD_PROTECTED'],
      unscanned: true,
    });
    expect(await scan(docx.id, 'UNSUPPORTED', ['PASSWORD_PROTECTED'])).toBe('FAILED');
    expect(await scan(ours.id, 'UNSUPPORTED', ['UNSUPPORTED_STORAGE_CLASS'])).toBe('PENDING');
    expect(await scan(denied.id, 'ACCESS_DENIED')).toBe('PENDING');
    expect(await scan(denied.id, 'FAILED')).toBe('PENDING');
    const pending = await asOwner(firms.a.id, (tx) =>
      tx.document.findMany({
        where: { id: { in: [ours.id, denied.id] } },
        select: { scanStatus: true },
      }),
    );
    expect(pending.map((d) => d.scanStatus)).toEqual(['PENDING', 'PENDING']);
    // Found by the key in its own firm only: firm B's prefix with firm A's object has no
    // document there (UNKNOWN, firm A's file untouched); a key outside the prefixes is IGNORED.
    const key = await keyOf(ours.id);
    const elsewhere = key.replace(firms.a.id, firms.b.id);
    expect(await scans.recordScanResult({ key: elsewhere, status: 'THREATS_FOUND' })).toBe(
      'UNKNOWN',
    );
    const ignored = ['not-a-key', `${key}/x`, key.replace('/documents/', '/other/')];
    for (const k of ignored) {
      expect(await scans.recordScanResult({ key: k, status: 'THREATS_FOUND' })).toBe('IGNORED');
    }
    const untouched = await asOwner(firms.a.id, (tx) =>
      tx.document.findUniqueOrThrow({ where: { id: ours.id }, select: { scanStatus: true } }),
    );
    expect(untouched.scanStatus).toBe('PENDING');
  });
});
