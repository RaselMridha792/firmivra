import {
  Controller,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { type Database, Prisma } from '@firmivra/db';
import {
  ClientId,
  type ClientTimelineEntry,
  type ClientTimelinePage,
  ClientTimelineQuery,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import { type AuthContext, legacyFirmRole, type TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DATABASE } from '../database/database.module.js';
import { activityText } from '../bookkeeping/bookkeeping.mappers.js';
import { memberNames } from '../workspaces/common.js';

// MSG-F16 and the client's Activity tab: the client's own timeline (R1's insert-only
// client_timeline_entries). Read here; the features that make entries write them (New Message's
// Add to Client Timeline). Staff read only the clients assigned to them, as the Clients list.

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });

/** A page's place: the last entry's time and id, so entries at the same instant are not lost. */
const encode = (at: Date, id: string) =>
  Buffer.from(`${at.toISOString()}|${id}`, 'utf8').toString('base64url');
function decode(cursor: string): { at: Date; id: string } | null {
  const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const when = at ? new Date(at) : null;
  return when && !Number.isNaN(when.getTime()) && id && /^[0-9a-f-]{36}$/i.test(id)
    ? { at: when, id }
    : null;
}

/** One event of the client's Activity, from any of the tables Last Activity reads. */
interface EventRow {
  id: string;
  at: Date;
  kind: string;
  title: string;
  summary: string | null;
  src: string;
  source_type: string | null;
  ref: string | null;
  actor: string | null;
}

/** The record an event opens in the firm workspace, or null when it has no page of its own. */
function hrefOf(r: EventRow, clientId: string): string | null {
  switch (r.src) {
    case 'message':
      return r.ref ? `/messages?thread=${r.ref}` : null;
    case 'document':
      return r.ref ? `/documents/${r.ref}` : null;
    case 'document_request':
      return `/clients/${clientId}/documents`;
    case 'task':
      return r.ref ? `/tasks/${r.ref}` : null;
    case 'appointment':
      return r.ref ? `/calendar/${r.ref}` : null;
    case 'invoice':
      return r.ref ? `/invoices/${r.ref}` : null;
    case 'esign':
      return r.ref ? `/firm-sign/requests/${r.ref}` : null;
    case 'note':
      return `/clients/${clientId}/notes`;
    case 'bookkeeping':
      return r.ref ? `/bookkeeping/clients/${r.ref}` : null;
    default:
      return null;
  }
}

/** Review 2 (E01a A01): a note's type in words ("General note"), never its code. */
const NOTE_TYPES: Record<string, string> = {
  GENERAL: 'General note',
  CALL: 'Call note',
  MEETING: 'Meeting note',
  FOLLOW_UP: 'Follow-up note',
  DOCUMENT: 'Document note',
  BILLING: 'Billing note',
};
const noteTypeText = (t: string) =>
  NOTE_TYPES[t] ?? `${t.charAt(0)}${t.slice(1).toLowerCase().replace(/_+/g, ' ')} note`;

/** A client change in words: "client.assignment_changed" is "Assigned staff changed". */
const AUDIT_TITLES: Record<string, string> = {
  'client.created': 'Client added',
  'client.updated': 'Profile updated',
  'client.profile_updated': 'Profile updated',
  'client.profile_changed': 'Profile updated',
  'client.assignment_changed': 'Assigned staff changed',
  'client.archived': 'Client archived',
  'client.restored': 'Client restored',
  'client.reactivated': 'Client reactivated',
  'client.tags_set': 'Tags changed',
  'client.tags_changed': 'Tags changed',
  'client.status_changed': 'Status changed',
  'client.office_changed': 'Office changed',
};
export function auditTitle(action: string): string {
  const known = AUDIT_TITLES[action];
  if (known) return known;
  const words = action
    .replace(/^client\./, '')
    .replace(/[._]+/g, ' ')
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Client changed';
}

