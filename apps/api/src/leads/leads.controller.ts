import { Body, Controller, Get, HttpCode, Module, Param, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  ConvertLeadRequest,
  type ConvertLeadResponse,
  DeclineLeadRequest,
  type DownloadLink,
  type LeadCounts,
  type LeadDetail,
  LeadId,
  type LeadList,
  ListLeadsQuery,
} from '@firmivra/types';
import { CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { ClientsActor } from '../clients/clients.service.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { loadDocumentsConfig, type DocumentsConfig } from '../storage/config.js';
import {
  createS3Client,
  DOCUMENT_STORAGE,
  S3DocumentStorage,
} from '../storage/document-storage.js';
import { LeadsService } from './leads.service.js';

const idPipe = new ZodValidationPipe(LeadId);

function actorOf(auth: AuthContext, tenant: TenantContext): ClientsActor {
  if (tenant.kind !== 'staff') throw new Error('firm routes are for firm members');
  return { userId: auth.userId, role: tenant.role };
}

/** The firm's Begin Online leads (R11 step 4): Owner, Admin and Staff. */
@Controller('business/leads')
@Roles(...FIRM_STAFF)
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(ListLeadsQuery)) q: z.output<typeof ListLeadsQuery>,
  ): Promise<LeadList> {
    return this.leads.list(tenant.businessId, q);
  }

  @Get('count')
  counts(@CurrentTenant() tenant: TenantContext): Promise<LeadCounts> {
    return this.leads.counts(tenant.businessId);
  }

  @Get(':id')
  get(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<LeadDetail> {
    return this.leads.get(tenant.businessId, id);
  }

  @Post(':id/review')
  @HttpCode(200)
  startReview(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<LeadDetail> {
    return this.leads.startReview(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post(':id/convert')
  @HttpCode(200)
  convert(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ConvertLeadRequest)) body: z.output<typeof ConvertLeadRequest>,
  ): Promise<ConvertLeadResponse> {
    return this.leads.convert(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post(':id/decline')
  @HttpCode(200)
  decline(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(DeclineLeadRequest)) body: z.output<typeof DeclineLeadRequest>,
  ): Promise<LeadDetail> {
    return this.leads.decline(tenant.businessId, actorOf(auth, tenant), id, body.reason);
  }

  @Get(':id/uploads/:uploadId/download')
  download(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('uploadId', idPipe) uploadId: string,
  ): Promise<DownloadLink> {
    return this.leads.downloadUpload(tenant.businessId, id, uploadId);
  }
}

@Module({
  controllers: [LeadsController],
  providers: [
    LeadsService,
    // R5's documents bucket, made the way storage/documents.controller.ts makes it.
    {
      provide: DOCUMENT_STORAGE,
      useFactory: () => {
        const config: DocumentsConfig = loadDocumentsConfig();
        return new S3DocumentStorage(createS3Client(config), config.bucket);
      },
    },
  ],
})
export class LeadsModule {}
