import { Body, Controller, Get, HttpCode, Module, Param, Post, Query } from '@nestjs/common';
import {
  type AdminSupportAccess,
  type AdminSupportAccessList,
  AdminSupportAccessQuery,
  ApproveSupportAccessRequest,
  CreateSupportAccessRequest,
  type FirmSupportAccess,
  type FirmSupportAccessList,
  SupportAccessId,
  SupportAccessQuery,
} from '@firmivra/types';
import { z } from 'zod';
import { CurrentAuth, CurrentTenant, FIRM_MANAGERS, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SupportAccessService } from './support-access.service.js';
import { SupportScope } from './support-scope.js';

/** A uuid in the path, in one spelling: lock keys and comparisons need it (#108 review). */
const lower = (v: string) => v.toLowerCase();
const idPipe = new ZodValidationPipe(SupportAccessId.transform(lower));
const businessIdPipe = new ZodValidationPipe(z.uuid().transform(lower));
const adminQuery = AdminSupportAccessQuery.transform((q) => ({
  ...q,
  ...(q.businessId ? { businessId: q.businessId.toLowerCase() } : {}),
}));

/**
 * The firm's side, /api/v1/business/support-access (R8): Owner and Admin read; only an Owner
 * answers (the database also requires an active Owner to approve). The firm sees "Firmivra
 * Support" and the reason, never which Super Admin asked.
 */
@Controller('business/support-access')
@Roles(...FIRM_MANAGERS)
export class FirmSupportAccessController {
  constructor(private readonly support: SupportAccessService) {}

  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(SupportAccessQuery)) q: z.output<typeof SupportAccessQuery>,
  ): Promise<FirmSupportAccessList> {
    return this.support.firmList(tenant.businessId, q);
  }

  @Post(':id/approve')
  @Roles('OWNER')
  @HttpCode(200)
  approve(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ApproveSupportAccessRequest))
    body: z.output<typeof ApproveSupportAccessRequest>,
  ): Promise<FirmSupportAccess> {
    return this.support.decide(tenant.businessId, auth.userId, id, 'approve', body.hours);
  }

  @Post(':id/decline')
  @Roles('OWNER')
  @HttpCode(200)
  decline(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<FirmSupportAccess> {
    return this.support.decide(tenant.businessId, auth.userId, id, 'decline');
  }

  @Post(':id/revoke')
  @Roles('OWNER')
  @HttpCode(200)
  revoke(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<FirmSupportAccess> {
    return this.support.decide(tenant.businessId, auth.userId, id, 'revoke');
  }
}

/** The Super Admins' side (R8): ask a firm for access, and list the asks. */
@Controller('admin')
@Roles('SUPER_ADMIN')
export class AdminSupportAccessController {
  constructor(private readonly support: SupportAccessService) {}

  @Post('firms/:businessId/support-access')
  request(
    @CurrentAuth() auth: AuthContext,
    @Param('businessId', businessIdPipe) businessId: string,
    @Body(new ZodValidationPipe(CreateSupportAccessRequest))
    body: z.output<typeof CreateSupportAccessRequest>,
  ): Promise<AdminSupportAccess> {
    return this.support.request(auth.userId, businessId, body.reason);
  }

  @Get('support-access')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(adminQuery)) q: z.output<typeof adminQuery>,
  ): Promise<AdminSupportAccessList> {
    return this.support.adminList(auth.userId, q);
  }
}

@Module({
  controllers: [FirmSupportAccessController, AdminSupportAccessController],
  providers: [SupportAccessService, SupportScope],
  exports: [SupportAccessService, SupportScope],
})
export class SupportAccessModule {}
