// End-to-end: A-X10 (Q28, Business Advisory Review Two B28), the firm's own advisory resources
// beside the built-in library, and its edits of built-in ones, on R1's advisory_resources (part 2:
// as the client sees them in the portal once sent, with their link or file). Files
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
  DownloadLink,
  MyAdvisory,
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
/** The advisory client's portal login (PRIMARY). */
const clientX = person('client-x');
type Who = (typeof people)[keyof typeof people];
const { ownerA, adminA, staffA, ownerB } = people;
const firms = { a: '', b: '' };
const slugs = { a: '', b: '' };
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
/** The client's own portal route: `/api/v1/portal/{slug}/me/advisory{path}`. */
async function portal(path: string, firm: 'a' | 'b' = 'a'): Promise<Response> {
  return request(app.getHttpServer())
    .get(`/api/v1/portal/${slugs[firm]}/me/advisory${path}`)
    .set('authorization', `Bearer ${await tokenFor(clientX.email)}`);
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
    await tx.user.create({
      data: {
        id: clientX.id,
        cognitoSub: clientX.id,
        pool: 'CLIENT',
        email: clientX.email,
        name: 'Fake client x',
      },
    });
    for (const key of ['a', 'b'] as const)
      firms[key] = (
        await tx.business.create({
          data: { slug: (slugs[key] = `q28-${key}-${run}`), name: `Firm ${key}`, status: 'ACTIVE' },
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
    // Its portal login, so a Send by portal message reaches it.
    await tx.clientAccount.create({
      data: {
        businessId: firms.a,
        userId: clientX.id,
        clientId: client.id,
        email: clientX.email,
        portalRole: 'PRIMARY',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        phoneVerifiedAt: new Date(),
      },
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

describe('A-X10 part 2: what the client sees in the portal', () => {
  const send = async (key: string) =>
    ok(
      await call('post', `/resources/${key}/send`, ownerA, {
        advisoryClientId,
        channel: 'PORTAL_MESSAGE',
      }),
    );
  const mine = async () => MyAdvisory.parse(ok(await portal(''))).resources;

  it("shows the firm's own resources and its edits, with their link or a clean file", async () => {
    const link = AdvisoryResource.parse(
      ok(
        await call(
          'post',
          '/resources',
          ownerA,
          save({ title: `Fake link ${run}`, kind: 'LINK', url: 'https://example.com/fake-link' }),
        ),
        201,
      ),
    );
    const file = AdvisoryResourceFile.parse(ok(await upload(PDF), 201));
    await scan(file.id, 'NO_THREATS_FOUND');
    const withFile = AdvisoryResource.parse(
      ok(await call('post', '/resources', ownerA, save({ fileId: file.id })), 201),
    );
    ok(
      await call(
        'put',
        '/resources/website-launch-checklist',
        ownerA,
        save({ title: `Fake launch list ${run}`, category: 'Website' }),
      ),
    );
    // Nothing until sent.
    expect((await mine()).map((r) => r.key)).not.toContain(link.key);
    expectError(await portal(`/resources/${withFile.key}/file`), 404, 'NOT_FOUND');

    for (const key of [link.key, withFile.key, 'website-launch-checklist']) await send(key);
    const sent = new Map((await mine()).map((r) => [r.key, r]));
    expect(sent.get(link.key)).toMatchObject({
      title: `Fake link ${run}`,
      kind: 'LINK',
      url: 'https://example.com/fake-link',
      file: null,
    });
    expect(sent.get(withFile.key)).toMatchObject({
      url: null,
      file: {
        fileName: 'Fake checklist.pdf',
        contentType: 'application/pdf',
        sizeBytes: PDF.length,
      },
    });
    expect(sent.get('website-launch-checklist')?.title).toBe(`Fake launch list ${run}`);

    const got = DownloadLink.parse(ok(await portal(`/resources/${withFile.key}/file`)));
    expect(got.url).toContain('/advisory-resources/');
    expect(await audit(advisoryClientId)).toContainEqual(
      expect.objectContaining({
        action: 'advisory_resource.downloaded',
        metadata: expect.objectContaining({
          resourceKey: withFile.key,
          format: 'FILE',
          by: 'CLIENT',
        }),
      }),
    );
    // A resource with no file, or one never sent, has no file to give.
    expectError(await portal(`/resources/${link.key}/file`), 404, 'NOT_FOUND');
    expectError(await portal('/resources/brand-basics-guide/file'), 404, 'NOT_FOUND');
    // Another firm's portal never has it.
    expect((await portal(`/resources/${withFile.key}/file`, 'b')).status).not.toBe(200);
  });

  it('hides a file again while a new one is checked, and an archived resource', async () => {
    const first = AdvisoryResourceFile.parse(ok(await upload(PDF), 201));
    await scan(first.id, 'NO_THREATS_FOUND');
    const made = AdvisoryResource.parse(
      ok(
        await call(
          'post',
          '/resources',
          ownerA,
          save({ title: `Fake swap ${run}`, fileId: first.id }),
        ),
        201,
      ),
    );
    await send(made.key);
    expect((await mine()).find((r) => r.key === made.key)?.file).not.toBeNull();

    // The firm swaps in a file still being checked: the portal offers none until it is clean.
    const next = AdvisoryResourceFile.parse(ok(await upload(PDF), 201));
    ok(
      await call(
        'put',
        `/resources/${made.key}`,
        ownerA,
        save({ title: `Fake swap ${run}`, fileId: next.id }),
      ),
    );
    expect((await mine()).find((r) => r.key === made.key)?.file).toBeNull();
    expectError(await portal(`/resources/${made.key}/file`), 409, 'SCAN_PENDING');
    await scan(next.id, 'NO_THREATS_FOUND');
    DownloadLink.parse(ok(await portal(`/resources/${made.key}/file`)));

    // Archived: it leaves the client's list and its file.
    ok(await call('post', `/resources/${made.key}/archive`, ownerA));
    expect((await mine()).map((r) => r.key)).not.toContain(made.key);
    expectError(await portal(`/resources/${made.key}/file`), 404, 'NOT_FOUND');
  });
});
