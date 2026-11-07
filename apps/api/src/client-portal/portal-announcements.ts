import { Controller, Get, Inject, Injectable, Module } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { AnnouncementPlace, type MyAnnouncement, type MyAnnouncementList } from '@firmivra/types';
import { CurrentTenant, Roles } from '../auth/decorators.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import type { NotifyConfig } from '../notify/config.js';
import { firmImages } from '../notify/email-html.js';
import { NOTIFY_CONFIG } from '../notify/notify.module.js';
import { sanitizeForPortal, toPlainText } from '../templates/html.js';

// Client Portal guide 3 (Rasel, Oct 24: the parts without schema): announcements are made and
// published in Communications; the portal shows the ones published to the client, inside their
// window and not expired (Expire archives one). The firm's switch for announcements and their
// notification channels need schema (R0). CM-F08 (R60, a one-off exception to owned paths the lead
// gave on Nov 7): the announcement's own page shows its formatting (`html`, cleaned for the
// portal: images only from this firm's email-images address); snippets keep the plain `body`.

const LIMIT = 50;

@Injectable()
export class PortalAnnouncementsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(NOTIFY_CONFIG) private readonly notify: NotifyConfig,
  ) {}

  /** The signed-in client's live announcements, newest first. Their client record, never the URL. */
  async mine(businessId: string, clientAccountId: string): Promise<MyAnnouncementList> {
    const scope = this.db.forBusiness(businessId);
    const account = await scope.clientAccount.findFirst({
      where: { businessId, id: clientAccountId },
      select: { clientId: true },
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
    const firm = rows.length
      ? await scope.business.findUnique({ where: { id: businessId }, select: { slug: true } })
      : null;
    const origin = this.notify.portalOrigin;
    const images = origin && firm ? firmImages(origin, firm.slug) : () => false;
    return {
      items: rows.map((r): MyAnnouncement => ({
        id: r.id,
        title: r.subject?.trim() || null,
        body: toPlainText(r.body),
        html: sanitizeForPortal(r.body, images),
        where: AnnouncementPlace.safeParse(r.visibility).data ?? 'dashboard',
        publishedAt: (r.publishStartsAt ?? r.sentAt ?? r.createdAt).toISOString(),
        endsAt: r.publishEndsAt?.toISOString() ?? null,
      })),
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
}

@Module({
  controllers: [MyAnnouncementsController],
  providers: [PortalAnnouncementsService],
})
export class PortalAnnouncementsModule {}
