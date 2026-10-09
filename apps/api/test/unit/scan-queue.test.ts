// R1 step 19: GuardDuty's scan results from the SQS queue. The event parser (AWS's own sample
// events, rewritten with synthetic ids, the dev account and bucket and tenant keys), the queue
// settings, the prefix registry (the firm only from the key, its scope only) and what the consumer
// does with each message (deleted or kept, the log markers, ids only), its long-poll loop, the
// backoff and the shutdown. No database: a fake Database records the scopes; the e2e file
// (scan-queue.e2e.test.ts) runs the documents handler against the test database.
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import type { Database } from '@firmivra/db';
import { loadScanQueueConfig, type ScanQueueConfig } from '../../src/storage/scan-queue/config.js';
import {
  ScanResultConsumer,
  SCAN_LOG_MARKERS,
} from '../../src/storage/scan-queue/scan-consumer.js';
import { parseScanEvent } from '../../src/storage/scan-queue/scan-event.js';
import {
  type InFirm,
  type RoutedScanResult,
  type ScanPrefix,
  type ScanResultHandler,
  ScanResultRouter,
} from '../../src/storage/scan-queue/scan-router.js';
import {
  type QueueMessage,
  SCAN_QUEUE_TIMING,
  type ScanQueue,
  SqsScanQueue,
} from '../../src/storage/scan-queue/sqs-scan-queue.js';
import type { ScanOutcome, ScanResult } from '../../src/storage/scan-results.service.js';

const ACCOUNT = '778127141557';
const REGION = 'us-east-1';
const BUCKET = 'firmivra-dev-documents-778127141557';
const QUEUE_URL = `https://sqs.${REGION}.amazonaws.com/${ACCOUNT}/firmivra-dev-malware-scan-results`;
const expected = { account: ACCOUNT, region: REGION, bucket: BUCKET };
const config: ScanQueueConfig = {
  nodeEnv: 'test',
  bucket: BUCKET,
  queue: { url: QUEUE_URL, region: REGION, account: ACCOUNT },
};

const firmA = randomUUID();
const firmB = randomUUID();
const docKey = (firm: string, id: string = randomUUID()) => `tenant/${firm}/documents/${id}`;

type Status = ScanResult['status'];
/**
 * An event shaped like AWS's samples (monitor-with-eventbridge-s3-malware-protection.html): the
 * scanStatus and statusReasons of each result as the guide shows them, synthetic values.
 */
