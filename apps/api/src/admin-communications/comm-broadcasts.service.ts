import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, TxClient } from '@firmivra/db';
import {
  ADMIN_COMM_BROADCAST_ERRORS,
  type AdminCommBroadcast,
  type AdminCommBroadcastErrorCode,
  type AdminCommBroadcastSummary,
  type AdminCommBroadcastTestSent,
  type AdminCommMedia,
  type AdminCommMediaTicket,
  type AdminCommSegment,
  AdminCommSegmentDefinition,
  type AdminCommSegmentCount,
  type CreateAdminCommBroadcastRequest,
  type CreateAdminCommMediaRequest,
  type CreateAdminCommSegmentRequest,
  type ListAdminCommBroadcastRecipientsQuery,
  type ListAdminCommBroadcastRecipientsResponse,
  type ListAdminCommBroadcastsQuery,
  type ListAdminCommBroadcastsResponse,
  type ListAdminCommMediaQuery,
  type ListAdminCommMediaResponse,
  type ListAdminCommSegmentsQuery,
  type ListAdminCommSegmentsResponse,
  type ScheduleAdminCommBroadcastRequest,
  type TestAdminCommBroadcastRequest,
  type UpdateAdminCommBroadcastRequest,
  type UpdateAdminCommSegmentRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { isUniqueViolation } from '../appointments/errors.js';
import { AuditService } from '../audit/audit.service.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { NOTIFY_SERVICE, type NotifyService } from '../notify/notify.types.js';
import {
  DOCUMENT_STORAGE,
  type DocumentStorage,
  PUT_URL_SECONDS,
} from '../storage/document-storage.js';
import {
  type AudiencePerson,
  type BroadcastChannel,
  mediaKey,
  outcomeFromCounts,
  peopleIn,
  reachOf,
} from './broadcast.rules.js';
import {
  contactValues,
  errorCodeOf,
  fillMergeFields,
  inFuture,
  sampleValues,
} from './comm.rules.js';

export const broadcastFailure = (code: AdminCommBroadcastErrorCode) =>
  code === 'NOT_FOUND'
    ? new NotFoundException({ code, message: ADMIN_COMM_BROADCAST_ERRORS[code] })
    : new ConflictException({ code, message: ADMIN_COMM_BROADCAST_ERRORS[code] });

const mediaSelect = {
  id: true,
  kind: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  scanStatus: true,
  uploadedByUserId: true,
  createdAt: true,
} satisfies Prisma.CommMediaSelect;
const broadcastInclude = {
  segment: { select: { id: true, name: true } },
  channels: {
    orderBy: { channel: 'asc' },
    include: { media: { include: { media: { select: mediaSelect } } } },
  },
} satisfies Prisma.CommBroadcastInclude;
type BroadcastRow = Prisma.CommBroadcastGetPayload<{ include: typeof broadcastInclude }>;
type MediaRow = Prisma.CommMediaGetPayload<{ select: typeof mediaSelect }>;

const EDITABLE = ['DRAFT', 'SCHEDULED'];
const iso = (d: Date | null) => d?.toISOString() ?? null;

/**
 * Super Admin broadcasts, audiences and the file library (R0 stage B6). Admin scope only. A send
 * resolves the audience into recipients per channel (firms' active owners, sales leads, the team;
 * never a firm's clients), then sends each through NotifyService (email and SMS) or the team
 * member's bell (in-app) and records every result. A scheduled broadcast waits for the dispatcher
 * job (platform scope, R1).
 */
@Injectable()
export class CommBroadcastsService {
  private readonly logger = new Logger(CommBroadcastsService.name);

  constructor(
    private readonly admin: AdminPrisma,
    private readonly audit: AuditService,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
  ) {}

  // ---------- Broadcasts ----------

  async list(
    q: z.output<typeof ListAdminCommBroadcastsQuery>,
  ): Promise<ListAdminCommBroadcastsResponse> {
    const where: Prisma.CommBroadcastWhereInput = {
      archivedAt: q.archived ? { not: null } : null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.channel ? { channels: { some: { channel: q.channel } } } : {}),
      ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
    };
    return this.admin.transaction(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.commBroadcast.findMany({
          where,
          include: broadcastInclude,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        tx.commBroadcast.count({ where }),
      ]);
      return { items: await this.shape(tx, rows), total, page: q.page, pageSize: q.pageSize };
    });
  }

  async summary(): Promise<AdminCommBroadcastSummary> {
    return this.admin.transaction(async (tx) => {
      const groups = await tx.commBroadcast.groupBy({
        by: ['status'],
        where: { archivedAt: null },
        _count: { _all: true },
      });
      const n = (...s: string[]) =>
        groups.filter((g) => s.includes(g.status)).reduce((a, g) => a + g._count._all, 0);
      return {
        total: groups.reduce((a, g) => a + g._count._all, 0),
        drafts: n('DRAFT'),
        scheduled: n('SCHEDULED'),
        sent: n('SENT', 'PARTIALLY_SENT'),
        failed: n('FAILED'),
      };
    });
  }

  async get(id: string): Promise<AdminCommBroadcast> {
    return this.admin.transaction((tx) => this.one(tx, id));
  }

  async create(b: z.output<typeof CreateAdminCommBroadcastRequest>): Promise<AdminCommBroadcast> {
    return this.admin.transaction(async (tx) => {
      const row = await tx.commBroadcast.create({ data: { name: b.name } });
      await this.audit.logIn(tx, 'comm_broadcast.created', { type: 'comm_broadcast', id: row.id });
      return this.one(tx, row.id);
    });
  }

  async update(
    id: string,
    b: z.output<typeof UpdateAdminCommBroadcastRequest>,
  ): Promise<AdminCommBroadcast> {
    return this.admin.transaction(async (tx) => {
      const row = await this.editable(tx, id);
      if (b.segmentId) {
        const seg = await tx.commSegment.findUnique({
          where: { id: b.segmentId },
          select: { archivedAt: true },
        });
        if (!seg) throw broadcastFailure('NOT_FOUND');
        if (seg.archivedAt) throw broadcastFailure('SEGMENT_ARCHIVED');
      }
      await tx.commBroadcast.update({
        where: { id },
        data: {
          ...(b.name ? { name: b.name } : {}),
          ...(b.segmentId !== undefined ? { segmentId: b.segmentId } : {}),
        },
      });
      if (b.channels) {
        const mediaIds = [...new Set(b.channels.flatMap((c) => c.mediaIds ?? []))];
        const media = mediaIds.length
          ? await tx.commMedia.findMany({
              where: { id: { in: mediaIds } },
              select: { id: true, kind: true, scanStatus: true },
            })
          : [];
        if (media.length !== mediaIds.length || media.some((m) => m.scanStatus !== 'CLEAN'))
          throw broadcastFailure('MEDIA_NOT_USABLE');
        await tx.commBroadcastChannel.deleteMany({ where: { broadcastId: row.id } });
        for (const c of b.channels) {
          const ch = await tx.commBroadcastChannel.create({
            data: {
              broadcastId: id,
              channel: c.channel,
              subject: c.channel === 'EMAIL' ? (c.subject ?? null) : null,
              body: c.body,
            },
          });
          for (const mediaId of c.mediaIds ?? []) {
            const m = media.find((x) => x.id === mediaId)!;
            await tx.commMediaLink.create({
              data: { mediaId, usage: m.kind, broadcastChannelId: ch.id },
            });
          }
        }
      }
      await this.audit.logIn(tx, 'comm_broadcast.updated', { type: 'comm_broadcast', id });
      return this.one(tx, id);
    });
  }

  /** Each chosen channel's content, filled with samples, to the signed-in member. Not a send. */
  async test(
    id: string,
    b: z.output<typeof TestAdminCommBroadcastRequest>,
  ): Promise<AdminCommBroadcastTestSent> {
    const me = this.admin.adminUserId;
    const { row, user } = await this.admin.transaction(async (tx) => ({
      row: await tx.commBroadcast.findUnique({ where: { id }, include: { channels: true } }),
      user: await tx.user.findUnique({ where: { id: me }, select: { email: true, name: true } }),
    }));
    if (!row) throw broadcastFailure('NOT_FOUND');
    const values = sampleValues();
    const sentTo: string[] = [];
    for (const channel of new Set(b.channels)) {
      const c = row.channels.find((x) => x.channel === channel);
      if (!c) throw broadcastFailure('NO_CHANNEL');
      const body = fillMergeFields(c.body, values).text;
      if (channel === 'EMAIL') {
        if (!user?.email) throw broadcastFailure('NOT_FOUND');
        await this.notify.send({
          template: 'platform.message-email',
          to: user.email,
          businessId: null,
          data: {
            name: user.name,
            subject: `[Test] ${fillMergeFields(c.subject ?? row.name, values).text}`,
            body,
          },
        });
        sentTo.push(user.email);
      } else if (channel === 'SMS') {
        if (!b.phone)
          throw new BadRequestException({
            code: 'VALIDATION_FAILED',
            message: 'Enter a phone number',
          });
        await this.notify.send({
          template: 'platform.message-sms',
          to: b.phone,
          businessId: null,
          data: { body },
        });
        sentTo.push(b.phone);
      } else {
        await this.admin.transaction((tx) =>
          this.bell(
            tx,
            me,
            row.id,
            row.name,
            `[Test] ${row.name}`,
            body,
            `comm-broadcast-test-${randomUUID()}`,
          ),
        );
        sentTo.push('in-app');
      }
    }
    await this.audit.log(
      'comm_broadcast.test_sent',
      { type: 'comm_broadcast', id },
      { channels: [...new Set(b.channels)], test: true },
    );
    return { sentTo };
  }

  async schedule(
    id: string,
    b: z.output<typeof ScheduleAdminCommBroadcastRequest>,
  ): Promise<AdminCommBroadcast> {
    if (!inFuture(b.scheduledAt)) throw broadcastFailure('SCHEDULE_IN_PAST');
    return this.admin.transaction(async (tx) => {
      const row = await this.editable(tx, id);
      await this.ready(tx, row);
      await tx.commBroadcast.update({
        where: { id },
        data: {
          status: 'SCHEDULED',
          scheduledAt: new Date(b.scheduledAt),
          scheduledTimeZone: b.scheduledTimeZone,
        },
      });
      await this.audit.logIn(tx, 'comm_broadcast.scheduled', { type: 'comm_broadcast', id });
      return this.one(tx, id);
    });
  }

  /** Counts the audience, writes its recipients, then sends; a repeat answers it as it is. */
  async send(id: string): Promise<AdminCommBroadcast> {
    const go = await this.admin.transaction(async (tx) => {
      const row = await tx.commBroadcast.findUnique({ where: { id }, include: { channels: true } });
      if (!row) throw broadcastFailure('NOT_FOUND');
      if (!EDITABLE.includes(row.status)) {
        if (row.status === 'CANCELLED') throw broadcastFailure('NOT_EDITABLE');
        return false;
      }
      const people = await this.ready(tx, row);
      const reach = reachOf(
        people,
        row.channels.map((c) => c.channel as BroadcastChannel),
      );
      if (reach.length === 0) throw broadcastFailure('EMPTY_AUDIENCE');
      await tx.commBroadcast.update({
        where: { id },
        data: { status: 'SENDING', recipientCount: peopleIn(reach) },
      });
      for (const c of row.channels)
        await tx.commBroadcastChannel.update({ where: { id: c.id }, data: { status: 'SENDING' } });
      await tx.commBroadcastRecipient.createMany({
        data: reach.map((r) => ({
          broadcastId: id,
          channel: r.channel,
          contactType: r.person.type,
          linkedBusinessId: r.person.businessId,
          contactUserId: r.person.userId,
          salesContactId: r.person.salesContactId,
          name: r.person.name,
          address: r.address,
        })),
      });
      await tx.commSegment.update({
        where: { id: row.segmentId! },
        data: { lastCount: people.length },
      });
      await this.audit.logIn(
        tx,
        'comm_broadcast.sent',
        { type: 'comm_broadcast', id },
        { recipients: reach.length },
      );
      return true;
    });
    if (go) await this.dispatch(id);
    return this.get(id);
  }

  async cancel(id: string): Promise<AdminCommBroadcast> {
    return this.admin.transaction(async (tx) => {
      const row = await tx.commBroadcast.findUnique({ where: { id } });
      if (!row) throw broadcastFailure('NOT_FOUND');
      if (row.status !== 'SCHEDULED') throw broadcastFailure('NOT_SCHEDULED');
      await tx.commBroadcast.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.audit.logIn(tx, 'comm_broadcast.cancelled', { type: 'comm_broadcast', id });
      return this.one(tx, id);
    });
  }

  /** A FAILED broadcast again: its failed recipients go back to pending and are sent. */
  async retry(id: string): Promise<AdminCommBroadcast> {
    const go = await this.admin.transaction(async (tx) => {
      const row = await tx.commBroadcast.findUnique({ where: { id }, include: { channels: true } });
      if (!row) throw broadcastFailure('NOT_FOUND');
      if (row.status === 'SENDING') return false;
      if (row.status !== 'FAILED') throw broadcastFailure('NOT_RETRYABLE');
      await tx.commBroadcast.update({ where: { id }, data: { status: 'SENDING' } });
      for (const c of row.channels)
        if (c.status === 'FAILED')
          await tx.commBroadcastChannel.update({
            where: { id: c.id },
            data: { status: 'SENDING' },
          });
      await tx.commBroadcastRecipient.updateMany({
        where: { broadcastId: id, status: 'FAILED' },
        data: { status: 'PENDING' },
      });
      await this.audit.logIn(tx, 'comm_broadcast.retried', { type: 'comm_broadcast', id });
      return true;
    });
    if (go) await this.dispatch(id);
    return this.get(id);
  }

  async duplicate(id: string): Promise<AdminCommBroadcast> {
    return this.admin.transaction(async (tx) => {
      const row = await tx.commBroadcast.findUnique({
        where: { id },
        include: {
          channels: { include: { media: true } },
          segment: { select: { archivedAt: true } },
        },
      });
      if (!row) throw broadcastFailure('NOT_FOUND');
      const copy = await tx.commBroadcast.create({
        data: {
          name: `${row.name.slice(0, 110)} (copy)`,
          segmentId: row.segment?.archivedAt ? null : row.segmentId,
          duplicatedFromId: id,
        },
      });
      for (const c of row.channels) {
        const ch = await tx.commBroadcastChannel.create({
          data: { broadcastId: copy.id, channel: c.channel, subject: c.subject, body: c.body },
        });
        for (const link of c.media)
          await tx.commMediaLink.create({
            data: { mediaId: link.mediaId, usage: link.usage, broadcastChannelId: ch.id },
          });
      }
      await this.audit.logIn(
        tx,
        'comm_broadcast.duplicated',
        { type: 'comm_broadcast', id: copy.id },
        { from: id },
      );
      return this.one(tx, copy.id);
    });
  }

  async archive(id: string): Promise<AdminCommBroadcast> {
    return this.admin.transaction(async (tx) => {
      const row = await tx.commBroadcast.findUnique({ where: { id } });
      if (!row) throw broadcastFailure('NOT_FOUND');
      if (!['SENT', 'PARTIALLY_SENT', 'FAILED', 'CANCELLED'].includes(row.status))
        throw broadcastFailure('NOT_FINISHED');
      if (!row.archivedAt) {
        await tx.commBroadcast.update({ where: { id }, data: { archivedAt: new Date() } });
        await this.audit.logIn(tx, 'comm_broadcast.archived', { type: 'comm_broadcast', id });
      }
      return this.one(tx, id);
    });
  }

  async remove(id: string): Promise<{ ok: true }> {
    await this.admin.transaction(async (tx) => {
      const row = await tx.commBroadcast.findUnique({ where: { id } });
      if (!row) throw broadcastFailure('NOT_FOUND');
      if (row.status !== 'DRAFT') throw broadcastFailure('NOT_DRAFT');
      await tx.commBroadcast.delete({ where: { id } });
      await this.audit.logIn(tx, 'comm_broadcast.deleted', { type: 'comm_broadcast', id });
    });
    return { ok: true };
  }

  async recipients(
    id: string,
    q: z.output<typeof ListAdminCommBroadcastRecipientsQuery>,
  ): Promise<ListAdminCommBroadcastRecipientsResponse> {
    return this.admin.transaction(async (tx) => {
      if (!(await tx.commBroadcast.findUnique({ where: { id }, select: { id: true } })))
        throw broadcastFailure('NOT_FOUND');
      const term = q.search ? { contains: q.search, mode: 'insensitive' as const } : undefined;
      const where: Prisma.CommBroadcastRecipientWhereInput = {
        broadcastId: id,
        ...(q.channel ? { channel: q.channel } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(term ? { OR: [{ name: term }, { address: term }] } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.commBroadcastRecipient.findMany({
          where,
          orderBy: [{ channel: 'asc' }, { name: 'asc' }, { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        tx.commBroadcastRecipient.count({ where }),
      ]);
      return {
        items: rows.map((r) => ({
          id: r.id,
          channel: r.channel as BroadcastChannel,
          contactType: r.contactType,
          name: r.name,
          address: r.channel === 'IN_APP' ? r.name : r.address,
          status: r.status,
          errorCode: r.errorCode,
          sentAt: iso(r.sentAt),
          deliveredAt: iso(r.deliveredAt),
          failedAt: iso(r.failedAt),
        })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  // ---------- Sending ----------

  /** Sends every PENDING recipient of a SENDING broadcast and records the results. */
  async dispatch(id: string): Promise<void> {
    const me = this.admin.adminUserId;
    const plan = await this.admin.transaction(async (tx) => {
      const row = await tx.commBroadcast.findUnique({
        where: { id },
        include: {
          channels: true,
          recipients: {
            where: { status: 'PENDING' },
            include: { linkedBusiness: { select: { name: true } } },
          },
        },
      });
      const sender = await tx.user.findUnique({ where: { id: me }, select: { name: true } });
      return row && row.status === 'SENDING'
        ? { row, senderName: sender?.name ?? 'Firmivra' }
        : null;
    });
    if (!plan) return;
    const { row, senderName } = plan;
    const results: { id: string; ok: boolean; code: string | null }[] = [];
    for (const r of row.recipients) {
      const content = row.channels.find((c) => c.channel === r.channel)!;
      const values = contactValues({
        name: r.name,
        email: r.channel === 'EMAIL' ? r.address : null,
        firmName: r.linkedBusiness?.name ?? null,
        senderName,
      });
      const body = fillMergeFields(content.body, values).text;
      try {
        if (r.channel === 'EMAIL')
          await this.notify.send({
            template: 'platform.message-email',
            to: r.address,
            businessId: null,
            data: {
              name: r.name,
              subject: fillMergeFields(content.subject ?? row.name, values).text,
              body,
            },
          });
        else if (r.channel === 'SMS')
          await this.notify.send({
            template: 'platform.message-sms',
            to: r.address,
            businessId: null,
            data: { body },
          });
        else
          await this.admin.transaction((tx) =>
            this.bell(
              tx,
              r.contactUserId!,
              row.id,
              row.name,
              content.subject ?? row.name,
              body,
              `comm-broadcast-${r.id}`,
            ),
          );
        results.push({ id: r.id, ok: true, code: null });
      } catch (e) {
        const code = errorCodeOf(
          (e as { reason?: string }).reason ?? (e as { code?: string }).code,
        );
        this.logger.warn(`comm broadcast ${id}: a recipient was not sent (${code})`);
        results.push({ id: r.id, ok: false, code });
      }
    }
    await this.admin.transaction(async (tx) => {
      for (const r of results)
        await tx.commBroadcastRecipient.update({
          where: { id: r.id },
          data: r.ok ? { status: 'SENT' } : { status: 'FAILED', errorCode: r.code },
        });
      // Counts from every recipient, so a retry's results add to the first attempt's.
      const counts = await tx.commBroadcastRecipient.groupBy({
        by: ['channel', 'status'],
        where: { broadcastId: id },
        _count: { _all: true },
      });
      const of = (channel: string, statuses: string[]) =>
        counts
          .filter((c) => c.channel === channel && statuses.includes(c.status))
          .reduce((a, c) => a + c._count._all, 0);
      let sent = 0;
      let failed = 0;
      for (const c of row.channels) {
        const s = of(c.channel, ['SENT', 'DELIVERED']);
        const f = of(c.channel, ['FAILED', 'BOUNCED']);
        sent += s;
        failed += f;
        const current = await tx.commBroadcastChannel.findUniqueOrThrow({
          where: { id: c.id },
          select: { status: true },
        });
        await tx.commBroadcastChannel.update({
          where: { id: c.id },
          data: {
            sentCount: s,
            failedCount: f,
            ...(current.status === 'SENDING' ? { status: outcomeFromCounts(s, f) } : {}),
          },
        });
      }
      const outcome = outcomeFromCounts(sent, failed);
      await tx.commBroadcast.update({
        where: { id },
        data:
          outcome === 'SENT'
            ? { status: 'SENT' }
            : {
                status: outcome,
                errorMessage: `${failed} of ${sent + failed} sends did not go out`,
              },
      });
      if (outcome !== 'SENT')
        await this.audit.logIn(
          tx,
          'comm_broadcast.failed',
          { type: 'comm_broadcast', id },
          { outcome, failed },
        );
    });
  }

  // ---------- Segments ----------

  async segments(
    q: z.output<typeof ListAdminCommSegmentsQuery>,
  ): Promise<ListAdminCommSegmentsResponse> {
    const where: Prisma.CommSegmentWhereInput = {
      archivedAt: q.archived ? { not: null } : null,
      ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
    };
    return this.admin.transaction(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.commSegment.findMany({
          where,
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        tx.commSegment.count({ where }),
      ]);
      return {
        items: await this.shapeSegments(tx, rows),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  async createSegment(
    b: z.output<typeof CreateAdminCommSegmentRequest>,
  ): Promise<AdminCommSegment> {
    return this.named(() =>
      this.admin.transaction(async (tx) => {
        const row = await tx.commSegment.create({
          data: {
            name: b.name,
            description: b.description ?? null,
            definition: b.definition as Prisma.InputJsonObject,
          },
        });
        await this.audit.logIn(tx, 'comm_segment.created', { type: 'comm_segment', id: row.id });
        return (await this.shapeSegments(tx, [row]))[0]!;
      }),
    );
  }

  async updateSegment(
    id: string,
    b: z.output<typeof UpdateAdminCommSegmentRequest>,
  ): Promise<AdminCommSegment> {
    return this.named(() =>
      this.admin.transaction(async (tx) => {
        const seg = await tx.commSegment.findUnique({ where: { id } });
        if (!seg || seg.archivedAt) throw broadcastFailure('NOT_FOUND');
        const row = await tx.commSegment.update({
          where: { id },
          data: {
            ...(b.name ? { name: b.name } : {}),
            ...(b.description !== undefined ? { description: b.description } : {}),
            ...(b.definition ? { definition: b.definition as Prisma.InputJsonObject } : {}),
            ...(b.archived ? { archivedAt: new Date() } : {}),
          },
        });
        await this.audit.logIn(tx, b.archived ? 'comm_segment.archived' : 'comm_segment.updated', {
          type: 'comm_segment',
          id,
        });
        return (await this.shapeSegments(tx, [row]))[0]!;
      }),
    );
  }

  async count(id: string): Promise<AdminCommSegmentCount> {
    return this.admin.transaction(async (tx) => {
      const seg = await tx.commSegment.findUnique({ where: { id } });
      if (!seg) throw broadcastFailure('NOT_FOUND');
      const people = await this.audience(tx, seg.definition);
      const byChannel = { EMAIL: 0, SMS: 0, IN_APP: 0 };
      for (const r of reachOf(people, ['EMAIL', 'SMS', 'IN_APP'])) byChannel[r.channel] += 1;
      const row = await tx.commSegment.update({
        where: { id },
        data: { lastCount: people.length },
      });
      return {
        total: people.length,
        byChannel,
        countedAt: (row.lastCountedAt ?? new Date()).toISOString(),
      };
    });
  }

  // ---------- Files ----------

  async media(q: z.output<typeof ListAdminCommMediaQuery>): Promise<ListAdminCommMediaResponse> {
    const where: Prisma.CommMediaWhereInput = q.kind ? { kind: q.kind } : {};
    return this.admin.transaction(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.commMedia.findMany({
          where,
          select: mediaSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        tx.commMedia.count({ where }),
      ]);
      return { items: await this.shapeMedia(tx, rows), total, page: q.page, pageSize: q.pageSize };
    });
  }

  /** A library row (scan pending) and a presigned PUT for exactly this file. */
  async createMedia(
    b: z.output<typeof CreateAdminCommMediaRequest>,
  ): Promise<AdminCommMediaTicket> {
    const id = randomUUID();
    const key = mediaKey(id, b.fileName);
    const ticket = await this.storage.presignUpload({
      key,
      contentType: b.contentType,
      sizeBytes: b.sizeBytes,
      sha256: b.sha256,
    });
    return this.admin.transaction(async (tx) => {
      const row = await tx.commMedia.create({
        data: {
          id,
          kind: b.kind,
          fileName: b.fileName,
          contentType: b.contentType,
          sizeBytes: b.sizeBytes,
          sha256: b.sha256,
          s3Key: key,
        },
        select: mediaSelect,
      });
      await this.audit.logIn(tx, 'comm_media.created', { type: 'comm_media', id });
      return {
        media: (await this.shapeMedia(tx, [row]))[0]!,
        uploadUrl: ticket.url,
        headers: ticket.headers,
        expiresAt: new Date(Date.now() + PUT_URL_SECONDS * 1000).toISOString(),
      };
    });
  }

  // ---------- Helpers ----------

  private async named<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (e) {
      if (isUniqueViolation(e)) throw broadcastFailure('DUPLICATE_NAME');
      throw e;
    }
  }

  private async editable(tx: TxClient, id: string) {
    const row = await tx.commBroadcast.findUnique({ where: { id }, include: { channels: true } });
    if (!row) throw broadcastFailure('NOT_FOUND');
    if (!EDITABLE.includes(row.status)) throw broadcastFailure('NOT_EDITABLE');
    return row;
  }

  /** A broadcast can go out: an audience that is not archived and some channel content. */
  private async ready(
    tx: TxClient,
    row: { segmentId: string | null; channels: unknown[] },
  ): Promise<AudiencePerson[]> {
    if (!row.segmentId) throw broadcastFailure('NO_SEGMENT');
    if (row.channels.length === 0) throw broadcastFailure('NO_CHANNEL');
    const seg = await tx.commSegment.findUnique({ where: { id: row.segmentId } });
    if (!seg) throw broadcastFailure('NO_SEGMENT');
    if (seg.archivedAt) throw broadcastFailure('SEGMENT_ARCHIVED');
    return this.audience(tx, seg.definition);
  }

  /** The people a segment definition reaches now: firms' active owners, sales leads, the team. */
  private async audience(tx: TxClient, raw: unknown): Promise<AudiencePerson[]> {
    const d = AdminCommSegmentDefinition.parse(raw);
    const people: AudiencePerson[] = [];
    if (d.contactTypes.includes('FIRM')) {
      const owners = await tx.membership.findMany({
        where: {
          role: 'OWNER',
          status: 'ACTIVE',
          ...(d.firmIds ? { businessId: { in: d.firmIds } } : {}),
          ...(d.firmStatuses ? { business: { status: { in: d.firmStatuses } } } : {}),
        },
        select: {
          business: { select: { id: true, name: true } },
          user: { select: { id: true, name: true, email: true, phone: true } },
        },
      });
      for (const o of owners)
        people.push({
          type: 'FIRM',
          businessId: o.business.id,
          businessName: o.business.name,
          userId: o.user.id,
          salesContactId: null,
          name: o.user.name,
          email: o.user.email,
          phone: o.user.phone,
        });
    }
    if (d.contactTypes.includes('LEAD')) {
      const leads = await tx.salesContact.findMany({
        where: d.salesContactIds ? { id: { in: d.salesContactIds } } : {},
        select: { id: true, name: true, email: true, phone: true },
      });
      for (const l of leads)
        people.push({
          type: 'LEAD',
          businessId: null,
          businessName: null,
          userId: null,
          salesContactId: l.id,
          name: l.name,
          email: l.email,
          phone: l.phone,
        });
    }
    if (d.contactTypes.includes('TEAM')) {
      const team = await tx.platformAdmin.findMany({
        select: { user: { select: { id: true, name: true, email: true, phone: true } } },
      });
      for (const t of team)
        people.push({
          type: 'TEAM',
          businessId: null,
          businessName: null,
          userId: t.user.id,
          salesContactId: null,
          name: t.user.name,
          email: t.user.email,
          phone: t.user.phone,
        });
    }
    return people;
  }

  /** An in-app item in a team member's bell (B1), once per broadcast recipient. */
  private async bell(
    tx: TxClient,
    userId: string,
    broadcastId: string,
    label: string,
    title: string,
    body: string,
    eventKey: string,
  ) {
    // createMany: no RETURNING, since a member may insert another's item but only reads their own.
    await tx.platformNotification.createMany({
      data: [
        {
          recipientUserId: userId,
          category: 'SYSTEM',
          type: 'communications.broadcast',
          title: title.slice(0, 200),
          body: body.slice(0, 1000),
          sourceType: 'comm_broadcast',
          sourceId: broadcastId,
          sourceLabel: label.slice(0, 200),
          eventKey,
        },
      ],
    });
  }

  private async one(tx: TxClient, id: string): Promise<AdminCommBroadcast> {
    const row = await tx.commBroadcast.findUnique({ where: { id }, include: broadcastInclude });
    if (!row) throw broadcastFailure('NOT_FOUND');
    return (await this.shape(tx, [row]))[0]!;
  }

  private async names(tx: TxClient, ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map<string, string>();
    const rows = await tx.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((u) => [u.id, u.name]));
  }

  private async shape(tx: TxClient, rows: BroadcastRow[]): Promise<AdminCommBroadcast[]> {
    const mediaRows = rows.flatMap((r) => r.channels.flatMap((c) => c.media.map((l) => l.media)));
    const names = await this.names(tx, [
      ...rows.flatMap((r) => [r.createdByUserId, r.updatedByUserId]),
      ...mediaRows.map((m) => m.uploadedByUserId),
    ]);
    const ref = (userId: string | null) =>
      userId ? { userId, name: names.get(userId) ?? 'Firmivra team' } : null;
    const media = (m: MediaRow): AdminCommMedia => ({
      id: m.id,
      kind: m.kind,
      fileName: m.fileName,
      contentType: m.contentType,
      sizeBytes: m.sizeBytes,
      scanStatus: m.scanStatus,
      uploadedBy: ref(m.uploadedByUserId),
      createdAt: m.createdAt.toISOString(),
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      segment: r.segment,
      channels: r.channels.map((c) => ({
        id: c.id,
        channel: c.channel as BroadcastChannel,
        subject: c.subject,
        body: c.body,
        status: c.status,
        sentCount: c.sentCount,
        failedCount: c.failedCount,
        media: c.media.map((l) => media(l.media)),
      })),
      scheduledAt: iso(r.scheduledAt),
      scheduledTimeZone: r.scheduledTimeZone,
      recipientCount: r.recipientCount,
      duplicatedFromId: r.duplicatedFromId,
      sendStartedAt: iso(r.sendStartedAt),
      finishedAt: iso(r.finishedAt),
      errorMessage: r.errorMessage,
      archivedAt: iso(r.archivedAt),
      createdBy: ref(r.createdByUserId),
      updatedBy: ref(r.updatedByUserId),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  private async shapeSegments(
    tx: TxClient,
    rows: Prisma.CommSegmentGetPayload<object>[],
  ): Promise<AdminCommSegment[]> {
    const names = await this.names(
      tx,
      rows.map((r) => r.createdByUserId),
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      definition: AdminCommSegmentDefinition.parse(r.definition),
      lastCount: r.lastCount,
      lastCountedAt: iso(r.lastCountedAt),
      archivedAt: iso(r.archivedAt),
      createdBy: r.createdByUserId
        ? { userId: r.createdByUserId, name: names.get(r.createdByUserId) ?? 'Firmivra team' }
        : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  private async shapeMedia(tx: TxClient, rows: MediaRow[]): Promise<AdminCommMedia[]> {
    const names = await this.names(
      tx,
      rows.map((r) => r.uploadedByUserId),
    );
    return rows.map((m) => ({
      id: m.id,
      kind: m.kind,
      fileName: m.fileName,
      contentType: m.contentType,
      sizeBytes: m.sizeBytes,
      scanStatus: m.scanStatus,
      uploadedBy: m.uploadedByUserId
        ? { userId: m.uploadedByUserId, name: names.get(m.uploadedByUserId) ?? 'Firmivra team' }
        : null,
      createdAt: m.createdAt.toISOString(),
    }));
  }
}
