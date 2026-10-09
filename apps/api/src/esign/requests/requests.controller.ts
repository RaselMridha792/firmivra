import { Controller, Get, NotFoundException } from '@nestjs/common';
import type { EsignStatus } from '@firmivra/types';
import { CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../../auth/decorators.js';
import type { AuthContext, TenantContext } from '../../common/request-context.js';
import { type EsignActor, EsignRequestsService } from './requests.service.js';

/** The firm comes from TenantGuard; firm roles only (see @Roles). */
function actorOf(auth: AuthContext, tenant: TenantContext): EsignActor {
  if (tenant.kind !== 'staff') throw new NotFoundException({ code: 'NOT_FOUND' });
  return { userId: auth.userId, role: tenant.role };
}

/** GET /esign/status: never MODULE_OFF, so it has no @RequiresModule. */
@Controller('esign')
@Roles(...FIRM_STAFF)
export class EsignStatusController {
  constructor(private readonly requests: EsignRequestsService) {}

  @Get('status')
  status(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<EsignStatus> {
    return this.requests.status(tenant.businessId, actorOf(auth, tenant));
  }
}
