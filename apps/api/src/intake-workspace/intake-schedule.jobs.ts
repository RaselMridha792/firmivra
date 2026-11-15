import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { intakeReminderPlan } from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { errorName, Notifier } from '../notifications/notifier.js';
import type { NotifyConfig } from '../notify/config.js';
import { NOTIFY_CONFIG } from '../notify/notify.module.js';
import { IntakeSendService } from './intake-send.service.js';
import { newLeadLink } from './lead-link.js';

/**
 * Intake Forms Review Two, the intake schedule (10c and the reminders that were never sent): each
 * form's first reminder (minutes after it was sent), its final reminder (minutes before it
 * expires, 10c), the staff's expiration alert (minutes before it expires) and, at the expiration,
 * Expired. Each form keeps its own schedule from when it was sent (r1_intake_schedule), and each
 * send goes once: its marker is set with it, and its Notifier `eventKey` keeps a retried bell item
 * and email from going out twice. A client's reminder is the portal notice, and for a form sent by
 * Email its email through the outbox; a lead's is a new secure link by email.
 *
 * Stop rules: only ACTIVE firms are read; nothing goes for a form no longer open (submitted,
 * completed, archived, expired) or for one past its expiry; a client's reminder never goes while
 * the engagement is completed or cancelled, the client's portal is locked, or the client has no
 * active portal login; a lead's never once the lead is converted, declined, lost or expired. Such a
 * reminder is marked and audited as skipped, with its reason, so it is not tried again.
 *
 * In the API, as the reminder jobs (R6 step 7, q30): every minute each job takes its advisory lock
 * for the run, so one API task runs it at a time. Started at boot unless NOTIFY_JOBS=off.
 */
export const INTAKE_JOB_LOCK_KEYS = {
  'intake-reminders': 0x5236_0011,
  'intake-expiry': 0x5236_0012,
} as const;
export type IntakeJob = keyof typeof INTAKE_JOB_LOCK_KEYS;

export interface IntakeJobOptions {
  now?: Date;
  /** Only these firms (tests); otherwise every ACTIVE firm. */
  businessIds?: string[];
}
export type IntakeJobResult = { skipped: true } | { skipped: false; done: number };

const INTERVAL_MS = 60_000;
const BATCH = 100;
const BUDGET_MS = 20_000;
const MIN = 60_000;
const OPEN = ['SENT', 'IN_PROGRESS', 'NEEDS_CORRECTION'] as const;
const CLOSED_LEAD = ['CONVERTED', 'DECLINED', 'LOST', 'EXPIRED'];

type Reminder = 'FIRST' | 'FINAL';

