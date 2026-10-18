import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { fill } from '../templates/merge-fields.js';
import { e164, type Person } from './communications-audience.service.js';
import {
  CommunicationProviders,
  type DeliveryMessage,
  DeliveryError,
} from './communications-provider.js';
import { CommunicationsService } from './communications.service.js';

/** The job's advisory lock key: fixed, in a range no other module uses ("R5" = 0x5235). */
export const COMMUNICATION_LOCK_KEY = 0x5235_0100;
export const COMMUNICATION_JOB_INTERVAL_MS = 60_000;
const BATCH = 50;
const CAMPAIGNS_PER_FIRM = 10;
const BUDGET_MS = 20_000;
/** A message that keeps being refused for a retryable reason is given up on after this long. */
const GIVE_UP_MS = 2 * 3_600_000;

/**
 * COMMUNICATION_JOBS=on|off: run the job in this API task. Default on, off under NODE_ENV=test
 * (tests call `run()` themselves). Any other value is refused at boot.
 */
export function communicationJobsOn(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.COMMUNICATION_JOBS;
  if (value === undefined || value === '') return env.NODE_ENV !== 'test';
  if (value === 'on' || value === 'off') return value === 'on';
  throw new Error('COMMUNICATION_JOBS must be "on" or "off"');
}

export interface DeliveryRunOptions {
  now?: Date;
  /** Only these firms (tests); otherwise every ACTIVE firm. */
  businessIds?: string[];
}
export type DeliveryRunResult =
  { skipped: true } | { skipped: false; started: number; sent: number; failed: number };

/** A normalized provider event (the webhook routes of a provider adapter produce these). */
export interface ProviderEvent {
  communicationId: string;
  recipientId?: string;
  providerMessageId?: string;
  type: 'DELIVERED' | 'OPENED' | 'CLICKED' | 'BOUNCED' | 'COMPLAINED' | 'UNSUBSCRIBED' | 'FAILED';
  /** The provider's own id for the event: the same one twice is applied once. */
  providerEventId: string;
  occurredAt: Date;
  detailCode?: string;
}

const CODE = /^[a-z][a-z0-9_]{0,59}$/;
const safeCode = (c: string, fallback = 'provider_error') => (CODE.test(c) ? c : fallback);

/**
 * Delivery: starts scheduled campaigns when their time comes, hands each queued recipient's message
 * to the connected provider's adapter, and folds the provider's events back into the results. In
 * process like the other jobs; one Postgres advisory lock so only one API task runs it at a time.
 */
