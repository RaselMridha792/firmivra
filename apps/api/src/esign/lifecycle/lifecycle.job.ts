import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { isOpen, signersOf, TURN } from '../requests/actions.js';
import { ESIGN_DIRECTORY, type EsignDirectory } from '../requests/esign-directory.js';
import {
  ESIGN_REPOSITORY,
  type EsignRecipientRecord,
  type EsignRepository,
  type EsignRequestRecord,
} from '../requests/esign.repository.js';
import { type EsignLifecycleRepository, LIFECYCLE_REPOSITORY } from './lifecycle.repository.js';
import { event, EsignLifecycleService, type Outgoing } from './lifecycle.service.js';

/** How often the job looks for due work (SYSTEM-DESIGN: a 60-second tick). */
export const LIFECYCLE_JOB_INTERVAL_MS = 60_000;
const DAY_MS = 86_400_000;
/** Per firm and run; the rest waits for the next run. */
const BATCH = 20;
/** A run stops starting work here (the lock's transaction is capped at 30 s). */
const BUDGET_MS = 20_000;
const SYSTEM = { kind: 'SYSTEM' } as const;

/**
 * ESIGN_JOBS=on|off: Firm Sign's jobs in this API task. Off unless on, until the r0_esign tables
 * and the Prisma repositories land (the stand-in would fail every tick); other values refused.
 */
export function esignJobsOn(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.ESIGN_JOBS;
  if (value === 'on' || value === 'off' || !value) return value === 'on';
  throw new Error('ESIGN_JOBS must be "on" or "off"');
}

/** Expired while a signer has not signed (an all-signed request waits for its completion). */
export const expiryDue = (q: EsignRequestRecord, rs: EsignRecipientRecord[], now: Date) =>
  isOpen(q.status) &&
  q.expiresAt !== null &&
  q.expiresAt <= now &&
  signersOf(rs).some((r) => r.status !== 'SIGNED');

/** The once-per-request warning, from `expiryWarningDays` before the expiry (0: none). */
export const warningDue = (q: EsignRequestRecord, now: Date) =>
  isOpen(q.status) &&
  q.expiryWarningDays > 0 &&
  q.expiryWarnedAt === null &&
  q.expiresAt !== null &&
  +q.expiresAt - q.expiryWarningDays * DAY_MS <= +now &&
  now < q.expiresAt;

/**
 * A signer whose turn it is gets reminder n+1 `firstAfterDays` after it was sent, then every
 * `everyDays` after the last one (a manual one counts), at most `max`, never at or after expiry.
 */
export function reminderDue(q: EsignRequestRecord, r: EsignRecipientRecord, now: Date) {
  const { firstAfterDays, everyDays, max } = q.reminders;
  if (r.kind !== 'SIGNER' || !TURN.includes(r.status) || r.delivery === 'IN_PERSON') return false;
  if (!isOpen(q.status) || r.reminderCount >= max || !r.sentAt || !r.email) return false;
  const next = r.lastRemindedAt
    ? +r.lastRemindedAt + everyDays * DAY_MS
    : +r.sentAt + firstAfterDays * DAY_MS;
  return next <= +now && (q.expiresAt === null || next < +q.expiresAt);
}

export interface LifecycleJobOptions {
  now?: Date;
  /** Only these firms (tests); otherwise every ACTIVE firm with Firm Sign on. */
  businessIds?: string[];
}
type Done = 'EXPIRED' | 'WARNED' | 'REMINDED' | null;

/**
 * Expiry, expiry warnings and automatic reminders, in-process like the completion job: each run
 * holds the job's advisory lock (one API task at a time) and works firm by firm, each in its own
 * scope, one step per request per run (expire, else warn, else remind). A write that loses to a
 * signer or staff member changes nothing and is tried again next run.
 */
