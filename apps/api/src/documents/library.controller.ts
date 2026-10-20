import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type {
  BulkDocumentsResult,
  BulkRequestPacketsResult,
  DocumentAccess,
  DocumentShare,
  RequestPacketDetail,
  RequestPacketPage,
  RequestPacketSummary,
  RequestTemplate,
  RequestTemplateList,
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
import { DocumentPacketsService } from './packets.service.js';
import { DocumentSharesService } from './shares.service.js';
import { DocumentTemplatesService } from './templates.service.js';
import {
  BulkBody,
  BulkPacketsBody,
  CreateItemBody,
  CreatePacketBody,
  CreateShareBody,
  CreateTemplateBody,
  PacketsQ,
  ReorderItemsBody,
  TemplatesQ,
  UpdateItemBody,
  UpdatePacketBody,
  UpdateShareBody,
  UpdateTemplateBody,
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
  constructor(
    private readonly library: DocumentLibraryService,
    private readonly shares: DocumentSharesService,
  ) {}

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

  @Get(':id/access')
  access(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<DocumentAccess> {
    return this.shares.access(tenant, auth.userId, id);
  }

  @Post(':id/shares')
  share(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(CreateShareBody)) body: Out<typeof CreateShareBody>,
  ): Promise<DocumentShare> {
    return this.shares.share(tenant, auth.userId, id, body);
  }

  @Patch(':id/shares/:shareId')
  updateShare(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('shareId', idPipe) shareId: string,
    @Body(new ZodValidationPipe(UpdateShareBody)) body: Out<typeof UpdateShareBody>,
  ): Promise<DocumentShare> {
    return this.shares.update(tenant, auth.userId, id, shareId, body);
  }

  @Post(':id/shares/:shareId/revoke')
  @HttpCode(200)
  @Access('DOCUMENTS', 'EDIT')
  revokeShare(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('shareId', idPipe) shareId: string,
  ): Promise<OkResponse> {
    return this.shares.revoke(tenant, auth.userId, id, shareId);
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

/** The requests dashboard and Create Document Request (R55). Static routes before ':id'. */
@Controller('business/document-request-packets')
@Access('DOCUMENTS')
@Roles(...FIRM_STAFF)
export class DocumentPacketsController {
  constructor(private readonly packets: DocumentPacketsService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(PacketsQ)) q: Out<typeof PacketsQ>,
  ): Promise<RequestPacketPage> {
    return this.packets.list(tenant, auth.userId, q);
  }

  @Get('summary')
  summary(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<RequestPacketSummary> {
    return this.packets.summary(tenant, auth.userId);
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreatePacketBody)) body: Out<typeof CreatePacketBody>,
  ): Promise<RequestPacketDetail> {
    return this.packets.create(tenant, auth.userId, body);
  }

  @Post('bulk')
  @HttpCode(200)
  @Access('DOCUMENTS', 'EDIT')
  bulk(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(BulkPacketsBody)) body: Out<typeof BulkPacketsBody>,
  ): Promise<BulkRequestPacketsResult> {
    return this.packets.bulk(tenant, auth.userId, body);
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<RequestPacketDetail> {
    return this.packets.get(tenant, auth.userId, id);
  }

  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdatePacketBody)) body: Out<typeof UpdatePacketBody>,
  ): Promise<RequestPacketDetail> {
    return this.packets.update(tenant, auth.userId, id, body);
  }

  @Post(':id/send')
  @HttpCode(200)
  @Access('DOCUMENTS', 'EDIT')
  send(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<RequestPacketDetail> {
    return this.packets.send(tenant, auth.userId, id);
  }

  @Post(':id/resend')
  @HttpCode(200)
  @Access('DOCUMENTS', 'EDIT')
  resend(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<RequestPacketDetail> {
    return this.packets.nudge(tenant, auth.userId, id, 'resent');
  }

  @Post(':id/remind')
  @HttpCode(200)
  @Access('DOCUMENTS', 'EDIT')
  remind(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<RequestPacketDetail> {
    return this.packets.nudge(tenant, auth.userId, id, 'reminded');
  }

  @Post(':id/complete')
  @HttpCode(200)
  @Access('DOCUMENTS', 'EDIT')
  complete(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<RequestPacketDetail> {
    return this.packets.complete(tenant, auth.userId, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Access('DOCUMENTS', 'EDIT')
  cancel(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<RequestPacketDetail> {
    return this.packets.cancel(tenant, auth.userId, id);
  }

  @Post(':id/items/reorder')
  @HttpCode(200)
  @Access('DOCUMENTS', 'EDIT')
  reorderItems(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ReorderItemsBody)) body: Out<typeof ReorderItemsBody>,
  ): Promise<RequestPacketDetail> {
    return this.packets.reorderItems(tenant, auth.userId, id, body);
  }

  @Post(':id/items')
  @HttpCode(200)
  @Access('DOCUMENTS', 'EDIT')
  addItem(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(CreateItemBody)) body: Out<typeof CreateItemBody>,
  ): Promise<RequestPacketDetail> {
    return this.packets.addItem(tenant, auth.userId, id, body);
  }

  @Patch(':id/items/:itemId')
  updateItem(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('itemId', idPipe) itemId: string,
    @Body(new ZodValidationPipe(UpdateItemBody)) body: Out<typeof UpdateItemBody>,
  ): Promise<RequestPacketDetail> {
    return this.packets.updateItem(tenant, auth.userId, id, itemId, body);
  }

  @Delete(':id/items/:itemId')
  @Access('DOCUMENTS', 'EDIT')
  removeItem(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('itemId', idPipe) itemId: string,
  ): Promise<RequestPacketDetail> {
    return this.packets.removeItem(tenant, auth.userId, id, itemId);
  }
}

/** Request types and "My saved lists" (R55). */
@Controller('business/document-request-templates')
@Access('DOCUMENTS')
@Roles(...FIRM_STAFF)
export class DocumentTemplatesController {
  constructor(private readonly templates: DocumentTemplatesService) {}

  @Get()
  async list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(TemplatesQ)) q: Out<typeof TemplatesQ>,
  ): Promise<RequestTemplateList> {
    return { items: await this.templates.list(tenant, auth.userId, q) };
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateTemplateBody)) body: Out<typeof CreateTemplateBody>,
  ): Promise<RequestTemplate> {
    return this.templates.create(tenant, auth.userId, body);
  }

  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateTemplateBody)) body: Out<typeof UpdateTemplateBody>,
  ): Promise<RequestTemplate> {
    return this.templates.update(tenant, auth.userId, id, body);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @Access('DOCUMENTS', 'EDIT')
  archive(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<OkResponse> {
    return this.templates.archive(tenant, auth.userId, id);
  }
}
