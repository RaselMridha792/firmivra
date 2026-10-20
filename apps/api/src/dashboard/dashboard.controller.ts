import { Controller, Get, Module, Query } from '@nestjs/common';
import { type DashboardSummary, DashboardSummaryQuery } from '@firmivra/types';
import type { z } from 'zod';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
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

  /** ?pipelinePeriod and ?revenueYear: the design's This Month and This Year selectors. */
  @Get('summary')
  summary(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(DashboardSummaryQuery))
    query: z.output<typeof DashboardSummaryQuery>,
  ): Promise<DashboardSummary> {
    return this.dashboard.summary(tenant.businessId, actorOf(auth, tenant), query);
  }
}

@Module({
  imports: [WorkspacesModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