@Injectable()
export class IntakeScheduleJobs implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('IntakeScheduleJobs');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(NOTIFY_CONFIG) private readonly config: NotifyConfig,
    private readonly notifier: Notifier,
    private readonly sender: IntakeSendService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.jobs) this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(intervalMs = INTERVAL_MS): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((error: unknown) => this.logger.error(`tick failed (${errorName(error)})`));
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One round of both jobs; a round still running is not started again in this task. */
  async tick(options: IntakeJobOptions = {}): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const job of Object.keys(INTAKE_JOB_LOCK_KEYS) as IntakeJob[]) {
        await this.run(job, options);
      }
    } finally {
      this.running = false;
    }
  }

  /** Runs one job under its lock; `{ skipped: true }` when another task holds it. */
  async run(job: IntakeJob, options: IntakeJobOptions = {}): Promise<IntakeJobResult> {
    try {
      return await this.database.withScope(
        { kind: 'platform' },
        async (tx) => {
          const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(${INTAKE_JOB_LOCK_KEYS[job]}::bigint) AS locked`;
          if (!row?.locked) return { skipped: true } as const;
          const done =
            job === 'intake-reminders' ? await this.reminders(options) : await this.expiry(options);
          if (done > 0) this.logger.log(`${job}: ${done} done`);
          return { skipped: false, done } as const;
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      this.logger.warn(`${job}: run failed (${errorName(error)})`);
      return { skipped: false, done: 0 };
    }
  }

  private async firms(options: IntakeJobOptions): Promise<string[]> {
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

  /** The first and final reminders that are due. */
  private async reminders(options: IntakeJobOptions): Promise<number> {
    const now = options.now ?? new Date();
    const deadline = Date.now() + BUDGET_MS;
    let done = 0;
    for (const businessId of await this.firms(options)) {
      if (Date.now() > deadline) break;
      const db = this.database.forBusiness(businessId);
      const rows = await db.intake.findMany({
        where: {
          businessId,
          status: { in: [...OPEN] },
          remindersEnabled: true,
          sentAt: { not: null },
          AND: [
            { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
            {
              OR: [
                { firstReminderSentAt: null, reminderFirstMinutes: { not: null } },
                {
                  finalReminderSentAt: null,
                  reminderFinalMinutes: { not: null },
                  expiresAt: { not: null },
                },
              ],
            },
          ],
        },
        select: {
          id: true,
          sentAt: true,
          expiresAt: true,
          reminderFirstMinutes: true,
          reminderFinalMinutes: true,
          firstReminderSentAt: true,
          finalReminderSentAt: true,
          deliveryChannel: true,
          leadId: true,
          engagementId: true,
        },
        orderBy: { sentAt: 'asc' },
        take: BATCH,
      });
      for (const r of rows) {
        if (Date.now() > deadline) break;
        const at = now.getTime();
        // Review Two 10c: the two reminders in order (intakeReminderPlan); a skipped one never goes.
        const plan = r.sentAt
          ? intakeReminderPlan({
              sentAt: r.sentAt,
              expiresAt: r.expiresAt,
              firstMinutes: r.reminderFirstMinutes,
              finalMinutes: r.reminderFinalMinutes,
            })
          : null;
        // The first never goes once the final has: it would come after it.
        const firstDue =
          !!plan?.firstAt &&
          !r.firstReminderSentAt &&
          !r.finalReminderSentAt &&
          plan.firstAt.getTime() <= at;
        const finalDue = !!plan?.finalAt && !r.finalReminderSentAt && plan.finalAt.getTime() <= at;
        if (!firstDue && !finalDue) continue;
        const kind: Reminder = finalDue ? 'FINAL' : 'FIRST';
        // Only its own mark: the final never marks the first as sent (10c).
        const marks = finalDue ? { finalReminderSentAt: now } : { firstReminderSentAt: now };
        // A first that was due but never went (the job was behind) is now skipped, in History.
        const firstMissed = finalDue && !r.firstReminderSentAt && !!plan?.firstAt;
        const marker = kind === 'FINAL' ? 'finalReminderSentAt' : 'firstReminderSentAt';
        const stop = await this.stopReason(businessId, r);
        let delivered = false;
        if (!stop) {
          try {
            if (r.leadId) {
              // A lead's reminder is a new secure link (only its hash is kept): it replaces the old.
              const link = newLeadLink(r.expiresAt);
              await db.intake.update({
                where: { businessId_id: { businessId, id: r.id } },
                data: link.data,
              });
              delivered = await this.sender.emailLink(businessId, r.id, link.token);
            } else {
              const outcome = await this.sender.deliver(
                businessId,
                r.id,
                null,
                `intake.reminder:${kind}:${r.id}:${(r.expiresAt ?? r.sentAt)?.toISOString()}`,
                r.deliveryChannel === 'EMAIL',
                'intake.reminder',
              );
              delivered = outcome.portalNotice || outcome.status !== 'FAILED';
            }
          } catch (error) {
            this.logger.warn(`intake ${r.id}: ${kind} reminder not sent (${errorName(error)})`);
            continue;
          }
        }
        // Only while still unmarked: a run that overlaps (or an Extend Expiration) never doubles it.
        const { count } = await db.intake.updateMany({
          where: { businessId, id: r.id, [marker]: null },
          data: marks,
        });
        if (count === 0) continue;
        await this.audit.log(
          stop
            ? 'intake.reminder_skipped'
            : kind === 'FINAL'
              ? 'intake.final_reminder_sent'
              : 'intake.first_reminder_sent',
          { type: 'intake', id: r.id },
          stop ? { kind, reason: stop } : { kind, delivered },
          { businessId },
        );
        if (firstMissed) {
          await this.audit.log(
            'intake.reminder_skipped',
            { type: 'intake', id: r.id },
            { kind: 'FIRST', reason: 'AFTER_FINAL' },
            { businessId },
          );
        }
        done += 1;
      }
    }
    return done;
  }

  /** Why a reminder must not go now (the stop rules), or null. */
  private async stopReason(
    businessId: string,
    r: { leadId: string | null; engagementId: string | null },
  ): Promise<string | null> {
    const db = this.database.forBusiness(businessId);
    if (r.leadId) {
      const lead = await db.lead.findFirst({
        where: { businessId, id: r.leadId },
        select: { status: true },
      });
      return !lead || CLOSED_LEAD.includes(lead.status) ? 'LEAD_CLOSED' : null;
    }
    const e = r.engagementId
      ? await db.engagement.findFirst({
          where: { businessId, id: r.engagementId },
          select: { status: true, clientId: true },
        })
      : null;
    if (!e || e.status === 'COMPLETED' || e.status === 'CANCELLED') return 'ENGAGEMENT_CLOSED';
    const locked = await db.clientPortalLock.findFirst({
      where: { businessId, clientId: e.clientId },
      select: { id: true },
    });
    if (locked) return 'PORTAL_LOCKED';
    const login = await db.clientAccount.findFirst({
      where: { businessId, clientId: e.clientId, status: 'ACTIVE', portalRole: 'PRIMARY' },
      select: { id: true },
    });
    return login ? null : 'NO_PORTAL_LOGIN';
  }

  /** The staff's expiration alerts that are due, then the forms whose expiration has come. */
  private async expiry(options: IntakeJobOptions): Promise<number> {
    const now = options.now ?? new Date();
    const deadline = Date.now() + BUDGET_MS;
    let done = 0;
    for (const businessId of await this.firms(options)) {
      if (Date.now() > deadline) break;
      const db = this.database.forBusiness(businessId);
      const alerts = await db.intake.findMany({
        where: {
          businessId,
          status: { in: [...OPEN] },
          expiryAlertSentAt: null,
          expiryAlertMinutes: { not: null },
          expiresAt: { gt: now },
        },
        select: { id: true, expiresAt: true, expiryAlertMinutes: true },
        orderBy: { expiresAt: 'asc' },
        take: BATCH,
      });
      for (const a of alerts) {
        if (Date.now() > deadline) break;
        if (a.expiresAt!.getTime() - a.expiryAlertMinutes! * MIN > now.getTime()) continue;
        const result = await this.notifier.notify({
          businessId,
          event: 'intake.expiring',
          recordId: a.id,
          eventKey: `intake.expiring:${a.id}:${a.expiresAt!.toISOString()}`,
        });
        if (result.failed) continue;
        const { count } = await db.intake.updateMany({
          where: { businessId, id: a.id, expiryAlertSentAt: null },
          data: { expiryAlertSentAt: now },
        });
        if (count > 0) {
          await this.audit.log(
            'intake.expiry_alert_sent',
            { type: 'intake', id: a.id },
            { reached: result.written },
            { businessId },
          );
          done += 1;
        }
      }
      // The expiration has come: the form is Expired (extending it opens it again).
      const due = await db.intake.findMany({
        where: { businessId, status: { in: [...OPEN] }, expiresAt: { lte: now } },
        select: { id: true },
        take: BATCH,
      });
      for (const d of due) {
        const { count } = await db.intake.updateMany({
          where: { businessId, id: d.id, status: { in: [...OPEN] }, expiresAt: { lte: now } },
          data: { status: 'EXPIRED' },
        });
        if (count > 0) {
          await this.audit.log('intake.expired', { type: 'intake', id: d.id }, {}, { businessId });
          done += 1;
        }
      }
    }
    return done;
  }
}
