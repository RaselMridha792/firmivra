// End-to-end: R55, the firm-wide Documents library (contract packages/types/src/documents/
// library.ts): the list and summary, Frame 1's upload (with R5's confirm), Frame 2's details,
// edits, review, archive and trash, versions, activity, preview, bulk actions, and Frame 6's
// folders, types and settings. Staff reach only their own clients; firm B sees none of firm A's.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  BulkDocumentsResult,
  DocumentActivityList,
  DocumentFolder,
  DocumentFolderList,
  DocumentSettings,
  DocumentVersionList,
  FirmDocument,
  LibraryDocument,
  LibraryPage,
  LibrarySummary,
  UPLOAD_LIMITS,
  UploadTicket,
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
import { pdf, sha256 } from '../office-files.js';
import { bigPdf, MemoryUploads, ticketKey } from '../memory-uploads.js';

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
  put(ticket: UploadTicket, bytes: Buffer) {
    this.uploads.send(ticket, bytes);
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
const person = (key: string) => ({ id: randomUUID(), email: `r55d-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  ownerB: person('owner-b'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', string>;
let app: INestApplication;
const tokens = new Map<string, string>();
const ids = {} as Record<string, string>;

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
const inFirm = <T>(firm: 'a' | 'b', work: Parameters<typeof runInScope<T>>[2]) =>
  asOwner({ kind: 'business', businessId: firms[firm] }, work);

async function call(
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  who: Who | undefined,
  body?: object,
  firm: 'a' | 'b' = 'a',
): Promise<Response> {
  let req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', firms[firm]);
  if (who) {
    let token = tokens.get(who.email);
    if (!token) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/dev/token')
        .send({ email: who.email })
        .expect(200);
      token = (res.body as { token: string }).token;
      tokens.set(who.email, token);
    }
    req = req.set('authorization', `Bearer ${token}`);
  }
  return body === undefined ? req : req.send(body);
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const ok = <T>(res: Response, parse: { parse: (v: unknown) => T }, status = 200): T => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return parse.parse(res.body);
};
const { ownerA, adminA, staffA, ownerB } = people;

/** Frame 1's three steps: the library's ticket, the PUT, R5's confirm. */
async function upload(over: object, file = pdf(randomUUID()), who: Who = ownerA) {
  const ticket = await call('post', '/documents/uploads', who, {
    clientId: ids.c1,
    serviceId: ids.e1,
    fileName: 'fake-w2.pdf',
    contentType: 'application/pdf',
    sizeBytes: file.length,
    sha256: sha256(file),
    ...over,
  });
  if (ticket.status !== 201) return ticket;
  const t = UploadTicket.parse(ticket.body);
  storage.put(t, file);
  return call('post', '/documents/uploads/confirm', who, { uploadToken: t.uploadToken });
}

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    }
    for (const key of ['a', 'b'] as const) {
      const slug = `r55d-${key}-${run}`;
      firms[key] = (
        await tx.business.create({
          data: { slug, name: `Firm ${slug}`, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
  });
  for (const [firm, userId, role] of [
    ['a', ownerA.id, 'OWNER'],
    ['a', adminA.id, 'ADMIN'],
    ['a', staffA.id, 'STAFF'],
    ['b', ownerB.id, 'OWNER'],
  ] as const) {
    await inFirm(firm, (tx) =>
      tx.membership.create({ data: { businessId: firms[firm], userId, role, status: 'ACTIVE' } }),
    );
  }
  await inFirm('a', async (tx) => {
    const businessId = firms.a;
    const service = await tx.service.create({
      data: { businessId, kind: 'ANNUAL_TAX', name: `Tax ${run}`, status: 'ACTIVE' },
    });
    const client = async (key: string, name: string, assigned?: string) => {
      const c = await tx.client.create({
        data: {
          businessId,
          displayName: name,
          email: `${key}-${run}@c.test`,
          assignedUserId: assigned,
        },
      });
      const e = await tx.engagement.create({
        data: { businessId, clientId: c.id, serviceId: service.id, title: `${name} 2025` },
      });
      ids[key] = c.id;
      ids[`e${key.slice(1)}`] = e.id;
    };
    await client('c1', 'Cora One (fake)', staffA.id);
    await client('c2', 'Cal Two (fake)');
    ids.category = (
      await tx.documentCategory.create({ data: { businessId, name: `W-2 ${run}` } })
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
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('folders, types and settings', () => {
  it('builds the folder tree within its rules', async () => {
    const top = ok(
      await call('post', '/document-folders', ownerA, { name: 'Tax Returns', color: 'GREEN' }),
      DocumentFolder,
      201,
    );
    ids.folder = top.id;
    const firm = ok(
      await call('post', '/document-folders', adminA, { name: 'Firm Only', scope: 'FIRM' }),
      DocumentFolder,
      201,
    );
    ids.firmFolder = firm.id;
    const child = ok(
      await call('post', '/document-folders', ownerA, { name: '2025', parentId: top.id }),
      DocumentFolder,
      201,
    );
    expect(child).toMatchObject({ scope: 'CLIENT', parentId: top.id, defaultClientAccess: 'NONE' });
    expectError(
      await call('post', '/document-folders', ownerA, { name: 'tax returns' }),
      409,
      'DUPLICATE_NAME',
    );
    expectError(
      await call('post', '/document-folders', ownerA, {
        name: 'Bad',
        scope: 'FIRM',
        allowClientUploads: true,
      }),
      400,
      'VALIDATION_FAILED',
    );
    let parent = child.id;
    for (const level of [3, 4, 5]) {
      parent = ok(
        await call('post', '/document-folders', ownerA, { name: `L${level}`, parentId: parent }),
        DocumentFolder,
        201,
      ).id;
    }
    expectError(
      await call('post', '/document-folders', ownerA, { name: 'L6', parentId: parent }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', `/document-folders/${top.id}`, ownerA, { parentId: child.id }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', `/document-folders/${firm.id}`, ownerA, { parentId: top.id }),
      409,
      'FOLDER_SCOPE',
    );
    expectError(
      await call('post', '/document-folders', staffA, { name: 'Nope' }),
      403,
      'FORBIDDEN',
    );
    const list = ok(await call('get', '/document-folders', staffA), DocumentFolderList);
    expect(list.items.find((f) => f.id === top.id)?.subfolderCount).toBe(1);
    const roots = list.items.filter((f) => f.parentId === null).map((f) => f.id);
    const reordered = ok(
      await call('post', '/document-folders/reorder', ownerA, {
        parentId: null,
        ids: [...roots].reverse(),
      }),
      DocumentFolderList,
    );
    expect(reordered.items.filter((f) => f.parentId === null).map((f) => f.id)).toEqual(
      [...roots].reverse(),
    );
    expectError(
      await call('post', '/document-folders/reorder', ownerA, { parentId: null, ids: [top.id] }),
      400,
      'VALIDATION_FAILED',
    );
    ok(await call('delete', `/document-folders/${parent}`, ownerA), { parse: (v) => v });
  });

  it('adds and changes document types (MANAGE)', async () => {
    const t = await call('post', '/document-categories', ownerA, { name: 'ID', retentionYears: 3 });
    expect(t.status).toBe(201);
    expectError(
      await call('post', '/document-categories', ownerA, { name: 'ID' }),
      409,
      'DUPLICATE_NAME',
    );
    const changed = await call(
      'patch',
      `/document-categories/${(t.body as { id: string }).id}`,
      adminA,
      {
        archived: true,
      },
    );
    expect((changed.body as { archivedAt: string | null }).archivedAt).toBeTruthy();
    expectError(
      await call('post', '/document-categories', staffA, { name: 'X' }),
      403,
      'FORBIDDEN',
    );
  });

  it('reads and saves the settings', async () => {
    const s = ok(await call('get', '/document-settings', staffA), DocumentSettings);
    expect(s).toMatchObject({ uploadMaxBytes: UPLOAD_LIMITS.maxBytes, defaultReviewer: null });
    expect(s.uploadTypes).toHaveLength(5);
    const saved = ok(
      await call('patch', '/document-settings', ownerA, {
        requestReminderDaysBefore: 3,
        uploadTypes: ['application/pdf'],
        defaultReviewerUserId: adminA.id,
      }),
      DocumentSettings,
    );
    expect(saved).toMatchObject({
      requestReminderDaysBefore: 3,
      uploadTypes: ['application/pdf'],
      defaultReviewer: { userId: adminA.id },
    });
    expectError(
      await call('patch', '/document-settings', ownerA, { defaultReviewerUserId: ownerB.id }),
      409,
      'NOT_A_MEMBER',
    );
    expectError(
      await call('patch', '/document-settings', staffA, { shareExpiryDays: 9 }),
      403,
      'FORBIDDEN',
    );
  });
});

describe('upload, details and versions', () => {
  it('uploads with the library fields and R5 confirm', async () => {
    const res = await upload({
      folderId: ids.folder,
      categoryId: ids.category,
      taxYear: 2025,
      description: 'Fake W-2',
      tags: ['w2', 'income'],
      reviewerUserId: adminA.id,
      expiresOn: '2030-01-31',
    });
    const first = ok(res, FirmDocument);
    ids.doc = first.id;
    const d = ok(await call('get', `/documents/${first.id}/details`, ownerA), LibraryDocument);
    expect(d).toMatchObject({
      folder: { id: ids.folder, name: 'Tax Returns', color: 'GREEN' },
      category: { id: ids.category },
      tags: ['w2', 'income'],
      reviewStatus: 'NEEDS_REVIEW',
      reviewer: { userId: adminA.id },
      direction: 'INTERNAL',
      visibleToClient: false,
      versionNo: 1,
      expiresOn: '2030-01-31',
      scanStatus: 'CLEAN',
      client: { id: ids.c1 },
    });
    expectError(
      await upload({ folderId: ids.firmFolder, shareWithClient: true }),
      409,
      'FOLDER_SCOPE',
    );
    expectError(await upload({ reviewerUserId: ownerB.id }), 409, 'NOT_A_MEMBER');
    expectError(
      await upload({ clientId: ids.c2, serviceId: ids.e2 }, undefined, staffA),
      404,
      'NOT_FOUND',
    );
    expect((await upload({ notifyClient: true })).status).toBe(400);
  });

  it('a replacement is the next version', async () => {
    const v2 = ok(
      await upload({ replacesId: ids.doc, fileName: 'fake-w2-fixed.pdf' }),
      FirmDocument,
    );
    ids.doc2 = v2.id;
    const versions = ok(
      await call('get', `/documents/${ids.doc}/versions`, ownerA),
      DocumentVersionList,
    );
    expect(versions.items.map((v) => [v.versionNo, v.current])).toEqual([
      [2, true],
      [1, false],
    ]);
    const old = ok(await call('get', `/documents/${ids.doc}/details`, ownerA), LibraryDocument);
    expect(old.superseded).toBe(true);
    expectError(
      await upload({ replacesId: ids.doc2, shareWithClient: true }),
      400,
      'VALIDATION_FAILED',
    );
  });
});

describe('the library', () => {
  it('lists with filters, pages and reach, and summarises', async () => {
    await upload({
      clientId: ids.c2,
      serviceId: ids.e2,
      fileName: 'fake-1099.pdf',
      tags: ['1099'],
    });
    const all = ok(await call('get', '/documents?pageSize=100', ownerA), LibraryPage);
    expect(all.total).toBe(3);
    const list = async (q: string, who: Who = ownerA) =>
      ok(await call('get', `/documents?${q}`, who), LibraryPage).items.map((d) => d.fileName);
    expect(await list(`folderId=${ids.folder}`)).toEqual(['fake-w2.pdf']);
    expect(await list('tag=1099')).toEqual(['fake-1099.pdf']);
    expect(await list('reviewStatus=NEEDS_REVIEW')).toEqual(['fake-w2.pdf']);
    expect(await list('search=Cal%20Two')).toEqual(['fake-1099.pdf']);
    expect((await list('pageSize=100', staffA)).sort()).toEqual([
      'fake-w2-fixed.pdf',
      'fake-w2.pdf',
    ]);
    expect((await list('pageSize=1&page=2')).length).toBe(1);
    expect(await list('folderId=firm')).toEqual([]);
    expect((await call('get', '/documents?sort=nope', ownerA)).status).toBe(400);
    const s = ok(await call('get', '/documents/summary', ownerA), LibrarySummary);
    expect(s).toMatchObject({
      all: 3,
      recentlyUploaded: 3,
      needsReview: 1,
      completed: 0,
      missing: 0,
    });
    expect(s.folders.byFolder).toEqual([{ folderId: ids.folder, count: 1 }]);
    expect(ok(await call('get', '/documents/summary', staffA), LibrarySummary).all).toBe(2);
  });

  it('edits details, and the activity tells what changed', async () => {
    expectError(
      await call('patch', `/documents/${ids.doc2}`, ownerA, { fileName: 'renamed.docx' }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', `/documents/${ids.doc2}`, ownerA, { tags: ['A', 'a'] }),
      400,
      'VALIDATION_FAILED',
    );
    ok(
      await call('patch', `/documents/${ids.doc2}`, staffA, { fileName: 'renamed.pdf' }),
      LibraryDocument,
    );
    const moved = ok(
      await call('patch', `/documents/${ids.doc2}`, ownerA, { folderId: ids.folder }),
      LibraryDocument,
    );
    expect(moved).toMatchObject({ fileName: 'renamed.pdf', folder: { id: ids.folder } });
    expectError(
      await call('patch', `/documents/${ids.doc2}`, ownerA, { folderId: randomUUID() }),
      404,
      'NOT_FOUND',
    );
    const activity = ok(
      await call('get', `/documents/${ids.doc2}/activity`, ownerA),
      DocumentActivityList,
    );
    expect(activity.items.map((a) => a.kind)).toEqual(['MOVED', 'RENAMED', 'UPLOADED']);
    expect(activity.items[1]?.by).toBe('Fake staffA');
  });

  it('reviews: start, verify, ask for a replacement with a reason', async () => {
    const started = ok(
      await call('post', `/documents/${ids.doc2}/review`, staffA, { action: 'START' }),
      LibraryDocument,
    );
    expect(started).toMatchObject({ reviewStatus: 'IN_REVIEW', reviewer: { userId: staffA.id } });
    const verified = ok(
      await call('post', `/documents/${ids.doc2}/review`, adminA, { action: 'VERIFY' }),
      LibraryDocument,
    );
    expect(verified).toMatchObject({ reviewStatus: 'VERIFIED', reviewedBy: { userId: adminA.id } });
    expect(verified.reviewedAt).toBeTruthy();
    expect(
      (
        await call('post', `/documents/${ids.doc2}/review`, ownerA, {
          action: 'REQUEST_REPLACEMENT',
        })
      ).status,
    ).toBe(400);
    const again = ok(
      await call('post', `/documents/${ids.doc2}/review`, ownerA, {
        action: 'REQUEST_REPLACEMENT',
        reason: 'Blurry',
      }),
      LibraryDocument,
    );
    expect(again).toMatchObject({ reviewStatus: 'REPLACEMENT_REQUESTED', reviewedBy: null });
  });

  it('previews a clean file and moves documents to the archive and the trash', async () => {
    const link = await call('get', `/documents/${ids.doc2}/preview`, staffA);
    expect((link.body as { url: string }).url).toMatch(/^memory:tenant\//);
    const archived = ok(
      await call('post', `/documents/${ids.doc}/archive`, staffA),
      LibraryDocument,
    );
    expect(archived.archivedAt).toBeTruthy();
    ok(await call('post', `/documents/${ids.doc}/archive`, staffA), LibraryDocument);
    expect(
      ok(await call('get', '/documents?scope=archived', ownerA), LibraryPage).items.map(
        (d) => d.id,
      ),
    ).toEqual([ids.doc]);
    expectError(await call('post', `/documents/${ids.doc}/trash`, staffA), 403, 'FORBIDDEN');
    const trashed = ok(await call('post', `/documents/${ids.doc}/trash`, ownerA), LibraryDocument);
    expect(trashed).toMatchObject({ archivedAt: null });
    expect(trashed.trashedAt).toBeTruthy();
    expectError(await call('post', `/documents/${ids.doc}/restore`, ownerA), 409, 'INVALID_STATUS');
    expectError(
      await call('patch', `/documents/${ids.doc}`, ownerA, { tags: [] }),
      409,
      'INVALID_STATUS',
    );
    ok(await call('post', `/documents/${ids.doc}/untrash`, ownerA), LibraryDocument);
    expect(ok(await call('get', '/documents/summary', ownerA), LibrarySummary).folders.trash).toBe(
      0,
    );
  });

  it('acts on many documents at once, skipping what it does not reach', async () => {
    const other = randomUUID();
    const moved = ok(
      await call('post', '/documents/bulk', ownerA, {
        action: 'ASSIGN_REVIEWER',
        ids: [ids.doc, ids.doc2, other],
        reviewerUserId: adminA.id,
      }),
      BulkDocumentsResult,
    );
    expect(moved).toMatchObject({ updated: 2, skipped: [{ id: other, code: 'NOT_FOUND' }] });
    const links = ok(
      await call('post', '/documents/bulk', staffA, {
        action: 'DOWNLOAD',
        ids: [ids.doc, ids.doc2],
      }),
      BulkDocumentsResult,
    );
    expect(links.links).toHaveLength(2);
    const shared = ok(
      await upload({ shareWithClient: true, fileName: 'fake-shared.pdf' }),
      FirmDocument,
    );
    expectError(
      await call('post', '/documents/bulk', ownerA, {
        action: 'MOVE',
        ids: [shared.id],
        folderId: ids.firmFolder,
      }),
      409,
      'FOLDER_SCOPE',
    );
    expect(
      ok(
        await call('post', '/documents/bulk', ownerA, { action: 'ARCHIVE', ids: [ids.doc2] }),
        BulkDocumentsResult,
      ).updated,
    ).toBe(1);
    expectError(
      await call('delete', `/document-folders/${ids.folder}`, ownerA),
      409,
      'FOLDER_NOT_EMPTY',
    );
  });
});

describe('another firm', () => {
  it('reaches none of it', async () => {
    for (const [method, path, body] of [
      ['get', `/documents/${ids.doc}/details`, undefined],
      ['patch', `/documents/${ids.doc}`, { tags: [] }],
      ['post', `/documents/${ids.doc}/review`, { action: 'START' }],
      ['post', `/documents/${ids.doc}/archive`, undefined],
      ['get', `/documents/${ids.doc}/versions`, undefined],
      ['get', `/documents/${ids.doc}/activity`, undefined],
      ['get', `/documents/${ids.doc}/preview`, undefined],
      ['patch', `/document-folders/${ids.folder}`, { name: 'x' }],
      ['delete', `/document-folders/${ids.folder}`, undefined],
      ['patch', `/document-categories/${ids.category}`, { name: 'x' }],
    ] as const) {
      expectError(await call(method, path, ownerB, body, 'b'), 404, 'NOT_FOUND');
    }
    // The bulk actions' other records: firm B's category and member are refused in firm A.
    const bCategory = await inFirm('b', (tx) =>
      tx.documentCategory.create({ data: { businessId: firms.b, name: `B type ${run}` } }),
    );
    expectError(
      await call('post', '/documents/bulk', ownerA, {
        action: 'RECLASSIFY',
        ids: [ids.doc],
        categoryId: bCategory.id,
      }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await call('post', '/documents/bulk', ownerA, {
        action: 'ASSIGN_REVIEWER',
        ids: [ids.doc],
        reviewerUserId: ownerB.id,
      }),
      409,
      'NOT_A_MEMBER',
    );
    expectError(
      await call('post', '/documents/bulk', ownerB, { action: 'ARCHIVE', ids: [ids.doc] }, 'b'),
      404,
      'NOT_FOUND',
    );
    expect(ok(await call('get', '/documents', ownerB, undefined, 'b'), LibraryPage).total).toBe(0);
    expect(
      ok(await call('get', '/document-folders', ownerB, undefined, 'b'), DocumentFolderList).items,
    ).toEqual([]);
    expectError(await call('get', '/documents', undefined), 401, 'UNAUTHENTICATED');
  });
});

// Last: it adds a document the counts above don't expect.
describe('large files', () => {
  it('takes a file over 16 MB as a multipart upload that confirm completes', async () => {
    const file = bigPdf();
    const ticket = await call('post', '/documents/uploads', ownerA, {
      clientId: ids.c1,
      serviceId: ids.e1,
      fileName: 'fake-ledger.pdf',
      contentType: 'application/pdf',
      sizeBytes: file.length,
      sha256: sha256(file),
    });
    const t = UploadTicket.parse(ticket.body);
    expect(t.method).toBe('MULTIPART');
    storage.put(t, file);
    const doc = ok(
      await call('post', '/documents/uploads/confirm', ownerA, { uploadToken: t.uploadToken }),
      FirmDocument,
    );
    expect(doc.sizeBytes).toBe(file.length);
    expect(storage.objects.get(ticketKey(t))?.equals(file)).toBe(true);
  });
});
