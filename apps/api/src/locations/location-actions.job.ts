import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { databaseErrorCode, type Database, isDbError, type TxClient } from '@firmivra/db';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { MemberChanged } from '../staff/staff-actions.service.js';
import {
  applyAction,
  decideNow,
  finishDone,
  finishFailed,
  lockLocations,
} from './location-actions.js';

/** The job's advisory lock key: fixed, in R1's range ("R1" = 0x5231). */
export const LOCATION_ACTIONS_LOCK_KEY = 0x5231_0001;
/** How often the job looks for scheduled Locations changes that are due. */
export const LOCATION_ACTIONS_JOB_INTERVAL_MS = 60_000;
/** Actions run per firm and run; the rest waits for the next run. */
const BATCH = 100;
/** The lock's transaction is capped at 30 s; a run stops starting work here. */
const BUDGET_MS = 20_000;

/**
 * LOCATION_JOBS=on|off: run the job in this API task. Default on, off under NODE_ENV=test
 * (tests call `run()` themselves). Any other value is refused at boot (env.ts too).
 */
export function locationJobsOn(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.LOCATION_JOBS;
  if (value === undefined || value === '') return env.NODE_ENV !== 'test';
  if (value === 'on' || value === 'off') return value === 'on';
  throw new Error('LOCATION_JOBS must be "on" or "off"');
}

export interface LocationActionsJobOptions {
  /** Only these firms (tests); otherwise every ACTIVE firm. */
  businessIds?: string[];
}
export type LocationActionsJobResult =
  { skipped: true } | { skipped: false; done: number; failed: number; retried: number };

/** Errors that say nothing about the action: it stays PENDING and the next run tries again. */
const transient = (error: unknown) =>
  error instanceof MemberChanged ||
  ['40001', '40P01', '55P03'].includes(databaseErrorCode(error) ?? '') ||
  ['P2028', 'P2034'].includes((error as { code?: string } | null)?.code ?? '');

/**
 * Scheduled Locations changes (R1, Settings > Locations): every minute, each PENDING action whose
 * time has come runs once, in its firm's business scope and under the firm's Locations lock (the
 * same as the screens' changes): DEACTIVATE_LOCATION, REASSIGN_MANAGER and DEACTIVATE_MANAGER do
 * what they do "now" (location-actions.ts), or the action is FAILED with a code when it can no
 * longer run (the main location, a new manager who left, ...). The row is locked and must still be
 * PENDING and due by the database's clock, and the trigger lets an action finish only once, so a
 * second task or an overlapping run is a no-op. One firm's trouble never stops the others; a
 * passing database trouble leaves the action for the next run, any other fails it (RUN_FAILED,
 * or LAST_ACTIVE_OWNER), audited.
 */
@Injectable()
export class LocationActionsJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('LocationActionsJob');
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap(): void {
    if (locationJobsOn()) this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(intervalMs = LOCATION_ACTIONS_JOB_INTERVAL_MS): void {
    if (this.timers.length > 0) return;
    this.timers = [
      setTimeout(() => void this.tick(), 30_000),
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

  async run(options: LocationActionsJobOptions = {}): Promise<LocationActionsJobResult> {
    const totals = { done: 0, failed: 0, retried: 0 };
    try {
      return await this.database.withScope(
        { kind: 'platform' },
        async (tx) => {
          const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(${LOCATION_ACTIONS_LOCK_KEY}::bigint) AS locked`;
          if (!row?.locked) return { skipped: true } as const;
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
              await this.runFirm(firm.id, deadline, totals);
            } catch (error) {
              // One firm's trouble never stops the others.
              this.logger.warn(
                `firm run failed (${error instanceof Error ? error.name : 'Error'})`,
              );
            }
          }
          return { skipped: false, ...totals } as const;
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      this.logger.warn(`run failed (${error instanceof Error ? error.name : 'Error'})`);
      return { skipped: false, ...totals };
    }
  }

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** One firm: its due actions, oldest first, each in its own transaction. */
  private async runFirm(
    businessId: string,
    deadline: number,
    totals: { done: number; failed: number; retried: number },
  ): Promise<void> {
    const due = await this.inFirm(
      businessId,
      (tx) => tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM firm_office_actions
        WHERE business_id = ${businessId}::uuid AND status = 'PENDING' AND effective_at <= now()
        ORDER BY effective_at, id
        LIMIT ${BATCH}`,
    );
    for (const { id } of due) {
      if (Date.now() > deadline) break;
      try {
        const outcome = await this.runOne(businessId, id);
        if (outcome === 'DONE') totals.done++;
        if (outcome === 'FAILED') totals.failed++;
      } catch (error) {
        if (transient(error)) {
          totals.retried++;
          this.logger.warn(
            `action ${id} waits for the next run (${error instanceof Error ? error.name : 'Error'})`,
          );
          continue;
        }
        totals.failed++;
        await this.fail(
          businessId,
          id,
          isDbError(error, 'LAST_ACTIVE_OWNER') ? 'LAST_ACTIVE_OWNER' : 'RUN_FAILED',
        );
      }
    }
  }

  /**
   * Runs one due action: locked, still PENDING and due by the database's clock, else nothing.
   * Exported for the tests through `run`; also safe to call twice.
   */
  async runOne(businessId: string, id: string): Promise<'DONE' | 'FAILED' | 'IGNORED'> {
    return this.inFirm(businessId, async (tx) => {
      await lockLocations(tx, businessId);
      const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM firm_office_actions
        WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid AND status = 'PENDING'
          AND effective_at <= now()
        FOR UPDATE SKIP LOCKED`;
      if (!locked) return 'IGNORED' as const;
      const action = await tx.firmOfficeAction.findFirstOrThrow({ where: { businessId, id } });
      const decision = await decideNow(tx, businessId, action);
      if (decision.outcome === 'FAILED') {
        await finishFailed(tx, this.audit, businessId, action, decision.code);
        return 'FAILED' as const;
      }
      await applyAction(tx, this.audit, businessId, action);
      await finishDone(tx, this.audit, businessId, action, false);
      return 'DONE' as const;
    });
  }

  /** An action the run could not do: FAILED with a safe code (never a message), audited. */
  private async fail(businessId: string, id: string, code: string): Promise<void> {
    this.logger.warn(`action ${id} failed (${code})`);
    try {
      await this.inFirm(businessId, async (tx) => {
        await lockLocations(tx, businessId);
        const action = await tx.firmOfficeAction.findFirst({ where: { businessId, id } });
        if (!action || action.status !== 'PENDING') return;
        await finishFailed(tx, this.audit, businessId, action, code);
      });
    } catch {
      // The next run tries again.
    }
  }
}
