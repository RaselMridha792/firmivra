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
import { InvoicesService } from './invoices.service.js';
import { firmToday, toDate } from './invoice-view.js';
import { addDays, zonedInstant } from '../../appointments/calendar.js';

/** The job's advisory lock key: fixed, in a range no other module uses ("R7" = 0x5237). */
export const OPEN_SCHEDULED_LOCK_KEY = 0x5237_0001;
/**
 * Invoices Review 2 (I-C02, I-N04): a reminder or an overdue notice goes out on its day from this
 * time (the firm's time zone), not at midnight.
 */
export const INVOICE_REMINDER_FROM_MINUTES = 9 * 60;
/** How often the job looks for scheduled invoices whose day has come in their firm. */
export const INVOICE_JOB_INTERVAL_MS = 15 * 60_000;
/** Per firm and run; the rest waits for the next run. */
const BATCH = 100;
/** The lock's transaction is capped at 30 s; a run stops starting work here. */
const BUDGET_MS = 20_000;

/**
 * INVOICE_JOBS=on|off: run the job in this API task. Default on, off under NODE_ENV=test (tests
 * call `run()` themselves). Any other value is refused at boot, so a typo never leaves it on.
 */
export function invoiceJobsOn(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.INVOICE_JOBS;
  if (value === undefined || value === '') return env.NODE_ENV !== 'test';
  if (value === 'on' || value === 'off') return value === 'on';
  throw new Error('INVOICE_JOBS must be "on" or "off"');
}

export interface InvoiceJobOptions {
  now?: Date;
  /** Only these firms (tests); otherwise every ACTIVE firm. */
  businessIds?: string[];
}

export type InvoiceJobResult =
  { skipped: true } | { skipped: false; opened: number; reminded: number };

/** One reminder or overdue notice due today: its event and its step ("before-7", "overdue-2"). */
interface DueReminder {
  businessId: string;
  id: string;
  clientId: string;
  event: 'invoice.reminder' | 'invoice.overdue';
  step: string;
  dueOn: string;
}

/**
 * I-C02, I-N04: the step an open invoice is at today, or null. Before the due date: on each day
 * of the firm's list (0: the due date). After it: the day after the due date, then every
 * `repeatDays` days (0: once), up to `max` notices. Only on the step's own day.
 */
