import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import type {
  StaffDocument,
  StaffDocumentLink,
  StaffDocumentList,
  StaffImportPreview,
  StaffImportResult,
  UploadTicket,
} from '@firmivra/types';
import type { z } from 'zod';
import { Access, CurrentAuth, CurrentTenant, FIRM_MANAGERS, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  ConfirmStaffDocumentUploadBody,
  CreateStaffDocumentUploadBody,
  StaffDocumentIdParam,
  StaffIdParam,
  StaffImportBody,
  StaffImportPreviewBody,
  UpdateStaffDocumentBody,
} from './staff-input.js';
import { StaffDocumentsService } from './staff-documents.service.js';
import { StaffImportService } from './staff-import.service.js';
import { staffActorOf } from './staff.common.js';

type Out<S extends z.ZodType> = z.output<S>;
const idPipe = new ZodValidationPipe(StaffIdParam);
const docPipe = new ZodValidationPipe(StaffDocumentIdParam);

/**
 * Staff documents (the three-step upload, View / Download, Reclassify, Archive) and Bulk Upload
 * Staff (preview, import), R55. Owner and Admin only; documents are walled off in the database.
 * The static import routes come before any ':id' route of this path.
 */
@Controller('business/staff')
@Access('STAFF_MANAGEMENT', 'EDIT')
@Roles(...FIRM_MANAGERS)
export class StaffDocumentsController {
  constructor(
    private readonly documents: StaffDocumentsService,
    private readonly imports: StaffImportService,
  ) {}

  @Post('import/preview')
  @HttpCode(200)
  @Access('STAFF_MANAGEMENT', 'CREATE')
  previewImport(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(StaffImportPreviewBody)) body: Out<typeof StaffImportPreviewBody>,
  ): Promise<StaffImportPreview> {
    return this.imports.preview(staffActorOf(auth, tenant), body);
  }

  @Post('import')
  @HttpCode(200)
  @Access('STAFF_MANAGEMENT', 'CREATE')
  import(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(StaffImportBody)) body: Out<typeof StaffImportBody>,
  ): Promise<StaffImportResult> {
    return this.imports.import(tenant, staffActorOf(auth, tenant), body);
  }

  @Get(':id/documents')
  @Access('STAFF_MANAGEMENT', 'VIEW')
  async list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<StaffDocumentList> {
    return { items: await this.documents.list(staffActorOf(auth, tenant), id) };
  }

  @Post(':id/documents/uploads')
  ticket(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(CreateStaffDocumentUploadBody))
    body: Out<typeof CreateStaffDocumentUploadBody>,
  ): Promise<UploadTicket> {
    return this.documents.ticket(staffActorOf(auth, tenant), id, body);
  }

  @Post(':id/documents/uploads/confirm')
  confirm(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ConfirmStaffDocumentUploadBody))
    body: Out<typeof ConfirmStaffDocumentUploadBody>,
  ): Promise<StaffDocument> {
    return this.documents.confirm(staffActorOf(auth, tenant), id, body.uploadToken);
  }

  @Get(':id/documents/:docId/download')
  @Access('STAFF_MANAGEMENT', 'VIEW')
  download(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('docId', docPipe) docId: string,
  ): Promise<StaffDocumentLink> {
    return this.documents.download(staffActorOf(auth, tenant), id, docId);
  }

  @Patch(':id/documents/:docId')
  reclassify(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('docId', docPipe) docId: string,
    @Body(new ZodValidationPipe(UpdateStaffDocumentBody)) body: Out<typeof UpdateStaffDocumentBody>,
  ): Promise<StaffDocument> {
    return this.documents.reclassify(staffActorOf(auth, tenant), id, docId, body);
  }

  @Post(':id/documents/:docId/archive')
  @HttpCode(200)
  archive(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('docId', docPipe) docId: string,
  ): Promise<StaffDocument> {
    return this.documents.archive(staffActorOf(auth, tenant), id, docId);
  }
}
