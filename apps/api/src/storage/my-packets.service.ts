import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Prisma, TxClient } from '@firmivra/db';
import type {
  MyRequestPacket,
  MyRequestPacketEvent,
  MyRequestPacketItem,
  MyRequestPacketRow,
  MyRequestPacketView,
} from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import type { Database } from '@firmivra/db';
import {
  documentSelect,
  notFound,
  peopleOf,
  type PortalCaller,
  type PortalLogin,
  portalLogin,
  refusal,
  toMyDocument,
} from './document-records.js';
import { visible } from './my-documents.service.js';

/** An item counts as answered in these (contract: MyRequestPacketProgress). */
const ANSWERED = ['SUBMITTED', 'ACCEPTED', 'NOT_AVAILABLE'] as const;
/** An item of an open packet takes a file in these: a SUBMITTED one gets another or a replacement. */
const PACKET_UPLOADABLE = ['REQUESTED', 'REJECTED', 'SUBMITTED'] as const;
const MAX_PACKETS = 200;
const MAX_FILES = 50;

const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
const todayUtc = () => new Date().toISOString().slice(0, 10);
const reference = (n: number) => `DR-${String(n).padStart(4, '0')}`;
const answered = (status: string) => (ANSWERED as readonly string[]).includes(status);

const itemSelect = {
  id: true,
  title: true,
  instructions: true,
  required: true,
  status: true,
  statusNote: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
  category: { select: { id: true, name: true } },
} satisfies Prisma.DocumentRequestSelect;

const packetSelect = {
  id: true,
  number: true,
  title: true,
  status: true,
  dueOn: true,
  expiresAt: true,
  sentAt: true,
  submittedAt: true,
  completedAt: true,
  messageBody: true,
  allowMultipleFiles: true,
  requestedByUserId: true,
  engagement: { select: { id: true, title: true, taxYear: true } },
  items: {
    where: { status: { not: 'CANCELLED' } },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: itemSelect,
  },
} satisfies Prisma.DocumentRequestPacketSelect;
type PacketRow = Prisma.DocumentRequestPacketGetPayload<{ select: typeof packetSelect }>;

/** Whether an open packet's expiry has passed (it then takes nothing). */
const expired = (p: { status: string; expiresAt: Date | null }) =>
  p.status === 'OPEN' && p.expiresAt !== null && p.expiresAt.getTime() <= Date.now();

/** The client's view of the packet (contract: MyRequestPacketView). */
export function packetView(p: {
  status: string;
  expiresAt: Date | null;
  items: { required: boolean; status: string }[];
}): MyRequestPacketView {
  if (p.status === 'SUBMITTED' || p.status === 'COMPLETED') return p.status;
  if (expired(p)) return 'EXPIRED';
  const required = p.items.filter((i) => i.required);
  if (required.length > 0 && required.every((i) => answered(i.status))) return 'READY';
  return p.items.some((i) => answered(i.status)) ? 'IN_PROGRESS' : 'NOT_STARTED';
}

export function progressOf(items: { required: boolean; status: string }[]) {
  const required = items.filter((i) => i.required);
  return {
    requiredTotal: required.length,
    requiredAnswered: required.filter((i) => answered(i.status)).length,
    itemsTotal: items.length,
    itemsAnswered: items.filter((i) => answered(i.status)).length,
  };
}

