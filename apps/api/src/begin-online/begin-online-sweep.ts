import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { DATABASE } from '../database/database.module.js';
import { BeginOnlineService } from './begin-online.service.js';

/** The job's advisory lock key: fixed, in a range no other module uses ("R11" = 0x5211). */
export const BEGIN_ONLINE_SWEEP_LOCK_KEY = 0x5211_0001;
/** How often the job looks for drafts past their expiry that nobody reopened. */
export const BEGIN_ONLINE_SWEEP_INTERVAL_MS = 60 * 60_000;
/** Per firm and run; the rest waits for the next run. */
const BATCH = 100;
/** The lock's transaction is capped at 60 s; a run stops starting work here. */
const BUDGET_MS = 45_000;

/**
 * BEGIN_ONLINE_SWEEP=on|off: run the sweep in this API task. Default on, off under NODE_ENV=test
 * (tests call `run()` themselves). Any other value is refused at boot.
 */
export function beginOnlineSweepOn(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env['BEGIN_ONLINE_SWEEP'];
  if (value === undefined || value === '') return env.NODE_ENV !== 'test';
  if (value === 'on' || value === 'off') return value === 'on';
  throw new Error('BEGIN_ONLINE_SWEEP must be "on" or "off"');
}

export type SweepResult = { skipped: true } | { skipped: false; expired: number };

/**
 * Expires Begin Online drafts past their expiry that nobody reopens (a visitor's own call expires
 * one it reaches): their answers and files go and the lead becomes EXPIRED, through
 * `BeginOnlineService.expire` (one transaction per draft, intake then lead). In-process like the
 * invoice and reminder jobs: each run takes the job's advisory lock (pg_try_advisory_xact_lock in
 * a platform transaction held for the run), so only one API task runs it at a time.
 */
@Injectable()
export class BeginOnlineSweep implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('BeginOnlineSweep');
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly drafts: BeginOnlineService,
  ) {}

  onApplicationBootstrap(): void {
    if (beginOnlineSweepOn()) this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(intervalMs = BEGIN_ONLINE_SWEEP_INTERVAL_MS): void {
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
  async run(options: { businessIds?: string[] } = {}): Promise<SweepResult> {
    let expired = 0;
    const result = await this.database.withScope(
      { kind: 'platform' },
      async (tx) => {
        const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(${BEGIN_ONLINE_SWEEP_LOCK_KEY}::bigint) AS locked`;
        if (!row?.locked) return { skipped: true } as const;
        const deadline = Date.now() + BUDGET_MS;
        const firms = await this.database.forPlatform().business.findMany({
          where: options.businessIds ? { id: { in: options.businessIds } } : {},
          select: { id: true },
          orderBy: { id: 'asc' },
        });
        for (const { id: businessId } of firms) {
          if (Date.now() > deadline) break;
          expired += await this.sweepFirm(businessId, deadline).catch((error: unknown) => {
            // One firm's failure never holds up the others; ids only.
            this.logger.warn(
              `firm ${businessId} failed (${error instanceof Error ? error.name : 'Error'})`,
            );
            return 0;
          });
        }
        return { skipped: false, expired } as const;
      },
      { timeout: 60_000 },
    );
    if (expired > 0) this.logger.log(`${expired} Begin Online drafts expired`);
    return result;
  }

  private async sweepFirm(businessId: string, deadline: number): Promise<number> {
    const due = await this.database.forBusiness(businessId).lead.findMany({
      where: { status: 'DRAFT', draftExpiresAt: { lte: new Date() } },
      select: { id: true },
      orderBy: [{ draftExpiresAt: 'asc' }, { id: 'asc' }],
      take: BATCH,
    });
    let done = 0;
    for (const { id } of due) {
      if (Date.now() > deadline) break;
      if (await this.drafts.expire(businessId, id)) done += 1;
    }
    return done;
  }
}
