import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { AuditService } from '../../audit/audit.service.js';
import { DATABASE } from '../../database/database.module.js';
import { InvoiceNotices } from './invoice-notices.js';
import { firmToday, toDate } from './invoice-view.js';

/** The job's advisory lock key: fixed, in a range no other module uses ("R7" = 0x5237). */
export const OPEN_SCHEDULED_LOCK_KEY = 0x5237_0001;
/** How often the job looks for scheduled invoices whose day has come in their firm. */
export const INVOICE_JOB_INTERVAL_MS = 15 * 60_000;
/** Per firm and run; the rest waits for the next run. */
const BATCH = 100;
/** The lock's transaction is capped at 30 s; a run stops starting work here. */
const BUDGET_MS = 20_000;

/**
 * INVOICE_JOBS=on|off: run the job in this API task. Default on, off under NODE_ENV=test (tests
 * call `run()` themselves).
 */
export function invoiceJobsOn(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.INVOICE_JOBS === 'on' || env.INVOICE_JOBS === 'off') return env.INVOICE_JOBS === 'on';
  return env.NODE_ENV !== 'test';
}

export interface InvoiceJobOptions {
  now?: Date;
  /** Only these firms (tests); otherwise every ACTIVE firm. */
  businessIds?: string[];
}

export type InvoiceJobResult = { skipped: true } | { skipped: false; opened: number };

/**
 * R7 step 10: opens SCHEDULED invoices whose day has come in their firm's time zone, in-process
 * in the API like the reminder jobs (q30). Each run takes the job's Postgres advisory lock with
 * pg_try_advisory_xact_lock in a platform transaction held for the run, so only one API task runs
 * it at a time and another skips. Each firm's invoices open in that firm's business scope: OPEN,
 * `issued_at` now, `scheduled_for` cleared, audited `invoice.opened`; the client gets
 * `invoice.sent` after the change commits. Only a row still SCHEDULED changes, so a cancel or a
 * second run in between never opens it twice.
 */
@Injectable()
export class InvoiceJobs implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('InvoiceJobs');
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly notices: InvoiceNotices,
  ) {}

  onApplicationBootstrap(): void {
    if (invoiceJobsOn()) this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(intervalMs = INVOICE_JOB_INTERVAL_MS): void {
    if (this.timers.length > 0) return;
    // A first run soon after boot, so a deploy at midnight does not wait a whole interval.
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

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.run();
    } finally {
      this.running = false;
    }
  }

  /** One run under the lock; `{ skipped: true }` when another task holds it. */
  async run(options: InvoiceJobOptions = {}): Promise<InvoiceJobResult> {
    const opened: { businessId: string; id: string }[] = [];
    let result: InvoiceJobResult;
    try {
      result = await this.database.withScope(
        { kind: 'platform' },
        async (tx) => {
          const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(${OPEN_SCHEDULED_LOCK_KEY}::bigint) AS locked`;
          if (!row?.locked) return { skipped: true } as const;
          await this.openDue(options, opened);
          return { skipped: false, opened: opened.length } as const;
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      this.logger.warn(`run failed (${error instanceof Error ? error.name : 'Error'})`);
      result = { skipped: false, opened: opened.length };
    }
    if (opened.length > 0) this.logger.log(`${opened.length} scheduled invoices opened`);
    // After every firm's change has committed; a failed notice only logs ids (InvoiceNotices).
    for (const { businessId, id } of opened) {
      await this.notices.send('invoice.sent', businessId, id);
    }
    return result;
  }

  /** Adds each opened invoice to `opened` as its firm's change commits. */
  private async openDue(
    options: InvoiceJobOptions,
    opened: { businessId: string; id: string }[],
  ): Promise<void> {
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
    for (const { id: businessId } of firms) {
      if (Date.now() > deadline) break;
      const ids = await this.openFirm(businessId, now).catch((error: unknown) => {
        // One firm's failure never holds up the others; ids only.
        this.logger.warn(
          `firm ${businessId} failed (${error instanceof Error ? error.name : 'Error'})`,
        );
        return [] as string[];
      });
      opened.push(...ids.map((id) => ({ businessId, id })));
    }
  }

  private async openFirm(businessId: string, now: Date): Promise<string[]> {
    return this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      const { today } = await firmToday(tx, businessId, now);
      const due = await tx.invoice.findMany({
        where: { businessId, status: 'SCHEDULED', scheduledFor: { lte: toDate(today) } },
        select: { id: true, clientId: true, number: true, totalCents: true },
        orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }],
        take: BATCH,
      });
      const done: string[] = [];
      for (const invoice of due) {
        const { count } = await tx.invoice.updateMany({
          where: { businessId, id: invoice.id, status: 'SCHEDULED' },
          data: { status: 'OPEN', issuedAt: now, scheduledFor: null },
        });
        if (count === 0) continue;
        await this.audit.logIn(
          tx,
          'invoice.opened',
          { type: 'invoice', id: invoice.id },
          {
            actor: 'job',
            clientId: invoice.clientId,
            number: invoice.number,
            totalCents: invoice.totalCents,
          },
          { businessId },
        );
        done.push(invoice.id);
      }
      return done;
    });
  }
}
