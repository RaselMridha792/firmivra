import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@firmivra/db';
import type {
  MemberRef,
  MessageTemplateKind,
  MessageTemplateRow,
  TemplateCategory,
  TemplateErrorCode,
} from '@firmivra/types';
import type { ClientsActor } from '../clients/clients.service.js';
import { conflict, memberRef } from '../workspaces/common.js';

/** The errors of the Templates routes beyond NOT_FOUND (codes in packages/types/src/templates). */
const code = (c: TemplateErrorCode, message: string) => conflict(c, message);

export const templateErrors = {
  duplicateName: (what: string) =>
    code('DUPLICATE_NAME', `A ${what} with this name already exists`),
  saveConflict: () =>
    code('SAVE_CONFLICT', 'Someone saved this after you opened it. Reload and try again.'),
  automationInUse: (count: number) =>
    code(
      'AUTOMATION_IN_USE',
      `${count} active automation${count === 1 ? ' uses' : 's use'} this template. Confirm to change or archive it.`,
    ),
  categoryNotAllowed: () =>
    code('CATEGORY_NOT_ALLOWED', 'Choose a category of this kind of template that is not archived'),
  notAutomationEligible: () =>
    code(
      'NOT_AUTOMATION_ELIGIBLE',
      'Only an active template of a kind automations support can be offered to them',
    ),
  notAMember: () => code('NOT_A_MEMBER', 'That person is not a member of the firm'),
  archived: () => code('TEMPLATE_ARCHIVED', 'Restore the template before changing it'),
  fieldInUse: (message: string) => code('FIELD_IN_USE', message),
  subjectRequired: () =>
    new BadRequestException({
      code: 'SUBJECT_REQUIRED',
      message: 'Write a subject before making this template active',
    }),
  notTheOwner: () =>
    new ForbiddenException({
      code: 'NOT_THE_OWNER',
      message: 'Only its owner, an Owner or an Admin can change this template',
    }),
  /** A request that passed the contract but names something that is not the firm's. */
  invalid: (path: string, message: string) =>
    new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'The request is not valid',
      details: [{ path, message }],
    }),
};

/** Kinds whose messages have a subject or title: an active template of one needs it. */
export const SUBJECT_KINDS: ReadonlySet<MessageTemplateKind> = new Set([
  'EMAIL',
  'LETTER_NOTICE',
  'CAMPAIGN',
  'ANNOUNCEMENT',
]);

/** Kinds automations can start from or act with (an action: send email, SMS, portal message...). */
export const AUTOMATION_KINDS: ReadonlySet<MessageTemplateKind> = new Set([
  'EMAIL',
  'SMS',
  'PORTAL_MESSAGE',
  'DOCUMENT_REQUEST',
  'INVOICE_PAYMENT',
  'APPOINTMENT',
  'TASK',
  'TAX_WORKFLOW',
  'BOOKKEEPING',
  'PAYROLL',
  'LEAD_FOLLOW_UP',
  'CAMPAIGN',
]);

/** Plain text, not markup: a text message and a task checklist. */
export const PLAIN_KINDS: ReadonlySet<MessageTemplateKind> = new Set(['SMS', 'TASK']);

/** Owner and Admin administer every template; the legacy Staff role only what it may see. */
export const isAdmin = (actor: ClientsActor) => actor.role !== 'STAFF';

/**
 * The templates the actor may see: Owner and Admin all; others their own, the team's, and those
 * shared with them (a SELECTED template lists its people in message_template_shares).
 */
export function visibleTo(actor: ClientsActor): Prisma.MessageTemplateWhereInput {
  if (isAdmin(actor)) return {};
  return {
    OR: [
      { ownerUserId: actor.userId },
      { access: 'TEAM' },
      { access: 'SELECTED', shares: { some: { userId: actor.userId } } },
    ],
  };
}

/** Who may change a template: its owner, an Owner or Admin, or anyone for a team template. */
export const canEdit = (t: { ownerUserId: string; access: string }, actor: ClientsActor) =>
  isAdmin(actor) || t.ownerUserId === actor.userId || t.access === 'TEAM';

/** Who may change who sees it: its owner, an Owner or an Admin. */
export const canShare = (t: { ownerUserId: string }, actor: ClientsActor) =>
  isAdmin(actor) || t.ownerUserId === actor.userId;

export const rowInclude = (actorUserId: string) =>
  ({
    category: { select: { id: true, name: true } },
    favorites: { where: { userId: actorUserId }, select: { userId: true } },
    _count: { select: { uses: true } },
  }) satisfies Prisma.MessageTemplateInclude;

export type RowShape = Prisma.MessageTemplateGetPayload<{
  include: ReturnType<typeof rowInclude>;
}>;

/** A member who has left keeps their template; the name is then a stand-in. */
export function ownerRef(names: Map<string, string>, userId: string): MemberRef {
  return memberRef(names, userId) ?? { userId, name: 'Former member' };
}

export function toRow(t: RowShape, names: Map<string, string>): MessageTemplateRow {
  return {
    id: t.id,
    kind: t.kind,
    category: t.category ? { id: t.category.id, name: t.category.name } : null,
    name: t.name,
    description: t.description,
    subject: t.subject,
    tags: t.tags,
    status: t.status,
    access: t.access,
    starter: t.starterKey !== null,
    includeInAutomations: t.includeInAutomations,
    owner: ownerRef(names, t.ownerUserId),
    updatedBy: t.updatedByUserId ? memberRef(names, t.updatedByUserId) : null,
    version: t.version,
    favorite: t.favorites.length > 0,
    useCount: t._count.uses,
    updatedAt: t.updatedAt.toISOString(),
  };
}

export function toCategory(
  c: {
    id: string;
    kind: MessageTemplateKind;
    name: string;
    description: string | null;
    sortOrder: number;
    archivedAt: Date | null;
  },
  templateCount: number,
): TemplateCategory {
  return {
    id: c.id,
    kind: c.kind,
    name: c.name,
    description: c.description,
    sortOrder: c.sortOrder,
    archivedAt: c.archivedAt?.toISOString() ?? null,
    templateCount,
  };
}

export const etagOf = (t: { updatedAt: Date }) => t.updatedAt.toISOString();
