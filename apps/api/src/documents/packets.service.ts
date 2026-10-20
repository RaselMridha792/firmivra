import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  BulkRequestPacketsResult,
  DocumentActivity,
  RequestItem,
  RequestPacketDetail,
  RequestPacketPage,
  RequestPacketRow,
  RequestPacketSummary,
  RequestPacketView,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { likeEscape } from '../clients/clients.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { errorName, Notifier } from '../notifications/notifier.js';
import { lockReachableClient, notFound } from '../storage/document-records.js';
import { memberNames, memberRef } from '../workspaces/common.js';
import { actorOf, conflict, invalid, requireActiveMember } from './library.common.js';
import type {
  BulkPacketsBody,
  CreateItemBody,
  CreatePacketBody,
  PacketsQ,
  ReorderItemsBody,
  UpdateItemBody,
  UpdatePacketBody,
} from './library.input.js';

type Out<S extends z.ZodType> = z.output<S>;

const DAY = 86_400_000;
/** What counts as received on the checklist. */
const RECEIVED = ['SUBMITTED', 'ACCEPTED', 'NOT_AVAILABLE'] as const;
/** After sending, only these change. */
const AFTER_SEND = new Set(['dueOn', 'assignedUserId', 'reminderDaysBefore', 'expiresAt']);
const toDay = (v: string) => new Date(`${v}T00:00:00Z`);
const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
const todayUtc = () => new Date().toISOString().slice(0, 10);

const incomplete = (message: string) =>
  new BadRequestException({ code: 'REQUEST_INCOMPLETE', message });
const sent = () =>
  conflict(
    'REQUEST_SENT',
    'After sending, only the due date, assignee, reminder and expiry change',
  );
const invalidStatus = () => conflict('INVALID_STATUS', 'Not possible in this status');

const packetSelect = {
  id: true,
  number: true,
  title: true,
  clientId: true,
  recipientKind: true,
  recipientUserId: true,
  templateId: true,
  dueOn: true,
  status: true,
  messageSubject: true,
  messageBody: true,
  notifyEmail: true,
  notifyPortal: true,
  notifySms: true,
  reminderDaysBefore: true,
  allowMultipleFiles: true,
  allowClientComments: true,
  expiresAt: true,
  assignedUserId: true,
  requestedByUserId: true,
  sentAt: true,
  submittedAt: true,
  completedAt: true,
  cancelledAt: true,
  updatedAt: true,
  createdAt: true,
  engagement: {
    select: { id: true, title: true, client: { select: { id: true, displayName: true } } },
  },
  items: {
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      title: true,
      instructions: true,
      required: true,
      status: true,
      statusNote: true,
      sortOrder: true,
      resolvedAt: true,
      category: { select: { id: true, name: true } },
      documents: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, fileName: true, scanStatus: true, createdAt: true },
      },
    },
  },
} satisfies Prisma.DocumentRequestPacketSelect;
type PacketRow = Prisma.DocumentRequestPacketGetPayload<{ select: typeof packetSelect }>;

/** The checklist as the packet shows it: items taken off a draft (cancelled) are left out. */
const liveItems = (p: PacketRow) =>
  p.status === 'DRAFT' ? p.items.filter((i) => i.status !== 'CANCELLED') : p.items;

/** The dashboard's status, from the packet, its items and its dates. */
export function viewOf(p: {
  status: PacketRow['status'];
  dueOn: Date | null;
  expiresAt: Date | null;
  items: { required: boolean; status: string }[];
}): RequestPacketView {
  if (p.status === 'DRAFT' || p.status === 'CANCELLED' || p.status === 'COMPLETED') return p.status;
  if (p.expiresAt && p.expiresAt.getTime() < Date.now()) return 'EXPIRED';
  if (p.dueOn && day(p.dueOn)! < todayUtc()) return 'OVERDUE';
  const live = p.items.filter((i) => i.status !== 'CANCELLED');
  const got = (i: { status: string }) => (RECEIVED as readonly string[]).includes(i.status);
  const required = live.filter((i) => i.required);
  if (p.status === 'SUBMITTED' || (required.length > 0 && required.every(got))) {
    return 'READY_FOR_REVIEW';
  }
  return live.some(got) ? 'PARTIALLY_RECEIVED' : 'OUTSTANDING';
}

