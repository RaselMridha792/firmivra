// End-to-end: R14 agreement PDF originals (docs/api/agreements.yaml): upload in three steps,
// stored-byte checks, the scan, firm and public downloads. Storage is in memory.
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PDFDocument } from 'pdf-lib';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { AgreementFile, type UploadTicket } from '@firmivra/types';
import { AgreementFilesService } from '../../src/agreements/agreement-files.service.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig } from '../../src/storage/config.js';
import { DOCUMENT_STORAGE, type DocumentStorage } from '../../src/storage/document-storage.js';

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

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
    return Promise.resolve(
      b
        ? { sizeBytes: b.length, sha256: checksum ? sha256(b) : null, contentEncoding: null }
        : null,
    );
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
  scanMode: 'guardduty',
};

async function pdfBytes(pages = 1, encrypted = false): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage();
  const text = Buffer.from(await doc.save({ useObjectStreams: false })).toString('latin1');
  return Buffer.from(
    encrypted ? text.replace(/trailer\s*<</, 'trailer\n<<\n/Encrypt 1 0 R\n') : text,
    'latin1',
  );
}

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r14f-${key}-${run}@r14.test` });
const people = { ownerA: person('owner-a'), staffA: person('staff-a'), ownerB: person('owner-b') };
const firms = {} as Record<'a' | 'b', { id: string; slug: string }>;

let app: INestApplication;
let files: AgreementFilesService;
const tokens = new Map<string, string>();
async function tokenFor(email: string) {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email })
    .expect(200);
  tokens.set(email, (res.body as { token: string }).token);
  return tokens.get(email)!;
}
async function call(
  method: 'get' | 'post',
  path: string,
  body?: object,
  who: { email: string } = people.ownerA,
  businessId = who === people.ownerB ? firms.b.id : firms.a.id,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business/agreements${path}`)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`)
    .set('x-business-id', businessId);
  return body === undefined ? req : req.send(body);
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;

/** Ticket, PUT and confirm: the confirm's response. */
async function upload(
  bytes: Buffer,
  fileName = 'Agreement.pdf',
  who = people.ownerA,
  stored = bytes,
) {
  const ticket = await call(
    'post',
    '/files/uploads',
    { fileName, contentType: 'application/pdf', sizeBytes: bytes.length, sha256: sha256(bytes) },
    who,
  );
  expect(ticket.status).toBe(201);
  const t = ticket.body as UploadTicket;
  storage.put(t, stored);
  return {
    res: await call('post', '/files/confirm', { uploadToken: t.uploadToken }, who),
    ticket: t,
  };
}

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: key },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r14f-${key}-${run}`;
      firms[key] = await tx.business.create({
        data: { slug, name: slug, status: 'ACTIVE' },
        select: { id: true, slug: true },
      });
    }
  });
  for (const [firm, p, role] of [
    ['a', people.ownerA, 'OWNER'],
    ['a', people.staffA, 'STAFF'],
    ['b', people.ownerB, 'OWNER'],
  ] as const) {
    const businessId = firms[firm].id;
    await runInScope(owner, { kind: 'business', businessId }, (tx) =>
      tx.membership.create({ data: { businessId, userId: p.id, role, status: 'ACTIVE' } }),
    );
  }
  await owner.$disconnect();
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
  files = nest.get(AgreementFilesService);
});

afterAll(async () => {
  await app.close();
});

