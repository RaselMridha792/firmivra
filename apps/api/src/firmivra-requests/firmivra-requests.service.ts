import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import {
  type CreateFirmivraRequestUploadRequest,
  FIRMIVRA_REQUEST_PREFIX,
  type FirmivraRequestFileLink,
  type FirmivraRequestItem,
  type FirmivraRequestList,
  type FirmivraRequestMessage,
  type FirmivraRequestThread,
  type ReplyFirmivraRequestRequest,
  type UploadTicket,
} from '@firmivra/types';
import type { z } from 'zod';
import { loadSupportHours } from '../admin-support/support-context.js';
import { SupportFilesService } from '../admin-support/support-files.service.js';
import { dueTime } from '../admin-support/sla.js';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';

type Reply = z.output<typeof ReplyFirmivraRequestRequest>;
type FileBody = z.output<typeof CreateFirmivraRequestUploadRequest>;

/** The audit action of a firm's answer (the firm's own row; the request id makes a retry one). */
export const FIRMIVRA_REQUEST_ANSWERED = 'firmivra_request.answered';
/**
 * Support's own history entry for a client's reply (Ticket Detail shows it as "Client reply"),
 * written when the firm's answer moves its request back to Open.
 */
export const CUSTOMER_REPLIED = 'message.customer';

const DONE = ['RESOLVED', 'CLOSED'] as const;
const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const closed = () =>
  new ConflictException({
    code: 'REQUEST_CLOSED',
    message: 'Firmivra has closed this request. Send Firmivra a new message if you need to.',
  });

/** What the firm sees of a message: its own answers, and Firmivra's replies sent to it. */
const VISIBLE: Prisma.SupportTicketMessageWhereInput = {
  OR: [{ authorSide: 'CUSTOMER' }, { authorSide: 'STAFF', deliveryChannel: { not: null } }],
};

const ticketSelect = {
  id: true,
  number: true,
  subject: true,
  status: true,
  createdAt: true,
  lastActivityAt: true,
} as const;
type TicketRow = Prisma.SupportTicketGetPayload<{ select: typeof ticketSelect }>;

/**
 * Settings > Requests from Firmivra (SA-FRM-F06, Y09): the firm's Owner reads Firmivra's requests
 * for information (Support tickets a Super Admin opened from the firm's page) and answers them
 * with text and files. Everything runs in the firm's own scope with the Owner as the actor, which
 * the database's Support policies require (a CUSTOMER message under their own name; files on the
 * conversation, never a note). A request is a ticket of this firm, source Internal, whose subject
 * starts "Information request: "; anything else is 404. Firmivra's internal notes and the replies
 * it kept back are never read.
 *
 * The one platform-scope write (the lead's decision, Nov 19): after an answer is saved, a request
 * Waiting on Customer goes back to Open, with Support's own client-reply history entry and its
 * response clock started again as Support does, so it shows in Firmivra's queue. Only that
 * transition, only on the answering firm's own request.
 */
