// End-to-end: the applicant's answer to a request for more information (SA-APP-F04, Y02, Y05,
// Y06), on the public /apply/respond page's routes: the emailed link (only its hash is stored),
// the 6-digit code at the contact email (locally 000000), the 30-minute pass, PDF and PNG files
// in the documents bucket (an in-memory store here) and text, on the same application; the request
// closes, the application goes back to In Review, the reviewer (or every Super Admin) gets an
// in-app item, and reviewers open a file only once its scan came back clean. Synthetic data only.
import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import {
  ApplicationResponseRequestView,
  ApplicationResponseSession,
  FirmApplicationFileLink,
  SubmitApplicationResponseResponse,
  UploadPutTicket,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import {
  ApplyRespondService,
  RESPONSE_CODE_LIMITS,
} from '../../src/firm-applications/apply-respond.service.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig } from '../../src/storage/config.js';
import { DOCUMENT_STORAGE, type DocumentStorage } from '../../src/storage/document-storage.js';

const fx = inject('fixtures');
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

class MemoryStorage implements DocumentStorage {
  readonly objects = new Map<string, Buffer>();
  presignUpload(file: { key: string; contentType: string }) {
    return Promise.resolve({
      method: 'PUT' as const,
      url: `memory:${file.key}`,
      headers: { 'content-type': file.contentType },
    });
  }
  completeUpload() {
    return Promise.resolve('MISSING' as const);
  }
  abortUpload() {
    return Promise.resolve();
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
  put(ticket: UploadPutTicket, bytes: Buffer) {
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
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

let app: INestApplication;
let adminToken: string;
const sent: NotifyMessage[] = [];
const tag = `r56rs${randomUUID().slice(0, 8)}`;
const ids = { assigned: randomUUID(), open: randomUUID(), other: randomUUID() };

async function asOwner<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  try {
    return await runInScope(owner, { kind: 'platform' }, fn);
  } finally {
    await owner.$disconnect();
  }
}
const admin = (method: 'post' | 'put', path: string, body: object) =>
  request(app.getHttpServer())
    [method](`/api/v1/admin/firm-applications${path}`)
    .set('authorization', `Bearer ${adminToken}`)
    .send(body);
let ips = 0;
/** Each call from its own address, so the per-IP bursts never trip in a test. */
const respond = (path: string, body: object) =>
  request(app.getHttpServer())
    .post(`/api/v1/firm-applications/respond${path}`)
    .set('x-forwarded-for', `198.51.${Math.floor(++ips / 250)}.${ips % 250}, 10.0.0.5`)
    .send(body);
const codeOf = (res: request.Response) => (res.body as { error?: { code: string } }).error?.code;
const ok = (res: request.Response) => {
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as unknown;
};
/** Asks the applicant for information and returns the emailed link's token. */
async function ask(id: string, message: string): Promise<string> {
  sent.length = 0;
  ok(await admin('post', `/${id}/request-info`, { message }));
  const mail = sent.find((m) => m.template === 'firm-application.info-requested');
  const link = (mail?.data as { link: string }).link;
  return link.slice(link.indexOf('#token=') + 7);
}
async function pass(token: string): Promise<string> {
  ok(await respond('/code', { token }));
  return ApplicationResponseSession.parse(ok(await respond('/verify', { token, code: '000000' })))
    .session;
}
async function upload(session: string, name: string, type: string, bytes: Buffer) {
  const ticket = UploadPutTicket.parse(
    ok(
      await respond('/uploads', {
        session,
        fileName: name,
        contentType: type,
        sizeBytes: bytes.length,
        sha256: sha256(bytes),
      }),
    ),
  );
  storage.put(ticket, bytes);
  return ticket.uploadToken;
}

beforeAll(async () => {
  await asOwner(async (tx) => {
    let n = 0;
    for (const id of Object.values(ids)) {
      n += 1;
      await tx.firmApplication.create({
        data: {
          id,
          legalName: `Sample Respond ${tag} ${n}`,
          contactName: `Casey Example ${n}`,
          contactEmail: `casey${n}@${tag}.example.test`,
          contactPhone: '+14045550102',
          data: {},
        },
      });
    }
  });
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({ send: (m: NotifyMessage) => (sent.push(m), Promise.resolve()) })
    .overrideProvider(DOCUMENT_STORAGE)
    .useValue(storage)
    .overrideProvider(DOCUMENTS_CONFIG)
    .useValue(config)
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.init();
  app = nest;
  adminToken = (
    (
      await request(app.getHttpServer())
        .post('/api/v1/dev/token')
        .send({ email: fx.users.admin.email })
    ).body as { token: string }
  ).token;
  RESPONSE_CODE_LIMITS.resendGapMs = 0;
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  sent.length = 0;
});

describe('the applicant’s answer (SA-APP-F04)', () => {
  it('link, code, files and text on the same application; back to In Review; the reviewer is told', async () => {
    ok(await admin('put', `/${ids.assigned}/reviewer`, { userId: fx.users.admin.id }));
    const token = await ask(ids.assigned, 'Please send your PTIN and a license copy.');

    const view = ApplicationResponseRequestView.parse(ok(await respond('/open', { token })));
    expect(view).toMatchObject({
      legalName: `Sample Respond ${tag} 1`,
      reason: 'Please send your PTIN and a license copy.',
      codeSentTo: `ca***@${tag}.example.test`,
    });
    // No code yet: nothing to check.
    expect(codeOf(await respond('/verify', { token, code: '000000' }))).toBe('CODE_INVALID');
    sent.length = 0;
    ok(await respond('/code', { token }));
    expect(sent).toEqual([
      expect.objectContaining({
        template: 'firm-application.response-code',
        to: `casey1@${tag}.example.test`,
        data: { name: 'Casey Example 1', code: '000000' },
      }),
    ]);
    // A wrong code counts a try; the right one opens a pass once.
    expect(codeOf(await respond('/verify', { token, code: '123456' }))).toBe('CODE_INVALID');
    const { session } = ApplicationResponseSession.parse(
      ok(await respond('/verify', { token, code: '000000' })),
    );
    expect(codeOf(await respond('/verify', { token, code: '000000' }))).toBe('CODE_INVALID');
    const codes = await asOwner((tx) =>
      tx.firmApplicationResponseCode.findMany({
        where: { request: { applicationId: ids.assigned } },
      }),
    );
    expect(codes).toHaveLength(1);
    expect(codes[0]?.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(codes[0]?.consumedAt).not.toBeNull();

    const files = [
      await upload(session, 'ptin-letter.pdf', 'application/pdf', PDF),
      await upload(session, 'license.png', 'image/png', PNG),
    ];
    const done = SubmitApplicationResponseResponse.parse(
      ok(
        await respond('', {
          session,
          text: 'PTIN P01234567; license attached.',
          uploadTokens: files,
        }),
      ),
    );
    expect(Date.parse(done.submittedAt)).toBeGreaterThan(Date.now() - 60_000);

    const after = await asOwner(async (tx) => ({
      app: await tx.firmApplication.findUniqueOrThrow({ where: { id: ids.assigned } }),
      requests: await tx.firmApplicationInfoRequest.findMany({
        where: { applicationId: ids.assigned },
      }),
      responses: await tx.firmApplicationResponse.findMany({
        where: { applicationId: ids.assigned },
        include: { files: true },
      }),
      bell: await tx.platformNotification.findMany({ where: { sourceId: ids.assigned } }),
      audit: await tx.auditLog.findMany({
        where: { entityId: ids.assigned, action: 'firm_application.responded' },
      }),
    }));
    expect(after.app.status).toBe('IN_REVIEW');
    expect(after.requests.map((r) => r.status)).toEqual(['RESPONDED']);
    expect(after.responses).toHaveLength(1);
    expect(after.responses[0]?.text).toBe('PTIN P01234567; license attached.');
    const stored = after.responses[0]?.files ?? [];
    expect(stored.map((f) => [f.fileName, f.contentType, f.scanStatus]).sort()).toEqual([
      ['license.png', 'image/png', 'PENDING'],
      ['ptin-letter.pdf', 'application/pdf', 'PENDING'],
    ]);
    for (const f of stored)
      expect(
        f.s3Key.startsWith(`tenant/${ids.assigned}/applications/${after.responses[0]?.id}/`),
      ).toBe(true);
    expect(after.bell).toEqual([
      expect.objectContaining({
        recipientUserId: fx.users.admin.id,
        category: 'FIRM_APPLICATIONS',
        sourceType: 'firm_application',
        attention: 'ACTION_REQUIRED',
      }),
    ]);
    expect(after.audit).toHaveLength(1);
    expect(JSON.stringify(after.audit[0]?.metadata)).not.toContain('PTIN');

    // Reviewers open a file only once it is scanned clean.
    const pdf = stored.find((f) => f.contentType === 'application/pdf')!;
    const link = (fileId: string) =>
      request(app.getHttpServer())
        .get(`/api/v1/admin/firm-applications/${ids.assigned}/files/${fileId}`)
        .set('authorization', `Bearer ${adminToken}`);
    expect((await link(pdf.id)).status).toBe(409);
    const handled = await app.get(ApplyRespondService).handle({
      businessId: ids.assigned,
      prefix: 'applications',
      key: pdf.s3Key,
      path: pdf.s3Key.split('/applications/')[1] ?? '',
      status: 'NO_THREATS_FOUND',
      reasons: [],
      versionId: null,
      eventTime: new Date(),
      eventId: randomUUID(),
    });
    expect(handled).toBe('CLEAN');
    FirmApplicationFileLink.parse(ok(await link(pdf.id)));

    // The link is answered: it no longer opens, and the pass sends nothing more.
    expect(codeOf(await respond('/open', { token }))).toBe('LINK_EXPIRED');
    expect(codeOf(await respond('', { session, text: 'Again' }))).toBe('LINK_EXPIRED');
  });

  it('notifies every Super Admin when nobody is assigned', async () => {
    const token = await ask(ids.open, 'Please send your EIN letter.');
    const session = await pass(token);
    ok(await respond('', { session, text: 'EIN letter is on its way by mail.' }));
    const bell = await asOwner((tx) =>
      tx.platformNotification.findMany({ where: { sourceId: ids.open } }),
    );
    expect(bell.map((b) => b.recipientUserId)).toContain(fx.users.admin.id);
    const supers = await asOwner((tx) =>
      tx.platformAdmin.count({ where: { role: 'SUPER_ADMIN' } }),
    );
    expect(bell).toHaveLength(supers);
  });

  it('refuses an unknown or replaced link, a forged pass, another application’s file and bad input', async () => {
    expect(codeOf(await respond('/open', { token: 'A'.repeat(43) }))).toBe('LINK_EXPIRED');
    expect((await respond('/open', { token: 'short' })).status).toBe(400);
    const first = await ask(ids.other, 'Please send your license.');
    const theirs = await ask(ids.open, 'One more: your insurance certificate.');
    // A repeat request replaces the earlier link.
    const token = await ask(ids.other, 'Please send your license, both sides.');
    expect(codeOf(await respond('/open', { token: first }))).toBe('LINK_EXPIRED');
    expect(codeOf(await respond('/code', { token: first }))).toBe('LINK_EXPIRED');

    const session = await pass(token);
    const stranger = await upload(await pass(theirs), 'cert.pdf', 'application/pdf', PDF);
    expect(codeOf(await respond('', { session, uploadTokens: [stranger] }))).toBe('UPLOAD_EXPIRED');
    expect(codeOf(await respond('', { session: 'forged', text: 'Hi' }))).toBe('SESSION_EXPIRED');
    // Text, files or both: never nothing; only PDF, JPG or PNG, up to 10 MB.
    expect((await respond('', { session })).status).toBe(400);
    expect(
      (
        await respond('/uploads', {
          session,
          fileName: 'notes.txt',
          contentType: 'text/plain',
          sizeBytes: 10,
          sha256: sha256(Buffer.from('x')),
        })
      ).status,
    ).toBe(400);
    // A file that is not what it says is refused and deleted.
    const fake = await upload(session, 'license.png', 'image/png', PDF);
    expect(codeOf(await respond('', { session, uploadTokens: [fake] }))).toBe('UPLOAD_MISMATCH');
    expect(storage.objects.size).toBeGreaterThan(0);

    // Five wrong codes lock the code; a new one works.
    ok(await respond('/code', { token }));
    for (let i = 0; i < 5; i++)
      expect(codeOf(await respond('/verify', { token, code: '111111' }))).toBe('CODE_INVALID');
    const locked = await respond('/verify', { token, code: '000000' });
    expect([locked.status, codeOf(locked)]).toEqual([429, 'CODE_LOCKED']);
    ok(await respond('/code', { token }));
    ApplicationResponseSession.parse(ok(await respond('/verify', { token, code: '000000' })));
  });
});
