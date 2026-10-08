import { Controller, ForbiddenException, Get, Module, Query } from '@nestjs/common';
import { AuditLogQuery, type AuditLogPage } from '@firmivra/types';
import type { z } from 'zod';
import { CurrentTenant, FIRM_MANAGERS, Roles } from '../auth/decorators.js';
import type { TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AuditLogViewerService } from './audit-log.service.js';

/**
 * GET /api/v1/business/audit-log: the firm's audit log, newest first (R12 step 4). Owner and
 * Admin only (403 FORBIDDEN for Staff, by the roles matrix). The firm comes from TenantGuard.
 */
@Controller('business/audit-log')
@Roles(...FIRM_MANAGERS)
export class AuditLogController {
  constructor(private readonly viewer: AuditLogViewerService) {}

  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(AuditLogQuery)) query: z.output<typeof AuditLogQuery>,
  ): Promise<AuditLogPage> {
    return this.viewer.list(tenant.businessId, query);
  }
}

/**
 * GET /api/v1/admin/firms/{businessId}/audit-log: a Super Admin reads a firm's log only through
 * an approved support grant for that firm (R8). No grant check exists yet, so it always answers
 * 403 SUPPORT_GRANT_REQUIRED, before looking at the firm or the query, and reads nothing.
 */
@Controller('admin/firms/:businessId/audit-log')
@Roles('SUPER_ADMIN')
export class AdminAuditLogController {
  @Get()
  list(): never {
    throw new ForbiddenException({
      code: 'SUPPORT_GRANT_REQUIRED',
      message: 'Reading a firm’s audit log needs an approved support grant for that firm',
    });
  }
}

@Module({
  controllers: [AuditLogController, AdminAuditLogController],
  providers: [AuditLogViewerService],
})
export class AuditViewerModule {}
