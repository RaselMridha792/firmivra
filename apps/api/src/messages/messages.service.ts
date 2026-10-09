import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { databaseErrorCode, type Database, type Prisma, type TxClient } from '@firmivra/db';
import type {
  FirmMessage,
  ListMessageThreadsQuery,
  MessageDirection,
  MessageThread,
  MyMessage,
  MyMessageThread,
  UnreadMessageCount,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { likeEscape } from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';
import { decodeTimeCursor, encodeTimeCursor } from '../workspaces/paging.js';
import { MessageNotices } from './message-notices.js';

type ListQuery = Omit<z.output<typeof ListMessageThreadsQuery>, 'clientId'> & { clientId?: string };
type NewThread = {
  subject: string;
  body: string;
  attachmentDocumentIds?: string[] | undefined;
  engagementId?: string | undefined;
  repliesEnabled?: boolean | undefined;
};

/** Who is looking: a firm member (Staff reach their own clients) or a client's portal login. */
export type Viewer =
  | { kind: 'staff'; businessId: string; userId: string; role: 'OWNER' | 'ADMIN' | 'STAFF' }
  | { kind: 'client'; businessId: string; userId: string; clientAccountId: string };

export const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const repliesDisabled = () =>
  new ConflictException({ code: 'REPLIES_DISABLED', message: 'Replies are closed on this thread' });

/** The direction a viewer sends in; the other one is what they read (and count as unread). */
const outgoing = (v: Viewer): MessageDirection =>
  v.kind === 'staff' ? 'FIRM_TO_CLIENT' : 'CLIENT_TO_FIRM';
const incoming = (v: Viewer): MessageDirection =>
  v.kind === 'staff' ? 'CLIENT_TO_FIRM' : 'FIRM_TO_CLIENT';
const newestFirst = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];

const threadSelect = (unread: MessageDirection) =>
  ({
    id: true,
    clientId: true,
    engagementId: true,
    subject: true,
    repliesEnabled: true,
    lastMessageAt: true,
    createdAt: true,
    client: { select: { displayName: true } },
    messages: { orderBy: newestFirst, take: 1, select: { direction: true } },
    _count: { select: { messages: { where: { direction: unread, readAt: null } } } },
  }) satisfies Prisma.MessageThreadSelect;
type ThreadRow = Prisma.MessageThreadGetPayload<{ select: ReturnType<typeof threadSelect> }>;

const messageSelect = {
  id: true,
  direction: true,
  senderUserId: true,
  body: true,
  readAt: true,
  createdAt: true,
  attachments: {
    orderBy: { createdAt: 'asc' },
    select: {
      document: {
        select: { id: true, fileName: true, contentType: true, sizeBytes: true, direction: true },
      },
    },
  },
} satisfies Prisma.MessageSelect;
type MessageRow = Prisma.MessageGetPayload<{ select: typeof messageSelect }>;

/** The firm's row names the client; the portal's does not. */
function toThread(v: Viewer, row: ThreadRow): MessageThread | MyMessageThread {
  const thread: MyMessageThread = {
    id: row.id,
    engagementId: row.engagementId,
    subject: row.subject,
    repliesEnabled: row.repliesEnabled,
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    lastMessageDirection: row.messages[0]?.direction ?? null,
    unreadCount: row._count.messages,
    createdAt: row.createdAt.toISOString(),
  };
  return v.kind === 'client'
    ? thread
    : { ...thread, client: { id: row.clientId, displayName: row.client.displayName } };
}

/**
 * Message threads (R11 step 6; contract in packages/types/src/messages), for both sites. The firm
 * reaches its clients' threads (Staff: only their own clients'); a portal login reaches only its
 * own client's. Anything else is 404. Messages never change except their read state; the database
 * keeps the senders, the reply rule and `last_message_at`. Audited with ids only, never text.
 */
