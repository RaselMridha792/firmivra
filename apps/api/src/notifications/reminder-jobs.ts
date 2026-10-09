import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { DATABASE } from '../database/database.module.js';
import type { NotifyConfig } from '../notify/config.js';
import { NOTIFY_CONFIG } from '../notify/notify.module.js';
import { Notifier } from './notifier.js';

/**
 * Advisory lock keys (q30: one API task runs a given job at a time). Fixed numbers, one per job,
 * in a range no other module uses ("R6" = 0x5236).
 */
export const JOB_LOCK_KEYS = {
  'appointment-reminders': 0x5236_0001,
  'note-reminders': 0x5236_0002,
} as const;
export type ReminderJob = keyof typeof JOB_LOCK_KEYS;

/** How often each job looks for due reminders. */
export const JOB_INTERVAL_MS = 60_000;
/** An appointment's reminder goes out within this time before it starts. */
export const APPOINTMENT_REMINDER_AHEAD_MS = 24 * 60 * 60_000;
/** No reminder this soon after the booking or change email (it just told the client). */
export const APPOINTMENT_REMINDER_QUIET_MS = 2 * 60 * 60_000;
/** Per firm and run; the rest waits for the next run. */
const BATCH = 50;
/** The lock's transaction is capped at 30 s (MAX_TRANSACTION_MS); a run stops starting work here. */
const BUDGET_MS = 20_000;

export interface JobRunOptions {
  now?: Date;
  /** Only these firms (tests); otherwise every ACTIVE firm. */
  businessIds?: string[];
}

export type JobRunResult = { skipped: true } | { skipped: false; sent: number };

/**
 * R6 step 7: the reminder jobs, in-process in the API (q30). Every JOB_INTERVAL_MS each job takes
 * its Postgres advisory lock with pg_try_advisory_xact_lock in a transaction held for the run, so
 * only one API task runs it at a time and a second one skips; the lock goes when the run ends (or
 * the transaction times out, or the connection drops). Each reminder is sent once: the Notifier's
 * `eventKey` keeps a retried bell item (and its email) from going out twice, and the record's own
 * marker (`appointments.reminder_sent_at`, `client_note_reminders.reminded_at`) is set only for
 * the time that was reminded, so a reschedule (which clears reminder_sent_at) gets its own.
 * Started at boot unless NOTIFY_JOBS=off (the default under NODE_ENV=test).
 */
@Injectable()
export class ReminderJobs implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('ReminderJobs');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(NOTIFY_CONFIG) private readonly config: NotifyConfig,
    private readonly notifier: Notifier,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.jobs) this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(intervalMs = JOB_INTERVAL_MS): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One round of both jobs; a round still running is not started again in this task. */
  async tick(options: JobRunOptions = {}): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const job of Object.keys(JOB_LOCK_KEYS) as ReminderJob[]) {
        await this.run(job, options);
      }
    } finally {
      this.running = false;
    }
  }

  /** Runs one job under its lock; `{ skipped: true }` when another task holds it. */
  async run(job: ReminderJob, options: JobRunOptions = {}): Promise<JobRunResult> {
    try {
      return await this.database.withScope(
        { kind: 'platform' },
        async (tx) => {
          const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(${JOB_LOCK_KEYS[job]}::bigint) AS locked`;
          if (!row?.locked) return { skipped: true } as const;
          const sent =
            job === 'appointment-reminders'
              ? await this.appointmentReminders(options)
              : await this.noteReminders(options);
          if (sent > 0) this.logger.log(`${job}: ${sent} sent`);
          return { skipped: false, sent } as const;
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      this.logger.warn(`${job}: run failed (${error instanceof Error ? error.name : 'Error'})`);
      return { skipped: false, sent: 0 };
    }
  }

  private async firms(options: JobRunOptions): Promise<string[]> {
    const rows = await this.database.forPlatform().business.findMany({
      where: {
        status: 'ACTIVE',
        ...(options.businessIds ? { id: { in: options.businessIds } } : {}),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((r) => r.id);
  }

  private async appointmentReminders(options: JobRunOptions): Promise<number> {
    const now = options.now ?? new Date();
    const quietSince = new Date(now.getTime() - APPOINTMENT_REMINDER_QUIET_MS);
    const deadline = Date.now() + BUDGET_MS;
    let sent = 0;
    for (const businessId of await this.firms(options)) {
      if (Date.now() > deadline) break;
      const db = this.database.forBusiness(businessId);
      const due = await db.appointment.findMany({
        where: {
          businessId,
          status: 'SCHEDULED',
          reminderSentAt: null,
          startsAt: { gt: now, lte: new Date(now.getTime() + APPOINTMENT_REMINDER_AHEAD_MS) },
          createdAt: { lte: quietSince },
          OR: [{ rescheduledAt: null }, { rescheduledAt: { lte: quietSince } }],
        },
        select: { id: true, startsAt: true },
        orderBy: { startsAt: 'asc' },
        take: BATCH,
      });
      for (const a of due) {
        if (Date.now() > deadline) break;
        const result = await this.notifier.notify({
          businessId,
          event: 'appointment.reminder',
          recordId: a.id,
          audience: 'both',
          eventKey: `appointment.reminder:${a.id}:${a.startsAt.toISOString()}`,
        });
        if (result.failed) continue;
        // Only for the time that was reminded: a reschedule meanwhile keeps its own reminder.
        const { count } = await db.appointment.updateMany({
          where: { businessId, id: a.id, startsAt: a.startsAt, reminderSentAt: null },
          data: { reminderSentAt: now },
        });
        sent += count;
      }
    }
    return sent;
  }

  private async noteReminders(options: JobRunOptions): Promise<number> {
    const now = options.now ?? new Date();
    const deadline = Date.now() + BUDGET_MS;
    let sent = 0;
    for (const businessId of await this.firms(options)) {
      if (Date.now() > deadline) break;
      // Firm scope without an actor sees only due reminders, never the note (R0's policy).
      const db = this.database.forBusiness(businessId);
      const due = await db.clientNoteReminder.findMany({
        where: { businessId, remindedAt: null, remindAt: { lte: now } },
        select: { id: true, remindAt: true },
        orderBy: { remindAt: 'asc' },
        take: BATCH,
      });
      for (const r of due) {
        if (Date.now() > deadline) break;
        const result = await this.notifier.notify({
          businessId,
          event: 'client-note.reminder',
          recordId: r.id,
          eventKey: `client-note.reminder:${r.id}:${r.remindAt.toISOString()}`,
        });
        if (result.failed) continue;
        const { count } = await db.clientNoteReminder.updateMany({
          where: { businessId, id: r.id, remindAt: r.remindAt, remindedAt: null },
          data: { remindedAt: now },
        });
        sent += count;
      }
    }
    return sent;
  }
}
