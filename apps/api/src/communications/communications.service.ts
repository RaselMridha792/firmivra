import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
import type {
  AnnouncementLocationList,
  AudienceSummary,
  CommunicationChannel,
  CommunicationDetail,
  CommunicationPage,
  CommunicationReview,
  CommunicationRow,
  CommunicationSender,
  CommunicationSenderList,
  CommunicationsOverview,
  ChannelReadiness,
  SelectAllAudienceResult,
  AudienceCandidatePage,
  SendCheck,
  RenderedTemplate,
} from '@firmivra/types';
import type { z } from 'zod';
import { firmTimeZone } from '../appointments/calendar-data.js';
import { AuditService } from '../audit/audit.service.js';
import { legacyFirmRole, type TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { sanitize, stripTags } from '../templates/html.js';
import { BUILT_IN_FIELDS, builtIn, fieldsIn, fill, smsLength } from '../templates/merge-fields.js';
import { memberNames, memberRef } from '../workspaces/common.js';
import { comErrors, iso, mask, permsOf } from './communications.common.js';
import {
  addressOf,
  CommunicationAudienceService,
  e164,
  type Person,
} from './communications-audience.service.js';
import type {
  AudienceCandidatesQ,
  CancelBody,
  CommunicationsQ,
  CreateCommunicationBody,
  RescheduleBody,
  ScheduleBody,
  SelectAllAudienceBody,
  SendBody,
  SetAudienceBody,
  UpdateCommunicationBody,
} from './communications-input.js';
import { CommunicationProviders } from './communications-provider.js';
import { type SegCtx, CommunicationSegmentsService } from './communications-segments.service.js';

type Out<S extends z.ZodType> = z.output<S>;
type Row = Prisma.CommunicationGetPayload<object>;

/** A scheduled campaign locks this long before it goes out. */
export const LOCK_MINUTES = 5;
const LOCK_MS = LOCK_MINUTES * 60_000;

/** The integration providers that can carry each channel. */
export const CHANNEL_PROVIDERS: Record<'EMAIL' | 'SMS', string[]> = {
  EMAIL: ['outlook', 'gmail'],
  SMS: ['textmagic'],
};
const PROVIDER_NAMES: Record<string, string> = {
  outlook: 'Outlook',
  gmail: 'Gmail',
  textmagic: 'Textmagic',
};
const HEALTHY: ('CONNECTED' | 'SYNCING')[] = ['CONNECTED', 'SYNCING'];

const LOCATIONS = [
  { key: 'dashboard', label: 'Portal dashboard' },
  { key: 'messages', label: 'Portal messages' },
  { key: 'documents', label: 'Portal documents' },
  { key: 'billing', label: 'Portal billing' },
];

const FROZEN_STATUSES = ['SENDING', 'PAUSED', 'SENT', 'FAILED', 'CANCELLED'];

const notFound = () =>
  new NotFoundException({ code: 'NOT_FOUND', message: 'This communication was not found' });
const refuse = (code: string, message: string, details?: unknown) =>
  new ConflictException({ code, message, ...(details === undefined ? {} : { details }) });

/** The campaigns themselves: overview, lists, the composer's draft, the audience, review and send. */
@Injectable()
export class CommunicationsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly segments: CommunicationSegmentsService,
    private readonly audience: CommunicationAudienceService,
    private readonly audit: AuditService,
    private readonly providers: CommunicationProviders,
  ) {}

  private run<T>(
    tenant: TenantContext,
    userId: string,
    fn: (ctx: SegCtx) => Promise<T>,
  ): Promise<T> {
    return this.segments.withCtx(tenant, userId, fn);
  }

  requireWrite(ctx: SegCtx) {
    if (!ctx.perms.write) throw comErrors.forbidden();
  }

  /** Staff see the campaigns they made and the announcements; the others see all. */
  visible(ctx: SegCtx): Prisma.CommunicationWhereInput {
    return ctx.reachOnly
      ? { OR: [{ createdByUserId: ctx.userId }, { channel: 'ANNOUNCEMENT' }] }
      : {};
  }

  async load(ctx: SegCtx, id: string): Promise<Row> {
    const c = await ctx.tx.communication.findFirst({
      where: { AND: [{ businessId: ctx.businessId, id }, this.visible(ctx)] },
    });
    if (!c) throw notFound();
    return c;
  }

  async lock(ctx: SegCtx, id: string, etag?: string): Promise<Row> {
    await ctx.tx
      .$queryRaw`SELECT 1 FROM communications WHERE business_id = ${ctx.businessId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    const c = await this.load(ctx, id);
    if (etag !== undefined && c.updatedAt.toISOString() !== etag) throw comErrors.saveConflict();
    return c;
  }

  // ---------- Providers, senders, readiness ----------

  private connections(ctx: SegCtx, channel: CommunicationChannel) {
    if (channel === 'ANNOUNCEMENT') return Promise.resolve([]);
    return ctx.tx.integrationConnection.findMany({
      where: {
        businessId: ctx.businessId,
        provider: { in: CHANNEL_PROVIDERS[channel] },
        status: { not: 'DISCONNECTED' },
      },
      orderBy: [{ connectedAt: 'asc' }, { id: 'asc' }],
    });
  }

  /** A connection a message can go out through: healthy, with an adapter for its provider. */
  private usable(c: Prisma.IntegrationConnectionGetPayload<object>): boolean {
    return (HEALTHY as string[]).includes(c.status) && this.providers.has(c.provider);
  }

  private senderOf(
    c: Prisma.IntegrationConnectionGetPayload<object>,
    channel: CommunicationChannel,
    isDefault: boolean,
  ): CommunicationSender {
    const healthy = (HEALTHY as string[]).includes(c.status);
    return {
      id: c.id,
      channel,
      label: c.accountLabel ?? PROVIDER_NAMES[c.provider] ?? c.provider,
      verified: healthy && this.providers.has(c.provider),
      isDefault,
      provider: PROVIDER_NAMES[c.provider] ?? c.provider,
      providerHealthy: healthy,
    };
  }

  async readiness(ctx: SegCtx, channel: CommunicationChannel): Promise<ChannelReadiness> {
    if (!ctx.perms.write)
      return {
        channel,
        ready: false,
        reason: 'You do not have permission to send communications',
        route: 'PERMISSIONS',
        senderCount: 0,
      };
    if (channel === 'ANNOUNCEMENT')
      return { channel, ready: true, reason: null, route: null, senderCount: 0 };
    const all = await this.connections(ctx, channel);
    const healthy = all.filter(
      (c) => (HEALTHY as string[]).includes(c.status) && this.providers.has(c.provider),
    );
    const what = channel === 'EMAIL' ? 'an email provider' : 'an SMS provider';
    if (!all.length)
      return {
        channel,
        ready: false,
        reason: `Connect ${what} to ${channel === 'EMAIL' ? 'send emails' : 'send text messages'}`,
        route: 'INTEGRATIONS',
        senderCount: 0,
      };
    if (!healthy.length && all.some((c) => (HEALTHY as string[]).includes(c.status)))
      return {
        channel,
        ready: false,
        reason: `Sending through ${
          PROVIDER_NAMES[all[0]?.provider ?? ''] ?? 'this provider'
        } is not available yet`,
        route: 'INTEGRATIONS',
        senderCount: 0,
      };
    if (!healthy.length)
      return {
        channel,
        ready: false,
        reason: `Reconnect ${what}: the connection needs attention`,
        route: 'INTEGRATIONS',
        senderCount: 0,
      };
    return { channel, ready: true, reason: null, route: null, senderCount: healthy.length };
  }

  senders(tenant: TenantContext, userId: string): Promise<CommunicationSenderList> {
    return this.run(tenant, userId, async (ctx) => {
      const items: CommunicationSender[] = [];
      for (const channel of ['EMAIL', 'SMS'] as const) {
        const all = await this.connections(ctx, channel);
        all.forEach((c, i) => items.push(this.senderOf(c, channel, i === 0)));
      }
      return { items };
    });
  }

  announcementLocations(): AnnouncementLocationList {
    return { items: LOCATIONS };
  }

  // ---------- Shapes ----------

  private async stats(ctx: SegCtx, ids: string[]) {
    const out = new Map<string, Record<string, number>>();
    if (!ids.length) return out;
    const rows = await ctx.tx.communicationRecipient.groupBy({
      by: ['communicationId', 'status'],
      where: { businessId: ctx.businessId, communicationId: { in: ids } },
      _count: { _all: true },
    });
    for (const r of rows) {
      const m = out.get(r.communicationId) ?? {};
      m[r.status] = r._count._all;
      out.set(r.communicationId, m);
    }
    return out;
  }

  async rows(ctx: SegCtx, list: Row[]): Promise<CommunicationRow[]> {
    const [names, stats] = await Promise.all([
      memberNames(
        ctx.tx,
        ctx.businessId,
        list.map((c) => c.createdByUserId),
      ),
      this.stats(
        ctx,
        list.map((c) => c.id),
      ),
    ]);
    return list.map((c) => {
      const s = stats.get(c.id) ?? {};
      const sum = (...k: string[]) => k.reduce((n, key) => n + (s[key] ?? 0), 0);
      const sentLike = FROZEN_STATUSES.includes(c.status) && c.channel !== 'ANNOUNCEMENT';
      const delivered = sum('DELIVERED', 'OPENED', 'CLICKED', 'UNSUBSCRIBED');
      return {
        id: c.id,
        channel: c.channel,
        name: c.name,
        subject: c.subject,
        status: c.status,
        opens:
          c.status === 'DRAFT'
            ? ('COMPOSER' as const)
            : c.status === 'SCHEDULED'
              ? ('SCHEDULED_DETAIL' as const)
              : ('RESULTS' as const),
        audienceSummary:
          c.finalCount === null
            ? null
            : `${c.finalCount} recipient${c.finalCount === 1 ? '' : 's'}`,
        finalCount: c.finalCount,
        scheduledFor: iso(c.scheduledFor),
        sentAt: iso(c.sentAt),
        createdBy: memberRef(names, c.createdByUserId) ?? {
          userId: c.createdByUserId,
          name: 'Former member',
        },
        deliveredCount: sentLike ? delivered : null,
        failedCount: sentLike ? sum('BOUNCED', 'FAILED') : null,
        openRatePercent:
          sentLike && delivered > 0
            ? Math.round((sum('OPENED', 'CLICKED') / delivered) * 1000) / 10
            : null,
        publishStartsAt: iso(c.publishStartsAt),
        publishEndsAt: iso(c.publishEndsAt),
        sourceId: c.sourceCommunicationId,
        sourceKind: c.sourceKind,
        archived: c.archivedAt !== null,
        updatedAt: c.updatedAt.toISOString(),
      };
    });
  }

  private editable(c: Row, now = new Date()): boolean {
    if (c.status === 'DRAFT') return true;
    return (
      c.status === 'SCHEDULED' &&
      c.scheduledFor !== null &&
      c.scheduledFor.getTime() - LOCK_MS > now.getTime()
    );
  }

  /** The audience as the sent snapshot kept it. */
  private async frozenAudience(ctx: SegCtx, c: Row): Promise<AudienceSummary | null> {
    if (c.selectedCount === null) return null;
    const ex = (c.exclusionCounts ?? {}) as Record<string, number>;
    const entries = await ctx.tx.communicationAudienceEntry.findMany({
      where: { businessId: ctx.businessId, communicationId: c.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return {
      selectedCount: c.selectedCount,
      autoExcluded: {
        unsubscribed: ex.unsubscribed ?? 0,
        invalid: ex.invalid ?? 0,
        missingChannel: ex.missingChannel ?? 0,
        duplicate: ex.duplicate ?? 0,
        ineligible: ex.ineligible ?? 0,
      },
      manualExcludedCount: c.manualExcludedCount ?? 0,
      finalCount: c.finalCount ?? 0,
      chips: entries.map((e) => ({
        kind: e.kind as AudienceSummary['chips'][number]['kind'],
        id: (e.segmentId ?? e.clientId ?? e.leadId) as string,
        label: e.segmentName ?? 'Contact',
        count: null,
      })),
      calculatedAt: (c.startedAt ?? c.updatedAt).toISOString(),
    };
  }

  async detail(ctx: SegCtx, c: Row): Promise<CommunicationDetail> {
    const [row] = await this.rows(ctx, [c]);
    const [conn, template, custom] = await Promise.all([
      c.connectionId
        ? ctx.tx.integrationConnection.findFirst({
            where: { businessId: ctx.businessId, id: c.connectionId },
          })
        : null,
      c.templateId
        ? ctx.tx.messageTemplate.findFirst({
            where: { businessId: ctx.businessId, id: c.templateId },
            select: { id: true, name: true },
          })
        : null,
      ctx.tx.customMergeField.findMany({
        where: { businessId: ctx.businessId },
        select: { key: true, label: true },
      }),
    ]);
    const editable = this.editable(c);
    const used = fieldsIn(c.subject, c.previewText, c.body);
    const known = new Set(custom.flatMap((f) => [f.key.toLowerCase(), f.label.toLowerCase()]));
    const unknown = used.filter((f) => !builtIn(f) && !known.has(f.toLowerCase()));
    const audience = editable
      ? (await this.audience.compute(ctx, c)).summary
      : await this.frozenAudience(ctx, c);
    const attachments = (
      (c.attachments ?? []) as {
        id?: string;
        fileName: string;
        contentType: string;
        sizeBytes: number;
      }[]
    )
      .filter((a) => typeof a.id === 'string')
      .map((a) => ({
        id: a.id as string,
        fileName: a.fileName,
        contentType: a.contentType,
        sizeBytes: a.sizeBytes,
      }));
    return {
      ...(row as CommunicationRow),
      previewText: c.previewText,
      body: c.body,
      sender: conn ? this.senderOf(conn, c.channel, true) : null,
      replyTo: c.replyTo,
      template: template
        ? { id: template.id, name: template.name, version: c.templateVersion }
        : null,
      attachments,
      mergeFields: { used, unknown },
      sms: c.channel === 'SMS' ? smsLength(c.body) : null,
      audience,
      timezone: c.timezone ?? (await firmTimeZone(ctx.tx, ctx.businessId)),
      visibility: c.visibility,
      startedAt: iso(c.startedAt),
      cancelledAt: iso(c.cancelledAt),
      editable,
      lockedAt:
        c.status === 'SCHEDULED' && c.scheduledFor
          ? new Date(c.scheduledFor.getTime() - LOCK_MS).toISOString()
          : null,
      savedAt: c.updatedAt.toISOString(),
      canSend: ctx.perms.write && c.status === 'DRAFT',
      createdAt: c.createdAt.toISOString(),
      etag: c.updatedAt.toISOString(),
    };
  }

  // ---------- Overview and lists ----------

  overview(tenant: TenantContext, userId: string): Promise<CommunicationsOverview> {
    return this.run(tenant, userId, async (ctx) => {
      const base: Prisma.CommunicationWhereInput = {
        AND: [{ businessId: ctx.businessId, archivedAt: null }, this.visible(ctx)],
      };
      const since = new Date(Date.now() - 30 * 86_400_000);
      const [
        drafts,
        scheduled,
        sending,
        sentRows,
        failedRecipients,
        recent,
        soon,
        templates,
        segs,
      ] = await Promise.all([
        ctx.tx.communication.count({ where: { AND: [base, { status: 'DRAFT' }] } }),
        ctx.tx.communication.count({ where: { AND: [base, { status: 'SCHEDULED' }] } }),
        ctx.tx.communication.count({
          where: { AND: [base, { status: { in: ['SENDING', 'PAUSED'] } }] },
        }),
        ctx.tx.communication.findMany({
          where: { AND: [base, { status: 'SENT', sentAt: { gte: since } }] },
          select: { id: true, finalCount: true, channel: true },
        }),
        ctx.tx.communicationRecipient.count({
          where: {
            businessId: ctx.businessId,
            status: { in: ['FAILED', 'BOUNCED'] },
            communication: { AND: [base, { startedAt: { gte: since } }] },
          },
        }),
        ctx.tx.communication.findMany({
          where: { AND: [base, { status: { not: 'DRAFT' } }] },
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          take: 5,
        }),
        ctx.tx.communication.findMany({
          where: { AND: [base, { status: 'SCHEDULED' }] },
          orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }],
          take: 5,
        }),
        ctx.tx.messageTemplate.findMany({
          where: {
            businessId: ctx.businessId,
            status: 'ACTIVE',
            archivedAt: null,
            kind: { in: ['EMAIL', 'SMS', 'ANNOUNCEMENT'] },
            OR: [{ access: { not: 'PRIVATE' } }, { ownerUserId: ctx.userId }],
          },
          select: { id: true, name: true, kind: true, category: { select: { name: true } } },
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          take: 5,
        }),
        ctx.tx.communicationSegment.aggregate({
          where: { businessId: ctx.businessId, archivedAt: null },
          _count: { _all: true },
          _sum: { memberCount: true },
        }),
      ]);
      const stats = await this.stats(
        ctx,
        sentRows.map((r) => r.id),
      );
      const tot: Record<string, number> = {};
      for (const s of stats.values())
        for (const [k, v] of Object.entries(s)) tot[k] = (tot[k] ?? 0) + v;
      const delivered =
        (tot.DELIVERED ?? 0) + (tot.OPENED ?? 0) + (tot.CLICKED ?? 0) + (tot.UNSUBSCRIBED ?? 0);
      const bad = (tot.FAILED ?? 0) + (tot.BOUNCED ?? 0);
      const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
      const channels = await Promise.all(
        (['EMAIL', 'SMS', 'ANNOUNCEMENT'] as const).map((ch) => this.readiness(ctx, ch)),
      );
      return {
        kpis: {
          drafts,
          scheduled,
          sending,
          sent: sentRows.length,
          recipientsReached: sentRows.reduce((n, r) => n + (r.finalCount ?? 0), 0),
          deliveryRatePercent: pct(delivered, delivered + bad),
          openRatePercent: pct((tot.OPENED ?? 0) + (tot.CLICKED ?? 0), delivered),
          clickRatePercent: pct(tot.CLICKED ?? 0, delivered),
          failed: failedRecipients,
        },
        channels,
        recent: await this.rows(ctx, recent),
        scheduled: await this.rows(ctx, soon),
        templates: templates.map((t) => ({
          id: t.id,
          name: t.name,
          kind: t.kind,
          category: t.category?.name ?? null,
        })),
        segments: { total: segs._count._all, totalMembers: segs._sum.memberCount ?? 0 },
        canCreate: ctx.perms.create,
        canSend: ctx.perms.write,
        canExport: ctx.perms.exportResults,
        canManageSegments: ctx.perms.write,
      };
    });
  }

  list(
    tenant: TenantContext,
    userId: string,
    q: Out<typeof CommunicationsQ>,
  ): Promise<CommunicationPage> {
    return this.run(tenant, userId, async (ctx) => {
      const tab: Prisma.CommunicationWhereInput =
        q.tab === 'announcements'
          ? { channel: 'ANNOUNCEMENT' }
          : q.tab === 'scheduled'
            ? { status: 'SCHEDULED' }
            : q.tab === 'sent'
              ? { status: { in: ['SENT', 'FAILED', 'CANCELLED'] } }
              : q.tab === 'drafts'
                ? { status: 'DRAFT', createdByUserId: ctx.userId }
                : { channel: { in: ['EMAIL', 'SMS'] } };
      const where: Prisma.CommunicationWhereInput = {
        AND: [
          { businessId: ctx.businessId, archivedAt: q.archived ? { not: null } : null },
          this.visible(ctx),
          tab,
          ...(q.channel ? [{ channel: q.channel }] : []),
          ...(q.status ? [{ status: q.status }] : []),
          ...(q.createdByUserId ? [{ createdByUserId: q.createdByUserId }] : []),
          ...(q.from ? [{ createdAt: { gte: new Date(`${q.from}T00:00:00Z`) } }] : []),
          ...(q.to
            ? [{ createdAt: { lt: new Date(Date.parse(`${q.to}T00:00:00Z`) + 86_400_000) } }]
            : []),
          ...(q.search
            ? [
                {
                  OR: [
                    { name: { contains: q.search, mode: 'insensitive' as const } },
                    { subject: { contains: q.search, mode: 'insensitive' as const } },
                  ],
                },
              ]
            : []),
        ],
      };
      const orderBy: Prisma.CommunicationOrderByWithRelationInput[] =
        q.tab === 'scheduled' || q.sort === 'scheduled'
          ? [{ scheduledFor: 'asc' }, { id: 'asc' }]
          : q.sort === 'oldest'
            ? [{ createdAt: 'asc' }, { id: 'asc' }]
            : q.sort === 'name'
              ? [{ name: 'asc' }, { id: 'asc' }]
              : q.sort === 'performance'
                ? [{ finalCount: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }]
                : [{ createdAt: 'desc' }, { id: 'desc' }];
      const [total, found] = await Promise.all([
        ctx.tx.communication.count({ where }),
        ctx.tx.communication.findMany({
          where,
          orderBy,
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      return { items: await this.rows(ctx, found), total, page: q.page, pageSize: q.pageSize };
    });
  }

  get(tenant: TenantContext, userId: string, id: string): Promise<CommunicationDetail> {
    return this.run(tenant, userId, async (ctx) => this.detail(ctx, await this.load(ctx, id)));
  }

  // ---------- The draft ----------

  create(
    tenant: TenantContext,
    userId: string,
    body: Out<typeof CreateCommunicationBody>,
  ): Promise<CommunicationDetail> {
    return this.run(tenant, userId, async (ctx) => {
      this.requireWrite(ctx);
      const snapshot = body.templateId
        ? await this.snapshotOf(ctx, body.channel, body.templateId)
        : {};
      const ready = await this.readiness(ctx, body.channel);
      if (!ready.ready)
        throw refuse('CHANNEL_UNAVAILABLE', ready.reason ?? 'This channel is not ready', {
          route: ready.route,
        });
      const [first] = await this.connections(ctx, body.channel);
      const healthy = first && this.usable(first) ? first : null;
      const made = await ctx.tx.communication.create({
        data: {
          businessId: ctx.businessId,
          channel: body.channel,
          name:
            body.name ??
            (body.channel === 'EMAIL'
              ? 'Untitled email'
              : body.channel === 'SMS'
                ? 'Untitled text message'
                : 'Untitled announcement'),
          createdByUserId: ctx.userId,
          updatedByUserId: ctx.userId,
          connectionId: healthy?.id ?? null,
          fromName: healthy ? (healthy.accountLabel ?? null) : null,
          timezone: await firmTimeZone(ctx.tx, ctx.businessId),
          ...snapshot,
        },
      });
      await this.audit.logIn(
        ctx.tx,
        'communication.created',
        { type: 'communication', id: made.id },
        {
          communicationId: made.id,
          channel: made.channel,
          fromTemplate: body.templateId !== undefined,
        },
      );
      return this.detail(ctx, made);
    });
  }

  cleanBody(channel: CommunicationChannel, text: string): string {
    return channel === 'SMS' ? stripTags(text) : sanitize(text).html;
  }

  update(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof UpdateCommunicationBody>,
  ): Promise<CommunicationDetail> {
    return this.run(tenant, userId, async (ctx) => {
      this.requireWrite(ctx);
      const c = await this.lock(ctx, id, body.etag);
      this.assertEditable(c);
      const channel = body.channel ?? c.channel;
      const data: Prisma.CommunicationUncheckedUpdateInput = { updatedByUserId: ctx.userId };
      let next = {
        subject: c.subject,
        previewText: c.previewText,
        replyTo: c.replyTo,
        body: c.body,
      };
      if (channel !== c.channel) {
        const ready = await this.readiness(ctx, channel);
        if (!ready.ready)
          throw refuse('CHANNEL_UNAVAILABLE', ready.reason ?? 'This channel is not ready', {
            route: ready.route,
          });
        const attachments = ((c.attachments ?? []) as unknown[]).length;
        const lost: string[] = [];
        if (channel === 'SMS') {
          if (c.subject) lost.push('subject');
          if (c.previewText) lost.push('previewText');
          if (c.replyTo) lost.push('replyTo');
          if (attachments) lost.push('attachments');
          if (/<[a-z][^>]*>/i.test(c.body)) lost.push('formatting');
        } else if (channel === 'ANNOUNCEMENT') {
          if (c.previewText) lost.push('previewText');
          if (c.replyTo) lost.push('replyTo');
        }
        if (lost.length && !body.confirmStripContent)
          throw refuse('CONTENT_WOULD_BE_LOST', 'Changing the channel would drop content', {
            fields: lost,
          });
        data.channel = channel;
        data.connectionId = null;
        data.fromName = null;
        if (channel === 'SMS') {
          next = { subject: null, previewText: null, replyTo: null, body: stripTags(c.body) };
          data.attachments = [];
        } else if (channel === 'ANNOUNCEMENT') {
          next = { ...next, previewText: null, replyTo: null };
        }
        if (channel !== 'ANNOUNCEMENT') {
          data.publishStartsAt = null;
          data.publishEndsAt = null;
          data.visibility = null;
        }
        if (channel !== 'SMS' && c.channel === 'SMS') data.subject = null;
        const [first] = await this.connections(ctx, channel);
        if (first && this.usable(first)) {
          data.connectionId = first.id;
          data.fromName = first.accountLabel ?? null;
        }
      }
      if (
        channel !== 'EMAIL' &&
        (body.previewText != null || (channel === 'SMS' && body.replyTo != null))
      )
        throw comErrors.invalid('previewText', 'This field is not used on this channel');
      if (channel === 'SMS' && body.subject != null)
        throw comErrors.invalid('subject', 'A text message has no subject');
      if (channel !== 'ANNOUNCEMENT') {
        for (const f of ['publishStartsAt', 'publishEndsAt', 'visibility'] as const)
          if (body[f] != null) throw comErrors.invalid(f, 'Only an announcement has this');
      }
      if (channel === 'ANNOUNCEMENT' && body.replyTo != null)
        throw comErrors.invalid('replyTo', 'An announcement has no reply address');
      if (body.name !== undefined) data.name = body.name;
      if (body.subject !== undefined) next.subject = body.subject;
      if (body.previewText !== undefined) next.previewText = body.previewText;
      if (body.replyTo !== undefined) next.replyTo = body.replyTo;
      if (body.body !== undefined) next.body = this.cleanBody(channel, body.body);
      data.subject = next.subject;
      data.previewText = next.previewText;
      data.replyTo = next.replyTo;
      data.body = next.body;
      if (body.senderId !== undefined) {
        if (body.senderId === null) {
          data.connectionId = null;
          data.fromName = null;
        } else {
          const conn = await ctx.tx.integrationConnection.findFirst({
            where: {
              businessId: ctx.businessId,
              id: body.senderId,
              provider: {
                in:
                  channel === 'ANNOUNCEMENT'
                    ? []
                    : CHANNEL_PROVIDERS[channel].filter((x) => this.providers.has(x)),
              },
              status: { in: HEALTHY },
            },
          });
          if (!conn)
            throw comErrors.invalid('senderId', 'This is not a verified sender of the channel');
          data.connectionId = conn.id;
          data.fromName = conn.accountLabel ?? null;
        }
      }
      const starts =
        body.publishStartsAt === undefined
          ? c.publishStartsAt
          : body.publishStartsAt === null
            ? null
            : new Date(body.publishStartsAt);
      const ends =
        body.publishEndsAt === undefined
          ? c.publishEndsAt
          : body.publishEndsAt === null
            ? null
            : new Date(body.publishEndsAt);
      if (starts && ends && ends <= starts)
        throw comErrors.invalid('publishEndsAt', 'The end must be after the start');
      if (body.publishStartsAt !== undefined) data.publishStartsAt = starts;
      if (body.publishEndsAt !== undefined) data.publishEndsAt = ends;
      if (body.visibility !== undefined) data.visibility = body.visibility;
      const saved = await ctx.tx.communication.update({ where: { id: c.id }, data });
      await this.audit.logIn(
        ctx.tx,
        'communication.updated',
        { type: 'communication', id: c.id },
        {
          communicationId: c.id,
          fields: Object.keys(body).filter((k) => k !== 'etag' && k !== 'confirmStripContent'),
        },
      );
      return this.detail(ctx, saved);
    });
  }

  /** The content a template gives a draft: a snapshot, never a link (the master is not changed by it). */
  async snapshotOf(
    ctx: SegCtx,
    channel: CommunicationChannel,
    templateId: string,
  ): Promise<{
    templateId: string;
    templateVersion: number;
    subject: string | null;
    previewText: string | null;
    body: string;
  }> {
    const t = await ctx.tx.messageTemplate.findFirst({
      where: { businessId: ctx.businessId, id: templateId },
    });
    if (!t)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'This template was not found' });
    const mine = t.access !== 'PRIVATE' || t.ownerUserId === ctx.userId || ctx.perms.admin;
    if (t.kind !== channel || t.status !== 'ACTIVE' || t.archivedAt !== null || !mine)
      throw refuse('TEMPLATE_NOT_ALLOWED', 'This template cannot be used for this channel');
    return {
      templateId: t.id,
      templateVersion: t.version,
      subject: channel === 'SMS' ? null : t.subject,
      previewText: channel === 'EMAIL' ? t.previewText : null,
      body: this.cleanBody(channel, t.body),
    };
  }

  useTemplate(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: { templateId: string; etag: string },
  ): Promise<CommunicationDetail> {
    return this.run(tenant, userId, async (ctx) => {
      this.requireWrite(ctx);
      const c = await this.lock(ctx, id, body.etag);
      this.assertEditable(c);
      const snap = await this.snapshotOf(ctx, c.channel, body.templateId);
      const saved = await ctx.tx.communication.update({
        where: { id: c.id },
        data: { ...snap, updatedByUserId: ctx.userId },
      });
      await this.audit.logIn(
        ctx.tx,
        'communication.template_used',
        { type: 'communication', id: c.id },
        {
          communicationId: c.id,
          templateId: snap.templateId,
          templateVersion: snap.templateVersion,
        },
      );
      return this.detail(ctx, saved);
    });
  }

  /** The message as one person (or made-up data) would get it. Nothing is sent or recorded. */
  preview(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: { clientId?: string; leadId?: string },
  ): Promise<RenderedTemplate> {
    return this.run(tenant, userId, async (ctx) => {
      const c = await this.load(ctx, id);
      let person: Person | null = null;
      // Both are looked up when both are named, so a stranger's id is never ignored.
      if (body.leadId && body.clientId) {
        const l = await ctx.tx.lead.findFirst({
          where: { AND: [this.segments.leadReach(ctx), { id: body.leadId }] },
          select: { id: true },
        });
        if (!l) throw notFound();
      }
      if (body.clientId) {
        const r = await ctx.tx.client.findFirst({
          where: { AND: [this.segments.clientReach(ctx), { id: body.clientId }] },
          select: { id: true, displayName: true, email: true, phone: true },
        });
        if (!r) throw notFound();
        person = { kind: 'CLIENT', id: r.id, name: r.displayName, email: r.email, phone: r.phone };
      } else if (body.leadId) {
        const r = await ctx.tx.lead.findFirst({
          where: { AND: [this.segments.leadReach(ctx), { id: body.leadId }] },
          select: { id: true, firstName: true, lastName: true, email: true, phone: true },
        });
        if (!r) throw notFound();
        person = {
          kind: 'LEAD',
          id: r.id,
          name: `${r.firstName} ${r.lastName}`,
          email: r.email,
          phone: r.phone,
        };
      }
      const [business, custom] = await Promise.all([
        ctx.tx.business.findUnique({ where: { id: ctx.businessId }, select: { name: true } }),
        ctx.tx.customMergeField.findMany({
          where: { businessId: ctx.businessId },
          select: { key: true, label: true, fallback: true },
        }),
      ]);
      const own = this.valuesFor(person, business?.name ?? '', custom);
      const examples = new Map(BUILT_IN_FIELDS.map((f) => [f.key.toLowerCase(), f.example]));
      // A real person's own fields win; what we cannot know yet stays as its [token].
      const values = person ? own : new Map([...examples, ...own]);
      const mode = c.channel === 'SMS' ? 'text' : 'html';
      const text = fill(c.body, values, mode);
      const subject = c.subject ? fill(c.subject, values, 'text') : null;
      const preview = c.previewText ? fill(c.previewText, values, 'text') : null;
      return {
        subject: subject?.text ?? null,
        previewText: preview?.text ?? null,
        body: text.text,
        unresolved: [
          ...new Set([
            ...text.unresolved,
            ...(subject?.unresolved ?? []),
            ...(preview?.unresolved ?? []),
          ]),
        ],
        sample: person === null,
        sms: c.channel === 'SMS' ? smsLength(text.text) : null,
      };
    });
  }

  assertEditable(c: Row) {
    if (c.status === 'DRAFT') return;
    if (c.status === 'SCHEDULED') {
      if (!this.editable(c))
        throw refuse('LOCKED', 'This campaign is about to go out and can no longer be changed');
      return;
    }
    throw refuse('NOT_EDITABLE', 'This communication has gone out and cannot be changed');
  }

  setArchived(
    tenant: TenantContext,
    userId: string,
    id: string,
    archived: boolean,
  ): Promise<CommunicationDetail> {
    return this.run(tenant, userId, async (ctx) => {
      this.requireWrite(ctx);
      const c = await this.lock(ctx, id);
      if (archived && ['SENDING', 'PAUSED', 'SCHEDULED'].includes(c.status))
        throw refuse('NOT_EDITABLE', 'Cancel it before archiving');
      const saved =
        (c.archivedAt !== null) === archived
          ? c
          : await ctx.tx.communication.update({
              where: { id: c.id },
              data: { archivedAt: archived ? new Date() : null },
            });
      if (saved !== c)
        await this.audit.logIn(
          ctx.tx,
          archived ? 'communication.archived' : 'communication.restored',
          { type: 'communication', id: c.id },
          { communicationId: c.id },
        );
      return this.detail(ctx, saved);
    });
  }

  /** A NEW draft from the content of an existing campaign (the original never changes). */
  duplicate(tenant: TenantContext, userId: string, id: string): Promise<CommunicationDetail> {
    return this.run(tenant, userId, async (ctx) => {
      this.requireWrite(ctx);
      const c = await this.load(ctx, id);
      const ready = await this.readiness(ctx, c.channel);
      if (!ready.ready)
        throw refuse('CHANNEL_UNAVAILABLE', ready.reason ?? 'This channel is not ready', {
          route: ready.route,
        });
      const made = await ctx.tx.communication.create({
        data: {
          businessId: ctx.businessId,
          channel: c.channel,
          name: `${c.name} (copy)`.slice(0, 200),
          subject: c.subject,
          previewText: c.previewText,
          body: c.body,
          replyTo: c.replyTo,
          fromName: c.fromName,
          connectionId: c.connectionId,
          templateId: c.templateId,
          templateVersion: c.templateVersion,
          publishStartsAt: null,
          publishEndsAt: null,
          visibility: c.visibility,
          timezone: c.timezone,
          sourceCommunicationId: c.id,
          sourceKind: 'DUPLICATE',
          createdByUserId: ctx.userId,
          updatedByUserId: ctx.userId,
        },
      });
      await this.copyAudience(ctx, c.id, made.id);
      await this.audit.logIn(
        ctx.tx,
        'communication.duplicated',
        { type: 'communication', id: made.id },
        { communicationId: made.id, sourceId: c.id },
      );
      return this.detail(ctx, made);
    });
  }

  async copyAudience(ctx: SegCtx, fromId: string, toId: string) {
    const entries = await ctx.tx.communicationAudienceEntry.findMany({
      where: { businessId: ctx.businessId, communicationId: fromId },
    });
    if (!entries.length) return;
    await ctx.tx.communicationAudienceEntry.createMany({
      data: entries.map((e) => ({
        businessId: ctx.businessId,
        communicationId: toId,
        kind: e.kind,
        segmentId: e.segmentId,
        clientId: e.clientId,
        leadId: e.leadId,
        segmentName: e.segmentName,
      })),
    });
  }

  // ---------- Audience ----------

  candidates(
    tenant: TenantContext,
    userId: string,
    q: Out<typeof AudienceCandidatesQ>,
  ): Promise<AudienceCandidatePage> {
    return this.run(tenant, userId, async (ctx) => {
      const c = await this.load(ctx, q.communicationId);
      return this.audience.candidates(ctx, c.channel, q);
    });
  }

  selectAll(
    tenant: TenantContext,
    userId: string,
    q: Out<typeof SelectAllAudienceBody>,
  ): Promise<SelectAllAudienceResult> {
    return this.run(tenant, userId, async (ctx) => {
      const c = await this.load(ctx, q.communicationId);
      return this.audience.selectAll(ctx, c.channel, q);
    });
  }

  audienceOf(tenant: TenantContext, userId: string, id: string): Promise<AudienceSummary> {
    return this.run(tenant, userId, async (ctx) => {
      const c = await this.load(ctx, id);
      if (!this.editable(c)) {
        const frozen = await this.frozenAudience(ctx, c);
        if (frozen) return frozen;
      }
      return (await this.audience.compute(ctx, c)).summary;
    });
  }

  setAudience(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof SetAudienceBody>,
  ): Promise<AudienceSummary> {
    return this.run(tenant, userId, async (ctx) => {
      this.requireWrite(ctx);
      const c = await this.lock(ctx, id, body.etag);
      this.assertEditable(c);
      const segs = body.segmentIds.length
        ? await ctx.tx.communicationSegment.findMany({
            where: { businessId: ctx.businessId, id: { in: body.segmentIds }, archivedAt: null },
            select: { id: true, name: true },
          })
        : [];
      const segNames = new Map(segs.map((s) => [s.id, s.name]));
      const badSeg = body.segmentIds.findIndex((s) => !segNames.has(s));
      if (badSeg >= 0)
        throw comErrors.invalid(`segmentIds[${badSeg}]`, 'This segment was not found');
      const named = [...body.clientIds, ...body.excludeClientIds];
      const namedLeads = [...body.leadIds, ...body.excludeLeadIds];
      const [okClients, okLeads] = await Promise.all([
        named.length
          ? ctx.tx.client.findMany({
              where: { AND: [this.segments.clientReach(ctx), { id: { in: named } }] },
              select: { id: true },
            })
          : [],
        namedLeads.length
          ? ctx.tx.lead.findMany({
              where: { AND: [this.segments.leadReach(ctx), { id: { in: namedLeads } }] },
              select: { id: true },
            })
          : [],
      ]);
      const cSet = new Set(okClients.map((x) => x.id));
      const lSet = new Set(okLeads.map((x) => x.id));
      const check = (ids: string[], set: Set<string>, path: string, what: string) => {
        const i = ids.findIndex((x) => !set.has(x));
        if (i >= 0) throw comErrors.invalid(`${path}[${i}]`, `This ${what} was not found`);
      };
      check(body.clientIds, cSet, 'clientIds', 'client');
      check(body.excludeClientIds, cSet, 'excludeClientIds', 'client');
      check(body.leadIds, lSet, 'leadIds', 'lead');
      check(body.excludeLeadIds, lSet, 'excludeLeadIds', 'lead');
      const uniq = (a: string[]) => [...new Set(a)];
      await ctx.tx.communicationAudienceEntry.deleteMany({
        where: { businessId: ctx.businessId, communicationId: c.id },
      });
      const base = { businessId: ctx.businessId, communicationId: c.id };
      await ctx.tx.communicationAudienceEntry.createMany({
        data: [
          ...uniq(body.segmentIds).map((segmentId) => ({
            ...base,
            kind: 'SEGMENT' as const,
            segmentId,
            segmentName: segNames.get(segmentId) ?? null,
          })),
          ...uniq(body.clientIds).map((clientId) => ({
            ...base,
            kind: 'CLIENT' as const,
            clientId,
          })),
          ...uniq(body.leadIds).map((leadId) => ({ ...base, kind: 'LEAD' as const, leadId })),
          ...uniq(body.excludeClientIds).map((clientId) => ({
            ...base,
            kind: 'EXCLUDE_CLIENT' as const,
            clientId,
          })),
          ...uniq(body.excludeLeadIds).map((leadId) => ({
            ...base,
            kind: 'EXCLUDE_LEAD' as const,
            leadId,
          })),
        ],
      });
      await this.audit.logIn(
        ctx.tx,
        'communication.audience_set',
        { type: 'communication', id: c.id },
        {
          communicationId: c.id,
          segments: body.segmentIds.length,
          clients: body.clientIds.length,
          leads: body.leadIds.length,
          excluded: body.excludeClientIds.length + body.excludeLeadIds.length,
        },
      );
      return (await this.audience.compute(ctx, c)).summary;
    });
  }

  // ---------- Review ----------

  /** The values a person gives to the merge fields. */
  valuesFor(
    p: Person | null,
    firmName: string,
    custom: { key: string; label: string; fallback: string | null }[],
  ): Map<string, string> {
    const m = new Map<string, string>();
    for (const f of custom) if (f.fallback) m.set(f.label.toLowerCase(), f.fallback);
    m.set('business name', firmName);
    if (p) {
      const [first = '', ...rest] = p.name.split(' ');
      m.set('client first name', first);
      m.set('client last name', rest.join(' '));
      m.set('client full name', p.name);
      if (p.email) m.set('email address', p.email);
      if (p.phone) m.set('phone number', p.phone);
    }
    return m;
  }

  private async checks(
    ctx: SegCtx,
    c: Row,
    audience: Awaited<ReturnType<CommunicationAudienceService['compute']>>,
  ) {
    const checks: SendCheck[] = [];
    const block = (code: SendCheck['code'], message: string) =>
      checks.push({ code, severity: 'BLOCK', message });
    const ready = await this.readiness(ctx, c.channel);
    if (!ready.ready) block('CHANNEL_UNAVAILABLE', ready.reason ?? 'This channel is not ready');
    let conn: Prisma.IntegrationConnectionGetPayload<object> | null = null;
    if (c.channel !== 'ANNOUNCEMENT') {
      conn = c.connectionId
        ? await ctx.tx.integrationConnection.findFirst({
            where: { businessId: ctx.businessId, id: c.connectionId },
          })
        : null;
      if (!conn) block('SENDER_NOT_VERIFIED', 'Choose a verified sender');
      else if (!(HEALTHY as string[]).includes(conn.status))
        block('PROVIDER_UNHEALTHY', 'The provider needs attention. Reconnect it in Integrations');
      else if (!this.providers.has(conn.provider))
        block('SENDER_NOT_VERIFIED', 'Sending through this provider is not available yet');
    }
    if (audience.summary.finalCount === 0)
      block('NO_RECIPIENTS', 'No one is eligible to receive this');
    if (c.channel !== 'SMS' && !c.subject?.trim())
      block('MISSING_SUBJECT', c.channel === 'EMAIL' ? 'Add a subject' : 'Add a title');
    if (!c.body.trim()) block('EMPTY_BODY', 'Write a message');
    const custom = await ctx.tx.customMergeField.findMany({
      where: { businessId: ctx.businessId },
      select: { key: true, label: true, fallback: true },
    });
    const known = new Set(custom.flatMap((f) => [f.key.toLowerCase(), f.label.toLowerCase()]));
    const used = fieldsIn(c.subject, c.previewText, c.body);
    const unknown = used.filter((f) => !builtIn(f) && !known.has(f.toLowerCase()));
    if (unknown.length)
      block('UNKNOWN_FIELDS', `Unknown merge fields: ${unknown.map((u) => `[${u}]`).join(', ')}`);
    const business = await ctx.tx.business.findUnique({
      where: { id: ctx.businessId },
      select: { name: true },
    });
    const first = audience.eligible[0] ?? null;
    const values = this.valuesFor(first, business?.name ?? '', custom);
    const unresolved = used.filter((f) => !unknown.includes(f) && !values.has(f.toLowerCase()));
    if (unresolved.length)
      checks.push({
        code: 'UNRESOLVED_FIELDS',
        severity: 'WARN',
        message: `No value yet for ${unresolved.map((u) => `[${u}]`).join(', ')}; they stay as written`,
      });
    if (c.status === 'SCHEDULED' && c.scheduledFor && c.scheduledFor.getTime() <= Date.now())
      block('SCHEDULE_IN_PAST', 'The schedule time has passed');
    if (c.channel === 'ANNOUNCEMENT') {
      if (c.publishStartsAt && c.publishEndsAt && c.publishEndsAt <= c.publishStartsAt)
        block('ANNOUNCEMENT_WINDOW_INVALID', 'The end must be after the start');
      else if (c.publishEndsAt && c.publishEndsAt.getTime() <= Date.now())
        block('ANNOUNCEMENT_WINDOW_INVALID', 'The publish window has already ended');
    }
    if (c.channel !== 'ANNOUNCEMENT')
      checks.push({
        code: 'CONSENT_CHECKED',
        severity: 'OK',
        message: 'Consent and suppression are checked again when it goes out',
      });
    return { checks, conn, values, custom };
  }

  review(tenant: TenantContext, userId: string, id: string): Promise<CommunicationReview> {
    return this.run(tenant, userId, async (ctx) => {
      const c = await this.load(ctx, id);
      const audience = await this.audience.compute(ctx, c);
      const { checks, conn, values } = await this.checks(ctx, c, audience);
      const examples = new Map(BUILT_IN_FIELDS.map((f) => [f.key.toLowerCase(), f.example]));
      const merged = new Map([...examples, ...values]);
      const mode = c.channel === 'SMS' ? 'text' : 'html';
      const body = fill(c.body, merged, mode);
      const subject = c.subject ? fill(c.subject, merged, 'text') : null;
      const sender = conn ? this.senderOf(conn, c.channel, true) : null;
      const ready = await this.readiness(ctx, c.channel);
      return {
        channel: c.channel,
        audience: audience.summary,
        sender,
        subject: c.subject,
        preview: {
          subject: subject?.text ?? null,
          body: body.text,
          unresolved: [...new Set([...body.unresolved, ...(subject?.unresolved ?? [])])],
        },
        timing: {
          mode: c.status === 'SCHEDULED' ? 'SCHEDULED' : 'NOW',
          scheduledFor: iso(c.scheduledFor),
          timezone: c.timezone ?? (await firmTimeZone(ctx.tx, ctx.businessId)),
        },
        integration: {
          provider: conn ? (PROVIDER_NAMES[conn.provider] ?? conn.provider) : null,
          healthy: conn
            ? (HEALTHY as string[]).includes(conn.status)
            : c.channel === 'ANNOUNCEMENT',
          route:
            ready.route ??
            (conn && !(HEALTHY as string[]).includes(conn.status) ? 'INTEGRATIONS' : null),
        },
        checks,
        canSend: !checks.some((k) => k.severity === 'BLOCK'),
      };
    });
  }

  // ---------- Send, schedule, cancel ----------

  /** Freezes the audience and the content: the recipients are recorded and delivery can begin. */
  private async freeze(
    ctx: SegCtx,
    c: Row,
    audience: Awaited<ReturnType<CommunicationAudienceService['compute']>>,
    data: Prisma.CommunicationUncheckedUpdateInput,
  ): Promise<Row> {
    const s = audience.summary;
    const counts = {
      unsubscribed: s.autoExcluded.unsubscribed,
      invalid: s.autoExcluded.invalid,
      missingChannel: s.autoExcluded.missingChannel,
      duplicate: s.autoExcluded.duplicate,
      ineligible: s.autoExcluded.ineligible,
    };
    const autoTotal = Object.values(counts).reduce((a, b) => a + b, 0);
    return ctx.tx.communication.update({
      where: { id: c.id },
      data: {
        selectedCount: s.selectedCount,
        autoExcludedCount: autoTotal,
        manualExcludedCount: s.manualExcludedCount,
        finalCount: s.finalCount,
        exclusionCounts: counts,
        ...data,
      },
    });
  }

  private async record(
    ctx: SegCtx,
    c: Row,
    audience: Awaited<ReturnType<CommunicationAudienceService['compute']>>,
  ) {
    const failure: Record<string, string> = {
      UNSUBSCRIBED: 'unsubscribed',
      INVALID: 'invalid_address',
      MISSING_CHANNEL: 'missing_address',
      NO_CONSENT: 'no_consent',
      DUPLICATE: 'duplicate',
    };
    const channel = c.channel;
    const pick = (p: Person) => ({
      businessId: ctx.businessId,
      communicationId: c.id,
      ...(p.kind === 'CLIENT' ? { clientId: p.id } : { leadId: p.id }),
    });
    const now = new Date();
    await ctx.tx.communicationRecipient.createMany({
      data: [
        ...audience.eligible.map((p) => ({
          ...pick(p),
          // An announcement is shown in the portal at once: nothing is delivered through a provider.
          status: channel === 'ANNOUNCEMENT' ? ('DELIVERED' as const) : ('QUEUED' as const),
          addressMask: mask(addressOf(p, channel)) || '***-portal',
          ...(channel === 'ANNOUNCEMENT' ? { sentAt: now, deliveredAt: now } : {}),
        })),
        ...audience.excluded.map((x) => ({
          ...pick(x.person),
          status: 'NOT_SENT' as const,
          addressMask: mask(addressOf(x.person, channel)) || '***',
          failureCode: failure[x.reason],
        })),
      ],
      skipDuplicates: true,
    });
    const entries = await ctx.tx.communicationAudienceEntry.findMany({
      where: { businessId: ctx.businessId, communicationId: c.id, kind: 'SEGMENT' },
    });
    for (const e of entries) {
      const seg = e.segmentId ? await this.segments.peopleOf(ctx, e.segmentId) : null;
      await ctx.tx.communicationAudienceEntry.update({
        where: { id: e.id },
        data: {
          segmentName: seg?.name ?? e.segmentName,
          criteriaSnapshot: (seg?.criteria ?? {}) as Prisma.InputJsonValue,
        },
      });
    }
    if (audience.eligible.length && channel !== 'ANNOUNCEMENT')
      await ctx.tx.communicationEvent.create({
        data: {
          businessId: ctx.businessId,
          communicationId: c.id,
          type: 'QUEUED',
          occurredAt: now,
          detailCode: 'queued',
        },
      });
  }

  /** The campaign a retry of this send names, if it was already made. */
  private async seen(ctx: SegCtx, key: string, id: string): Promise<Row | null> {
    const found = await ctx.tx.communication.findFirst({
      where: { businessId: ctx.businessId, idempotencyKey: key },
    });
    if (!found) return null;
    if (found.id !== id)
      throw refuse('NOT_READY', 'This request key was used for another communication');
    return found;
  }

  private async gate(
    ctx: SegCtx,
    c: Row,
    expected: number | undefined,
  ): Promise<Awaited<ReturnType<CommunicationAudienceService['compute']>>> {
    const audience = await this.audience.compute(ctx, c);
    const { checks } = await this.checks(ctx, c, audience);
    const blocking = checks.filter((k) => k.severity === 'BLOCK');
    if (blocking.length) throw refuse('NOT_READY', 'This cannot go out yet', blocking);
    if (expected !== undefined && expected !== audience.summary.finalCount)
      throw refuse('AUDIENCE_CHANGED', 'The number of recipients changed', {
        finalCount: audience.summary.finalCount,
      });
    return audience;
  }

  send(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof SendBody>,
  ): Promise<CommunicationDetail> {
    return this.run(tenant, userId, async (ctx) => {
      this.requireWrite(ctx);
      const c = await this.lock(ctx, id);
      const again = await this.seen(ctx, body.idempotencyKey, id);
      if (again && again.status !== 'DRAFT') return this.detail(ctx, again);
      if (c.status !== 'DRAFT' && c.status !== 'SCHEDULED')
        throw refuse('NOT_EDITABLE', 'This communication has already gone out');
      if (c.updatedAt.toISOString() !== body.etag) throw comErrors.saveConflict();
      if (c.status === 'SCHEDULED' && !this.editable(c))
        throw refuse('LOCKED', 'This campaign is about to go out on its own');
      const audience = await this.gate(ctx, c, body.expectedFinalCount);
      const saved = await this.launch(ctx, c, audience, body.idempotencyKey);
      return this.detail(ctx, saved);
    });
  }

  /** Freezes the campaign and starts it: recipients recorded, and for an announcement, published. */
  private async launch(
    ctx: SegCtx,
    c: Row,
    audience: Awaited<ReturnType<CommunicationAudienceService['compute']>>,
    idempotencyKey: string | null,
    actor: 'user' | 'job' = 'user',
  ): Promise<Row> {
    const now = new Date();
    const announce = c.channel === 'ANNOUNCEMENT';
    let saved = await this.freeze(ctx, c, audience, {
      status: 'SENDING',
      startedAt: now,
      scheduledFor: null,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      timezone: c.timezone ?? (await firmTimeZone(ctx.tx, ctx.businessId)),
      body: c.body,
      updatedByUserId: ctx.userId,
      ...(announce && !c.publishStartsAt ? { publishStartsAt: now } : {}),
    });
    await this.record(ctx, c, audience);
    // An announcement is published at once: there is no provider to wait for.
    if (announce)
      saved = await ctx.tx.communication.update({
        where: { id: c.id },
        data: { status: 'SENT', sentAt: now },
      });
    await this.audit.logIn(
      ctx.tx,
      'communication.sent',
      { type: 'communication', id: c.id },
      {
        communicationId: c.id,
        channel: c.channel,
        finalCount: audience.summary.finalCount,
        scheduled: c.status === 'SCHEDULED',
        actor,
      },
      { businessId: ctx.businessId },
    );
    return saved;
  }

  /** The context a background step runs in: the person who made the campaign, with their reach. */
  async jobCtx(tx: SegCtx['tx'], businessId: string, userId: string): Promise<SegCtx | null> {
    const m = await tx.membership.findFirst({
      where: { businessId, userId, status: 'ACTIVE' },
      select: { role: true },
    });
    if (!m) return null;
    const tenant: TenantContext = { kind: 'staff', businessId, role: m.role };
    return {
      tx,
      businessId,
      userId,
      tenant,
      reachOnly: legacyFirmRole(m.role) === 'STAFF',
      perms: permsOf(tenant),
    };
  }

  /**
   * A scheduled campaign whose time has come: the audience and the checks are worked out again, and
   * it goes out, or is cancelled with the reasons when it can no longer go (the reasons are
   * recorded as codes). Returns what happened, or null when it is no longer due.
   */
  async startDue(
    tx: SegCtx['tx'],
    businessId: string,
    id: string,
    now = new Date(),
  ): Promise<'started' | 'cancelled' | null> {
    await tx.$queryRaw`SELECT 1 FROM communications WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    const c = await tx.communication.findFirst({ where: { businessId, id } });
    if (!c || c.status !== 'SCHEDULED' || !c.scheduledFor || c.scheduledFor > now) return null;
    const ctx = await this.jobCtx(tx, businessId, c.createdByUserId);
    const audience = ctx ? await this.audience.compute(ctx, c) : null;
    const checks = ctx && audience ? (await this.checks(ctx, c, audience)).checks : [];
    const blocking = checks.filter((k) => k.severity === 'BLOCK' && k.code !== 'SCHEDULE_IN_PAST');
    if (!ctx || !audience || blocking.length) {
      await tx.communication.update({
        where: { id: c.id },
        data: { status: 'CANCELLED', cancelledAt: now },
      });
      await this.audit.logIn(
        tx,
        'communication.schedule_failed',
        { type: 'communication', id: c.id },
        { communicationId: c.id, codes: blocking.map((k) => k.code), actor: 'job' },
        { businessId },
      );
      return 'cancelled';
    }
    await this.launch(ctx, c, audience, null, 'job');
    return 'started';
  }

  schedule(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof ScheduleBody>,
  ): Promise<CommunicationDetail> {
    return this.run(tenant, userId, async (ctx) => {
      this.requireWrite(ctx);
      const c = await this.lock(ctx, id);
      const again = await this.seen(ctx, body.idempotencyKey, id);
      if (again && again.status !== 'DRAFT') return this.detail(ctx, again);
      if (c.status !== 'DRAFT') throw refuse('NOT_EDITABLE', 'Only a draft can be scheduled');
      if (c.updatedAt.toISOString() !== body.etag) throw comErrors.saveConflict();
      const when = new Date(body.scheduledFor);
      if (when.getTime() <= Date.now() + LOCK_MS)
        throw refuse('SCHEDULE_IN_PAST', `Pick a time at least ${LOCK_MINUTES} minutes from now`);
      const audience = await this.gate(ctx, c, body.expectedFinalCount);
      const saved = await this.freeze(ctx, c, audience, {
        status: 'SCHEDULED',
        scheduledFor: when,
        timezone: c.timezone ?? (await firmTimeZone(ctx.tx, ctx.businessId)),
        idempotencyKey: body.idempotencyKey,
        updatedByUserId: ctx.userId,
      });
      await this.audit.logIn(
        ctx.tx,
        'communication.scheduled',
        { type: 'communication', id: c.id },
        { communicationId: c.id, channel: c.channel, finalCount: audience.summary.finalCount },
      );
      return this.detail(ctx, saved);
    });
  }

  reschedule(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof RescheduleBody>,
  ): Promise<CommunicationDetail> {
    return this.run(tenant, userId, async (ctx) => {
      this.requireWrite(ctx);
      const c = await this.lock(ctx, id, body.etag);
      if (c.status !== 'SCHEDULED')
        throw refuse('NOT_EDITABLE', 'Only a scheduled campaign can be rescheduled');
      if (!this.editable(c))
        throw refuse('LOCKED', 'This campaign is about to go out and is locked');
      const when = new Date(body.scheduledFor);
      if (when.getTime() <= Date.now() + LOCK_MS)
        throw refuse('SCHEDULE_IN_PAST', `Pick a time at least ${LOCK_MINUTES} minutes from now`);
      const saved = await ctx.tx.communication.update({
        where: { id: c.id },
        data: { scheduledFor: when, updatedByUserId: ctx.userId },
      });
      await this.audit.logIn(
        ctx.tx,
        'communication.rescheduled',
        { type: 'communication', id: c.id },
        { communicationId: c.id },
      );
      return this.detail(ctx, saved);
    });
  }

  cancel(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof CancelBody>,
  ): Promise<CommunicationDetail> {
    return this.run(tenant, userId, async (ctx) => {
      this.requireWrite(ctx);
      const c = await this.lock(ctx, id);
      if (c.status === 'CANCELLED') return this.detail(ctx, c);
      if (!['DRAFT', 'SCHEDULED', 'SENDING', 'PAUSED'].includes(c.status))
        throw refuse('NOT_EDITABLE', 'This communication has already gone out');
      const now = new Date();
      // What is not yet sent stops; what went out stays.
      await ctx.tx.communicationRecipient.updateMany({
        where: { businessId: ctx.businessId, communicationId: c.id, status: 'QUEUED' },
        data: { status: 'NOT_SENT', failureCode: 'cancelled' },
      });
      const saved = await ctx.tx.communication.update({
        where: { id: c.id },
        data: { status: 'CANCELLED', cancelledAt: now, updatedByUserId: ctx.userId },
      });
      await this.audit.logIn(
        ctx.tx,
        'communication.cancelled',
        { type: 'communication', id: c.id },
        { communicationId: c.id, from: c.status, hadReason: body.reason != null },
      );
      return this.detail(ctx, saved);
    });
  }

  setPaused(
    tenant: TenantContext,
    userId: string,
    id: string,
    paused: boolean,
  ): Promise<CommunicationDetail> {
    return this.run(tenant, userId, async (ctx) => {
      this.requireWrite(ctx);
      const c = await this.lock(ctx, id);
      const from = paused ? 'SENDING' : 'PAUSED';
      if (c.status !== from)
        throw refuse(
          'NOT_EDITABLE',
          paused ? 'Only a sending campaign can be paused' : 'This campaign is not paused',
        );
      const saved = await ctx.tx.communication.update({
        where: { id: c.id },
        data: { status: paused ? 'PAUSED' : 'SENDING', updatedByUserId: ctx.userId },
      });
      await this.audit.logIn(
        ctx.tx,
        paused ? 'communication.paused' : 'communication.resumed',
        { type: 'communication', id: c.id },
        { communicationId: c.id },
      );
      return this.detail(ctx, saved);
    });
  }

  // Exposed for the next steps (results, the delivery job).
  readonly helpers = { e164, LOCK_MS };
}
