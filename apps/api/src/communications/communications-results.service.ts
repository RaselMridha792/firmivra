import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@firmivra/db';
import type {
  CommunicationActivityPage,
  CommunicationDetail,
  CommunicationExport,
  CommunicationRecipientPage,
  CommunicationResults,
  ResultMetric,
} from '@firmivra/types';
import type { z } from 'zod';
import { firmTimeZone } from '../appointments/calendar-data.js';
import { AuditService } from '../audit/audit.service.js';
import type { TenantContext } from '../common/request-context.js';
import { REPORT_FILES, type ReportFiles } from '../reports/report-files.js';
import { iso } from './communications.common.js';
import { CommunicationAudienceService } from './communications-audience.service.js';
import type { ActivityQ, ExportBody, FollowUpBody, RecipientsQ } from './communications-input.js';
import { CommunicationProviders } from './communications-provider.js';
import { type SegCtx, CommunicationSegmentsService } from './communications-segments.service.js';
import { CommunicationsService } from './communications.service.js';

type Out<S extends z.ZodType> = z.output<S>;

const DELIVERED = ['DELIVERED', 'OPENED', 'CLICKED', 'UNSUBSCRIBED'] as const;
const FAILED = ['FAILED', 'BOUNCED'] as const;
const DONE = ['SENT', 'FAILED', 'CANCELLED'];

export const FAILURE_LABELS: Record<string, string> = {
  unsubscribed: 'Unsubscribed',
  invalid_address: 'Invalid address',
  missing_address: 'No address on file',
  no_consent: 'No consent on record',
  duplicate: 'Duplicate address',
  cancelled: 'Cancelled before sending',
  provider_error: 'The provider could not send it',
  timed_out: 'Not sent in time',
  bounced: 'Bounced',
  complained: 'Marked as spam',
};
const labelOf = (code: string | null) =>
  code === null ? null : (FAILURE_LABELS[code] ?? code.replace(/_/g, ' '));

const EVENT_LINES: Record<string, string> = {
  QUEUED: 'Queued for delivery',
  SENT: 'Handed to the provider',
  DELIVERED: 'Delivered to a recipient',
  OPENED: 'Opened by a recipient',
  CLICKED: 'A link was clicked',
  BOUNCED: 'A message bounced',
  COMPLAINED: 'A recipient marked it as spam',
  UNSUBSCRIBED: 'A recipient unsubscribed',
  FAILED: 'A message could not be sent',
};

