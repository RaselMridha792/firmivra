import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  LeadMessage,
  LeadMessageThread,
  LeadMessageThreadDetail,
  LeadMessageThreadList,
  ListLeadMessageThreadsQuery,
  MessageSender,
  OutboundExclusion,
  SendLeadMessageRequest,
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
import { reach as leadReach, visibleLead } from '../leads/pipeline.shared.js';
import { phoneDigits } from './messages.service.js';
import { OutboundMessagesService } from './outbound.service.js';

type ListQuery = z.output<typeof ListLeadMessageThreadsQuery>;
type Reply = z.output<typeof SendLeadMessageRequest>;

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const EXCERPT = 140;
/** Why a lead cannot get the reply, in the words the screen shows. */
const CANNOT: Record<OutboundExclusion, string> = {
  NO_CONTACT: 'This lead has no email address or mobile number for this channel.',
  NO_CONSENT: 'This lead has not agreed to get messages on this channel.',
  SUPPRESSED: 'Messages to this lead on this channel are stopped (an opt-out or a bounce).',
  PROVIDER_UNAVAILABLE: 'This channel is turned off or not set up for your firm.',
  NOT_PERMITTED: 'This lead cannot get messages.',
  NO_PORTAL_ACCESS: 'This lead cannot get messages.',
  DUPLICATE: 'This lead cannot get messages.',
  MANUALLY_EXCLUDED: 'This lead cannot get messages.',
};

const threadSelect = {
  id: true,
  leadId: true,
  subject: true,
  createdByUserId: true,
  lastMessageAt: true,
  archivedAt: true,
  createdAt: true,
  lead: { select: { firstName: true, lastName: true, email: true, phone: true } },
} satisfies Prisma.MessageThreadSelect;
type ThreadRow = Prisma.MessageThreadGetPayload<{ select: typeof threadSelect }>;

const messageSelect = {
  id: true,
  threadId: true,
  senderUserId: true,
  body: true,
  createdAt: true,
  outboundRecipients: { select: { channel: true, status: true }, take: 1 },
} satisfies Prisma.MessageSelect;
type MessageRow = Prisma.MessageGetPayload<{ select: typeof messageSelect }>;

const ORDER = [
  { lastMessageAt: 'desc' },
  { id: 'desc' },
] satisfies Prisma.MessageThreadOrderByWithRelationInput[];
const leadName = (l: { firstName: string; lastName: string }) =>
  [l.firstName, l.lastName].filter(Boolean).join(' ') || 'Lead';

/**
 * Conversations with leads (R60, MSG-F03's Leads tab; R1's message_threads.lead_id). A lead's
 * thread holds the firm's emails and texts to the lead, written by New Message's delivery
 * (OutboundMessagesService). Every query runs in the firm's scope with `businessId` from
 * TenantGuard; Owner and Admin reach every lead's threads, Staff only their assigned leads' (404
 * otherwise). The audit log gets ids only, never a subject or a message's text.
 */
