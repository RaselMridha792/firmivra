// End-to-end: A-X10 (Q28, Business Advisory Review Two B28), the firm's own advisory resources
// beside the built-in library, and its edits of built-in ones, on R1's advisory_resources. Files
// take Documents' three steps under tenant/{firm}/advisory-resources/ and are offered (a link, or
// Send) only once their virus scan is CLEAN. Owner and Admin manage; Staff see the library; firm B
// sees none of firm A's. Storage and the notify service are replaced: nothing leaves. Synthetic
// data only.
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  AdvisoryResource,
  AdvisoryResourceFile,
  AdvisoryResourceList,
  AdvisoryResourcePreview,
  type UploadTicket,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig } from '../../src/storage/config.js';
import {
  DOCUMENT_STORAGE,
  type DocumentStorage,
  type FileFacts,
} from '../../src/storage/document-storage.js';
import { ScanResultRouter } from '../../src/storage/scan-queue/scan-router.js';
import { NOTIFY_SERVICE } from '../../src/notify/notify.types.js';
import { MemoryUploads } from '../memory-uploads.js';

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

class MemoryStorage implements DocumentStorage {
  readonly objects = new Map<string, Buffer>();
  readonly uploads = new MemoryUploads(this.objects);
  presignUpload(file: FileFacts) {
    return this.uploads.presign(file);
  }
  completeUpload(key: string, uploadId: string, sizeBytes: number) {
    return this.uploads.complete(key, uploadId, sizeBytes);
  }
  abortUpload(key: string, uploadId: string) {
    return this.uploads.abort(key, uploadId);
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
}
const storage = new MemoryStorage();
// The scanner's way: a file stays CHECKING until its result comes through the router.
const config: DocumentsConfig = {
  bucket: 'unused',
  region: 'us-east-1',
  forcePathStyle: true,
  scanMode: 'guardduty',
};
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `q28-${key}-${run}@q28.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  ownerB: person('owner-b'),
};
type Who = (typeof people)[keyof typeof people];
const { ownerA, adminA, staffA, ownerB } = people;
const firms = { a: '', b: '' };
let advisoryClientId = '';

let app: INestApplication;
let router: ScanResultRouter;
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
async function call(
  method: 'get' | 'post' | 'put',
  path: string,
  who: Who = ownerA,
  body?: object,
  firm: 'a' | 'b' = 'a',
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business/advisory${path}`)
    .set('x-business-id', firms[firm])
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};
const library = async (who: Who = ownerA, firm: 'a' | 'b' = 'a') =>
  AdvisoryResourceList.parse(ok(await call('get', '/resources', who, undefined, firm))).items;
const save = (over: object = {}) => ({
  title: `Fake checklist ${run}`,
  category: 'Banking',
  kind: 'CHECKLIST',
  summary: 'What to bring to the bank (fake).',
  clientFacing: true,
  url: null,
  fileId: null,
  ...over,
});

