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
  ADMIN_COMM_ERRORS,
  type AdminCommContact,
  type AdminCommContactList,
  type AdminCommContactRef,
  type AdminCommConversation,
  type AdminCommConversationDetail,
  type AdminCommErrorCode,
  type AdminCommMessage,
  type AdminCommSummary,
  type CreateAdminCommMessageRequest,
  type ListAdminCommContactsQuery,
  type ListAdminCommConversationsQuery,
  type ListAdminCommConversationsResponse,
  type ScheduleAdminCommMessageRequest,
  type UpdateAdminCommConversationRequest,
  type UpdateAdminCommMessageRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { NOTIFY_SERVICE, type NotifyService } from '../notify/notify.types.js';
import {
  contactValues,
  destinationFor,
  errorCodeOf,
  fillMergeFields,
  inFuture,
  isUnread,
  messageRefusal,
  orderConversations,
  outcomeOf,
} from './comm.rules.js';

type CreateBody = z.output<typeof CreateAdminCommMessageRequest>;
type Snapshot = Omit<AdminCommContact, 'business'> & {
  businessId: string | null;
  businessName: string | null;
};

export const commFailure = (code: AdminCommErrorCode) =>
  code === 'NOT_FOUND'
    ? new NotFoundException({ code, message: ADMIN_COMM_ERRORS[code] })
    : new ConflictException({ code, message: ADMIN_COMM_ERRORS[code] });

const conversationInclude = {
  linkedBusiness: { select: { id: true, name: true } },
  assignee: { select: { userId: true, user: { select: { name: true } } } },
} satisfies Prisma.CommConversationInclude;
type ConversationRow = Prisma.CommConversationGetPayload<{ include: typeof conversationInclude }>;
const messageInclude = {
  template: { select: { id: true, name: true } },
  recipients: { orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }] },
  mentions: { select: { userId: true, user: { select: { user: { select: { name: true } } } } } },
} satisfies Prisma.CommMessageInclude;
type MessageRow = Prisma.CommMessageGetPayload<{ include: typeof messageInclude }>;

const iso = (d: Date | null) => d?.toISOString() ?? null;

/**
 * The Super Admin Communications inbox (R0 stage B6): conversations with firms' people, sales
 * leads and the team; their messages and delivery results. Admin scope only (`AdminPrisma`); the
 * database keeps the lifecycle (drafts and schedules change, sent messages never do). Email and SMS
 * go out through NotifyService as Firmivra's own messages; a scheduled message waits for the
 * dispatcher job (platform scope, R1), which is not part of this module.
 */
@Injectable()
export class CommInboxService {
  private readonly logger = new Logger(CommInboxService.name);

  constructor(
    private readonly admin: AdminPrisma,
    private readonly audit: AuditService,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
  ) {}

  // ---------- Cards ----------

  async summary(): Promise<AdminCommSummary> {
    const me = this.admin.adminUserId;
    return this.admin.transaction(async (tx) => {
      const open = await tx.commConversation.findMany({
        where: { status: 'OPEN' },
        select: { id: true, lastMessageAt: true },
      });
      const reads = await this.readMarks(
        tx,
        me,
        open.map((c) => c.id),
      );
      const latest = await this.latestMessages(
        tx,
        open.map((c) => c.id),
      );
      const byChannel = { EMAIL: 0, SMS: 0, INTERNAL: 0, IN_APP: 0 };
      let waitingOnReply = 0;
      for (const m of latest.values()) {
        byChannel[m.channel] += 1;
        if (m.direction === 'OUTBOUND') waitingOnReply += 1;
      }
      const [scheduled, failed] = await Promise.all([
        tx.commMessage.count({ where: { status: 'SCHEDULED', broadcastId: null } }),
        tx.commMessage.count({
          where: {
            status: { in: ['FAILED', 'PARTIALLY_SENT'] },
            retries: { none: {} },
            broadcastId: null,
          },
        }),
      ]);
      return {
        unread: open.filter((c) => isUnread(c.lastMessageAt, reads.get(c.id))).length,
        open: open.length,
        waitingOnReply,
        scheduled,
        failed,
        byChannel,
      };
    });
  }