@Injectable()
export class FirmivraRequestsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly files: SupportFilesService,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, userId: string, fn: (tx: TxClient) => Promise<T>) {
    return this.database.withScope({ kind: 'business', businessId, actorUserId: userId }, fn);
  }

  /** The firm's requests from Firmivra: this firm's, Internal, with the request prefix. */
  private requests(businessId: string, id?: string): Prisma.SupportTicketWhereInput {
    return {
      ...(id ? { id } : {}),
      businessId,
      source: 'INTERNAL',
      deletedAt: null,
      subject: { startsWith: FIRMIVRA_REQUEST_PREFIX },
    };
  }

  async list(businessId: string, userId: string): Promise<FirmivraRequestList> {
    return this.inFirm(businessId, userId, async (tx) => {
      const rows = await tx.supportTicket.findMany({
        where: this.requests(businessId),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
        select: ticketSelect,
      });
      const latest = rows.length
        ? await tx.supportTicketMessage.findMany({
            where: { businessId, ticketId: { in: rows.map((r) => r.id) }, ...VISIBLE },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { ticketId: true, createdAt: true },
          })
        : [];
      const last = new Map<string, Date>();
      for (const m of latest) if (!last.has(m.ticketId)) last.set(m.ticketId, m.createdAt);
      return { items: rows.map((r) => itemOf(r, last.get(r.id))) };
    });
  }

  async thread(businessId: string, userId: string, id: string): Promise<FirmivraRequestThread> {
    return this.inFirm(businessId, userId, async (tx) => {
      const t = await tx.supportTicket.findFirst({
        where: this.requests(businessId, id),
        select: { ...ticketSelect, description: true },
      });
      if (!t) throw notFound();
      const messages = await tx.supportTicketMessage.findMany({
        where: { businessId, ticketId: id, ...VISIBLE },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, authorUserId: true, authorSide: true, body: true, createdAt: true },
      });
      const [files, people] = await Promise.all([
        messages.length
          ? tx.supportTicketAttachment.findMany({
              where: {
                businessId,
                ticketId: id,
                noteId: null,
                messageId: { in: messages.map((m) => m.id) },
              },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              select: {
                id: true,
                messageId: true,
                fileName: true,
                contentType: true,
                sizeBytes: true,
                scanStatus: true,
              },
            })
          : Promise.resolve([]),
        tx.user.findMany({
          where: {
            id: {
              in: [
                ...new Set(
                  messages.filter((m) => m.authorSide === 'CUSTOMER').map((m) => m.authorUserId),
                ),
              ],
            },
          },
          select: { id: true, name: true },
        }),
      ]);
      const names = new Map(people.map((p) => [p.id, p.name]));
      return {
        ...itemOf(t, messages.at(-1)?.createdAt),
        request: t.description,
        messages: messages.map((m): FirmivraRequestMessage => ({
          id: m.id,
          from: m.authorSide === 'CUSTOMER' ? 'FIRM' : 'FIRMIVRA',
          authorName:
            m.authorSide === 'CUSTOMER' ? (names.get(m.authorUserId) ?? 'Your firm') : 'Firmivra',
          body: m.body,
          at: m.createdAt.toISOString(),
          files: files.filter((f) => f.messageId === m.id).map(({ messageId: _m, ...f }) => f),
        })),
        canReply: !(DONE as readonly string[]).includes(t.status),
      };
    });
  }

  /** Where to PUT a file for an answer: only on one of the firm's requests that is still open. */
  async upload(
    businessId: string,
    userId: string,
    id: string,
    body: FileBody,
  ): Promise<UploadTicket> {
    await this.openRequest(businessId, userId, id);
    return this.files.firmTicket(businessId, userId, body);
  }

  /**
   * The firm's answer: a CUSTOMER message under the Owner's name, with its checked files, and the
   * firm's audit row, in one transaction; then (only when it waited on the firm) back to Open.
   * The same request id again answers the thread without a second message.
   */
  async reply(
    businessId: string,
    userId: string,
    id: string,
    body: Reply,
  ): Promise<FirmivraRequestThread> {
    // 404 before anything about the files (a retry of a saved answer may meet a closed request:
    // the transaction tells); the stored files are checked outside the transaction.
    await this.openRequest(businessId, userId, id, { evenIfDone: true });
    // A retry of a saved answer resends the same (now used) files: answer it before they're checked.
    if (await this.inFirm(businessId, userId, (tx) => this.answered(tx, businessId, id, body))) {
      return this.thread(businessId, userId, id);
    }
    const claims = await this.files.firmCheck(body.uploadTokens, businessId, userId);
    const saved = await this.inFirm(businessId, userId, async (tx) => {
      // Two clicks at once: the second waits, then finds the first's answer.
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${body.requestId}))) AS l`;
      const t = await tx.supportTicket.findFirst({
        where: this.requests(businessId, id),
        select: { id: true, number: true, status: true },
      });
      if (!t) throw notFound();
      if (await this.answered(tx, businessId, id, body)) return null;
      if ((DONE as readonly string[]).includes(t.status)) throw closed();
      const message = await tx.supportTicketMessage.create({
        data: {
          businessId,
          ticketId: id,
          authorUserId: userId,
          authorSide: 'CUSTOMER',
          body: body.body,
        },
        select: { id: true },
      });
      const files = await this.files.insert(tx, claims, {
        businessId,
        ticketId: id,
        messageId: message.id,
      });
      // The request's number and the count only: never the answer or a file name.
      await this.audit.logIn(
        tx,
        FIRMIVRA_REQUEST_ANSWERED,
        { type: 'support_ticket', id },
        { requestId: body.requestId, number: t.number, files: files.length },
      );
      return { files: files.map((f) => f.id) };
    });
    if (saved) {
      await this.files.firmAfterInsert(businessId, saved.files);
      await this.reopen(businessId, id);
    }
    return this.thread(businessId, userId, id);
  }

  /** A 5-minute link to a CLEAN file of a message the firm sees on one of its requests. */
  async fileLink(
    businessId: string,
    userId: string,
    id: string,
    fileId: string,
  ): Promise<FirmivraRequestFileLink> {
    const file = await this.inFirm(businessId, userId, async (tx) => {
      const t = await tx.supportTicket.findFirst({
        where: this.requests(businessId, id),
        select: { id: true },
      });
      if (!t) throw notFound();
      return tx.supportTicketAttachment.findFirst({
        where: {
          id: fileId,
          businessId,
          ticketId: id,
          noteId: null,
          message: VISIBLE,
        },
        select: {
          id: true,
          ticketId: true,
          businessId: true,
          s3Key: true,
          fileName: true,
          contentType: true,
          sizeBytes: true,
          sha256: true,
          scanStatus: true,
        },
      });
    });
    if (!file) throw notFound();
    return this.files.link(file);
  }

  /** Whether this answer (its request id) is already saved on the request: the firm's audit row. */
  private async answered(
    tx: TxClient,
    businessId: string,
    id: string,
    body: Pick<Reply, 'requestId'>,
  ): Promise<boolean> {
    const row = await tx.auditLog.findFirst({
      where: {
        businessId,
        action: FIRMIVRA_REQUEST_ANSWERED,
        entityId: id,
        metadata: { path: ['requestId'], equals: body.requestId },
      },
      select: { id: true },
    });
    return row !== null;
  }

  /** One of the firm's requests (404 otherwise), still open (409 REQUEST_CLOSED otherwise). */
  private async openRequest(
    businessId: string,
    userId: string,
    id: string,
    { evenIfDone = false } = {},
  ): Promise<void> {
    const t = await this.inFirm(businessId, userId, (tx) =>
      tx.supportTicket.findFirst({
        where: this.requests(businessId, id),
        select: { status: true },
      }),
    );
    if (!t) throw notFound();
    if ((DONE as readonly string[]).includes(t.status) && !evenIfDone) throw closed();
  }

  /**
   * The answer is saved: a request Waiting on Customer goes back to Open in Firmivra's queue. The
   * one platform-scope write, narrowed to this firm's own request in that one status. The clock
   * restarts as Support's own Waiting-to-Open change does (unpaused, a new first-response target).
   */
  private async reopen(businessId: string, id: string): Promise<void> {
    await this.database.withScope({ kind: 'platform' }, async (tx) => {
      const t = await tx.supportTicket.findFirst({
        where: { ...this.requests(businessId, id), status: 'WAITING_ON_CUSTOMER' },
        select: {
          slaPausedAt: true,
          slaPausedSeconds: true,
          priority: { select: { responseTargetMinutes: true } },
        },
      });
      if (!t) return;
      const now = Date.now();
      const pausedFor = t.slaPausedAt
        ? Math.max(0, Math.round((now - t.slaPausedAt.getTime()) / 1000))
        : 0;
      const hours = await loadSupportHours(tx);
      const { count } = await tx.supportTicket.updateMany({
        where: { id, businessId, status: 'WAITING_ON_CUSTOMER' },
        data: {
          status: 'OPEN',
          slaPausedAt: null,
          slaPausedSeconds: t.slaPausedSeconds + pausedFor,
          firstResponseDueAt: new Date(dueTime(now, t.priority.responseTargetMinutes, hours)),
          lastActivityAt: new Date(now),
          version: { increment: 1 },
        },
      });
      if (count === 0) return;
      // The history: the client's reply, then the status it moved the request to.
      await tx.supportTicketEvent.createMany({
        data: [
          { action: CUSTOMER_REPLIED, oldValue: null, newValue: null },
          { action: 'ticket.status_changed', oldValue: 'WAITING_ON_CUSTOMER', newValue: 'OPEN' },
        ].map((e) => ({
          businessId,
          ticketId: id,
          actorUserId: null,
          actorType: 'SYSTEM' as const,
          ...e,
        })),
      });
    });
  }
}

function itemOf(t: TicketRow, lastMessageAt: Date | undefined): FirmivraRequestItem {
  const last = lastMessageAt && lastMessageAt > t.lastActivityAt ? lastMessageAt : t.lastActivityAt;
  return {
    id: t.id,
    number: t.number,
    subject: t.subject.slice(FIRMIVRA_REQUEST_PREFIX.length),
    status: t.status,
    requestedAt: t.createdAt.toISOString(),
    lastActivityAt: last.toISOString(),
    awaitingAnswer: t.status === 'WAITING_ON_CUSTOMER',
  };
}
