import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  ConfirmUploadRequest,
  CreateMyUploadRequest,
  DocumentId,
  DocumentRequestId,
  type DownloadLink,
  ListMyDocumentsQuery,
  type MyDocument,
  type MyDocumentCategoryList,
  type MyDocumentList,
  type MyDocumentRequest,
  type MyDocumentRequestList,
  NotAvailableRequest,
  type UploadTargets,
  type UploadTicket,
} from '@firmivra/types';
import { CurrentAuth, CurrentTenant, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { PortalCaller } from './document-records.js';
import { DocumentRequestsService } from './document-requests.service.js';
import { MyDocumentsService } from './my-documents.service.js';

const docPipe = new ZodValidationPipe(DocumentId);

/** The portal login from the session (TenantGuard's client account), never from the URL. */
function callerOf(auth: AuthContext, tenant: TenantContext): PortalCaller {
  if (tenant.kind !== 'client') throw new Error('portal routes are for client logins');
  return {
    businessId: tenant.businessId,
    userId: auth.userId,
    clientAccountId: tenant.clientAccountId,
  };
}

/**
 * The signed-in client's documents and document requests at one firm (portal My Documents, the
 * Upload Documents pop-up and Your Next Steps; R5, contract in packages/types/src/documents). The
 * firm comes from the slug and the client from the login; never INTERNAL files and never another
 * client's (404). Household rules (Rasel, q12) in the services.
 */
@Controller('portal/:firmSlug/me')
@Roles('CLIENT')
export class MyDocumentsController {
  constructor(
    private readonly documents: MyDocumentsService,
    private readonly requests: DocumentRequestsService,
  ) {}

  @Get('documents')
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(ListMyDocumentsQuery))
    query: z.output<typeof ListMyDocumentsQuery>,
  ): Promise<MyDocumentList> {
    return this.documents.list(callerOf(auth, tenant), query);
  }

  // Before documents/:id, which would take "upload-targets" as an id.
  @Get('documents/upload-targets')
  uploadTargets(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<UploadTargets> {
    return this.documents.uploadTargets(callerOf(auth, tenant));
  }

  @Get('documents/:id')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', docPipe) id: string,
  ): Promise<MyDocument> {
    return this.documents.get(callerOf(auth, tenant), id);
  }

  @Get('documents/:id/download')
  download(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', docPipe) id: string,
  ): Promise<DownloadLink> {
    return this.documents.download(callerOf(auth, tenant), id);
  }

  @Post('documents/uploads')
  @HttpCode(200)
  createUpload(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateMyUploadRequest))
    body: z.output<typeof CreateMyUploadRequest>,
  ): Promise<UploadTicket> {
    return this.documents.createUpload(callerOf(auth, tenant), body);
  }

  @Post('documents/uploads/confirm')
  @HttpCode(200)
  confirmUpload(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(ConfirmUploadRequest)) body: z.output<typeof ConfirmUploadRequest>,
  ): Promise<MyDocument> {
    return this.documents.confirmUpload(callerOf(auth, tenant), body.uploadToken);
  }

  @Get('document-categories')
  async categories(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<z.output<typeof MyDocumentCategoryList>> {
    return { items: await this.documents.categories(callerOf(auth, tenant)) };
  }

  @Get('document-requests')
  async myRequests(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<z.output<typeof MyDocumentRequestList>> {
    return { items: await this.requests.mine(callerOf(auth, tenant)) };
  }

  @Post('document-requests/:id/not-available')
  @HttpCode(200)
  notAvailable(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(DocumentRequestId)) id: string,
    @Body(new ZodValidationPipe(NotAvailableRequest)) body: z.output<typeof NotAvailableRequest>,
  ): Promise<MyDocumentRequest> {
    return this.requests.notAvailable(callerOf(auth, tenant), id, body.reason);
  }
}
