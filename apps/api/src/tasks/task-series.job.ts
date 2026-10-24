import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { addDays, generationCutoff, schedule } from './recurrence.js';
import { reminderRow, remindersFromJson } from './task-common.js';
import { firmClock } from './task-read.service.js';
import { HORIZON_DAYS, ruleOf, TaskSeriesService } from './task-series.service.js';
import { day, toDay } from '../workspaces/common.js';

/** The job's advisory lock key: fixed, in a range no other module uses ("R55" = 0x5537). */
export const TASK_SERIES_LOCK_KEY = 0x5537_0001;
/** How often the job looks for occurrences whose time to make the task has come. */
export const TASK_SERIES_JOB_INTERVAL_MS = 15 * 60_000;
/** Tasks made per firm and run; the rest waits for the next run. */
const BATCH = 200;
/** The lock's transaction is capped at 30 s; a run stops starting work here. */
const BUDGET_MS = 20_000;
/** After this many failed tries an occurrence is FAILED and waits for the firm. */
export const MAX_ATTEMPTS = 5;

/**
 * TASK_SERIES_JOBS=on|off: run the job in this API task. Default on, off under NODE_ENV=test
 * (tests call `run()` themselves). Any other value is refused at boot.
 */
export function taskSeriesJobsOn(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.TASK_SERIES_JOBS;
  if (value === undefined || value === '') return env.NODE_ENV !== 'test';
  if (value === 'on' || value === 'off') return value === 'on';
  throw new Error('TASK_SERIES_JOBS must be "on" or "off"');
}

export interface TaskSeriesJobOptions {
  now?: Date;
  /** Only these firms (tests); otherwise every ACTIVE firm. */
  businessIds?: string[];
}
export type TaskSeriesJobResult =
  | { skipped: true }
  | {
      skipped: false;
      scheduled: number;
      generated: number;
      skippedOccurrences: number;
      failed: number;
      ended: number;
    };

/**
 * Recurring tasks (R55): schedules each active series' occurrences ahead, then makes the task of
 * every occurrence whose time has come (its due date less the lead time, or the start of its
 * period), in-process like the invoice job. Each run takes a Postgres advisory lock, so only one
 * API task runs it. Every occurrence is made in its own firm-scoped transaction, with its row
 * locked: the unique (series, scheduled date) key and the SCHEDULED state make a retry, a second
 * task or a run that overlaps another a no-op, never a second task. A failure is counted on the
 * occurrence with a safe code (never a message), tried again next run, and after MAX_ATTEMPTS the
 * occurrence is FAILED and audited for the firm. A series whose rule has no dates left ends.
 */
