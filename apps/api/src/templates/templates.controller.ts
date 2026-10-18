import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import {
  type BulkTemplatesResult,
  type DownloadLink,
  type ImportTemplateResult,
  type InstallStartersResult,
  type MessageTemplateDetail,
  MessageTemplateId,
  type MessageTemplatePage,
  type OkResponse,
  type RenderedTemplate,
  type StarterTemplatesStatus,
  type TemplateAttachment,
  TemplateAttachmentId,
  type TemplatesSummary,
  type TemplateVersion,
  type TemplateVersionList,
  type UploadTicket,
  ConfirmUploadRequest,
} from '@firmivra/types';
import {
  Access,
  CurrentAuth,
  CurrentTenant,
  FIRM_MANAGERS,
  FIRM_STAFF,
  Roles,
} from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { actorOf } from '../workspaces/common.js';
import {
  ArchiveTemplateBody,
  BulkBody,
  CreateTemplateBody,
  ImportBody,
  PreviewBody,
  SharesBody,
  StartAttachmentBody,
  TemplatesQuery,
  TestSendBody,
  UpdateTemplateBody,
} from './template-input.js';
import { TemplateAttachmentsService } from './template-attachments.service.js';
import { TemplateReadService } from './template-read.service.js';
import { TemplateStartersService } from './template-starters.service.js';
import { TemplatesService } from './templates.service.js';

const OK: OkResponse = { ok: true };
const idPipe = new ZodValidationPipe(MessageTemplateId);
const attachmentPipe = new ZodValidationPipe(TemplateAttachmentId);
const versionPipe = new ZodValidationPipe(z.coerce.number().int().min(1));
const ConfirmBody = z.strictObject(ConfirmUploadRequest.shape);

type Out<S extends z.ZodType> = z.output<S>;

/**
 * The message-template library (contract in packages/types/src/templates). Owner, Admin and Staff
 * (and the permission grid's roles through `@Access('TEMPLATES')`); everyone reads the templates
 * they may see, and only a template's owner, or an Owner or Admin, changes a private or selected
 * one. Never a portal route. The firm comes from TenantGuard.
 */
@Controller('business/templates')
@Access('TEMPLATES')
@Roles(...FIRM_STAFF)
export class TemplatesController {
  constructor(
    private readonly reader: TemplateReadService,
    private readonly templates: TemplatesService,
    private readonly attachments: TemplateAttachmentsService,
    private readonly starters: TemplateStartersService,
  ) {}

  // ----- Library (static paths first) -----

  @Get('summary')
  summary(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<TemplatesSummary> {
    return this.reader.summary(tenant.businessId, actorOf(auth, tenant));
  }

  @Get('starters')
  startersStatus(@CurrentTenant() tenant: TenantContext): Promise<StarterTemplatesStatus> {
    return this.starters.status(tenant.businessId);
  }

  @Post('starters')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  installStarters(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<InstallStartersResult> {
    return this.starters.install(tenant.businessId, actorOf(auth, tenant));
  }

  @Post('bulk')
  @HttpCode(200)
  bulk(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(BulkBody)) body: Out<typeof BulkBody>,
  ): Promise<BulkTemplatesResult> {
    return this.templates.bulk(tenant.businessId, actorOf(auth, tenant), body);
  }

  @Post('import')
  importTemplate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(ImportBody)) body: Out<typeof ImportBody>,
  ): Promise<ImportTemplateResult> {
    return this.templates.importTemplate(tenant.businessId, actorOf(auth, tenant), body);
  }

  @Post('attachments/uploads/confirm')
  @HttpCode(200)
  confirmAttachment(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(ConfirmBody)) body: Out<typeof ConfirmBody>,
  ): Promise<TemplateAttachment> {
    return this.attachments.confirm(tenant.businessId, actorOf(auth, tenant), body.uploadToken);
  }

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(TemplatesQuery)) q: Out<typeof TemplatesQuery>,
  ): Promise<MessageTemplatePage> {
    return this.reader.list(tenant.businessId, actorOf(auth, tenant), q);
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateTemplateBody)) body: Out<typeof CreateTemplateBody>,
  ): Promise<MessageTemplateDetail> {
    return this.templates.create(tenant.businessId, actorOf(auth, tenant), body);
  }

  // ----- One template -----

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<MessageTemplateDetail> {
    return this.reader.get(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateTemplateBody)) body: Out<typeof UpdateTemplateBody>,
  ): Promise<MessageTemplateDetail> {
    return this.templates.update(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post(':id/duplicate')
  duplicate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<MessageTemplateDetail> {
    return this.templates.duplicate(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ArchiveTemplateBody)) body: Out<typeof ArchiveTemplateBody>,
  ): Promise<MessageTemplateDetail> {
    return this.templates.archive(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post(':id/restore')
  @HttpCode(200)
  restore(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<MessageTemplateDetail> {
    return this.templates.restore(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Put(':id/favorite')
  favorite(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<MessageTemplateDetail> {
    return this.templates.favorite(tenant.businessId, actorOf(auth, tenant), id, true);
  }

  @Delete(':id/favorite')
  unfavorite(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<MessageTemplateDetail> {
    return this.templates.favorite(tenant.businessId, actorOf(auth, tenant), id, false);
  }

  @Put(':id/shares')
  setShares(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(SharesBody)) body: Out<typeof SharesBody>,
  ): Promise<MessageTemplateDetail> {
    return this.templates.setShares(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  // ----- Versions -----

  @Get(':id/versions')
  async versions(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TemplateVersionList> {
    return { items: await this.reader.versions(tenant.businessId, actorOf(auth, tenant), id) };
  }

  @Get(':id/versions/:version')
  version(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('version', versionPipe) version: number,
  ): Promise<TemplateVersion> {
    return this.reader.version(tenant.businessId, actorOf(auth, tenant), id, version);
  }

  @Post(':id/versions/:version/restore')
  @HttpCode(200)
  restoreVersion(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('version', versionPipe) version: number,
  ): Promise<MessageTemplateDetail> {
    return this.templates.restoreVersion(tenant.businessId, actorOf(auth, tenant), id, version);
  }

  // ----- Preview and test send -----

  @Post(':id/preview')
  @HttpCode(200)
  preview(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(PreviewBody)) body: Out<typeof PreviewBody>,
  ): Promise<RenderedTemplate> {
    return this.templates.preview(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post(':id/test-send')
  @HttpCode(200)
  async testSend(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(TestSendBody)) body: Out<typeof TestSendBody>,
  ): Promise<OkResponse> {
    await this.templates.testSend(tenant.businessId, actorOf(auth, tenant), id, body);
    return OK;
  }

  // ----- Attachments -----

  @Post(':id/attachments/uploads')
  @HttpCode(200)
  startAttachment(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(StartAttachmentBody)) body: Out<typeof StartAttachmentBody>,
  ): Promise<UploadTicket> {
    return this.attachments.ticket(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Get(':id/attachments/:attachmentId/download')
  download(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('attachmentId', attachmentPipe) attachmentId: string,
  ): Promise<DownloadLink> {
    return this.attachments.download(tenant.businessId, actorOf(auth, tenant), id, attachmentId);
  }

  @Delete(':id/attachments/:attachmentId')
  async removeAttachment(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('attachmentId', attachmentPipe) attachmentId: string,
  ): Promise<OkResponse> {
    await this.attachments.remove(tenant.businessId, actorOf(auth, tenant), id, attachmentId);
    return OK;
  }
}