@Injectable()
export class EsignLifecycleJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EsignLifecycleJob.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(LIFECYCLE_REPOSITORY) private readonly lifecycle: EsignLifecycleRepository,
    @Inject(ESIGN_REPOSITORY) private readonly repo: EsignRepository,
    @Inject(ESIGN_DIRECTORY) private readonly directory: EsignDirectory,
    @Inject(EsignLifecycleService)
    private readonly service: Pick<EsignLifecycleService, 'nudge' | 'deliver'>,
    @Inject(AuditService) private readonly audit: Pick<AuditService, 'log'>,
    @Inject(ENV) private readonly env: Pick<Env, 'APP_BASE_URL'>,
  ) {}

  onApplicationBootstrap(): void {
    if (!esignJobsOn() || this.timer) return;
    this.timer = setInterval(() => {
      if (this.running) return; // a run still going in this task is not started again
      this.running = true;
      void this.run().finally(() => (this.running = false));
    }, LIFECYCLE_JOB_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One run; `{ skipped: true }` when another task holds the lock. Never throws. */
  async run(options: LifecycleJobOptions = {}) {
    try {
      const done = await this.lifecycle.withJobLock(() => this.work(options));
      if (done === null) return { skipped: true } as const;
      return { skipped: false, ...done } as const;
    } catch (error) {
      const name = error instanceof Error ? error.name : 'Error';
      this.logger.warn(`esign lifecycle: run failed (${name})`);
      return { skipped: false, expired: 0, warned: 0, reminded: 0 } as const;
    }
  }

  private async work(options: LifecycleJobOptions) {
    const now = options.now ?? new Date();
    const deadline = Date.now() + BUDGET_MS;
    const done = { expired: 0, warned: 0, reminded: 0 };
    for (const businessId of options.businessIds ?? (await this.lifecycle.firms())) {
      for (const id of await this.lifecycle.due(businessId, now, BATCH)) {
        if (Date.now() > deadline) return done;
        const step = await this.step(businessId, id, now).catch((error: unknown) => {
          const name = error instanceof Error ? error.name : 'Error';
          this.logger.warn(`esign lifecycle: request ${id} failed (${name})`); // ids only
          return null;
        });
        if (step === 'EXPIRED') done.expired += 1;
        if (step === 'WARNED') done.warned += 1;
        if (step === 'REMINDED') done.reminded += 1;
      }
    }
    return done;
  }

  private async step(businessId: string, id: string, now: Date): Promise<Done> {
    const q = await this.repo.findRequest(businessId, id);
    if (!q) return null;
    const { recipients } = await this.repo.parts(businessId, id);
    const at = { businessId };
    if (expiryDue(q, recipients, now)) {
      const sender = await this.directory.member(businessId, q.senderUserId);
      const outgoing: Outgoing[] = [];
      if (sender?.active) {
        const link = new URL(`/firm-sign/requests/${id}`, this.env.APP_BASE_URL).toString();
        const data = { name: sender.name, title: q.title, event: 'EXPIRED' as const, link };
        const message = { template: 'esign.staff-update' as const, to: sender.email, data };
        outgoing.push({
          email: { userId: sender.userId, template: 'esign.staff-update' },
          message: { ...message, businessId, recipient: { userId: sender.userId } },
        });
      }
      const write = {
        at: now,
        events: [event('EXPIRED', now, SYSTEM, null)],
        emails: outgoing.map((o) => o.email),
      };
      const written = await this.lifecycle.expire(businessId, id, write, q.lastActivityAt);
      if (!written) return null;
      const meta = { clientId: q.clientId, emailIds: written.emailIds };
      await this.audit.log('esign.request_expired', { type: 'esign_request', id }, meta, at);
      await this.service.deliver(businessId, written.emailIds, outgoing);
      return 'EXPIRED';
    }
    const warn = warningDue(q, now);
    const targets = recipients.filter((r) =>
      warn
        ? r.kind === 'SIGNER' && TURN.includes(r.status) && r.delivery !== 'IN_PERSON'
        : reminderDue(q, r, now),
    );
    // A warning is marked sent even with no one to email, so it is not due again.
    if (targets.length === 0 && !warn) return null;
    const kind = warn ? 'EXPIRY_WARNING' : 'REMINDER';
    const written = await this.service.nudge(businessId, q, targets, SYSTEM, now, kind);
    if (!written) return null;
    await this.audit.log(
      warn ? 'esign.request_expiry_warned' : 'esign.request_reminded',
      { type: 'esign_request', id },
      { clientId: q.clientId, recipientIds: targets.map((r) => r.id), emailIds: written.emailIds },
      at,
    );
    return warn ? 'WARNED' : 'REMINDED';
  }
}
