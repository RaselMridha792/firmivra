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
/** One API task sweeps at a time (q30: in-process jobs under a Postgres try-lock). */
const SWEEP_LOCK = 'firm-applications:firm-key-sweep';

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
    this.timer = setInterval(() => void this.sweep(), FIRM_KEY_SWEEP_MS);
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
      .catch((e: unknown) => {
        // A FirmKeyError names the unused key for a person to delete; otherwise the AWS error's
        // name only, never its message.
        this.logger.warn(
          e instanceof FirmKeyError
            ? e.message
            : `Firm ${businessId}: its encryption key could not be made yet (${awsErrorName(e)})`,
        );
      })
      .finally(() => this.running.delete(businessId));
    this.running.set(businessId, run);
    return run;
  }

  /** Every firm in setup or active without a key, if no other task is sweeping. */
  async sweep(): Promise<void> {
    const firms = await this.database.withScope({ kind: 'platform' }, async (tx) => {
      const [lock] = await tx.$queryRaw<{ ok: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${SWEEP_LOCK}, 0)) AS ok`;
      if (!lock?.ok) return [];
      return tx.business.findMany({
        where: { kmsKeyId: null, status: { in: ['PENDING_SETUP', 'ACTIVE'] } },
        select: { id: true },
      });
    });
    for (const firm of firms) await this.start(firm.id);
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