  // ---------- Contacts ----------

  async contacts(q: z.output<typeof ListAdminCommContactsQuery>): Promise<AdminCommContactList> {
    const term = q.search ? { contains: q.search, mode: 'insensitive' as const } : undefined;
    const want = (t: AdminCommContact['type']) => !q.type || q.type === t;
    return this.admin.transaction(async (tx) => {
      const items: AdminCommContact[] = [];
      if (want('FIRM')) {
        const owners = await tx.membership.findMany({
          where: {
            role: 'OWNER',
            status: 'ACTIVE',
            ...(term ? { OR: [{ business: { name: term } }, { user: { name: term } }] } : {}),
          },
          select: {
            business: { select: { id: true, name: true } },
            user: { select: { id: true, name: true, email: true, phone: true } },
          },
          orderBy: { business: { name: 'asc' } },
          take: 20,
        });
        for (const o of owners)
          items.push({
            type: 'FIRM',
            business: o.business,
            userId: o.user.id,
            salesContactId: null,
            name: o.user.name,
            email: o.user.email,
            phone: o.user.phone,
          });
      }
      if (want('LEAD')) {
        const leads = await tx.salesContact.findMany({
          where: term ? { OR: [{ name: term }, { email: term }, { companyName: term }] } : {},
          select: { id: true, name: true, email: true, phone: true },
          orderBy: { name: 'asc' },
          take: 20,
        });
        for (const l of leads)
          items.push({
            type: 'LEAD',
            business: null,
            userId: null,
            salesContactId: l.id,
            name: l.name,
            email: l.email,
            phone: l.phone,
          });
      }
      if (want('TEAM')) {
        const team = await tx.platformAdmin.findMany({
          where: term ? { user: { OR: [{ name: term }, { email: term }] } } : {},
          select: { user: { select: { id: true, name: true, email: true, phone: true } } },
          take: 20,
        });
        for (const t of team)
          items.push({
            type: 'TEAM',
            business: null,
            userId: t.user.id,
            salesContactId: null,
            name: t.user.name,
            email: t.user.email,
            phone: t.user.phone,
          });
      }
      return { items: items.slice(0, 20) };
    });
  }

  // ---------- Conversations ----------

