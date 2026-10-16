// End-to-end: R1 step 19. GuardDuty's scan results as SQS messages (the event shaped like AWS's
// samples) through the consumer, the router and the documents handler, against the test database:
// CLEAN (and a download), q24's password-protected PDF, our side (PENDING), a repeat, a result
// before its document, an orphan upload, and the isolation the Scrum asked for (point 4): a
// result for firm B's key never touches firm A's rows, and a handler's scope is its key's firm
// only. The queue is a fake that records deletes; its long poll waits until shutdown, so the
// consumer's own loop never takes a message: each test hands one to `handle`. Storage is in memory.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { createPrismaClient, type Database, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { DATABASE } from '../../src/database/database.module.js';
import { NOTIFY_SERVICE } from '../../src/notify/notify.types.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig } from '../../src/storage/config.js';
import { DOCUMENT_STORAGE, type DocumentStorage } from '../../src/storage/document-storage.js';
import { ORPHAN_AFTER_MS } from '../../src/storage/document-scan-handler.js';
import { SCAN_QUEUE_CONFIG, type ScanQueueConfig } from '../../src/storage/scan-queue/config.js';
import { ScanResultConsumer } from '../../src/storage/scan-queue/scan-consumer.js';
import { ScanResultRouter } from '../../src/storage/scan-queue/scan-router.js';
import {
  type QueueMessage,
  SCAN_QUEUE,
  type ScanQueue,
} from '../../src/storage/scan-queue/sqs-scan-queue.js';
import type { ScanResult } from '../../src/storage/scan-results.service.js';
import { pdf, sha256 } from '../office-files.js';

const ACCOUNT = '778127141557';
const REGION = 'us-east-1';
const BUCKET = 'firmivra-dev-documents-778127141557';
const scanConfig: ScanQueueConfig = {
  nodeEnv: 'test',
  bucket: BUCKET,
  queue: {
    url: `https://sqs.${REGION}.amazonaws.com/${ACCOUNT}/firmivra-dev-malware-scan-results`,
    region: REGION,
    account: ACCOUNT,
  },
};

/** Storage in memory, as documents-portal.e2e's. */
class MemoryStorage implements DocumentStorage {
  readonly objects = new Map<string, Buffer>();
  presignUpload(file: { key: string; contentType: string }) {
    return Promise.resolve({ url: `memory:${file.key}`, headers: {} });
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

/** The queue: records deletes; its long poll only ends at shutdown. */
class FakeQueue implements ScanQueue {
  readonly deleted: string[] = [];
  readonly retried: string[] = [];
  receive(signal: AbortSignal): Promise<QueueMessage[]> {
    return new Promise((resolve) =>
      signal.addEventListener('abort', () => resolve([]), { once: true }),
    );
  }
  delete(receiptHandle: string) {
    this.deleted.push(receiptHandle);
    return Promise.resolve();
  }
  retryAfter(receiptHandle: string) {
    this.retried.push(receiptHandle);
    return Promise.resolve();
  }
}

const storage = new MemoryStorage();
const queue = new FakeQueue();
const documentsConfig: DocumentsConfig = {
  bucket: BUCKET,
  region: REGION,
  forcePathStyle: true,
  scanMode: 'guardduty',
};

const run = randomUUID().slice(0, 8);
const people = {
  ownerA: { id: randomUUID(), email: `scanq-owner-a-${run}@r1.test`, name: 'Fake Owner A' },
  ownerB: { id: randomUUID(), email: `scanq-owner-b-${run}@r1.test`, name: 'Fake Owner B' },
};
type Firm = 'a' | 'b';
const firms = {} as Record<
  Firm,
  { id: string; slug: string; clientId: string; engagementId: string }
>;

let app: INestApplication;
let consumer: ScanResultConsumer;
let database: Database;
const fx = inject('fixtures');

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

/** A confirmed upload as confirm saves it: PENDING, its bytes in storage. */
async function document(firm: Firm, key = `tenant/${firms[firm].id}/documents/${randomUUID()}`) {
  const bytes = pdf(`scan ${randomUUID()}`);
  storage.objects.set(key, bytes);
  const { id: businessId, clientId, engagementId } = firms[firm];
  const doc = await asOwner(businessId, (tx) =>
    tx.document.create({
      data: {
        businessId,
        clientId,
        engagementId,
        direction: 'CLIENT_TO_FIRM',
        fileName: 'W-2_2025.pdf',
        contentType: 'application/pdf',
        sizeBytes: bytes.length,
        sha256: sha256(bytes),
        s3Key: key,
      },
      select: { id: true, s3Key: true },
    }),
  );
  return { id: doc.id, key: doc.s3Key };
}
const docRow = (firm: Firm, id: string) =>
  asOwner(firms[firm].id, (tx) =>
    tx.document.findUniqueOrThrow({ where: { id }, select: { scanStatus: true, scannedAt: true } }),
  );
const auditOf = (firm: Firm, entityId: string) =>
  asOwner(firms[firm].id, (tx) =>
    tx.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } }),
  );
