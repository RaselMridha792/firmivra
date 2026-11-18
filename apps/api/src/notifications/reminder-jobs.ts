import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { firmTimeZone } from '../appointments/calendar-data.js';
import { REMINDER_EARLY_MINUTES } from '../appointments/notice-words.js';
import {
  addDays,
  minutesOf,
  timeOfDayFromDb,
  zonedDate,
  zonedInstant,
} from '../appointments/calendar.js';
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
  'email-retries': 0x5236_0003,
  'project-deadline-reminders': 0x5236_0004,
  'task-reminders': 0x5236_0005,
} as const;
export type ReminderJob = keyof typeof JOB_LOCK_KEYS;

/** How often each job looks for due reminders. */
export const JOB_INTERVAL_MS = 60_000;
/** An appointment's reminder goes out within this time before it starts. */
export const APPOINTMENT_REMINDER_AHEAD_MS = 24 * 60 * 60_000;
/** No reminder this soon after the booking or change email (it just told the client). */
export const APPOINTMENT_REMINDER_QUIET_MS = 2 * 60 * 60_000;
/**
 * A7: a configured reminder goes out up to one run early, so one "at the start" (0 minutes
 * before) still goes before the appointment starts.
 */
export const APPOINTMENT_REMINDER_EARLY_MS = REMINDER_EARLY_MINUTES * 60_000;
/** An email copy is tried at most this often (the first try is inline, when it is written). */
export const EMAIL_MAX_ATTEMPTS = 5;
/** A failed copy waits this long before its next try; a QUEUED one this long before it is taken. */
export const EMAIL_RETRY_AFTER_MS = 5 * 60_000;
/**
 * Tax Planning Review 2 (Project Deadlines): a reminder still goes out this long after its
 * deadline passed (a reminder at the due time, or one held up by a stopped task); later, never.
 */
export const PROJECT_DEADLINE_LATE_MS = 60 * 60_000;
/**
 * Tasks T-D12: a task reminder still goes out this long after its time (a run that was held up);
 * later, never.
 */
