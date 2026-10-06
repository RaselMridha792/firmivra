import { Controller, Get, Param, Query, Module } from '@nestjs/common';
import { z } from 'zod';
import { ListFirmAuditLogsQuery, ListSupportAuditLogsQuery } from '@firmivra/types';
import { Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AuditViewerService } from './audit-viewer.service.js';
import { ApprovedSupportAccess, PendingSupportAccess } from './support.ports.js';
@Controller('business/audit-logs')
@Roles('OWNER')
export class FirmAuditViewerController {
  constructor(private readonly viewer: AuditViewerService) {}
  @Get() list(
    @Query(new ZodValidationPipe(ListFirmAuditLogsQuery))
    query: z.output<typeof ListFirmAuditLogsQuery>,
  ) {
    return this.viewer.own(query);
  }
}
@Controller('admin/support/businesses/:businessId/audit-logs')
@Roles('SUPER_ADMIN')
export class SupportAuditViewerController {
  constructor(private readonly viewer: AuditViewerService) {}
  @Get() list(
    @Param('businessId', new ZodValidationPipe(z.uuid())) id: string,
    @Query(new ZodValidationPipe(ListSupportAuditLogsQuery))
    query: z.output<typeof ListSupportAuditLogsQuery>,
  ) {
    return this.viewer.supported(id, query);
  }
}
@Module({
  controllers: [FirmAuditViewerController, SupportAuditViewerController],
  providers: [
    AuditViewerService,
    { provide: ApprovedSupportAccess, useClass: PendingSupportAccess },
  ],
})
export class AuditViewerModule {}
