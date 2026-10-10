import { Controller, Get, Module, Param, Query } from '@nestjs/common';
import { AuditLogQuery, type AuditLogPage } from '@firmivra/types';
import { z } from 'zod';
import { CurrentAuth, CurrentTenant, FIRM_MANAGERS, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SupportAccessModule } from '../support-access/support-access.controller.js';
import { SupportScope } from '../support-access/support-scope.js';
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
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(AuditLogQuery)) query: z.output<typeof AuditLogQuery>,
  ): Promise<AuditLogPage> {
    return this.viewer.list({ businessId: tenant.businessId, userId: auth.userId }, query);
  }
}

/**
 * GET /api/v1/admin/firms/{businessId}/audit-log: a Super Admin reads a firm's log only through
 * their own approved, unexpired support grant for that firm (R8), in the firm's read-only support
 * scope; the database logs each page as support.viewed in both logs. No grant: 403
 * SUPPORT_GRANT_REQUIRED, whether or not the firm exists, and nothing is read.
 */
@Controller('admin/firms/:businessId/audit-log')
@Roles('SUPER_ADMIN')
export class AdminAuditLogController {
  constructor(
    private readonly viewer: AuditLogViewerService,
    private readonly support: SupportScope,
  ) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Param('businessId', new ZodValidationPipe(z.uuid().transform((v) => v.toLowerCase())))
    businessId: string,
    @Query(new ZodValidationPipe(AuditLogQuery)) query: z.output<typeof AuditLogQuery>,
  ): Promise<AuditLogPage> {
    return this.viewer.list({ businessId, userId: auth.userId }, query, {
      read: (fn) => this.support.read(auth.userId, businessId, 'audit_log', fn),
    });
  }
}

@Module({
  controllers: [AuditLogController, AdminAuditLogController],
  imports: [SupportAccessModule],
  providers: [AuditLogViewerService],
})
export class AuditViewerModule {}