const BOM = String.fromCharCode(0xfeff);
const FORMULA = /^[=+\-@\t\r]/;
function cell(value: string | number | null): string {
  if (value === null) return '""';
  let s = String(value);
  if (typeof value === 'string' && FORMULA.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const refuse = (code: string, message: string) => new ConflictException({ code, message });

/** Results of a campaign that went out: numbers, recipients, activity, export, and the next campaigns it leads to. */
@Injectable()
export class CommunicationResultsService {
  constructor(
    private readonly segments: CommunicationSegmentsService,
    private readonly campaigns: CommunicationsService,
    private readonly audience: CommunicationAudienceService,
    private readonly providers: CommunicationProviders,
    private readonly audit: AuditService,
    @Inject(REPORT_FILES) private readonly files: ReportFiles,
  ) {}

  private run<T>(
    tenant: TenantContext,
    userId: string,
    fn: (ctx: SegCtx) => Promise<T>,
  ): Promise<T> {
    return this.segments.withCtx(tenant, userId, fn);
  }

  private recipientWhere(
    id: string,
    q: Pick<Out<typeof RecipientsQ>, 'status' | 'engagement' | 'search'>,
    businessId: string,
  ): Prisma.CommunicationRecipientWhereInput {
    const and: Prisma.CommunicationRecipientWhereInput[] = [{ businessId, communicationId: id }];
    if (q.status) and.push({ status: q.status });
    if (q.engagement === 'opened') and.push({ openCount: { gt: 0 } });
    if (q.engagement === 'not_opened') and.push({ status: { in: [...DELIVERED] }, openCount: 0 });
    if (q.engagement === 'clicked') and.push({ clickCount: { gt: 0 } });
    if (q.engagement === 'not_clicked') and.push({ status: { in: [...DELIVERED] }, clickCount: 0 });
    if (q.search)
      and.push({
        OR: [
          { client: { displayName: { contains: q.search, mode: 'insensitive' } } },
          { lead: { firstName: { contains: q.search, mode: 'insensitive' } } },
          { lead: { lastName: { contains: q.search, mode: 'insensitive' } } },
        ],
      });
    return { AND: and };
  }

  // ---------- Results ----------

  results(tenant: TenantContext, userId: string, id: string): Promise<CommunicationResults> {
    return this.run(tenant, userId, async (ctx) => {
      const c = await this.campaigns.load(ctx, id);
      const detail = await this.campaigns.detail(ctx, c);
      const where = { businessId: ctx.businessId, communicationId: c.id };
      const groups = await ctx.tx.communicationRecipient.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      });
      const by = (...s: string[]) =>
        groups.filter((g) => s.includes(g.status)).reduce((n, g) => n + g._count._all, 0);
      const total = by('QUEUED', 'SENT', ...DELIVERED, ...FAILED);
      const [opened, clicked, unsub, sentCount] = await Promise.all([
        ctx.tx.communicationRecipient.count({ where: { ...where, firstOpenedAt: { not: null } } }),
        ctx.tx.communicationRecipient.count({ where: { ...where, firstClickedAt: { not: null } } }),
        ctx.tx.communicationRecipient.count({ where: { ...where, unsubscribedAt: { not: null } } }),
        ctx.tx.communicationRecipient.count({
          where: { ...where, status: { notIn: ['QUEUED', 'NOT_SENT'] } },
        }),
      ]);
      const delivered = by(...DELIVERED);
      const conn = c.connectionId
        ? await ctx.tx.integrationConnection.findFirst({
            where: { businessId: ctx.businessId, id: c.connectionId },
            select: { provider: true },
          })
        : null;
      const supports = this.providers.supports(conn?.provider ?? null);
      const rate = (n: number, enabled = true): ResultMetric => ({
        count: n,
        ratePercent: enabled && total > 0 ? Math.round((n / total) * 1000) / 10 : null,
      });
      const tz = await firmTimeZone(ctx.tx, ctx.businessId);
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz });
      const events = await ctx.tx.communicationEvent.findMany({
        where: {
          businessId: ctx.businessId,
          communicationId: c.id,
          type: { in: ['DELIVERED', 'OPENED', 'CLICKED'] },
        },
        select: { type: true, occurredAt: true },
        orderBy: { occurredAt: 'asc' },
        take: 50_000,
      });
      const trend = new Map<string, { delivered: number; opened: number; clicked: number }>();
      for (const e of events) {
        const d = day.format(e.occurredAt);
        const row = trend.get(d) ?? { delivered: 0, opened: 0, clicked: 0 };
        if (e.type === 'DELIVERED') row.delivered++;
        else if (e.type === 'OPENED') row.opened++;
        else row.clicked++;
        trend.set(d, row);
      }
      const reasons = await ctx.tx.communicationRecipient.groupBy({
        by: ['failureCode'],
        where: { ...where, failureCode: { not: null } },
        _count: { _all: true },
      });
      const failedCount = by(...FAILED);
      const retryable =
        ctx.perms.write && DONE.includes(c.status) ? await this.retryable(ctx, c.id) : 0;
      return {
        communication: detail,
        metrics: {
          totalRecipients: total,
          delivered: rate(delivered),
          opened: rate(opened, supports.opens),
          clicked: rate(clicked, supports.clicks),
          failed: rate(failedCount),
          pending: rate(by('QUEUED', 'SENT')),
          unsubscribed: rate(unsub),
        },
        supports,
        funnel: [
          { stage: 'SENT' as const, count: sentCount },
          { stage: 'DELIVERED' as const, count: delivered },
          { stage: 'OPENED' as const, count: opened },
          { stage: 'CLICKED' as const, count: clicked },
        ],
        trend: [...trend.entries()].map(([date, v]) => ({ date, ...v })),
        failureReasons: reasons
          .map((r) => ({
            code: r.failureCode as string,
            label: labelOf(r.failureCode) as string,
            count: r._count._all,
          }))
          .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
        canExport: ctx.perms.exportResults,
        canResendFailed: retryable > 0,
      };
    });
  }

  private async retryable(ctx: SegCtx, id: string): Promise<number> {
    return ctx.tx.communicationRecipient.count({
      where: { businessId: ctx.businessId, communicationId: id, status: { in: [...FAILED] } },
    });
  }

  async recipients(
    tenant: TenantContext,
    userId: string,
    id: string,
    q: Out<typeof RecipientsQ>,
  ): Promise<CommunicationRecipientPage> {
    return this.run(tenant, userId, async (ctx) => {
      await this.campaigns.load(ctx, id);
      const where = this.recipientWhere(id, q, ctx.businessId);
      const [total, rows] = await Promise.all([
        ctx.tx.communicationRecipient.count({ where }),
        ctx.tx.communicationRecipient.findMany({
          where,
          include: {
            client: { select: { id: true, displayName: true } },
            lead: { select: { firstName: true, lastName: true } },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      return {
        items: rows.map((r) => ({
          id: r.id,
          client: r.client ? { id: r.client.id, name: r.client.displayName } : null,
          leadId: r.leadId,
          leadName: r.lead ? `${r.lead.firstName} ${r.lead.lastName}` : null,
          addressMask: r.addressMask,
          status: r.status,
          failureCode: r.failureCode,
          failureLabel: labelOf(r.failureCode),
          sentAt: iso(r.sentAt),
          deliveredAt: iso(r.deliveredAt),
          openCount: r.openCount,
          clickCount: r.clickCount,
          unsubscribedAt: iso(r.unsubscribedAt),
        })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  async activity(
    tenant: TenantContext,
    userId: string,
    id: string,
    q: Out<typeof ActivityQ>,
  ): Promise<CommunicationActivityPage> {
    return this.run(tenant, userId, async (ctx) => {
      await this.campaigns.load(ctx, id);
      const where: Prisma.CommunicationEventWhereInput = {
        businessId: ctx.businessId,
        communicationId: id,
        ...(q.type ? { type: q.type } : {}),
      };
      const [total, rows] = await Promise.all([
        ctx.tx.communicationEvent.count({ where }),
        ctx.tx.communicationEvent.findMany({
          where,
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      return {
        items: rows.map((e) => ({
          id: e.id,
          type: e.type,
          message: EVENT_LINES[e.type] ?? e.type,
          detailCode: e.detailCode,
          occurredAt: e.occurredAt.toISOString(),
          source: e.providerEventId ? ('PROVIDER' as const) : ('SYSTEM' as const),
        })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  // ---------- Export ----------

  async export(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof ExportBody>,
  ): Promise<CommunicationExport> {
    const prepared = await this.run(tenant, userId, async (ctx) => {
      if (!ctx.perms.exportResults)
        throw new ForbiddenException({
          code: 'EXPORT_NOT_ALLOWED',
          message: 'You may not export results',
        });
      const c = await this.campaigns.load(ctx, id);
      if (!DONE.includes(c.status))
        throw refuse('STILL_SENDING', 'Wait until it has finished sending');
      const where = this.recipientWhere(id, body.filter ?? {}, ctx.businessId);
      const rows = await ctx.tx.communicationRecipient.findMany({
        where,
        include: {
          client: { select: { displayName: true } },
          lead: { select: { firstName: true, lastName: true } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 50_000,
      });
      await this.audit.logIn(
        ctx.tx,
        'communication.exported',
        { type: 'communication', id: c.id },
        { communicationId: c.id, rows: rows.length },
      );
      return { c, rows, businessId: ctx.businessId };
    });
    const head = [
      'Recipient',
      'Address',
      'Status',
      'Reason',
      'Sent',
      'Delivered',
      'Opens',
      'Clicks',
    ];
    const lines = prepared.rows.map((r) =>
      [
        r.client?.displayName ?? (r.lead ? `${r.lead.firstName} ${r.lead.lastName}` : ''),
        r.addressMask,
        r.status,
        labelOf(r.failureCode) ?? '',
        r.sentAt?.toISOString() ?? null,
        r.deliveredAt?.toISOString() ?? null,
        r.openCount,
        r.clickCount,
      ]
        .map(cell)
        .join(','),
    );
    const bytes = Buffer.from(
      `${BOM}${[head.map(cell).join(','), ...lines].join('\r\n')}\r\n`,
      'utf8',
    );
    const key = `tenant/${prepared.businessId}/reports/communication-${randomUUID()}.csv`;
    await this.files.put(key, bytes, 'text/csv; charset=utf-8');
    const stamp = new Date().toISOString().slice(0, 10);
    const fileName = `${
      prepared.c.name
        .replace(/[^A-Za-z0-9 _-]+/g, '')
        .trim()
        .slice(0, 60) || 'communication'
    }-results-${stamp}.csv`;
    const url = await this.files.presignDownload({ key, fileName, contentType: 'text/csv' });
    return {
      url,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      fileName,
      rowCount: prepared.rows.length,
    };
  }

  // ---------- Next campaigns ----------

  /** A NEW draft aimed at some of this campaign's recipients. The original never changes. */
  private derive(
    tenant: TenantContext,
    userId: string,
    id: string,
    kind: 'RESEND_FAILED' | 'FOLLOW_UP',
    pick: Prisma.CommunicationRecipientWhereInput,
  ): Promise<CommunicationDetail> {
    return this.run(tenant, userId, async (ctx) => {
      this.campaigns.requireWrite(ctx);
      const c = await this.campaigns.load(ctx, id);
      if (!DONE.includes(c.status))
        throw refuse('STILL_SENDING', 'Wait until it has finished sending');
      const ready = await this.campaigns.readiness(ctx, c.channel);
      if (!ready.ready)
        throw refuse('CHANNEL_UNAVAILABLE', ready.reason ?? 'This channel is not ready');
      const people = await ctx.tx.communicationRecipient.findMany({
        where: { AND: [{ businessId: ctx.businessId, communicationId: c.id }, pick] },
        select: { clientId: true, leadId: true },
      });
      const made = await ctx.tx.communication.create({
        data: {
          businessId: ctx.businessId,
          channel: c.channel,
          name: `${c.name} (${kind === 'FOLLOW_UP' ? 'follow-up' : 'resend'})`.slice(0, 200),
          subject: c.subject,
          previewText: c.previewText,
          body: c.body,
          replyTo: c.replyTo,
          fromName: c.fromName,
          connectionId: c.connectionId,
          templateId: c.templateId,
          templateVersion: c.templateVersion,
          visibility: c.visibility,
          timezone: c.timezone,
          sourceCommunicationId: c.id,
          sourceKind: kind,
          createdByUserId: ctx.userId,
          updatedByUserId: ctx.userId,
        },
      });
      const unique = (ids: (string | null)[]) => [...new Set(ids.filter((x): x is string => !!x))];
      await ctx.tx.communicationAudienceEntry.createMany({
        data: [
          ...unique(people.map((p) => p.clientId)).map((clientId) => ({
            businessId: ctx.businessId,
            communicationId: made.id,
            kind: 'CLIENT' as const,
            clientId,
          })),
          ...unique(people.map((p) => p.leadId)).map((leadId) => ({
            businessId: ctx.businessId,
            communicationId: made.id,
            kind: 'LEAD' as const,
            leadId,
          })),
        ],
      });
      // Consent and eligibility are checked again for the new campaign.
      const { summary } = await this.audience.compute(ctx, made);
      if (summary.finalCount === 0)
        throw refuse('NO_ELIGIBLE_RECIPIENTS', 'No one in this group can be sent to now');
      await this.audit.logIn(
        ctx.tx,
        kind === 'FOLLOW_UP' ? 'communication.follow_up_started' : 'communication.resend_started',
        { type: 'communication', id: made.id },
        { communicationId: made.id, sourceId: c.id, eligible: summary.finalCount },
      );
      return this.campaigns.detail(ctx, made);
    });
  }

  resendFailed(tenant: TenantContext, userId: string, id: string) {
    return this.derive(tenant, userId, id, 'RESEND_FAILED', { status: { in: [...FAILED] } });
  }

  followUp(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof FollowUpBody>,
  ): Promise<CommunicationDetail> {
    const pick: Record<typeof body.group, Prisma.CommunicationRecipientWhereInput> = {
      OPENED: { openCount: { gt: 0 } },
      NOT_OPENED: { status: { in: [...DELIVERED] }, openCount: 0 },
      CLICKED: { clickCount: { gt: 0 } },
      NOT_CLICKED: { status: { in: [...DELIVERED] }, clickCount: 0 },
      FAILED: { status: { in: [...FAILED] } },
    };
    return this.derive(tenant, userId, id, 'FOLLOW_UP', pick[body.group]);
  }

  /** A published announcement stops showing: it is archived (a sent campaign's window is a record). */
  expire(tenant: TenantContext, userId: string, id: string): Promise<CommunicationDetail> {
    return this.run(tenant, userId, async (ctx) => {
      this.campaigns.requireWrite(ctx);
      const c = await this.campaigns.lock(ctx, id);
      if (c.channel !== 'ANNOUNCEMENT' || c.status !== 'SENT')
        throw refuse('NOT_EDITABLE', 'Only a published announcement can be expired');
      const saved =
        c.archivedAt === null
          ? await ctx.tx.communication.update({
              where: { id: c.id },
              data: { archivedAt: new Date(), updatedByUserId: ctx.userId },
            })
          : c;
      if (saved !== c)
        await this.audit.logIn(
          ctx.tx,
          'communication.expired',
          { type: 'communication', id: c.id },
          { communicationId: c.id },
        );
      return this.campaigns.detail(ctx, saved);
    });
  }
}
