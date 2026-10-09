import { Body, Controller, Get, HttpCode, Module, Param, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  ClientId,
  ConfirmUploadRequest,
  CreateDocumentRequestRequest,
  CreateFirmUploadRequest,
  type DocumentCategoryList,
  DocumentId,
  DocumentRequestId,
  type DownloadLink,
  type FirmDocument,
  type FirmDocumentList,
  type FirmDocumentRequest,
  type FirmDocumentRequestList,
  ListDocumentRequestsQuery,
  ListFirmDocumentsQuery,
  RejectDocumentRequestRequest,
  type UploadTicket,
} from '@firmivra/types';
import { CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import { poolSecrets } from '../auth/sealed.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { NotificationsModule } from '../notifications/notifications.controller.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig, loadDocumentsConfig } from './config.js';
import type { FirmActor } from './document-records.js';
import { DocumentRequestsService } from './document-requests.service.js';
import { DocumentScanHandler } from './document-scan-handler.js';
import { createS3Client, DOCUMENT_STORAGE, S3DocumentStorage } from './document-storage.js';
import { FirmDocumentsService } from './firm-documents.service.js';
import { MyDocumentsController } from './my-documents.controller.js';
import { MyDocumentsService } from './my-documents.service.js';
import { ScanResultsService } from './scan-results.service.js';
import { UploadTokens } from './upload-token.js';
import { UploadsService } from './uploads.service.js';

const clientPipe = new ZodValidationPipe(ClientId);
const docPipe = new ZodValidationPipe(DocumentId);
const requestPipe = new ZodValidationPipe(DocumentRequestId);

/** The signed-in member as the documents services need them. Firm roles only (see @Roles). */
function actorOf(auth: AuthContext, tenant: TenantContext): FirmActor {
  if (tenant.kind !== 'staff') throw new Error('documents routes are for firm members');
  return { userId: auth.userId, role: tenant.role };
}

/**
 * A client's documents and document requests for the firm (R5; contract in
 * packages/types/src/documents): Owner, Admin and Staff (Staff: only clients assigned to them).
 * Upload in three calls (ticket, PUT to storage, confirm); downloads only for CLEAN files. The
 * firm comes from TenantGuard.
 */
@Controller('business')
@Roles(...FIRM_STAFF)
export class DocumentsController {
  constructor(
    private readonly documents: FirmDocumentsService,
    private readonly requests: DocumentRequestsService,
  ) {}

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

  @Get('clients/:clientId/document-requests')
  async listRequests(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('clientId', clientPipe) clientId: string,
    @Query(new ZodValidationPipe(ListDocumentRequestsQuery))
    query: z.output<typeof ListDocumentRequestsQuery>,
  ): Promise<z.output<typeof FirmDocumentRequestList>> {
    const actor = actorOf(auth, tenant);
    return { items: await this.requests.list(tenant.businessId, actor, clientId, query) };
  }

  @Post('clients/:clientId/document-requests')
  @HttpCode(200)
  createRequest(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('clientId', clientPipe) clientId: string,
    @Body(new ZodValidationPipe(CreateDocumentRequestRequest))
    body: z.output<typeof CreateDocumentRequestRequest>,
  ): Promise<FirmDocumentRequest> {
    return this.requests.create(tenant.businessId, actorOf(auth, tenant), clientId, body);
  }

  @Post('document-requests/:id/accept')
  @HttpCode(200)
  acceptRequest(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', requestPipe) id: string,
  ): Promise<FirmDocumentRequest> {
    return this.requests.accept(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post('document-requests/:id/reject')
  @HttpCode(200)
  rejectRequest(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', requestPipe) id: string,
    @Body(new ZodValidationPipe(RejectDocumentRequestRequest))
    body: z.output<typeof RejectDocumentRequestRequest>,
  ): Promise<FirmDocumentRequest> {
    return this.requests.reject(tenant.businessId, actorOf(auth, tenant), id, body.reason);
  }

  @Post('document-requests/:id/cancel')
  @HttpCode(200)
  cancelRequest(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', requestPipe) id: string,
  ): Promise<FirmDocumentRequest> {
    return this.requests.cancel(tenant.businessId, actorOf(auth, tenant), id);
  }
}

@Module({
  // R6's Notifier: request and upload events reach the bell (and the email copy) once they commit.
  imports: [NotificationsModule],
  controllers: [DocumentsController, MyDocumentsController],
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
    MyDocumentsService,
    DocumentRequestsService,
    // GuardDuty's results for tenant/{id}/documents/ (storage/scan-queue routes them here).
    ScanResultsService,
    DocumentScanHandler,
  ],
  // Portal intake uploads (R11) use the same tickets, confirm and bucket.
  exports: [UploadsService, DOCUMENT_STORAGE, ScanResultsService],
})
export class DocumentsModule {}