const firmAudits = (firm: Firm) =>
  asOwner(firms[firm].id, (tx) => tx.auditLog.count({ where: { businessId: firms[firm].id } }));

/** An SQS message whose body is GuardDuty's event for `key`, as AWS's samples show it. */
function message(
  key: string,
  status: ScanResult['status'],
  reasons: string[] | null = null,
  over: { bucket?: string; account?: string; time?: Date } = {},
): QueueMessage {
  const event = {
    version: '0',
    id: randomUUID(),
    'detail-type': 'GuardDuty Malware Protection Object Scan Result',
    source: 'aws.guardduty',
    account: over.account ?? ACCOUNT,
    time: (over.time ?? new Date()).toISOString(),
    region: REGION,
    resources: [`arn:aws:guardduty:${REGION}:${ACCOUNT}:malware-protection-plan/fakeplanid`],
    detail: {
      schemaVersion: '1.0',
      scanStatus: reasons ? 'SKIPPED' : 'COMPLETED',
      resourceType: 'S3_OBJECT',
      s3ObjectDetails: {
        bucketName: over.bucket ?? BUCKET,
        objectKey: key,
        eTag: 'fake-etag',
        versionId: 'fakeVersion.1',
        s3Throttled: false,
      },
      scanResultDetails: {
        scanResultStatus: status,
        threats: status === 'THREATS_FOUND' ? [{ name: 'Fake-Test-Threat' }] : null,
        statusReasons: reasons,
      },
    },
  };
  return {
    messageId: randomUUID(),
    receiptHandle: `rh-${randomUUID()}`,
    body: JSON.stringify(event),
    receiveCount: 1,
  };
}
const deleted = (m: QueueMessage) => queue.deleted.includes(m.receiptHandle);

