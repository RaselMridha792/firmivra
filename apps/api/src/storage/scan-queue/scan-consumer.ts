import { setTimeout as delay } from 'node:timers/promises';
import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { awsErrorName } from '../../firm-applications/firm-keys.js';
import { errorName } from '../../notifications/notifier.js';
import type { ScanOutcome } from '../scan-results.service.js';
import { SCAN_QUEUE_CONFIG, type ScanQueueConfig } from './config.js';
import { type ExpectedScanSource, KEPT_REJECTIONS, parseScanEvent } from './scan-event.js';
import { type RoutedOutcome, ScanResultRouter } from './scan-router.js';
import {
  type QueueMessage,
  SCAN_QUEUE,
  SCAN_QUEUE_TIMING,
  type ScanQueue,
} from './sqs-scan-queue.js';

/**
 * Markers in the API log, each a metric filter and an alarm in infra (SCAN_LOG_MARKERS in
 * infra/src/stacks/malware-scan.ts; docs/SETUP-LOG.md, step 19). Change both together.
 */
export const SCAN_LOG_MARKERS = {
  /** Our side could not finish a result: the file stays PENDING for a rescan. */
  unfinished: 'SCAN_UNFINISHED',
  /** A message that is not a scan result for this account, region and bucket (deleted). */
  rejected: 'SCAN_REJECTED',
  /** A kept message on its last receive: the dead-letter queue is next. */
  lastReceive: 'SCAN_LAST_RECEIVE',
} as const;

/** What became of one message: the outcome, and whether it left the queue. */
export interface HandledMessage {
  outcome: ScanOutcome | 'REJECTED' | 'ERROR';
  deleted: boolean;
}

/** The waits after a failed receive: 1 s, 2 s, 4 s, ... up to 60 s. */
export const RECEIVE_BACKOFF = { firstMs: 1_000, maxMs: 60_000 } as const;

/** Only ids and codes reach the log; anything else in their place prints as `?`. */
const ID = /^[A-Za-z0-9-]{1,100}$/;
const safeId = (value: string | null | undefined) => (value && ID.test(value) ? value : '?');
const codes = (reasons: readonly string[]) =>
  `[${reasons.map((r) => (/^[A-Z0-9_]{1,64}$/.test(r) ? r : 'OTHER')).join(',')}]`;
const version = (v: string | null) =>
  v === null ? 'none' : /^[A-Za-z0-9._-]{1,200}$/.test(v) ? v : '?';

/**
 * Reads GuardDuty's scan results from the SQS queue (R1 step 19) and routes each one by its key's
 * prefix (ScanResultRouter). One message at a time, long polling; started at boot when
 * SCAN_RESULTS_QUEUE_URL is set (in AWS), never locally or in CI. What happens to a message:
 * - not a scan result for this account, region and bucket: SCAN_REJECTED, deleted; but a
 *   GuardDuty scan result this parser cannot read, or an unknown status: SCAN_REJECTED, kept, so
 *   it dead-letters and can be redriven once the parser reads it;
 * - a final outcome (CLEAN, INFECTED, FAILED, UNSCANNED, IGNORED): logged, deleted (a repeat is
 *   IGNORED: results are set once);
 * - PENDING (our side): SCAN_UNFINISHED, deleted (the alarm and a rescan);
 * - UNKNOWN (no record yet) or an error: kept. UNKNOWN comes back after 20 s on its first 5
 *   receives, everything else after the queue's 120 s; the last receive logs SCAN_LAST_RECEIVE.
 * The log has message and event ids, firm and object UUIDs, status and reason codes and the
 * version id only: never the body, a key outside the prefixes, a threat or a file name.
 * Shutdown (SIGTERM: an ECS stop or Fargate Spot's 2-minute warning) ends the long poll at once
 * and lets the message in hand finish before the database disconnects.
 */
