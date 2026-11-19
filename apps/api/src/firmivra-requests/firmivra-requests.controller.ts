import { Body, Controller, Get, HttpCode, Module, Param, Post } from '@nestjs/common';
import {
  CreateFirmivraRequestUploadRequest,
  type FirmivraRequestFileLink,
  FirmivraRequestId,
  type FirmivraRequestList,
  type FirmivraRequestThread,
  ReplyFirmivraRequestRequest,
  type UploadTicket,
} from '@firmivra/types';
import type { z } from 'zod';
import { AdminSupportModule } from '../admin-support/admin-support.module.js';
import { CurrentAuth, CurrentTenant, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { FirmivraRequestsService } from './firmivra-requests.service.js';

/**
 * Settings > Requests from Firmivra (SA-FRM-F06): the firm's Owner only (the request goes to the
 * Owner, as Firmivra's Request Information names them). The firm comes from the tenant context;
 * a ticket id that is not one of this firm's requests is 404.
 */
@Controller('business/firmivra-requests')
@Roles('OWNER')
export class FirmivraRequestsController {
  constructor(private readonly requests: FirmivraRequestsService) {}

  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<FirmivraRequestList> {
    return this.requests.list(tenant.businessId, auth.userId);
  }

  @Get(':id')
  get(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ZodValidationPipe(FirmivraRequestId)) id: string,
  ): Promise<FirmivraRequestThread> {
    return this.requests.thread(tenant.businessId, auth.userId, id);
  }

  @Post(':id/uploads')
  @HttpCode(200)
  upload(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ZodValidationPipe(FirmivraRequestId)) id: string,
    @Body(new ZodValidationPipe(CreateFirmivraRequestUploadRequest))
    body: z.output<typeof CreateFirmivraRequestUploadRequest>,
  ): Promise<UploadTicket> {
    return this.requests.upload(tenant.businessId, auth.userId, id, body);
  }

  @Post(':id/replies')
  @HttpCode(200)
  reply(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ZodValidationPipe(FirmivraRequestId)) id: string,
    @Body(new ZodValidationPipe(ReplyFirmivraRequestRequest))
    body: z.output<typeof ReplyFirmivraRequestRequest>,
  ): Promise<FirmivraRequestThread> {
    return this.requests.reply(tenant.businessId, auth.userId, id, body);
  }

  @Get(':id/files/:fileId')
  file(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ZodValidationPipe(FirmivraRequestId)) id: string,
    @Param('fileId', new ZodValidationPipe(FirmivraRequestId)) fileId: string,
  ): Promise<FirmivraRequestFileLink> {
    return this.requests.fileLink(tenant.businessId, auth.userId, id, fileId);
  }
}

@Module({
  // Support's files service: the answer's files share Support's upload, check and scan.
  imports: [AdminSupportModule],
  controllers: [FirmivraRequestsController],
  providers: [FirmivraRequestsService],
})
export class FirmivraRequestsModule {}
