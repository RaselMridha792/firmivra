import { Controller, Get, Param } from '@nestjs/common';
import { AdvisoryPlanId, type MyAdvisory, type MyAdvisoryPlan } from '@firmivra/types';
import { portalLogin } from '../appointments/request-actors.js';
import { CurrentAuth, CurrentTenant, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MyAdvisoryService } from './my-advisory.service.js';

/** The signed-in login: the firm from the slug, the client from the session (never the URL). */
const caller = (auth: AuthContext, tenant: TenantContext) => {
  const me = portalLogin(tenant);
  return { businessId: me.businessId, clientAccountId: me.clientAccountId, userId: auth.userId };
};

/**
 * BA-CP (Client Portal Review One): the signed-in client's Business Advisory, under My Services.
 * What the firm marked for the client only; another client's or firm's plan is 404.
 */
@Controller('portal/:firmSlug/me/advisory')
@Roles('CLIENT')
export class MyAdvisoryController {
  constructor(private readonly mine: MyAdvisoryService) {}

  @Get()
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<MyAdvisory> {
    return this.mine.get(caller(auth, tenant));
  }

  @Get('plans/:id')
  plan(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(AdvisoryPlanId)) id: string,
  ): Promise<MyAdvisoryPlan> {
    return this.mine.plan(caller(auth, tenant), id);
  }
}
