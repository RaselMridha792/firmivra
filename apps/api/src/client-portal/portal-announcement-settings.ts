import { Body, Controller, Get, Inject, Injectable, Put } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { type PortalAnnouncementSettings, UpdatePortalAnnouncementSettings } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { CurrentAuth, CurrentTenant, FIRM_MANAGERS, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DATABASE } from '../database/database.module.js';
import {
  ANNOUNCEMENT_COLUMNS,
  announcementSettingsIn,
  announcementView,
} from './announcement-policy.js';

// Settings > Client Portal > Announcements (Client Portal guide 3; Review One CP-3c, CP-3d, CP-3i):
// the firm's switches and channel policy on client_portal_settings (migration
// r1_portal_review1). Announcements themselves are made in Communications. No row means the
// table's defaults: on, on the dashboard, both channels the client's choice.

export { announcementSettingsIn } from './announcement-policy.js';

@Injectable()
export class PortalAnnouncementSettingsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  get(businessId: string): Promise<PortalAnnouncementSettings> {
    return this.db.withScope({ kind: 'business', businessId }, (tx) =>
      announcementSettingsIn(tx, businessId),
    );
  }

  /** Saves the fields sent; audited with each changed setting's old and new value. */
  async update(
    businessId: string,
    actorUserId: string,
    body: z.output<typeof UpdatePortalAnnouncementSettings>,
  ): Promise<PortalAnnouncementSettings> {
    return this.db.withScope({ kind: 'business', businessId }, async (tx) => {
      const before = await announcementSettingsIn(tx, businessId);
      const data = {
        ...(body.enabled !== undefined ? { announcementsEnabled: body.enabled } : {}),
        ...(body.onDashboard !== undefined ? { announcementsOnDashboard: body.onDashboard } : {}),
        ...(body.emailPolicy !== undefined ? { announcementEmailPolicy: body.emailPolicy } : {}),
        ...(body.smsPolicy !== undefined ? { announcementSmsPolicy: body.smsPolicy } : {}),
        updatedByUserId: actorUserId,
      };
      const row = await tx.clientPortalSettings.upsert({
        where: { businessId },
        create: { businessId, ...data },
        update: data,
        select: ANNOUNCEMENT_COLUMNS,
      });
      const after = announcementView(row);
      const changes = (['enabled', 'onDashboard', 'emailPolicy', 'smsPolicy'] as const).filter(
        (k) => before[k] !== after[k],
      );
      if (changes.length > 0) {
        await this.audit.logIn(
          tx,
          'client_portal.announcements_updated',
          { type: 'business', id: businessId },
          {
            fields: changes,
            changes: Object.fromEntries(changes.map((k) => [k, { from: before[k], to: after[k] }])),
          },
          { businessId },
        );
      }
      return after;
    });
  }
}

/** Settings > Client Portal > Announcements: Owner and Admin. */
@Controller('business/settings/portal-announcements')
@Roles(...FIRM_MANAGERS)
export class PortalAnnouncementSettingsController {
  constructor(private readonly settings: PortalAnnouncementSettingsService) {}

  @Get()
  get(@CurrentTenant() tenant: TenantContext): Promise<PortalAnnouncementSettings> {
    return this.settings.get(tenant.businessId);
  }

  @Put()
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(UpdatePortalAnnouncementSettings))
    body: z.output<typeof UpdatePortalAnnouncementSettings>,
  ): Promise<PortalAnnouncementSettings> {
    return this.settings.update(tenant.businessId, auth.userId, body);
  }
}