/** Ticket, PUT and confirm, as the browser does. */
async function upload(bytes: Buffer, who: Who = ownerA): Promise<Response> {
  const start = await call('post', '/resources/files', who, {
    fileName: 'Fake checklist.pdf',
    contentType: 'application/pdf',
    sizeBytes: bytes.length,
    sha256: sha256(bytes),
  });
  if (start.status !== 201) return start;
  const ticket = start.body as UploadTicket;
  storage.uploads.send(ticket, bytes);
  return call('post', '/resources/files/confirm', who, { uploadToken: ticket.uploadToken });
}
/** GuardDuty's result for the file, through the scan router. */
async function scan(fileId: string, status: 'NO_THREATS_FOUND' | 'THREATS_FOUND') {
  const { s3Key } = await asOwner({ kind: 'business', businessId: firms.a }, (tx) =>
    tx.advisoryResourceFile.findUniqueOrThrow({ where: { id: fileId }, select: { s3Key: true } }),
  );
  return router.route({
    id: randomUUID(),
    time: new Date(),
    key: s3Key,
    status,
    reasons: [],
    versionId: null,
  });
}
const audit = (entityId: string) =>
  asOwner({ kind: 'business', businessId: firms.a }, (tx) =>
    tx.auditLog.findMany({ where: { entityId }, select: { action: true, metadata: true } }),
  );

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people))
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    for (const key of ['a', 'b'] as const)
      firms[key] = (
        await tx.business.create({
          data: { slug: `q28-${key}-${run}`, name: `Firm ${key}`, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
  });
  for (const [firm, p, role] of [
    ['a', ownerA, 'OWNER'],
    ['a', adminA, 'ADMIN'],
    ['a', staffA, 'STAFF'],
    ['b', ownerB, 'OWNER'],
  ] as const)
    await asOwner({ kind: 'business', businessId: firms[firm] }, (tx) =>
      tx.membership.create({
        data: { businessId: firms[firm], userId: p.id, role, status: 'ACTIVE' },
      }),
    );
  advisoryClientId = await asOwner({ kind: 'business', businessId: firms.a }, async (tx) => {
    const client = await tx.client.create({
      data: { businessId: firms.a, displayName: 'Jamie Sample (fake)', assignedUserId: staffA.id },
      select: { id: true },
    });
    return (
      await tx.advisoryClient.create({
        data: { businessId: firms.a, clientId: client.id },
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
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(DOCUMENT_STORAGE)
    .useValue(storage)
    .overrideProvider(DOCUMENTS_CONFIG)
    .useValue(config)
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({ send: () => Promise.resolve() })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
  router = nest.get(ScanResultRouter);
});

afterAll(async () => {
  await app.close();
});

describe("A-X10: the firm's own resources", () => {
  it('adds one beside the built-in library; Staff see it but may not add; firm B sees none', async () => {
    const before = await library();
    expect(before.every((r) => r.source === 'BUILT_IN' && !r.edited)).toBe(true);
    const made = AdvisoryResource.parse(
      ok(
        await call(
          'post',
          '/resources',
          ownerA,
          save({ kind: 'LINK', url: 'https://example.com/fake-guide' }),
        ),
        201,
      ),
    );
    expect(made).toMatchObject({
      source: 'FIRM',
      kind: 'LINK',
      url: 'https://example.com/fake-guide',
      formats: ['SECURE_LINK'],
      file: null,
    });
    expect(made.key).toMatch(/^r-[0-9a-f-]{36}$/);
    const listed = await library(staffA);
    expect(listed.at(-1)).toMatchObject({ key: made.key, source: 'FIRM' });
    expect(listed).toHaveLength(before.length + 1);
    expect((await library(ownerB, 'b')).some((r) => r.key === made.key)).toBe(false);

    expectError(await call('post', '/resources', staffA, save()), 403, 'FORBIDDEN');
    expectError(await call('put', `/resources/${made.key}`, ownerB, save(), 'b'), 404, 'NOT_FOUND');
    // A link or a video needs its link; never a link and a file both.
    expect((await call('post', '/resources', ownerA, save({ kind: 'VIDEO' }))).status).toBe(400);
    // Audit: ids only, never the title.
    const rows = await audit(made.key.slice(2));
    expect(rows.map((r) => r.action)).toEqual(['advisory_resource.created']);
    expect(JSON.stringify(rows)).not.toContain('Fake checklist');
  });

  it('edits a built-in one (its copy); a built-in one is never archived', async () => {
    const edited = AdvisoryResource.parse(
      ok(
        await call(
          'put',
          '/resources/business-banking-checklist',
          adminA,
          save({ title: `Our banking checklist ${run}` }),
        ),
      ),
    );
    expect(edited).toMatchObject({
      key: 'business-banking-checklist',
      source: 'BUILT_IN',
      edited: true,
      title: `Our banking checklist ${run}`,
      formats: ['SECURE_LINK', 'PDF'],
    });
    // A second edit changes the same copy.
    ok(
      await call(
        'put',
        '/resources/business-banking-checklist',
        ownerA,
        save({ summary: 'Edited again (fake).' }),
      ),
    );
    const listed = (await library()).filter((r) => r.key === 'business-banking-checklist');
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ edited: true, summary: 'Edited again (fake).' });
    expectError(
      await call('post', '/resources/business-banking-checklist/archive', ownerA),
      409,
      'RESOURCE_BUILT_IN',
    );
    expectError(await call('put', '/resources/no-such-resource', ownerA, save()), 404, 'NOT_FOUND');
  });

  it('archives its own: it leaves the library and can no longer be edited', async () => {
    const made = AdvisoryResource.parse(ok(await call('post', '/resources', ownerA, save()), 201));
    expectError(await call('post', `/resources/${made.key}/archive`, staffA), 403, 'FORBIDDEN');
    ok(await call('post', `/resources/${made.key}/archive`, ownerA));
    expect((await library()).some((r) => r.key === made.key)).toBe(false);
    expectError(
      await call('put', `/resources/${made.key}`, ownerA, save()),
      409,
      'RESOURCE_ARCHIVED',
    );
    // Again: no change.
    ok(await call('post', `/resources/${made.key}/archive`, ownerA));
  });
});

describe('A-X10: resource files through the scan pipeline', () => {
  it('a file is CHECKING until clean: no link and no Send until then', async () => {
    const file = AdvisoryResourceFile.parse(ok(await upload(PDF), 201));
    expect(file).toMatchObject({ fileName: 'Fake checklist.pdf', status: 'CHECKING' });
    expect(
      [...storage.objects.keys()].some((k) =>
        k.startsWith(`tenant/${firms.a}/advisory-resources/`),
      ),
    ).toBe(true);
    const made = AdvisoryResource.parse(
      ok(await call('post', '/resources', ownerA, save({ kind: 'PDF', fileId: file.id })), 201),
    );
    expect(made.file).toMatchObject({ id: file.id, status: 'CHECKING' });
    expectError(await call('get', `/resources/${made.key}/file`, staffA), 409, 'SCAN_PENDING');
    const preview = AdvisoryResourcePreview.parse(
      ok(
        await call('post', `/resources/${made.key}/preview`, ownerA, {
          advisoryClientId,
          channel: 'PORTAL_MESSAGE',
        }),
      ),
    );
    expect(preview.problems.map((p) => p.code)).toContain('FILE_NOT_READY');
    expectError(
      await call('post', `/resources/${made.key}/send`, ownerA, {
        advisoryClientId,
        channel: 'PORTAL_MESSAGE',
      }),
      409,
      'FILE_NOT_READY',
    );

    expect((await scan(file.id, 'NO_THREATS_FOUND')).outcome).toBe('CLEAN');
    // Set once: a second result is ignored.
    expect((await scan(file.id, 'THREATS_FOUND')).outcome).toBe('IGNORED');
    const link = ok(await call('get', `/resources/${made.key}/file`, staffA)) as { url: string };
    expect(link.url).toContain(`tenant/${firms.a}/advisory-resources/`);
    expect((await library()).find((r) => r.key === made.key)?.file?.status).toBe('READY');
    // The file is on one resource only.
    expectError(
      await call('post', '/resources', ownerA, save({ fileId: file.id })),
      409,
      'FILE_IN_USE',
    );
    // Another firm reaches neither the resource nor its file.
    expectError(
      await call('get', `/resources/${made.key}/file`, ownerB, undefined, 'b'),
      404,
      'NOT_FOUND',
    );
  });

  it('a file the scan refused is never attached, and its resource gives no link', async () => {
    const file = AdvisoryResourceFile.parse(ok(await upload(PDF), 201));
    const made = AdvisoryResource.parse(
      ok(await call('post', '/resources', ownerA, save({ fileId: file.id })), 201),
    );
    expect((await scan(file.id, 'THREATS_FOUND')).outcome).toBe('INFECTED');
    expectError(await call('get', `/resources/${made.key}/file`, ownerA), 409, 'FILE_BLOCKED');
    const bad = AdvisoryResourceFile.parse(ok(await upload(PDF), 201));
    expect((await scan(bad.id, 'THREATS_FOUND')).outcome).toBe('INFECTED');
    expectError(
      await call('post', '/resources', ownerA, save({ fileId: bad.id })),
      409,
      'FILE_BLOCKED',
    );
  });

  it('refuses an upload whose bytes are not what was declared; Staff may not upload', async () => {
    const start = await call('post', '/resources/files', ownerA, {
      fileName: 'Fake checklist.pdf',
      contentType: 'application/pdf',
      sizeBytes: PDF.length,
      sha256: sha256(PDF),
    });
    const ticket = ok(start, 201) as UploadTicket;
    const other = Buffer.from(PDF);
    other[other.length - 2] = 0x20;
    storage.uploads.send(ticket, other);
    expectError(
      await call('post', '/resources/files/confirm', ownerA, { uploadToken: ticket.uploadToken }),
      409,
      'UPLOAD_MISMATCH',
    );
    expectError(await upload(PDF, staffA), 403, 'FORBIDDEN');
  });
});
