import {
  Controller,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import type { Database } from '@firmivra/db';
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
      const rows = await tx.clientTimelineEntry.findMany({
        where: {
          businessId,
          clientId,
          ...(after
            ? {
                OR: [
                  { occurredAt: { lt: after.at } },
                  { occurredAt: after.at, id: { lt: after.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
        select: {
          id: true,
          kind: true,
          sourceType: true,
          sourceId: true,
          title: true,
          summary: true,
          occurredAt: true,
          createdBy: { select: { userId: true, user: { select: { name: true } } } },
        },
      });
      const shown = rows.slice(0, q.limit);
      // A sent message opens its conversation (a portal message) or its outcome in New Message.
      const recipients = await tx.outboundMessageRecipient.findMany({
        where: {
          businessId,
          id: {
            in: shown
              .filter((r) => r.sourceType === 'outbound_message_recipient' && r.sourceId)
              .map((r) => r.sourceId!),
          },
        },
        select: { id: true, outboundMessageId: true, message: { select: { threadId: true } } },
      });
      const items = shown.map((r): ClientTimelineEntry => {
        const sent = recipients.find((x) => x.id === r.sourceId);
        return {
          id: r.id,
          kind: r.kind,
          title: r.title,
          summary: r.summary,
          occurredAt: r.occurredAt.toISOString(),
          href: sent
            ? sent.message
              ? `/messages?thread=${sent.message.threadId}`
              : `/messages/new?id=${sent.outboundMessageId}`
            : null,
          createdBy: r.createdBy
            ? { userId: r.createdBy.userId, name: r.createdBy.user.name }
            : null,
        };
      });
      const last = shown.at(-1);
      return {
        items,
        nextCursor: rows.length > q.limit && last ? encode(last.occurredAt, last.id) : null,
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