  async list(
    q: z.output<typeof ListAdminCommConversationsQuery>,
  ): Promise<ListAdminCommConversationsResponse> {
    const me = this.admin.adminUserId;
    const term = q.search ? { contains: q.search, mode: 'insensitive' as const } : undefined;
    const where: Prisma.CommConversationWhereInput = {
      AND: [
        q.view === 'INBOX' ? { status: 'OPEN' } : {},
        q.view === 'ASSIGNED_TO_ME' ? { assignedToUserId: me } : {},
        q.view === 'UNASSIGNED' ? { assignedToUserId: null, status: 'OPEN' } : {},
        q.view === 'MENTIONS' ? { messages: { some: { mentions: { some: { userId: me } } } } } : {},
        q.view === 'SCHEDULED' ? { messages: { some: { status: 'SCHEDULED' } } } : {},
        q.channel ? { messages: { some: { channel: q.channel, status: { not: 'DRAFT' } } } } : {},
        q.contactType ? { contactType: q.contactType } : {},
        term
          ? {
              OR: [
                { contactName: term },
                { contactEmail: term },
                { contactPhone: term },
                { subject: term },
                { tags: { has: q.search } },
              ],
            }
          : {},
      ],
    };
    return this.admin.transaction(async (tx) => {
      const all = await tx.commConversation.findMany({
        where,
        select: { id: true, lastMessageAt: true, createdAt: true },
      });
      const reads = await this.readMarks(
        tx,
        me,
        all.map((c) => c.id),
      );
      const ordered = orderConversations(
        all.map((c) => ({ ...c, unread: isUnread(c.lastMessageAt, reads.get(c.id)) })),
        q.sort,
      );
      const pageIds = ordered
        .slice((q.page - 1) * q.pageSize, q.page * q.pageSize)
        .map((c) => c.id);
      const rows = await tx.commConversation.findMany({
        where: { id: { in: pageIds } },
        include: conversationInclude,
      });
      const shaped = await this.shapeConversations(tx, me, rows);
      const byId = new Map(shaped.map((c) => [c.id, c]));
      return {
        items: pageIds.map((id) => byId.get(id)!).filter(Boolean),
        total: all.length,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  async get(id: string): Promise<AdminCommConversationDetail> {
    const me = this.admin.adminUserId;
    return this.admin.transaction(async (tx) => {
      const row = await tx.commConversation.findUnique({
        where: { id },
        include: conversationInclude,
      });
      if (!row) throw commFailure('NOT_FOUND');
      const [conversation] = await this.shapeConversations(tx, me, [row]);
      const messages = await tx.commMessage.findMany({
        where: { conversationId: id },
        include: messageInclude,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      return { ...conversation!, messages: await this.shapeMessages(tx, messages) };
    });
  }

  async read(id: string): Promise<AdminCommConversation> {
    const me = this.admin.adminUserId;
    return this.admin.transaction(async (tx) => {
      const row = await tx.commConversation.findUnique({
        where: { id },
        include: conversationInclude,
      });
      if (!row) throw commFailure('NOT_FOUND');
      await this.markRead(tx, me, id);
      const [shaped] = await this.shapeConversations(tx, me, [row]);
      return shaped!;
    });
  }

  async update(
    id: string,
    b: z.output<typeof UpdateAdminCommConversationRequest>,
  ): Promise<AdminCommConversation> {
    const me = this.admin.adminUserId;
    return this.admin.transaction(async (tx) => {
      const before = await tx.commConversation.findUnique({ where: { id } });
      if (!before) throw commFailure('NOT_FOUND');
      if (b.assignedToUserId && !(await this.isTeam(tx, b.assignedToUserId)))
        throw commFailure('NOT_A_TEAM_MEMBER');
      const row = await tx.commConversation.update({
        where: { id },
        data: {
          ...(b.assignedToUserId !== undefined ? { assignedToUserId: b.assignedToUserId } : {}),
          ...(b.tags ? { tags: [...new Set(b.tags)] } : {}),
          ...(b.status ? { status: b.status } : {}),
        },
        include: conversationInclude,
      });
      const entity = { type: 'comm_conversation', id };
      if (b.assignedToUserId !== undefined && b.assignedToUserId !== before.assignedToUserId)
        await this.audit.logIn(tx, 'comm_conversation.assigned', entity, {
          assignedToUserId: b.assignedToUserId,
        });
      if (b.status && b.status !== before.status)
        await this.audit.logIn(tx, 'comm_conversation.status_changed', entity, {
          status: b.status,
        });
      const [shaped] = await this.shapeConversations(tx, me, [row]);
      return shaped!;
    });
  }

  // ---------- Messages ----------

  async create(b: CreateBody): Promise<AdminCommMessage> {
    const me = this.admin.adminUserId;
    if (b.mode === 'SCHEDULE' && !inFuture(b.scheduledAt!)) throw commFailure('SCHEDULE_IN_PAST');
    const created = await this.admin.transaction(async (tx) => {
      const again = await tx.commMessage.findUnique({
        where: { idempotencyKey: b.idempotencyKey },
      });
      if (again) return { id: again.id, dispatch: false };
      if (b.templateId) await this.usableTemplate(tx, b.templateId, b.channel);
      for (const userId of b.mentionUserIds ?? [])
        if (!(await this.isTeam(tx, userId))) throw commFailure('NOT_A_TEAM_MEMBER');
      const conversation = b.conversationId
        ? await tx.commConversation.findUnique({ where: { id: b.conversationId } })
        : await this.conversationFor(tx, b.contact!);
      if (!conversation) throw commFailure('NOT_FOUND');

      const internal = b.channel === 'INTERNAL';
      const to =
        b.channel === 'INTERNAL'
          ? null
          : destinationFor(b.channel, {
              email: conversation.contactEmail,
              phone: conversation.contactPhone,
            });
      if (!internal && !to) throw commFailure('NO_DESTINATION');

      const message = await tx.commMessage.create({
        data: {
          conversationId: conversation.id,
          channel: b.channel,
          direction: internal ? 'INTERNAL' : 'OUTBOUND',
          status: internal ? 'SENT' : b.mode === 'SCHEDULE' ? 'SCHEDULED' : 'DRAFT',
          // Only email has a subject (the database refuses one on SMS or a note).
          subject: b.channel === 'EMAIL' ? (b.subject ?? null) : null,
          body: b.body,
          templateId: b.templateId ?? null,
          idempotencyKey: b.idempotencyKey,
          scheduledAt: b.mode === 'SCHEDULE' ? new Date(b.scheduledAt!) : null,
          scheduledTimeZone: b.mode === 'SCHEDULE' ? b.scheduledTimeZone! : null,
        },
      });
      if (internal) {
        if (b.mentionUserIds?.length)
          await tx.commMessageMention.createMany({
            data: [...new Set(b.mentionUserIds)].map((userId) => ({
              messageId: message.id,
              userId,
            })),
          });
      } else {
        await this.addRecipients(tx, message.id, conversation, to!, b.cc ?? [], b.bcc ?? []);
      }
      const entity = { type: 'comm_message', id: message.id };
      if (b.mode === 'SEND' && !internal) {
        await tx.commMessage.update({ where: { id: message.id }, data: { status: 'SENDING' } });
        await this.audit.logIn(tx, 'comm_message.sent', entity, {
          conversationId: conversation.id,
          channel: b.channel,
        });
      } else if (b.mode === 'SCHEDULE') {
        await this.audit.logIn(tx, 'comm_message.scheduled', entity, {
          conversationId: conversation.id,
        });
      }
      if (b.mode !== 'DRAFT') await this.markRead(tx, me, conversation.id);
      return { id: message.id, dispatch: b.mode === 'SEND' && !internal };
    });
    if (created.dispatch) await this.dispatch(created.id);
    return this.getMessage(created.id);
  }

  async updateMessage(
    id: string,
    b: z.output<typeof UpdateAdminCommMessageRequest>,
  ): Promise<AdminCommMessage> {
    await this.admin.transaction(async (tx) => {
      const msg = await this.editable(tx, id, 'EDIT');
      if (b.templateId) await this.usableTemplate(tx, b.templateId, msg.channel);
      await tx.commMessage.update({
        where: { id },
        data: {
          ...(b.subject !== undefined && msg.channel === 'EMAIL' ? { subject: b.subject } : {}),
          ...(b.body !== undefined ? { body: b.body } : {}),
          ...(b.templateId !== undefined ? { templateId: b.templateId } : {}),
        },
      });
      if (b.cc || b.bcc) {
        if (msg.channel !== 'EMAIL' && ((b.cc?.length ?? 0) > 0 || (b.bcc?.length ?? 0) > 0))
          throw commFailure('NO_DESTINATION');
        for (const [kind, list] of [
          ['CC', b.cc],
          ['BCC', b.bcc],
        ] as const) {
          if (!list) continue;
          await tx.commMessageRecipient.deleteMany({ where: { messageId: id, kind } });
          const conversation = await tx.commConversation.findUniqueOrThrow({
            where: { id: msg.conversationId },
          });
          await this.addCopies(tx, id, conversation, kind, list);
        }
      }
    });
    return this.getMessage(id);
  }

  async send(id: string): Promise<AdminCommMessage> {
    const go = await this.admin.transaction(async (tx) => {
      const msg = await tx.commMessage.findUnique({ where: { id }, include: { recipients: true } });
      if (!msg) throw commFailure('NOT_FOUND');
      // The same send again (a double click, a retry after a timeout) answers the message as it is.
      if (['SENDING', 'SENT', 'PARTIALLY_SENT', 'FAILED'].includes(msg.status)) return false;
      const refused = messageRefusal('SEND', msg.status);
      if (refused) throw commFailure(refused);
      if (msg.channel === 'EMAIL' && !msg.subject)
        throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Add a subject' });
      if (msg.recipients.length === 0) throw commFailure('NO_DESTINATION');
      await tx.commMessage.update({ where: { id }, data: { status: 'SENDING' } });
      await this.audit.logIn(
        tx,
        'comm_message.sent',
        { type: 'comm_message', id },
        { conversationId: msg.conversationId, channel: msg.channel },
      );
      return true;
    });
    if (go) await this.dispatch(id);
    return this.getMessage(id);
  }

  async schedule(
    id: string,
    b: z.output<typeof ScheduleAdminCommMessageRequest>,
  ): Promise<AdminCommMessage> {
    if (!inFuture(b.scheduledAt)) throw commFailure('SCHEDULE_IN_PAST');
    await this.admin.transaction(async (tx) => {
      await this.editable(tx, id, 'SCHEDULE');
      await tx.commMessage.update({
        where: { id },
        data: {
          status: 'SCHEDULED',
          scheduledAt: new Date(b.scheduledAt),
          scheduledTimeZone: b.scheduledTimeZone,
        },
      });
      await this.audit.logIn(tx, 'comm_message.scheduled', { type: 'comm_message', id });
    });
    return this.getMessage(id);
  }

  async cancel(id: string): Promise<AdminCommMessage> {
    await this.admin.transaction(async (tx) => {
      await this.editable(tx, id, 'CANCEL');
      await tx.commMessage.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.audit.logIn(tx, 'comm_message.cancelled', { type: 'comm_message', id });
    });
    return this.getMessage(id);
  }

  /** A new message to the recipients that failed; the failed one stays in history. */
  async retry(id: string, idempotencyKey: string): Promise<AdminCommMessage> {
    const made = await this.admin.transaction(async (tx) => {
      const again = await tx.commMessage.findUnique({ where: { idempotencyKey } });
      if (again) {
        if (again.retryOfMessageId !== id) throw commFailure('IDEMPOTENCY_CONFLICT');
        return { id: again.id, dispatch: false };
      }
      const msg = await this.editable(tx, id, 'RETRY');
      const failed = await tx.commMessageRecipient.findMany({
        where: { messageId: id, status: { in: ['FAILED', 'BOUNCED'] } },
      });
      const copy = await tx.commMessage.create({
        data: {
          conversationId: msg.conversationId,
          channel: msg.channel,
          direction: 'OUTBOUND',
          status: 'DRAFT',
          subject: msg.subject,
          body: msg.body,
          templateId: msg.templateId,
          retryOfMessageId: id,
          idempotencyKey,
        },
      });
      await tx.commMessageRecipient.createMany({
        data: failed.map((r) => ({
          messageId: copy.id,
          kind: r.kind,
          contactType: r.contactType,
          linkedBusinessId: r.linkedBusinessId,
          contactUserId: r.contactUserId,
          salesContactId: r.salesContactId,
          name: r.name,
          address: r.address,
        })),
      });
      await tx.commMessage.update({ where: { id: copy.id }, data: { status: 'SENDING' } });
      await this.audit.logIn(
        tx,
        'comm_message.retried',
        { type: 'comm_message', id: copy.id },
        { retryOfMessageId: id },
      );
      return { id: copy.id, dispatch: true };
    });
    if (made.dispatch) await this.dispatch(made.id);
    return this.getMessage(made.id);
  }

  async remove(id: string): Promise<{ ok: true }> {
    await this.admin.transaction(async (tx) => {
      await this.editable(tx, id, 'DELETE');
      await tx.commMessage.delete({ where: { id } });
    });
    return { ok: true };
  }

  async getMessage(id: string): Promise<AdminCommMessage> {
    return this.admin.transaction(async (tx) => {
      const row = await tx.commMessage.findUnique({ where: { id }, include: messageInclude });
      if (!row) throw commFailure('NOT_FOUND');
      const [shaped] = await this.shapeMessages(tx, [row]);
      return shaped!;
    });
  }

  // ---------- Sending ----------

  /**
   * Sends a SENDING message to each pending recipient through NotifyService (Firmivra's own
   * templates), with the merge fields filled per recipient, then records each result and the
   * message's outcome. Runs after the transaction that moved it to SENDING has committed.
   */
  async dispatch(id: string): Promise<void> {
    const me = this.admin.adminUserId;
    const plan = await this.admin.transaction(async (tx) => {
      const msg = await tx.commMessage.findUnique({
        where: { id },
        include: {
          recipients: { where: { status: 'PENDING' } },
          conversation: { include: { linkedBusiness: true } },
        },
      });
      const sender = await tx.user.findUnique({ where: { id: me }, select: { name: true } });
      return msg && msg.status === 'SENDING'
        ? { msg, senderName: sender?.name ?? 'Firmivra' }
        : null;
    });
    if (!plan) return;
    const { msg, senderName } = plan;
    const results: { id: string; ok: boolean; code: string | null }[] = [];
    for (const r of msg.recipients) {
      const values = contactValues({
        name: r.name,
        email: msg.channel === 'EMAIL' ? r.address : msg.conversation.contactEmail,
        firmName: msg.conversation.linkedBusiness?.name ?? null,
        senderName,
      });
      const body = fillMergeFields(msg.body, values).text;
      try {
        if (msg.channel === 'EMAIL')
          await this.notify.send({
            template: 'platform.message-email',
            to: r.address,
            businessId: null,
            data: { name: r.name, subject: fillMergeFields(msg.subject ?? '', values).text, body },
          });
        else
          await this.notify.send({
            template: 'platform.message-sms',
            to: r.address,
            businessId: null,
            data: { body },
          });
        results.push({ id: r.id, ok: true, code: null });
      } catch (e) {
        const code = errorCodeOf((e as { reason?: string }).reason);
        this.logger.warn(`comm message ${id}: a recipient was not sent (${code})`);
        results.push({ id: r.id, ok: false, code });
      }
    }
    await this.admin.transaction(async (tx) => {
      for (const r of results)
        await tx.commMessageRecipient.update({
          where: { id: r.id },
          data: r.ok ? { status: 'SENT' } : { status: 'FAILED', errorCode: r.code },
        });
      const outcome = outcomeOf(results.map((r) => (r.ok ? 'SENT' : 'FAILED')));
      await tx.commMessage.update({
        where: { id },
        data:
          outcome === 'SENT'
            ? { status: 'SENT' }
            : {
                status: outcome,
                errorCode: 'delivery_failed',
                errorMessage: `${results.filter((r) => !r.ok).length} of ${results.length} recipients were not sent`,
              },
      });
      if (outcome !== 'SENT')
        await this.audit.logIn(
          tx,
          'comm_message.failed',
          { type: 'comm_message', id },
          { outcome },
        );
    });
  }

  // ---------- Helpers ----------

  private async editable(
    tx: TxClient,
    id: string,
    action: 'EDIT' | 'SCHEDULE' | 'CANCEL' | 'RETRY' | 'DELETE',
  ) {
    const msg = await tx.commMessage.findUnique({ where: { id } });
    if (!msg) throw commFailure('NOT_FOUND');
    const refused = messageRefusal(action, msg.status);
    if (refused) throw commFailure(refused);
    return msg;
  }

  private async usableTemplate(tx: TxClient, id: string, channel: string) {
    const t = await tx.commTemplate.findUnique({
      where: { id },
      select: { channel: true, status: true },
    });
    if (!t || t.status !== 'ACTIVE' || t.channel !== channel)
      throw commFailure('TEMPLATE_NOT_USABLE');
  }

  private async isTeam(tx: TxClient, userId: string) {
    return !!(await tx.platformAdmin.findUnique({ where: { userId }, select: { userId: true } }));
  }

  private async markRead(tx: TxClient, userId: string, conversationId: string) {
    const now = new Date();
    await tx.commConversationRead.upsert({
      where: { conversationId_userId: { conversationId, userId } },
      create: { conversationId, userId, lastReadAt: now },
      update: { lastReadAt: now },
    });
  }

  private async readMarks(tx: TxClient, userId: string, ids: string[]) {
    if (!ids.length) return new Map<string, Date>();
    const rows = await tx.commConversationRead.findMany({
      where: { userId, conversationId: { in: ids } },
      select: { conversationId: true, lastReadAt: true },
    });
    return new Map(rows.map((r) => [r.conversationId, r.lastReadAt]));
  }

  /** Each conversation's newest message that is not a draft. */
  private async latestMessages(tx: TxClient, ids: string[]) {
    if (!ids.length)
      return new Map<
        string,
        {
          channel: 'EMAIL' | 'SMS' | 'INTERNAL' | 'IN_APP';
          direction: string;
          status: MessageRow['status'];
          body: string;
          createdAt: Date;
        }
      >();
    const rows = await tx.commMessage.findMany({
      where: { conversationId: { in: ids }, status: { not: 'DRAFT' } },
      orderBy: [{ conversationId: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
      distinct: ['conversationId'],
      select: {
        conversationId: true,
        channel: true,
        direction: true,
        status: true,
        body: true,
        createdAt: true,
      },
    });
    return new Map(rows.map((r) => [r.conversationId, r]));
  }

  /** The record a contact reference names, as a snapshot; null when it is not there. */
  private async snapshot(tx: TxClient, ref: AdminCommContactRef): Promise<Snapshot | null> {
    if (ref.type === 'FIRM') {
      const owner = await tx.membership.findFirst({
        where: { businessId: ref.businessId, role: 'OWNER', status: 'ACTIVE' },
        select: {
          business: { select: { id: true, name: true } },
          user: { select: { id: true, name: true, email: true, phone: true } },
        },
      });
      return owner
        ? {
            type: 'FIRM',
            businessId: owner.business.id,
            businessName: owner.business.name,
            userId: owner.user.id,
            salesContactId: null,
            name: owner.user.name,
            email: owner.user.email,
            phone: owner.user.phone,
          }
        : null;
    }
    if (ref.type === 'LEAD') {
      const lead = await tx.salesContact.findUnique({ where: { id: ref.salesContactId } });
      return lead
        ? {
            type: 'LEAD',
            businessId: null,
            businessName: null,
            userId: null,
            salesContactId: lead.id,
            name: lead.name,
            email: lead.email,
            phone: lead.phone,
          }
        : null;
    }
    const team = await tx.platformAdmin.findUnique({
      where: { userId: ref.userId },
      select: { user: { select: { id: true, name: true, email: true, phone: true } } },
    });
    return team
      ? {
          type: 'TEAM',
          businessId: null,
          businessName: null,
          userId: team.user.id,
          salesContactId: null,
          name: team.user.name,
          email: team.user.email,
          phone: team.user.phone,
        }
      : null;
  }

  /** The contact's open thread, or a new one. */
  private async conversationFor(tx: TxClient, ref: AdminCommContactRef) {
    const s = await this.snapshot(tx, ref);
    if (!s) return null;
    const link =
      s.type === 'FIRM'
        ? { linkedBusinessId: s.businessId }
        : s.type === 'LEAD'
          ? { salesContactId: s.salesContactId }
          : { contactUserId: s.userId };
    const open = await tx.commConversation.findFirst({
      where: { contactType: s.type, status: 'OPEN', ...link },
      orderBy: { createdAt: 'desc' },
    });
    if (open) return open;
    return tx.commConversation.create({
      data: {
        contactType: s.type,
        linkedBusinessId: s.businessId,
        contactUserId: s.type === 'LEAD' ? null : s.userId,
        salesContactId: s.salesContactId,
        contactName: s.name,
        contactEmail: s.email,
        contactPhone: s.phone,
      },
    });
  }

  private async addRecipients(
    tx: TxClient,
    messageId: string,
    c: Prisma.CommConversationGetPayload<object>,
    to: string,
    cc: string[],
    bcc: string[],
  ) {
    await tx.commMessageRecipient.create({
      data: {
        messageId,
        kind: 'TO',
        contactType: c.contactType,
        linkedBusinessId: c.linkedBusinessId,
        contactUserId: c.contactUserId,
        salesContactId: c.salesContactId,
        name: c.contactName,
        address: to,
      },
    });
    await this.addCopies(tx, messageId, c, 'CC', cc);
    await this.addCopies(tx, messageId, c, 'BCC', bcc);
  }

  /** Cc and Bcc: extra addresses on the thread's contact (the database checks they are email). */
  private async addCopies(
    tx: TxClient,
    messageId: string,
    c: Prisma.CommConversationGetPayload<object>,
    kind: 'CC' | 'BCC',
    list: string[],
  ) {
    const unique = [...new Set(list.map((a) => a.trim().toLowerCase()))];
    if (!unique.length) return;
    await tx.commMessageRecipient.createMany({
      data: unique.map((address) => ({
        messageId,
        kind,
        contactType: c.contactType,
        linkedBusinessId: c.linkedBusinessId,
        contactUserId: c.contactUserId,
        salesContactId: c.salesContactId,
        name: address,
        address,
      })),
    });
  }

  private async shapeConversations(
    tx: TxClient,
    me: string,
    rows: ConversationRow[],
  ): Promise<AdminCommConversation[]> {
    const ids = rows.map((r) => r.id);
    const [reads, latest, scheduled, failed, mentioned] = await Promise.all([
      this.readMarks(tx, me, ids),
      this.latestMessages(tx, ids),
      tx.commMessage.groupBy({
        by: ['conversationId'],
        where: { conversationId: { in: ids }, status: 'SCHEDULED' },
      }),
      tx.commMessage.groupBy({
        by: ['conversationId'],
        where: {
          conversationId: { in: ids },
          status: { in: ['FAILED', 'PARTIALLY_SENT'] },
          retries: { none: {} },
        },
      }),
      tx.commMessageMention.findMany({
        where: { userId: me, message: { conversationId: { in: ids } } },
        select: { message: { select: { conversationId: true } } },
      }),
    ]);
    const has = (list: { conversationId: string }[]) => new Set(list.map((x) => x.conversationId));
    const sched = has(scheduled);
    const fail = has(failed);
    const ment = new Set(mentioned.map((m) => m.message.conversationId));
    return rows.map((r) => {
      const last = latest.get(r.id);
      return {
        id: r.id,
        contact: {
          type: r.contactType,
          business: r.linkedBusiness
            ? { id: r.linkedBusiness.id, name: r.linkedBusiness.name }
            : null,
          userId: r.contactUserId,
          salesContactId: r.salesContactId,
          name: r.contactName,
          email: r.contactEmail,
          phone: r.contactPhone,
        },
        subject: r.subject,
        status: r.status,
        assignedTo: r.assignee ? { userId: r.assignee.userId, name: r.assignee.user.name } : null,
        tags: r.tags,
        lastMessage: last
          ? {
              excerpt: last.body.slice(0, 140),
              channel: last.channel,
              direction: last.direction as AdminCommMessage['direction'],
              status: last.status,
              at: last.createdAt.toISOString(),
            }
          : null,
        lastMessageAt: iso(r.lastMessageAt),
        unread: isUnread(r.lastMessageAt, reads.get(r.id)),
        mentionsMe: ment.has(r.id),
        hasScheduled: sched.has(r.id),
        hasFailed: fail.has(r.id),
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  private async shapeMessages(tx: TxClient, rows: MessageRow[]): Promise<AdminCommMessage[]> {
    const senderIds = [...new Set(rows.flatMap((r) => (r.senderUserId ? [r.senderUserId] : [])))];
    const senders = new Map(
      senderIds.length
        ? (
            await tx.user.findMany({
              where: { id: { in: senderIds } },
              select: { id: true, name: true },
            })
          ).map((u) => [u.id, u.name])
        : [],
    );
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversationId,
      channel: r.channel,
      direction: r.direction,
      status: r.status,
      subject: r.subject,
      body: r.body,
      template: r.template,
      scheduledAt: iso(r.scheduledAt),
      scheduledTimeZone: r.scheduledTimeZone,
      sender: r.senderUserId
        ? { userId: r.senderUserId, name: senders.get(r.senderUserId) ?? 'Firmivra team' }
        : null,
      fromAddress: r.fromAddress,
      sentAt: iso(r.sentAt),
      failedAt: iso(r.failedAt),
      errorCode: r.errorCode,
      errorMessage: r.errorMessage,
      retryOfMessageId: r.retryOfMessageId,
      broadcastId: r.broadcastId,
      recipients: r.recipients.map((x) => ({
        id: x.id,
        kind: x.kind,
        name: x.name,
        address: x.address,
        status: x.status,
        errorCode: x.errorCode,
        sentAt: iso(x.sentAt),
        deliveredAt: iso(x.deliveredAt),
        failedAt: iso(x.failedAt),
      })),
      mentions: r.mentions.map((m) => ({ userId: m.userId, name: m.user.user.name })),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }
}