beforeAll(async () => {
  await asOwner(null, async (tx) => {
    for (const { id, email, name } of Object.values(people)) {
      await tx.user.create({ data: { id, cognitoSub: id, pool: 'STAFF', email, name } });
    }
  });
  for (const [key, owner] of [
    ['a', people.ownerA],
    ['b', people.ownerB],
  ] as const) {
    const slug = `scanq-${key}-${run}`;
    const { id } = await asOwner(null, (tx) =>
      tx.business.create({ data: { slug, name: slug, status: 'ACTIVE' }, select: { id: true } }),
    );
    firms[key] = await asOwner(id, async (tx) => {
      await tx.membership.create({
        data: { businessId: id, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
      });
      const client = await tx.client.create({
        data: { businessId: id, displayName: 'Scan Client (fake)' },
      });
      const service = await tx.service.create({
        data: { businessId: id, kind: 'ANNUAL_TAX', name: 'ANNUAL_TAX' },
      });
      const engagement = await tx.engagement.create({
        data: {
          businessId: id,
          clientId: client.id,
          serviceId: service.id,
          title: 'Scan (fake)',
          taxYear: 2025,
          status: 'ACTIVE',
        },
      });
      return { id, slug, clientId: client.id, engagementId: engagement.id };
    });
  }

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
    .useValue(documentsConfig)
    .overrideProvider(SCAN_QUEUE_CONFIG)
    .useValue(scanConfig)
    .overrideProvider(SCAN_QUEUE)
    .useValue(queue)
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({ send: () => Promise.resolve() })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
  consumer = nest.get(ScanResultConsumer);
  database = nest.get(DATABASE);
});

afterAll(async () => {
  // Shutdown ends the consumer's long poll (the fake's receive resolves on abort).
  await app.close();
});

afterEach(() => vi.restoreAllMocks());

describe('scan results through the queue (documents)', () => {
  it('makes a PENDING document CLEAN, audits it, deletes the message and allows the download', async () => {
    const d = await document('a');
    const m = message(d.key, 'NO_THREATS_FOUND');
    expect(await consumer.handle(m)).toEqual({ outcome: 'CLEAN', deleted: true });
    expect(deleted(m)).toBe(true);
    expect((await docRow('a', d.id)).scanStatus).toBe('CLEAN');
    const scanned = (await auditOf('a', d.id)).filter((a) => a.action === 'document.scanned');
    expect(scanned.map((a) => a.metadata)).toEqual([
      {
        clientId: firms.a.clientId,
        scanStatus: 'CLEAN',
        result: 'NO_THREATS_FOUND',
        reasons: [],
      },
    ]);
    const token = await request(app.getHttpServer())
      .post('/api/v1/dev/token')
      .send({ email: people.ownerA.email });
    const res = await request(app.getHttpServer())
      .get(`/api/v1/business/documents/${d.id}/download`)
      .set('authorization', `Bearer ${(token.body as { token: string }).token}`)
      .set('x-business-id', firms.a.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it("accepts a password-protected PDF unscanned (q24), from the event's statusReasons", async () => {
    const d = await document('a');
    const m = message(d.key, 'UNSUPPORTED', ['PASSWORD_PROTECTED']);
    expect(await consumer.handle(m)).toEqual({ outcome: 'UNSCANNED', deleted: true });
    expect((await docRow('a', d.id)).scanStatus).toBe('CLEAN');
    const entry = (await auditOf('a', d.id)).find((a) => a.action === 'document.scanned');
    expect(entry?.metadata).toMatchObject({ reasons: ['PASSWORD_PROTECTED'], unscanned: true });
  });

  it('leaves our side PENDING with a scan_unfinished row, and deletes the message', async () => {
    const d = await document('a');
    const m = message(d.key, 'ACCESS_DENIED', ['UNAUTHORIZED_TO_GET_OBJECT']);
    expect(await consumer.handle(m)).toEqual({ outcome: 'PENDING', deleted: true });
    expect(await docRow('a', d.id)).toEqual({ scanStatus: 'PENDING', scannedAt: null });
    const actions = (await auditOf('a', d.id)).map((a) => a.action);
    expect(actions).toEqual(['document.scan_unfinished']);
  });

  it('takes a repeated result as IGNORED, deletes it, and audits the scan once', async () => {
    const d = await document('a');
    const first = message(d.key, 'THREATS_FOUND');
    const again = { ...first, receiptHandle: `rh-${randomUUID()}`, receiveCount: 2 };
    expect(await consumer.handle(first)).toEqual({ outcome: 'INFECTED', deleted: true });
    expect(await consumer.handle(again)).toEqual({ outcome: 'IGNORED', deleted: true });
    const actions = (await auditOf('a', d.id)).map((a) => a.action);
    expect(actions).toEqual(['document.scanned']);
    expect((await docRow('a', d.id)).scanStatus).toBe('INFECTED');
  });

  it('keeps a result that comes before its document, then records it on redelivery', async () => {
    const key = `tenant/${firms.a.id}/documents/${randomUUID()}`;
    const early = message(key, 'NO_THREATS_FOUND');
    expect(await consumer.handle(early)).toEqual({ outcome: 'UNKNOWN', deleted: false });
    // The first receives come back after 20 s, not the queue's 120 s.
    expect([deleted(early), queue.retried.includes(early.receiptHandle)]).toEqual([false, true]);
    const d = await document('a', key);
    const redelivered = { ...early, receiptHandle: `rh-${randomUUID()}`, receiveCount: 2 };
    expect(await consumer.handle(redelivered)).toEqual({ outcome: 'CLEAN', deleted: true });
    expect((await docRow('a', d.id)).scanStatus).toBe('CLEAN');
  });

  it('ignores an orphan upload once the confirm window has passed, and keeps it before', async () => {
    const key = `tenant/${firms.a.id}/documents/${randomUUID()}`;
    const inWindow = message(key, 'NO_THREATS_FOUND', null, {
      time: new Date(Date.now() - ORPHAN_AFTER_MS + 60_000),
    });
    expect(await consumer.handle(inWindow)).toEqual({ outcome: 'UNKNOWN', deleted: false });
    const late = message(key, 'NO_THREATS_FOUND', null, {
      time: new Date(Date.now() - ORPHAN_AFTER_MS - 60_000),
    });
    const before = await firmAudits('a');
    expect(await consumer.handle(late)).toEqual({ outcome: 'IGNORED', deleted: true });
    expect(await firmAudits('a')).toBe(before);
    expect(ORPHAN_AFTER_MS).toBe(20 * 60_000);
  });
});

describe('a result for firm B never touches firm A', () => {
  /** Every scope the API's database opens while `work` runs. */
  async function scopesOf(work: () => Promise<unknown>): Promise<unknown[]> {
    const spy = vi.spyOn(database, 'withScope');
    try {
      await work();
      return spy.mock.calls.map(([scope]) => scope);
    } finally {
      spy.mockRestore();
    }
  }

  it("records firm B's result in firm B's scope only; firm A's document and audit stay", async () => {
    const [dA, dB] = [await document('a'), await document('b')];
    const auditsA = await firmAudits('a');
    const m = message(dB.key, 'THREATS_FOUND');
    let outcome: unknown;
    const scopes = await scopesOf(async () => (outcome = await consumer.handle(m)));
    expect(outcome).toEqual({ outcome: 'INFECTED', deleted: true });
    expect(scopes.length).toBeGreaterThan(0);
    expect(new Set(scopes.map((s) => JSON.stringify(s)))).toEqual(
      new Set([JSON.stringify({ kind: 'business', businessId: firms.b.id })]),
    );
    expect((await docRow('b', dB.id)).scanStatus).toBe('INFECTED');
    expect(await docRow('a', dA.id)).toEqual({ scanStatus: 'PENDING', scannedAt: null });
    expect(await firmAudits('a')).toBe(auditsA);
  });

  it("never finds firm A's document under firm B's prefix: UNKNOWN, kept, firm A untouched", async () => {
    const dA = await document('a');
    const uploadId = dA.key.slice(dA.key.lastIndexOf('/') + 1);
    const auditsA = await firmAudits('a');
    const m = message(`tenant/${firms.b.id}/documents/${uploadId}`, 'THREATS_FOUND');
    let outcome: unknown;
    const scopes = await scopesOf(async () => (outcome = await consumer.handle(m)));
    expect(outcome).toEqual({ outcome: 'UNKNOWN', deleted: false });
    expect(scopes.length).toBeGreaterThan(0);
    for (const s of scopes) expect(s).toEqual({ kind: 'business', businessId: firms.b.id });
    expect(await docRow('a', dA.id)).toEqual({ scanStatus: 'PENDING', scannedAt: null });
    expect(await firmAudits('a')).toBe(auditsA);
  });

  it("opens no scope at all for firm A's key in an event for another bucket or account", async () => {
    const dA = await document('a');
    const wrong = [
      message(dA.key, 'NO_THREATS_FOUND', null, { bucket: 'firmivra-dev-other' }),
      message(dA.key, 'NO_THREATS_FOUND', null, { account: '111122223333' }),
    ];
    const outcomes: unknown[] = [];
    const scopes = await scopesOf(async () => {
      for (const m of wrong) outcomes.push(await consumer.handle(m));
    });
    expect(outcomes).toEqual([
      { outcome: 'REJECTED', deleted: true },
      { outcome: 'REJECTED', deleted: true },
    ]);
    expect(scopes).toEqual([]);
    expect(await docRow('a', dA.id)).toEqual({ scanStatus: 'PENDING', scannedAt: null });
  });

  it("gives another prefix's handler firm B from the key, and its scope sees firm B's rows only", async () => {
    await document('a');
    await document('b');
    // A router of its own, so the app's registry (one handler per prefix) is left as it is.
    const router = new ScanResultRouter(database);
    const seen: { businessId: string; documents: string[] }[] = [];
    router.register({
      prefix: 'esign',
      handle: async (result, inFirm) => {
        const docs = await inFirm((tx) => tx.document.findMany({ select: { businessId: true } }));
        seen.push({ businessId: result.businessId, documents: docs.map((d) => d.businessId) });
        return 'IGNORED';
      },
    });
    const own = new ScanResultConsumer(scanConfig, queue, router);
    const m = message(`tenant/${firms.b.id}/esign/${randomUUID()}/Signed.pdf`, 'NO_THREATS_FOUND');
    let outcome: unknown;
    const scopes = await scopesOf(async () => (outcome = await own.handle(m)));
    expect(outcome).toEqual({ outcome: 'IGNORED', deleted: true });
    expect(scopes).toEqual([{ kind: 'business', businessId: firms.b.id }]);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.businessId).toBe(firms.b.id);
    expect(seen[0]?.documents.length).toBeGreaterThan(0);
    expect(new Set(seen[0]?.documents)).toEqual(new Set([firms.b.id]));
  });
});