function event(
  status: Status,
  reasons: string[] | null = null,
  over: { key?: string; account?: string; region?: string; bucket?: string; time?: Date } = {},
) {
  const scanStatus = {
    NO_THREATS_FOUND: 'COMPLETED',
    THREATS_FOUND: 'COMPLETED',
    FAILED: 'FAILED',
  }[status as string];
  return {
    version: '0',
    id: randomUUID(),
    'detail-type': 'GuardDuty Malware Protection Object Scan Result',
    source: 'aws.guardduty',
    account: over.account ?? ACCOUNT,
    time: (over.time ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    region: over.region ?? REGION,
    resources: [`arn:aws:guardduty:${REGION}:${ACCOUNT}:malware-protection-plan/b4c7f464abEXAMPLE`],
    detail: {
      schemaVersion: '1.0',
      scanStatus: scanStatus ?? 'SKIPPED',
      resourceType: 'S3_OBJECT',
      s3ObjectDetails: {
        bucketName: over.bucket ?? BUCKET,
        objectKey: over.key ?? docKey(firmA),
        eTag: 'ASIAI44QH8DHBEXAMPLE',
        versionId: 'd41d8cd98f00b204e9800998ecEXAMPLE',
        s3Throttled: false,
      },
      scanResultDetails: {
        scanResultStatus: status,
        threats: status === 'THREATS_FOUND' ? [{ name: 'Fake-Test-Threat' }] : null,
        statusReasons: reasons,
      },
    },
  };
}
const body = (e: object) => JSON.stringify(e);

describe('parseScanEvent', () => {
  it("reads AWS's five sample results: status, reasons (none when null) and the version id", () => {
    const cases: [Status, string[] | null, string[]][] = [
      ['NO_THREATS_FOUND', null, []],
      ['THREATS_FOUND', null, []],
      ['UNSUPPORTED', ['PASSWORD_PROTECTED'], ['PASSWORD_PROTECTED']],
      ['ACCESS_DENIED', ['SSE_C_ENCRYPTED_OBJECT'], ['SSE_C_ENCRYPTED_OBJECT']],
      ['FAILED', null, []],
    ];
    for (const [status, reasons, want] of cases) {
      const e = event(status, reasons);
      const parsed = parseScanEvent(body(e), expected);
      expect(parsed).toEqual({
        ok: true,
        event: {
          id: e.id,
          time: new Date(e.time),
          key: e.detail.s3ObjectDetails.objectKey,
          status,
          reasons: want,
          versionId: 'd41d8cd98f00b204e9800998ecEXAMPLE',
        },
      });
    }
    // statusReasons left out entirely, and no versionId, read as none.
    const e = event('NO_THREATS_FOUND');
    const { statusReasons: _r, ...details } = e.detail.scanResultDetails;
    const { versionId: _v, ...object } = e.detail.s3ObjectDetails;
    const bare = {
      ...e,
      detail: { ...e.detail, scanResultDetails: details, s3ObjectDetails: object },
    };
    const parsed = parseScanEvent(body(bare), expected);
    expect(parsed.ok && [parsed.event.reasons, parsed.event.versionId]).toEqual([[], null]);
  });

  it('rejects anything else, each with its reason', () => {
    const e = event('NO_THREATS_FOUND');
    const why = (b: string) => {
      const parsed = parseScanEvent(b, expected);
      return parsed.ok ? 'ok' : parsed.why;
    };
    const cases: [string, string][] = [
      ['not json {', 'NOT_JSON'],
      [body({ ...e, source: 'aws.s3' }), 'NOT_A_SCAN_RESULT'],
      [
        body({ ...e, 'detail-type': 'GuardDuty Malware Protection Resource Status Active' }),
        'NOT_A_SCAN_RESULT',
      ],
      [body({ ...e, detail: { ...e.detail, resourceType: 'EBS_VOLUME' } }), 'NOT_A_SCAN_RESULT'],
      [body({ ...e, time: 'yesterday' }), 'NOT_A_SCAN_RESULT'],
      [body({ ...e, id: 'id with spaces' }), 'NOT_A_SCAN_RESULT'],
      [body(event('NO_THREATS_FOUND', null, { key: 'k'.repeat(1025) })), 'NOT_A_SCAN_RESULT'],
      [body(event('NO_THREATS_FOUND', ['R'.repeat(101)])), 'NOT_A_SCAN_RESULT'],
      [body(event('MAYBE_CLEAN' as Status)), 'UNKNOWN_RESULT_STATUS'],
      [body(event('NO_THREATS_FOUND', null, { account: '111122223333' })), 'WRONG_ACCOUNT'],
      [body(event('NO_THREATS_FOUND', null, { region: 'eu-west-1' })), 'WRONG_REGION'],
      [body(event('NO_THREATS_FOUND', null, { bucket: 'firmivra-dev-other' })), 'WRONG_BUCKET'],
      ['null', 'NOT_A_SCAN_RESULT'],
    ];
    for (const [b, want] of cases) expect(why(b)).toBe(want);
  });
});

describe('scan queue settings', () => {
  it('needs the queue URL in production when GuardDuty scans, and takes its region and account', () => {
    expect(() => loadScanQueueConfig({ NODE_ENV: 'production' })).toThrow(/SCAN_RESULTS_QUEUE_URL/);
    expect(() =>
      loadScanQueueConfig({
        NODE_ENV: 'production',
        SCAN_MODE: 'guardduty',
        SCAN_RESULTS_QUEUE_URL: '',
      }),
    ).toThrow(/SCAN_RESULTS_QUEUE_URL/);
    // The dev site may still skip the scan; then no queue is needed.
    expect(loadScanQueueConfig({ NODE_ENV: 'production', SCAN_MODE: 'local' }).queue).toBeNull();
    for (const url of [
      'http://sqs.us-east-1.amazonaws.com/778127141557/q',
      'https://sqs.us-east-1.amazonaws.com.evil.test/778127141557/q',
      'https://sqs.us-east-1.amazonaws.com/7781/q',
      `${QUEUE_URL}/extra`,
    ]) {
      expect(() =>
        loadScanQueueConfig({
          NODE_ENV: 'production',
          S3_DOCUMENTS_BUCKET: BUCKET,
          SCAN_RESULTS_QUEUE_URL: url,
        }),
      ).toThrow(/an SQS queue URL/);
    }
    expect(() =>
      loadScanQueueConfig({ NODE_ENV: 'production', SCAN_RESULTS_QUEUE_URL: QUEUE_URL }),
    ).toThrow(/S3_DOCUMENTS_BUCKET/);
    expect(
      loadScanQueueConfig({
        NODE_ENV: 'production',
        S3_DOCUMENTS_BUCKET: BUCKET,
        SCAN_RESULTS_QUEUE_URL: QUEUE_URL,
      }),
    ).toEqual({ nodeEnv: 'production', bucket: BUCKET, queue: config.queue });
  });

  it('reads no queue locally and in tests when the URL is unset', () => {
    for (const NODE_ENV of ['development', 'test']) {
      expect(loadScanQueueConfig({ NODE_ENV, S3_DOCUMENTS_BUCKET: 'firmivra-docs-local' })).toEqual(
        {
          nodeEnv: NODE_ENV,
          bucket: null,
          queue: null,
        },
      );
    }
  });
});

/** A fake Database: records every scope and hands the callback a stand-in transaction. */
function fakeDatabase() {
  const tx = { marker: 'tx' };
  const withScope = vi.fn((_scope: unknown, fn: (t: unknown) => Promise<unknown>) => fn(tx));
  return { db: { withScope } as unknown as Database, withScope, tx };
}

/** A handler that records what it got and answers `outcome` (or runs `run`). */
function fakeHandler(
  prefix: ScanPrefix,
  outcome: ScanOutcome | ((r: RoutedScanResult, inFirm: InFirm) => Promise<ScanOutcome>) = 'CLEAN',
) {
  const calls: RoutedScanResult[] = [];
  const handler: ScanResultHandler = {
    prefix,
    handle: (r, inFirm) => {
      calls.push(r);
      return typeof outcome === 'function' ? outcome(r, inFirm) : Promise.resolve(outcome);
    },
  };
  return { handler, calls };
}

const parsed = (key: string, status: Status = 'NO_THREATS_FOUND', reasons: string[] = []) => {
  const p = parseScanEvent(body(event(status, reasons, { key })), expected);
  if (!p.ok) throw new Error(p.why);
  return p.event;
};

describe('ScanResultRouter', () => {
  it('takes one handler per prefix', () => {
    const router = new ScanResultRouter(fakeDatabase().db);
    router.register(fakeHandler('documents').handler);
    expect(() => router.register(fakeHandler('documents').handler)).toThrow(/already registered/);
    router.register(fakeHandler('esign').handler);
  });

  it('ignores a key outside tenant/{uuid}/{known prefix}/ and keeps a known prefix with no handler', async () => {
    const { db, withScope } = fakeDatabase();
    const router = new ScanResultRouter(db);
    const docs = fakeHandler('documents');
    router.register(docs.handler);
    const id = randomUUID();
    for (const key of [
      'not-a-key',
      `tenant/${firmA}`,
      `tenant/${firmA}/documents`,
      `tenant/${firmA}/documents/`,
      `tenant/${firmA}/other/${id}`,
      `tenant/${firmA.toUpperCase()}/documents/${id}`,
      `tenant/not-a-uuid/documents/${id}`,
      `x/tenant/${firmA}/documents/${id}`,
      `malware-protection-resource-validation-object`,
    ]) {
      expect(await router.route(parsed(key))).toEqual({ outcome: 'IGNORED' });
    }
    expect(await router.route(parsed(`tenant/${firmA}/leads/${id}`))).toEqual({
      outcome: 'UNKNOWN',
      target: { prefix: 'leads', businessId: firmA, objectId: id },
    });
    expect([docs.calls, withScope.mock.calls]).toEqual([[], []]);
  });

  it("gives the handler the firm from the key and opens that firm's scope only", async () => {
    const { db, withScope, tx } = fakeDatabase();
    const router = new ScanResultRouter(db);
    const requestId = randomUUID();
    const esign = fakeHandler('esign', async (_r, inFirm) => {
      expect(await inFirm((t) => Promise.resolve(t))).toBe(tx);
      return 'IGNORED';
    });
    router.register(esign.handler);
    const e = parsed(`tenant/${firmB}/esign/${requestId}/Signed_Letter.pdf`, 'UNSUPPORTED', [
      'PASSWORD_PROTECTED',
    ]);
    expect(await router.route(e)).toEqual({
      outcome: 'IGNORED',
      target: { prefix: 'esign', businessId: firmB, objectId: requestId },
    });
    expect(esign.calls).toEqual([
      {
        businessId: firmB,
        prefix: 'esign',
        key: e.key,
        path: `${requestId}/Signed_Letter.pdf`,
        status: 'UNSUPPORTED',
        reasons: ['PASSWORD_PROTECTED'],
        versionId: 'd41d8cd98f00b204e9800998ecEXAMPLE',
        eventTime: e.time,
        eventId: e.id,
      },
    ]);
    expect(withScope.mock.calls.map(([scope]) => scope)).toEqual([
      { kind: 'business', businessId: firmB },
    ]);
  });
});

/** The queue: hands out `pending` one per receive, then long-polls until aborted. */
class FakeQueue implements ScanQueue {
  readonly pending: QueueMessage[] = [];
  readonly deleted: string[] = [];
  readonly retried: [string, number][] = [];
  receives = 0;
  failReceives = 0;
  failDeletes = false;
  receive(signal: AbortSignal): Promise<QueueMessage[]> {
    this.receives += 1;
    if (this.failReceives > 0) {
      this.failReceives -= 1;
      return Promise.reject(
        Object.assign(new Error('arn:aws:sqs:secret'), { name: 'AccessDenied' }),
      );
    }
    const next = this.pending.shift();
    if (next) return Promise.resolve([next]);
    return new Promise((resolve) =>
      signal.addEventListener('abort', () => resolve([]), { once: true }),
    );
  }
  delete(receiptHandle: string) {
    if (this.failDeletes)
      return Promise.reject(Object.assign(new Error('x'), { name: 'ThrottlingException' }));
    this.deleted.push(receiptHandle);
    return Promise.resolve();
  }
  retryAfter(receiptHandle: string, seconds: number) {
    this.retried.push([receiptHandle, seconds]);
    return Promise.resolve();
  }
}

const message = (b: string, receiveCount = 1): QueueMessage => ({
  messageId: randomUUID(),
  receiptHandle: `rh-${randomUUID()}`,
  body: b,
  receiveCount,
});

describe('ScanResultConsumer', () => {
  let logs: { log: MockInstance; warn: MockInstance };
  const lines = () =>
    [...logs.log.mock.calls, ...logs.warn.mock.calls].map((c) => String(c[0])).join('\n');
  beforeEach(() => {
    logs = {
      log: vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined),
      warn: vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
    };
  });
  afterEach(() => vi.restoreAllMocks());

  const setUp = (outcome: ScanOutcome | (() => Promise<ScanOutcome>) = 'CLEAN') => {
    const queue = new FakeQueue();
    const { db } = fakeDatabase();
    const router = new ScanResultRouter(db);
    const docs = fakeHandler(
      'documents',
      typeof outcome === 'function' ? () => outcome() : outcome,
    );
    router.register(docs.handler);
    return { queue, router, docs, consumer: new ScanResultConsumer(config, queue, router) };
  };

  it('deletes a final result and logs its ids, status, reasons, outcome and version', async () => {
    for (const outcome of ['CLEAN', 'INFECTED', 'FAILED', 'UNSCANNED', 'IGNORED'] as const) {
      const { queue, consumer } = setUp(outcome);
      const id = randomUUID();
      const e = event('UNSUPPORTED', ['PASSWORD_PROTECTED'], { key: docKey(firmA, id) });
      const m = message(body(e));
      expect(await consumer.handle(m)).toEqual({ outcome, deleted: true });
      expect(queue.deleted).toEqual([m.receiptHandle]);
      expect(logs.log).toHaveBeenLastCalledWith(
        `Scan result ${e.id}: documents ${id} in firm ${firmA}, UNSUPPORTED [PASSWORD_PROTECTED] -> ${outcome} (version d41d8cd98f00b204e9800998ecEXAMPLE)`,
      );
    }
  });

  it('logs SCAN_UNFINISHED for our side (PENDING) and deletes it', async () => {
    const { queue, consumer } = setUp('PENDING');
    const id = randomUUID();
    const e = event('ACCESS_DENIED', ['UNAUTHORIZED_TO_GET_OBJECT'], { key: docKey(firmA, id) });
    const m = message(body(e));
    expect(await consumer.handle(m)).toEqual({ outcome: 'PENDING', deleted: true });
    expect(queue.deleted).toEqual([m.receiptHandle]);
    expect(logs.warn).toHaveBeenCalledWith(
      `${SCAN_LOG_MARKERS.unfinished} documents ${id} in firm ${firmA}: ACCESS_DENIED [UNAUTHORIZED_TO_GET_OBJECT] (event ${e.id}); deleted, rescan it`,
    );
  });

  it('logs SCAN_REJECTED with the message id and reason only, and deletes the message', async () => {
    const { queue, consumer, docs } = setUp();
    const secretKey = docKey(firmA);
    const cases: [string, string][] = [
      ['{"not":"a scan result", "objectKey":"tenant/x"}', 'NOT_A_SCAN_RESULT'],
      ['%%%', 'NOT_JSON'],
      [
        body(event('NO_THREATS_FOUND', null, { key: secretKey, bucket: 'firmivra-dev-other' })),
        'WRONG_BUCKET',
      ],
      [
        body(event('NO_THREATS_FOUND', null, { key: secretKey, account: '111122223333' })),
        'WRONG_ACCOUNT',
      ],
      [body(event('NEW_STATUS' as Status, null, { key: secretKey })), 'UNKNOWN_RESULT_STATUS'],
    ];
    for (const [b, why] of cases) {
      const m = message(b);
      expect(await consumer.handle(m)).toEqual({ outcome: 'REJECTED', deleted: true });
      expect(logs.warn).toHaveBeenLastCalledWith(
        `${SCAN_LOG_MARKERS.rejected} message ${m.messageId}: ${why}; deleted`,
      );
    }
    expect(queue.deleted).toHaveLength(cases.length);
    expect(docs.calls).toEqual([]);
    expect(lines()).not.toContain(secretKey);
    expect(lines()).not.toContain('tenant/');
  });

  it('never logs a key outside the prefixes, a body or a threat name', async () => {
    const { queue, consumer } = setUp('CLEAN');
    const outside = `tenant/${firmA}/private-notes/Client_Name_2025.pdf`;
    const e = event('THREATS_FOUND', null, { key: outside });
    const m = message(body(e));
    expect(await consumer.handle(m)).toEqual({ outcome: 'IGNORED', deleted: true });
    expect(queue.deleted).toEqual([m.receiptHandle]);
    expect(logs.log).toHaveBeenLastCalledWith(
      `Scan result ${e.id} (message ${m.messageId}): key outside the scanned prefixes; deleted`,
    );
    await consumer.handle(message(body(event('THREATS_FOUND', null, { key: docKey(firmA) }))));
    expect(lines()).not.toMatch(/Client_Name|private-notes|Fake-Test-Threat|eTag|ASIAI44/);
  });

  it('keeps UNKNOWN: back after 20 s on its first 5 receives, then 120 s, SCAN_LAST_RECEIVE on the 20th', async () => {
    const { queue, consumer } = setUp('UNKNOWN');
    const id = randomUUID();
    const b = body(event('NO_THREATS_FOUND', null, { key: docKey(firmA, id) }));
    const { maxReceiveCount, earlyRetries, earlyRetrySeconds } = SCAN_QUEUE_TIMING;
    expect([maxReceiveCount, earlyRetries, earlyRetrySeconds]).toEqual([20, 5, 20]);
    // 5 x 20 s + 15 x 120 s: about 32 minutes before the dead-letter queue.
    expect(earlyRetries * earlyRetrySeconds + (maxReceiveCount - earlyRetries) * 120).toBe(1900);
    const early = message(b, earlyRetries);
    expect(await consumer.handle(early)).toEqual({ outcome: 'UNKNOWN', deleted: false });
    expect(queue.retried).toEqual([[early.receiptHandle, earlyRetrySeconds]]);
    expect(logs.log).toHaveBeenLastCalledWith(
      expect.stringContaining(
        `documents ${id} in firm ${firmA}, NO_THREATS_FOUND [] -> UNKNOWN: no record yet; redelivered (receive 5 of 20)`,
      ),
    );
    await consumer.handle(message(b, earlyRetries + 1));
    expect(queue.retried).toHaveLength(1);
    expect(logs.warn.mock.calls.map((c) => String(c[0]))).not.toContainEqual(
      expect.stringContaining(SCAN_LOG_MARKERS.lastReceive),
    );
    const last = message(b, maxReceiveCount);
    expect(await consumer.handle(last)).toEqual({ outcome: 'UNKNOWN', deleted: false });
    expect(logs.warn).toHaveBeenLastCalledWith(
      expect.stringMatching(
        new RegExp(
          `^${SCAN_LOG_MARKERS.lastReceive} documents ${id} in firm ${firmA} .*receive 20 of 20`,
        ),
      ),
    );
    expect([queue.deleted, queue.retried]).toEqual([
      [],
      [[early.receiptHandle, earlyRetrySeconds]],
    ]);
  });

  it('keeps a known prefix with no handler yet (R13, R14, R15) for the dead-letter redrive', async () => {
    const { queue, consumer } = setUp();
    const m = message(
      body(event('NO_THREATS_FOUND', null, { key: `tenant/${firmB}/agreements/${randomUUID()}` })),
    );
    expect(await consumer.handle(m)).toEqual({ outcome: 'UNKNOWN', deleted: false });
    expect(queue.retried).toEqual([[m.receiptHandle, 20]]);
  });

  it('keeps a message whose handler throws, logging only the error name', async () => {
    const { queue, consumer } = setUp(() =>
      Promise.reject(
        Object.assign(new Error(`tenant/${firmA}/documents/x failed`), {
          name: 'PrismaClientKnownRequestError',
        }),
      ),
    );
    const e = event('NO_THREATS_FOUND');
    expect(await consumer.handle(message(body(e)))).toEqual({ outcome: 'ERROR', deleted: false });
    expect(logs.warn).toHaveBeenLastCalledWith(
      `Scan result ${e.id} failed (PrismaClientKnownRequestError); redelivered`,
    );
    // Errors wait the queue's 120 s; on the last receive they warn like UNKNOWN.
    expect(queue.retried).toEqual([]);
    await consumer.handle(message(body(e), 20));
    expect(logs.warn).toHaveBeenLastCalledWith(
      expect.stringContaining(SCAN_LOG_MARKERS.lastReceive),
    );
    expect(lines()).not.toContain('tenant/');
  });

  it('logs a failed delete by its AWS error name: the repeat is harmless', async () => {
    const { queue, consumer } = setUp('CLEAN');
    queue.failDeletes = true;
    const m = message(body(event('NO_THREATS_FOUND')));
    expect(await consumer.handle(m)).toEqual({ outcome: 'CLEAN', deleted: false });
    expect(logs.warn).toHaveBeenLastCalledWith(
      `Scan results: message ${m.messageId} not deleted (ThrottlingException); it comes back as a repeat`,
    );
  });

  it('polls one message at a time from boot, and shutdown ends the long poll at once', async () => {
    const { queue, consumer, docs } = setUp('CLEAN');
    queue.pending.push(
      message(body(event('NO_THREATS_FOUND'))),
      message(body(event('THREATS_FOUND'))),
    );
    consumer.onApplicationBootstrap();
    await vi.waitFor(() => expect(queue.receives).toBe(3));
    expect(docs.calls.map((c) => c.status)).toEqual(['NO_THREATS_FOUND', 'THREATS_FOUND']);
    expect(queue.deleted).toHaveLength(2);
    const started = Date.now();
    await consumer.beforeApplicationShutdown();
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(queue.receives).toBe(3);
  });

  it('finishes and deletes the message in hand when shutdown starts meanwhile', async () => {
    let release!: () => void;
    let entered!: () => void;
    const inHand = new Promise<void>((resolve) => (entered = resolve));
    const { queue, consumer } = setUp(async () => {
      entered();
      await new Promise<void>((resolve) => (release = resolve));
      return 'CLEAN';
    });
    const m = message(body(event('NO_THREATS_FOUND')));
    queue.pending.push(m);
    consumer.onApplicationBootstrap();
    await inHand;
    let done = false;
    const stopped = consumer.beforeApplicationShutdown().then(() => (done = true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(done).toBe(false);
    release();
    await stopped;
    expect(queue.deleted).toEqual([m.receiptHandle]);
    expect(queue.receives).toBe(1);
  });

  it('backs off after a failed receive, logging the AWS error name only', async () => {
    const { queue, consumer } = setUp();
    consumer.backoff = { firstMs: 1, maxMs: 4 };
    queue.failReceives = 3;
    consumer.onApplicationBootstrap();
    await vi.waitFor(() => expect(queue.receives).toBe(4));
    await consumer.beforeApplicationShutdown();
    expect(logs.warn.mock.calls.map((c) => String(c[0]))).toEqual([
      'Scan results: receive failed (AccessDenied); next try in 1 ms',
      'Scan results: receive failed (AccessDenied); next try in 2 ms',
      'Scan results: receive failed (AccessDenied); next try in 4 ms',
    ]);
  });

  it('reads nothing when no queue is set', async () => {
    const queue = new FakeQueue();
    const consumer = new ScanResultConsumer(
      { nodeEnv: 'test', bucket: null, queue: null },
      queue,
      new ScanResultRouter(fakeDatabase().db),
    );
    consumer.onApplicationBootstrap();
    await consumer.beforeApplicationShutdown();
    expect(queue.receives).toBe(0);
    expect(logs.log).not.toHaveBeenCalled();
  });
});

describe('SqsScanQueue', () => {
  it('long-polls one message with its receive count, deletes and delays by receipt handle', async () => {
    const sent: { name: string; input: unknown; options: unknown }[] = [];
    const client = {
      send: vi.fn(
        (command: { constructor: { name: string }; input: unknown }, options?: unknown) => {
          sent.push({ name: command.constructor.name, input: command.input, options });
          return Promise.resolve(
            command.constructor.name === 'ReceiveMessageCommand'
              ? {
                  Messages: [
                    {
                      MessageId: 'm1',
                      ReceiptHandle: 'rh1',
                      Body: '{}',
                      Attributes: { ApproximateReceiveCount: '3' },
                    },
                    { MessageId: 'm2', Body: '{}' },
                  ],
                }
              : {},
          );
        },
      ),
    };
    const queue = new SqsScanQueue(QUEUE_URL, client as never);
    const signal = new AbortController().signal;
    expect(await queue.receive(signal)).toEqual([
      { messageId: 'm1', receiptHandle: 'rh1', body: '{}', receiveCount: 3 },
    ]);
    await queue.delete('rh1');
    await queue.retryAfter('rh1', 20);
    expect(sent).toEqual([
      {
        name: 'ReceiveMessageCommand',
        input: {
          QueueUrl: QUEUE_URL,
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: 20,
          MessageSystemAttributeNames: ['ApproximateReceiveCount'],
        },
        options: { abortSignal: signal },
      },
      {
        name: 'DeleteMessageCommand',
        input: { QueueUrl: QUEUE_URL, ReceiptHandle: 'rh1' },
        options: undefined,
      },
      {
        name: 'ChangeMessageVisibilityCommand',
        input: { QueueUrl: QUEUE_URL, ReceiptHandle: 'rh1', VisibilityTimeout: 20 },
        options: undefined,
      },
    ]);
  });
});
