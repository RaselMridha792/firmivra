import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  CreateDashboardCardRequest,
  DashboardCardId,
  type DashboardCardPreview,
  type DashboardCardSettings,
  type DashboardCardTemplate,
  type DashboardSummary,
  DashboardSummaryQuery,
  OrderDashboardCardsRequest,
  PreviewDashboardCardRequest,
  UpdateDashboardCardRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import {
  Access,
  CurrentAuth,
  CurrentTenant,
  FIRM_MANAGERS,
  FIRM_STAFF,
  Roles,
} from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { actorOf } from '../workspaces/common.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { DashboardCardsService } from './dashboard-cards.service.js';
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

  /** The global period, the Client Pipeline's and Revenue Overview's (C1, C2), each with Custom days. */
  @Get('summary')
  summary(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(DashboardSummaryQuery))
    query: z.output<typeof DashboardSummaryQuery>,
  ): Promise<DashboardSummary> {
    return this.dashboard.summary(tenant, actorOf(auth, tenant), query);
  }
}

const cardId = new ZodValidationPipe(DashboardCardId);

/**
 * D4, Settings > Dashboard Cards (contract in packages/types/src/dashboard/cards.ts): Owner and
 * Admin read and change the firm's service cards (Settings' Manage for a change). The firm comes
 * from TenantGuard. A card is switched off, never removed.
 */
@Controller('business/settings/dashboard-cards')
@Access('SETTINGS')
@Roles(...FIRM_MANAGERS)
export class DashboardCardsController {
  constructor(private readonly cards: DashboardCardsService) {}

  @Get()
  list(@CurrentTenant() tenant: TenantContext): Promise<DashboardCardSettings> {
    return this.cards.settings(tenant.businessId);
  }

  @Post()
  @Access('SETTINGS', 'MANAGE')
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateDashboardCardRequest))
    body: z.output<typeof CreateDashboardCardRequest>,
  ): Promise<DashboardCardTemplate> {
    return this.cards.create(tenant.businessId, auth.userId, body);
  }

  /** Live preview for This Month; saves nothing. */
  @Post('preview')
  @HttpCode(200)
  preview(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(PreviewDashboardCardRequest))
    body: z.output<typeof PreviewDashboardCardRequest>,
  ): Promise<DashboardCardPreview> {
    return this.cards.preview(tenant, actorOf(auth, tenant), body);
  }

  @Put('order')
  @Access('SETTINGS', 'MANAGE')
  order(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(OrderDashboardCardsRequest))
    body: z.output<typeof OrderDashboardCardsRequest>,
  ): Promise<DashboardCardSettings> {
    return this.cards.order(tenant.businessId, auth.userId, body);
  }

  @Patch(':id')
  @Access('SETTINGS', 'MANAGE')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', cardId) id: string,
    @Body(new ZodValidationPipe(UpdateDashboardCardRequest))
    body: z.output<typeof UpdateDashboardCardRequest>,
  ): Promise<DashboardCardTemplate> {
    return this.cards.update(tenant.businessId, auth.userId, id, body);
  }
}

@Module({
  imports: [WorkspacesModule],
  controllers: [DashboardController, DashboardCardsController],
  providers: [DashboardService, DashboardCardsService],
})
export class DashboardModule {}
