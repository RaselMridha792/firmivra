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
import { testDatabaseUrls } from '@firmivra/db/testing';
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
import { cfb, DOCX, office, pdf, png, sha256, XLSX } from '../office-files.js';

/** Storage in memory: `put(ticket, bytes)` is the browser's PUT. */
class MemoryStorage implements DocumentStorage {
  readonly objects = new Map<string, Buffer>();
  presignUpload(file: { key: string; contentType: string }) {
    const headers = { 'content-type': file.contentType };
    return Promise.resolve({ url: `memory:${file.key}`, headers });
  }
  head(key: string) {
    const b = this.objects.get(key);
    return Promise.resolve(b ? { sizeBytes: b.length, sha256: sha256(b) } : null);
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
  put(ticket: UploadTicket, bytes: Buffer) {
    this.objects.set(ticket.url.slice('memory:'.length), bytes);
  }
}
const storage = new MemoryStorage();
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
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
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
    const audit = (key: string) =>
      asOwner(firms.a.id, (tx) =>
        tx.auditLog.findFirst({
          where: {
            action: 'document.upload_refused',
            metadata: { path: ['uploadId'], equals: key.slice(key.lastIndexOf('/') + 1) },
          },
        }),
      );
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
      const entry = await audit(key);
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
    const first = await get('?limit=1');
    const second = await get(`?limit=1&cursor=${first.nextCursor}`);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);

    exact(FirmDocument, await call('get', `/documents/${doc.id}`, people.ownerA));
    const link = await call('get', `/documents/${doc.id}/download`, people.ownerA);
    expect(link.body).toEqual({
      url: expect.stringMatching(/^memory:tenant\//),
      expiresAt: expect.any(String),
    });
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
