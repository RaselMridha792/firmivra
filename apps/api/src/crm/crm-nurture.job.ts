import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { CrmJourneySteps } from '@firmivra/types';
import { contactValues, errorCodeOf, fillMergeFields } from '../admin-communications/comm.rules.js';
import { DATABASE } from '../database/database.module.js';
import { NOTIFY_SERVICE, type NotifyService } from '../notify/notify.types.js';

/** The job's advisory lock key: fixed, in a range no other module uses ("Q35" = 0x5235). */
export const CRM_NURTURE_LOCK_KEY = 0x5235_0001;
/** How often the job looks for due journey steps. */
export const CRM_NURTURE_INTERVAL_MS = 5 * 60_000;
/** Steps per run; the rest waits for the next run. */
const BATCH = 100;
/** The lock's transaction is capped at 60 s; a run stops starting sends here. */
const BUDGET_MS = 45_000;
/** A step that fails this many times more is FAILED, and its enrollment with it. */
export const CRM_NURTURE_MAX_RETRIES = 3;
/** The wait before retry n (1, 2, 3): 15, 30, 60 minutes. */
export const retryDelayMs = (retry: number) => 15 * 60_000 * 2 ** (retry - 1);

/**
 * CRM_NURTURE_SENDER=on|off: run the sender in this API task. Default on, off under
 * NODE_ENV=test (tests call `run()` themselves). Any other value is refused at boot.
 */
export function crmNurtureSenderOn(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env['CRM_NURTURE_SENDER'];
  if (value === undefined || value === '') return env.NODE_ENV !== 'test';
  if (value === 'on' || value === 'off') return value === 'on';
  throw new Error('CRM_NURTURE_SENDER must be "on" or "off"');
}

export type CrmNurtureRun =
  | { skipped: true }
  | { skipped: false; sent: number; retried: number; failed: number; stopped: number };

type Outcome = 'sent' | 'retried' | 'failed' | 'stopped' | 'waiting';

/**
 * Q35 block 6: sends the due steps of active nurture enrollments (Leads & CRM). A step is due at
 * its scheduled time; it is sent by email with its template's merge fields filled for the
 * contact. Before each send the rules are read again: a paused journey waits, a contact who is
 * now suppressed or without consent is stopped, a template no longer active fails the step.
 * A send the provider refuses is retried (15, 30, 60 minutes), then FAILED with its enrollment.
 * When the last step is sent the enrollment is COMPLETED. Platform scope, in-process like the
 * other jobs: each run takes the advisory lock, so only one API task sends at a time. Logs carry
 * ids only, never an address.
 */