@Injectable()
export class MessagesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly notices: MessageNotices,
  ) {}

  private inFirm<T>(v: Viewer, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId: v.businessId }, fn);
  }

  /** The portal login's client (null while it has none), or the client a firm member reaches. */
  private async clientOf(tx: TxClient, v: Viewer, clientId?: string): Promise<string | null> {
    if (v.kind === 'client') {
      const account = await tx.clientAccount.findFirst({
        where: { businessId: v.businessId, id: v.clientAccountId },
        select: { clientId: true },
      });
      return account?.clientId ?? null;
    }
    if (!clientId) return null;
    const client = await tx.client.findFirst({
      where: {
        businessId: v.businessId,
        id: clientId,
        ...(v.role === 'STAFF' ? { assignedUserId: v.userId } : {}),
      },
      select: { id: true },
    });
    return client?.id ?? null;
  }

  /** The threads this viewer reaches. */
  private async reach(tx: TxClient, v: Viewer): Promise<Prisma.MessageThreadWhereInput> {
    if (v.kind === 'staff') {
      return v.role === 'STAFF' ? { client: { assignedUserId: v.userId } } : {};
    }
    const clientId = await this.clientOf(tx, v);
    return clientId ? { clientId } : { id: { in: [] } };
  }

  private async thread(tx: TxClient, v: Viewer, id: string): Promise<ThreadRow> {
    const row = await tx.messageThread.findFirst({
      where: { AND: [{ businessId: v.businessId, id }, await this.reach(tx, v)] },
      select: threadSelect(incoming(v)),
    });
    if (!row) throw notFound();
    return row;
  }

  /** Messages as this viewer sees them, with the senders' names. */
  private async present(tx: TxClient, v: Viewer, rows: MessageRow[]) {
    const users = await tx.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.senderUserId))] } },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r): FirmMessage | MyMessage => {
      const name = names.get(r.senderUserId) ?? '';
      const attachments = r.attachments
        // The client never sees an internal file (none is ever attached; defence in depth).
        .filter((a) => v.kind === 'staff' || a.document.direction !== 'INTERNAL')
        .map(({ document: { direction: _d, ...d } }) => d);
      const message = {
        id: r.id,
        direction: r.direction,
        body: r.body,
        readAt: r.readAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        attachments,
      };
      return v.kind === 'staff'
        ? { ...message, sender: { userId: r.senderUserId, name } }
        : { ...message, fromMe: r.senderUserId === v.userId, senderName: name };
    });
  }

  async list(v: Viewer, q: ListQuery) {
    const after = q.cursor ? decodeTimeCursor(q.cursor) : undefined;
    const rows = await this.inFirm(v, async (tx) =>
      tx.messageThread.findMany({
        where: {
          AND: [
            { businessId: v.businessId, lastMessageAt: { not: null } },
            await this.reach(tx, v),
            q.clientId ? { clientId: q.clientId } : {},
            q.unreadOnly ? { messages: { some: { direction: incoming(v), readAt: null } } } : {},
            q.direction ? { messages: { some: { direction: q.direction } } } : {},
            q.search ? { subject: { contains: likeEscape(q.search), mode: 'insensitive' } } : {},
            after
              ? {
                  OR: [
                    { lastMessageAt: { lt: after.at } },
                    { lastMessageAt: after.at, id: { lt: after.id } },
                  ],
                }
              : {},
          ],
        },
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
        select: threadSelect(incoming(v)),
      }),
    );
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    await this.audit.log(
      'message_threads.listed',
      { type: 'message_thread' },
      { count: page.length, ...(q.clientId ? { clientId: q.clientId } : {}) },
    );
    return {
      items: page.map((row) => toThread(v, row)),
      nextCursor:
        rows.length > q.limit && last?.lastMessageAt
          ? encodeTimeCursor({ at: last.lastMessageAt, id: last.id })
          : null,
    };
  }

  async unreadCount(v: Viewer): Promise<UnreadMessageCount> {
    return this.inFirm(v, async (tx) => {
      const thread = await this.reach(tx, v);
      const unread = { businessId: v.businessId, direction: incoming(v), readAt: null };
      const [messages, threads] = await Promise.all([
        tx.message.count({ where: { ...unread, thread } }),
        tx.messageThread.count({ where: { AND: [thread, { messages: { some: unread } }] } }),
      ]);
      return { threads, messages };
    });
  }

  /** The thread with its messages, oldest first. */
  async get(v: Viewer, id: string) {
    const detail = await this.inFirm(v, async (tx) => {
      const row = await this.thread(tx, v, id);
      const messages = await tx.message.findMany({
        where: { businessId: v.businessId, threadId: id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: messageSelect,
      });
      return { ...toThread(v, row), messages: await this.present(tx, v, messages) };
    });
    await this.audit.log('message_thread.viewed', { type: 'message_thread', id });
    return detail;
  }

  /**
   * Adds a message with its attachments: documents of the thread's client, never internal ones,
   * scanned clean (409 ATTACHMENT_NOT_READY while scanning; 404 for anything else).
   */
  private async add(
    tx: TxClient,
    v: Viewer,
    thread: { id: string; clientId: string },
    body: string,
    documentIds: string[] = [],
  ): Promise<string> {
    const docs = await tx.document.findMany({
      where: {
        businessId: v.businessId,
        id: { in: documentIds },
        clientId: thread.clientId,
        direction: { not: 'INTERNAL' },
        scanStatus: { in: ['CLEAN', 'PENDING'] },
      },
      select: { id: true, scanStatus: true },
    });
    if (docs.length !== documentIds.length) throw notFound();
    if (docs.some((d) => d.scanStatus === 'PENDING')) {
      throw new ConflictException({
        code: 'ATTACHMENT_NOT_READY',
        message: 'A document is still being checked. Try again in a moment.',
      });
    }
    const { id } = await tx.message.create({
      data: {
        businessId: v.businessId,
        threadId: thread.id,
        senderUserId: v.userId,
        direction: outgoing(v),
        body,
      },
      select: { id: true },
    });
    await tx.messageAttachment.createMany({
      data: docs.map((d) => ({ businessId: v.businessId, messageId: id, documentId: d.id })),
    });
    return id;
  }

  /** A new thread with its first message. Firm: for `clientId`; portal: the login's own client. */
  async create(v: Viewer, body: NewThread, clientId?: string) {
    const ids = await this.inFirm(v, async (tx) => {
      const client = await this.clientOf(tx, v, clientId);
      if (!client) throw notFound();
      if (body.engagementId) {
        const engagement = await tx.engagement.findFirst({
          where: { businessId: v.businessId, clientId: client, id: body.engagementId },
          select: { id: true },
        });
        if (!engagement) throw notFound();
      }
      const thread = await tx.messageThread.create({
        data: {
          businessId: v.businessId,
          clientId: client,
          engagementId: body.engagementId ?? null,
          subject: body.subject,
          repliesEnabled: body.repliesEnabled ?? true,
          createdByUserId: v.userId,
        },
        select: { id: true, clientId: true },
      });
      const messageId = await this.add(tx, v, thread, body.body, body.attachmentDocumentIds);
      return { threadId: thread.id, messageId };
    });
    await this.audit.log(
      'message_thread.created',
      { type: 'message_thread', id: ids.threadId },
      { messageId: ids.messageId, attachments: body.attachmentDocumentIds?.length ?? 0 },
    );
    await this.notices.send(v.businessId, ids.threadId, outgoing(v));
    return this.get(v, ids.threadId);
  }

  /** The firm always may; a client only while replies are open (409 REPLIES_DISABLED). */
  async reply(v: Viewer, id: string, body: { body: string; attachmentDocumentIds?: string[] }) {
    let messageId: string;
    try {
      messageId = await this.inFirm(v, async (tx) => {
        const thread = await this.thread(tx, v, id);
        if (v.kind === 'client' && !thread.repliesEnabled) throw repliesDisabled();
        return this.add(tx, v, thread, body.body, body.attachmentDocumentIds);
      });
    } catch (e) {
      // The firm closed replies at the same moment: the database refuses the message.
      if (v.kind === 'client' && databaseErrorCode(e) === '23514') throw repliesDisabled();
      throw e;
    }
    await this.audit.log(
      'message.sent',
      { type: 'message', id: messageId },
      { threadId: id, attachments: body.attachmentDocumentIds?.length ?? 0 },
    );
    await this.notices.send(v.businessId, id, outgoing(v));
    return this.inFirm(v, async (tx) => {
      const rows = await tx.message.findMany({
        where: { businessId: v.businessId, id: messageId },
        select: messageSelect,
      });
      return (await this.present(tx, v, rows))[0]!;
    });
  }

  /** Read: every unread message from the other side. Unread: the latest one from it again. */
  async mark(v: Viewer, id: string, read: boolean) {
    const row = await this.inFirm(v, async (tx) => {
      await this.thread(tx, v, id);
      const theirs = { businessId: v.businessId, threadId: id, direction: incoming(v) };
      if (read) {
        await tx.message.updateMany({
          where: { ...theirs, readAt: null },
          data: { readAt: new Date() },
        });
      } else {
        const last = await tx.message.findFirst({
          where: theirs,
          orderBy: newestFirst,
          select: { id: true },
        });
        if (last) await tx.message.update({ where: { id: last.id }, data: { readAt: null } });
      }
      return this.thread(tx, v, id);
    });
    const action = read ? 'message_thread.read' : 'message_thread.unread';
    await this.audit.log(action, { type: 'message_thread', id });
    return toThread(v, row);
  }

  /** Firm only: close or reopen the client's replies. */
  async setReplies(v: Viewer, id: string, repliesEnabled: boolean) {
    const row = await this.inFirm(v, async (tx) => {
      await this.thread(tx, v, id);
      await tx.messageThread.update({
        where: { businessId_id: { businessId: v.businessId, id } },
        data: { repliesEnabled },
      });
      return this.thread(tx, v, id);
    });
    const entity = { type: 'message_thread', id };
    await this.audit.log('message_thread.updated', entity, { repliesEnabled });
    return toThread(v, row);
  }
}