@Injectable()
export class ScanResultConsumer implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger('ScanResults');
  private readonly stopping = new AbortController();
  private running: Promise<void> | null = null;
  /** Tests shorten it. */
  backoff: { firstMs: number; maxMs: number } = RECEIVE_BACKOFF;

  constructor(
    @Inject(SCAN_QUEUE_CONFIG) private readonly config: ScanQueueConfig,
    @Inject(SCAN_QUEUE) private readonly queue: ScanQueue,
    private readonly router: ScanResultRouter,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.queue) {
      if (this.config.nodeEnv !== 'test') {
        this.logger.log('GuardDuty scan results are not read here (SCAN_RESULTS_QUEUE_URL unset)');
      }
      return;
    }
    this.running = this.loop();
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopping.abort();
    await this.running;
  }

  private async loop(): Promise<void> {
    const { signal } = this.stopping;
    let failures = 0;
    while (!signal.aborted) {
      let messages: QueueMessage[];
      try {
        messages = await this.queue.receive(signal);
        failures = 0;
      } catch (error) {
        if (signal.aborted) break;
        const wait = Math.min(this.backoff.firstMs * 2 ** failures, this.backoff.maxMs);
        failures += 1;
        this.logger.warn(
          `Scan results: receive failed (${awsErrorName(error)}); next try in ${wait} ms`,
        );
        await delay(wait, undefined, { signal }).catch(() => undefined);
        continue;
      }
      // The message in hand finishes even when shutdown starts meanwhile.
      for (const m of messages) await this.handle(m);
    }
  }

  /** One message, start to end; never throws. Public for tests. */
  async handle(m: QueueMessage): Promise<HandledMessage> {
    const messageId = safeId(m.messageId);
    const parsed = this.expected
      ? parseScanEvent(m.body, this.expected)
      : ({ ok: false, why: 'NOT_A_SCAN_RESULT' } as const);
    if (!parsed.ok) {
      if (KEPT_REJECTIONS.has(parsed.why)) {
        this.logger.warn(
          `${SCAN_LOG_MARKERS.rejected} message ${messageId}: ${parsed.why}; kept for a redrive`,
        );
        await this.keep(m, parsed.why, false);
        return { outcome: 'REJECTED', deleted: false };
      }
      this.logger.warn(`${SCAN_LOG_MARKERS.rejected} message ${messageId}: ${parsed.why}; deleted`);
      return { outcome: 'REJECTED', deleted: await this.remove(m) };
    }
    const { event } = parsed;
    const eventId = safeId(event.id);
    let routed: RoutedOutcome;
    try {
      routed = await this.router.route(event);
    } catch (error) {
      this.logger.warn(`Scan result ${eventId} failed (${errorName(error)}); redelivered`);
      await this.keep(m, `event ${eventId}`, false);
      return { outcome: 'ERROR', deleted: false };
    }
    const { outcome, target } = routed;
    if (!target) {
      this.logger.log(
        `Scan result ${eventId} (message ${messageId}): key outside the scanned prefixes; deleted`,
      );
      return { outcome, deleted: await this.remove(m) };
    }
    const what = `${target.prefix} ${target.objectId ?? '?'} in firm ${target.businessId}`;
    const result = `${event.status} ${codes(event.reasons)}`;
    if (outcome === 'UNKNOWN') {
      const { maxReceiveCount } = SCAN_QUEUE_TIMING;
      this.logger.log(
        `Scan result ${eventId}: ${what}, ${result} -> UNKNOWN: no record yet; redelivered (receive ${m.receiveCount} of ${maxReceiveCount})`,
      );
      await this.keep(m, `${what} (event ${eventId})`, true);
      return { outcome, deleted: false };
    }
    if (outcome === 'PENDING') {
      this.logger.warn(
        `${SCAN_LOG_MARKERS.unfinished} ${what}: ${result} (event ${eventId}); deleted, rescan it`,
      );
    } else {
      this.logger.log(
        `Scan result ${eventId}: ${what}, ${result} -> ${outcome} (version ${version(event.versionId)})`,
      );
    }
    return { outcome, deleted: await this.remove(m) };
  }

  private get expected(): ExpectedScanSource | null {
    const { queue, bucket } = this.config;
    return queue && bucket ? { account: queue.account, region: queue.region, bucket } : null;
  }

  /** Deletes a handled message; a failed delete only means a harmless repeat. */
  private async remove(m: QueueMessage): Promise<boolean> {
    try {
      await this.queue.delete(m.receiptHandle);
      return true;
    } catch (error) {
      this.logger.warn(
        `Scan results: message ${safeId(m.messageId)} not deleted (${awsErrorName(error)}); it comes back as a repeat`,
      );
      return false;
    }
  }

  /** Leaves a message for redelivery: early for a result with no record yet, else 120 s. */
  private async keep(m: QueueMessage, what: string, unknown: boolean): Promise<void> {
    const { maxReceiveCount, earlyRetries, earlyRetrySeconds } = SCAN_QUEUE_TIMING;
    if (m.receiveCount >= maxReceiveCount) {
      this.logger.warn(
        `${SCAN_LOG_MARKERS.lastReceive} ${what}, message ${safeId(m.messageId)}: receive ${m.receiveCount} of ${maxReceiveCount}; the dead-letter queue is next`,
      );
      return;
    }
    if (!unknown || m.receiveCount > earlyRetries) return;
    try {
      await this.queue.retryAfter(m.receiptHandle, earlyRetrySeconds);
    } catch (error) {
      this.logger.warn(
        `Scan results: message ${safeId(m.messageId)} keeps its 120 s (${awsErrorName(error)})`,
      );
    }
  }
}
