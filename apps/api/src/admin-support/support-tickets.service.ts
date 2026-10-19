import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, TxClient } from '@firmivra/db';
import {
  type AddSupportAttachmentsRequest,
  type AssignSupportTicketRequest,
  type CreateSupportTicketRequest,
  type EscalateSupportTicketRequest,
  type MergeSupportTicketRequest,
  type ReplySupportTicketRequest,
  SUPPORT_TICKET_SOURCE_LABELS,
  SUPPORT_TICKET_STATUS_LABELS,
  type SupportActivityType,
  type SupportAttachmentLink,
  type SupportDirectory,
  type SupportMe,
  type SupportSummary,
  type SupportTicket,
  type SupportTicketActivity,
  type SupportTicketDetail,
  type SupportTicketPage,
  type SupportTicketsQuery,
  type SupportTicketStatus,
  type SupportTicketTab,
  type UpdateSupportTicketRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { DAYS, dueTime, inDays, rescheduledDue, slaOf } from './sla.js';
import { SupportFilesService, type SupportUploadClaim } from './support-files.service.js';
import {
  invalid,
  loadContext,
  need,
  nextRoundRobin,
  notFound,
  ruleOf,
  type SupportContext,
  supportError,
  targetOf,
} from './support-context.js';

type Out<S extends z.ZodType> = z.output<S>;

const ACTIVE: readonly SupportTicketStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER'];
const OPEN_SET: readonly SupportTicketStatus[] = ['OPEN', 'IN_PROGRESS'];
const isActive = (s: SupportTicketStatus) => ACTIVE.includes(s);
/** The most recent tickets a list or the summary works over. */
const CAP = 5000;
/** The rules run at most this often per API task (each read checks). */
const RULES_EVERY_MS = 30_000;
const QUEUE = 'Support Team queue';
const FIRM_MEMBER = 'Firm member';

const ticketSelect = {
  id: true,
  number: true,
  businessId: true,
  contactUserId: true,
  subject: true,
  description: true,
  categoryId: true,
  priorityId: true,
  status: true,
  source: true,
  assignedUserId: true,
  createdByUserId: true,
  isEscalated: true,
  escalatedAt: true,
  escalatedByUserId: true,
  escalationReason: true,
  firstResponseDueAt: true,
  firstRespondedAt: true,
  slaPausedAt: true,
  slaPausedSeconds: true,
  resolvedAt: true,
  closedAt: true,
  mergedIntoTicketId: true,
  lastActivityAt: true,
  version: true,
  createdAt: true,
  business: { select: { name: true } },
  mergedInto: { select: { id: true, number: true } },
  _count: { select: { messages: true, notes: true, attachments: true } },
} satisfies Prisma.SupportTicketSelect;
type Row = Prisma.SupportTicketGetPayload<{ select: typeof ticketSelect }>;

interface Contact {
  name: string;
  email: string;
  phone: string;
}
interface Decorated {
  row: Row;
  ticket: SupportTicket;
}
/** A ticket change: its columns, or null for "nothing changed" (no version bump). */
type Change = (
  tx: TxClient,
  ctx: SupportContext,
  row: Row,
) => Promise<Prisma.SupportTicketUncheckedUpdateManyInput | null>;

const conflict = () => supportError(409, 'CONFLICT', 'The ticket changed since it was loaded');
const number = (n: number) => `#${String(n).padStart(4, '0')}`;
const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * Super Admin Support tickets (R60 on R0's B2): the list, tabs and summary, Ticket Detail and
 * every change to a ticket, in the Super Admin's admin scope. The conversation, notes and
 * history are insert-only; every change bumps the ticket's `version` (409 CONFLICT when stale)
 * and writes a history row and a platform audit row (ids and fields, never text or file names).
 * SLA warnings, breaches, the escalation rules and reassignment run when the tickets are read.
 */
@Injectable()
export class SupportTicketsService {
  private readonly logger = new Logger(SupportTicketsService.name);
  private rulesRanAt = 0;

  constructor(
    private readonly admin: AdminPrisma,
    private readonly audit: AuditService,
    private readonly files: SupportFilesService,
  ) {}

  // ---------- Reads ----------

  me(): Promise<SupportMe> {
    return this.admin.transaction(async (tx) => {
      const ctx = await loadContext(tx, this.admin.adminUserId);
      return { agent: ctx.me, permissions: [...ctx.grid[ctx.me.role]] };
    });
  }

  directory(): Promise<SupportDirectory> {
    return this.admin.transaction(async (tx) => {
      const ctx = await loadContext(tx, this.admin.adminUserId);
      const [firms, owners] = await Promise.all([
        tx.business.findMany({
          where: { status: { not: 'CLOSED' } },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          select: { id: true, name: true },
        }),
        tx.membership.findMany({
          where: { role: 'OWNER', status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' },
          select: { businessId: true, userId: true },
        }),
      ]);
      const users = await this.owners(tx, owners);
      return {
        firms: firms.map((f) => {
          const mine = owners.filter((o) => o.businessId === f.id && users.has(o.userId));
          return {
            id: f.id,
            name: f.name,
            contacts: mine.map((o, i) => ({
              id: o.userId,
              ...users.get(o.userId)!,
              primary: i === 0,
            })),
          };
        }),
        agents: ctx.agents,
      };
    });
  }

  async summary(): Promise<SupportSummary> {
    await this.runRules();
    return this.admin.transaction(async (tx) => {
      const ctx = await loadContext(tx, this.admin.adminUserId);
      const all = await this.visible(tx, ctx);
      const tickets = all.map((d) => d.ticket);
      const then = ctx.now - 30 * DAYS.DAY;
      const ids = all.map((d) => d.row.id);
      const [statusEvents, breaches] = await Promise.all([
        tx.supportTicketEvent.findMany({
          where: {
            ticketId: { in: ids },
            action: { in: ['ticket.created', 'ticket.status_changed'] },
            createdAt: { lte: new Date(then) },
          },
          orderBy: { createdAt: 'asc' },
          select: { ticketId: true, action: true, newValue: true },
        }),
        tx.supportTicketEvent.findMany({
          where: {
            ticketId: { in: ids },
            action: 'sla.breached',
            createdAt: { gt: new Date(then - 30 * DAYS.DAY) },
          },
          select: { createdAt: true },
        }),
      ]);
      const statusThen = new Map<string, string>();
      for (const e of statusEvents) if (e.newValue) statusThen.set(e.ticketId, e.newValue);
      const countThen = (test: (s: string) => boolean) =>
        [...statusThen.values()].filter(test).length;
      const count = (test: (t: SupportTicket) => boolean) => tickets.filter(test).length;
      const between = (at: Date | null, from: number, to: number) =>
        at !== null && at.getTime() > from && at.getTime() <= to;
      const resolvedNow = all.filter((d) => between(d.row.resolvedAt, then, ctx.now)).length;
      const resolvedBefore = all.filter((d) =>
        between(d.row.resolvedAt, then - 30 * DAYS.DAY, then),
      ).length;
      const breachedNow = breaches.filter((b) => b.createdAt.getTime() > then).length;
      const breachedBefore = breaches.length - breachedNow;
      const tabs = Object.fromEntries(
        TABS.map((tab) => [tab, count((t) => inTab(t, tab, ctx))]),
      ) as SupportSummary['tabs'];
      const open = count((t) => OPEN_SET.includes(t.status));
      const waiting = count((t) => t.status === 'WAITING_ON_CUSTOMER');
      return {
        total: tickets.length,
        open,
        overdue: count((t) => isActive(t.status) && t.sla.state === 'BREACHED'),
        waiting,
        resolved30: resolvedNow,
        trends: {
          total: change(tickets.length, statusThen.size),
          open: change(
            open,
            countThen((s) => (OPEN_SET as string[]).includes(s)),
          ),
          overdue: change(breachedNow, breachedBefore),
          waiting: change(
            waiting,
            countThen((s) => s === 'WAITING_ON_CUSTOMER'),
          ),
          resolved30: change(resolvedNow, resolvedBefore),
        },
        tabs,
      };
    });
  }

  async tickets(query: Out<typeof SupportTicketsQuery>): Promise<SupportTicketPage> {
    await this.runRules();
    return this.admin.transaction(async (tx) => {
      const ctx = await loadContext(tx, this.admin.adminUserId);
      const tab = query.tab ?? 'ALL';
      const search = (query.search ?? '').trim();
      const rows = (await this.visible(tx, ctx))
        .map((d) => d.ticket)
        .filter((t) => matchesFilters(t, query, ctx))
        .filter((t) => inTab(t, tab, ctx))
        .filter((t) => !search || matchesSearch(t, search));
      const pageSize = query.pageSize ?? 10;
      const pages = Math.max(1, Math.ceil(rows.length / pageSize));
      const page = Math.min(query.page ?? 1, pages);
      return {
        items: rows.slice((page - 1) * pageSize, page * pageSize),
        total: rows.length,
        page,
        pageSize,
      };
    });
  }

  async ticket(id: string): Promise<SupportTicketDetail> {
    await this.runRules();
    return this.admin.transaction(async (tx) => {
      const ctx = await loadContext(tx, this.admin.adminUserId);
      return this.detail(tx, ctx, id);
    });
  }

  async attachmentLink(id: string, attachmentId: string): Promise<SupportAttachmentLink> {
    const file = await this.admin.transaction(async (tx) => {
      const ctx = await loadContext(tx, this.admin.adminUserId);
      await this.find(tx, ctx, id);
      const children = await tx.supportTicket.findMany({
        where: { mergedIntoTicketId: id },
        select: { id: true },
      });
      const row = await tx.supportTicketAttachment.findFirst({
        where: { id: attachmentId, ticketId: { in: [id, ...children.map((c) => c.id)] } },
      });
      if (!row || (row.noteId && !ctx.permissions.has('VIEW_INTERNAL_NOTES')))
        throw notFound('Attachment');
      return row;
    });
    return this.files.link(file);
  }

  // ---------- Changes ----------

  async create(body: Out<typeof CreateSupportTicketRequest>): Promise<SupportTicket> {
    const existing = await this.byRequest(body.requestId);
    if (existing) return existing;
    const claims = await this.files.check(body.uploadTokens, body.firmId);
    let created: { id: string; files: string[] };
    try {
      created = await this.admin.transaction(async (tx) => {
        const ctx = await loadContext(tx, this.admin.adminUserId);
        const firm = await tx.business.findUnique({
          where: { id: body.firmId },
          select: { id: true },
        });
        if (!firm) throw invalid('Select a firm.');
        const contact = await tx.membership.findFirst({
          where: { businessId: firm.id, userId: body.contactId, role: 'OWNER', status: 'ACTIVE' },
          select: { userId: true },
        });
        if (!contact)
          throw supportError(400, 'CONTACT_NOT_IN_FIRM', 'Select a contact from this firm.');
        const category = ctx.categories.find((c) => c.id === body.categoryId && c.active);
        const priority = ctx.priorities.find((p) => p.id === body.priorityId && p.active);
        if (!category || !priority)
          throw supportError(
            409,
            'INACTIVE_CHOICE',
            'That category or priority is no longer active',
          );
        const assignee = this.resolveAssignee(ctx, body.assignTo);
        const now = new Date(ctx.now);
        const waiting = body.status === 'WAITING_ON_CUSTOMER';
        const row = await tx.supportTicket.create({
          data: {
            businessId: firm.id,
            contactUserId: contact.userId,
            subject: body.subject,
            description: body.description,
            categoryId: category.id,
            priorityId: priority.id,
            source: body.source,
            assignedUserId: assignee?.id ?? null,
            createdByUserId: ctx.me.id,
            idempotencyKey: body.requestId,
            firstResponseDueAt: waiting
              ? null
              : new Date(dueTime(ctx.now, priority.targetMinutes, ctx.hours)),
            slaPausedAt: waiting && ctx.pauseWhileWaiting ? now : null,
          },
          select: { id: true, businessId: true },
        });
        // The database starts every ticket OPEN; the form's status follows in this transaction.
        if (body.status !== 'OPEN')
          await tx.supportTicket.update({ where: { id: row.id }, data: { status: body.status } });
        const t = { id: row.id, businessId: row.businessId };
        await event(tx, t, 'ticket.created', ctx.me.id, null, body.status);
        if (assignee) {
          const auto = body.assignTo === 'AUTO';
          await event(tx, t, 'ticket.assigned', auto ? null : ctx.me.id, null, assignee.name);
          if (auto)
            await tx.supportSettings.updateMany({
              where: { id: 1 },
              data: { lastAssignedUserId: assignee.id },
            });
        } else {
          await event(tx, t, 'ticket.queued', null, null, null);
        }
        const files = await this.files.insert(tx, claims, {
          ticketId: t.id,
          businessId: t.businessId,
        });
        for (const f of files) await event(tx, t, 'attachment.added', ctx.me.id, null, f.name);
        if (body.internalNote) {
          await tx.supportTicketNote.create({
            data: {
              businessId: t.businessId,
              ticketId: t.id,
              authorUserId: ctx.me.id,
              body: body.internalNote,
            },
          });
          await event(tx, t, 'note.added', ctx.me.id, null, null);
        }
        await this.log(tx, 'support.ticket_created', t, {
          source: body.source,
          status: body.status,
          assigned: assignee !== null,
          files: files.length,
        });
        return { id: row.id, files: files.map((f) => f.id) };
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        const again = await this.byRequest(body.requestId);
        if (again) return again;
      }
      throw error;
    }
    await this.files.afterInsert(created.files);
    return this.row(created.id);
  }

  update(id: string, body: Out<typeof UpdateSupportTicketRequest>): Promise<SupportTicket> {
    return this.change(id, body.version, async (tx, ctx, row) => {
      const data: Prisma.SupportTicketUncheckedUpdateManyInput = {};
      const changed: string[] = [];
      const before = ctx.priorities.find((p) => p.id === row.priorityId);
      let target = before?.targetMinutes ?? 480;
      const newPriority = body.priorityId && body.priorityId !== row.priorityId;
      if (newPriority) {
        const next = ctx.priorities.find((p) => p.id === body.priorityId && p.active);
        if (!next) throw supportError(409, 'INACTIVE_CHOICE', 'Select an active priority');
        data.priorityId = next.id;
        target = next.targetMinutes;
        await event(tx, row, 'ticket.priority_changed', ctx.me.id, before?.name ?? null, next.name);
        changed.push('priority');
      }
      if (body.status && body.status !== row.status) {
        if (row.mergedIntoTicketId)
          throw supportError(409, 'ALREADY_MERGED', 'This ticket was merged');
        if (body.status === 'RESOLVED') need(ctx, 'RESOLVE');
        if (body.status === 'CLOSED') need(ctx, 'CLOSE');
        Object.assign(data, this.statusChange(ctx, row, body.status, target));
        await event(tx, row, 'ticket.status_changed', ctx.me.id, row.status, body.status);
        if (!isActive(row.status) && isActive(body.status))
          await event(tx, row, 'ticket.reopened', ctx.me.id, null, null);
        changed.push('status');
      } else if (newPriority && row.firstResponseDueAt) {
        // The time already used counts against the new priority's target.
        data.firstResponseDueAt = new Date(
          rescheduledDue(
            ctx.now,
            row.firstResponseDueAt.getTime(),
            before?.targetMinutes ?? target,
            target,
            ctx.hours,
          ),
        );
      }
      if (body.categoryId && body.categoryId !== row.categoryId) {
        const next = ctx.categories.find((c) => c.id === body.categoryId && c.active);
        if (!next) throw supportError(409, 'INACTIVE_CHOICE', 'Select an active category');
        data.categoryId = next.id;
        await event(
          tx,
          row,
          'ticket.category_changed',
          ctx.me.id,
          ctx.categories.find((c) => c.id === row.categoryId)?.name ?? null,
          next.name,
        );
        changed.push('category');
      }
      await this.log(tx, 'support.ticket_updated', row, { changed, status: body.status ?? null });
      return data;
    });
  }

  assign(id: string, body: Out<typeof AssignSupportTicketRequest>): Promise<SupportTicket> {
    return this.change(id, body.version, async (tx, ctx, row) => {
      need(ctx, 'ASSIGN');
      const next = this.resolveAssignee(ctx, body.assignTo);
      if ((next?.id ?? null) === row.assignedUserId) return null;
      const before = row.assignedUserId ? ctx.nameOf(row.assignedUserId) : null;
      const action = row.assignedUserId
        ? next
          ? 'ticket.reassigned'
          : 'ticket.unassigned'
        : 'ticket.assigned';
      await event(
        tx,
        row,
        action,
        body.assignTo === 'AUTO' ? null : ctx.me.id,
        before,
        next?.name ?? QUEUE,
      );
      if (body.assignTo === 'AUTO' && next)
        await tx.supportSettings.updateMany({
          where: { id: 1 },
          data: { lastAssignedUserId: next.id },
        });
      await this.log(tx, 'support.ticket_assigned', row, {
        assigned: next !== null,
        auto: body.assignTo === 'AUTO',
      });
      return { assignedUserId: next?.id ?? null };
    });
  }

  escalate(id: string, body: Out<typeof EscalateSupportTicketRequest>): Promise<SupportTicket> {
    return this.change(id, body.version, async (tx, ctx, row) => {
      need(ctx, 'ESCALATE');
      if (!isActive(row.status))
        throw supportError(409, 'TICKET_CLOSED', 'Reopen the ticket before escalating it');
      await event(tx, row, 'ticket.escalated', ctx.me.id, null, body.reason);
      await this.log(tx, 'support.ticket_escalated', row);
      return {
        isEscalated: true,
        escalatedAt: new Date(ctx.now),
        escalatedByUserId: ctx.me.id,
        escalationReason: body.reason,
      };
    });
  }

  merge(id: string, body: Out<typeof MergeSupportTicketRequest>): Promise<SupportTicket> {
    return this.change(id, body.version, async (tx, ctx, target) => {
      need(ctx, 'MERGE');
      if (body.sourceId === id) throw invalid('Choose another ticket to merge');
      if (target.mergedIntoTicketId)
        throw supportError(409, 'ALREADY_MERGED', 'This ticket was merged');
      const source = await this.find(tx, ctx, body.sourceId);
      if (source.mergedIntoTicketId)
        throw supportError(409, 'ALREADY_MERGED', 'That ticket was already merged');
      if (source.businessId !== target.businessId) throw invalid('Merge tickets of the same firm');
      const now = new Date(ctx.now);
      // Tickets already merged into the source now show here too.
      await tx.supportTicket.updateMany({
        where: { mergedIntoTicketId: source.id },
        data: { mergedIntoTicketId: target.id },
      });
      const closing = source.status !== 'CLOSED';
      const { count } = await tx.supportTicket.updateMany({
        where: { id: source.id, version: source.version },
        data: {
          status: 'CLOSED',
          closedAt: source.closedAt ?? now,
          closedByUserId: ctx.me.id,
          mergedIntoTicketId: target.id,
          firstResponseDueAt: null,
          slaPausedAt: null,
          version: { increment: 1 },
          lastActivityAt: now,
        },
      });
      if (count === 0) throw conflict();
      if (closing)
        await event(tx, source, 'ticket.status_changed', ctx.me.id, source.status, 'CLOSED');
      await event(
        tx,
        source,
        'ticket.merged',
        ctx.me.id,
        number(source.number),
        number(target.number),
      );
      await event(
        tx,
        target,
        'ticket.merged',
        ctx.me.id,
        number(source.number),
        number(target.number),
      );
      await this.log(tx, 'support.ticket_merged', target, { sourceId: source.id });
      return {};
    });
  }

  async reply(id: string, body: Out<typeof ReplySupportTicketRequest>): Promise<SupportTicket> {
    const businessId = await this.firmOf(id);
    const claims = await this.files.check(body.uploadTokens, businessId);
    let fileIds: string[] = [];
    const result = await this.change(id, undefined, async (tx, ctx, row) => {
      if (body.mode === 'NOTE') {
        need(ctx, 'VIEW_INTERNAL_NOTES');
        const note = await tx.supportTicketNote.create({
          data: {
            businessId: row.businessId,
            ticketId: row.id,
            authorUserId: ctx.me.id,
            body: body.body,
          },
          select: { id: true },
        });
        const files = await this.files.insert(tx, claims, { ...this.ref(row), noteId: note.id });
        fileIds = files.map((f) => f.id);
        await event(tx, row, 'note.added', ctx.me.id, null, null);
        for (const f of files) await event(tx, row, 'attachment.added', ctx.me.id, null, f.name);
        await this.log(tx, 'support.note_added', row, { files: files.length });
        return {};
      }
      const message = await tx.supportTicketMessage.create({
        data: {
          businessId: row.businessId,
          ticketId: row.id,
          authorUserId: ctx.me.id,
          authorSide: 'STAFF',
          body: body.body,
          // Delivered replies are the firm's to read; email follows once Support has a template.
          deliveryChannel: body.sendToClient ? 'PORTAL' : null,
        },
        select: { id: true },
      });
      const files = await this.files.insert(tx, claims, {
        ...this.ref(row),
        messageId: message.id,
      });
      fileIds = files.map((f) => f.id);
      await event(tx, row, 'message.added', ctx.me.id, null, body.sendToClient ? 'SENT' : 'KEPT');
      for (const f of files) await event(tx, row, 'attachment.added', ctx.me.id, null, f.name);
      await this.log(tx, 'support.reply_added', row, {
        sent: body.sendToClient,
        files: files.length,
      });
      if (!body.sendToClient) return {};
      // A reply sent to the client is the response: no response is due until the client answers.
      return {
        firstRespondedAt: row.firstRespondedAt ?? new Date(ctx.now),
        firstResponseDueAt: null,
      };
    });
    await this.files.afterInsert(fileIds);
    return result;
  }

  async addAttachments(
    id: string,
    body: Out<typeof AddSupportAttachmentsRequest>,
  ): Promise<SupportTicket> {
    const businessId = await this.firmOf(id);
    const claims = await this.files.check(body.uploadTokens, businessId);
    let fileIds: string[] = [];
    const result = await this.change(id, undefined, async (tx, ctx, row) => {
      const files = await this.files.insert(tx, claims, this.ref(row));
      fileIds = files.map((f) => f.id);
      for (const f of files) await event(tx, row, 'attachment.added', ctx.me.id, null, f.name);
      await this.log(tx, 'support.attachments_added', row, { files: files.length });
      return {};
    });
    await this.files.afterInsert(fileIds);
    return result;
  }

  async remove(id: string, version: number): Promise<{ ok: true }> {
    await this.admin.transaction((tx) =>
      this.apply(tx, id, version, async (tx2, ctx, row) => {
        need(ctx, 'DELETE');
        await event(tx2, row, 'ticket.deleted', ctx.me.id, null, null);
        await this.log(tx2, 'support.ticket_deleted', row);
        return { deletedAt: new Date(ctx.now) };
      }),
    );
    return { ok: true };
  }

  // ---------- Rules ----------

  /**
   * The SLA and escalation rules and reassignment, recorded once each: a warning when under a
   * quarter of the target is left, a breach past due (and the SLA breach escalation), the
   * high-priority escalation after its time, and reassignment (round robin) of a ticket its
   * assignee has not taken in time. One runner at a time (an advisory lock), at most every 30 s.
   */
  async runRules(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.rulesRanAt < RULES_EVERY_MS) return;
    this.rulesRanAt = now;
    try {
      await this.admin.transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(4600060)) AS l`;
        const ctx = await loadContext(tx, this.admin.adminUserId, now);
        await this.applyRules(tx, ctx);
      });
    } catch (error) {
      this.rulesRanAt = 0;
      this.logger.warn(`Support rules did not run: ${(error as Error).name}`);
    }
  }

  private async applyRules(tx: TxClient, ctx: SupportContext): Promise<void> {
    const rows = await tx.supportTicket.findMany({
      where: { deletedAt: null, status: { in: [...ACTIVE] } },
      select: ticketSelect,
      take: CAP,
    });
    if (rows.length === 0) return;
    const events = await tx.supportTicketEvent.findMany({
      where: { ticketId: { in: rows.map((r) => r.id) } },
      select: { ticketId: true, action: true, actorUserId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const of = (id: string) => events.filter((e) => e.ticketId === id);
    const breachRule = ruleOf(ctx, 'SLA_BREACH');
    const highRule = ruleOf(ctx, 'HIGH_PRIORITY_UNRESOLVED');
    const now = new Date(ctx.now);
    for (const row of rows) {
      const mine = of(row.id);
      const priority = ctx.priorities.find((p) => p.id === row.priorityId);
      const sla = slaOf(
        {
          status: row.status,
          dueAt: row.firstResponseDueAt,
          breached: false,
          targetMinutes: priority?.targetMinutes ?? 480,
          pauseWhileWaiting: ctx.pauseWhileWaiting,
        },
        ctx.hours,
        ctx.now,
      );
      const has = (action: string) => mine.some((e) => e.action === action);
      const data: Prisma.SupportTicketUncheckedUpdateManyInput = {};
      if (sla.state === 'WARNING' && !has('sla.warning'))
        await event(tx, row, 'sla.warning', null, null, null);
      let escalated = row.isEscalated;
      if (sla.state === 'BREACHED' && !has('sla.breached')) {
        await event(tx, row, 'sla.breached', null, null, null);
        if (breachRule?.isActive && !escalated) {
          Object.assign(data, systemEscalation(now, 'Response time exceeded the SLA target'));
          await event(
            tx,
            row,
            'ticket.escalated',
            null,
            null,
            'Response time exceeded the SLA target',
          );
          escalated = true;
        }
      }
      if (
        highRule?.isActive &&
        highRule.priorityId === row.priorityId &&
        highRule.thresholdMinutes &&
        !escalated &&
        dueTime(row.createdAt.getTime(), highRule.thresholdMinutes, ctx.hours) < ctx.now
      ) {
        const target = targetOf(highRule.thresholdMinutes);
        const reason = `High priority and not resolved within ${target.amount} ${target.unit === 'HOURS' ? (target.amount === 1 ? 'hour' : 'hours') : target.amount === 1 ? 'business day' : 'business days'}`;
        Object.assign(data, systemEscalation(now, reason));
        await event(tx, row, 'ticket.escalated', null, null, reason);
      }
      if (ctx.reassignAfterMinutes && row.assignedUserId) {
        const assignedAt = [...mine]
          .reverse()
          .find(
            (e) => e.action === 'ticket.assigned' || e.action === 'ticket.reassigned',
          )?.createdAt;
        const taken = mine.some(
          (e) => e.actorUserId === row.assignedUserId && (!assignedAt || e.createdAt >= assignedAt),
        );
        if (
          assignedAt &&
          !taken &&
          dueTime(assignedAt.getTime(), ctx.reassignAfterMinutes, ctx.hours) < ctx.now
        ) {
          const next = nextRoundRobin(ctx, row.assignedUserId);
          if (next) {
            data.assignedUserId = next.id;
            await event(
              tx,
              row,
              'ticket.reassigned',
              null,
              ctx.nameOf(row.assignedUserId),
              next.name,
            );
            await tx.supportSettings.updateMany({
              where: { id: 1 },
              data: { lastAssignedUserId: next.id },
            });
            ctx.lastAssignedUserId = next.id;
          }
        }
      }
      if (Object.keys(data).length > 0) {
        const { count } = await tx.supportTicket.updateMany({
          where: { id: row.id, version: row.version },
          data: { ...data, version: { increment: 1 }, lastActivityAt: now },
        });
        if (count === 0) throw conflict();
      }
    }
  }

  // ---------- Helpers ----------

  private log(
    tx: TxClient,
    action: string,
    t: { id: string; businessId: string },
    metadata: Record<string, unknown> = {},
  ) {
    return this.audit.logIn(
      tx,
      action,
      { type: 'support_ticket', id: t.id },
      { businessId: t.businessId, ...metadata },
      {
        businessId: null,
      },
    );
  }

  private ref(row: { id: string; businessId: string }) {
    return { ticketId: row.id, businessId: row.businessId };
  }

  /** QUEUE, AUTO (round robin) or an active member. */
  private resolveAssignee(ctx: SupportContext, assignTo: string) {
    if (assignTo === 'QUEUE') return null;
    if (assignTo === 'AUTO') return nextRoundRobin(ctx);
    const agent = ctx.agents.find((a) => a.id === assignTo);
    if (!agent?.active)
      throw supportError(409, 'AGENT_INACTIVE', 'This team member cannot take new tickets');
    return agent;
  }

  /** The status change's columns: the clock pauses, stops or starts again; done tickets carry their time. */
  private statusChange(
    ctx: SupportContext,
    row: Row,
    status: SupportTicketStatus,
    targetMinutes: number,
  ): Prisma.SupportTicketUncheckedUpdateManyInput {
    const now = new Date(ctx.now);
    const restart = () => new Date(dueTime(ctx.now, targetMinutes, ctx.hours));
    const pausedFor = row.slaPausedAt
      ? Math.max(0, Math.round((ctx.now - row.slaPausedAt.getTime()) / 1000))
      : 0;
    const unpause = { slaPausedAt: null, slaPausedSeconds: row.slaPausedSeconds + pausedFor };
    const data: Prisma.SupportTicketUncheckedUpdateManyInput = { status };
    if (status === 'WAITING_ON_CUSTOMER') {
      data.firstResponseDueAt = null;
      data.slaPausedAt = ctx.pauseWhileWaiting ? now : null;
    } else if (status === 'RESOLVED') {
      Object.assign(data, unpause, {
        resolvedAt: now,
        resolvedByUserId: ctx.me.id,
        firstResponseDueAt: null,
        closedAt: null,
        closedByUserId: null,
      });
    } else if (status === 'CLOSED') {
      Object.assign(data, unpause, {
        closedAt: now,
        closedByUserId: ctx.me.id,
        firstResponseDueAt: null,
      });
    } else if (!isActive(row.status)) {
      // Reopened: the response clock starts again.
      Object.assign(data, unpause, {
        resolvedAt: null,
        resolvedByUserId: null,
        closedAt: null,
        closedByUserId: null,
        reopenedCount: { increment: 1 },
        firstResponseDueAt: restart(),
      });
    } else if (row.status === 'WAITING_ON_CUSTOMER') {
      Object.assign(data, unpause, { firstResponseDueAt: restart() });
    }
    return data;
  }

  /**
   * One change to one ticket: the caller's context, the visible ticket at `version` (when given),
   * the change's columns, then the version bump and last activity, all in one transaction.
   * `fn` answers null for "nothing changed" (no bump).
   */
  private change(id: string, version: number | undefined, fn: Change): Promise<SupportTicket> {
    return this.admin.transaction(async (tx) => {
      const ctx = await this.apply(tx, id, version, fn);
      return this.viewOf(tx, ctx, id);
    });
  }

  /** `change` without the answer (a deleted ticket is no longer visible). */
  private async apply(
    tx: TxClient,
    id: string,
    version: number | undefined,
    fn: Change,
  ): Promise<SupportContext> {
    const ctx = await loadContext(tx, this.admin.adminUserId);
    const row = await this.find(tx, ctx, id);
    if (version !== undefined && row.version !== version) throw conflict();
    const data = await fn(tx, ctx, row);
    if (data !== null) {
      const { count } = await tx.supportTicket.updateMany({
        where: { id: row.id, version: row.version },
        data: { ...data, version: { increment: 1 }, lastActivityAt: new Date(ctx.now) },
      });
      if (count === 0) throw conflict();
    }
    return ctx;
  }

  /** A ticket the caller may see (not deleted), or 404. */
  private async find(tx: TxClient, ctx: SupportContext, id: string): Promise<Row> {
    const row = await tx.supportTicket.findFirst({
      where: { id, deletedAt: null, ...this.scopeOf(ctx) },
      select: ticketSelect,
    });
    if (!row) throw notFound();
    return row;
  }

  private async firmOf(id: string): Promise<string> {
    return this.admin.transaction(
      async (tx) =>
        (await this.find(tx, await loadContext(tx, this.admin.adminUserId), id)).businessId,
    );
  }

  /** Every ticket, or only one's own (VIEW_OWN); 403 with neither. */
  private scopeOf(ctx: SupportContext): Prisma.SupportTicketWhereInput {
    if (ctx.permissions.has('VIEW_ALL')) return {};
    if (ctx.permissions.has('VIEW_OWN')) return { assignedUserId: ctx.me.id };
    throw supportError(403, 'FORBIDDEN', 'Your support role does not allow this');
  }

  private async byRequest(requestId: string): Promise<SupportTicket | null> {
    return this.admin.transaction(async (tx) => {
      const found = await tx.supportTicket.findUnique({
        where: { idempotencyKey: requestId },
        select: { id: true },
      });
      if (!found) return null;
      return this.viewOf(tx, await loadContext(tx, this.admin.adminUserId), found.id);
    });
  }

  private row(id: string): Promise<SupportTicket> {
    return this.admin.transaction(async (tx) =>
      this.viewOf(tx, await loadContext(tx, this.admin.adminUserId), id),
    );
  }

  private async viewOf(tx: TxClient, ctx: SupportContext, id: string): Promise<SupportTicket> {
    const row = await this.find(tx, ctx, id);
    const [d] = await this.decorate(tx, ctx, [row]);
    return d!.ticket;
  }

  private async visible(tx: TxClient, ctx: SupportContext): Promise<Decorated[]> {
    const rows = await tx.supportTicket.findMany({
      where: { deletedAt: null, ...this.scopeOf(ctx) },
      select: ticketSelect,
      orderBy: [{ lastActivityAt: 'desc' }, { number: 'desc' }],
      take: CAP,
    });
    return this.decorate(tx, ctx, rows);
  }

  /** Active owners' names and emails (the firm people admin scope may read). */
  private async owners(tx: TxClient, owners: { userId: string }[]): Promise<Map<string, Contact>> {
    if (owners.length === 0) return new Map();
    const users = await tx.user.findMany({
      where: { id: { in: [...new Set(owners.map((o) => o.userId))] } },
      select: { id: true, name: true, email: true, phone: true },
    });
    return new Map(
      users.map((u) => [u.id, { name: u.name, email: u.email, phone: u.phone ?? '' }]),
    );
  }

  private async contactsOf(
    tx: TxClient,
    rows: { businessId: string; userId: string }[],
  ): Promise<Map<string, Contact>> {
    if (rows.length === 0) return new Map();
    const owners = await tx.membership.findMany({
      where: {
        role: 'OWNER',
        status: 'ACTIVE',
        businessId: { in: [...new Set(rows.map((r) => r.businessId))] },
        userId: { in: [...new Set(rows.map((r) => r.userId))] },
      },
      select: { businessId: true, userId: true },
    });
    const users = await this.owners(tx, owners);
    const out = new Map<string, Contact>();
    for (const o of owners) {
      const u = users.get(o.userId);
      if (u) out.set(`${o.businessId}:${o.userId}`, u);
    }
    return out;
  }

  private async decorate(tx: TxClient, ctx: SupportContext, rows: Row[]): Promise<Decorated[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [contacts, breaches] = await Promise.all([
      this.contactsOf(
        tx,
        rows.map((r) => ({ businessId: r.businessId, userId: r.contactUserId })),
      ),
      tx.supportTicketEvent.findMany({
        where: { ticketId: { in: ids }, action: 'sla.breached' },
        select: { ticketId: true },
      }),
    ]);
    const breached = new Set(breaches.map((b) => b.ticketId));
    return rows.map((row) => ({
      row,
      ticket: this.view(row, ctx, contacts, breached.has(row.id)),
    }));
  }

  private view(
    row: Row,
    ctx: SupportContext,
    contacts: Map<string, Contact>,
    breached: boolean,
  ): SupportTicket {
    const priority = ctx.priorities.find((p) => p.id === row.priorityId);
    const category = ctx.categories.find((c) => c.id === row.categoryId);
    const contact = contacts.get(`${row.businessId}:${row.contactUserId}`) ?? {
      name: FIRM_MEMBER,
      email: '',
      phone: '',
    };
    const assignee = row.assignedUserId
      ? ctx.agents.find((a) => a.id === row.assignedUserId)
      : undefined;
    return {
      id: row.id,
      number: row.number,
      subject: row.subject,
      status: row.status,
      source: row.source,
      priority: {
        id: row.priorityId,
        name: priority?.name ?? 'Unknown',
        color: priority?.color ?? 'grey',
        rank: priority?.rank ?? 99,
        active: priority?.active ?? false,
      },
      category: {
        id: row.categoryId,
        name: category?.name ?? 'Unknown',
        active: category?.active ?? false,
      },
      firm: { id: row.businessId, name: row.business.name },
      contact: { id: row.contactUserId, ...contact },
      assignee: row.assignedUserId
        ? {
            id: row.assignedUserId,
            name: ctx.nameOf(row.assignedUserId),
            active: assignee?.active ?? false,
          }
        : null,
      createdBy:
        row.source === 'INTERNAL'
          ? { name: ctx.nameOf(row.createdByUserId), role: 'SUPPORT' }
          : { name: contact.name, role: 'CLIENT' },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.lastActivityAt.toISOString(),
      firstResponseAt: iso(row.firstRespondedAt),
      resolvedAt: iso(row.resolvedAt),
      closedAt: iso(row.closedAt),
      sla: slaOf(
        {
          status: row.status,
          dueAt: row.firstResponseDueAt,
          breached,
          targetMinutes: priority?.targetMinutes ?? 480,
          pauseWhileWaiting: ctx.pauseWhileWaiting,
        },
        ctx.hours,
        ctx.now,
      ),
      escalation:
        row.isEscalated && row.escalatedAt
          ? {
              reason: row.escalationReason ?? '',
              at: row.escalatedAt.toISOString(),
              by: row.escalatedByUserId ? ctx.nameOf(row.escalatedByUserId) : 'System',
            }
          : null,
      mergedInto: row.mergedInto ? { id: row.mergedInto.id, number: row.mergedInto.number } : null,
      counts: {
        // The opening message is the ticket's description.
        messages: row._count.messages + 1,
        attachments: row._count.attachments,
        notes: row._count.notes,
      },
      version: row.version,
    };
  }

  private async detail(
    tx: TxClient,
    ctx: SupportContext,
    id: string,
  ): Promise<SupportTicketDetail> {
    const row = await this.find(tx, ctx, id);
    const children = await tx.supportTicket.findMany({
      where: { mergedIntoTicketId: id },
      select: ticketSelect,
      orderBy: { number: 'asc' },
    });
    const all = [row, ...children];
    const ids = all.map((t) => t.id);
    const notesAllowed = ctx.permissions.has('VIEW_INTERNAL_NOTES');
    const [messages, notes, files, events, decorated] = await Promise.all([
      tx.supportTicketMessage.findMany({
        where: { ticketId: { in: ids } },
        orderBy: { createdAt: 'asc' },
      }),
      notesAllowed
        ? tx.supportTicketNote.findMany({
            where: { ticketId: { in: ids } },
            orderBy: { createdAt: 'asc' },
          })
        : Promise.resolve([]),
      tx.supportTicketAttachment.findMany({
        where: { ticketId: { in: ids }, ...(notesAllowed ? {} : { noteId: null }) },
        orderBy: { createdAt: 'asc' },
      }),
      tx.supportTicketEvent.findMany({
        where: { ticketId: { in: ids } },
        orderBy: { createdAt: 'desc' },
      }),
      this.decorate(tx, ctx, all),
    ]);
    const ticketOf = new Map(decorated.map((d) => [d.row.id, d]));
    const from = (ticketId: string) =>
      ticketId === id ? null : (ticketOf.get(ticketId)?.row.number ?? null);
    // Firm people (a client reply, a file from the firm's side): an owner's name, else "Firm member".
    const firmSide = [
      ...messages
        .filter((m) => m.authorSide === 'CUSTOMER')
        .map((m) => ({ businessId: m.businessId, userId: m.authorUserId })),
      ...files
        .filter((f) => !ctx.isTeam(f.uploadedByUserId))
        .map((f) => ({ businessId: f.businessId, userId: f.uploadedByUserId })),
    ];
    const contacts = await this.contactsOf(tx, firmSide);
    const personOf = (businessId: string, userId: string) =>
      ctx.isTeam(userId)
        ? ctx.nameOf(userId)
        : (contacts.get(`${businessId}:${userId}`)?.name ?? FIRM_MEMBER);
    const opening = decorated.map(({ row: t, ticket }) => ({
      id: t.id,
      author: ticket.createdBy,
      body: t.description,
      at: t.createdAt.toISOString(),
      attachments: files
        .filter(
          (f) =>
            f.ticketId === t.id &&
            !f.messageId &&
            !f.noteId &&
            f.createdAt.getTime() === t.createdAt.getTime(),
        )
        .map((f) => ({ id: f.id, name: f.fileName })),
      sentToClient: true,
      mergedFrom: from(t.id),
    }));
    const replies = messages.map((m) => ({
      id: m.id,
      author: {
        name:
          m.authorSide === 'STAFF'
            ? ctx.nameOf(m.authorUserId)
            : personOf(m.businessId, m.authorUserId),
        role: m.authorSide === 'STAFF' ? ('SUPPORT' as const) : ('CLIENT' as const),
      },
      body: m.body,
      at: m.createdAt.toISOString(),
      attachments: files
        .filter((f) => f.messageId === m.id)
        .map((f) => ({ id: f.id, name: f.fileName })),
      sentToClient: m.authorSide === 'CUSTOMER' || m.deliveryChannel !== null,
      mergedFrom: from(m.ticketId),
    }));
    const head = ticketOf.get(id)!.ticket;
    return {
      ...head,
      description: row.description,
      messages: [...opening, ...replies].sort((a, b) => a.at.localeCompare(b.at)),
      notes: notes.map((n) => ({
        id: n.id,
        author: ctx.nameOf(n.authorUserId),
        body: n.body,
        at: n.createdAt.toISOString(),
        mergedFrom: from(n.ticketId),
      })),
      attachments: files.map((f) => ({
        id: f.id,
        name: f.fileName,
        type: f.contentType,
        size: f.sizeBytes,
        uploadedBy: personOf(f.businessId, f.uploadedByUserId),
        at: f.createdAt.toISOString(),
        mergedFrom: from(f.ticketId),
        scanStatus: f.scanStatus,
      })),
      activity: events.map((e) => {
        const t = ticketOf.get(e.ticketId)!.row;
        const entry = activityOf(e, t.source, ctx);
        const merged = from(e.ticketId);
        return merged === null
          ? entry
          : { ...entry, note: `${entry.note ? `${entry.note} ` : ''}(from ${number(merged)})` };
      }),
    };
  }
}

// ---------- Pure helpers ----------

const TABS: readonly SupportTicketTab[] = [
  'ALL',
  'UNASSIGNED',
  'MINE',
  'HIGH_PRIORITY',
  'OVERDUE',
  'WAITING',
  'ESCALATED',
  'CLOSED',
];

const change = (current: number, previous: number) =>
  previous === 0 ? null : Math.round(((current - previous) / previous) * 100);

function systemEscalation(at: Date, reason: string): Prisma.SupportTicketUncheckedUpdateManyInput {
  return { isEscalated: true, escalatedAt: at, escalatedByUserId: null, escalationReason: reason };
}

async function event(
  tx: TxClient,
  t: { id: string; businessId: string },
  action: string,
  actorUserId: string | null,
  oldValue: string | null,
  newValue: string | null,
): Promise<void> {
  await tx.supportTicketEvent.create({
    data: {
      businessId: t.businessId,
      ticketId: t.id,
      actorUserId,
      actorType: actorUserId ? 'USER' : 'SYSTEM',
      action,
      oldValue: oldValue?.slice(0, 500) ?? null,
      newValue: newValue?.slice(0, 500) ?? null,
    },
  });
}

/** The High Priority tab: priorities as urgent as the high-priority rule's (or the top two). */
function highRank(ctx: SupportContext): number {
  const rule = ruleOf(ctx, 'HIGH_PRIORITY_UNRESOLVED');
  return ctx.priorities.find((p) => p.id === rule?.priorityId)?.rank ?? 2;
}

export function inTab(t: SupportTicket, tab: SupportTicketTab, ctx: SupportContext): boolean {
  const active = isActive(t.status);
  switch (tab) {
    case 'ALL':
      return true;
    case 'UNASSIGNED':
      return active && !t.assignee;
    case 'MINE':
      return t.assignee?.id === ctx.me.id;
    case 'HIGH_PRIORITY':
      return active && t.priority.rank <= highRank(ctx);
    case 'OVERDUE':
      return active && t.sla.state === 'BREACHED';
    case 'WAITING':
      return t.status === 'WAITING_ON_CUSTOMER';
    case 'ESCALATED':
      return active && t.escalation !== null;
    case 'CLOSED':
      return t.status === 'CLOSED';
  }
}

export function matchesFilters(
  t: SupportTicket,
  q: Out<typeof SupportTicketsQuery>,
  ctx: SupportContext,
): boolean {
  const zone = ctx.hours.timeZone;
  if (q.statuses?.length && !q.statuses.includes(t.status)) return false;
  if (q.priorityIds?.length && !q.priorityIds.includes(t.priority.id)) return false;
  if (q.categoryIds?.length && !q.categoryIds.includes(t.category.id)) return false;
  if (q.firmId && t.firm.id !== q.firmId) return false;
  if (q.assigneeId && (t.assignee?.id ?? 'UNASSIGNED') !== q.assigneeId) return false;
  if (q.source && t.source !== q.source) return false;
  if (!inDays(Date.parse(t.createdAt), zone, q.createdFrom, q.createdTo)) return false;
  if (!inDays(Date.parse(t.updatedAt), zone, q.activityFrom, q.activityTo)) return false;
  if (q.sla && t.sla.state !== q.sla) return false;
  if (q.escalated === 'YES' && !t.escalation) return false;
  if (q.escalated === 'NO' && t.escalation) return false;
  if (q.set === 'OPEN' && !OPEN_SET.includes(t.status)) return false;
  if (
    q.set === 'RESOLVED_30' &&
    !(t.resolvedAt && ctx.now - Date.parse(t.resolvedAt) <= 30 * DAYS.DAY)
  )
    return false;
  return true;
}

/** Number, subject, firm, contact name and email, category and assignee; every word must match. */
export function matchesSearch(t: SupportTicket, search: string): boolean {
  const words = search.toLowerCase().replace(/#/g, '').split(/\s+/).filter(Boolean);
  const haystack = [
    String(t.number),
    String(t.number).padStart(4, '0'),
    t.subject,
    t.firm.name,
    t.contact.name,
    t.contact.email,
    t.category.name,
    t.assignee?.name ?? 'unassigned',
  ]
    .join(' ')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

const STATUS_LABEL = (value: string | null) =>
  value && value in SUPPORT_TICKET_STATUS_LABELS
    ? SUPPORT_TICKET_STATUS_LABELS[value as SupportTicketStatus]
    : value;

/** A history row as the activity feed shows it. */
export function activityOf(
  e: {
    id: string;
    action: string;
    actorType: string;
    actorUserId: string | null;
    oldValue: string | null;
    newValue: string | null;
    createdAt: Date;
  },
  source: keyof typeof SUPPORT_TICKET_SOURCE_LABELS,
  ctx: Pick<SupportContext, 'nameOf'>,
): SupportTicketActivity {
  const system = e.actorType === 'SYSTEM';
  const base = {
    id: e.id,
    at: e.createdAt.toISOString(),
    actor: system ? 'System' : ctx.nameOf(e.actorUserId),
    from: null as string | null,
    to: null as string | null,
    note: null as string | null,
  };
  const as = (type: SupportActivityType, extra: Partial<typeof base> = {}) => ({
    ...base,
    type,
    ...extra,
  });
  switch (e.action) {
    case 'ticket.created':
      return as('CREATED', { note: `Created from ${SUPPORT_TICKET_SOURCE_LABELS[source]}` });
    case 'ticket.assigned':
      return as('ASSIGNED', { to: e.newValue, note: system ? 'Round robin' : null });
    case 'ticket.reassigned':
      return as('REASSIGNED', {
        from: e.oldValue,
        to: e.newValue,
        note: system ? 'Not taken in time' : null,
      });
    case 'ticket.unassigned':
      return as('UNASSIGNED', { from: e.oldValue, to: e.newValue ?? QUEUE });
    case 'ticket.queued':
      return as('AUTOMATION', { note: `Placed in the ${QUEUE}` });
    case 'ticket.status_changed':
      return as('STATUS_CHANGED', { from: STATUS_LABEL(e.oldValue), to: STATUS_LABEL(e.newValue) });
    case 'ticket.priority_changed':
      return as('PRIORITY_CHANGED', { from: e.oldValue, to: e.newValue });
    case 'ticket.category_changed':
      return as('CATEGORY_CHANGED', { from: e.oldValue, to: e.newValue });
    case 'message.added':
      return as('MESSAGE', {
        note: e.newValue === 'SENT' ? 'Sent to the client' : 'Kept in the conversation',
      });
    case 'message.customer':
      return as('CLIENT_REPLY');
    case 'note.added':
      return as('NOTE');
    case 'attachment.added':
      return as('ATTACHMENT', { to: e.newValue });
    case 'ticket.escalated':
      return as('ESCALATED', { note: e.newValue });
    case 'sla.warning':
      return as('SLA_WARNING', { note: 'Response due soon' });
    case 'sla.breached':
      return as('SLA_BREACHED', { note: 'Response time exceeded the target' });
    case 'ticket.resolved':
      return as('RESOLVED');
    case 'ticket.reopened':
      return as('REOPENED');
    case 'ticket.closed':
      return as('CLOSED');
    case 'ticket.merged':
      return as('MERGED', { from: e.oldValue, to: e.newValue });
    case 'ticket.deleted':
      return as('AUTOMATION', { note: 'Ticket deleted' });
    default:
      return as('AUTOMATION', { note: e.action });
  }
}

export type { SupportUploadClaim };
