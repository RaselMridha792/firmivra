import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import type { Database } from '@firmivra/db';
import {
  type AnnouncementOpened,
  AnnouncementPlace,
  CommunicationId,
  type MyAnnouncement,
  type MyAnnouncementList,
} from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { CurrentTenant, Roles } from '../auth/decorators.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { NotifyConfig } from '../notify/config.js';
import { firmImages } from '../notify/email-html.js';
import { NOTIFY_CONFIG } from '../notify/notify.module.js';
import { mergeValues } from '../communications/merge-values.js';
import { sanitizeForPortal, toPlainText } from '../templates/html.js';
import { fill } from '../templates/merge-fields.js';

// Client Portal guide 3 (Rasel, Oct 24: the parts without schema): announcements are made and
// published in Communications; the portal shows the ones published to the client, inside their
// window and not expired (Expire archives one). The firm's switch for announcements and their
// notification channels need schema (R0). CM-F08 (R60, a one-off exception to owned paths the lead
// gave on Nov 7): the announcement's own page shows its formatting (`html`, cleaned for the
// portal: images only from this firm's email-images address); snippets keep the plain `body`.
// C25 (Communications Review 2): the merge fields are filled for the signed-in client, as an
// email or text of the same campaign is filled for its recipient; one with no value stays as
// written (the send's review warned of it).

const LIMIT = 50;

@Injectable()
export class PortalAnnouncementsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(NOTIFY_CONFIG) private readonly notify: NotifyConfig,
    private readonly audit: AuditService,
  ) {}

  /**
   * C26 (Communications Review 2): the signed-in client opened one of their live announcements.
   * Their recipient row counts the open (the first one is kept) and Results gets an OPENED
   * event, as an email's open does. 404 for one that isn't theirs, live, or an announcement.
   */
  async opened(businessId: string, clientAccountId: string, id: string): Promise<void> {
    const scope = this.db.forBusiness(businessId);
    const account = await scope.clientAccount.findFirst({
      where: { businessId, id: clientAccountId },
      select: { clientId: true },
    });
    if (!account?.clientId)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
    const now = new Date();
    const recipient = await scope.communicationRecipient.findFirst({
      where: {
        businessId,
        communicationId: id,
        clientId: account.clientId,
        status: { not: 'NOT_SENT' },
        communication: {
          channel: 'ANNOUNCEMENT',
          status: 'SENT',
          archivedAt: null,
          AND: [
            { OR: [{ publishStartsAt: null }, { publishStartsAt: { lte: now } }] },
            { OR: [{ publishEndsAt: null }, { publishEndsAt: { gt: now } }] },
          ],
        },
      },
      select: { id: true, status: true, firstOpenedAt: true },
    });
    if (!recipient) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
    // The open and its event together.
    await this.db.withScope({ kind: 'business', businessId }, async (tx) => {
      await tx.communicationRecipient.update({
        where: { id: recipient.id },
        data: {
          openCount: { increment: 1 },
          ...(recipient.firstOpenedAt ? {} : { firstOpenedAt: now }),
          // Delivered becomes Opened; a later state (clicked, unsubscribed) stays.
          ...(['SENT', 'DELIVERED'].includes(recipient.status)
            ? { status: 'OPENED' as const }
            : {}),
        },
      });
      await tx.communicationEvent.create({
        data: {
          businessId,
          communicationId: id,
          recipientId: recipient.id,
          type: 'OPENED',
          occurredAt: now,
        },
      });
    });
    await this.audit.log(
      'communication.announcement_opened',
      { type: 'communication', id },
      { clientAccountId },
    );
  }

  /** The signed-in client's live announcements, newest first. Their client record, never the URL. */
  async mine(businessId: string, clientAccountId: string): Promise<MyAnnouncementList> {
    const scope = this.db.forBusiness(businessId);
    const account = await scope.clientAccount.findFirst({
      where: { businessId, id: clientAccountId },
      select: {
        clientId: true,
        client: { select: { displayName: true, email: true, phone: true } },
      },
    });
    if (!account?.clientId) return { items: [] };
    const now = new Date();
    const rows = await scope.communication.findMany({
      where: {
        businessId,
        channel: 'ANNOUNCEMENT',
        status: 'SENT',
        archivedAt: null,
        AND: [
          { OR: [{ publishStartsAt: null }, { publishStartsAt: { lte: now } }] },
          { OR: [{ publishEndsAt: null }, { publishEndsAt: { gt: now } }] },
        ],
        // Published to this client: left-out recipients (NOT_SENT) never see it.
        recipients: { some: { clientId: account.clientId, status: { not: 'NOT_SENT' } } },
      },
      orderBy: [{ publishStartsAt: 'desc' }, { id: 'desc' }],
      take: LIMIT,
      select: {
        id: true,
        subject: true,
        body: true,
        visibility: true,
        publishStartsAt: true,
        publishEndsAt: true,
        sentAt: true,
        createdAt: true,
      },
    });
    // Images only from this firm's own email-images address on the portal's host.
    const [firm, custom] = rows.length
      ? await Promise.all([
          scope.business.findUnique({
            where: { id: businessId },
            select: { slug: true, name: true },
          }),
          scope.customMergeField.findMany({
            where: { businessId },
            select: { label: true, fallback: true },
          }),
        ])
      : [null, []];
    const origin = this.notify.portalOrigin;
    const images = origin && firm ? firmImages(origin, firm.slug) : () => false;
    const c = account.client;
    const values = mergeValues(
      c ? { name: c.displayName, email: c.email, phone: c.phone } : null,
      firm?.name ?? '',
      custom,
    );
    return {
      items: rows.map((r): MyAnnouncement => {
        const html = fill(r.body, values, 'html').text;
        return {
          id: r.id,
          title: r.subject ? fill(r.subject, values, 'text').text.trim() || null : null,
          body: toPlainText(html),
          html: sanitizeForPortal(html, images),
          where: AnnouncementPlace.safeParse(r.visibility).data ?? 'dashboard',
          publishedAt: (r.publishStartsAt ?? r.sentAt ?? r.createdAt).toISOString(),
          endsAt: r.publishEndsAt?.toISOString() ?? null,
        };
      }),
    };
  }
}

@Controller('portal/:firmSlug/me/announcements')
@Roles('CLIENT')
export class MyAnnouncementsController {
  constructor(private readonly announcements: PortalAnnouncementsService) {}

  @Get()
  mine(@CurrentTenant() tenant: TenantContext): Promise<MyAnnouncementList> {
    if (tenant.kind !== 'client') throw new Error('portal routes are for client logins');
    return this.announcements.mine(tenant.businessId, tenant.clientAccountId);
  }

  /** C26: the client opened this announcement (its page); counted in its Results. */
  @Post(':id/opened')
  @HttpCode(200)
  async opened(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(CommunicationId)) id: string,
  ): Promise<AnnouncementOpened> {
    if (tenant.kind !== 'client') throw new Error('portal routes are for client logins');
    await this.announcements.opened(tenant.businessId, tenant.clientAccountId, id);
    return { ok: true };
  }
}

@Module({
  controllers: [MyAnnouncementsController],
  providers: [PortalAnnouncementsService],
})
export class PortalAnnouncementsModule {}