export const TASK_REMINDER_LATE_MS = 60 * 60_000;
/** A days rule with no time of its own fires at this time of day, in the firm's time zone. */
export const TASK_REMINDER_DEFAULT_TIME = '09:00';
/** The Notifier reaches at most this many chosen members per call. */
const CHOSEN_PER_CALL = 20;
/** A reminder whose notify() failed is left out of the runs this long. */
export const REMINDER_BACKOFF_MS = 5 * 60_000;
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
 * R6 step 7: the reminder jobs and the email outbox's retries, in-process in the API (q30). Every JOB_INTERVAL_MS each job takes
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
  /**
   * Reminders whose notify() failed, by job and record id, with the time of the failure: left out
   * of the runs for REMINDER_BACKOFF_MS, so a few that always fail never fill a firm's batch and
   * hold up the rest. In memory: a restart (or another task) just tries them again.
   */
  private readonly failedAt = new Map<string, number>();

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
    this.timer = setInterval(() => {
      // tick() handles each job's errors; this keeps a later change from an unhandled rejection.
      this.tick().catch((error: unknown) =>
        this.logger.error(`tick failed (${error instanceof Error ? error.name : 'Error'})`),
      );
    }, intervalMs);
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
              : job === 'note-reminders'
                ? await this.noteReminders(options)
                : job === 'project-deadline-reminders'
                  ? await this.projectDeadlineReminders(options)
                  : job === 'task-reminders'
                    ? await this.taskReminders(options)
                    : await this.emailRetries(options);
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

  /** The ids of this job's reminders that failed within REMINDER_BACKOFF_MS of `now`. */
  private backingOff(job: ReminderJob, now: Date): string[] {
    const ids: string[] = [];
    for (const [key, at] of this.failedAt) {
      if (now.getTime() - at >= REMINDER_BACKOFF_MS) this.failedAt.delete(key);
      else if (key.startsWith(`${job}:`)) ids.push(key.slice(job.length + 1));
    }
    return ids;
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

  /**
   * A7: first each configured reminder whose time has come (`configuredReminders`), then the
   * automatic one within APPOINTMENT_REMINDER_AHEAD_MS. An appointment with configured reminders
   * gets its client's reminders from them only: its automatic reminder then reaches the firm's
   * side alone (the staff's bell item), so the client never gets the automatic one on top. One
   * with none keeps the automatic reminder on both sides, as before.
   */
  private async appointmentReminders(options: JobRunOptions): Promise<number> {
    const now = options.now ?? new Date();
    const quietSince = new Date(now.getTime() - APPOINTMENT_REMINDER_QUIET_MS);
    const deadline = Date.now() + BUDGET_MS;
    const backingOff = this.backingOff('appointment-reminders', now);
    // Configured reminders back off by row ("row:<id>"), the automatic one by appointment.
    const rowsBackingOff = new Set(
      backingOff.filter((k) => k.startsWith('row:')).map((k) => k.slice(4)),
    );
    const appointmentsBackingOff = backingOff.filter((k) => !k.startsWith('row:'));
    let sent = 0;
    for (const businessId of await this.firms(options)) {
      if (Date.now() > deadline) break;
      sent += await this.configuredReminders(businessId, now, deadline, rowsBackingOff);
      if (Date.now() > deadline) break;
      const db = this.database.forBusiness(businessId);
      const due = await db.appointment.findMany({
        where: {
          businessId,
          id: { notIn: appointmentsBackingOff },
          status: 'SCHEDULED',
          reminderSentAt: null,
          startsAt: { gt: now, lte: new Date(now.getTime() + APPOINTMENT_REMINDER_AHEAD_MS) },
          createdAt: { lte: quietSince },
          OR: [{ rescheduledAt: null }, { rescheduledAt: { lte: quietSince } }],
        },
        select: { id: true, startsAt: true, _count: { select: { reminders: true } } },
        orderBy: { startsAt: 'asc' },
        take: BATCH,
      });
      for (const a of due) {
        if (Date.now() > deadline) break;
        const result = await this.notifier.notify({
          businessId,
          event: 'appointment.reminder',
          recordId: a.id,
          // A7: the client's reminders are the configured ones when it has any.
          audience: a._count.reminders > 0 ? 'staff' : 'both',
          eventKey: `appointment.reminder:${a.id}:${a.startsAt.toISOString()}`,
        });
        if (result.failed) {
          this.failedAt.set(`appointment-reminders:${a.id}`, now.getTime());
          continue;
        }
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

  /**
   * A7: each configured reminder (`appointment_reminders`) whose time has come (`due_at`, up to
   * APPOINTMENT_REMINDER_EARLY_MS early, so one "at the start" still goes before it starts), for
   * an appointment still SCHEDULED and not started, goes out once on its channel through the
   * Notifier, to the client's side only:
   * - EMAIL: a portal bell item and its email copy through the outbox (with the reminder's note);
   * - PORTAL: the portal bell item alone;
   * - SMS: a text (the client's primary login's phone), only when the firm sends texts and the
   *   client agreed to appointment texts (NotifyService), never to a lead (the API refuses one).
   * The reminders of one appointment due at the same offset go in one call, so a client with an
   * EMAIL and a PORTAL reminder at once gets one bell item. A lead's own appointment (no client)
   * reaches its lead by email only, without the portal link (P4-1, `leadNotice`).
   * Once: each row is claimed (`sent_at` set while still empty) before it is sent, so two runs
   * that overlap never send it twice; a send the Notifier could not write is given back (and backs
   * off REMINDER_BACKOFF_MS). A reschedule clears `sent_at` (the database), so the new time gets
   * its own. A reminder whose time had already passed when it was set, or when the appointment was
   * booked or last moved, is never sent: the booking or change notice just told the client, and
   * Send Reminder is there for "now".
   */
  private async configuredReminders(
    businessId: string,
    now: Date,
    deadline: number,
    backingOff: ReadonlySet<string>,
  ): Promise<number> {
    const soon = new Date(now.getTime() + APPOINTMENT_REMINDER_EARLY_MS);
    // The firm's scope keeps RLS on; the times are compared in SQL.
    const found = await this.database.withScope(
      { kind: 'business', businessId },
      (tx) =>
        tx.$queryRaw<
          {
            id: string;
            appointment_id: string;
            offset_minutes: number;
            starts_at: Date;
          }[]
        >`
        SELECT r.id::text AS id, r.appointment_id::text AS appointment_id, r.offset_minutes,
               a.starts_at
        FROM appointment_reminders r
        JOIN appointments a ON a.business_id = r.business_id AND a.id = r.appointment_id
        WHERE r.business_id = ${businessId}::uuid
          AND r.sent_at IS NULL
          AND r.due_at <= ${soon}
          AND r.due_at > r.created_at
          AND r.due_at > a.created_at
          AND (a.rescheduled_at IS NULL OR r.due_at > a.rescheduled_at)
          AND a.status = 'SCHEDULED'
          AND a.starts_at > ${now}
        ORDER BY r.due_at, r.appointment_id, r.offset_minutes, r.id
        LIMIT ${3 * BATCH + backingOff.size}`,
    );
    // One call per appointment and offset (its channels together), up to BATCH calls a run.
    const groups = new Map<
      string,
      { appointmentId: string; offsetMinutes: number; startsAt: Date; ids: string[] }
    >();
    for (const r of found) {
      if (backingOff.has(r.id)) continue;
      const key = `${r.appointment_id}:${r.offset_minutes}`;
      const group = groups.get(key);
      if (group) group.ids.push(r.id);
      else if (groups.size < BATCH) {
        groups.set(key, {
          appointmentId: r.appointment_id,
          offsetMinutes: r.offset_minutes,
          startsAt: r.starts_at,
          ids: [r.id],
        });
      }
    }
    const db = this.database.forBusiness(businessId);
    let sent = 0;
    for (const g of groups.values()) {
      if (Date.now() > deadline) break;
      // Claimed for this run (still unsent, and for the same time), so another run skips them.
      const claimed = await db.appointmentReminder.updateManyAndReturn({
        where: {
          businessId,
          id: { in: g.ids },
          sentAt: null,
          appointment: { startsAt: g.startsAt, status: 'SCHEDULED' },
        },
        data: { sentAt: now },
        select: { id: true, channel: true },
      });
      if (claimed.length === 0) continue;
      const channels = new Set(claimed.map((r) => r.channel));
      let failed: boolean;
      try {
        const result = await this.notifier.notify({
          businessId,
          event: 'appointment.reminder',
          recordId: g.appointmentId,
          audience: 'client',
          eventKey: `appointment.reminder:${g.appointmentId}:${g.offsetMinutes}:${g.startsAt.toISOString()}`,
          channels: {
            inApp: channels.has('EMAIL') || channels.has('PORTAL'),
            email: channels.has('EMAIL'),
            sms: channels.has('SMS'),
          },
        });
        failed = result.failed === true;
      } catch (error) {
        this.logger.warn(
          `appointment reminder for appointment ${g.appointmentId} failed (${error instanceof Error ? error.name : 'Error'})`,
        );
        failed = true;
      }
      if (failed) {
        // Given back for a later run (only while this claim stands; a reschedule cleared it).
        await db.appointmentReminder.updateMany({
          where: { businessId, id: { in: claimed.map((r) => r.id) }, sentAt: now },
          data: { sentAt: null },
        });
        for (const r of claimed) {
          this.failedAt.set(`appointment-reminders:row:${r.id}`, now.getTime());
        }
        continue;
      }
      sent += claimed.length;
    }
    return sent;
  }

  private async noteReminders(options: JobRunOptions): Promise<number> {
    const now = options.now ?? new Date();
    const deadline = Date.now() + BUDGET_MS;
    const backingOff = this.backingOff('note-reminders', now);
    let sent = 0;
    for (const businessId of await this.firms(options)) {
      if (Date.now() > deadline) break;
      // Firm scope without an actor sees only due reminders, never the note (R0's policy).
      const db = this.database.forBusiness(businessId);
      const due = await db.clientNoteReminder.findMany({
        where: {
          businessId,
          id: { notIn: backingOff },
          remindedAt: null,
          remindAt: { lte: now },
        },
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
        if (result.failed) {
          this.failedAt.set(`note-reminders:${r.id}`, now.getTime());
          continue;
        }
        const { count } = await db.clientNoteReminder.updateMany({
          where: { businessId, id: r.id, remindAt: r.remindAt, remindedAt: null },
          data: { remindedAt: now },
        });
        sent += count;
      }
    }
    return sent;
  }

  /**
   * Tax Planning Review 2 (Project Deadlines): each reminder whose time has come (the due time
   * less its minutes), once per due time, for a deadline neither completed nor archived and not
   * past by more than PROJECT_DEADLINE_LATE_MS. It reaches the owner and, when it is SHARED, the
   * coworkers it names, ACTIVE members only (the Notifier's rule for chosen members): a bell item
   * and an email copy through the outbox, as the reminder says. An edit replaces the reminders,
   * and a reminder already sent stays sent unless the due time moved (the API's rule), so a new
   * due time gets its own. `sent_at` is set once the Notifier has the reminder.
   */
  private async projectDeadlineReminders(options: JobRunOptions): Promise<number> {
    const now = options.now ?? new Date();
    const stop = Date.now() + BUDGET_MS;
    const backingOff = new Set(this.backingOff('project-deadline-reminders', now));
    const late = new Date(now.getTime() - PROJECT_DEADLINE_LATE_MS);
    let sent = 0;
    for (const businessId of await this.firms(options)) {
      if (Date.now() > stop) break;
      // The time each reminder is due is computed in SQL; the firm's scope keeps RLS on.
      const due = await this.database.withScope(
        { kind: 'business', businessId },
        (tx) =>
          tx.$queryRaw<{ id: string }[]>`
          SELECT r.id::text AS id
          FROM project_deadline_reminders r
          JOIN project_deadlines d ON d.business_id = r.business_id AND d.id = r.deadline_id
          WHERE r.business_id = ${businessId}::uuid
            AND r.sent_at IS NULL
            AND d.completed_at IS NULL
            AND d.archived_at IS NULL
            AND d.due_at > ${late}
            AND d.due_at - make_interval(mins => r.minutes_before) <= ${now}
          ORDER BY d.due_at - make_interval(mins => r.minutes_before), r.id
          LIMIT ${BATCH + backingOff.size}`,
      );
      const db = this.database.forBusiness(businessId);
      for (const { id } of due.filter((r) => !backingOff.has(r.id)).slice(0, BATCH)) {
        if (Date.now() > stop) break;
        const r = await db.projectDeadlineReminder.findFirst({
          where: { businessId, id, sentAt: null },
          select: {
            inApp: true,
            channels: true,
            deadline: {
              select: {
                id: true,
                dueAt: true,
                ownerUserId: true,
                visibility: true,
                shares: { select: { userId: true } },
              },
            },
          },
        });
        if (!r) continue;
        const d = r.deadline;
        const to = [
          ...new Set([
            d.ownerUserId,
            ...(d.visibility === 'SHARED' ? d.shares.map((x) => x.userId) : []),
          ]),
        ];
        let failed = false;
        for (let i = 0; i < to.length; i += CHOSEN_PER_CALL) {
          const result = await this.notifier.notify({
            businessId,
            event: 'project-deadline.reminder',
            recordId: d.id,
            toUserIds: to.slice(i, i + CHOSEN_PER_CALL),
            eventKey: `project-deadline.reminder:${id}:${d.dueAt.toISOString()}`,
            channels: { inApp: r.inApp, email: r.channels.includes('EMAIL'), sms: false },
          });
          failed ||= result.failed === true;
        }
        if (failed) {
          this.failedAt.set(`project-deadline-reminders:${id}`, now.getTime());
          continue;
        }
        const { count } = await db.projectDeadlineReminder.updateMany({
          where: { businessId, id, sentAt: null },
          data: { sentAt: now },
        });
        sent += count;
      }
    }
    return sent;
  }

  /**
   * Tasks T-D12: each task reminder whose time has come, in the firm's time zone, for a task still
   * OPEN (not done, cancelled, a draft or archived), within TASK_REMINDER_LATE_MS of its time. A
   * days rule fires `daysBefore` days before the due date at its time (or
   * TASK_REMINDER_DEFAULT_TIME); a Custom rule `minutesBefore` before the due date and time
   * (MINUTES and HOURS count back from that moment; DAYS is the same clock time that many days
   * earlier). It reaches the task's assignee and additional assignees (or, with none, the member
   * who made it), ACTIVE members only: a bell item when `inApp`, and an email copy through the
   * outbox when its channels have EMAIL, as the Notifier's rules and each member's preferences
   * allow; never a text. Once per due moment: the Notifier's `eventKey` names it, and
   * `last_fired_for` keeps the due date it went out for, so a new due date (or a new due time,
   * which clears it) re-arms the reminder.
   */
  private async taskReminders(options: JobRunOptions): Promise<number> {
    const now = options.now ?? new Date();
    const stop = Date.now() + BUDGET_MS;
    const backingOff = new Set(this.backingOff('task-reminders', now));
    let sent = 0;
    for (const businessId of await this.firms(options)) {
      if (Date.now() > stop) break;
      const found = await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
        const timeZone = await firmTimeZone(tx, businessId);
        const today = zonedDate(timeZone, now.getTime());
        // A reminder fires before its task is due, so only tasks due from yesterday on.
        const rows = await tx.taskReminder.findMany({
          where: {
            businessId,
            task: {
              status: 'OPEN',
              archivedAt: null,
              dueOn: {
                gte: new Date(`${addDays(today, -1)}T00:00:00Z`),
                lte: new Date(`${addDays(today, 366)}T00:00:00Z`),
              },
            },
          },
          select: {
            id: true,
            daysBefore: true,
            timeOfDay: true,
            minutesBefore: true,
            unit: true,
            inApp: true,
            channels: true,
            lastFiredFor: true,
            task: {
              select: {
                id: true,
                dueOn: true,
                dueTime: true,
                allDay: true,
                assignedUserId: true,
                createdByUserId: true,
                assignees: { select: { userId: true } },
              },
            },
          },
          orderBy: { id: 'asc' },
          take: 2_000,
        });
        return { timeZone, rows };
      });
      const due = found.rows
        .map((r) => {
          const dueOn = r.task.dueOn!.toISOString().slice(0, 10);
          // Once per due date: one that went out for this date waits for a new one.
          if (r.lastFiredFor?.toISOString().slice(0, 10) === dueOn) return null;
          const fireAt = taskReminderAt(found.timeZone, r, dueOn);
          if (fireAt === null) return null;
          if (fireAt > now.getTime() || now.getTime() - fireAt > TASK_REMINDER_LATE_MS) return null;
          return { r, dueOn, fireAt };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null && !backingOff.has(x.r.id))
        .sort((a, b) => a.fireAt - b.fireAt)
        .slice(0, BATCH);
      const db = this.database.forBusiness(businessId);
      for (const { r, dueOn } of due) {
        if (Date.now() > stop) break;
        const t = r.task;
        const assignees = [t.assignedUserId, ...t.assignees.map((a) => a.userId)].filter(
          (u): u is string => !!u,
        );
        const to = [
          ...new Set(assignees.length ? assignees : t.createdByUserId ? [t.createdByUserId] : []),
        ];
        // The due moment it is for: the date and time when the task has one.
        const dueKey = t.dueTime && !t.allDay ? `${dueOn}T${timeOfDayFromDb(t.dueTime)}` : dueOn;
        let failed = false;
        for (let i = 0; i < to.length; i += CHOSEN_PER_CALL) {
          const result = await this.notifier.notify({
            businessId,
            event: 'task.reminder',
            recordId: t.id,
            toUserIds: to.slice(i, i + CHOSEN_PER_CALL),
            eventKey: `task.reminder:${r.id}:${dueKey}`,
            channels: { inApp: r.inApp, email: r.channels.includes('EMAIL'), sms: false },
          });
          failed ||= result.failed === true;
        }
        if (failed) {
          this.failedAt.set(`task-reminders:${r.id}`, now.getTime());
          continue;
        }
        // Only for the date it went out for (an edit meanwhile keeps its own reminder).
        const { count } = await db.taskReminder.updateMany({
          where: {
            businessId,
            id: r.id,
            lastFiredFor: r.lastFiredFor,
            task: { dueOn: t.dueOn },
          },
          data: { lastFiredFor: t.dueOn },
        });
        sent += count;
      }
    }
    return sent;
  }

  /**
   * The outbox (notification_deliveries): email copies that failed, or that a stopped task left
   * QUEUED, are tried again after EMAIL_RETRY_AFTER_MS, up to EMAIL_MAX_ATTEMPTS in all; then they
   * stay FAILED (with the error's name) for support. Fewest attempts first, so rows that keep
   * failing never hold up new ones. A task that stops between the send and the status update
   * leaves the row QUEUED (or FAILED) with its attempt counted: it is sent again after
   * EMAIL_RETRY_AFTER_MS (at least once, not exactly once).
   */
  private async emailRetries(options: JobRunOptions): Promise<number> {
    const now = options.now ?? new Date();
    const deadline = Date.now() + BUDGET_MS;
    let sent = 0;
    for (const businessId of await this.firms(options)) {
      if (Date.now() > deadline) break;
      const due = await this.database.forBusiness(businessId).notificationDelivery.findMany({
        where: {
          businessId,
          channel: 'EMAIL',
          status: { in: ['QUEUED', 'FAILED'] },
          attempts: { lt: EMAIL_MAX_ATTEMPTS },
          updatedAt: { lte: new Date(now.getTime() - EMAIL_RETRY_AFTER_MS) },
        },
        select: { id: true, attempts: true },
        orderBy: [{ attempts: 'asc' }, { updatedAt: 'asc' }],
        take: BATCH,
      });
      for (const d of due) {
        if (Date.now() > deadline) break;
        if ((await this.notifier.retryDelivery(businessId, d.id, d.attempts)) === 'sent') sent += 1;
      }
    }
    return sent;
  }
}

/**
 * Tasks T-D12: the instant a task reminder fires, in the firm's time zone; null when it cannot be
 * told (a Custom rule on a task with no due time, which the API never keeps).
 */
export function taskReminderAt(
  timeZone: string,
  r: {
    daysBefore: number;
    timeOfDay: Date | null;
    minutesBefore: number | null;
    unit: 'MINUTES' | 'HOURS' | 'DAYS' | null;
    task: { dueTime: Date | null; allDay: boolean };
  },
  dueOn: string,
): number | null {
  const dueMinutes =
    r.task.dueTime && !r.task.allDay ? minutesOf(timeOfDayFromDb(r.task.dueTime)) : null;
  if (r.minutesBefore === null) {
    const at = r.timeOfDay ? timeOfDayFromDb(r.timeOfDay) : TASK_REMINDER_DEFAULT_TIME;
    return zonedInstant(timeZone, addDays(dueOn, -r.daysBefore), minutesOf(at));
  }
  if (dueMinutes === null) return null;
  if (r.unit === 'DAYS') {
    // The same clock time that many days earlier.
    return zonedInstant(timeZone, addDays(dueOn, -Math.round(r.minutesBefore / 1_440)), dueMinutes);
  }
  return zonedInstant(timeZone, dueOn, dueMinutes) - r.minutesBefore * 60_000;
}
