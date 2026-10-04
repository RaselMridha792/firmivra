import { Controller, Get, Module } from '@nestjs/common';
import type { BusinessSummary } from '@firmivra/types';
import { CurrentTenant, Roles } from '../auth/decorators.js';
import type { TenantContext } from '../common/request-context.js';
import { TenantPrisma } from '../database/database.module.js';

const select = { id: true, slug: true, name: true, status: true } as const;

/**
 * The firm the request acts in. The smallest tenant-scoped endpoints, used by the web app and the
 * isolation e2e tests. Firm settings (Ibrahim, Sprint 1) build on this module.
 */
@Controller()
export class BusinessController {
  constructor(private readonly tenantPrisma: TenantPrisma) {}

  /** Staff: the firm from x-business-id, or their only firm. */
  @Get('business')
  @Roles('OWNER', 'ADMIN', 'STAFF')
  current(@CurrentTenant() tenant: TenantContext): Promise<BusinessSummary> {
    return this.tenantPrisma.db.business.findUniqueOrThrow({
      where: { id: tenant.businessId },
      select,
    });
  }

  /** Clients: the firm whose portal they are in. */
  @Get('portal/:slug/business')
  @Roles('CLIENT')
  portal(@CurrentTenant() tenant: TenantContext): Promise<BusinessSummary> {
    return this.tenantPrisma.db.business.findUniqueOrThrow({
      where: { id: tenant.businessId },
      select,
    });
  }
}

@Module({ controllers: [BusinessController] })
export class BusinessModule {}