@Injectable()
export class CrmNurtureSender implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('CrmNurtureSender');
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
  ) {}

  onApplicationBootstrap(): void {
    if (crmNurtureSenderOn()) this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(intervalMs = CRM_NURTURE_INTERVAL_MS): void {
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
  async run(options: { now?: Date; journeyIds?: string[] } = {}): Promise<CrmNurtureRun> {
    const now = options.now ?? new Date();
    const result = await this.database.withScope(
      { kind: 'platform' },
      async (tx) => {
        const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(${CRM_NURTURE_LOCK_KEY}::bigint) AS locked`;
        if (!row?.locked) return { skipped: true } as const;
        const deadline = Date.now() + BUDGET_MS;
        const due = await this.database.forPlatform().salesNurtureExecution.findMany({
          where: {
            status: 'PENDING',
            scheduledAt: { lte: now },
            enrollment: {
              status: 'ACTIVE',
              ...(options.journeyIds ? { journeyId: { in: options.journeyIds } } : {}),
            },
          },
          select: { id: true },
          orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
          take: BATCH,
        });
        const counts = { sent: 0, retried: 0, failed: 0, stopped: 0 };
        for (const { id } of due) {
          if (Date.now() > deadline) break;
          const outcome = await this.step(id, now).catch((error: unknown) => {
            // One step's fault never holds up the others; ids only.
            this.logger.warn(
              `step ${id} failed (${error instanceof Error ? error.name : 'Error'})`,
            );
            return 'waiting' as const;
          });
          if (outcome !== 'waiting') counts[outcome] += 1;
        }
        return { skipped: false, ...counts } as const;
      },
      { timeout: 60_000 },
    );
    if (!result.skipped && result.sent + result.failed + result.stopped > 0)
      this.logger.log(
        `nurture steps: ${result.sent} sent, ${result.retried} to retry, ${result.failed} failed, ${result.stopped} enrollments stopped`,
      );
    return result;
  }

  /** One due step: checks the rules again, sends it, records the outcome. */
  private async step(executionId: string, now: Date): Promise<Outcome> {
    const db = this.database.forPlatform();
    const ex = await db.salesNurtureExecution.findUniqueOrThrow({
      where: { id: executionId },
      include: {
        enrollment: {
          include: {
            journey: { select: { status: true } },
            version: { select: { steps: true } },
            contact: {
              select: { id: true, name: true, email: true, companyName: true, consent: true },
            },
          },
        },
      },
    });
    const { enrollment } = ex;
    if (ex.status !== 'PENDING' || enrollment.status !== 'ACTIVE') return 'waiting';
    // A paused journey keeps its steps for when it resumes.
    if (enrollment.journey.status !== 'ACTIVE') return 'waiting';

    const consent = enrollment.contact.consent;
    if (consent?.suppressed || !consent?.consented) {
      await this.stopEnrollment(enrollment.id, consent?.suppressed ? 'suppressed' : 'no_consent');
      return 'stopped';
    }
    const step = CrmJourneySteps.parse(enrollment.version.steps)[ex.stepIndex];
    const email = enrollment.contact.email;
    const template = step
      ? await db.commTemplate.findUnique({
          where: { id: step.templateId },
          select: { channel: true, status: true, subject: true, body: true },
        })
      : null;
    if (!step || !template || template.status !== 'ACTIVE' || template.channel !== 'EMAIL') {
      await this.fail(executionId, enrollment.id, 'template_not_usable');
      return 'failed';
    }
    if (!email) {
      await this.fail(executionId, enrollment.id, 'no_destination');
      return 'failed';
    }

    const values = contactValues({
      name: enrollment.contact.name,
      email,
      firmName: enrollment.contact.companyName,
      senderName: 'Firmivra',
    });
    try {
      await this.notify.send({
        template: 'platform.message-email',
        to: email,
        businessId: null,
        data: {
          name: enrollment.contact.name,
          subject: fillMergeFields(template.subject ?? 'Firmivra', values).text,
          body: fillMergeFields(template.body, values).text,
        },
      });
    } catch (e) {
      const code = errorCodeOf((e as { reason?: string }).reason ?? (e as { code?: string }).code);
      const retry = ex.retryCount + 1;
      if (retry > CRM_NURTURE_MAX_RETRIES) {
        await this.fail(executionId, enrollment.id, code, retry - 1);
        return 'failed';
      }
      await db.salesNurtureExecution.update({
        where: { id: executionId },
        data: {
          retryCount: retry,
          lastError: code,
          scheduledAt: new Date(now.getTime() + retryDelayMs(retry)),
        },
      });
      return 'retried';
    }

    await this.database.withScope({ kind: 'platform' }, async (tx) => {
      await tx.salesNurtureExecution.update({
        where: { id: executionId },
        data: { status: 'SENT', sentAt: now, lastError: null },
      });
      const left = await tx.salesNurtureExecution.count({
        where: { enrollmentId: enrollment.id, status: 'PENDING' },
      });
      if (left === 0)
        await tx.salesNurtureEnrollment.update({
          where: { id: enrollment.id },
          data: { status: 'COMPLETED', completedAt: now },
        });
    });
    return 'sent';
  }

  /** The step FAILED (no more tries), its enrollment FAILED, the steps after it skipped. */
  private fail(executionId: string, enrollmentId: string, code: string, retryCount?: number) {
    return this.database.withScope({ kind: 'platform' }, async (tx) => {
      await tx.salesNurtureExecution.update({
        where: { id: executionId },
        data: { status: 'FAILED', lastError: code, ...(retryCount ? { retryCount } : {}) },
      });
      await tx.salesNurtureExecution.updateMany({
        where: { enrollmentId, status: 'PENDING' },
        data: { status: 'SKIPPED' },
      });
      await tx.salesNurtureEnrollment.update({
        where: { id: enrollmentId },
        data: { status: 'FAILED' },
      });
    });
  }

  /** Stop rule at send time: the enrollment STOPPED, its steps still to send skipped. */
  private stopEnrollment(enrollmentId: string, reason: string) {
    return this.database.withScope({ kind: 'platform' }, async (tx) => {
      await tx.salesNurtureEnrollment.update({
        where: { id: enrollmentId },
        data: { status: 'STOPPED', stoppedAt: new Date(), stopReason: reason },
      });
      await tx.salesNurtureExecution.updateMany({
        where: { enrollmentId, status: 'PENDING' },
        data: { status: 'SKIPPED' },
      });
    });
  }
}
