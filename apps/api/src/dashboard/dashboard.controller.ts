import { Controller, Get, Module } from '@nestjs/common';
import type { DashboardSummary } from '@firmivra/types';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { actorOf } from '../workspaces/common.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { DashboardService } from './dashboard.service.js';

/**
 * The firm dashboard's numbers (R30; contract in packages/types/src/dashboard): Owner, Admin and
 * Staff. The firm comes from TenantGuard; Staff get the numbers of their assigned clients.
 */
@Controller('business/dashboard')
@Access('DASHBOARD')
@Roles(...FIRM_STAFF)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  summary(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<DashboardSummary> {
    return this.dashboard.summary(tenant.businessId, actorOf(auth, tenant));
  }
}

@Module({
  imports: [WorkspacesModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
