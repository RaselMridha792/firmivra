import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import type { z } from 'zod';
import {
  type EsignConsentVersion,
  type EsignConsentVersionList,
  type EsignSettings,
  PublishEsignConsentBody,
  UpdateEsignProfileBody,
  UpdateEsignSettingsBody,
} from '@firmivra/types';
import { CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../../auth/decorators.js';
import { RequiresModule } from '../../common/modules/requires-module.js';
import type { AuthContext, TenantContext } from '../../common/request-context.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { actorOf } from '../requests/requests.controller.js';
import { EsignSettingsService } from './settings.service.js';

/** Signing Settings (contract: packages/types/src/esign/admin.ts, docs/api/esign.yaml). */
@Controller('esign')
@Roles(...FIRM_STAFF)
@RequiresModule('esign')
export class EsignSettingsController {
  constructor(private readonly settings: EsignSettingsService) {}

  @Get('settings')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<EsignSettings> {
    return this.settings.get(tenant.businessId, actorOf(auth, tenant));
  }

  @Put('settings')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(UpdateEsignSettingsBody))
    body: z.output<typeof UpdateEsignSettingsBody>,
  ): Promise<EsignSettings> {
    return this.settings.update(tenant.businessId, actorOf(auth, tenant), body);
  }

  @Get('settings/consent-versions')
  consentVersions(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<EsignConsentVersionList> {
    actorOf(auth, tenant);
    return this.settings.consentVersions(tenant.businessId);
  }

  /** Creates a version: 201. */
  @Post('settings/consent-versions')
  publishConsent(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(PublishEsignConsentBody))
    body: z.output<typeof PublishEsignConsentBody>,
  ): Promise<EsignConsentVersion> {
    return this.settings.publishConsent(
      tenant.businessId,
      actorOf(auth, tenant),
      body.bodyMarkdown,
    );
  }

  @Put('me/profile')
  updateProfile(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(UpdateEsignProfileBody))
    body: z.output<typeof UpdateEsignProfileBody>,
  ): Promise<EsignSettings> {
    const actor = actorOf(auth, tenant);
    return this.settings.updateProfile(tenant.businessId, actor, body.jobTitle ?? null);
  }
}
