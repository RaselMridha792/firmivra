import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import {
  type CreateProfileChangeRequest,
  PROFILE_CHANGE_FIELDS,
  PROFILE_CHANGE_KIND_LABELS,
  type ProfileChange,
  type ProfileChangeField,
  type ProfileChangeKind,
  type ProfileChangeList,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import {
  closedAtOf,
  duplicateKey,
  isUniqueViolation,
  latestReplies,
  raiseTicket,
  ticketByKey,
  ticketNumber,
  type TicketRow,
  ticketsStartingWith,
} from './firm-tickets.js';

type Body = z.output<typeof CreateProfileChangeRequest>;

const KINDS = ['COMPANY', 'LICENSING'] as const satisfies readonly ProfileChangeKind[];
const FIELDS = Object.keys(PROFILE_CHANGE_FIELDS) as ProfileChangeField[];

/**
 * A request's subject: its card's title and the fields' labels ("Company Information change
 * request: Legal Company Name, EIN (Tax ID)"). A ticket's subject never changes after insert, so
 * it is how the firm's requests are found among its support tickets.
 */
const prefixOf = (kind: ProfileChangeKind) =>
  `${PROFILE_CHANGE_KIND_LABELS[kind]} change request: `;

export function subjectOf(kind: ProfileChangeKind, fields: readonly ProfileChangeField[]): string {
  return prefixOf(kind) + fields.map((f) => PROFILE_CHANGE_FIELDS[f].label).join(', ');
}

/** The kind and fields a subject names; null for any other ticket. */
export function parseSubject(
  subject: string,
): { kind: ProfileChangeKind; fields: ProfileChangeField[] } | null {
  for (const kind of KINDS) {
    if (!subject.startsWith(prefixOf(kind))) continue;
    const labels = new Set(subject.slice(prefixOf(kind).length).split(', '));
    const fields = FIELDS.filter(
      (f) => PROFILE_CHANGE_FIELDS[f].kind === kind && labels.has(PROFILE_CHANGE_FIELDS[f].label),
    );
    return { kind, fields };
  }
  return null;
}

export const ROLE_NAMES: Record<string, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  STAFF: 'Staff',
};

const EIN_SHOWN = (ein: string) => `${ein.slice(0, 2)}-${ein.slice(2)}`;

/**
 * Company Profile's Request Change (Rasel's default, Oct 24): the legal name, the EIN and the
 * licensing details are changed only by Firmivra. An Owner or Admin raises a support ticket for
 * the Super Admin team (`firm-tickets.ts`) with the current and proposed values and the reason.
 * Nothing on the profile changes here. The audit entry names the fields, never the values.
 */
@Injectable()
export class ProfileChangesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, userId: string, fn: (tx: TxClient) => Promise<T>) {
    return this.database.withScope({ kind: 'business', businessId, actorUserId: userId }, fn);
  }

  /** GET: the firm's requests, newest first, with Firmivra's latest reply on each. */
  list(businessId: string, userId: string): Promise<ProfileChangeList> {
    return this.inFirm(businessId, userId, async (tx) => {
      const rows = await ticketsStartingWith(tx, businessId, KINDS.map(prefixOf), 20);
      return { items: await this.views(tx, businessId, rows) };
    });
  }

  /** POST: one ticket per `requestId`; the same key again answers the first request. */
  async create(businessId: string, userId: string, body: Body): Promise<ProfileChange> {
    const known = await this.byKey(businessId, userId, body.requestId);
    if (known) return known;
    try {
      return await this.inFirm(businessId, userId, async (tx) => {
        // One query at a time: a transaction holds one connection.
        const business = await tx.business.findUniqueOrThrow({
          where: { id: businessId },
          select: { legalName: true },
        });
        const settings = await tx.businessSettings.findUnique({
          where: { businessId },
          select: { einLast4: true },
        });
        const member = await tx.membership.findUniqueOrThrow({
          where: { businessId_userId: { businessId, userId } },
          select: { role: true, user: { select: { name: true } } },
        });
        if (body.changes.legalName !== undefined && body.changes.legalName === business.legalName)
          throw new BadRequestException({
            code: 'VALIDATION_FAILED',
            message: 'The request is not valid',
            details: [{ path: 'changes.legalName', message: 'This is already the legal name' }],
          });
        const fields = FIELDS.filter((f) => body.changes[f] !== undefined);
        const current: Record<ProfileChangeField, string> = {
          legalName: business.legalName ?? 'Not on file',
          ein: settings?.einLast4 ? `Ending in ${settings.einLast4}` : 'Not on file',
          // No licensing columns yet (Column request for R1, item 7).
          regulatoryBody: 'Not on file',
          licenseType: 'Not on file',
          licenseNumber: 'Not on file',
          expirationDate: 'Not on file',
        };
        const proposed = (f: ProfileChangeField) => {
          const value = body.changes[f] as string;
          return f === 'ein' ? EIN_SHOWN(value) : value;
        };
        const description = [
          `${member.user.name} (${ROLE_NAMES[member.role] ?? member.role}) asks Firmivra to ` +
            `change the firm's ${PROFILE_CHANGE_KIND_LABELS[body.kind]} on Company Profile.`,
          '',
          ...fields.flatMap((f) => [
            PROFILE_CHANGE_FIELDS[f].label,
            `Current: ${current[f]}`,
            `Proposed: ${proposed(f)}`,
            '',
          ]),
          'Reason:',
          body.reason,
          '',
          "Nothing on the firm's profile changes until Firmivra applies it.",
        ].join('\n');
        const row = await raiseTicket(tx, {
          businessId,
          userId,
          requestId: body.requestId,
          subject: subjectOf(body.kind, fields),
          description,
          category: 'Compliance',
          priority: 'MEDIUM',
        });
        await this.audit.logIn(
          tx,
          'settings.profile_change_requested',
          { type: 'support_ticket', id: row.id },
          { kind: body.kind, fields, number: row.number },
          { businessId },
        );
        return (await this.views(tx, businessId, [row]))[0]!;
      });
    } catch (error) {
      // The same key at the same moment: the first insert won; answer it. A key this firm cannot
      // see is another firm's.
      if (isUniqueViolation(error)) {
        const again = await this.byKey(businessId, userId, body.requestId);
        if (again) return again;
        throw duplicateKey();
      }
      throw error;
    }
  }

  /**
   * The firm's request with this key, or null. A key used by any other ticket (another firm's,
   * which this scope cannot see, or not a change request) is 409 CONFLICT.
   */
  private async byKey(businessId: string, userId: string, key: string) {
    return this.inFirm(businessId, userId, async (tx) => {
      const row = await ticketByKey(tx, businessId, key);
      if (!row) return null;
      if (!parseSubject(row.subject)) throw duplicateKey();
      return (await this.views(tx, businessId, [row]))[0]!;
    });
  }

  private async views(
    tx: TxClient,
    businessId: string,
    rows: TicketRow[],
  ): Promise<ProfileChange[]> {
    const replies = await latestReplies(
      tx,
      businessId,
      rows.map((r) => r.id),
    );
    return rows.flatMap((r) => {
      const parsed = parseSubject(r.subject);
      if (!parsed) return [];
      return [
        {
          id: r.id,
          number: ticketNumber(r),
          kind: parsed.kind,
          fields: parsed.fields,
          status: r.status,
          submittedAt: r.createdAt.toISOString(),
          submittedBy: r.contact.user.name,
          closedAt: closedAtOf(r),
          latestReply: replies.get(r.id) ?? null,
        },
      ];
    });
  }
}
