// End-to-end: R5 part 1, the firm's documents (contract in packages/types/src/documents).
// Uploads in three calls with confirm's checks (size, checksum, type; Excel and Word as
// packages), SCAN_MODE, lists, views and downloads, the roles (Staff: assigned clients only),
// isolation between firms, and the audit (ids only). The portal routes come in part 2. Storage
// is an in-memory DocumentStorage here (CI has no s3mock); the S3 adapter itself is tested in
// test/unit/documents.test.ts.
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
  DocumentCategoryList,
  FirmDocument,
  FirmDocumentList,
  UploadTicket,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig } from '../../src/storage/config.js';
import { DOCUMENT_STORAGE, type DocumentStorage } from '../../src/storage/document-storage.js';
import { UploadTokens } from '../../src/storage/upload-token.js';
import { CHECKS_AT_ONCE } from '../../src/storage/uploads.service.js';
import { cfb, DOCX, office, pdf, png, sha256, XLSX } from '../office-files.js';

/** Storage in memory: `put(ticket, bytes)` is the browser's PUT. */
class MemoryStorage implements DocumentStorage {
  readonly objects = new Map<string, Buffer>();
  /** A Content-Encoding stored with an object (a repeated PUT could set one). */
  readonly encodings = new Map<string, string>();
  /** What every HEAD fails with while set (S3's 503 SlowDown). */
  headError: unknown = null;
  /** What a HEAD with the checksum fails with while set (S3's 403 without kms:Decrypt). */
  checksumError: unknown = null;
  /** What reads fail with while set (S3's 403 when kms:Decrypt is missing). */
  readError: unknown = null;
  /** Awaited after a HEAD and after a read, to hold a confirm there. */
  afterHead: (() => Promise<void>) | null = null;
  afterRead: (() => Promise<void>) | null = null;
  presignUpload(file: { key: string; contentType: string }) {
    const headers = { 'content-type': file.contentType };
    return Promise.resolve({ url: `memory:${file.key}`, headers });
  }
  async head(key: string, { checksum = false } = {}) {
    if (this.headError) throw this.headError;
    if (checksum && this.checksumError) throw this.checksumError;
    const b = this.objects.get(key);
    const found = b && {
      sizeBytes: b.length,
      sha256: checksum ? sha256(b) : null,
      contentEncoding: this.encodings.get(key) ?? null,
    };
    await this.afterHead?.();
    return found ?? null;
  }
  async read(key: string) {
    if (this.readError) throw this.readError;
    const found = this.objects.get(key) ?? null;
    await this.afterRead?.();
    return found;
  }
  remove(key: string) {
    this.objects.delete(key);
    return Promise.resolve();
  }
  presignDownload(file: { key: string }) {
    return Promise.resolve(`memory:${file.key}?download`);
  }
  put(ticket: UploadTicket, bytes: Buffer) {
    this.objects.set(ticket.url.slice('memory:'.length), bytes);
  }
}
const storage = new MemoryStorage();
/** An error as the S3 client throws it. */
const s3Error = (name: string, httpStatusCode: number) =>
  Object.assign(new Error(name), { name, $metadata: { httpStatusCode } });
/** A promise the test resolves when it wants. */
function gate() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}
/** Holds the next confirm at `hook` (once); `reached` resolves when it got there. */
function holdNext(hook: 'afterHead' | 'afterRead') {
  const reached = gate();
  const release = gate();
  storage[hook] = async () => {
    storage[hook] = null;
    reached.open();
    await release.opened;
  };
  return { reached: reached.opened, release: release.open };
}
const config: DocumentsConfig = {
  bucket: 'unused',
  region: 'us-east-1',
  forcePathStyle: true,
  scanMode: 'local',
};

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string, pool: 'STAFF' | 'CLIENT' = 'STAFF') => ({
  id: randomUUID(),
  email: `r5d-${key}-${run}@r5.test`,
  name: `Fake R5 ${key}`,
  pool,
});
const people = {
  ownerA: person('owner-a'),
  staffA: person('staff-a'),
  staffA2: person('staff-a2'),
  ownerB: person('owner-b'),
  clientA: person('client-a', 'CLIENT'),
};
type Person = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', { id: string; slug: string }>;
/** c1 is staffA's (with clientA's login), c2 nobody's, cB firm B's; e1p is PENDING. */
const ids = {} as Record<
  'c1' | 'c2' | 'cB' | 'e1' | 'e1b' | 'e1p' | 'e2' | 'eB' | 'cat' | 'old',
  string