describe('agreement PDF originals', () => {
  let fileId: string;
  let ticket: UploadTicket;

  it('uploads a PDF: PENDING until the scan, then publishable and downloadable', async () => {
    const bytes = await pdfBytes(2);
    const up = await upload(bytes);
    expect(up.res.status).toBe(201);
    const file = AgreementFile.parse(up.res.body);
    expect(file).toMatchObject({
      fileName: 'Agreement.pdf',
      scanStatus: 'PENDING',
      sha256: sha256(bytes),
    });
    fileId = file.fileId;
    ticket = up.ticket;
    expect(ticket.url).toContain(`tenant/${firms.a.id}/agreements/`);

    const early = await call('get', `/files/${fileId}/download`);
    expect([early.status, codeOf(early)]).toEqual([409, 'SCAN_PENDING']);
    const created = await call('post', '', { scope: 'ALL_INTAKES' });
    const agreementId = (created.body as { id: string }).id;
    const version = (pdfFileId: string, expectedCurrentVersion: number | null = null) => ({
      expectedCurrentVersion,
      title: 'Sample',
      bodyMarkdown: 'Not legal text.',
      acknowledgments: [{ key: 'read', label: 'Read', text: 'I read it.', required: true }],
      pdfFileId,
    });
    const notReady = await call('post', `/${agreementId}/versions`, version(fileId));
    expect([notReady.status, codeOf(notReady)]).toEqual([409, 'FILE_NOT_READY']);

    expect(await files.recordScan(`tenant/${firms.a.id}/agreements/nope`, 'CLEAN')).toBe(false);
    expect(await files.recordScan(ticket.url.slice('memory:'.length), 'CLEAN')).toBe(true);
    expect(await files.recordScan(ticket.url.slice('memory:'.length), 'INFECTED')).toBe(false);
    expect(AgreementFile.parse((await call('get', `/files/${fileId}`)).body).scanStatus).toBe(
      'CLEAN',
    );
    const link = await call('get', `/files/${fileId}/download`);
    expect(link.status).toBe(200);
    expect((link.body as { url: string }).url).toContain('?download');

    expect((await call('post', `/${agreementId}/versions`, version(fileId))).status).toBe(201);
    // The public link: the current version only, on this firm's slug only.
    const pub = (slug: string, v: number, id = agreementId) =>
      request(app.getHttpServer()).get(
        `/api/v1/portal/${slug}/intake-agreements/${id}/versions/${v}/pdf`,
      );
    expect((await pub(firms.a.slug, 1)).status).toBe(200);
    expect((await pub(firms.a.slug, 2)).status).toBe(404);
    expect((await pub(firms.b.slug, 1)).status).toBe(404);
    expect((await pub(`nobody-${run}`, 1)).status).toBe(404);
    expect((await pub(firms.a.slug, 1, randomUUID())).status).toBe(404);

    // A second upload of v2 makes v1's link stop.
    const second = await upload(await pdfBytes(1));
    const secondId = (second.res.body as { fileId: string }).fileId;
    await files.recordScan(second.ticket.url.slice('memory:'.length), 'CLEAN');
    expect((await call('post', `/${agreementId}/versions`, version(secondId, 1))).status).toBe(201);
    expect((await pub(firms.a.slug, 1)).status).toBe(404);
    expect((await pub(firms.a.slug, 2)).status).toBe(200);
  });

  it('refuses what is not a PDF, encrypted, changed or reused, and deletes it', async () => {
    const cases: [Buffer, string, Buffer?][] = [
      [Buffer.from('plain text, not a pdf'), 'NOT_A_PDF'],
      [Buffer.from('%PDF-1.7 broken'), 'NOT_A_PDF'],
      [await pdfBytes(1, true), 'FILE_PASSWORD_PROTECTED'],
      [await pdfBytes(1), 'UPLOAD_MISMATCH', await pdfBytes(3)],
    ];
    for (const [bytes, code, stored] of cases) {
      const { res, ticket: t } = await upload(bytes, 'Agreement.pdf', people.ownerA, stored);
      expect([res.status, codeOf(res)]).toEqual([409, code]);
      expect(storage.objects.has(t.url.slice('memory:'.length))).toBe(false);
    }
    const reused = await call('post', '/files/confirm', { uploadToken: ticket.uploadToken });
    expect([reused.status, codeOf(reused)]).toEqual([410, 'UPLOAD_EXPIRED']);
    const other = await call(
      'post',
      '/files/confirm',
      { uploadToken: ticket.uploadToken },
      people.ownerB,
    );
    expect(other.status).toBe(410);
    const docx = await call('post', '/files/uploads', {
      fileName: 'a.docx',
      contentType: 'application/pdf',
      sizeBytes: 10,
      sha256: 'a'.repeat(64),
    });
    expect(docx.status).toBe(400);
    // The facts uploadFile() sends: anything but application/pdf, or none, is refused.
    for (const contentType of ['application/octet-stream', undefined]) {
      const res = await call('post', '/files/uploads', {
        fileName: 'a.pdf',
        contentType,
        sizeBytes: 10,
        sha256: 'a'.repeat(64),
      });
      expect([res.status, codeOf(res)]).toEqual([400, 'VALIDATION_FAILED']);
    }
  });

  it('a changed stored file is blocked; staff 403; another firm 404', async () => {
    storage.objects.set(ticket.url.slice('memory:'.length), await pdfBytes(5));
    const blocked = await call('get', `/files/${fileId}/download`);
    expect([blocked.status, codeOf(blocked)]).toEqual([409, 'FILE_BLOCKED']);
    expect((await call('get', `/files/${fileId}`, undefined, people.staffA)).status).toBe(403);
    expect(
      (
        await call(
          'post',
          '/files/uploads',
          {
            fileName: 'a.pdf',
            contentType: 'application/pdf',
            sizeBytes: 10,
            sha256: 'a'.repeat(64),
          },
          people.staffA,
        )
      ).status,
    ).toBe(403);
    expect((await call('get', `/files/${fileId}`, undefined, people.ownerB)).status).toBe(404);
    expect((await call('get', `/files/${fileId}/download`, undefined, people.ownerB)).status).toBe(
      404,
    );
  });
});
