// End-to-end: New Message's files (R60, MSG-F12; Octavia's review of Oct 27), on R36's
// outbound_message_files. Documents' three steps under tenant/{firm}/messages/, with Messages
// Settings' types and size; the scan through the router's `messages` prefix; a message sends only
// once every file is clean, and only on the Portal channel (files reach clients through their
// portal); a replaced draft keeps its files; the client's portal message shows them and opens them
// (PRIMARY and SPOUSE, as My Documents), and the firm opens them. Storage and the notify service are
// replaced: nothing leaves. Synthetic data only.
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { z } from 'zod';
import {
  OutboundFile as FileShape,
  OutboundMessage as MessageShape,
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
import { bigPdf, MemoryUploads } from '../memory-uploads.js';

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
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const Outbound = z.strictObject({ ...MessageShape.shape });
const OneFile = z.strictObject({ ...FileShape.shape });

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r60f-${key}-${run}@r60.test` });
const people = {
  ownerA: person('owner-a'),
  staffA: person('staff-a'),
  otherStaffA: person('other-staff-a'),
  primary: person('primary'),
  authorized: person('authorized'),
  otherClient: person('other-client'),
  ownerB: person('owner-b'),
};
const ids = { firmA: '', firmB: '', slugA: `r60f-a-${run}`, one: '', two: '', lead: '' };

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
async function call(
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  who: { email: string } = people.ownerA,
  body?: object,
  businessId = ids.firmA,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', businessId)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}
async function portal(path: string, who: { email: string }): Promise<Response> {
  return request(app.getHttpServer())
    .get(`/api/v1/portal/${ids.slugA}/me${path}`)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
}
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res;
};
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const draft = async (body: object, who = people.ownerA) =>
  Outbound.parse(ok(await call('post', '/outbound-messages', who, body), 201).body);
const get = async (id: string, who = people.ownerA) =>
  Outbound.parse(ok(await call('get', `/outbound-messages/${id}`, who)).body);

/** Ticket, PUT and confirm, as the browser does. */
async function attach(
  id: string,
  bytes: Buffer,
  over: Partial<{ fileName: string; contentType: string; declared: Buffer }> = {},
  who = people.ownerA,
): Promise<Response> {
  const declared = over.declared ?? bytes;
  const start = await call('post', `/outbound-messages/${id}/files/uploads`, who, {
    fileName: over.fileName ?? 'Fake organizer.pdf',
    contentType: over.contentType ?? 'application/pdf',
    sizeBytes: declared.length,
    sha256: sha256(declared),
  });
  if (start.status !== 201) return start;
  const ticket = start.body as UploadTicket;
  storage.uploads.send(ticket, bytes);
  return call('post', `/outbound-messages/${id}/files/uploads/confirm`, who, {
    uploadToken: ticket.uploadToken,
  });
}
/** GuardDuty's result for the file, through the scan router. */
async function scan(fileId: string, status: 'NO_THREATS_FOUND' | 'THREATS_FOUND') {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  const { s3Key } = await runInScope(owner, { kind: 'business', businessId: ids.firmA }, (tx) =>
    tx.outboundMessageFile.findUniqueOrThrow({ where: { id: fileId }, select: { s3Key: true } }),
  );
  await owner.$disconnect();
  return router.route({
    id: randomUUID(),
    time: new Date(),
    key: s3Key,
    status,
    reasons: [],
    versionId: null,
  });
}
const send = async (m: { id: string; updatedAt: string }) =>
  call('post', `/outbound-messages/${m.id}/send`, people.ownerA, { version: m.updatedAt });

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: ['primary', 'authorized', 'otherClient'].includes(key) ? 'CLIENT' : 'STAFF',
          email: p.email,
          name: `Fake ${key}`,
        },
      });
    }
    ids.firmA = (
      await tx.business.create({ data: { slug: ids.slugA, name: 'A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: `r60f-b-${run}`, name: 'B', status: 'ACTIVE' } })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const A = { businessId: ids.firmA };
    for (const [p, role] of [
      [people.ownerA, 'OWNER'],
      [people.staffA, 'STAFF'],
      [people.otherStaffA, 'STAFF'],
    ] as const)
      await tx.membership.create({ data: { ...A, userId: p.id, role, status: 'ACTIVE' } });
    ids.one = (
      await tx.client.create({
        data: {
          ...A,
          displayName: 'Fake One',
          email: `one-${run}@example.test`,
          assignedUserId: people.staffA.id,
        },
      })
    ).id;
    ids.two = (
      await tx.client.create({
        data: { ...A, displayName: 'Fake Two', email: `two-${run}@example.test` },
      })
    ).id;
    for (const [p, clientId, portalRole] of [
      [people.primary, ids.one, 'PRIMARY'],
      [people.authorized, ids.one, 'AUTHORIZED'],
      [people.otherClient, ids.two, 'PRIMARY'],
    ] as const)
      await tx.clientAccount.create({
        data: { ...A, userId: p.id, clientId, email: p.email, portalRole, status: 'ACTIVE' },
      });
    const service = await tx.service.create({ data: { ...A, kind: 'OTHER', name: `O ${run}` } });
    ids.lead = (
      await tx.lead.create({
        data: {
          ...A,
          serviceId: service.id,
          firstName: 'Fake',
          lastName: 'Lead',
          email: `lead-${run}@example.test`,
          taxYear: 2025,
          status: 'SUBMITTED',
          submittedAt: new Date(),
        },
      })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, (tx) =>
    tx.membership.create({
      data: { businessId: ids.firmB, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    }),
  );
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

describe('MSG-F12: files on a New Message draft', () => {
  it('uploads under the messages prefix, CHECKING until the scan, then READY; removes while a draft', async () => {
    const d = await draft({ channel: 'PORTAL', body: `Files ${run}`, clientIds: [ids.one] });
    expect(d.files).toEqual([]);
    const file = OneFile.parse(ok(await attach(d.id, PDF), 201).body);
    expect(file).toMatchObject({ fileName: 'Fake organizer.pdf', status: 'CHECKING' });
    expect(
      [...storage.objects.keys()].some((k) => k.startsWith(`tenant/${ids.firmA}/messages/`)),
    ).toBe(true);
    expect((await get(d.id)).files.map((f) => f.status)).toEqual(['CHECKING']);
    expect((await scan(file.id, 'NO_THREATS_FOUND')).outcome).toBe('CLEAN');
    // Set once: a second result is ignored.
    expect((await scan(file.id, 'THREATS_FOUND')).outcome).toBe('IGNORED');
    expect((await get(d.id)).files.map((f) => f.status)).toEqual(['READY']);
    const second = OneFile.parse(
      ok(await attach(d.id, PNG, { fileName: 'Fake.png', contentType: 'image/png' }), 201).body,
    );
    ok(await call('delete', `/outbound-messages/${d.id}/files/${second.id}`), 200);
    expect((await get(d.id)).files.map((f) => f.id)).toEqual([file.id]);
    expect((await call('delete', `/outbound-messages/${d.id}/files/${second.id}`)).status).toBe(
      404,
    );
  });

  it("follows Messages Settings' types and size, at most 10 files, and refuses bytes that are not the file", async () => {
    const d = await draft({ channel: 'PORTAL', body: 'Limits', clientIds: [ids.one] });
    // Excel is a type the settings leave out by default.
    expect(
      codeOf(
        await attach(d.id, PDF, {
          fileName: 'Fake.xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      ),
    ).toBe('ATTACHMENT_TYPE');
    expect(codeOf(await attach(d.id, PDF, { fileName: 'Fake.png' }))).toBe('ATTACHMENT_TYPE');
    expect(codeOf(await attach(d.id, bigPdf(11 * 1024 * 1024)))).toBe('ATTACHMENT_TOO_LARGE');
    expect(codeOf(await attach(d.id, PNG, { declared: PDF }))).toBe('UPLOAD_MISMATCH');
    for (let i = 0; i < 10; i += 1) ok(await attach(d.id, PDF, { fileName: `Fake ${i}.pdf` }), 201);
    expect(codeOf(await attach(d.id, PDF))).toBe('TOO_MANY_FILES');
  });

  it('takes a larger file in parts when Messages Settings allow it', async () => {
    ok(
      await call('patch', '/message-settings', people.ownerA, {
        version: null,
        attachmentMaxMb: 20,
      }),
    );
    const d = await draft({ channel: 'PORTAL', body: 'Big', clientIds: [ids.one] });
    const big = OneFile.parse(ok(await attach(d.id, bigPdf()), 201).body);
    expect(big.sizeBytes).toBeGreaterThan(16 * 1024 * 1024);
    expect(storage.uploads.completed.size).toBeGreaterThan(0);
  });

  it('only on a draft the actor reaches, and a token only for its own message', async () => {
    const d = await draft(
      { channel: 'PORTAL', body: 'Reach', clientIds: [ids.one] },
      people.staffA,
    );
    // Staff reach only their own drafts; another firm never.
    expect((await attach(d.id, PDF, {}, people.otherStaffA)).status).toBe(404);
    const facts = {
      fileName: 'Fake.pdf',
      contentType: 'application/pdf',
      sizeBytes: PDF.length,
      sha256: sha256(PDF),
    };
    expect(
      (
        await call(
          'post',
          `/outbound-messages/${d.id}/files/uploads`,
          people.ownerB,
          facts,
          ids.firmB,
        )
      ).status,
    ).toBe(404);
    ok(await attach(d.id, PDF, {}, people.staffA), 201);
    const ticket = ok(
      await call('post', `/outbound-messages/${d.id}/files/uploads`, people.staffA, facts),
      201,
    ).body as UploadTicket;
    storage.uploads.send(ticket, PDF);
    const other = await draft(
      { channel: 'PORTAL', body: 'Other', clientIds: [ids.one] },
      people.staffA,
    );
    expect(
      codeOf(
        await call('post', `/outbound-messages/${other.id}/files/uploads/confirm`, people.staffA, {
          uploadToken: ticket.uploadToken,
        }),
      ),
    ).toBe('UPLOAD_EXPIRED');
  });
});

describe('MSG-F12: sending with files', () => {
  it('sends once every file is clean, only on Portal; a replaced draft keeps its files', async () => {
    const body = { subject: 'Your organizer', body: `Sent ${run}` };
    const first = await draft({ channel: 'PORTAL', ...body, clientIds: [ids.one] });
    const file = OneFile.parse(ok(await attach(first.id, PDF), 201).body);
    expect(codeOf(await send(first))).toBe('FILES_NOT_READY');
    const review = ok(await call('get', `/outbound-messages/${first.id}/review`)).body as {
      checks: { code: string; severity: string }[];
    };
    expect(review.checks).toContainEqual(
      expect.objectContaining({ code: 'FILES_NOT_READY', severity: 'BLOCK' }),
    );
    await scan(file.id, 'NO_THREATS_FOUND');
    // Email: another channel makes a new draft, which keeps the file and its scan.
    const email = Outbound.parse(
      ok(
        await call('put', `/outbound-messages/${first.id}`, people.ownerA, {
          version: (await get(first.id)).updatedAt,
          channel: 'EMAIL',
          ...body,
          clientIds: [ids.one],
        }),
      ).body,
    );
    expect(email.id).not.toBe(first.id);
    expect(email.files.map((f) => [f.fileName, f.status])).toEqual([
      ['Fake organizer.pdf', 'READY'],
    ]);
    expect((await get(first.id)).files).toEqual([]);
    expect(codeOf(await send(email))).toBe('FILES_NEED_PORTAL');
    const portalDraft = Outbound.parse(
      ok(
        await call('put', `/outbound-messages/${email.id}`, people.ownerA, {
          version: email.updatedAt,
          channel: 'PORTAL',
          ...body,
          clientIds: [ids.one, ids.two],
        }),
      ).body,
    );
    const sent = Outbound.parse(ok(await send(portalDraft)).body);
    expect(sent.status).toBe('SENT');
    expect(sent.files).toHaveLength(1);
    // Fixed once sent.
    expect(
      codeOf(await call('delete', `/outbound-messages/${sent.id}/files/${sent.files[0]!.id}`)),
    ).toBe('NOT_EDITABLE');
    expect(codeOf(await attach(sent.id, PDF))).toBe('NOT_EDITABLE');
  });

  it('refuses a message with a file that failed its scan', async () => {
    const d = await draft({ channel: 'PORTAL', body: 'Blocked', clientIds: [ids.one] });
    const file = OneFile.parse(ok(await attach(d.id, PDF), 201).body);
    expect((await scan(file.id, 'THREATS_FOUND')).outcome).toBe('INFECTED');
    const now = await get(d.id);
    expect(now.files[0]?.status).toBe('BLOCKED');
    expect(codeOf(await send(now))).toBe('FILE_BLOCKED');
  });
});

describe('MSG-F12: who sees and opens a sent file', () => {
  const sentFile = async () => {
    const d = await draft({
      channel: 'PORTAL',
      subject: 'Open me',
      body: `Open ${run}`,
      clientIds: [ids.one],
    });
    const file = OneFile.parse(ok(await attach(d.id, PDF), 201).body);
    await scan(file.id, 'NO_THREATS_FOUND');
    const sent = Outbound.parse(ok(await send(await get(d.id))).body);
    return { file, threadId: sent.recipients[0]!.threadId! };
  };
  type Thread = { messages: { attachments: { kind: string; id: string; status: string }[] }[] };

  it("the client's PRIMARY login sees and opens it; an AUTHORIZED login and another client do not", async () => {
    const { file, threadId } = await sentFile();
    const mine = ok(await portal(`/messages/${threadId}`, people.primary)).body as Thread;
    expect(mine.messages[0]?.attachments).toEqual([
      expect.objectContaining({ kind: 'FILE', id: file.id, status: 'READY' }),
    ]);
    const link = ok(await portal(`/messages/files/${file.id}/download`, people.primary)).body as {
      url: string;
    };
    expect(link.url).toContain(`tenant/${ids.firmA}/messages/`);
    const theirs = ok(await portal(`/messages/${threadId}`, people.authorized)).body as Thread;
    expect(theirs.messages[0]?.attachments).toEqual([]);
    expect((await portal(`/messages/files/${file.id}/download`, people.authorized)).status).toBe(
      404,
    );
    expect((await portal(`/messages/files/${file.id}/download`, people.otherClient)).status).toBe(
      404,
    );
  });

  it('the firm opens it: the Owner and Staff whose client got it; other Staff and another firm get 404', async () => {
    const { file, threadId } = await sentFile();
    const thread = ok(await call('get', `/message-threads/${threadId}`)).body as Thread;
    expect(thread.messages[0]?.attachments).toEqual([
      expect.objectContaining({ kind: 'FILE', id: file.id }),
    ]);
    ok(await call('get', `/message-files/${file.id}/download`));
    ok(await call('get', `/message-files/${file.id}/download`, people.staffA));
    expect(
      (await call('get', `/message-files/${file.id}/download`, people.otherStaffA)).status,
    ).toBe(404);
    expect(
      (await call('get', `/message-files/${file.id}/download`, people.ownerB, undefined, ids.firmB))
        .status,
    ).toBe(404);
  });

  it('a file still being checked does not open', async () => {
    const d = await draft({ channel: 'PORTAL', body: 'Pending', clientIds: [ids.one] });
    const file = OneFile.parse(ok(await attach(d.id, PDF), 201).body);
    expect(codeOf(await call('get', `/message-files/${file.id}/download`))).toBe('SCAN_PENDING');
  });
});