>;

let app: INestApplication;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.51.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

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

/** A firm call (Bearer: no cookie, so no Origin needed). */
async function call(
  method: 'get' | 'post',
  path: string,
  who: Person,
  body?: object,
  firm: 'a' | 'b' = 'a',
) {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', firms[firm].id)
    .set('authorization', `Bearer ${await tokenFor(who)}`)
    .set('x-forwarded-for', viewer());
  return body === undefined ? req : req.send(body);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
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
/** Step 1, the PUT of `stored` (the described bytes unless given) and step 3; or step 1's error. */
async function upload(
  who: Person,
  body: Record<string, unknown>,
  bytes: Buffer,
  { stored = bytes, clientId = ids.c1, firm = 'a' as 'a' | 'b' } = {},
) {
  const described = facts(bytes, body['fileName'] as string, body['contentType'] as string);
  const path = `/clients/${clientId}/documents/uploads`;
  const start = await call('post', path, who, { ...described, ...body }, firm);
  if (start.status !== 200) return { res: start, key: '' };
  const ticket = exact(UploadTicket, start);
  storage.put(ticket, stored);
  const { uploadToken } = ticket;
  const res = await call('post', '/documents/uploads/confirm', who, { uploadToken }, firm);
  return { res, key: ticket.url.slice('memory:'.length) };
}
const firmDoc = async (who: Person, body: Record<string, unknown>, bytes: Buffer = pdf()) =>
  exact(FirmDocument, (await upload(who, { serviceId: ids.e1, ...body }, bytes)).res);
const refusalsOf = (key: string) =>
  asOwner(firms.a.id, (tx) =>
    tx.auditLog.findMany({
      where: {
        action: 'document.upload_refused',
        metadata: { path: ['uploadId'], equals: key.slice(key.lastIndexOf('/') + 1) },
      },
      orderBy: { createdAt: 'asc' },
    }),
  );
const refusalOf = (key: string) =>
  asOwner(firms.a.id, (tx) =>
    tx.auditLog.findFirst({
      where: {
        action: 'document.upload_refused',
        metadata: { path: ['uploadId'], equals: key.slice(key.lastIndexOf('/') + 1) },
      },
    }),
  );
const auditOf = (entityId: string) =>
  asOwner(firms.a.id, (tx) =>
    tx.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } }),
  );