@Injectable()
export class LeadThreadsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly outbound: OutboundMessagesService,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** Lead threads whose lead the actor reaches. */
  private reach(businessId: string, actor: ClientsActor): Prisma.MessageThreadWhereInput {
    return {
      businessId,
      leadId: { not: null },
      lead: { AND: [visibleLead(businessId), leadReach(actor)] },
    };
  }

  /** The subject, the messages' text, the lead's name and email, and a phone number by its digits. */
  private async searchWhere(
    tx: TxClient,
    businessId: string,
    search?: string,
  ): Promise<Prisma.MessageThreadWhereInput> {
    if (!search) return {};
    const digits = phoneDigits(search);
    const phoned = digits
      ? await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM leads
          WHERE business_id = ${businessId}::uuid AND phone IS NOT NULL AND (
            CASE WHEN length(${digits}::text) >= 10
              THEN right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = right(${digits}::text, 10)
              ELSE regexp_replace(phone, '[^0-9]', '', 'g') LIKE '%' || ${digits}::text || '%'
            END)`
      : [];
    const term = likeEscape(search);
    const has = (value: string) => ({ contains: value, mode: 'insensitive' as const });
    const [first, ...rest] = search.trim().split(/\s+/);
    return {
      OR: [
        { subject: has(term) },
        { messages: { some: { body: has(term) } } },
        { lead: { firstName: has(term) } },
        { lead: { lastName: has(term) } },
        { lead: { email: has(term) } },
        // "Jamie Rivera": the first name and the rest.
        ...(first && rest.length > 0
          ? [
              {
                lead: {
                  firstName: has(likeEscape(first)),
                  lastName: has(likeEscape(rest.join(' '))),
                },
              },
            ]
          : []),
        ...(phoned.length > 0 ? [{ leadId: { in: phoned.map((l) => l.id) } }] : []),
      ],
    };
  }

  private async staff(tx: TxClient, businessId: string, userIds: string[]) {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map<string, string>();
    const members = await tx.membership.findMany({
      where: { businessId, userId: { in: ids } },
      select: { userId: true, user: { select: { name: true } } },
    });
    return new Map(members.map((m) => [m.userId, m.user.name]));
  }

  private sender(names: Map<string, string>, userId: string): MessageSender {
    return { kind: 'STAFF', userId, name: names.get(userId) ?? 'Former staff' };
  }

  private async threads(
    tx: TxClient,
    businessId: string,
    rows: ThreadRow[],
  ): Promise<LeadMessageThread[]> {
    const ids = rows.map((t) => t.id);
    const last =
      ids.length === 0
        ? []
        : await tx.$queryRaw<
            { thread_id: string; sender_user_id: string; body: string; created_at: Date }[]
          >`
            SELECT DISTINCT ON (thread_id) thread_id, sender_user_id, body, created_at
            FROM messages
            WHERE business_id = ${businessId}::uuid AND thread_id = ANY(${ids}::uuid[])
            ORDER BY thread_id, created_at DESC, id DESC`;
    const lastOf = new Map(last.map((m) => [m.thread_id, m]));
    const names = await this.staff(tx, businessId, [
      ...rows.flatMap((t) => (t.createdByUserId ? [t.createdByUserId] : [])),
      ...last.map((m) => m.sender_user_id),
    ]);
    return rows.map((t): LeadMessageThread => {
      if (!t.leadId || !t.lead) throw new Error(`message thread ${t.id} has no lead`);
      const m = lastOf.get(t.id);
      return {
        id: t.id,
        lead: {
          id: t.leadId,
          displayName: leadName(t.lead),
          email: t.lead.email || null,
          phone: t.lead.phone,
        },
        subject: t.subject,
        startedBy: t.createdByUserId ? this.sender(names, t.createdByUserId) : null,
        lastMessage: m
          ? {
              direction: 'FIRM_TO_CLIENT',
              senderName: this.sender(names, m.sender_user_id).name,
              excerpt: m.body.replace(/\s+/g, ' ').trim().slice(0, EXCERPT),
              createdAt: m.created_at.toISOString(),
            }
          : null,
        archivedAt: t.archivedAt?.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
      };
    });
  }

  private toMessage(names: Map<string, string>, m: MessageRow): LeadMessage {
    const delivery = m.outboundRecipients[0];
    return {
      id: m.id,
      threadId: m.threadId,
      sender: this.sender(names, m.senderUserId),
      body: m.body,
      channel: delivery && delivery.channel !== 'PORTAL' ? delivery.channel : null,
      status: delivery?.status ?? null,
      createdAt: m.createdAt.toISOString(),
    };
  }

  private async thread(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    id: string,
  ): Promise<ThreadRow> {
    const row = await tx.messageThread.findFirst({
      where: { AND: [this.reach(businessId, actor), { id }] },
      select: threadSelect,
    });
    if (!row) throw notFound();
    return row;
  }

  async list(
    businessId: string,
    actor: ClientsActor,
    q: ListQuery,
  ): Promise<LeadMessageThreadList> {
    const result = await this.inFirm(businessId, async (tx) => {
      const after = q.cursor ? decodeCursor(q.cursor) : null;
      const rows = await tx.messageThread.findMany({
        where: {
          AND: [
            this.reach(businessId, actor),
            { archivedAt: q.archived ? { not: null } : null },
            await this.searchWhere(tx, businessId, q.search),
            after
              ? {
                  OR: [
                    { lastMessageAt: { lt: after.createdAt } },
                    { lastMessageAt: after.createdAt, id: { lt: after.id } },
                  ],
                }
              : {},
          ],
        },
        orderBy: ORDER,
        take: q.limit + 1,
        select: threadSelect,
      });
      const end = rows[q.limit - 1];
      return {
        items: await this.threads(tx, businessId, rows.slice(0, q.limit)),
        nextCursor:
          rows.length > q.limit && end?.lastMessageAt
            ? encodeCursor({ createdAt: end.lastMessageAt, id: end.id })
            : null,
      };
    });
    await this.audit.log(
      'message_threads.listed',
      { type: 'message_thread' },
      { count: result.items.length, contact: 'lead' },
    );
    return result;
  }

  private async detail(
    tx: TxClient,
    businessId: string,
    t: ThreadRow,
  ): Promise<LeadMessageThreadDetail> {
    const [thread] = await this.threads(tx, businessId, [t]);
    const rows = await tx.message.findMany({
      where: { businessId, threadId: t.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: messageSelect,
    });
    const names = await this.staff(
      tx,
      businessId,
      rows.map((m) => m.senderUserId),
    );
    return {
      ...(thread as LeadMessageThread),
      messages: rows.map((m) => this.toMessage(names, m)),
    };
  }

  async get(businessId: string, actor: ClientsActor, id: string): Promise<LeadMessageThreadDetail> {
    const detail = await this.inFirm(businessId, async (tx) =>
      this.detail(tx, businessId, await this.thread(tx, businessId, actor, id)),
    );
    await this.audit.log('message_thread.viewed', { type: 'message_thread', id });
    return detail;
  }

  /**
   * The next email or text to the lead, on the thread's subject, through New Message: the same
   * reach, checks, merge fields and delivery, and its copy lands in this thread. Nothing is
   * saved when the channel cannot reach the lead.
   */
  async send(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: Reply,
  ): Promise<LeadMessage> {
    const t = await this.inFirm(businessId, (tx) => this.thread(tx, businessId, actor, id));
    const leadId = t.leadId!;
    const check = await this.outbound.check(businessId, actor, {
      channel: body.channel,
      clientIds: [],
      leadIds: [leadId],
    });
    const reason = check.recipients[0]?.reason ?? null;
    if (reason) throw new ConflictException({ code: reason, message: CANNOT[reason] });
    const draft = await this.outbound.create(businessId, actor, {
      channel: body.channel,
      subject: t.subject,
      body: body.body,
      clientIds: [],
      leadIds: [leadId],
    });
    // The text is typed here: a merge field that cannot be filled goes as written.
    const sent = await this.outbound.send(businessId, actor, draft.id, draft.updatedAt, true);
    const { delivered, message } = await this.inFirm(businessId, async (tx) => {
      const delivery = await tx.outboundMessageRecipient.findFirst({
        where: { businessId, outboundMessageId: sent.id, leadId },
        select: { status: true, messageId: true },
      });
      const row = delivery?.messageId
        ? await tx.message.findFirst({
            where: { businessId, id: delivery.messageId },
            select: messageSelect,
          })
        : null;
      return {
        delivered: delivery?.status === 'SENT',
        message: row
          ? this.toMessage(await this.staff(tx, businessId, [row.senderUserId]), row)
          : null,
      };
    });
    if (!delivered) {
      throw new ConflictException({
        code: 'SEND_FAILED',
        message: 'This message did not go out. Try again in a moment.',
      });
    }
    if (!message) {
      throw new ConflictException({
        code: 'NOT_KEPT',
        message: 'It went out, but it could not be kept in this conversation.',
      });
    }
    await this.audit.log(
      'message.sent',
      { type: 'message_thread', id },
      { messageId: message.id, outboundMessageId: sent.id, channel: body.channel },
    );
    return message;
  }
}
