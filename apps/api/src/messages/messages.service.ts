import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { databaseErrorCode, type Database, type Prisma, type TxClient } from '@firmivra/db';
import { MESSAGE_SETTINGS_DEFAULTS } from '@firmivra/types';
import type {
  CreateMessageThreadRequest,
  CreateMyMessageThreadRequest,
  FirmUnreadCount,
  ListMessageThreadsQuery,
  ListMyMessagesQuery,
  Message,
  MessageAttachment,
  MessageDirection,
  MessageSender,
  MessageThread,
  MessageThreadDetail,
  MessageThreadList,
  MyMessage,
  MyMessageFrom,
  MyMessageThread,
  MyMessageThreadDetail,
  MyMessageThreadList,
  UnreadCount,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import {
  type ClientsActor,
  decodeCursor,
  encodeCursor,
  likeEscape,
} from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';
import { MessageNotices } from './message-notices.js';

type FirmListQuery = z.output<typeof ListMessageThreadsQuery>;
type MyListQuery = z.output<typeof ListMyMessagesQuery>;
type CreateBody = z.output<typeof CreateMessageThreadRequest>;
type MyCreateBody = z.output<typeof CreateMyMessageThreadRequest>;

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const conflict = (code: string, message: string) => new ConflictException({ code, message });
const repliesClosed = () => conflict('REPLIES_CLOSED', 'Replies are closed on this thread');
const nothingToMark = () => conflict('NOTHING_TO_MARK', 'There is no message to mark unread');
const badRequest = (code: string, message: string) => new BadRequestException({ code, message });
const MB = 1024 * 1024;
const CHECK_VIOLATION = '23514';
const EXCERPT = 140;

const threadSelect = {
  id: true,
  clientId: true,
  engagementId: true,
  subject: true,
  entityType: true,
  entityId: true,
  repliesEnabled: true,
  lastMessageAt: true,
  createdByUserId: true,
  archivedAt: true,
  createdAt: true,
  client: { select: { displayName: true } },
} satisfies Prisma.MessageThreadSelect;
type ThreadRow = Prisma.MessageThreadGetPayload<{ select: typeof threadSelect }>;

const messageSelect = {
  id: true,
  threadId: true,
  senderUserId: true,
  direction: true,
  body: true,
  readAt: true,
  createdAt: true,
  attachments: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      document: {
        select: {
          id: true,
          fileName: true,
          contentType: true,
          sizeBytes: true,
          scanStatus: true,
          direction: true,
          uploadedByUserId: true,
        },
      },
    },
  },
  // MSG-F12: the files New Message sent with it, through the delivery that wrote it.
  outboundRecipients: {
    take: 1,
    select: {
      outbound: {
        select: {
          files: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              fileName: true,
              contentType: true,
              sizeBytes: true,
              scanStatus: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.MessageSelect;
type MessageRow = Prisma.MessageGetPayload<{ select: typeof messageSelect }>;
type AttachedDocument = MessageRow['attachments'][number]['document'];
/** A thread's latest message, for list rows: no files. */
type LastRow = Omit<MessageRow, 'attachments' | 'outboundRecipients'>;

/** A message's file as both sides show it; the download link is Documents' own (CLEAN only). */
const attachment = (d: AttachedDocument): MessageAttachment => ({
  kind: 'DOCUMENT',
  id: d.id,
  fileName: d.fileName,
  contentType: d.contentType,
  sizeBytes: d.sizeBytes,
  status: d.scanStatus === 'CLEAN' ? 'READY' : d.scanStatus === 'PENDING' ? 'CHECKING' : 'BLOCKED',
});

/** The files New Message sent with a message (MSG-F12), opened through Messages. */
const sentFiles = (m: Pick<MessageRow, 'outboundRecipients'>): MessageAttachment[] =>
  (m.outboundRecipients[0]?.outbound.files ?? []).map((f) => ({
    kind: 'FILE',
    id: f.id,
    fileName: f.fileName,
    contentType: f.contentType,
    sizeBytes: f.sizeBytes,
    status:
      f.scanStatus === 'CLEAN' ? 'READY' : f.scanStatus === 'PENDING' ? 'CHECKING' : 'BLOCKED',
  }));

/** Names of the people who write in this firm: staff by membership, clients by portal login. */
type People = Map<string, { kind: MessageSender['kind']; name: string }>;

const related = (t: ThreadRow) =>
  t.entityType && t.entityId ? { type: t.entityType, id: t.entityId } : null;
/** The side that receives messages of this direction. */
const inbound = (side: 'firm' | 'client'): MessageDirection =>
  side === 'firm' ? 'CLIENT_TO_FIRM' : 'FIRM_TO_CLIENT';
const pageWhere = (cursor?: string): Prisma.MessageThreadWhereInput => {
  if (!cursor) return {};
  const after = decodeCursor(cursor);
  return {
    OR: [
      { lastMessageAt: { lt: after.createdAt } },
      { lastMessageAt: after.createdAt, id: { lt: after.id } },
    ],
  };
};
/** The subject and the messages' text (the portal's search). */
const textWhere = (search?: string): Prisma.MessageThreadWhereInput => {
  if (!search) return {};
  const term = likeEscape(search);
  return {
    OR: [
      { subject: { contains: term, mode: 'insensitive' } },
      { messages: { some: { body: { contains: term, mode: 'insensitive' } } } },
    ],
  };
};
/** A search that is a full phone number in any format: its digits (7 to 15), else null. */
export const phoneDigits = (search: string): string | null => {
  if (!/^[+\d\s().-]+$/.test(search)) return null;
  const digits = search.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
};
/**
 * MSG-F01: the subject, the messages' text, and the client's name and email; a phone number by
 * its digits, so "(404) 555-0187", "404.555.0187" and "+1 404 555 0187" find the same client.
 * Ten digits or more compare the last ten (the number without its country code).
 */
async function searchWhere(
  tx: TxClient,
  businessId: string,
  search?: string,
): Promise<Prisma.MessageThreadWhereInput> {
  if (!search) return {};
  const digits = phoneDigits(search);
  const phoned = digits
    ? await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM clients
        WHERE business_id = ${businessId}::uuid AND phone IS NOT NULL AND (
          CASE WHEN length(${digits}::text) >= 10
            THEN right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = right(${digits}::text, 10)
            ELSE regexp_replace(phone, '[^0-9]', '', 'g') LIKE '%' || ${digits}::text || '%'
          END)`
    : [];
  const term = likeEscape(search);
  return {
    OR: [
      ...(textWhere(search).OR ?? []),
      { client: { displayName: { contains: term, mode: 'insensitive' } } },
      { client: { email: { contains: term, mode: 'insensitive' } } },
      ...(phoned.length > 0 ? [{ clientId: { in: phoned.map((c) => c.id) } }] : []),
    ],
  };
}
const ORDER = [
  { lastMessageAt: 'desc' },
  { id: 'desc' },
] satisfies Prisma.MessageThreadOrderByWithRelationInput[];
const nextCursor = (rows: ThreadRow[], limit: number) => {
  const last = rows[limit - 1];
  return rows.length > limit && last?.lastMessageAt
    ? encodeCursor({ createdAt: last.lastMessageAt, id: last.id })
    : null;
};

/**
 * Messages between a firm and its clients (R20; contract in packages/types/src/messages). Every
 * query runs in the firm's business scope with `businessId` from TenantGuard. Owner and Admin
 * reach every client's threads; Staff only their assigned clients' (others are 404). Portal
 * calls take the client from the session's ClientAccount. A GET never changes read state. The
 * audit log gets ids only, never a subject or a message's text.
 */
@Injectable()
export class MessagesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly notices: MessageNotices,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  private reach(actor: ClientsActor): Prisma.ClientWhereInput {
    return actor.role === 'STAFF' ? { assignedUserId: actor.userId } : {};
  }

  private async people(tx: TxClient, businessId: string, userIds: string[]): Promise<People> {
    const ids = [...new Set(userIds)];
    const people: People = new Map();
    if (ids.length === 0) return people;
    const [members, logins] = await Promise.all([
      tx.membership.findMany({
        where: { businessId, userId: { in: ids } },
        select: { userId: true, user: { select: { name: true } } },
      }),
      tx.clientAccount.findMany({
        where: { businessId, userId: { in: ids } },
        select: { userId: true, user: { select: { name: true } } },
      }),
    ]);
    for (const m of members) people.set(m.userId, { kind: 'STAFF', name: m.user.name });
    for (const c of logins) people.set(c.userId, { kind: 'CLIENT', name: c.user.name });
    return people;
  }

  private sender(people: People, userId: string, direction: MessageDirection): MessageSender {
    const p = people.get(userId);
    const kind = direction === 'FIRM_TO_CLIENT' ? 'STAFF' : 'CLIENT';
    return { kind, userId, name: p?.name ?? (kind === 'STAFF' ? 'Former staff' : 'Client') };
  }

  /** The latest message of each thread, with no more than one row per thread. */
  private async lastMessages(tx: TxClient, businessId: string, threadIds: string[]) {
    if (threadIds.length === 0) return new Map<string, LastRow>();
    const rows = await tx.$queryRaw<
      {
        id: string;
        thread_id: string;
        sender_user_id: string;
        direction: MessageDirection;
        body: string;
        read_at: Date | null;
        created_at: Date;
      }[]
    >`
      SELECT DISTINCT ON (thread_id) id, thread_id, sender_user_id, direction, body, read_at, created_at
      FROM messages
      WHERE business_id = ${businessId}::uuid AND thread_id = ANY(${threadIds}::uuid[])
      ORDER BY thread_id, created_at DESC, id DESC`;
    return new Map<string, LastRow>(
      rows.map((r) => [
        r.thread_id,
        {
          id: r.id,
          threadId: r.thread_id,
          senderUserId: r.sender_user_id,
          direction: r.direction,
          body: r.body,
          readAt: r.read_at,
          createdAt: r.created_at,
        },
      ]),
    );
  }

  /** Unread messages per thread for one receiving side. */
  private async unreadByThread(
    tx: TxClient,
    businessId: string,
    threadIds: string[],
    side: 'firm' | 'client',
  ): Promise<Map<string, number>> {
    if (threadIds.length === 0) return new Map();
    const rows = await tx.message.groupBy({
      by: ['threadId'],
      where: { businessId, threadId: { in: threadIds }, direction: inbound(side), readAt: null },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.threadId, r._count._all]));
  }

  // ----- Firm side -----

  /** The threads an automation's Send client message opened (the Automations view). */
  private async automated(tx: TxClient, businessId: string, threadIds: string[]) {
    if (threadIds.length === 0) return new Set<string>();
    const rows = await tx.automationActionExecution.findMany({
      where: { businessId, resultKind: 'message_thread', resultId: { in: threadIds } },
      select: { resultId: true },
    });
    return new Set(rows.flatMap((r) => (r.resultId ? [r.resultId] : [])));
  }

  private async firmThreads(tx: TxClient, businessId: string, rows: ThreadRow[]) {
    const ids = rows.map((t) => t.id);
    const [last, unread, automated] = await Promise.all([
      this.lastMessages(tx, businessId, ids),
      this.unreadByThread(tx, businessId, ids, 'firm'),
      this.automated(tx, businessId, ids),
    ]);
    const people = await this.people(tx, businessId, [
      ...rows.flatMap((t) => (t.createdByUserId ? [t.createdByUserId] : [])),
      ...[...last.values()].map((m) => m.senderUserId),
    ]);
    return rows.map((t): MessageThread => {
      // The firm's queries read client threads only; a lead's (r1_message_thread_lead) has no client.
      if (!t.clientId || !t.client) throw new Error(`message thread ${t.id} has no client`);
      const m = last.get(t.id);
      const starter = t.createdByUserId ? people.get(t.createdByUserId) : undefined;
      return {
        id: t.id,
        client: { id: t.clientId, displayName: t.client.displayName },
        engagementId: t.engagementId,
        subject: t.subject,
        related: related(t),
        repliesEnabled: t.repliesEnabled,
        startedBy:
          t.createdByUserId && starter
            ? { kind: starter.kind, userId: t.createdByUserId, name: starter.name }
            : null,
        lastMessage: m
          ? {
              direction: m.direction,
              senderName: this.sender(people, m.senderUserId, m.direction).name,
              excerpt: m.body.replace(/\s+/g, ' ').trim().slice(0, EXCERPT),
              createdAt: m.createdAt.toISOString(),
            }
          : null,
        unreadCount: unread.get(t.id) ?? 0,
        automated: automated.has(t.id),
        archivedAt: t.archivedAt?.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
      };
    });
  }

  private async firmDetail(
    tx: TxClient,
    businessId: string,
    t: ThreadRow,
  ): Promise<MessageThreadDetail> {
    const [thread] = await this.firmThreads(tx, businessId, [t]);
    const rows = await tx.message.findMany({
      where: { businessId, threadId: t.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: messageSelect,
    });
    const people = await this.people(
      tx,
      businessId,
      rows.map((m) => m.senderUserId),
    );
    return { ...(thread as MessageThread), messages: rows.map((m) => this.toMessage(people, m)) };
  }

  private toMessage(people: People, m: MessageRow): Message {
    return {
      id: m.id,
      threadId: m.threadId,
      direction: m.direction,
      sender: this.sender(people, m.senderUserId, m.direction),
      body: m.body,
      readAt: m.readAt?.toISOString() ?? null,
      attachments: [...m.attachments.map((a) => attachment(a.document)), ...sentFiles(m)],
      createdAt: m.createdAt.toISOString(),
    };
  }

  /** The thread, if its client is in the actor's reach; `forChange` locks it first. */
  private async thread(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    id: string,
    forChange = false,
  ): Promise<ThreadRow> {
    if (forChange) {
      await tx.$queryRaw`
        SELECT 1 FROM message_threads WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid
        FOR UPDATE`;
    }
    const row = await tx.messageThread.findFirst({
      where: { businessId, id, clientId: { not: null }, client: this.reach(actor) },
      select: threadSelect,
    });
    if (!row) throw notFound();
    return row;
  }

  private async list(
    businessId: string,
    actor: ClientsActor,
    q: FirmListQuery,
    clientId?: string,
  ): Promise<MessageThreadList> {
    const result = await this.inFirm(businessId, async (tx) => {
      if (clientId) {
        const client = await tx.client.findFirst({
          where: { AND: [{ businessId, id: clientId }, this.reach(actor)] },
          select: { id: true },
        });
        if (!client) throw notFound();
      }
      const rows = await tx.messageThread.findMany({
        where: {
          AND: [
            { businessId, clientId: { not: null }, client: this.reach(actor) },
            clientId ? { clientId } : {},
            q.unread ? { messages: { some: { direction: 'CLIENT_TO_FIRM', readAt: null } } } : {},
            { archivedAt: q.archived ? { not: null } : null },
            await searchWhere(tx, businessId, q.search),
            pageWhere(q.cursor),
          ],
        },
        orderBy: ORDER,
        take: q.limit + 1,
        select: threadSelect,
      });
      return {
        items: await this.firmThreads(tx, businessId, rows.slice(0, q.limit)),
        nextCursor: nextCursor(rows, q.limit),
      };
    });
    await this.audit.log(
      'message_threads.listed',
      clientId ? { type: 'client', id: clientId } : { type: 'message_thread' },
      { count: result.items.length },
    );
    return result;
  }

  inbox(businessId: string, actor: ClientsActor, q: FirmListQuery): Promise<MessageThreadList> {
    return this.list(businessId, actor, q);
  }

  listForClient(
    businessId: string,
    actor: ClientsActor,
    clientId: string,
    q: FirmListQuery,
  ): Promise<MessageThreadList> {
    return this.list(businessId, actor, q, clientId);
  }

  async get(businessId: string, actor: ClientsActor, id: string): Promise<MessageThreadDetail> {
    const detail = await this.inFirm(businessId, async (tx) =>
      this.firmDetail(tx, businessId, await this.thread(tx, businessId, actor, id)),
    );
    await this.audit.log('message_thread.viewed', { type: 'message_thread', id });
    return detail;
  }

  /**
   * A new thread with its first message. `emailNotice: false` (New Message's Email channel, which
   * emails its own notice to the client's address) keeps the bell item and skips this email.
   */
  async create(
    businessId: string,
    actor: ClientsActor,
    clientId: string,
    body: CreateBody,
    options: { emailNotice?: boolean; assignedUserId?: string | null } = {},
  ): Promise<MessageThreadDetail> {
    const detail = await this.inFirm(businessId, async (tx) => {
      await tx.$queryRaw`
        SELECT 1 FROM clients WHERE business_id = ${businessId}::uuid AND id = ${clientId}::uuid
        FOR SHARE`;
      const client = await tx.client.findFirst({
        where: { AND: [{ businessId, id: clientId }, this.reach(actor)] },
        select: { archivedAt: true },
      });
      if (!client) throw notFound();
      if (client.archivedAt) throw conflict('CLIENT_ARCHIVED', 'Restore the client first');
      if (body.engagementId) {
        const engagement = await tx.engagement.findFirst({
          where: { businessId, clientId, id: body.engagementId },
          select: { id: true },
        });
        if (!engagement) throw notFound();
      }
      const thread = await tx.messageThread.create({
        data: {
          businessId,
          clientId,
          engagementId: body.engagementId ?? null,
          subject: body.subject,
          entityType: body.related?.type ?? null,
          entityId: body.related?.id ?? null,
          repliesEnabled: body.repliesEnabled ?? true,
          createdByUserId: actor.userId,
          assignedUserId: options.assignedUserId ?? null,
        },
        select: { id: true },
      });
      const message = await tx.message.create({
        data: {
          businessId,
          threadId: thread.id,
          senderUserId: actor.userId,
          direction: 'FIRM_TO_CLIENT',
          body: body.body,
        },
        select: { id: true },
      });
      await this.audit.logIn(
        tx,
        'message_thread.created',
        { type: 'message_thread', id: thread.id },
        {
          clientId,
          messageId: message.id,
        },
      );
      return this.firmDetail(tx, businessId, await this.thread(tx, businessId, actor, thread.id));
    });
    await this.notify(
      businessId,
      detail.id,
      detail.messages[0]?.id,
      actor.userId,
      'client',
      options.emailNotice ?? true,
    );
    return detail;
  }

  async send(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: string,
    documentIds: readonly string[] = [],
  ): Promise<Message> {
    const sent = await this.inFirm(businessId, async (tx) => {
      const t = await this.thread(tx, businessId, actor, id);
      // The same lock as a client reply: two messages on one thread queue, so only the first of
      // an unread run is emailed.
      await this.lockThread(tx, businessId, t.id);
      const email = await this.firstUnread(tx, businessId, t.id, 'FIRM_TO_CLIENT');
      const row = await tx.message.create({
        data: {
          businessId,
          threadId: t.id,
          senderUserId: actor.userId,
          direction: 'FIRM_TO_CLIENT',
          body,
        },
        select: { id: true },
      });
      const attached = await this.attach(tx, businessId, t.clientId, row.id, documentIds);
      await this.audit.logIn(
        tx,
        'message.sent',
        { type: 'message', id: row.id },
        {
          threadId: t.id,
          clientId: t.clientId,
          ...(attached.length ? { documentIds: attached } : {}),
        },
      );
      const sent = await tx.message.findUniqueOrThrow({
        where: { id: row.id },
        select: messageSelect,
      });
      return {
        threadId: t.id,
        email,
        message: this.toMessage(await this.people(tx, businessId, [actor.userId]), sent),
      };
    });
    await this.notify(
      businessId,
      sent.threadId,
      sent.message.id,
      actor.userId,
      'client',
      sent.email,
    );
    return sent.message;
  }

  /**
   * MSG-F12: files on the firm's reply are the thread client's own documents that the client can
   * see (shared, or their uploads; never internal, trashed or archived), within the firm's
   * Messages Settings. A file still being scanned may go (the client opens it once it passes, as
   * in My Documents); a blocked one may not. Another client's or firm's document is 404.
   */
  private async attach(
    tx: TxClient,
    businessId: string,
    clientId: string | null,
    messageId: string,
    documentIds: readonly string[],
  ): Promise<string[]> {
    if (documentIds.length === 0) return [];
    // A lead's thread has no documents to open.
    if (!clientId)
      throw badRequest(
        'ATTACHMENT_NEEDS_CLIENT',
        "Files go from a client's documents; a lead has none",
      );
    const ids = [...new Set(documentIds.map((d) => d.toLowerCase()))];
    const [docs, settings] = await Promise.all([
      tx.document.findMany({
        where: { businessId, clientId, id: { in: ids }, trashedAt: null, archivedAt: null },
        select: { id: true, direction: true, fileName: true, sizeBytes: true, scanStatus: true },
      }),
      tx.messageSettings.findUnique({
        where: { businessId },
        select: { attachmentMaxMb: true, allowedAttachmentTypes: true },
      }),
    ]);
    const types: readonly string[] =
      settings?.allowedAttachmentTypes ?? MESSAGE_SETTINGS_DEFAULTS.allowedAttachmentTypes;
    const maxMb = settings?.attachmentMaxMb ?? MESSAGE_SETTINGS_DEFAULTS.attachmentMaxMb;
    const byId = new Map(docs.map((d) => [d.id, d]));
    for (const id of ids) {
      const d = byId.get(id);
      if (!d) throw notFound();
      if (d.direction === 'INTERNAL')
        throw conflict(
          'ATTACHMENT_NOT_SHARED',
          `${d.fileName} is internal: share it with the client in Documents first`,
        );
      if (d.scanStatus === 'INFECTED' || d.scanStatus === 'FAILED')
        throw conflict('FILE_BLOCKED', `${d.fileName} failed its security check`);
      const ext = d.fileName.toLowerCase().split('.').pop() ?? '';
      if (!types.includes(ext))
        throw badRequest('ATTACHMENT_TYPE', `Messages Settings don't allow .${ext} files`);
      if (d.sizeBytes > maxMb * MB)
        throw badRequest('ATTACHMENT_TOO_LARGE', `${d.fileName} is over ${maxMb} MB`);
    }
    await tx.messageAttachment.createMany({
      data: ids.map((documentId) => ({ businessId, messageId, documentId })),
    });
    return ids;
  }

  async setReplies(
    businessId: string,
    actor: ClientsActor,
    id: string,
    repliesEnabled: boolean,
  ): Promise<MessageThread> {
    return this.inFirm(businessId, async (tx) => {
      const t = await this.thread(tx, businessId, actor, id, true);
      if (t.repliesEnabled !== repliesEnabled) {
        await tx.messageThread.update({ where: { id: t.id }, data: { repliesEnabled } });
        await this.audit.logIn(
          tx,
          repliesEnabled ? 'message_thread.replies_opened' : 'message_thread.replies_closed',
          { type: 'message_thread', id: t.id },
          { clientId: t.clientId },
        );
      }
      const [thread] = await this.firmThreads(tx, businessId, [{ ...t, repliesEnabled }]);
      return thread as MessageThread;
    });
  }

  async markRead(businessId: string, actor: ClientsActor, id: string): Promise<MessageThread> {
    return this.inFirm(businessId, async (tx) => {
      const t = await this.thread(tx, businessId, actor, id);
      await this.markSide(tx, businessId, t.id, 'firm', true);
      return (await this.firmThreads(tx, businessId, [t]))[0] as MessageThread;
    });
  }

  async markUnread(businessId: string, actor: ClientsActor, id: string): Promise<MessageThread> {
    return this.inFirm(businessId, async (tx) => {
      const t = await this.thread(tx, businessId, actor, id);
      await this.markSide(tx, businessId, t.id, 'firm', false);
      return (await this.firmThreads(tx, businessId, [t]))[0] as MessageThread;
    });
  }

  async firmUnreadCount(businessId: string, actor: ClientsActor): Promise<FirmUnreadCount> {
    const rows = await this.inFirm(
      businessId,
      (tx) =>
        tx.$queryRaw<{ client_id: string; count: bigint }[]>`
        SELECT t.client_id, count(*) AS count
        FROM messages m
        JOIN message_threads t ON t.business_id = m.business_id AND t.id = m.thread_id
        JOIN clients c ON c.business_id = t.business_id AND c.id = t.client_id
        WHERE m.business_id = ${businessId}::uuid
          AND m.direction = 'CLIENT_TO_FIRM' AND m.read_at IS NULL
          AND (${actor.role !== 'STAFF'} OR c.assigned_user_id = ${actor.userId}::uuid)
        GROUP BY t.client_id
        ORDER BY t.client_id`,
    );
    const byClient = rows.map((r) => ({ clientId: r.client_id, count: Number(r.count) }));
    return { total: byClient.reduce((sum, r) => sum + r.count, 0), byClient };
  }

  /** Read: every unread message to `side`. Unread: the latest message to `side` again. */
  private async markSide(
    tx: TxClient,
    businessId: string,
    threadId: string,
    side: 'firm' | 'client',
    read: boolean,
  ): Promise<void> {
    // The same lock as a new message: a read can't commit between a send's flood check and its
    // insert, which would leave the new message unread with no email.
    await this.lockThread(tx, businessId, threadId);
    const direction = inbound(side);
    if (read) {
      await tx.message.updateMany({
        where: { businessId, threadId, direction, readAt: null },
        data: { readAt: new Date() },
      });
      return;
    }
    const last = await tx.message.findFirst({
      where: { businessId, threadId, direction },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    if (!last) throw nothingToMark();
    await tx.message.update({ where: { id: last.id }, data: { readAt: null } });
  }

  // ----- Portal side -----

  /** The session's login and client (never from the URL). */
  private async me(tx: TxClient, businessId: string, clientAccountId: string) {
    const account = await tx.clientAccount.findFirst({
      where: { businessId, id: clientAccountId },
      select: { userId: true, clientId: true, status: true, portalRole: true },
    });
    if (!account?.clientId) throw notFound();
    return {
      userId: account.userId,
      clientId: account.clientId,
      active: account.status === 'ACTIVE',
      /** PRIMARY and SPOUSE see the household's files; AUTHORIZED only its own uploads. */
      household: account.portalRole === 'PRIMARY' || account.portalRole === 'SPOUSE',
    };
  }

  private mineFrom(
    people: People,
    me: string,
    userId: string | null,
  ): { from: MyMessageFrom; senderName: string | null } {
    if (userId === me) return { from: 'ME', senderName: null };
    const p = userId ? people.get(userId) : undefined;
    return p?.kind === 'CLIENT'
      ? { from: 'HOUSEHOLD', senderName: p.name }
      : { from: 'FIRM', senderName: null };
  }

  private async myThreads(
    tx: TxClient,
    businessId: string,
    me: string,
    rows: ThreadRow[],
  ): Promise<MyMessageThread[]> {
    const unread = await this.unreadByThread(
      tx,
      businessId,
      rows.map((t) => t.id),
      'client',
    );
    const people = await this.people(
      tx,
      businessId,
      rows.flatMap((t) => (t.createdByUserId ? [t.createdByUserId] : [])),
    );
    return rows.map((t) => ({
      id: t.id,
      subject: t.subject,
      ...this.mineFrom(people, me, t.createdByUserId),
      related: related(t),
      repliesEnabled: t.repliesEnabled,
      unreadCount: unread.get(t.id) ?? 0,
      lastMessageAt: (t.lastMessageAt ?? t.createdAt).toISOString(),
      createdAt: t.createdAt.toISOString(),
    }));
  }

  private async myDetail(
    tx: TxClient,
    businessId: string,
    me: string,
    t: ThreadRow,
    household: boolean,
  ): Promise<MyMessageThreadDetail> {
    const [thread] = await this.myThreads(tx, businessId, me, [t]);
    const rows = await tx.message.findMany({
      where: { businessId, threadId: t.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: messageSelect,
    });
    const people = await this.people(
      tx,
      businessId,
      rows.map((m) => m.senderUserId),
    );
    return {
      ...(thread as MyMessageThread),
      messages: rows.map((m) => this.toMine(people, me, m, household)),
    };
  }

  private toMine(people: People, me: string, m: MessageRow, household: boolean): MyMessage {
    const from =
      m.direction === 'FIRM_TO_CLIENT'
        ? { from: 'FIRM' as const, senderName: null }
        : this.mineFrom(people, me, m.senderUserId);
    return {
      id: m.id,
      ...from,
      body: m.body,
      unread: m.direction === 'FIRM_TO_CLIENT' && m.readAt === null,
      // My Documents' rule (storage/my-documents.service.ts `visible`): the firm's shared files and
      // the household's uploads for PRIMARY and SPOUSE; an AUTHORIZED login only its own uploads.
      // New Message's files are the firm's: PRIMARY and SPOUSE only (MSG-F12).
      attachments: [
        ...m.attachments
          .map((a) => a.document)
          .filter((d) =>
            d.direction === 'FIRM_TO_CLIENT'
              ? household
              : d.direction === 'CLIENT_TO_FIRM' && (household || d.uploadedByUserId === me),
          )
          .map(attachment),
        ...(household ? sentFiles(m) : []),
      ],
      createdAt: m.createdAt.toISOString(),
    };
  }

  private async myThread(tx: TxClient, businessId: string, clientId: string, id: string) {
    const row = await tx.messageThread.findFirst({
      where: { businessId, clientId, id },
      select: threadSelect,
    });
    if (!row) throw notFound();
    return row;
  }

  async myList(
    businessId: string,
    clientAccountId: string,
    q: MyListQuery,
  ): Promise<MyMessageThreadList> {
    const { clientId, result } = await this.inFirm(businessId, async (tx) => {
      const me = await this.me(tx, businessId, clientAccountId);
      const logins = await tx.clientAccount.findMany({
        where: { businessId, clientId: me.clientId },
        select: { userId: true },
      });
      const clientSide = logins.map((l) => l.userId);
      const filter: Prisma.MessageThreadWhereInput =
        q.filter === 'sent'
          ? { createdByUserId: me.userId }
          : q.filter === 'from-firm'
            ? { OR: [{ createdByUserId: null }, { createdByUserId: { notIn: clientSide } }] }
            : {};
      const rows = await tx.messageThread.findMany({
        where: {
          AND: [
            { businessId, clientId: me.clientId },
            filter,
            textWhere(q.search),
            pageWhere(q.cursor),
          ],
        },
        orderBy: ORDER,
        take: q.limit + 1,
        select: threadSelect,
      });
      return {
        clientId: me.clientId,
        result: {
          items: await this.myThreads(tx, businessId, me.userId, rows.slice(0, q.limit)),
          nextCursor: nextCursor(rows, q.limit),
        },
      };
    });
    await this.audit.log(
      'portal.message_threads_listed',
      { type: 'client', id: clientId },
      { count: result.items.length },
    );
    return result;
  }

  async myGet(
    businessId: string,
    clientAccountId: string,
    id: string,
  ): Promise<MyMessageThreadDetail> {
    const detail = await this.inFirm(businessId, async (tx) => {
      const me = await this.me(tx, businessId, clientAccountId);
      return this.myDetail(
        tx,
        businessId,
        me.userId,
        await this.myThread(tx, businessId, me.clientId, id),
        me.household,
      );
    });
    await this.audit.log('portal.message_thread_viewed', { type: 'message_thread', id });
    return detail;
  }

  async myCreate(
    businessId: string,
    clientAccountId: string,
    body: MyCreateBody,
  ): Promise<MyMessageThreadDetail> {
    const { detail, userId } = await this.inFirm(businessId, async (tx) => {
      const me = await this.writer(tx, businessId, clientAccountId);
      const thread = await tx.messageThread.create({
        data: {
          businessId,
          clientId: me.clientId,
          subject: body.subject,
          createdByUserId: me.userId,
        },
        select: { id: true },
      });
      const message = await tx.message.create({
        data: {
          businessId,
          threadId: thread.id,
          senderUserId: me.userId,
          direction: 'CLIENT_TO_FIRM',
          body: body.body,
        },
        select: { id: true },
      });
      await this.audit.logIn(
        tx,
        'message_thread.created',
        { type: 'message_thread', id: thread.id },
        {
          clientId: me.clientId,
          messageId: message.id,
        },
      );
      return {
        userId: me.userId,
        detail: await this.myDetail(
          tx,
          businessId,
          me.userId,
          await this.myThread(tx, businessId, me.clientId, thread.id),
          me.household,
        ),
      };
    });
    await this.notify(businessId, detail.id, detail.messages[0]?.id, userId, 'staff', true);
    return detail;
  }

  async myReply(
    businessId: string,
    clientAccountId: string,
    id: string,
    body: string,
  ): Promise<MyMessage> {
    let sent: { message: MyMessage; userId: string; threadId: string; email: boolean };
    try {
      sent = await this.inFirm(businessId, async (tx) => {
        const me = await this.writer(tx, businessId, clientAccountId);
        await this.lockThread(tx, businessId, id);
        const t = await this.myThread(tx, businessId, me.clientId, id);
        if (!t.repliesEnabled) throw repliesClosed();
        const email = await this.firstUnread(tx, businessId, t.id, 'CLIENT_TO_FIRM');
        const row = await tx.message.create({
          data: {
            businessId,
            threadId: t.id,
            senderUserId: me.userId,
            direction: 'CLIENT_TO_FIRM',
            body,
          },
          select: messageSelect,
        });
        await this.audit.logIn(
          tx,
          'message.sent',
          { type: 'message', id: row.id },
          {
            threadId: t.id,
            clientId: me.clientId,
          },
        );
        return {
          message: this.toMine(new Map(), me.userId, row, me.household),
          userId: me.userId,
          threadId: t.id,
          email,
        };
      });
    } catch (error) {
      // The database refuses with 23514 both for closed replies and for a login that is no
      // longer ACTIVE: only the first is REPLIES_CLOSED, so read the thread again to tell.
      if (databaseErrorCode(error) === CHECK_VIOLATION) {
        const thread = await this.database.forBusiness(businessId).messageThread.findFirst({
          where: { businessId, id },
          select: { repliesEnabled: true },
        });
        if (thread && !thread.repliesEnabled) throw repliesClosed();
      }
      throw error;
    }
    await this.notify(businessId, sent.threadId, sent.message.id, sent.userId, 'staff', sent.email);
    return sent.message;
  }

  /**
   * Locks the thread row for a new message. FOR NO KEY UPDATE: the firm can't close replies
   * between a client's check and the insert, and two messages queue instead of deadlocking on the
   * thread row the insert's trigger updates (two FOR SHARE locks would both wait on each other).
   */
  private async lockThread(tx: TxClient, businessId: string, id: string): Promise<void> {
    await tx.$queryRaw`
      SELECT 1 FROM message_threads WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid
      FOR NO KEY UPDATE`;
  }

  /**
   * Whether a new message in this direction starts an unread run (the flood rule: one email per
   * run). Read under the thread lock, before the insert, so two messages at once can't both see
   * an empty run.
   */
  private async firstUnread(
    tx: TxClient,
    businessId: string,
    threadId: string,
    direction: 'FIRM_TO_CLIENT' | 'CLIENT_TO_FIRM',
  ): Promise<boolean> {
    const unread = await tx.message.count({
      where: { businessId, threadId, direction, readAt: null },
    });
    return unread === 0;
  }

  /** The new message's notices, after it committed; they never fail the request. */
  private async notify(
    businessId: string,
    threadId: string,
    messageId: string | undefined,
    senderUserId: string,
    toSide: 'client' | 'staff',
    email: boolean,
  ): Promise<void> {
    if (!messageId) return;
    await this.notices.sent({ businessId, threadId, messageId, senderUserId, toSide, email });
  }

  async myMark(
    businessId: string,
    clientAccountId: string,
    id: string,
    read: boolean,
  ): Promise<MyMessageThread> {
    return this.inFirm(businessId, async (tx) => {
      const me = await this.me(tx, businessId, clientAccountId);
      const t = await this.myThread(tx, businessId, me.clientId, id);
      await this.markSide(tx, businessId, t.id, 'client', read);
      return (await this.myThreads(tx, businessId, me.userId, [t]))[0] as MyMessageThread;
    });
  }

  async myUnreadCount(businessId: string, clientAccountId: string): Promise<UnreadCount> {
    return this.inFirm(businessId, async (tx) => {
      const me = await this.me(tx, businessId, clientAccountId);
      const count = await tx.message.count({
        where: {
          businessId,
          direction: 'FIRM_TO_CLIENT',
          readAt: null,
          thread: { clientId: me.clientId },
        },
      });
      return { count };
    });
  }

  /** Only an ACTIVE login writes (the database agrees); a pending one reads nothing anyway. */
  private async writer(tx: TxClient, businessId: string, clientAccountId: string) {
    const me = await this.me(tx, businessId, clientAccountId);
    if (!me.active) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'This action is not permitted' });
    }
    return me;
  }
}
