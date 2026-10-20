// End-to-end: R55, staff documents (the three-step upload, scan, View / Download, Replace,
// Reclassify, Archive) and Bulk Upload Staff (preview, import). Owner and Admin only; the
// database walls staff documents off to the acting Owner or Admin; firm B reaches none of A's.
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  StaffDocument,
  StaffImportPreview,
  StaffImportResult,
  type UploadTicket,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { StaffDocumentsService } from '../../src/staff/staff-documents.service.js';
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

const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');
const CFB = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const DOC = Buffer.concat([CFB, Buffer.alloc(504), Buffer.from('WordDocument', 'utf16le')]);
const DOC_WITH_MACROS = Buffer.concat([DOC, Buffer.from('Macros', 'utf16le')]);

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r55d-${key}-${run}@r55.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  admin2A: person('admin2-a'),
  staffA: person('staff-a'),
  managerA: person('manager-a'),
  ownerB: person('owner-b'),
};
type Who = (typeof people)[keyof typeof people];
const firms = {} as Record<'a' | 'b', string>;

let app: INestApplication;
let files: StaffDocumentsService;
const tokens = new Map<string, string>();
let viewers = 0;
const viewer = () => `198.65.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;

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

type Method = 'get' | 'post' | 'patch';
async function call(
  method: Method,
  path: string,
  who: Who,
  body?: object,
  firm: 'a' | 'b' = 'a',
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', firms[firm])
    .set('x-forwarded-for', viewer())
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
const { ownerA, adminA, admin2A, staffA, managerA, ownerB } = people;
const member = {} as Record<keyof typeof people, string>;
const dept = {} as Record<'tax' | 'closing', string>;

/** Ticket, PUT and confirm, as the browser does. */
async function upload(
  who: Who,
  membershipId: string,
  bytes: Buffer,
  over: Partial<{
    contentType: string;
    fileName: string;
    type: string;
    replacesId: string;
    declared: Buffer;
  }> = {},
): Promise<Response> {
  const declared = over.declared ?? bytes;
  const ticket = ok(
    await call('post', `/staff/${membershipId}/documents/uploads`, who, {
      type: over.type ?? 'W4',
      fileName: over.fileName ?? 'Fake W-4.pdf',
      contentType: over.contentType ?? 'application/pdf',
      sizeBytes: declared.length,
      sha256: sha256(declared),
      ...(over.replacesId ? { replacesId: over.replacesId } : {}),
    }),
    201,
  ) as UploadTicket;
  storage.put(ticket, bytes);
  return call('post', `/staff/${membershipId}/documents/uploads/confirm`, who, {
    uploadToken: ticket.uploadToken,
  });
}
const keyOf = (docId: string) =>
  inFirm('a', async (tx) => {
    // The scanner's own view: no actor, a PENDING row.
    const rows = await tx.$queryRaw<
      { s3_key: string }[]
    >`SELECT s3_key FROM staff_documents WHERE id = ${docId}::uuid`;
    return rows[0]!.s3_key;
  });

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people))
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: 'STAFF',
          email: p.email,
          name: `Fake R55d ${key}`,
        },
      });
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
  for (const [firm, key, role] of [
    ['a', 'ownerA', 'OWNER'],
    ['a', 'adminA', 'ADMIN'],
    ['a', 'admin2A', 'ADMIN'],
    ['a', 'staffA', 'STAFF'],
    ['a', 'managerA', 'MANAGER'],
    ['b', 'ownerB', 'OWNER'],
  ] as const) {
    member[key] = (
      await inFirm(firm, (tx) =>
        tx.membership.create({
          data: { businessId: firms[firm], userId: people[key].id, role, status: 'ACTIVE' },
          select: { id: true },
        }),
      )
    ).id;
  }
  await inFirm('a', async (tx) => {
    dept.tax = (
      await tx.department.create({
        data: { businessId: firms.a, name: `Tax ${run}` },
        select: { id: true },
      })
    ).id;
    dept.closing = (
      await tx.department.create({
        data: { businessId: firms.a, name: `Closing ${run}` },
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
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
  files = nest.get(StaffDocumentsService);
});

afterAll(async () => {
  await app.close();
});

describe('staff documents', () => {
  it('uploads, waits for the scan, then gives a short-lived link', async () => {
    const doc = StaffDocument.parse(ok(await upload(adminA, member.staffA, PDF), 201));
    expect(doc).toMatchObject({
      type: 'W4',
      fileName: 'Fake W-4.pdf',
      scanStatus: 'PENDING',
      uploadedBy: 'Fake R55d adminA',
      archivedAt: null,
    });
    expectError(
      await call('get', `/staff/${member.staffA}/documents/${doc.id}/download`, adminA),
      409,
      'DOCUMENT_NOT_READY',
    );
    const key = await keyOf(doc.id);
    expect(key).toMatch(new RegExp(`^tenant/${firms.a}/staff/${member.staffA}/`));
    expect(
      await files.recordScan({ key, status: 'NO_THREATS_FOUND', reasons: [], versionId: null }),
    ).toBe('CLEAN');
    expect(
      await files.recordScan({ key, status: 'THREATS_FOUND', reasons: [], versionId: null }),
    ).toBe('IGNORED');
    const link = ok(
      await call('get', `/staff/${member.staffA}/documents/${doc.id}/download`, ownerA),
    ) as {
      url: string;
    };
    expect(link.url).toBe(`memory:${key}?download`);
    const list = ok(await call('get', `/staff/${member.staffA}/documents`, ownerA)) as {
      items: StaffDocument[];
    };
    expect(list.items.map((d) => d.id)).toContain(doc.id);
    const audit = await inFirm('a', (tx) =>
      tx.auditLog.findMany({ where: { businessId: firms.a, entityId: doc.id } }),
    );
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'staff_document.uploaded',
        'staff_document.scanned',
        'staff_document.download_link_issued',
      ]),
    );
    expect(JSON.stringify(audit.map((a) => a.metadata))).not.toContain('Fake W-4');
  });

  it('refuses stored bytes that are not what was declared, and deletes them', async () => {
    const before = storage.objects.size;
    expectError(
      await upload(adminA, member.staffA, PDF, {
        declared: Buffer.concat([PDF, Buffer.from('x')]),
      }),
      409,
      'UPLOAD_MISMATCH',
    );
    expectError(
      await upload(adminA, member.staffA, PDF, { contentType: 'image/png', fileName: 'Fake.png' }),
      409,
      'UPLOAD_MISMATCH',
    );
    expectError(
      await upload(adminA, member.staffA, DOC_WITH_MACROS, {
        contentType: 'application/msword',
        fileName: 'Fake.doc',
      }),
      409,
      'FILE_HAS_MACROS',
    );
    expect(storage.objects.size).toBe(before);
    const word = StaffDocument.parse(
      ok(
        await upload(adminA, member.staffA, DOC, {
          contentType: 'application/msword',
          fileName: 'Fake agreement.doc',
          type: 'EMPLOYMENT_AGREEMENT',
        }),
        201,
      ),
    );
    expect(word.contentType).toBe('application/msword');
  });

  it('replaces a file (the old one archived), reclassifies and archives', async () => {
    const first = StaffDocument.parse(
      ok(await upload(ownerA, member.managerA, PDF, { type: 'NDA' }), 201),
    );
    const second = StaffDocument.parse(
      ok(await upload(ownerA, member.managerA, PDF, { type: 'NDA', replacesId: first.id }), 201),
    );
    const list = (
      ok(await call('get', `/staff/${member.managerA}/documents`, ownerA)) as {
        items: StaffDocument[];
      }
    ).items;
    expect(list.find((d) => d.id === first.id)?.archivedAt).toBeTruthy();
    expect(list.find((d) => d.id === second.id)?.archivedAt).toBeNull();
    const moved = StaffDocument.parse(
      ok(
        await call('patch', `/staff/${member.managerA}/documents/${second.id}`, ownerA, {
          type: 'OTHER',
        }),
      ),
    );
    expect(moved.type).toBe('OTHER');
    expectError(
      await call('patch', `/staff/${member.managerA}/documents/${first.id}`, ownerA, {
        type: 'W4',
      }),
      409,
      'CONFLICT',
    );
    for (let i = 0; i < 2; i++)
      expect(
        StaffDocument.parse(
          ok(
            await call('post', `/staff/${member.managerA}/documents/${second.id}/archive`, ownerA),
          ),
        ).archivedAt,
      ).toBeTruthy();
  });

  it('opens an upload token once, for its own member and author only', async () => {
    const ticket = ok(
      await call('post', `/staff/${member.staffA}/documents/uploads`, adminA, {
        type: 'W4',
        fileName: 'Fake.pdf',
        contentType: 'application/pdf',
        sizeBytes: PDF.length,
        sha256: sha256(PDF),
      }),
      201,
    ) as UploadTicket;
    storage.put(ticket, PDF);
    const confirm = (who: Who, id: string) =>
      call('post', `/staff/${id}/documents/uploads/confirm`, who, {
        uploadToken: ticket.uploadToken,
      });
    expectError(await confirm(adminA, member.managerA), 410, 'UPLOAD_EXPIRED');
    expectError(await confirm(ownerA, member.staffA), 410, 'UPLOAD_EXPIRED');
    ok(await confirm(adminA, member.staffA), 201);
    expectError(await confirm(adminA, member.staffA), 410, 'UPLOAD_EXPIRED');
  });

  it('records the scan outcomes the router can send', async () => {
    const doc = StaffDocument.parse(ok(await upload(adminA, member.staffA, PDF), 201));
    const key = await keyOf(doc.id);
    expect(
      await files.recordScan({ key, status: 'THREATS_FOUND', reasons: [], versionId: null }),
    ).toBe('INFECTED');
    expectError(
      await call('get', `/staff/${member.staffA}/documents/${doc.id}/download`, adminA),
      409,
      'DOCUMENT_NOT_READY',
    );
    const unknown = `tenant/${firms.a}/staff/${member.staffA}/${randomUUID()}`;
    expect(
      await files.recordScan({
        key: unknown,
        status: 'NO_THREATS_FOUND',
        reasons: [],
        versionId: null,
      }),
    ).toBe('UNKNOWN');
    expect(
      await files.recordScan({
        key: 'tenant/x/staff/y',
        status: 'NO_THREATS_FOUND',
        reasons: [],
        versionId: null,
      }),
    ).toBe('IGNORED');
  });

  it('is for Owners and Admins only, and an Admin never changes another Admin', async () => {
    expectError(await call('get', `/staff/${member.managerA}/documents`, staffA), 403, 'FORBIDDEN');
    expectError(
      await call('get', `/staff/${member.managerA}/documents`, managerA),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('post', `/staff/${member.admin2A}/documents/uploads`, adminA, {
        type: 'W4',
        fileName: 'Fake.pdf',
        contentType: 'application/pdf',
        sizeBytes: PDF.length,
        sha256: sha256(PDF),
      }),
      403,
      'FORBIDDEN',
    );
  });
});

describe('Bulk Upload Staff', () => {
  const columnMap = {
    'First Name': 'firstName',
    'Last Name': 'lastName',
    Email: 'email',
    Title: 'jobTitle',
    Role: 'role',
    Department: 'department',
    Type: 'employmentType',
    Hired: 'hireDate',
  } as const;
  const row = (key: string, over: Record<string, string> = {}) => ({
    'First Name': 'Fake',
    'Last Name': `Import ${key}`,
    Email: `r55d-import-${key}-${run}@r55.test`,
    Title: 'Tax Preparer',
    Role: 'TAX_PREPARER',
    Department: `Tax ${run}`,
    Type: 'Full-time',
    Hired: '2026-01-15',
    ...over,
  });

  it('previews, then imports once: new members, an update, and the rows it refused', async () => {
    const preview = StaffImportPreview.parse(
      ok(
        await call('post', '/staff/import/preview', adminA, {
          fileName: 'Fake staff.csv',
          columnMap,
          rows: [
            row('one'),
            row('two', {
              Type: '1099',
              Department: `closing ${run}`.toUpperCase().replace('CLOSING', 'Closing'),
            }),
            { Email: people.staffA.email, Title: 'Senior Preparer', Department: `Closing ${run}` },
            row('bad-email', { Email: 'not-an-email' }),
            row('one'),
            row('no-dept', { Department: 'Nowhere' }),
            row('admin', { Role: 'ADMIN' }),
            row('date', { Hired: '2026-02-30' }),
          ],
        }),
      ),
    );
    expect(preview).toMatchObject({ toCreate: 2, toUpdate: 1, invalid: 5 });
    expect(preview.errors.map((e) => [e.row, e.field])).toEqual([
      [4, 'email'],
      [5, 'email'],
      [6, 'department'],
      [7, 'role'],
      [8, 'hireDate'],
    ]);
    // Only its author imports it.
    expectError(
      await call('post', '/staff/import', admin2A, {
        previewToken: preview.previewToken,
        sendInvitations: false,
      }),
      400,
      'IMPORT_PREVIEW_EXPIRED',
    );
    const result = StaffImportResult.parse(
      ok(
        await call('post', '/staff/import', adminA, {
          previewToken: preview.previewToken,
          sendInvitations: true,
        }),
      ),
    );
    expect(result).toMatchObject({
      created: 2,
      updated: 1,
      failed: 0,
      invitationsSent: 2,
      errorFileUrl: null,
    });
    const made = await inFirm('a', (tx) =>
      tx.membership.findMany({
        where: { businessId: firms.a, user: { email: { startsWith: 'r55d-import-' } } },
        select: { role: true, status: true, staffProfile: { select: { employmentType: true } } },
      }),
    );
    expect(made).toHaveLength(2);
    expect(made.map((m) => m.staffProfile?.employmentType).sort()).toEqual([
      'FORM_1099',
      'FULL_TIME',
    ]);
    const staff = await inFirm('a', (tx) =>
      tx.membership.findUniqueOrThrow({
        where: { id: member.staffA },
        select: { jobTitle: true, departments: { select: { departmentId: true } } },
      }),
    );
    expect(staff.jobTitle).toBe('Senior Preparer');
    expect(staff.departments.map((d) => d.departmentId)).toContain(dept.closing);
    // Used once.
    expectError(
      await call('post', '/staff/import', adminA, {
        previewToken: preview.previewToken,
        sendInvitations: true,
      }),
      400,
      'IMPORT_PREVIEW_EXPIRED',
    );
    expectError(
      await call('post', '/staff/import', adminA, {
        previewToken: 'not-a-token',
        sendInvitations: true,
      }),
      400,
      'IMPORT_PREVIEW_EXPIRED',
    );
  });

  it('lists a row that fails at import in the error file, and goes on', async () => {
    const preview = StaffImportPreview.parse(
      ok(
        await call('post', '/staff/import/preview', ownerA, {
          fileName: 'Fake staff.csv',
          columnMap,
          rows: [row('late-1'), row('late-2', { Department: `Closing ${run}` })],
        }),
      ),
    );
    await inFirm('a', (tx) =>
      tx.department.update({ where: { id: dept.closing }, data: { status: 'INACTIVE' } }),
    );
    const result = StaffImportResult.parse(
      ok(
        await call('post', '/staff/import', ownerA, {
          previewToken: preview.previewToken,
          sendInvitations: false,
        }),
      ),
    );
    expect(result).toMatchObject({ created: 1, failed: 1, invitationsSent: 0 });
    const csv = Buffer.from(result.errorFileUrl!.split(',')[1]!, 'base64').toString();
    expect(csv).toContain(`2,r55d-import-late-2-${run}@r55.test,Choose an active department`);
    const audit = await inFirm('a', (tx) =>
      tx.auditLog.findFirstOrThrow({
        where: { businessId: firms.a, action: 'staff.imported', entityId: preview.previewToken },
      }),
    );
    expect(audit.metadata).toEqual({ created: 1, updated: 0, failed: 1, invitationsSent: 0 });
  });

  it('is for Owners and Admins', async () => {
    expectError(
      await call('post', '/staff/import/preview', staffA, {
        fileName: 'x.csv',
        columnMap,
        rows: [row('x')],
      }),
      403,
      'FORBIDDEN',
    );
  });
});

describe('firm B', () => {
  it("reaches none of firm A's members' documents", async () => {
    const doc = StaffDocument.parse(ok(await upload(ownerA, member.staffA, PDF), 201));
    for (const [method, path, body] of [
      ['get', `/staff/${member.staffA}/documents`, undefined],
      [
        'post',
        `/staff/${member.staffA}/documents/uploads`,
        {
          type: 'W4',
          fileName: 'x.pdf',
          contentType: 'application/pdf',
          sizeBytes: 1,
          sha256: sha256(PDF),
        },
      ],
      ['get', `/staff/${member.staffA}/documents/${doc.id}/download`, undefined],
      ['patch', `/staff/${member.staffA}/documents/${doc.id}`, { type: 'W4' }],
      ['post', `/staff/${member.staffA}/documents/${doc.id}/archive`, undefined],
    ] as const)
      expectError(await call(method, path, ownerB, body, 'b'), 404, 'NOT_FOUND');
  });
});