@Injectable()
export class ClientTimelineService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  async list(
    businessId: string,
    actor: { userId: string; role: 'OWNER' | 'ADMIN' | 'STAFF' },
    clientId: string,
    q: z.output<typeof ClientTimelineQuery>,
  ): Promise<ClientTimelinePage> {
    const after = q.cursor ? decode(q.cursor) : null;
    const page = await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      const client = await tx.client.findFirst({
        where: {
          businessId,
          id: clientId,
          ...(actor.role === 'STAFF' ? { assignedUserId: actor.userId } : {}),
        },
        select: { id: true },
      });
      if (!client) throw notFound();
      // N8-05: every recorded client event: the timeline's entries (messages the firm added to
      // it), the client's own portal replies, documents, requests, completed tasks, held
      // appointments, invoices issued and paid, signed e-sign requests, notes and the client's
      // own recorded changes (never a view, list or export). Last Activity counts these and also
      // every firm message (the owner's rule); the feed shows a firm message only when it was
      // added to the timeline (her N8-05 opt-in). Newest first, paged by time and id.
      const b = businessId;
      const c = clientId;
      const page = after
        ? Prisma.sql`WHERE (e.at, e.id) < (${after.at}::timestamptz, ${after.id}::uuid)`
        : Prisma.empty;
      const rows = await tx.$queryRaw<EventRow[]>`
        SELECT e.* FROM (
          SELECT t.id, t.occurred_at AS at, t.kind::text AS kind, t.title, t.summary,
                 'timeline' AS src, t.source_type, t.source_id::text AS ref,
                 t.created_by_user_id::text AS actor
            FROM client_timeline_entries t
            WHERE t.business_id = ${b}::uuid AND t.client_id = ${c}::uuid
          UNION ALL SELECT m.id, m.created_at, 'MESSAGE', th.subject, 'Reply from the client',
                 'message', NULL, th.id::text, NULL
            FROM messages m
            JOIN message_threads th ON th.business_id = m.business_id AND th.id = m.thread_id
            WHERE m.business_id = ${b}::uuid AND th.client_id = ${c}::uuid
              AND m.direction = 'CLIENT_TO_FIRM'
          UNION ALL SELECT d.id, d.created_at, 'DOCUMENT', d.file_name,
                 CASE WHEN d.direction = 'CLIENT_TO_FIRM' THEN 'Uploaded by the client'
                      ELSE 'Uploaded by the firm' END,
                 'document', NULL, d.id::text, d.uploaded_by_user_id::text
            FROM documents d WHERE d.business_id = ${b}::uuid AND d.client_id = ${c}::uuid
          UNION ALL SELECT r.id, r.created_at, 'DOCUMENT', r.title, 'Document requested',
                 'document_request', NULL, NULL, r.requested_by_user_id::text
            FROM document_requests r
            WHERE r.business_id = ${b}::uuid AND r.client_id = ${c}::uuid
          UNION ALL SELECT k.id, k.completed_at, 'TASK', k.title, 'Task completed',
                 'task', NULL, k.id::text, k.completed_by_user_id::text
            FROM tasks k WHERE k.business_id = ${b}::uuid AND k.client_id = ${c}::uuid
              AND k.completed_at IS NOT NULL
          UNION ALL SELECT a.id, a.starts_at, 'MEETING', 'Appointment',
                 CASE WHEN a.status = 'COMPLETED' THEN 'Completed' ELSE 'Held' END,
                 'appointment', NULL, a.id::text, NULL
            FROM appointments a WHERE a.business_id = ${b}::uuid AND a.client_id = ${c}::uuid
              AND (a.status = 'COMPLETED' OR (a.status = 'SCHEDULED' AND a.starts_at <= now()))
          UNION ALL SELECT i.id, i.issued_at, 'INVOICE', 'Invoice ' || i.number, 'Issued',
                 'invoice', NULL, i.id::text, i.created_by_user_id::text
            FROM invoices i WHERE i.business_id = ${b}::uuid AND i.client_id = ${c}::uuid
              AND i.issued_at IS NOT NULL
          -- Clients Review 2 (C2-043): the Paid row's own id, stable per invoice. An md5 cast as is
          -- is not a valid UUID (its variant digit can be 0-7), which failed the Activity page's
          -- response check for every client with a paid invoice; set the version (5) and the
          -- variant (8) digits.
          UNION ALL SELECT overlay(overlay(md5('paid:' || i.id::text) placing '5' from 13 for 1)
                             placing '8' from 17 for 1)::uuid, i.paid_at, 'INVOICE',
                 'Invoice ' || i.number, 'Paid', 'invoice', NULL, i.id::text, NULL
            FROM invoices i WHERE i.business_id = ${b}::uuid AND i.client_id = ${c}::uuid
              AND i.paid_at IS NOT NULL
          UNION ALL SELECT s.id, s.completed_at, 'DOCUMENT', s.title, 'Signed',
                 'esign', NULL, s.id::text, NULL
            FROM esign_requests s WHERE s.business_id = ${b}::uuid AND s.client_id = ${c}::uuid
              AND s.completed_at IS NOT NULL
          UNION ALL SELECT n.id, n.created_at, 'NOTE', 'Note added', n.note_type,
                 'note', NULL, NULL, n.author_user_id::text
            FROM notes n WHERE n.business_id = ${b}::uuid AND n.client_id = ${c}::uuid
          -- Review 2 (E01a A01): the client's Bookkeeping Activity, from the card's own source;
          -- a note or an upload it copies is already listed above, so it is left out here.
          UNION ALL SELECT ba.id, ba.created_at, 'OTHER', ba.summary, 'Bookkeeping',
                 'bookkeeping', NULL, bp.id::text, ba.actor_user_id::text
            FROM bookkeeping_activity ba
            JOIN engagements en ON en.business_id = ba.business_id AND en.id = ba.engagement_id
            LEFT JOIN bookkeeping_profiles bp
              ON bp.business_id = ba.business_id AND bp.engagement_id = ba.engagement_id
            WHERE ba.business_id = ${b}::uuid AND en.client_id = ${c}::uuid
              AND ba.details->>'noteId' IS NULL AND ba.details->>'documentId' IS NULL
          UNION ALL SELECT l.id, l.created_at, 'OTHER', l.action, NULL,
                 'audit', NULL, NULL, l.actor_user_id::text
            FROM audit_logs l WHERE l.business_id = ${b}::uuid AND l.entity_type = 'client'
              AND l.entity_id = ${c} AND l.action !~ '(viewed|listed|exported)$'
        ) e
        ${page}
        ORDER BY e.at DESC, e.id DESC
        LIMIT ${q.limit + 1}`;
      const shown = rows.slice(0, q.limit);
      // A sent message opens its conversation (a portal message) or its outcome in New Message; a
      // conversation started from the client's Messages tab (N8-05) opens that conversation.
      const recipients = await tx.outboundMessageRecipient.findMany({
        where: {
          businessId,
          id: {
            in: shown
              .filter(
                (r) =>
                  r.src === 'timeline' && r.source_type === 'outbound_message_recipient' && r.ref,
              )
              .map((r) => r.ref!),
          },
        },
        select: { id: true, outboundMessageId: true, message: { select: { threadId: true } } },
      });
      const names = await memberNames(
        tx,
        businessId,
        shown.map((r) => r.actor),
      );
      const items = shown.map((r): ClientTimelineEntry => {
        const sent = recipients.find((x) => x.id === r.ref);
        const timelineHref = sent
          ? sent.message
            ? `/messages?thread=${sent.message.threadId}`
            : `/messages/new?id=${sent.outboundMessageId}`
          : r.source_type === 'message_thread' && r.ref
            ? `/messages?thread=${r.ref}`
            : null;
        const name = r.actor ? names.get(r.actor) : undefined;
        return {
          id: r.id,
          kind: r.kind as ClientTimelineEntry['kind'],
          title: (r.src === 'audit'
            ? auditTitle(r.title)
            : r.src === 'bookkeeping'
              ? activityText(r.title)
              : r.title
          ).slice(0, 200),
          summary: r.summary
            ? (r.src === 'note' ? noteTypeText(r.summary) : r.summary).slice(0, 500)
            : null,
          occurredAt: r.at.toISOString(),
          href: r.src === 'timeline' ? timelineHref : hrefOf(r, clientId),
          createdBy: r.actor && name ? { userId: r.actor, name } : null,
        };
      });
      const last = shown.at(-1);
      return {
        items,
        nextCursor: rows.length > q.limit && last ? encode(last.at, last.id) : null,
      };
    });
    await this.audit.log('client_timeline.viewed', { type: 'client', id: clientId });
    return page;
  }
}

/** GET /business/clients/{id}/timeline (contract in packages/types/src/clients/timeline.ts). */
@Controller('business/clients')
@Access('CLIENTS')
export class ClientTimelineController {
  constructor(private readonly timeline: ClientTimelineService) {}

  @Get(':id/timeline')
  @Roles(...FIRM_STAFF)
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(ClientId)) id: string,
    @Query(new ZodValidationPipe(ClientTimelineQuery))
    query: z.output<typeof ClientTimelineQuery>,
  ): Promise<ClientTimelinePage> {
    if (tenant.kind !== 'staff') throw new Error('client timeline routes are for firm members');
    return this.timeline.list(
      tenant.businessId,
      { userId: auth.userId, role: legacyFirmRole(tenant.role) },
      id,
      query,
    );
  }
}