beforeAll(async () => {
  await asOwner(null, async (tx) => {
    for (const { id, pool, email, name } of Object.values(people)) {
      await tx.user.create({ data: { id, cognitoSub: id, pool, email, name } });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r5d-${key}-${run}`;
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
  const setUp = (firm: 'a' | 'b') => {
    const businessId = firms[firm].id;
    return asOwner(businessId, async (tx) => {
      const client = (assignedUserId: string | null = null) =>
        tx.client
          .create({ data: { businessId, displayName: 'R5 Client (fake)', assignedUserId } })
          .then((c) => c.id);
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
        ids.eB = await engagement(ids.cB, tax);
        return;
      }
      [ids.c1, ids.c2] = [await client(people.staffA.id), await client()];
      const { id: userId, email } = people.clientA;
      await tx.clientAccount.create({
        data: { businessId, userId, email, clientId: ids.c1, status: 'ACTIVE' },
      });
      ids.e1 = await engagement(ids.c1, tax);
      ids.e1b = await engagement(ids.c1, await service('BOOKKEEPING'));
      ids.e1p = await engagement(ids.c1, tax, 'PENDING');
      ids.e2 = await engagement(ids.c2, tax);
      const category = (name: string, archivedAt: Date | null) =>
        tx.documentCategory
          .create({ data: { businessId, name, retentionYears: 7, archivedAt } })
          .then((c) => c.id);
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
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('firm uploads and confirm', () => {
  it('stores a firm file under the firm prefix, INTERNAL unless shared, CLEAN with SCAN_MODE=local', async () => {
    const { res, key } = await upload(
      people.ownerA,
      { serviceId: ids.e1, categoryId: ids.cat },
      pdf(),
    );
    const doc = exact(FirmDocument, res);
    expect(key).toMatch(new RegExp(`^tenant/${firms.a.id}/documents/[0-9a-f-]{36}$`));
    expect(doc).toMatchObject({
      clientId: ids.c1,
      service: { id: ids.e1 },
      category: { id: ids.cat, name: 'Tax Documents' },
      direction: 'INTERNAL',
      scanStatus: 'CLEAN',
      uploadedBy: { name: people.ownerA.name, byClient: false },
    });
    const shared = await firmDoc(people.ownerA, { shareWithClient: true, taxYear: 2024 });
    expect(shared.direction).toBe('FIRM_TO_CLIENT');
    const row = await asOwner(firms.a.id, (tx) =>
      tx.document.findUniqueOrThrow({ where: { id: doc.id } }),
    );
    expect(row).toMatchObject({ s3Key: key, uploadedByUserId: people.ownerA.id });
    expect(row.retentionUntil?.getUTCFullYear()).toBe(new Date().getUTCFullYear() + 7);
  });

  it('checks the service and category first: 404, then NO_OPEN_SERVICE or CATEGORY_ARCHIVED', async () => {
    const start = async (body: Record<string, unknown>, clientId = ids.c1) =>
      (await upload(people.ownerA, body, pdf(), { clientId })).res;
    expectError(await start({ serviceId: ids.e2 }), 404, 'NOT_FOUND');
    expectError(await start({ serviceId: ids.e1, categoryId: randomUUID() }), 404, 'NOT_FOUND');
    expectError(await start({ serviceId: ids.e1p }), 409, 'NO_OPEN_SERVICE');
    expectError(await start({ serviceId: ids.e1, categoryId: ids.old }), 409, 'CATEGORY_ARCHIVED');
    const xlsm = {
      serviceId: ids.e1,
      fileName: 'Budget.xlsm',
      contentType: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    };
    expectError(await start(xlsm), 400, 'VALIDATION_FAILED');
  });

  it('refuses stored bytes that are not the file described, and deletes them', async () => {
    const cases: [string, Buffer, Buffer, string, string][] = [
      ['other size', pdf(), pdf('longer bytes'), 'application/pdf', 'UPLOAD_MISMATCH'],
      ['other checksum', pdf('aaaa'), pdf('bbbb'), 'application/pdf', 'UPLOAD_MISMATCH'],
      ['a PDF sent as a PNG', pdf(), pdf(), 'image/png', 'UPLOAD_MISMATCH'],
      [
        'an .xlsx with macros',
        office('xlsx', (p) => [...p, { name: 'xl/vbaProject.bin', data: 'x' }]),
        Buffer.alloc(0),
        XLSX,
        'FILE_HAS_MACROS',
      ],
      [
        'a password-protected .docx',
        cfb(['EncryptedPackage']),
        Buffer.alloc(0),
        DOCX,
        'FILE_PASSWORD_PROTECTED',
      ],
      ['an old .doc renamed', cfb(['WordDocument']), Buffer.alloc(0), DOCX, 'UPLOAD_MISMATCH'],
      ['an .xlsx sent as Word', office('xlsx'), Buffer.alloc(0), DOCX, 'UPLOAD_MISMATCH'],
    ];
    for (const [why, described, stored, contentType, code] of cases) {
      const fileName =
        { 'image/png': 'a.png', [XLSX]: 'a.xlsx', [DOCX]: 'a.docx' }[contentType] ?? 'a.pdf';
      const { res, key } = await upload(
        people.ownerA,
        { serviceId: ids.e1, fileName, contentType },
        described,
        {
          stored: stored.length ? stored : described,
        },
      );
      expectError(res, 409, code);
      expect(storage.objects.has(key), why).toBe(false);
      const entry = await refusalOf(key);
      expect(entry?.metadata, why).toMatchObject({ code });
      expect(JSON.stringify(entry?.metadata)).not.toMatch(/a\.(pdf|png|xlsx|docx)|tenant\//);
    }
    for (const [kind, type] of [
      ['xlsx', XLSX],
      ['docx', DOCX],
    ] as const) {
      const doc = await firmDoc(
        people.ownerA,
        { fileName: `Synthetic.${kind}`, contentType: type },
        office(kind),
      );
      expect(doc.contentType).toBe(type);
    }
  });

  it('confirms once, only for the member and firm the ticket was made for, and never late', async () => {
    const bytes = png();
    const body = { serviceId: ids.e1, ...facts(bytes, 'scan.png', 'image/png') };
    const ticket = exact(
      UploadTicket,
      await call('post', `/clients/${ids.c1}/documents/uploads`, people.ownerA, body),
    );
    storage.put(ticket, bytes);
    const confirm = (who: Person, uploadToken = ticket.uploadToken) =>
      call('post', '/documents/uploads/confirm', who, { uploadToken });
    expectError(await confirm(people.staffA), 410, 'UPLOAD_EXPIRED');
    expectError(await confirm(people.ownerB), 404, 'NOT_FOUND'); // not a member of firm A
    expectError(
      await call(
        'post',
        '/documents/uploads/confirm',
        people.ownerB,
        { uploadToken: ticket.uploadToken },
        'b',
      ),
      410,
      'UPLOAD_EXPIRED',
    );
    expectError(
      await confirm(people.ownerA, `${ticket.uploadToken.slice(0, -2)}xx`),
      410,
      'UPLOAD_EXPIRED',
    );
    exact(FirmDocument, await confirm(people.ownerA));
    expectError(await confirm(people.ownerA), 410, 'UPLOAD_EXPIRED');

    const sealed = (await app.get(UploadTokens).open(ticket.uploadToken, 'STAFF'))!.value;
    const late = await app
      .get(UploadTokens)
      .sealUntil(
        { ...sealed, key: `tenant/${firms.a.id}/documents/${randomUUID()}` },
        Math.floor(Date.now() / 1000) - 1,
      );
    expectError(await confirm(people.ownerA, late), 410, 'UPLOAD_EXPIRED');
  });
});

describe('confirm after the ticket: the client, the service or storage changed', () => {
  /** Step 1 and the PUT; the test confirms. */
  async function ticketed(who: Person, body: Record<string, unknown>, clientId = ids.c1) {
    const bytes = pdf('ticketed');
    const path = `/clients/${clientId}/documents/uploads`;
    const ticket = exact(UploadTicket, await call('post', path, who, { ...facts(bytes), ...body }));
    storage.put(ticket, bytes);
    const { uploadToken } = ticket;
    return {
      key: ticket.url.slice('memory:'.length),
      confirm: () => call('post', '/documents/uploads/confirm', who, { uploadToken }),
    };
  }
  const expectRefused = async (key: string, code: string) => {
    expect(storage.objects.has(key), code).toBe(false);
    expect((await refusalOf(key))?.metadata, code).toMatchObject({ code });
  };
  const setClient = (id: string, data: { assignedUserId?: string; archivedAt?: Date | null }) =>
    asOwner(firms.a.id, (tx) =>
      tx.client.update({ where: { businessId_id: { businessId: firms.a.id, id } }, data }),
    );

  it('deletes and audits the upload when the service closed before confirm', async () => {
    const businessId = firms.a.id;
    const closing = await asOwner(businessId, async (tx) => {
      const { serviceId } = await tx.engagement.findUniqueOrThrow({ where: { id: ids.e1 } });
      const data = { businessId, clientId: ids.c1, serviceId, title: 'R5 closing (fake)' };
      return (await tx.engagement.create({ data: { ...data, status: 'ACTIVE' } })).id;
    });
    const { key, confirm } = await ticketed(people.ownerA, { serviceId: closing });
    await asOwner(businessId, (tx) =>
      tx.engagement.update({
        where: { id: closing },
        data: { status: 'COMPLETED', completedAt: new Date() },
      }),
    );
    expectError(await confirm(), 409, 'NO_OPEN_SERVICE');
    await expectRefused(key, 'NO_OPEN_SERVICE');
    // The file is gone: a missing file is UPLOAD_MISMATCH (the yaml), and nothing is saved.
    expectError(await confirm(), 409, 'UPLOAD_MISMATCH');
  });

  it('deletes and audits the upload when the client went to someone else or was archived', async () => {
    const moved = await ticketed(people.staffA, { serviceId: ids.e1 });
    await setClient(ids.c1, { assignedUserId: people.staffA2.id });
    try {
      expectError(await moved.confirm(), 404, 'NOT_FOUND');
    } finally {
      await setClient(ids.c1, { assignedUserId: people.staffA.id });
    }
    await expectRefused(moved.key, 'NOT_FOUND');

    const archived = await ticketed(people.ownerA, { serviceId: ids.e2 }, ids.c2);
    await setClient(ids.c2, { archivedAt: new Date() });
    try {
      expectError(await archived.confirm(), 409, 'NO_OPEN_SERVICE');
      const start = await call('post', `/clients/${ids.c2}/documents/uploads`, people.ownerA, {
        ...facts(pdf()),
        serviceId: ids.e2,
      });
      expectError(start, 409, 'NO_OPEN_SERVICE');
    } finally {
      await setClient(ids.c2, { archivedAt: null });
    }
    await expectRefused(archived.key, 'NO_OPEN_SERVICE');
  });

  it('lets one of two confirms at once through and keeps its file', async () => {
    const { key, confirm } = await ticketed(people.ownerA, { serviceId: ids.e1 });
    const results = await Promise.all([confirm(), confirm()]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 410]);
    expect(storage.objects.has(key)).toBe(true);
    expect(await refusalOf(key)).toBeNull();
  });

  const expectUnavailable = (res: Response) => {
    expectError(res, 503, 'SERVICE_UNAVAILABLE');
    expect(res.headers['retry-after']).toBe('5');
  };
  const download = (id: string) => call('get', `/documents/${id}/download`, people.ownerA);

  it('answers 503 with Retry-After and deletes nothing when storage fails (S3 503, KMS 403)', async () => {
    const { key, confirm } = await ticketed(people.ownerA, { serviceId: ids.e1 });
    storage.headError = s3Error('SlowDown', 503);
    try {
      expectUnavailable(await confirm());
    } finally {
      storage.headError = null;
    }
    storage.readError = s3Error('AccessDenied', 403);
    try {
      expectUnavailable(await confirm());
    } finally {
      storage.readError = null;
    }
    expect(storage.objects.has(key)).toBe(true);
    expect(await refusalOf(key)).toBeNull();
    // Confirm never asks S3 for its checksum (on SSE-KMS that needs kms:Decrypt), so a KMS 403
    // there can't make a good upload look missing; a download, which asks, is 503.
    storage.checksumError = s3Error('AccessDenied', 403);
    try {
      const doc = exact(FirmDocument, await confirm());
      expectUnavailable(await download(doc.id));
      storage.headError = s3Error('SlowDown', 503);
      expectUnavailable(await download(doc.id));
    } finally {
      storage.checksumError = null;
      storage.headError = null;
    }
    expect(storage.objects.has(key)).toBe(true);
  });

  it('never deletes a saved file: a refusal takes the key lock and finds the document', async () => {
    const bytes = pdf('late put');
    const path = `/clients/${ids.c1}/documents/uploads`;
    const body = { serviceId: ids.e1, ...facts(bytes) };
    const ticket = exact(UploadTicket, await call('post', path, people.ownerA, body));
    const key = ticket.url.slice('memory:'.length);
    const { uploadToken } = ticket;
    const confirm = () =>
      call('post', '/documents/uploads/confirm', people.ownerA, { uploadToken });
    // The first confirm finds no object yet and is held before it refuses.
    const held = holdNext('afterHead');
    const first = confirm();
    await held.reached;
    storage.put(ticket, bytes);
    const doc = exact(FirmDocument, await confirm());
    held.release();
    expectError(await first, 410, 'UPLOAD_EXPIRED');
    expect(storage.objects.has(key)).toBe(true);
    expect(await refusalOf(key)).toBeNull();
    expect((await download(doc.id)).status).toBe(200);
  });

  it('never deletes a file while a confirm that holds the key lock has not committed', async () => {
    const businessId = firms.a.id;
    const bytes = pdf('uncommitted');
    const path = `/clients/${ids.c1}/documents/uploads`;
    const body = { serviceId: ids.e1, ...facts(bytes) };
    const ticket = exact(UploadTicket, await call('post', path, people.ownerA, body));
    const key = ticket.url.slice('memory:'.length);
    const { uploadToken } = ticket;
    const confirm = () =>
      call('post', '/documents/uploads/confirm', people.ownerA, { uploadToken });
    // #1 finds no object yet and is held before it refuses; then the PUT lands.
    const held = holdNext('afterHead');
    const first = confirm();
    await held.reached;
    storage.put(ticket, bytes);
    const watcher = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
    /** The backend pids that wait for `pid`, polled until there is one (at most 3 s). */
    const waitersOf = async (pid: number, what: string) => {
      for (let i = 0; i < 60; i++) {
        const rows = await watcher.$queryRaw<{ pid: number }[]>`
          SELECT pid FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))`;
        if (rows.length > 0) return rows.map((r) => r.pid);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`Nothing waited: ${what}`);
    };
    const pending: { second?: Promise<Response> } = {};
    try {
      await asOwner(businessId, async (tx) => {
        // The client is locked, so #2 stops inside its transaction, holding the key's lock.
        await tx.$executeRaw`
          SELECT 1 FROM clients WHERE business_id = ${businessId}::uuid AND id = ${ids.c1}::uuid
          FOR UPDATE`;
        const [me] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        pending.second = confirm();
        const [second] = await waitersOf(me!.pid, 'confirm #2 did not reach the client lock');
        // #1 refuses now, and must wait for #2's key lock instead of deleting the file.
        held.release();
        await waitersOf(second!, 'the refusal did not wait for the key lock');
      });
    } finally {
      held.release();
      await watcher.$disconnect();
    }
    const doc = exact(FirmDocument, await pending.second!);
    expectError(await first, 410, 'UPLOAD_EXPIRED');
    expect(storage.objects.has(key)).toBe(true);
    expect(await refusalOf(key)).toBeNull();
    expect((await download(doc.id)).status).toBe(200);
  });

  it('refuses, and audits, a confirm whose upload another confirm refused while it checked', async () => {
    const { key, confirm } = await ticketed(people.ownerA, { serviceId: ids.e2 }, ids.c2);
    // This confirm has checked the file and is held before its transaction.
    const held = holdNext('afterRead');
    const late = confirm();
    await held.reached;
    await setClient(ids.c2, { archivedAt: new Date() });
    try {
      expectError(await confirm(), 409, 'NO_OPEN_SERVICE');
    } finally {
      await setClient(ids.c2, { archivedAt: null });
    }
    held.release();
    // The client is open again, but the file is gone: nothing is saved without it.
    expectError(await late, 409, 'UPLOAD_MISMATCH');
    expect(storage.objects.has(key)).toBe(false);
    const saved = await asOwner(firms.a.id, (tx) =>
      tx.document.findFirst({ where: { s3Key: key } }),
    );
    expect(saved).toBeNull();
    expect((await refusalsOf(key)).map((r) => (r.metadata as { code: string }).code)).toEqual([
      'NO_OPEN_SERVICE',
      'UPLOAD_MISMATCH',
    ]);
  });

  it(`checks at most ${CHECKS_AT_ONCE} files at once: one more is 503 and deletes nothing`, async () => {
    const running: Awaited<ReturnType<typeof ticketed>>[] = [];
    for (let i = 0; i < CHECKS_AT_ONCE; i++) {
      running.push(await ticketed(people.ownerA, { serviceId: ids.e1 }));
    }
    const extra = await ticketed(people.ownerA, { serviceId: ids.e1 });
    const release = gate();
    const all = gate();
    let reading = 0;
    storage.afterRead = async () => {
      if (++reading === CHECKS_AT_ONCE) all.open();
      await release.opened;
    };
    const confirms = running.map((r) => r.confirm());
    try {
      await all.opened;
      expectUnavailable(await extra.confirm());
    } finally {
      storage.afterRead = null;
      release.open();
    }
    for (const res of await Promise.all(confirms)) exact(FirmDocument, res);
    expect(storage.objects.has(extra.key)).toBe(true);
    expect(await refusalOf(extra.key)).toBeNull();
    exact(FirmDocument, await extra.confirm());
  });

  it('refuses a stored file with a Content-Encoding: at confirm (deleted) and at download', async () => {
    const { key, confirm } = await ticketed(people.ownerA, { serviceId: ids.e1 });
    storage.encodings.set(key, 'gzip');
    expectError(await confirm(), 409, 'UPLOAD_MISMATCH');
    await expectRefused(key, 'UPLOAD_MISMATCH');

    const kept = await ticketed(people.ownerA, { serviceId: ids.e1 });
    const doc = exact(FirmDocument, await kept.confirm());
    storage.encodings.set(kept.key, 'gzip');
    expectError(await download(doc.id), 409, 'FILE_BLOCKED');
    storage.encodings.delete(kept.key);
    expect((await download(doc.id)).status).toBe(200);
  });

  it('waits for a category archive that has not committed, then refuses the upload', async () => {
    const businessId = firms.a.id;
    const category = await asOwner(businessId, (tx) =>
      tx.documentCategory.create({ data: { businessId, name: `Waits ${run}` } }),
    );
    const { key, confirm } = await ticketed(people.ownerA, {
      serviceId: ids.e1,
      categoryId: category.id,
    });
    const watcher = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
    const pending: { result?: Promise<Response> } = {};
    try {
      await asOwner(businessId, async (tx) => {
        await tx.documentCategory.update({
          where: { id: category.id },
          data: { archivedAt: new Date() },
        });
        const [me] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        pending.result = confirm();
        // Commit only once the confirm waits for this transaction (at most 3 s).
        for (let i = 0; i < 60; i++) {
          const [waiting] = await watcher.$queryRaw<{ n: number }[]>`
            SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE ${me!.pid}::int = ANY(pg_blocking_pids(pid))`;
          if (waiting!.n > 0) return;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error('The confirm read the category without waiting for the archive');
      });
    } finally {
      await watcher.$disconnect();
    }
    expectError(await pending.result!, 409, 'CATEGORY_ARCHIVED');
    await expectRefused(key, 'CATEGORY_ARCHIVED');
    // Only for this test: the categories list below is the fixture's two.
    await asOwner(businessId, (tx) => tx.documentCategory.delete({ where: { id: category.id } }));
  });
});

describe('firm lists, views and downloads', () => {
  it('lists with the filters and pages, views, links a download and audits ids only', async () => {
    const doc = await firmDoc(people.ownerA, {
      serviceId: ids.e1b,
      fileName: 'Ledger_Q3.pdf',
      taxYear: 2023,
      shareWithClient: true,
    });
    const get = async (q: string) =>
      exact(FirmDocumentList, await call('get', `/clients/${ids.c1}/documents${q}`, people.ownerA));
    const all = await get('');
    expect(all.items[0]?.id).toBe(doc.id);
    expect(all.years).toEqual(expect.arrayContaining([2024, 2023]));
    for (const q of [
      `?serviceId=${ids.e1b}`,
      '?taxYear=2023',
      '?search=ledger_q',
      '?direction=FIRM_TO_CLIENT&taxYear=2023',
    ]) {
      expect(
        (await get(q)).items.map((d) => d.id),
        q,
      ).toEqual([doc.id]);
    }
    expect(
      (await get(`?categoryId=${ids.cat}`)).items.every((d) => d.category?.id === ids.cat),
    ).toBe(true);
    // The database refuses NUL: control characters are a 400, never a 500.
    for (const q of ['?search=%00', '?search=a%00b', '?search=%1F']) {
      expectError(
        await call('get', `/clients/${ids.c1}/documents${q}`, people.ownerA),
        400,
        'VALIDATION_FAILED',
      );
    }
    const first = await get('?limit=1');
    const second = await get(`?limit=1&cursor=${first.nextCursor}`);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);

    exact(FirmDocument, await call('get', `/documents/${doc.id}`, people.ownerA));
    const link = await call('get', `/documents/${doc.id}/download`, people.ownerA);
    expect(link.body).toEqual({
      url: expect.stringMatching(/^memory:tenant\//),
      expiresAt: expect.any(String),
    });
    // document.uploaded commits with the document, in its transaction.
    const xmins = await asOwner(firms.a.id, async (tx) => [
      ...(await tx.$queryRaw<{ x: string }[]>`
        SELECT xmin::text AS x FROM documents WHERE id = ${doc.id}::uuid`),
      ...(await tx.$queryRaw<{ x: string }[]>`
        SELECT xmin::text AS x FROM audit_logs
        WHERE entity_id::text = ${doc.id} AND action = 'document.uploaded'`),
    ]);
    expect(xmins).toHaveLength(2);
    expect(xmins[0]?.x).toBe(xmins[1]?.x);
    const actions = (await auditOf(doc.id)).map((a) => a.action);
    expect(actions).toEqual([
      'document.uploaded',
      'document.viewed',
      'document.download_link_issued',
    ]);
    for (const a of await auditOf(doc.id))
      expect(JSON.stringify(a.metadata)).not.toMatch(/Ledger|tenant\/|memory:/);
    const categories = exact(
      DocumentCategoryList,
      await call('get', '/document-categories', people.staffA),
    );
    expect(categories.items.map((c) => c.name)).toEqual(['Old', 'Tax Documents']);
  });

  it('downloads only CLEAN files whose stored bytes are still the confirmed ones', async () => {
    config.scanMode = 'guardduty';
    const pending = await firmDoc(people.ownerA, {});
    config.scanMode = 'local';
    expect(pending.scanStatus).toBe('PENDING');
    expectError(
      await call('get', `/documents/${pending.id}/download`, people.ownerA),
      409,
      'SCAN_PENDING',
    );
    await asOwner(firms.a.id, (tx) =>
      tx.document.update({
        where: { id: pending.id },
        data: { scanStatus: 'INFECTED', scannedAt: new Date() },
      }),
    );
    expectError(
      await call('get', `/documents/${pending.id}/download`, people.ownerA),
      409,
      'FILE_BLOCKED',
    );

    const { res, key } = await upload(people.ownerA, { serviceId: ids.e1 }, pdf('kept'));
    storage.objects.set(key, pdf('swap'));
    expectError(
      await call('get', `/documents/${(res.body as { id: string }).id}/download`, people.ownerA),
      409,
      'FILE_BLOCKED',
    );
  });

  it('gives Staff only their assigned clients, clients nothing, and firm B nothing of firm A', async () => {
    const doc = await firmDoc(people.ownerA, {});
    exact(FirmDocumentList, await call('get', `/clients/${ids.c1}/documents`, people.staffA));
    exact(FirmDocument, await call('get', `/documents/${doc.id}`, people.staffA));
    const staffDoc = await firmDoc(people.staffA, {});
    expect(staffDoc.uploadedBy?.name).toBe(people.staffA.name);
    const c2doc = FirmDocument.parse(
      (await upload(people.ownerA, { serviceId: ids.e2 }, pdf(), { clientId: ids.c2 })).res.body,
    );

    for (const [who, firm] of [
      [people.staffA2, 'a'],
      [people.ownerB, 'b'],
    ] as const) {
      for (const path of [
        `/clients/${ids.c1}/documents`,
        `/documents/${doc.id}`,
        `/documents/${doc.id}/download`,
      ]) {
        expectError(await call('get', path, who, undefined, firm), 404, 'NOT_FOUND');
      }
      expectError(
        (await upload(who, { serviceId: ids.e1 }, pdf(), { firm })).res,
        404,
        'NOT_FOUND',
      );
    }
    expectError(await call('get', `/documents/${c2doc.id}`, people.staffA), 404, 'NOT_FOUND');
    expectError(
      await call('get', `/clients/${ids.c1}/documents`, people.clientA),
      403,
      'FORBIDDEN',
    );

    // Firm B's own file goes under its own prefix and is no document of firm A.
    const { res, key } = await upload(people.ownerB, { serviceId: ids.eB }, pdf(), {
      clientId: ids.cB,
      firm: 'b',
    });
    const docB = exact(FirmDocument, res);
    expect(key.startsWith(`tenant/${firms.b.id}/documents/`)).toBe(true);
    expectError(
      await call('get', `/documents/${docB.id}/download`, people.ownerA),
      404,
      'NOT_FOUND',
    );
  });
});