/**
 * The requests dashboard and Create Document Request (R55, Frames 3 and 4): a request is a
 * `document_request_packets` row ("DR-0024") and its checklist items are `document_requests`
 * rows. The database numbers it, stamps each step, freezes it once sent (except the due date,
 * assignee, reminder and expiry) and lets items change only while it is a draft. Cancelled,
 * never deleted. Sending tells the client (R6's `document.requested`). Staff reach their own
 * clients only (404 otherwise).
 */
@Injectable()
export class DocumentPacketsService {
  private readonly logger = new Logger(DocumentPacketsService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly notifier: Notifier,
  ) {}

  private inFirm<T>(tenant: TenantContext, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId: tenant.businessId }, fn);
  }

  private reach(tenant: TenantContext, userId: string): Prisma.DocumentRequestPacketWhereInput {
    return actorOf(userId, tenant).role === 'STAFF'
      ? { engagement: { client: { assignedUserId: userId } } }
      : {};
  }

  private async find(
    tx: TxClient,
    tenant: TenantContext,
    userId: string,
    id: string,
    lock = false,
  ) {
    const businessId = tenant.businessId;
    if (lock) {
      await tx.$executeRaw`SELECT 1 FROM document_request_packets WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    }
    const p = await tx.documentRequestPacket.findFirst({
      where: { AND: [{ businessId, id }, this.reach(tenant, userId)] },
      select: packetSelect,
    });
    if (!p) throw notFound();
    return p;
  }

  private async names(tx: TxClient, businessId: string, rows: PacketRow[]) {
    return memberNames(
      tx,
      businessId,
      rows.flatMap((r) => [r.assignedUserId, r.recipientUserId, r.requestedByUserId]),
    );
  }

  private toRow(p: PacketRow, names: Map<string, string>): RequestPacketRow {
    const items = liveItems(p);
    return {
      id: p.id,
      reference: `DR-${String(p.number).padStart(4, '0')}`,
      title: p.title,
      client: { id: p.engagement.client.id, name: p.engagement.client.displayName },
      service: { id: p.engagement.id, title: p.engagement.title },
      recipient:
        p.recipientKind === 'MEMBER'
          ? {
              kind: 'MEMBER',
              userId: p.recipientUserId,
              name: names.get(p.recipientUserId ?? '') ?? '',
            }
          : { kind: 'CLIENT', userId: null, name: p.engagement.client.displayName },
      status: p.status,
      view: viewOf({ ...p, items }),
      items: {
        total: items.filter((i) => i.status !== 'CANCELLED').length,
        required: items.filter((i) => i.required && i.status !== 'CANCELLED').length,
        received: items.filter((i) => (RECEIVED as readonly string[]).includes(i.status)).length,
      },
      dueOn: day(p.dueOn),
      expiresAt: p.expiresAt?.toISOString() ?? null,
      assignedTo: memberRef(names, p.assignedUserId),
      sentAt: p.sentAt?.toISOString() ?? null,
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  private async detail(
    tx: TxClient,
    tenant: TenantContext,
    p: PacketRow,
  ): Promise<RequestPacketDetail> {
    const businessId = tenant.businessId;
    const names = await this.names(tx, businessId, [p]);
    const logs = await tx.auditLog.findMany({
      where: { businessId, entityType: 'document_request_packet', entityId: p.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      select: { id: true, action: true, actorUserId: true, createdAt: true },
    });
    const by = await memberNames(
      tx,
      businessId,
      logs.map((l) => l.actorUserId),
    );
    const KIND: Record<string, [DocumentActivity['kind'], string]> = {
      'document_request_packet.created': ['REQUEST_CREATED', 'Request created'],
      'document_request_packet.sent': ['REQUEST_SENT', 'Request sent'],
      'document_request_packet.resent': ['REQUEST_SENT', 'Request resent'],
      'document_request_packet.reminded': ['REQUEST_REMINDED', 'Reminder sent'],
      'document_request_packet.completed': ['REQUEST_COMPLETED', 'Marked complete'],
      'document_request_packet.cancelled': ['REQUEST_CANCELLED', 'Request cancelled'],
    };
    const items: RequestItem[] = liveItems(p).map((i) => ({
      id: i.id,
      title: i.title,
      instructions: i.instructions,
      required: i.required,
      category: i.category,
      status: i.status,
      statusNote: i.statusNote,
      sortOrder: i.sortOrder,
      documents: i.documents.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })),
      resolvedAt: i.resolvedAt?.toISOString() ?? null,
    }));
    return {
      ...this.toRow(p, names),
      templateId: p.templateId,
      messageSubject: p.messageSubject,
      messageBody: p.messageBody,
      notifyEmail: p.notifyEmail,
      notifyPortal: p.notifyPortal,
      notifySms: p.notifySms,
      reminderDaysBefore: p.reminderDaysBefore,
      allowMultipleFiles: p.allowMultipleFiles,
      allowClientComments: p.allowClientComments,
      requestedBy: memberRef(names, p.requestedByUserId),
      submittedAt: p.submittedAt?.toISOString() ?? null,
      completedAt: p.completedAt?.toISOString() ?? null,
      cancelledAt: p.cancelledAt?.toISOString() ?? null,
      checklist: items,
      activity: logs.flatMap((l) => {
        const k = KIND[l.action];
        return k
          ? [
              {
                id: l.id,
                at: l.createdAt.toISOString(),
                kind: k[0],
                label: k[1],
                by: l.actorUserId ? (by.get(l.actorUserId) ?? 'Client') : null,
              },
            ]
          : [];
      }),
    };
  }

  // ---------- Dashboard ----------

  /** The firm's requests matching the filters (the tab is applied on the computed status). */
  private async matching(
    tx: TxClient,
    tenant: TenantContext,
    userId: string,
    q: Out<typeof PacketsQ>,
  ) {
    const and: Prisma.DocumentRequestPacketWhereInput[] = [
      { businessId: tenant.businessId },
      this.reach(tenant, userId),
    ];
    if (q.clientId) and.push({ clientId: q.clientId });
    if (q.serviceId) and.push({ engagementId: q.serviceId });
    if (q.templateId) and.push({ templateId: q.templateId });
    if (q.assignedUserId) and.push({ assignedUserId: q.assignedUserId });
    if (q.dueFrom) and.push({ dueOn: { gte: toDay(q.dueFrom) } });
    if (q.dueTo) and.push({ dueOn: { lte: toDay(q.dueTo) } });
    if (q.search) {
      const contains = { contains: likeEscape(q.search), mode: 'insensitive' as const };
      const n = /^(?:dr-?)?(\d{1,9})$/i.exec(q.search.trim());
      and.push({
        OR: [
          { title: contains },
          { engagement: { client: { displayName: contains } } },
          ...(n ? [{ number: Number(n[1]) }] : []),
        ],
      });
    }
    return tx.documentRequestPacket.findMany({
      where: { AND: and },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 2000,
      select: packetSelect,
    });
  }

  async list(
    tenant: TenantContext,
    userId: string,
    q: Out<typeof PacketsQ>,
  ): Promise<RequestPacketPage> {
    return this.inFirm(tenant, async (tx) => {
      const rows = await this.matching(tx, tenant, userId, q);
      const names = await this.names(tx, tenant.businessId, rows);
      const soon = new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10);
      let items = rows.map((r) => this.toRow(r, names));
      const keep: Record<string, (r: RequestPacketRow) => boolean> = {
        all: (r) => r.view !== 'CANCELLED',
        draft: (r) => r.view === 'DRAFT',
        outstanding: (r) => r.view === 'OUTSTANDING',
        partially_received: (r) => r.view === 'PARTIALLY_RECEIVED',
        ready_for_review: (r) => r.view === 'READY_FOR_REVIEW',
        due_soon: (r) =>
          ['OUTSTANDING', 'PARTIALLY_RECEIVED'].includes(r.view) && !!r.dueOn && r.dueOn <= soon,
        overdue: (r) => r.view === 'OVERDUE',
        completed: (r) => r.view === 'COMPLETED',
        cancelled: (r) => r.view === 'CANCELLED',
      };
      items = items.filter(keep[q.tab]!);
      const byTitle = (a: RequestPacketRow, b: RequestPacketRow) => a.title.localeCompare(b.title);
      if (q.sort === 'due') {
        items.sort((a, b) => (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999') || byTitle(a, b));
      } else if (q.sort === 'client') {
        items.sort((a, b) => a.client.name.localeCompare(b.client.name) || byTitle(a, b));
      } else if (q.sort === 'title') items.sort(byTitle);
      const total = items.length;
      return {
        items: items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  async summary(tenant: TenantContext, userId: string): Promise<RequestPacketSummary> {
    // The cards count every request, not one page.
    const all = await this.inFirm(tenant, async (tx) => {
      const rows = await this.matching(tx, tenant, userId, {
        tab: 'all',
        sort: 'due',
        page: 1,
        pageSize: 100,
      });
      return rows.map((r) => viewOf({ ...r, items: liveItems(r) }));
    });
    const count = (v: RequestPacketView) => all.filter((x) => x === v).length;
    return {
      total: all.filter((v) => v !== 'CANCELLED').length,
      outstanding: count('OUTSTANDING'),
      partiallyReceived: count('PARTIALLY_RECEIVED'),
      completed: count('COMPLETED'),
      overdue: count('OVERDUE'),
    };
  }

  async get(tenant: TenantContext, userId: string, id: string): Promise<RequestPacketDetail> {
    const out = await this.inFirm(tenant, async (tx) =>
      this.detail(tx, tenant, await this.find(tx, tenant, userId, id)),
    );
    await this.audit.log('document_request_packet.viewed', { type: 'document_request_packet', id });
    return out;
  }

  // ---------- Create, edit, send ----------

  private checkDates(dueOn: string | null | undefined, expiresAt: string | null | undefined) {
    if (dueOn && expiresAt && expiresAt.slice(0, 10) <= dueOn) {
      throw invalid('The expiry comes after the due date', 'expiresAt');
    }
  }

  /** POST /business/document-request-packets: Save as Draft, or Send. Retry-safe. */
  async create(
    tenant: TenantContext,
    userId: string,
    body: Out<typeof CreatePacketBody>,
  ): Promise<RequestPacketDetail> {
    const businessId = tenant.businessId;
    const actor = actorOf(userId, tenant);
    this.checkDates(body.dueOn, body.expiresAt);
    const { id, replay } = await this.inFirm(tenant, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`request-packet:${businessId}:${body.idempotencyKey}`}, 0))`;
      const first = await tx.auditLog.findFirst({
        where: {
          businessId,
          action: 'document_request_packet.created',
          metadata: { path: ['idempotencyKey'], equals: body.idempotencyKey },
        },
        select: { entityId: true, actorUserId: true },
      });
      if (first?.entityId) {
        if (first.actorUserId !== userId) throw notFound();
        return { id: first.entityId, replay: true };
      }
      await lockReachableClient(tx, businessId, actor, body.clientId);
      const engagement = await this.engagementFor(tx, businessId, body.clientId, body.serviceId);
      if (body.recipient.kind === 'MEMBER')
        await requireActiveMember(tx, businessId, body.recipient.userId);
      if (body.assignedUserId) await requireActiveMember(tx, businessId, body.assignedUserId);
      const fromTemplate = body.templateId
        ? await this.templateItems(tx, businessId, userId, body.templateId)
        : [];
      const items = [
        ...fromTemplate,
        ...(body.items ?? []).map((i) => ({
          title: i.title,
          instructions: i.instructions ?? null,
          required: i.required,
          categoryId: i.categoryId ?? null,
        })),
      ];
      for (const i of items) {
        if (i.categoryId) await this.liveCategory(tx, businessId, i.categoryId);
      }
      const packet = await tx.documentRequestPacket.create({
        data: {
          businessId,
          clientId: body.clientId,
          engagementId: engagement,
          recipientKind: body.recipient.kind,
          recipientUserId: body.recipient.kind === 'MEMBER' ? body.recipient.userId : null,
          templateId: body.templateId ?? null,
          title: body.title,
          dueOn: body.dueOn ? toDay(body.dueOn) : null,
          messageSubject: body.messageSubject ?? null,
          messageBody: body.messageBody ?? null,
          ...(body.notifyEmail !== undefined ? { notifyEmail: body.notifyEmail } : {}),
          ...(body.notifyPortal !== undefined ? { notifyPortal: body.notifyPortal } : {}),
          ...(body.notifySms !== undefined ? { notifySms: body.notifySms } : {}),
          reminderDaysBefore: body.reminderDaysBefore ?? null,
          ...(body.allowMultipleFiles !== undefined
            ? { allowMultipleFiles: body.allowMultipleFiles }
            : {}),
          ...(body.allowClientComments !== undefined
            ? { allowClientComments: body.allowClientComments }
            : {}),
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
          assignedUserId: body.assignedUserId ?? null,
          requestedByUserId: userId,
          status: 'DRAFT',
        },
        select: { id: true },
      });
      for (const [n, i] of items.entries()) {
        await tx.documentRequest.create({
          data: {
            businessId,
            clientId: body.clientId,
            engagementId: engagement,
            packetId: packet.id,
            title: i.title,
            instructions: i.instructions,
            required: i.required,
            categoryId: i.categoryId,
            sortOrder: n,
            requestedByUserId: userId,
          },
        });
      }
      await this.audit.logIn(
        tx,
        'document_request_packet.created',
        { type: 'document_request_packet', id: packet.id },
        {
          idempotencyKey: body.idempotencyKey,
          clientId: body.clientId,
          items: items.length,
          templateId: body.templateId ?? null,
        },
        { businessId },
      );
      return { id: packet.id, replay: false };
    });
    if (body.send && !replay) return this.send(tenant, userId, id);
    return this.get(tenant, userId, id);
  }

  /** The service the request belongs to: the one named, or the client's only active one. */
  private async engagementFor(
    tx: TxClient,
    businessId: string,
    clientId: string,
    serviceId?: string,
  ) {
    const open = await tx.engagement.findMany({
      where: { businessId, clientId, ...(serviceId ? { id: serviceId } : { status: 'ACTIVE' }) },
      select: { id: true },
      take: 2,
    });
    if (serviceId) {
      if (!open[0]) throw notFound();
      return open[0].id;
    }
    if (open.length !== 1) {
      throw conflict('NO_ENGAGEMENT', 'Choose the service this request is for');
    }
    return open[0]!.id;
  }

  private async liveCategory(tx: TxClient, businessId: string, id: string) {
    const c = await tx.documentCategory.findFirst({
      where: { businessId, id, archivedAt: null },
      select: { id: true },
    });
    if (!c) throw notFound();
  }

  /** A firm request type or the member's own saved list, live. */
  private async templateItems(
    tx: TxClient,
    businessId: string,
    userId: string,
    templateId: string,
  ) {
    const t = await tx.documentRequestTemplate.findFirst({
      where: {
        businessId,
        id: templateId,
        archivedAt: null,
        OR: [{ ownerUserId: null }, { ownerUserId: userId }],
      },
      select: {
        items: {
          orderBy: { sortOrder: 'asc' },
          select: { title: true, description: true, required: true, categoryId: true },
        },
      },
    });
    if (!t) throw notFound();
    return t.items.map((i) => ({
      title: i.title,
      instructions: i.description,
      required: i.required,
      categoryId: i.categoryId,
    }));
  }

  /** PATCH: a draft changes freely; a sent request only its due date, assignee, reminder, expiry. */
  async update(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof UpdatePacketBody>,
  ): Promise<RequestPacketDetail> {
    const businessId = tenant.businessId;
    const fields = Object.keys(body).filter(
      (k) => (body as Record<string, unknown>)[k] !== undefined,
    );
    await this.inFirm(tenant, async (tx) => {
      const p = await this.find(tx, tenant, userId, id, true);
      if (p.status === 'CANCELLED' || p.status === 'COMPLETED') throw invalidStatus();
      if (p.status !== 'DRAFT' && fields.some((f) => !AFTER_SEND.has(f))) throw sent();
      const dueOn = body.dueOn !== undefined ? body.dueOn : day(p.dueOn);
      const expiresAt =
        body.expiresAt !== undefined ? body.expiresAt : (p.expiresAt?.toISOString() ?? null);
      this.checkDates(dueOn, expiresAt);
      if (p.status !== 'DRAFT' && body.dueOn === null)
        throw invalid('A sent request keeps a due date', 'dueOn');
      if (body.assignedUserId) await requireActiveMember(tx, businessId, body.assignedUserId);
      await tx.documentRequestPacket.update({
        where: { id },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.dueOn !== undefined ? { dueOn: body.dueOn ? toDay(body.dueOn) : null } : {}),
          ...(body.expiresAt !== undefined
            ? { expiresAt: body.expiresAt ? new Date(body.expiresAt) : null }
            : {}),
          ...(body.assignedUserId !== undefined ? { assignedUserId: body.assignedUserId } : {}),
          ...(body.messageSubject !== undefined ? { messageSubject: body.messageSubject } : {}),
          ...(body.messageBody !== undefined ? { messageBody: body.messageBody } : {}),
          ...(body.notifyEmail !== undefined ? { notifyEmail: body.notifyEmail } : {}),
          ...(body.notifyPortal !== undefined ? { notifyPortal: body.notifyPortal } : {}),
          ...(body.notifySms !== undefined ? { notifySms: body.notifySms } : {}),
          ...(body.reminderDaysBefore !== undefined
            ? { reminderDaysBefore: body.reminderDaysBefore }
            : {}),
          ...(body.allowMultipleFiles !== undefined
            ? { allowMultipleFiles: body.allowMultipleFiles }
            : {}),
          ...(body.allowClientComments !== undefined
            ? { allowClientComments: body.allowClientComments }
            : {}),
        },
      });
      await this.audit.logIn(
        tx,
        'document_request_packet.updated',
        { type: 'document_request_packet', id },
        { fields: fields.sort() },
        { businessId },
      );
    });
    return this.get(tenant, userId, id);
  }

  /** The client's bell and email copy for the request (R6, on its first item). */
  private async tell(businessId: string, packetId: string, actorUserId: string) {
    const first = await this.database.forBusiness(businessId).documentRequest.findFirst({
      where: { businessId, packetId, status: { not: 'CANCELLED' } },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    });
    if (!first) return;
    try {
      await this.notifier.notify({
        businessId,
        event: 'document.requested',
        recordId: first.id,
        actorUserId,
      });
    } catch (error) {
      this.logger.warn(
        `document.requested for request ${packetId} not written (${errorName(error)})`,
      );
    }
  }

  /** Send a draft: 400 REQUEST_INCOMPLETE without a due date, subject, message or item. */
  async send(tenant: TenantContext, userId: string, id: string): Promise<RequestPacketDetail> {
    const businessId = tenant.businessId;
    const tellClient = await this.inFirm(tenant, async (tx) => {
      const p = await this.find(tx, tenant, userId, id, true);
      if (p.status !== 'DRAFT') throw invalidStatus();
      const items = liveItems(p);
      const missing = [
        p.dueOn ? null : 'a due date',
        p.messageSubject ? null : 'a subject',
        p.messageBody ? null : 'a message',
        items.length ? null : 'at least one document',
      ].filter(Boolean);
      if (missing.length) {
        throw incomplete(`Add ${missing.join(', ')} before sending`);
      }
      await tx.documentRequestPacket.update({ where: { id }, data: { status: 'OPEN' } });
      // The checklist's due date is the request's.
      await tx.documentRequest.updateMany({
        where: { businessId, packetId: id },
        data: { dueOn: p.dueOn },
      });
      await this.audit.logIn(
        tx,
        'document_request_packet.sent',
        { type: 'document_request_packet', id },
        {},
        { businessId },
      );
      return p.recipientKind === 'CLIENT';
    });
    if (tellClient) await this.tell(businessId, id, userId);
    return this.get(tenant, userId, id);
  }

  /** Resend or a reminder now: open requests only. */
  async nudge(tenant: TenantContext, userId: string, id: string, action: 'resent' | 'reminded') {
    const businessId = tenant.businessId;
    const tellClient = await this.inFirm(tenant, async (tx) => {
      const p = await this.find(tx, tenant, userId, id, true);
      if (p.status !== 'OPEN' && p.status !== 'SUBMITTED') throw invalidStatus();
      await this.audit.logIn(
        tx,
        `document_request_packet.${action}`,
        { type: 'document_request_packet', id },
        {},
        { businessId },
      );
      return p.recipientKind === 'CLIENT';
    });
    if (tellClient) await this.tell(businessId, id, userId);
    return this.get(tenant, userId, id);
  }

  async complete(tenant: TenantContext, userId: string, id: string): Promise<RequestPacketDetail> {
    const businessId = tenant.businessId;
    await this.inFirm(tenant, async (tx) => {
      const p = await this.find(tx, tenant, userId, id, true);
      if (p.status !== 'OPEN' && p.status !== 'SUBMITTED') throw invalidStatus();
      await tx.documentRequestPacket.update({ where: { id }, data: { status: 'COMPLETED' } });
      await this.audit.logIn(
        tx,
        'document_request_packet.completed',
        { type: 'document_request_packet', id },
        {},
        { businessId },
      );
    });
    return this.get(tenant, userId, id);
  }

  /** Cancel: the open items are cancelled with it (the client is not asked for them any more). */
  async cancel(tenant: TenantContext, userId: string, id: string): Promise<RequestPacketDetail> {
    const businessId = tenant.businessId;
    await this.inFirm(tenant, async (tx) => {
      const p = await this.find(tx, tenant, userId, id, true);
      if (p.status === 'CANCELLED') return;
      if (p.status === 'COMPLETED') throw invalidStatus();
      await tx.documentRequestPacket.update({ where: { id }, data: { status: 'CANCELLED' } });
      await tx.documentRequest.updateMany({
        where: { businessId, packetId: id, status: { in: ['REQUESTED', 'REJECTED'] } },
        data: { status: 'CANCELLED', resolvedAt: new Date() },
      });
      await this.audit.logIn(
        tx,
        'document_request_packet.cancelled',
        { type: 'document_request_packet', id },
        {},
        { businessId },
      );
    });
    return this.get(tenant, userId, id);
  }

  // ---------- Checklist items (draft only) ----------

  private async draft(tx: TxClient, tenant: TenantContext, userId: string, id: string) {
    const p = await this.find(tx, tenant, userId, id, true);
    if (p.status !== 'DRAFT') throw sent();
    return p;
  }

  async addItem(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof CreateItemBody>,
  ) {
    const businessId = tenant.businessId;
    await this.inFirm(tenant, async (tx) => {
      const p = await this.draft(tx, tenant, userId, id);
      if (body.categoryId) await this.liveCategory(tx, businessId, body.categoryId);
      const top = Math.max(-1, ...p.items.map((i) => i.sortOrder));
      const item = await tx.documentRequest.create({
        data: {
          businessId,
          clientId: p.clientId,
          engagementId: p.engagement.id,
          packetId: id,
          title: body.title,
          instructions: body.instructions ?? null,
          required: body.required,
          categoryId: body.categoryId ?? null,
          sortOrder: top + 1,
          requestedByUserId: userId,
        },
        select: { id: true },
      });
      await this.audit.logIn(
        tx,
        'document_request_packet.item_added',
        { type: 'document_request_packet', id },
        { itemId: item.id },
        { businessId },
      );
    });
    return this.get(tenant, userId, id);
  }

  private liveItem(p: PacketRow, itemId: string) {
    const item = liveItems(p).find((i) => i.id === itemId);
    if (!item) throw notFound();
    return item;
  }

  async updateItem(
    tenant: TenantContext,
    userId: string,
    id: string,
    itemId: string,
    body: Out<typeof UpdateItemBody>,
  ) {
    const businessId = tenant.businessId;
    const fields = Object.keys(body).filter(
      (k) => (body as Record<string, unknown>)[k] !== undefined,
    );
    await this.inFirm(tenant, async (tx) => {
      const p = await this.draft(tx, tenant, userId, id);
      this.liveItem(p, itemId);
      if (body.categoryId) await this.liveCategory(tx, businessId, body.categoryId);
      await tx.documentRequest.update({
        where: { id: itemId },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.instructions !== undefined ? { instructions: body.instructions } : {}),
          ...(body.required !== undefined ? { required: body.required } : {}),
          ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
        },
      });
      await this.audit.logIn(
        tx,
        'document_request_packet.item_updated',
        { type: 'document_request_packet', id },
        { itemId, fields: fields.sort() },
        { businessId },
      );
    });
    return this.get(tenant, userId, id);
  }

  /** Off the draft: the item is cancelled (items are never deleted). */
  async removeItem(tenant: TenantContext, userId: string, id: string, itemId: string) {
    const businessId = tenant.businessId;
    await this.inFirm(tenant, async (tx) => {
      const p = await this.draft(tx, tenant, userId, id);
      this.liveItem(p, itemId);
      await tx.documentRequest.update({
        where: { id: itemId },
        data: { status: 'CANCELLED', resolvedAt: new Date() },
      });
      await this.audit.logIn(
        tx,
        'document_request_packet.item_removed',
        { type: 'document_request_packet', id },
        { itemId },
        { businessId },
      );
    });
    return this.get(tenant, userId, id);
  }

  async reorderItems(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof ReorderItemsBody>,
  ) {
    const businessId = tenant.businessId;
    await this.inFirm(tenant, async (tx) => {
      const p = await this.draft(tx, tenant, userId, id);
      const have = new Set(liveItems(p).map((i) => i.id));
      if (
        new Set(body.ids).size !== body.ids.length ||
        body.ids.length !== have.size ||
        body.ids.some((x) => !have.has(x))
      ) {
        throw invalid('Send every item of the request, once each', 'ids');
      }
      for (const [n, itemId] of body.ids.entries()) {
        await tx.documentRequest.update({ where: { id: itemId }, data: { sortOrder: n } });
      }
      await this.audit.logIn(
        tx,
        'document_request_packet.items_reordered',
        { type: 'document_request_packet', id },
        { count: body.ids.length },
        { businessId },
      );
    });
    return this.get(tenant, userId, id);
  }

  // ---------- Bulk ----------

  async bulk(
    tenant: TenantContext,
    userId: string,
    body: Out<typeof BulkPacketsBody>,
  ): Promise<BulkRequestPacketsResult> {
    const businessId = tenant.businessId;
    const ids = [...new Set(body.ids)];
    const skipped: BulkRequestPacketsResult['skipped'] = [];
    const reminded: string[] = [];
    const updated = await this.inFirm(tenant, async (tx) => {
      if (body.action === 'ASSIGN' && body.assignedUserId) {
        await requireActiveMember(tx, businessId, body.assignedUserId);
      }
      const rows = await tx.documentRequestPacket.findMany({
        where: { AND: [{ businessId, id: { in: ids } }, this.reach(tenant, userId)] },
        select: { id: true, status: true, recipientKind: true },
      });
      if (rows.length === 0) throw notFound();
      let n = 0;
      for (const id of ids) {
        const row = rows.find((r) => r.id === id);
        if (!row) {
          skipped.push({ id, code: 'NOT_FOUND' });
          continue;
        }
        if (body.action === 'REMIND') {
          if (row.status !== 'OPEN' && row.status !== 'SUBMITTED') {
            skipped.push({ id, code: 'INVALID_STATUS' });
            continue;
          }
          await this.audit.logIn(
            tx,
            'document_request_packet.reminded',
            { type: 'document_request_packet', id },
            { bulk: true },
            { businessId },
          );
          if (row.recipientKind === 'CLIENT') reminded.push(id);
        } else {
          if (row.status === 'CANCELLED' || row.status === 'COMPLETED') {
            skipped.push({ id, code: 'INVALID_STATUS' });
            continue;
          }
          await tx.documentRequestPacket.update({
            where: { id },
            data: { assignedUserId: body.assignedUserId },
          });
          await this.audit.logIn(
            tx,
            'document_request_packet.updated',
            { type: 'document_request_packet', id },
            { bulk: true, fields: ['assignedUserId'] },
            { businessId },
          );
        }
        n++;
      }
      return n;
    });
    for (const id of reminded) await this.tell(businessId, id, userId);
    return { updated, skipped };
  }
}
