import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import type { TxClient } from '@firmivra/db';
import type { SupportTicketStatus } from '@firmivra/types';

/**
 * A firm's own requests to Firmivra as support tickets (Company Profile's Request Change, Billing's
 * plan and contact requests): raised in the firm's scope with the member as the actor, which the
 * database's `support_tickets_firm_raise` policy requires (source Portal, unassigned, the member
 * as creator and contact). The firm reads its own tickets and the replies sent to it. Each kind of
 * request has its own fixed subject start; a ticket's subject never changes after insert.
 */

export const ticketSelect = {
  id: true,
  number: true,
  subject: true,
  status: true,
  createdAt: true,
  resolvedAt: true,
  closedAt: true,
  contact: { select: { user: { select: { name: true } } } },
} as const;

export interface TicketRow {
  id: string;
  number: number;
  subject: string;
  status: SupportTicketStatus;
  createdAt: Date;
  resolvedAt: Date | null;
  closedAt: Date | null;
  contact: { user: { name: string } };
}

/** "#1004", as the Super Admin queue shows it. */
export const ticketNumber = (row: Pick<TicketRow, 'number'>) => `#${row.number}`;

/** The firm's tickets whose subject starts with one of `prefixes`, newest first. */
export function ticketsStartingWith(
  tx: TxClient,
  businessId: string,
  prefixes: readonly string[],
  take: number,
): Promise<TicketRow[]> {
  return tx.supportTicket.findMany({
    where: {
      businessId,
      source: 'PORTAL',
      deletedAt: null,
      OR: prefixes.map((p) => ({ subject: { startsWith: p } })),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
    select: ticketSelect,
  });
}

/** The firm's ticket raised with this idempotency key, or null. */
export function ticketByKey(
  tx: TxClient,
  businessId: string,
  key: string,
): Promise<TicketRow | null> {
  return tx.supportTicket.findFirst({
    where: { businessId, idempotencyKey: key },
    select: ticketSelect,
  });
}

/** Firmivra's latest reply sent to the firm on each ticket; one kept back was never sent. */
export async function latestReplies(
  tx: TxClient,
  businessId: string,
  ids: readonly string[],
): Promise<Map<string, { body: string; at: string }>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.supportTicketMessage.findMany({
    where: {
      businessId,
      ticketId: { in: [...ids] },
      authorSide: 'STAFF',
      deliveryChannel: 'PORTAL',
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { ticketId: true, body: true, createdAt: true },
  });
  const out = new Map<string, { body: string; at: string }>();
  for (const r of rows)
    if (!out.has(r.ticketId)) out.set(r.ticketId, { body: r.body, at: r.createdAt.toISOString() });
  return out;
}

/**
 * Raises the ticket in the Super Admin queue. Categories and priorities are the team's reference
 * data (renamed or turned off there), so `category` and `priority` are preferences: the first
 * active one otherwise, and 503 SUPPORT_UNAVAILABLE when there is none.
 */
export async function raiseTicket(
  tx: TxClient,
  input: {
    businessId: string;
    userId: string;
    requestId: string;
    subject: string;
    description: string;
    category: string;
    priority: string;
  },
): Promise<TicketRow> {
  const category = await tx.supportCategory.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true },
  });
  const priority = await tx.supportPriority.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    select: { id: true, code: true },
  });
  const categoryId = (category.find((c) => c.name === input.category) ?? category[0])?.id;
  const priorityId = (priority.find((p) => p.code === input.priority) ?? priority[0])?.id;
  if (!categoryId || !priorityId)
    throw new ServiceUnavailableException({
      code: 'SUPPORT_UNAVAILABLE',
      message: "Requests can't be sent right now. Try again later.",
    });
  return tx.supportTicket.create({
    data: {
      businessId: input.businessId,
      contactUserId: input.userId,
      createdByUserId: input.userId,
      subject: input.subject,
      description: input.description,
      categoryId,
      priorityId,
      source: 'PORTAL',
      idempotencyKey: input.requestId,
    },
    select: ticketSelect,
  });
}

/** When Firmivra resolved or closed it; null while it is open. */
export const closedAtOf = (row: TicketRow) =>
  row.status === 'RESOLVED' || row.status === 'CLOSED'
    ? ((row.closedAt ?? row.resolvedAt)?.toISOString() ?? null)
    : null;

/** A request key already used by another ticket (another firm's, or another kind). */
export const duplicateKey = () =>
  new ConflictException({
    code: 'CONFLICT',
    message: 'This request was already used. Close the dialog and try again.',
  });

export const isUniqueViolation = (error: unknown) => (error as { code?: string }).code === 'P2002';
