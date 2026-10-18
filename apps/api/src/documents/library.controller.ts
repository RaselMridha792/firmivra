import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type {
  BulkDocumentsResult,
  DocumentActivityList,
  DocumentCategory,
  DocumentFolder,
  DocumentFolderList,
  DocumentSettings,
  DocumentVersionList,
  DownloadLink,
  LibraryDocument,
  LibraryPage,
  LibrarySummary,
  OkResponse,
  UploadTicket,
} from '@firmivra/types';
import type { z } from 'zod';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DocumentFoldersService } from './folders.service.js';
import {
  BulkBody,
  CreateCategoryBody,
  CreateFolderBody,
  FolderIdParam,
  IdParam,
  LibraryQ,
  ReorderFoldersBody,
  ReviewBody,
  UpdateCategoryBody,
  UpdateDocumentBody,
  UpdateFolderBody,
  UpdateSettingsBody,
  UploadBody,
} from './library.input.js';
import { DocumentLibraryService } from './library.service.js';

type Out<S extends z.ZodType> = z.output<S>;
const idPipe = new ZodValidationPipe(IdParam);

/**
 * The firm-wide Documents library (R55, `api.documentLibrary`). Registered before R5's
 * DocumentsController so `summary` is never read as a document id. Static routes before ':id'.
 */
@Controller('business/documents')
@Access('DOCUMENTS')
@Roles(...FIRM_STAFF)
export class DocumentLibraryController {
  constructor(private readonly library: DocumentLibraryService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(LibraryQ)) q: Out<typeof LibraryQ>,
  ): Promise<LibraryPage> {
    return this.library.list(tenant, auth.userId, q);
  }

  @Get('summary')
  summary(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<LibrarySummary> {
    return this.library.summary(tenant, auth.userId);
  }

  @Post('uploads')
  createUpload(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(UploadBody)) body: Out<typeof UploadBody>,
  ): Promise<UploadTicket> {
    return this.library.createUpload(tenant, auth.userId, body);
  }

  @Post('bulk')
  @HttpCode(200)
  @Access('DOCUMENTS', 'EDIT')
  bulk(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(BulkBody)) body: Out<typeof BulkBody>,
  ): Promise<BulkDocumentsResult> {
    return this.library.bulk(tenant, auth.userId, body);
  }

  @Get(':id/details')
  details(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<LibraryDocument> {
    return this.library.details(tenant, auth.userId, id);
  }

  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateDocumentBody)) body: Out<typeof UpdateDocumentBody>,
  ): Promise<LibraryDocument> {
    return this.library.update(tenant, auth.userId, id, body);
  }

  @Post(':id/review')
  @HttpCode(200)
  @Access('DOCUMENTS', 'EDIT')
  review(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ReviewBody)) body: Out<typeof ReviewBody>,
  ): Promise<LibraryDocument> {
    return this.library.review(tenant, auth.userId, id, body);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @Access('DOCUMENTS', 'EDIT')
  archive(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<LibraryDocument> {
    return this.library.move(tenant, auth.userId, id, 'archive');
  }

  @Post(':id/restore')
  @HttpCode(200)
  @Access('DOCUMENTS', 'EDIT')
  restore(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<LibraryDocument> {
    return this.library.move(tenant, auth.userId, id, 'restore');
  }

  @Post(':id/trash')
  @HttpCode(200)
  @Access('DOCUMENTS', 'DELETE')
  trash(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<LibraryDocument> {
    return this.library.move(tenant, auth.userId, id, 'trash');
  }

  @Post(':id/untrash')
  @HttpCode(200)
  @Access('DOCUMENTS', 'DELETE')
  untrash(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<LibraryDocument> {
    return this.library.move(tenant, auth.userId, id, 'untrash');
  }

  @Get(':id/versions')
  async versions(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<DocumentVersionList> {
    return { items: await this.library.versions(tenant, auth.userId, id) };
  }

  @Get(':id/activity')
  async activity(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<DocumentActivityList> {
    return { items: await this.library.activity(tenant, auth.userId, id) };
  }

  @Get(':id/access-history')
  async accessHistory(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<DocumentActivityList> {
    return { items: await this.library.activity(tenant, auth.userId, id, true) };
  }

  @Get(':id/preview')
  preview(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<DownloadLink> {
    return this.library.preview(tenant, auth.userId, id);
  }
}

/** Frame 6: folders (DELETE capability to change), types and settings (MANAGE to change). */
@Controller('business')
@Access('DOCUMENTS')
@Roles(...FIRM_STAFF)
export class DocumentFoldersController {
  constructor(private readonly folders: DocumentFoldersService) {}

  @Get('document-folders')
  async list(@CurrentTenant() tenant: TenantContext): Promise<DocumentFolderList> {
    return { items: await this.folders.folders(tenant) };
  }

  @Post('document-folders/reorder')
  @HttpCode(200)
  @Access('DOCUMENTS', 'DELETE')
  async reorder(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(ReorderFoldersBody)) body: Out<typeof ReorderFoldersBody>,
  ): Promise<DocumentFolderList> {
    return { items: await this.folders.reorderFolders(tenant, body) };
  }

  @Post('document-folders')
  @Access('DOCUMENTS', 'DELETE')
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateFolderBody)) body: Out<typeof CreateFolderBody>,
  ): Promise<DocumentFolder> {
    return this.folders.createFolder(tenant, body);
  }

  @Patch('document-folders/:id')
  @Access('DOCUMENTS', 'DELETE')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(FolderIdParam)) id: string,
    @Body(new ZodValidationPipe(UpdateFolderBody)) body: Out<typeof UpdateFolderBody>,
  ): Promise<DocumentFolder> {
    return this.folders.updateFolder(tenant, id, body);
  }

  @Delete('document-folders/:id')
  @Access('DOCUMENTS', 'DELETE')
  remove(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(FolderIdParam)) id: string,
  ): Promise<OkResponse> {
    return this.folders.deleteFolder(tenant, id);
  }

  @Post('document-categories')
  @Access('DOCUMENTS', 'MANAGE')
  createCategory(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateCategoryBody)) body: Out<typeof CreateCategoryBody>,
  ): Promise<DocumentCategory> {
    return this.folders.createCategory(tenant, body);
  }

  @Patch('document-categories/:id')
  @Access('DOCUMENTS', 'MANAGE')
  updateCategory(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateCategoryBody)) body: Out<typeof UpdateCategoryBody>,
  ): Promise<DocumentCategory> {
    return this.folders.updateCategory(tenant, id, body);
  }

  @Get('document-settings')
  settings(@CurrentTenant() tenant: TenantContext): Promise<DocumentSettings> {
    return this.folders.settings(tenant);
  }

  @Patch('document-settings')
  @Access('DOCUMENTS', 'MANAGE')
  updateSettings(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(UpdateSettingsBody)) body: Out<typeof UpdateSettingsBody>,
  ): Promise<DocumentSettings> {
    return this.folders.updateSettings(tenant, body);
  }
}