@Injectable()
export class CommunicationDelivery implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('CommunicationDelivery');
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly campaigns: CommunicationsService,
    private readonly providers: CommunicationProviders,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap(): void {
    if (communicationJobsOn()) this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(intervalMs = COMMUNICATION_JOB_INTERVAL_MS): void {
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
  async run(options: DeliveryRunOptions = {}): Promise<DeliveryRunResult> {
    const total = { started: 0, sent: 0, failed: 0 };
    try {
      return await this.database.withScope(
        { kind: 'platform' },
        async (tx) => {
          const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(${COMMUNICATION_LOCK_KEY}::bigint) AS locked`;
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
          for (const { id } of firms) {
            if (Date.now() > deadline) break;
            const r = await this.firm(id, now).catch((error: unknown) => {
              this.logger.warn(
                `firm ${id} failed (${error instanceof Error ? error.name : 'Error'})`,
              );
              return { started: 0, sent: 0, failed: 0 };
            });
            total.started += r.started;
            total.sent += r.sent;
            total.failed += r.failed;
          }
          return { skipped: false, ...total } as const;
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      this.logger.warn(`run failed (${error instanceof Error ? error.name : 'Error'})`);
      return { skipped: false, ...total };
    }
  }

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  private async firm(businessId: string, now: Date) {
    const due = await this.inFirm(businessId, (tx) =>
      tx.communication.findMany({
        where: { businessId, status: 'SCHEDULED', scheduledFor: { lte: now } },
        select: { id: true },
        orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }],
        take: CAMPAIGNS_PER_FIRM,
      }),
    );
    let started = 0;
    for (const { id } of due) {
      const done = await this.inFirm(businessId, (tx) =>
        this.campaigns.startDue(tx, businessId, id, now),
      ).catch((error: unknown) => {
        this.logger.warn(`start ${id} failed (${error instanceof Error ? error.name : 'Error'})`);
        return null;
      });
      if (done === 'started') started++;
    }
    const going = await this.inFirm(businessId, (tx) =>
      tx.communication.findMany({
        where: {
          businessId,
          status: 'SENDING',
          channel: { in: ['EMAIL', 'SMS'] },
          recipients: { some: { status: 'QUEUED' } },
        },
        select: { id: true },
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
        take: CAMPAIGNS_PER_FIRM,
      }),
    );
    let sent = 0;
    let failed = 0;
    for (const { id } of going) {
      const r = await this.deliver(businessId, id, now).catch((error: unknown) => {
        this.logger.warn(`deliver ${id} failed (${error instanceof Error ? error.name : 'Error'})`);
        return { sent: 0, failed: 0 };
      });
      sent += r.sent;
      failed += r.failed;
    }
    // A campaign with nothing left to send is finished.
    const open = await this.inFirm(businessId, (tx) =>
      tx.communication.findMany({
        where: {
          businessId,
          status: 'SENDING',
          channel: { in: ['EMAIL', 'SMS'] },
          recipients: { none: { status: 'QUEUED' } },
        },
        select: { id: true },
        take: CAMPAIGNS_PER_FIRM,
      }),
    );
    for (const { id } of open) await this.finish(businessId, id);
    return { started, sent, failed };
  }

  /** The values a person gives to the merge fields. */
  private async deliver(businessId: string, id: string, now: Date) {
    const prepared = await this.inFirm(businessId, async (tx) => {
      const c = await tx.communication.findFirst({ where: { businessId, id, status: 'SENDING' } });
      if (!c || (c.channel !== 'EMAIL' && c.channel !== 'SMS')) return null;
      const conn = c.connectionId
        ? await tx.integrationConnection.findFirst({ where: { businessId, id: c.connectionId } })
        : null;
      const queued = await tx.communicationRecipient.findMany({
        where: { businessId, communicationId: id, status: 'QUEUED' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: BATCH,
        include: {
          client: { select: { displayName: true, email: true, phone: true } },
          lead: { select: { firstName: true, lastName: true, email: true, phone: true } },
        },
      });
      const [business, custom] = await Promise.all([
        tx.business.findUnique({ where: { id: businessId }, select: { name: true } }),
        tx.customMergeField.findMany({
          where: { businessId },
          select: { key: true, label: true, fallback: true },
        }),
      ]);
      return { c, conn, queued, firmName: business?.name ?? '', custom };
    });
    if (!prepared) return { sent: 0, failed: 0 };
    const { c, conn, queued, firmName, custom } = prepared;
    const adapter = conn ? this.providers.get(conn.provider) : undefined;
    const healthy = !!conn && (conn.status === 'CONNECTED' || conn.status === 'SYNCING');
    const channel = c.channel as 'EMAIL' | 'SMS';
    const age = now.getTime() - (c.startedAt ?? c.createdAt).getTime();

    const outcomes: {
      id: string;
      ok: boolean;
      messageId?: string;
      code?: string;
    }[] = [];
    for (const r of queued) {
      const p: Person = r.client
        ? {
            kind: 'CLIENT',
            id: r.clientId as string,
            name: r.client.displayName,
            email: r.client.email,
            phone: r.client.phone,
          }
        : {
            kind: 'LEAD',
            id: r.leadId as string,
            name: `${r.lead?.firstName ?? ''} ${r.lead?.lastName ?? ''}`.trim(),
            email: r.lead?.email ?? null,
            phone: r.lead?.phone ?? null,
          };
      if (!adapter) {
        outcomes.push({ id: r.id, ok: false, code: 'provider_error' });
        continue;
      }
      if (!healthy) {
        // The connection needs attention: wait for it, and give up if it takes too long.
        if (age > GIVE_UP_MS) outcomes.push({ id: r.id, ok: false, code: 'timed_out' });
        continue;
      }
      const to = channel === 'EMAIL' ? p.email : e164(p.phone);
      if (!to) {
        outcomes.push({ id: r.id, ok: false, code: 'missing_address' });
        continue;
      }
      const values = this.campaigns.valuesFor(p, firmName, custom);
      const mode = channel === 'SMS' ? 'text' : 'html';
      const message: DeliveryMessage = {
        channel,
        connectionId: conn!.id,
        businessId,
        to,
        fromName: c.fromName,
        replyTo: c.replyTo,
        subject: c.subject ? fill(c.subject, values, 'text').text : null,
        body: fill(c.body, values, mode).text,
        reference: r.id,
      };
      try {
        const out = await adapter.send(message);
        outcomes.push({ id: r.id, ok: true, messageId: out.messageId.slice(0, 200) });
      } catch (error) {
        if (error instanceof DeliveryError && error.retry && age <= GIVE_UP_MS) continue;
        outcomes.push({
          id: r.id,
          ok: false,
          code: error instanceof DeliveryError ? safeCode(error.code) : 'provider_error',
        });
      }
    }
    if (!outcomes.length) return { sent: 0, failed: 0 };
    await this.inFirm(businessId, async (tx) => {
      for (const o of outcomes) {
        const changed = await tx.communicationRecipient.updateMany({
          where: { businessId, id: o.id, status: 'QUEUED' },
          data: o.ok
            ? { status: 'SENT', sentAt: now, providerMessageId: o.messageId ?? null }
            : { status: 'FAILED', failureCode: o.code ?? 'provider_error' },
        });
        if (changed.count === 0) continue;
        await tx.communicationEvent.create({
          data: {
            businessId,
            communicationId: id,
            recipientId: o.id,
            type: o.ok ? 'SENT' : 'FAILED',
            occurredAt: now,
            detailCode: o.ok ? null : (o.code ?? 'provider_error'),
          },
        });
      }
    });
    return {
      sent: outcomes.filter((o) => o.ok).length,
      failed: outcomes.filter((o) => !o.ok).length,
    };
  }

  /** Nothing is queued any more: the campaign is SENT, or FAILED when not one message went out. */
  private async finish(businessId: string, id: string): Promise<void> {
    await this.inFirm(businessId, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM communications WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      const c = await tx.communication.findFirst({ where: { businessId, id, status: 'SENDING' } });
      if (!c) return;
      const queued = await tx.communicationRecipient.count({
        where: { businessId, communicationId: id, status: 'QUEUED' },
      });
      if (queued > 0) return;
      const total = await tx.communicationRecipient.count({
        where: { businessId, communicationId: id, status: { not: 'NOT_SENT' } },
      });
      const failed = await tx.communicationRecipient.count({
        where: { businessId, communicationId: id, status: { in: ['FAILED', 'BOUNCED'] } },
      });
      const status = total > 0 && failed === total ? 'FAILED' : 'SENT';
      await tx.communication.update({
        where: { id },
        data: { status, ...(status === 'SENT' ? { sentAt: new Date() } : {}) },
      });
      await this.audit.logIn(
        tx,
        status === 'SENT' ? 'communication.finished' : 'communication.failed',
        { type: 'communication', id },
        { communicationId: id, recipients: total, failed, actor: 'job' },
        { businessId },
      );
    });
  }

  // ---------- Provider events ----------

  /**
   * Folds one normalized provider event into the recipient and the campaign's events. The same
   * `providerEventId` twice is applied once. An unsubscribe, a complaint or a bounce also updates
   * the person's consent, so the next send leaves them out. Returns whether it was new.
   */
  async applyEvent(
    businessId: string,
    e: ProviderEvent,
  ): Promise<'applied' | 'duplicate' | 'ignored'> {
    return this.inFirm(businessId, async (tx) => {
      const c = await tx.communication.findFirst({
        where: { businessId, id: e.communicationId },
        select: { id: true, channel: true, status: true },
      });
      if (!c || !['SENDING', 'PAUSED', 'SENT', 'FAILED'].includes(c.status)) return 'ignored';
      const recipient = await tx.communicationRecipient.findFirst({
        where: {
          businessId,
          communicationId: c.id,
          ...(e.recipientId
            ? { id: e.recipientId }
            : { providerMessageId: e.providerMessageId ?? '' }),
        },
      });
      if (!recipient) return 'ignored';
      const made = await tx.communicationEvent.createMany({
        data: [
          {
            businessId,
            communicationId: c.id,
            recipientId: recipient.id,
            type: e.type,
            occurredAt: e.occurredAt,
            providerEventId: e.providerEventId.slice(0, 200),
            detailCode: e.detailCode ? safeCode(e.detailCode, 'provider_event') : null,
          },
        ],
        skipDuplicates: true,
      });
      if (made.count === 0) return 'duplicate';
      const at = e.occurredAt;
      const data: Prisma.CommunicationRecipientUncheckedUpdateInput = {};
      const progressed = ['QUEUED', 'SENT', 'DELIVERED'].includes(recipient.status);
      let consent: 'OPTED_OUT' | 'BOUNCED' | 'COMPLAINED' | null = null;
      let source = 'provider';
      switch (e.type) {
        case 'DELIVERED':
          if (['QUEUED', 'SENT'].includes(recipient.status)) {
            data.status = 'DELIVERED';
            data.deliveredAt = at;
          }
          break;
        case 'OPENED':
          data.openCount = { increment: 1 };
          if (!recipient.firstOpenedAt) data.firstOpenedAt = at;
          if (progressed) data.status = 'OPENED';
          if (!recipient.deliveredAt) data.deliveredAt = at;
          break;
        case 'CLICKED':
          data.clickCount = { increment: 1 };
          if (!recipient.firstClickedAt) data.firstClickedAt = at;
          if (!recipient.firstOpenedAt) {
            data.firstOpenedAt = at;
            data.openCount = { increment: 1 };
          }
          if (progressed || recipient.status === 'OPENED') data.status = 'CLICKED';
          if (!recipient.deliveredAt) data.deliveredAt = at;
          break;
        case 'BOUNCED':
          data.status = 'BOUNCED';
          data.failureCode = 'bounced';
          consent = 'BOUNCED';
          break;
        case 'FAILED':
          data.status = 'FAILED';
          data.failureCode = e.detailCode ? safeCode(e.detailCode) : 'provider_error';
          break;
        case 'COMPLAINED':
          data.status = 'UNSUBSCRIBED';
          data.unsubscribedAt = at;
          consent = 'COMPLAINED';
          break;
        case 'UNSUBSCRIBED':
          data.status = 'UNSUBSCRIBED';
          data.unsubscribedAt = at;
          consent = 'OPTED_OUT';
          source = 'unsubscribe_link';
          break;
      }
      if (Object.keys(data).length)
        await tx.communicationRecipient.update({ where: { id: recipient.id }, data });
      if (consent && (c.channel === 'EMAIL' || c.channel === 'SMS')) {
        const who = recipient.clientId
          ? { clientId: recipient.clientId }
          : { leadId: recipient.leadId as string };
        const existing = await tx.communicationConsent.findFirst({
          where: { businessId, channel: c.channel, ...who },
        });
        const row = { status: consent, source, sourceCommunicationId: c.id, changedByUserId: null };
        if (existing)
          await tx.communicationConsent.update({ where: { id: existing.id }, data: row });
        else
          await tx.communicationConsent.create({
            data: { businessId, channel: c.channel, ...who, ...row },
          });
      }
      return 'applied';
    });
  }
}
