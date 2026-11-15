import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { DATABASE } from '../database/database.module.js';
import { type WaitlistRun, AppointmentWaitlistService } from './waitlist.service.js';

/** The job's advisory lock key: fixed, in a range no other module uses ("R55" = 0x5537). */
export const WAITLIST_LOCK_KEY = 0x5537_0004;
/** How often the job ends lapsed offers and looks for openings. */
export const WAITLIST_JOB_INTERVAL_MS = 5 * 60_000;
/** The lock's transaction is capped at 60 s; a run stops starting work here. */
const BUDGET_MS = 45_000;

/**
 * WAITLIST_JOBS=on|off: run the job in this API task. Default on, off under NODE_ENV=test (tests
 * call `run()` themselves). Any other value is refused at boot.
 */
export function waitlistJobsOn(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env['WAITLIST_JOBS'];
  if (value === undefined || value === '') return env.NODE_ENV !== 'test';
  if (value === 'on' || value === 'off') return value === 'on';
  throw new Error('WAITLIST_JOBS must be "on" or "off"');
}

export type WaitlistJobResult = { skipped: true } | ({ skipped: false } & WaitlistRun);

/**
 * Appointments A3 (R55): the waitlist's job, in-process like the other jobs. Each run takes the
 * job's advisory lock (pg_try_advisory_xact_lock in a platform transaction held for the run), so
 * only one API task offers at a time and one opening is never offered twice. For each ACTIVE firm
 * it ends lapsed offers and offers openings (AppointmentWaitlistService.runFirm). One firm's
 * failure never holds up the others; the log holds ids and counts only.
 */
@Injectable()
export class WaitlistJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('WaitlistJob');
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly waitlist: AppointmentWaitlistService,
  ) {}

  onApplicationBootstrap(): void {
    if (waitlistJobsOn()) this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(intervalMs = WAITLIST_JOB_INTERVAL_MS): void {
    if (this.timers.length > 0) return;
    this.timers = [
      setTimeout(() => void this.tick(), 60_000),
      setInterval(() => void this.tick(), intervalMs),
    ];
    for (const timer of this.timers) timer.unref();
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  /** A timer's run: never rejects. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.run();
    } catch (error) {
      this.logger.error(`tick failed (${error instanceof Error ? error.name : 'Error'})`);
    } finally {
      this.running = false;
    }
  }

  /** One run under the lock; `{ skipped: true }` when another task holds it. */
  async run(options: { now?: Date; businessIds?: string[] } = {}): Promise<WaitlistJobResult> {
    const total: WaitlistRun = { expired: 0, closed: 0, offered: 0 };
    const result = await this.database.withScope(
      { kind: 'platform' },
      async (tx) => {
        const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(${WAITLIST_LOCK_KEY}::bigint) AS locked`;
        if (!row?.locked) return { skipped: true } as const;
        const deadline = Date.now() + BUDGET_MS;
        for (const businessId of await this.waitlist.activeFirms(options.businessIds)) {
          if (Date.now() > deadline) break;
          try {
            const run = await this.waitlist.runFirm(
              businessId,
              options.now ?? new Date(),
              deadline,
            );
            total.expired += run.expired;
            total.closed += run.closed;
            total.offered += run.offered;
          } catch (error) {
            this.logger.warn(
              `firm ${businessId} failed (${error instanceof Error ? error.name : 'Error'})`,
            );
          }
        }
        return { skipped: false, ...total } as const;
      },
      { timeout: 60_000 },
    );
    if (total.offered + total.expired + total.closed > 0) {
      this.logger.log(
        `waitlist: ${total.offered} offered, ${total.expired} expired, ${total.closed} closed`,
      );
    }
    return result;
  }
}
