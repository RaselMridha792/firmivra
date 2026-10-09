import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { awsErrorName, FIRM_KEYS, FirmKeyError, type FirmKeys } from './firm-keys.js';

/** How often the job looks for firms still without a key (KMS_MODE=kms only). */
export const FIRM_KEY_SWEEP_MS = 5 * 60_000;
/**
 * One API task reads the sweep's list at a time (q30: a Postgres try-lock). The lock ends with
 * that read, so firms newer than this are left to approve's own call, which may wait up to 5
 * minutes to name a new key (#101): a sweep on another task would make a second key meanwhile.
 */
const SWEEP_LOCK = 'firm-applications:firm-key-sweep';
export const FIRM_KEY_SWEEP_MIN_AGE_MS = 10 * 60_000;
/**
 * A platform event when KMS made a key it could not name, or an alias names a key the adapter
 * won't adopt (#101's FirmKeyError: "a person decides"). The sweep never retries such a firm, so
 * no more unused keys are made; a person fixes it with the create-firm-key command, which stores
 * the key (and the firm drops out of the sweep).
 */
export const KEY_NEEDS_PERSON = 'business.key_needs_person';

/**
 * Each firm's own KMS key, made outside the approval's request and transactions (a new key can
 * take minutes before it can be named: #101). Approve starts it after its commits (`start`); a
 * sweep every few minutes retries any firm still without a key, under a try-lock. Until the key
 * is stored the firm is in setup and its encrypted fields (the EIN, setup step 2) answer 503
 * ENCRYPTION_UNAVAILABLE. With KMS_MODE=local there is no key to make: nothing runs.
 */
@Injectable()
export class FirmKeyJob implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(FirmKeyJob.name);
  /** Firms this task is making a key for now, so a sweep never starts a second call for one. */
  private readonly running = new Map<string, Promise<void>>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(FIRM_KEYS) private readonly keys: FirmKeys,
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    if (this.keys.mode !== 'kms') return;
    this.timer = setInterval(() => {
      this.sweep().catch((e: unknown) => {
        this.logger.warn(`The firm key sweep failed (${awsErrorName(e)}); it runs again later`);
      });
    }, FIRM_KEY_SWEEP_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  /** Starts making the firm's key without waiting for it; a failure is logged and swept later. */
  start(businessId: string): Promise<void> {
    if (this.keys.mode !== 'kms') return Promise.resolve();
    const current = this.running.get(businessId);
    if (current) return current;
    const run = this.provision(businessId)
      .catch(async (e: unknown) => {
        if (e instanceof FirmKeyError) {
          await this.needsPerson(businessId, e);
          return;
        }
        // The AWS error's name only, never its message (it can hold ARNs).
        this.logger.warn(
          `Firm ${businessId}: its encryption key could not be made yet (${awsErrorName(e)})`,
        );
      })
      .finally(() => this.running.delete(businessId));
    this.running.set(businessId, run);
    return run;
  }

  /**
   * Every firm in setup or active without a key, older than FIRM_KEY_SWEEP_MIN_AGE_MS and not
   * waiting for a person, if no other task is reading the list.
   */
  async sweep(): Promise<void> {
    const firms = await this.database.withScope({ kind: 'platform' }, async (tx) => {
      const [lock] = await tx.$queryRaw<{ ok: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${SWEEP_LOCK}, 0)) AS ok`;
      if (!lock?.ok) return [];
      const found = await tx.business.findMany({
        where: {
          kmsKeyId: null,
          status: { in: ['PENDING_SETUP', 'ACTIVE'] },
          createdAt: { lt: new Date(Date.now() - FIRM_KEY_SWEEP_MIN_AGE_MS) },
        },
        select: { id: true },
      });
      const held = await tx.auditLog.findMany({
        where: {
          businessId: null,
          action: KEY_NEEDS_PERSON,
          entityId: { in: found.map((f) => f.id) },
        },
        select: { entityId: true },
      });
      const skip = new Set(held.map((h) => h.entityId));
      return found.filter((f) => !skip.has(f.id));
    });
    for (const firm of firms) await this.start(firm.id);
  }

  /** Records the FirmKeyError once (its message names the unused key) and stops retrying. */
  private async needsPerson(businessId: string, e: FirmKeyError): Promise<void> {
    try {
      const recorded = await this.database.withScope({ kind: 'platform' }, async (tx) => {
        const before = await tx.auditLog.count({
          where: { businessId: null, action: KEY_NEEDS_PERSON, entityId: businessId },
        });
        if (before === 0) {
          await this.audit.logIn(tx, KEY_NEEDS_PERSON, { type: 'business', id: businessId });
        }
        return before === 0;
      });
      if (recorded) this.logger.warn(`${e.message}. Not retried: run create-firm-key`);
    } catch (err) {
      this.logger.warn(`${e.message}. Not recorded (${awsErrorName(err)}); retried later`);
    }
  }

  /** The key (KMS, outside any transaction), then stored on a firm that still has none. */
  private async provision(businessId: string): Promise<void> {
    const kmsKeyId = await this.keys.ensureKey(businessId);
    if (!kmsKeyId) return;
    await this.database.withScope({ kind: 'platform' }, async (tx) => {
      const { count } = await tx.business.updateMany({
        where: { id: businessId, kmsKeyId: null },
        data: { kmsKeyId },
      });
      // A platform event (the approving admin, or none from a sweep): the firm's id, never the ARN.
      if (count === 1) {
        await this.audit.logIn(tx, 'business.key_created', { type: 'business', id: businessId });
      }
    });
  }
}
