import { Body, Controller, Get, HttpCode, Module, Param, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  ClientId,
  ConfirmUploadRequest,
  CreateFirmUploadRequest,
  type DocumentCategoryList,
  DocumentId,
  type DownloadLink,
  type FirmDocument,
  type FirmDocumentList,
  ListFirmDocumentsQuery,
  type UploadTicket,
} from '@firmivra/types';
import { CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import { poolSecrets } from '../auth/sealed.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig, loadDocumentsConfig } from './config.js';
import type { FirmActor } from './document-records.js';
import { createS3Client, DOCUMENT_STORAGE, S3DocumentStorage } from './document-storage.js';
import { FirmDocumentsService } from './firm-documents.service.js';
import { UploadTokens } from './upload-token.js';
import { UploadsService } from './uploads.service.js';

const clientPipe = new ZodValidationPipe(ClientId);
const docPipe = new ZodValidationPipe(DocumentId);

/** The signed-in member as the documents services need them. Firm roles only (see @Roles). */
function actorOf(auth: AuthContext, tenant: TenantContext): FirmActor {
  if (tenant.kind !== 'staff') throw new Error('documents routes are for firm members');
  return { userId: auth.userId, role: tenant.role };
}

/**
 * A client's documents for the firm (R5; contract in packages/types/src/documents): Owner, Admin
 * and Staff (Staff: only clients assigned to them). Upload in three calls (ticket, PUT to storage,
 * confirm); downloads only for CLEAN files. The firm comes from TenantGuard.
 */
@Controller('business')
@Roles(...FIRM_STAFF)
export class DocumentsController {
  constructor(private readonly documents: FirmDocumentsService) {}

  @Get('clients/:clientId/documents')
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('clientId', clientPipe) clientId: string,
    @Query(new ZodValidationPipe(ListFirmDocumentsQuery))
    query: z.output<typeof ListFirmDocumentsQuery>,
  ): Promise<FirmDocumentList> {
    return this.documents.list(tenant.businessId, actorOf(auth, tenant), clientId, query);
  }

  @Post('clients/:clientId/documents/uploads')
  @HttpCode(200)
  createUpload(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('clientId', clientPipe) clientId: string,
    @Body(new ZodValidationPipe(CreateFirmUploadRequest))
    body: z.output<typeof CreateFirmUploadRequest>,
  ): Promise<UploadTicket> {
    return this.documents.createUpload(tenant.businessId, actorOf(auth, tenant), clientId, body);
  }

  @Post('documents/uploads/confirm')
  @HttpCode(200)
  confirmUpload(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(ConfirmUploadRequest)) body: z.output<typeof ConfirmUploadRequest>,
  ): Promise<FirmDocument> {
    const actor = actorOf(auth, tenant);
    return this.documents.confirmUpload(tenant.businessId, actor, body.uploadToken);
  }

  @Get('documents/:id')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', docPipe) id: string,
  ): Promise<FirmDocument> {
    return this.documents.get(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Get('documents/:id/download')
  download(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', docPipe) id: string,
  ): Promise<DownloadLink> {
    return this.documents.download(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Get('document-categories')
  async categories(@CurrentTenant() tenant: TenantContext): Promise<DocumentCategoryList> {
    return { items: await this.documents.categories(tenant.businessId) };
  }
}

@Module({
  controllers: [DocumentsController],
  providers: [
    // Settings are checked when the app starts, so a bad SCAN_MODE never reaches a request.
    { provide: DOCUMENTS_CONFIG, useFactory: () => loadDocumentsConfig() },
    {
      provide: DOCUMENT_STORAGE,
      inject: [DOCUMENTS_CONFIG],
      useFactory: (config: DocumentsConfig) =>
        new S3DocumentStorage(createS3Client(config), config.bucket),
    },
    {
      provide: UploadTokens,
      inject: [ENV],
      useFactory: (env: Env) => new UploadTokens(poolSecrets(env)),
    },
    UploadsService,
    FirmDocumentsService,
  ],
  // Portal intake uploads (R11) use the same tickets, confirm and bucket.
  exports: [UploadsService, DOCUMENT_STORAGE],
})
export class DocumentsModule {}