@Injectable()
export class TaskSeriesJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('TaskSeriesJob');
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly series: TaskSeriesService,
  ) {}

  onApplicationBootstrap(): void {
    if (taskSeriesJobsOn()) this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(intervalMs = TASK_SERIES_JOB_INTERVAL_MS): void {
    if (this.timers.length > 0) return;
    this.timers = [
      setTimeout(() => void this.tick(), 45_000),
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

  async run(options: TaskSeriesJobOptions = {}): Promise<TaskSeriesJobResult> {
    const totals = { scheduled: 0, generated: 0, skippedOccurrences: 0, failed: 0, ended: 0 };
    try {
      return await this.database.withScope(
        { kind: 'platform' },
        async (tx) => {
          const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(${TASK_SERIES_LOCK_KEY}::bigint) AS locked`;
          if (!row?.locked) return { skipped: true } as const;
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
              await this.runFirm(firm.id, now, deadline, totals);
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

  /** One firm: schedule ahead, end finished series, then make the tasks that are due. */
  private async runFirm(
    businessId: string,
    now: Date,
    deadline: number,
    totals: {
      scheduled: number;
      generated: number;
      skippedOccurrences: number;
      failed: number;
      ended: number;
    },
  ) {
    const { today, ids } = await this.inFirm(businessId, async (tx) => {
      const clock = await firmClock(tx, businessId, now.getTime());
      const active = await tx.taskSeries.findMany({ where: { businessId, status: 'ACTIVE' } });
      // A series already scheduled to near the horizon needs nothing (a daily one would otherwise
      // re-offer its whole window every run).
      const latest = await tx.taskOccurrence.groupBy({
        by: ['seriesId'],
        where: {
          businessId,
          seriesId: { in: active.map((s) => s.id) },
          state: { in: ['SCHEDULED', 'GENERATED'] },
        },
        _max: { dueOn: true },
      });
      const covered = new Map(latest.map((l) => [l.seriesId, day(l._max.dueOn) ?? '']));
      const needed = addDays(clock.today, HORIZON_DAYS - 14);
      for (const s of active) {
        // The run's budget covers this phase too: what is left waits for the next run.
        if (Date.now() > deadline) break;
        if ((covered.get(s.id) ?? '') >= needed) continue;
        totals.scheduled += await this.series.syncOccurrences(tx, businessId, s, clock.today);
      }
      // Per series, the occurrences whose time has come (due on or before its cutoff), oldest first.
      const ids: string[] = [];
      for (const s of active) {
        if (ids.length >= BATCH) break;
        const cutoff = generationCutoff(s, clock.today, {
          atPeriodStart: s.createAtPeriodStart,
          leadDays: s.leadDays,
        });
        const due = await tx.taskOccurrence.findMany({
          where: { businessId, seriesId: s.id, state: 'SCHEDULED', dueOn: { lte: toDay(cutoff) } },
          orderBy: [{ dueOn: 'asc' }, { id: 'asc' }],
          select: { id: true },
          take: BATCH - ids.length,
        });
        ids.push(...due.map((o) => o.id));
      }
      return { today: clock.today, ids };
    });
    for (const id of ids) {
      if (Date.now() > deadline) break;
      try {
        const outcome = await this.generate(businessId, id, today);
        if (outcome === 'GENERATED') totals.generated++;
        if (outcome === 'SKIPPED') totals.skippedOccurrences++;
      } catch (error) {
        totals.failed++;
        await this.fail(businessId, id, error);
      }
    }
    totals.ended += await this.endFinished(businessId, today);
  }

  /** A series whose rule has no later date and no occurrence waiting has nothing left to make. */
  private async endFinished(businessId: string, today: string): Promise<number> {
    return this.inFirm(businessId, async (tx) => {
      const active = await tx.taskSeries.findMany({
        where: { businessId, status: 'ACTIVE', endMode: { not: 'NEVER' } },
      });
      let ended = 0;
      for (const s of active) {
        const open = await tx.taskOccurrence.count({
          where: { businessId, seriesId: s.id, state: 'SCHEDULED' },
        });
        if (open === 0 && schedule(ruleOf(s), { limit: 1, from: today }).length === 0) {
          await tx.taskSeries.update({
            where: { id: s.id },
            data: { status: 'ENDED', endedAt: new Date() },
          });
          await this.audit.logIn(
            tx,
            'task_series.ended',
            { type: 'task_series', id: s.id },
            { reason: 'RULE_FINISHED' },
            { businessId },
          );
          ended++;
        }
      }
      return ended;
    });
  }

  /**
   * Makes the task of one occurrence: a snapshot of the series' defaults at this moment. The row
   * is locked first and only a SCHEDULED one is made, so a retry or a second run finds it done.
   */
  async generate(
    businessId: string,
    occurrenceId: string,
    _today: string,
  ): Promise<'GENERATED' | 'SKIPPED' | 'IGNORED'> {
    return this.inFirm(businessId, async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM task_occurrences
        WHERE business_id = ${businessId}::uuid AND id = ${occurrenceId}::uuid AND state = 'SCHEDULED'
        FOR UPDATE SKIP LOCKED`;
      if (!locked) return 'IGNORED' as const;
      const occ = await tx.taskOccurrence.findFirstOrThrow({ where: { id: occurrenceId } });
      const s = await tx.taskSeries.findFirstOrThrow({ where: { businessId, id: occ.seriesId } });
      if (s.status !== 'ACTIVE') return 'IGNORED' as const;
      const entity = { type: 'task_series', id: s.id };
      const key = occ.scheduledOn.toISOString().slice(0, 10);
      const client = await tx.client.findFirst({
        where: { businessId, id: s.clientId },
        select: { assignedUserId: true, archivedAt: true },
      });
      if (!client || client.archivedAt) {
        await tx.taskOccurrence.update({
          where: { id: occ.id },
          data: { state: 'SKIPPED', skipReason: 'The client is archived' },
        });
        await this.audit.logIn(
          tx,
          'task_series.occurrence_skipped',
          entity,
          { occurrenceKey: key, reason: 'CLIENT_ARCHIVED' },
          { businessId },
        );
        return 'SKIPPED' as const;
      }
      // Who it goes to, now: a person who left, or cannot take this client, leaves it unassigned.
      const wanted =
        s.assignmentRule === 'SPECIFIC_USER'
          ? s.assignedUserId
          : s.assignmentRule === 'CLIENT_TEAM'
            ? client.assignedUserId
            : null;
      const member = wanted
        ? await tx.membership.findFirst({
            where: { businessId, userId: wanted, status: 'ACTIVE' },
            select: { role: true },
          })
        : null;
      const assignedUserId =
        wanted && member && (member.role !== 'STAFF' || client.assignedUserId === wanted)
          ? wanted
          : null;
      const type = s.typeId
        ? await tx.taskType.findFirst({
            where: { id: s.typeId, archivedAt: null },
            select: { id: true },
          })
        : null;
      const extra = s.extraAssigneeIds.length
        ? (
            await tx.membership.findMany({
              where: { businessId, userId: { in: s.extraAssigneeIds }, status: 'ACTIVE' },
              select: { userId: true },
            })
          ).map((m) => m.userId)
        : [];
      const checklist = Array.isArray(s.checklist)
        ? (s.checklist as { label: string; required?: boolean }[])
        : [];
      // A Custom reminder counts back from the due time: a series without one (saving refuses
      // that; only an older API could have kept it) makes its tasks without them.
      const reminders = remindersFromJson(s.reminders).filter(
        (r) => r.unit === null || s.dueTime !== null,
      );
      const task = await tx.task.create({
        data: {
          businessId,
          clientId: s.clientId,
          engagementId: s.engagementId,
          title: s.title,
          details: s.details,
          dueOn: occ.dueOn,
          dueTime: s.dueTime,
          allDay: s.dueTime === null,
          assignedUserId,
          createdByUserId: s.createdByUserId,
          typeId: type?.id ?? null,
          serviceId: s.serviceId,
          priority: s.priority,
          clientVisible: s.clientVisible,
        },
        select: { id: true },
      });
      await tx.taskChecklistItem.createMany({
        data: checklist.map((i, position) => ({
          businessId,
          taskId: task.id,
          label: i.label,
          position,
          required: i.required ?? false,
        })),
      });
      await tx.taskReminder.createMany({
        data: reminders.map((r) => ({ businessId, taskId: task.id, ...reminderRow(r) })),
        skipDuplicates: true,
      });
      await tx.taskAssignee.createMany({
        data: extra
          .filter((u) => u !== assignedUserId)
          .map((userId) => ({ businessId, taskId: task.id, userId })),
        skipDuplicates: true,
      });
      await tx.taskOccurrence.update({
        where: { id: occ.id },
        data: { state: 'GENERATED', taskId: task.id, generatedAt: new Date(), failureCode: null },
      });
      await this.audit.logIn(
        tx,
        'task_series.occurrence_generated',
        entity,
        { occurrenceKey: key, taskId: task.id, outcome: 'GENERATED' },
        { businessId },
      );
      return 'GENERATED' as const;
    });
  }

  /** A failed try: counted with a safe code; after MAX_ATTEMPTS the occurrence is FAILED. */
  private async fail(businessId: string, occurrenceId: string, error: unknown): Promise<void> {
    const code = (error instanceof Error ? error.name : 'Error')
      .replace(/[^A-Za-z0-9_]/g, '')
      .slice(0, 50);
    this.logger.warn(`occurrence ${occurrenceId} failed (${code})`);
    try {
      await this.inFirm(businessId, async (tx) => {
        const occ = await tx.taskOccurrence.findFirst({ where: { businessId, id: occurrenceId } });
        if (!occ || occ.state !== 'SCHEDULED') return;
        const attempts = occ.attempts + 1;
        const failed = attempts >= MAX_ATTEMPTS;
        await tx.taskOccurrence.update({
          where: { id: occ.id },
          data: { attempts, failureCode: code || 'Error', ...(failed ? { state: 'FAILED' } : {}) },
        });
        if (failed) {
          await this.audit.logIn(
            tx,
            'task_series.generation_failed',
            { type: 'task_series', id: occ.seriesId },
            { occurrenceKey: occ.scheduledOn.toISOString().slice(0, 10), attempts, code },
            { businessId },
          );
        }
      });
    } catch {
      // The next run tries again.
    }
  }
}