export function reminderStep(
  today: string,
  dueOn: string,
  s: {
    sendReminders: boolean;
    reminderDaysBeforeList: number[];
    notifyOverdue: boolean;
    overdueReminderDays: number;
    overdueReminderMax: number;
  },
): { event: 'invoice.reminder' | 'invoice.overdue'; step: string } | null {
  if (s.sendReminders) {
    for (const d of [...new Set(s.reminderDaysBeforeList)]) {
      if (addDays(dueOn, -d) === today) return { event: 'invoice.reminder', step: `before-${d}` };
    }
  }
  if (!s.notifyOverdue || today <= dueOn) return null;
  const late = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueOn}T00:00:00Z`)) / 86_400_000,
  );
  const n =
    s.overdueReminderDays === 0
      ? late === 1
        ? 1
        : 0
      : (late - 1) % s.overdueReminderDays === 0
        ? (late - 1) / s.overdueReminderDays + 1
        : 0;
  return n >= 1 && n <= s.overdueReminderMax
    ? { event: 'invoice.overdue', step: `overdue-${n}` }
    : null;
}

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
    private readonly invoices: InvoicesService,
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

  /** A timer's run: never rejects, so a failure cannot become an unhandled rejection. */
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
  async run(options: InvoiceJobOptions = {}): Promise<InvoiceJobResult> {
    const opened: { businessId: string; id: string }[] = [];
    const reminders: DueReminder[] = [];
    let result: InvoiceJobResult;
    try {
      result = await this.database.withScope(
        { kind: 'platform' },
        async (tx) => {
          const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(${OPEN_SCHEDULED_LOCK_KEY}::bigint) AS locked`;
          if (!row?.locked) return { skipped: true } as const;
          await this.openDue(options, opened);
          await this.dueReminders(options, reminders);
          return { skipped: false, opened: opened.length, reminded: 0 } as const;
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      this.logger.warn(`run failed (${error instanceof Error ? error.name : 'Error'})`);
      result = { skipped: false, opened: opened.length, reminded: 0 };
    }
    if (opened.length > 0) this.logger.log(`${opened.length} scheduled invoices opened`);
    // After every firm's change has committed; a failed notice only logs ids (InvoiceNotices).
    for (const { businessId, id } of opened) {
      await this.notices.send('invoice.sent', businessId, id);
    }
    // I-C02, I-N04: once per invoice, step and due date (the key); paid or canceled meanwhile, the
    // Notifier's own check stops it.
    let reminded = 0;
    for (const r of reminders) {
      const sent = await this.notices.remind(
        r.event,
        r.businessId,
        r.id,
        `${r.event}:${r.id}:${r.step}:${r.dueOn}`,
      );
      if (!sent) continue;
      reminded++;
      // A job has no request: the firm is named, as invoice.opened is.
      await this.database
        .withScope({ kind: 'business', businessId: r.businessId }, (tx) =>
          this.audit.logIn(
            tx,
            'invoice.reminder_sent',
            { type: 'invoice', id: r.id },
            { actor: 'job', clientId: r.clientId, step: r.step, dueOn: r.dueOn },
            { businessId: r.businessId },
          ),
        )
        .catch(() => this.logger.warn(`invoice ${r.id} reminder audit failed`));
    }
    return result.skipped ? result : { ...result, reminded };
  }

  /**
   * I-C02, I-N04: each firm's open invoices at a reminder or overdue step today, from
   * INVOICE_REMINDER_FROM_MINUTES on, one notice per invoice and step. A firm that never saved its
   * payment settings sends none (every option starts off). A step already sent (its bell item is
   * there) is left out; the Notifier's key keeps it once anyway.
   */
  private async dueReminders(options: InvoiceJobOptions, out: DueReminder[]): Promise<void> {
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
      const found = await this.database
        .withScope({ kind: 'business', businessId }, async (tx) => {
          const s = await tx.paymentSettings.findUnique({
            where: { businessId },
            select: {
              sendReminders: true,
              reminderDaysBeforeList: true,
              notifyOverdue: true,
              overdueReminderDays: true,
              overdueReminderMax: true,
            },
          });
          if (!s || (!s.sendReminders && !s.notifyOverdue)) return [];
          const { timeZone, today } = await firmToday(tx, businessId, now);
          if (now.getTime() < zonedInstant(timeZone, today, INVOICE_REMINDER_FROM_MINUTES))
            return [];
          const ahead = Math.max(0, ...s.reminderDaysBeforeList);
          const behind = 1 + s.overdueReminderDays * Math.max(0, s.overdueReminderMax - 1);
          const invoices = await tx.invoice.findMany({
            where: {
              businessId,
              status: 'OPEN',
              dueOn: { gte: toDate(addDays(today, -behind)), lte: toDate(addDays(today, ahead)) },
              // Q23 (IP-041): none while a payment is processing (a bank debit Stripe is settling,
              // shown as Processing): the client already paid and waits for the bank.
              payments: {
                none: {
                  status: 'PENDING',
                  events: { some: { type: 'checkout.session.completed' } },
                },
              },
            },
            select: { id: true, clientId: true, dueOn: true },
            orderBy: [{ dueOn: 'asc' }, { id: 'asc' }],
            take: BATCH * 10,
          });
          const due: DueReminder[] = [];
          for (const i of invoices) {
            const dueOn = i.dueOn!.toISOString().slice(0, 10);
            const step = reminderStep(today, dueOn, {
              ...s,
              reminderDaysBeforeList: s.reminderDaysBeforeList ?? [],
            });
            if (!step) continue;
            const key = `${step.event}:${i.id}:${step.step}:${dueOn}`;
            const sent = await tx.notification.findFirst({
              where: { businessId, eventKey: key },
              select: { id: true },
            });
            if (sent) continue;
            due.push({ businessId, id: i.id, clientId: i.clientId, ...step, dueOn });
            if (due.length >= BATCH) break;
          }
          return due;
        })
        .catch((error: unknown) => {
          this.logger.warn(
            `firm ${businessId} reminders failed (${error instanceof Error ? error.name : 'Error'})`,
          );
          return [] as DueReminder[];
        });
      out.push(...found);
    }
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
      const made = await this.makeRecurring(businessId, now).catch((error: unknown) => {
        this.logger.warn(
          `firm ${businessId} recurring failed (${error instanceof Error ? error.name : 'Error'})`,
        );
        return [] as string[];
      });
      opened.push(...made.map((id) => ({ businessId, id })));
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

  /**
   * IP-F18: each active recurring invoice whose next send day has come (the firm's calendar) makes
   * that period's invoice, one schedule at a time in its own transaction. A schedule that fails is
   * logged with ids only and tried again on the next run; the period is never made twice (the
   * unique index). Returns the invoices that opened, whose notices go after the commit.
   */
  private async makeRecurring(businessId: string, now: Date): Promise<string[]> {
    const due = await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      const { today } = await firmToday(tx, businessId, now);
      return tx.recurringInvoice.findMany({
        where: { businessId, status: 'ACTIVE', nextSendOn: { lte: toDate(today) } },
        select: { id: true },
        orderBy: [{ nextSendOn: 'asc' }, { id: 'asc' }],
        take: BATCH,
      });
    });
    const opened: string[] = [];
    for (const { id } of due) {
      const made = await this.database
        .withScope({ kind: 'business', businessId }, (tx) =>
          this.invoices.makePeriodInvoice(tx, businessId, id, {
            send: 'auto',
            actorUserId: null,
            now,
          }),
        )
        .catch((error: unknown) => {
          this.logger.warn(
            `recurring invoice ${id} of firm ${businessId} failed (${error instanceof Error ? error.name : 'Error'})`,
          );
          return null;
        });
      if (made?.opened) opened.push(made.invoiceId);
    }
    return opened;
  }
}
