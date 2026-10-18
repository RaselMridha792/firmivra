import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { DATABASE } from '../database/database.module.js';
import { AutomationEngine } from './engine.service.js';

/** The job's advisory lock key: fixed, in a range no other module uses ("R55" = 0x5537). */
export const AUTOMATION_LOCK_KEY = 0x5537_0002;
/** How often the job looks for records that start a rule and for actions whose time has come. */
export const AUTOMATION_JOB_INTERVAL_MS = 5 * 60_000;
/** The lock's transaction is capped at 30 s; a run stops starting firms here. */
const BUDGET_MS = 20_000;

/**
 * AUTOMATION_JOBS=on|off: run the job in this API task. Default on, off under NODE_ENV=test (tests
 * call `run()` themselves). Any other value is refused at boot.
 */
export function automationJobsOn(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.AUTOMATION_JOBS;
  if (value === undefined || value === '') return env.NODE_ENV !== 'test';
  if (value === 'on' || value === 'off') return value === 'on';
  throw new Error('AUTOMATION_JOBS must be "on" or "off"');
}

export type AutomationJobResult =
  | { skipped: true }
  | {
      skipped: false;
      firms: number;
      started: number;
      executed: number;
      stopped: number;
      expired: number;
    };

/**
 * Automations (R55): starts runs for the records that match each active rule and runs the actions
 * whose time has come, in-process like the other jobs. Each run takes a Postgres advisory lock, so
 * only one API task runs it. Every run and action is keyed (rule, record, occurrence, action), so
 * a second pass, a second task or a retry never makes a second task or message.
 */
@Injectable()
export class AutomationJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('AutomationJob');
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly engine: AutomationEngine,
  ) {}

  onApplicationBootstrap(): void {
    if (automationJobsOn()) this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(intervalMs = AUTOMATION_JOB_INTERVAL_MS): void {
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

  async run(options: { now?: Date; businessIds?: string[] } = {}): Promise<AutomationJobResult> {
    const totals = { firms: 0, started: 0, executed: 0, stopped: 0, expired: 0 };
    try {
      const locked = await this.database.withScope(
        { kind: 'platform' },
        async (tx) => {
          const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(${AUTOMATION_LOCK_KEY}::bigint) AS locked`;
          if (!row?.locked) return false;
          const now = options.now ?? new Date();
          const deadline = Date.now() + BUDGET_MS;
          const firms = await this.database.forPlatform().business.findMany({
            where: {
              status: 'ACTIVE',
              ...(options.businessIds ? { id: { in: options.businessIds } } : {}),
            },
            select: { id: true },
            orderBy: { id: 'asc' },
          });
          for (const firm of firms) {
            if (Date.now() > deadline) break;
            try {
              const r = await this.engine.scanFirm(firm.id, now);
              totals.firms += 1;
              totals.started += r.started;
              totals.executed += r.executed;
              totals.stopped += r.stopped;
              totals.expired += r.expired;
            } catch (error) {
              // One firm's trouble never stops the others.
              this.logger.warn(
                `firm run failed (${error instanceof Error ? error.name : 'Error'})`,
              );
            }
          }
          return true;
        },
        { timeout: 30_000 },
      );
      return locked ? { skipped: false, ...totals } : { skipped: true };
    } catch (error) {
      this.logger.warn(`run failed (${error instanceof Error ? error.name : 'Error'})`);
      return { skipped: false, ...totals };
    }
  }
}