/** The firm's message with the two variables it names resolved ({Client Name}, {Due Date}). */
export function resolveMessage(
  body: string | null,
  values: { clientName: string; dueOn: Date | null },
): string | null {
  if (!body?.trim()) return null;
  const due = values.dueOn
    ? values.dueOn.toLocaleDateString('en-US', {
        timeZone: 'UTC',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : '';
  return body.replaceAll('{Client Name}', values.clientName).replaceAll('{Due Date}', due);
}

/**
 * Request packets in the client portal (R55, contract packages/types/src/documents/portal-packets.ts;
 * Frame 7, Document Request & Upload). The client comes from the session's login, never the URL;
 * only their own sent packets addressed to them (never a DRAFT, a CANCELLED one or a member's).
 * An AUTHORIZED login sees the open ones (OPEN, SUBMITTED) and its own uploads only, and never
 * submits (403), as for "I don't have this". Items are answered through the ordinary portal
 * upload (`findTarget` takes an item of an open packet). Every read and the submit are audited
 * with ids only.
 */
@Injectable()
export class MyPacketsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** The packets this login may see; null when it has no client. */
  private where(login: PortalLogin): Prisma.DocumentRequestPacketWhereInput | null {
    if (!login.clientId) return null;
    return {
      businessId: login.businessId,
      clientId: login.clientId,
      recipientKind: 'CLIENT',
      status: { in: login.household ? ['OPEN', 'SUBMITTED', 'COMPLETED'] : ['OPEN', 'SUBMITTED'] },
    };
  }

  private toRow(p: PacketRow): MyRequestPacketRow {
    const status = p.status as MyRequestPacketRow['status'];
    return {
      id: p.id,
      reference: reference(p.number),
      title: p.title,
      service: { id: p.engagement.id, title: p.engagement.title },
      status,
      view: packetView(p),
      dueOn: day(p.dueOn),
      overdue: p.status === 'OPEN' && p.dueOn !== null && day(p.dueOn)! < todayUtc(),
      progress: progressOf(p.items),
      // A packet the client sees was sent, so the database stamped it.
      sentAt: (p.sentAt ?? new Date(0)).toISOString(),
      submittedAt: p.submittedAt?.toISOString() ?? null,
    };
  }

  async list(caller: PortalCaller): Promise<MyRequestPacketRow[]> {
    const { rows, clientId } = await this.inFirm(caller.businessId, async (tx) => {
      const login = await portalLogin(tx, caller);
      const where = this.where(login);
      if (!where) return { rows: [], clientId: null };
      const found = await tx.documentRequestPacket.findMany({
        where,
        orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
        take: MAX_PACKETS,
        select: packetSelect,
      });
      return { rows: found, clientId: login.clientId };
    });
    // Open ones first (the soonest due first, no date last), then the newest.
    const open = (p: PacketRow) => p.status === 'OPEN';
    const items = rows
      .sort((a, b) => {
        if (open(a) !== open(b)) return open(a) ? -1 : 1;
        if (!open(a)) return 0;
        const x = day(a.dueOn) ?? '9999-12-31';
        const y = day(b.dueOn) ?? '9999-12-31';
        return x.localeCompare(y);
      })
      .map((p) => this.toRow(p));
    if (clientId) {
      await this.audit.log(
        'request_packets.listed',
        { type: 'client', id: clientId },
        { count: items.length, clientAccountId: caller.clientAccountId },
      );
    }
    return items;
  }

  /** The packet in the client's shape, read in `tx` (404 when this login may not see it). */
  private async read(tx: TxClient, login: PortalLogin, id: string): Promise<MyRequestPacket> {
    const where = this.where(login);
    const p = where
      ? await tx.documentRequestPacket.findFirst({ where: { ...where, id }, select: packetSelect })
      : null;
    if (!p) throw notFound();
    const files = await tx.document.findMany({
      where: {
        ...visible(login, 'MINE'),
        requestId: { in: p.items.map((i) => i.id) },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: documentSelect,
    });
    const [client, people] = await Promise.all([
      tx.client.findFirst({ where: { id: login.clientId! }, select: { displayName: true } }),
      peopleOf(tx, [p.requestedByUserId, ...files.map((f) => f.uploadedByUserId)]),
    ]);
    const open = p.status === 'OPEN' && !expired(p);
    const items: MyRequestPacketItem[] = p.items.map((i) => ({
      id: i.id,
      title: i.title,
      instructions: i.instructions,
      required: i.required,
      category: i.category,
      status: i.status as MyRequestPacketItem['status'],
      statusNote: i.statusNote,
      files: files
        .filter((f) => f.requestId === i.id)
        .slice(0, MAX_FILES)
        .map((f) => toMyDocument(f, people)),
      canUpload: open && (PACKET_UPLOADABLE as readonly string[]).includes(i.status),
    }));
    const requiredDone = p.items.filter((i) => i.required).every((i) => answered(i.status));
    const requestedBy = p.requestedByUserId ? people.get(p.requestedByUserId) : undefined;
    return {
      ...this.toRow(p),
      message: resolveMessage(p.messageBody, {
        clientName: client?.displayName ?? '',
        dueOn: p.dueOn,
      }),
      requestedBy: requestedBy && !requestedBy.byClient ? requestedBy.name : null,
      taxYear: p.engagement.taxYear,
      expiresAt: p.expiresAt?.toISOString() ?? null,
      allowMultipleFiles: p.allowMultipleFiles,
      items,
      canSubmit: open && login.household && requiredDone,
      activity: activityOf(p, files),
    };
  }

  async get(caller: PortalCaller, id: string): Promise<MyRequestPacket> {
    const packet = await this.inFirm(caller.businessId, async (tx) =>
      this.read(tx, await portalLogin(tx, caller), id),
    );
    await this.audit.log(
      'request_packet.viewed',
      { type: 'document_request_packet', id },
      { clientAccountId: caller.clientAccountId },
    );
    return packet;
  }

  /**
   * Submit for Review: 403 for an AUTHORIZED login, 404 for a packet this login may not see,
   * then 409 PACKET_CLOSED (not OPEN, or expired) or PACKET_INCOMPLETE (a required item not
   * answered). The packet is locked first; an upload locks its item, then the packet (FOR SHARE),
   * so one waits for the other and never sees a half-made change.
   */
  async submit(caller: PortalCaller, id: string): Promise<MyRequestPacket> {
    return this.inFirm(caller.businessId, async (tx) => {
      const login = await portalLogin(tx, caller);
      const where = this.where(login);
      if (!where) throw notFound();
      if (!login.household) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'Ask the account holder to submit this request.',
        });
      }
      const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM document_request_packets
        WHERE business_id = ${caller.businessId}::uuid AND id = ${id}::uuid
          AND client_id = ${login.clientId}::uuid AND recipient_kind = 'CLIENT'
          AND status IN ('OPEN', 'SUBMITTED', 'COMPLETED')
        FOR UPDATE`;
      if (!locked) throw notFound();
      const p = await tx.documentRequestPacket.findFirstOrThrow({
        where: { id },
        select: {
          status: true,
          expiresAt: true,
          items: {
            where: { status: { not: 'CANCELLED' } },
            select: { required: true, status: true },
          },
        },
      });
      if (p.status !== 'OPEN' || expired(p)) throw refusal('PACKET_CLOSED');
      if (!p.items.filter((i) => i.required).every((i) => answered(i.status))) {
        throw refusal('PACKET_INCOMPLETE');
      }
      await tx.documentRequestPacket.update({ where: { id }, data: { status: 'SUBMITTED' } });
      await this.audit.logIn(
        tx,
        'request_packet.submitted',
        { type: 'document_request_packet', id },
        { clientId: login.clientId, clientAccountId: caller.clientAccountId },
        { businessId: caller.businessId },
      );
      return this.read(tx, login, id);
    });
  }
}

/** The Activity tab, oldest first, from the records' own times (never a file's contents). */
function activityOf(
  p: PacketRow,
  files: { requestId: string | null; createdAt: Date; direction: string }[],
): MyRequestPacketEvent[] {
  const title = new Map(p.items.map((i) => [i.id, i.title]));
  const events: MyRequestPacketEvent[] = [];
  if (p.sentAt)
    events.push({ at: p.sentAt.toISOString(), kind: 'SENT', itemTitle: null, by: 'FIRM' });
  for (const f of files) {
    if (!f.requestId || f.direction !== 'CLIENT_TO_FIRM') continue;
    events.push({
      at: f.createdAt.toISOString(),
      kind: 'UPLOADED',
      itemTitle: title.get(f.requestId) ?? null,
      by: 'YOU',
    });
  }
  // An item's latest answer or review: accepted is stamped (resolvedAt); a request asked again
  // or answered "I don't have this" changed last when it took that status (updatedAt).
  for (const i of p.items) {
    const at =
      i.status === 'ACCEPTED'
        ? i.resolvedAt
        : i.status === 'REJECTED' || i.status === 'NOT_AVAILABLE'
          ? i.updatedAt
          : null;
    if (!at) continue;
    const kind = i.status as 'ACCEPTED' | 'REJECTED' | 'NOT_AVAILABLE';
    events.push({
      at: at.toISOString(),
      kind,
      itemTitle: i.title,
      by: kind === 'NOT_AVAILABLE' ? 'YOU' : 'FIRM',
    });
  }
  if (p.submittedAt)
    events.push({ at: p.submittedAt.toISOString(), kind: 'SUBMITTED', itemTitle: null, by: 'YOU' });
  if (p.completedAt)
    events.push({
      at: p.completedAt.toISOString(),
      kind: 'COMPLETED',
      itemTitle: null,
      by: 'FIRM',
    });
  return events.sort((a, b) => a.at.localeCompare(b.at)).slice(-200);
}
