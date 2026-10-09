import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import {
  EsignRequestId,
  type EsignTemplateDetail,
  type EsignTemplateVersionList,
  RestoreEsignTemplateVersionBody,
  SaveEsignTemplateVersionBody,
} from '@firmivra/types';
import { CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../../auth/decorators.js';
import { RequiresModule } from '../../common/modules/requires-module.js';
import type { AuthContext, TenantContext } from '../../common/request-context.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { actorOf } from '../requests/requests.controller.js';
import { EsignTemplateVersionsService } from './template-versions.service.js';
import { templateIdPipe } from './templates.controller.js';

/** A version number in the path: 1 or more, digits only. */
const versionPipe = new ZodValidationPipe(
  z
    .string()
    .regex(/^[1-9]\d{0,8}$/)
    .transform(Number),
);

/** Template versions (contract 3: packages/types/src/esign/extras.ts). */
@Controller('esign/templates/:templateId/versions')
@Roles(...FIRM_STAFF)
@RequiresModule('esign')
export class EsignTemplateVersionsController {
  constructor(private readonly versions: EsignTemplateVersionsService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('templateId', templateIdPipe) id: string,
  ): Promise<EsignTemplateVersionList> {
    return this.versions.list(tenant.businessId, actorOf(auth, tenant), id);
  }

  /** 201: the new newest version. */
  @Post(':version/restore')
  restore(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('templateId', templateIdPipe) id: string,
    @Param('version', versionPipe) version: number,
    @Body(new ZodValidationPipe(RestoreEsignTemplateVersionBody))
    body: z.output<typeof RestoreEsignTemplateVersionBody>,
  ): Promise<EsignTemplateDetail> {
    const actor = actorOf(auth, tenant);
    return this.versions.restore(tenant.businessId, actor, id, version, body);
  }
}

/** A request saved as a template's next version. */
@Controller('esign/requests/:id')
@Roles(...FIRM_STAFF)
@RequiresModule('esign')
export class EsignTemplateVersionSaveController {
  constructor(private readonly versions: EsignTemplateVersionsService) {}

  /** 201: the template with its new version. */
  @Post('save-as-version')
  saveAsVersion(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(EsignRequestId)) id: string,
    @Body(new ZodValidationPipe(SaveEsignTemplateVersionBody))
    body: z.output<typeof SaveEsignTemplateVersionBody>,
  ): Promise<EsignTemplateDetail> {
    return this.versions.saveAsVersion(tenant.businessId, actorOf(auth, tenant), id, body);
  }
}
