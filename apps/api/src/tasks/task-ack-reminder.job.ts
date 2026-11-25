import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { DATABASE } from '../database/database.module.js';
import { errorName, Notifier } from '../notifications/notifier.js';
import { assignerOf } from './task-collab.service.js';

/** The job's advisory lock key: fixed, in a range no other module uses ("Q36" = 0x5336). */
export const TASK_ACK_REMINDER_LOCK_KEY = 0x5336_0001;
/** How often the job looks for acknowledgments past their business day. */
export const TASK_ACK_REMINDER_INTERVAL_MS = 15 * 60_000;
const BATCH = 200;
const BUDGET_MS = 20_000;

/**
 * TASK_ACK_REMINDERS=on|off: run the job in this API task. Default on, off under NODE_ENV=test
 * (tests call `run()` themselves). Any other value is refused at boot.
 */
export function taskAckRemindersOn(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env['TASK_ACK_REMINDERS'];
  if (value === undefined || value === '') return env.NODE_ENV !== 'test';
  if (value === 'on' || value === 'off') return value === 'on';
  throw new Error('TASK_ACK_REMINDERS must be "on" or "off"');
}

export interface TaskAckReminderOptions {
  now?: Date;
  /** Only these firms (tests); otherwise every ACTIVE firm. */
  businessIds?: string[];
}
export type TaskAckReminderResult = { skipped: true } | { skipped: false; reminded: number };

/**
 * Tasks Review Two T-C01 (Q36): an acknowledgment that is required and still not given one
 * business day after the assignment sends one reminder, a bell item to the assignee and to the
 * member who assigned the task, and is then marked so it never sends again. Only open, live
 * tasks; the task stays valid either way. In-process like the other jobs: each run takes the
 * advisory lock, so only one API task sends at a time. Logs carry ids only.
 */
@Injectable()
export class TaskAckReminderJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('TaskAckReminderJob');
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly notifier: Notifier,
  ) {}

  onApplicationBootstrap(): void {
    if (taskAckRemindersOn()) this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(intervalMs = TASK_ACK_REMINDER_INTERVAL_MS): void {
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
      this.logger.error(`tick failed (${errorName(error)})`);
    } finally {
      this.running = false;
    }
  }

  /** One run under the lock; `{ skipped: true }` when another task holds it. */
  async run(options: TaskAckReminderOptions = {}): Promise<TaskAckReminderResult> {
    const now = options.now ?? new Date();
    return this.database.withScope(
      { kind: 'platform' },
      async (tx) => {
        const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(${TASK_ACK_REMINDER_LOCK_KEY}::bigint) AS locked`;
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
        let reminded = 0;
        for (const { id: businessId } of firms) {
          if (Date.now() > deadline) break;
          reminded += await this.runFirm(businessId, now, deadline).catch((e: unknown) => {
            // One firm's trouble never stops the others; ids only.
            this.logger.warn(`firm ${businessId} failed (${errorName(e)})`);
            return 0;
          });
        }
        return { skipped: false, reminded } as const;
      },
      { timeout: 30_000 },
    );
  }

  private async runFirm(businessId: string, now: Date, deadline: number): Promise<number> {
    const db = this.database.forBusiness(businessId);
    const due = await db.taskAcknowledgement.findMany({
      where: {
        businessId,
        required: true,
        acknowledgedAt: null,
        reminderSentAt: null,
        dueAt: { lte: now },
        task: { status: 'OPEN', archivedAt: null, leadId: null },
      },
      select: { taskId: true, assigneeUserId: true },
      orderBy: [{ dueAt: 'asc' }, { taskId: 'asc' }],
      take: BATCH,
    });
    let done = 0;
    for (const a of due) {
      if (Date.now() > deadline) break;
      // Claim it first: two runs never both send (the reminder is once, ever).
      const claimed = await this.database.withScope(
        { kind: 'business', businessId },
        async (tx) => {
          const { count } = await tx.taskAcknowledgement.updateMany({
            where: {
              businessId,
              taskId: a.taskId,
              assigneeUserId: a.assigneeUserId,
              reminderSentAt: null,
              acknowledgedAt: null,
            },
            data: { reminderSentAt: now },
          });
          return count === 1 ? await assignerOf(tx, businessId, a.taskId, a.assigneeUserId) : false;
        },
      );
      if (claimed === false) continue;
      const to = [...new Set([a.assigneeUserId, ...(claimed ? [claimed] : [])])];
      try {
        await this.notifier.notify({
          businessId,
          event: 'task.acknowledgement-reminder',
          recordId: a.taskId,
          toUserIds: to,
          eventKey: `task.acknowledgement-reminder:${a.taskId}:${a.assigneeUserId}`,
        });
        done += 1;
      } catch (e) {
        this.logger.warn(
          `acknowledgement reminder for task ${a.taskId} not written (${errorName(e)})`,
        );
      }
    }
    return done;
  }
}
