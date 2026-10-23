import { Controller, Get } from '@nestjs/common';
import type { SettingsOverview } from '@firmivra/types';
import { CurrentTenant, FIRM_MANAGERS, Roles } from '../auth/decorators.js';
import type { TenantContext } from '../common/request-context.js';
import { SettingsOverviewService } from './settings-overview.service.js';

/** Settings > Overview (R42 contract, `api.settingsOverview`): Owner and Admin. */
@Controller('business/settings')
@Roles(...FIRM_MANAGERS)
export class SettingsOverviewController {
  constructor(private readonly overview: SettingsOverviewService) {}

  @Get('overview')
  get(@CurrentTenant() tenant: TenantContext): Promise<SettingsOverview> {
    return this.overview.overview(tenant.businessId);
  }
}
