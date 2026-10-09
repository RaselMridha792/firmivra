import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import type { z } from 'zod';
import {
  DuplicateEsignTemplateBody,
  EsignRequestId,
  type EsignTemplateDetail,
  EsignTemplateId,
  type EsignTemplateList,
  ListEsignTemplatesQuery,
  SaveEsignTemplateBody,
  UpdateEsignTemplateBody,
} from '@firmivra/types';
import { CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../../auth/decorators.js';
import { RequiresModule } from '../../common/modules/requires-module.js';
import type { AuthContext, TenantContext } from '../../common/request-context.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { actorOf } from '../requests/requests.controller.js';
import { EsignTemplateCopyService } from './template-copy.service.js';
import { EsignTemplatesService } from './templates.service.js';

export const templateIdPipe = new ZodValidationPipe(EsignTemplateId);

/** Firm Sign templates (contract: packages/types/src/esign/admin.ts, docs/api/esign.yaml). */
@Controller('esign/templates')
@Roles(...FIRM_STAFF)
@RequiresModule('esign')
export class EsignTemplatesController {
  constructor(
    private readonly templates: EsignTemplatesService,
    private readonly copies: EsignTemplateCopyService,
  ) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(ListEsignTemplatesQuery))
    query: z.output<typeof ListEsignTemplatesQuery>,
  ): Promise<EsignTemplateList> {
    return this.templates.list(tenant.businessId, actorOf(auth, tenant), query);
  }

  @Get(':templateId')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('templateId', templateIdPipe) id: string,
  ): Promise<EsignTemplateDetail> {
    return this.templates.get(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Patch(':templateId')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('templateId', templateIdPipe) id: string,
    @Body(new ZodValidationPipe(UpdateEsignTemplateBody))
    body: z.output<typeof UpdateEsignTemplateBody>,
  ): Promise<EsignTemplateDetail> {
    return this.templates.update(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post(':templateId/archive')
  @HttpCode(200)
  archive(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('templateId', templateIdPipe) id: string,
  ): Promise<EsignTemplateDetail> {
    return this.templates.archive(tenant.businessId, actorOf(auth, tenant), id);
  }

  /** The packet for the page viewer on this site only: never cached, never framed elsewhere. */
  @Get(':templateId/packet')
  @Header('Cache-Control', 'no-store')
  @Header('Cross-Origin-Resource-Policy', 'same-origin')
  @Header('Content-Disposition', 'attachment')
  async packet(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('templateId', templateIdPipe) id: string,
  ): Promise<StreamableFile> {
    const bytes = await this.templates.packet(tenant.businessId, actorOf(auth, tenant), id);
    return new StreamableFile(bytes, { type: 'application/pdf', length: bytes.byteLength });
  }

  /** 201: the copy. */
  @Post(':templateId/duplicate')
  duplicate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('templateId', templateIdPipe) id: string,
    @Body(new ZodValidationPipe(DuplicateEsignTemplateBody))
    body: z.output<typeof DuplicateEsignTemplateBody>,
  ): Promise<EsignTemplateDetail> {
    return this.copies.duplicate(tenant.businessId, actorOf(auth, tenant), id, body);
  }
}

/** Templates made from a request (contract: SaveEsignTemplateBody). */
@Controller('esign/requests/:id')
@Roles(...FIRM_STAFF)
@RequiresModule('esign')
export class EsignTemplateSaveController {
  constructor(private readonly copies: EsignTemplateCopyService) {}

  /** 201: the new template. */
  @Post('save-as-template')
  saveAsTemplate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(EsignRequestId)) id: string,
    @Body(new ZodValidationPipe(SaveEsignTemplateBody))
    body: z.output<typeof SaveEsignTemplateBody>,
  ): Promise<EsignTemplateDetail> {
    return this.copies.saveAsTemplate(tenant.businessId, actorOf(auth, tenant), id, body);
  }
}
