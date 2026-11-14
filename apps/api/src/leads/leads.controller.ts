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
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import { poolSecrets } from '../auth/sealed.js';
import { PortalInfoModule } from '../client-auth/portal-info.controller.js';
import type { ClientsActor } from '../clients/clients.service.js';
import { type AuthContext, legacyFirmRole, type TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { CommunicationsModule } from '../communications/communications.module.js';
import { DOCUMENTS_CONFIG, loadDocumentsConfig, type DocumentsConfig } from '../storage/config.js';
import {
  createS3Client,
  DOCUMENT_STORAGE,
  S3DocumentStorage,
} from '../storage/document-storage.js';
import { LeadConvertService } from './lead-convert.service.js';
import { LeadFilesService, LeadFileTokens } from './lead-files.service.js';
import { LeadMergeService } from './lead-merge.service.js';
import {
  LeadEmailImagesController,
  MessageSignatureController,
  PortalEmailImagesController,
} from './lead-email.controller.js';
import { EmailImageTokens, LeadEmailService } from './lead-email.service.js';
import { LeadMessagesService } from './lead-messages.service.js';
import { LeadPipelineController } from './lead-pipeline.controller.js';
import { LeadFollowUpsController, LeadFollowUpsService } from './lead-follow-ups.js';
import { LeadPipelineTabsController } from './lead-pipeline-tabs.controller.js';
import { LeadPipelineTabsService } from './lead-pipeline-tabs.service.js';
import { LeadPipelineService } from './lead-pipeline.service.js';
import { LeadPipelineWriteService } from './lead-pipeline-write.service.js';
import { LeadsService } from './leads.service.js';

const idPipe = new ZodValidationPipe(LeadId);

function actorOf(auth: AuthContext, tenant: TenantContext): ClientsActor {
  if (tenant.kind !== 'staff') throw new Error('firm routes are for firm members');
  return { userId: auth.userId, role: legacyFirmRole(tenant.role) };
}

/** The firm's Begin Online leads (R11 step 4): Owner, Admin and Staff. */
@Controller('business/leads')
@Access('LEADS')
@Roles(...FIRM_STAFF)
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly converts: LeadConvertService,
  ) {}

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
    return this.converts.convert(tenant.businessId, actorOf(auth, tenant), id, body);
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
    return this.converts.downloadUpload(tenant.businessId, id, uploadId);
  }
}

@Module({
  imports: [PortalInfoModule, CommunicationsModule],
  // The pipeline and email controllers first: their static paths must match before
  // LeadsController's `:id`.
  controllers: [
    LeadEmailImagesController,
    MessageSignatureController,
    PortalEmailImagesController,
    LeadPipelineController,
    LeadPipelineTabsController,
    LeadFollowUpsController,
    LeadsController,
  ],
  providers: [
    LeadEmailService,
    {
      provide: EmailImageTokens,
      inject: [ENV],
      useFactory: (env: Env) => new EmailImageTokens(poolSecrets(env)),
    },
    LeadsService,
    LeadConvertService,
    LeadPipelineService,
    LeadPipelineTabsService,
    LeadFollowUpsService,
    LeadPipelineWriteService,
    LeadMessagesService,
    LeadFilesService,
    LeadMergeService,
    {
      provide: LeadFileTokens,
      inject: [ENV],
      useFactory: (env: Env) => new LeadFileTokens(poolSecrets(env)),
    },
    { provide: DOCUMENTS_CONFIG, useFactory: () => loadDocumentsConfig() },
    // R5's documents bucket, made the way storage/documents.controller.ts makes it.
    {
      provide: DOCUMENT_STORAGE,
      useFactory: () => {
        const config: DocumentsConfig = loadDocumentsConfig();
        return new S3DocumentStorage(createS3Client(config), config.bucket);
      },
    },
  ],
  // Automations' Schedule lead follow-up (R55, the lead's one-off exception): Leads' own
  // follow-up, with every Leads rule.
  exports: [LeadFollowUpsService],
})
export class LeadsModule {}
