import { Body, Controller, Get, HttpCode, Module, Param, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import {
  type FirmLegalOverview,
  type FirmSettings,
  type FirmSetup,
  type LegalDocument,
  LegalKind,
  LegalVersionNumber,
  PublishLegalDocumentRequest,
  SetupStep,
  UpdateFirmSettingsRequest,
} from '@firmivra/types';
import {
  AllowBusinessStatuses,
  CurrentAuth,
  CurrentTenant,
  FIRM_MANAGERS,
  Roles,
} from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { FieldEncryptionModule } from '../field-encryption/field-encryption.service.js';
import { SettingsService } from './settings.service.js';

const kindPipe = new ZodValidationPipe(LegalKind);
/** A version in the path: plain digits ("2", not "02" or "2e0"). */
const versionPipe = new ZodValidationPipe(
  z
    .string()
    .regex(/^[1-9][0-9]{0,9}$/)
    .transform(Number)
    .pipe(LegalVersionNumber),
);

/**
 * The firm's settings, the setup wizard and its own Terms and Privacy (docs/api/settings.yaml).
 * Owner and Admin, also while the firm is Pending Setup; the firm comes from TenantGuard.
 */
@Controller('business')
@Roles(...FIRM_MANAGERS)
@AllowBusinessStatuses('PENDING_SETUP', 'ACTIVE')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('settings')
  get(@CurrentTenant() tenant: TenantContext): Promise<FirmSettings> {
    return this.settings.get(tenant.businessId);
  }

  @Patch('settings')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(UpdateFirmSettingsRequest))
    body: z.output<typeof UpdateFirmSettingsRequest>,
  ): Promise<FirmSettings> {
    return this.settings.update(tenant.businessId, body);
  }

  @Get('setup')
  getSetup(@CurrentTenant() tenant: TenantContext): Promise<FirmSetup> {
    return this.settings.getSetup(tenant.businessId);
  }

  @Put('setup/steps/:step')
  completeStep(
    @CurrentTenant() tenant: TenantContext,
    @Param('step', new ZodValidationPipe(SetupStep)) step: SetupStep,
  ): Promise<FirmSetup> {
    return this.settings.completeStep(tenant.businessId, step);
  }

  @Post('setup/complete')
  @HttpCode(200)
  finishSetup(@CurrentTenant() tenant: TenantContext): Promise<FirmSetup> {
    return this.settings.finishSetup(tenant.businessId);
  }

  @Get('legal/:kind')
  getLegal(
    @CurrentTenant() tenant: TenantContext,
    @Param('kind', kindPipe) kind: LegalKind,
  ): Promise<FirmLegalOverview> {
    return this.settings.getLegal(tenant.businessId, kind);
  }

  @Get('legal/:kind/versions/:version')
  getLegalVersion(
    @CurrentTenant() tenant: TenantContext,
    @Param('kind', kindPipe) kind: LegalKind,
    @Param('version', versionPipe) version: number,
  ): Promise<LegalDocument> {
    return this.settings.getLegalVersion(tenant.businessId, kind, version);
  }

  @Post('legal/:kind/versions')
  publishLegal(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Param('kind', kindPipe) kind: LegalKind,
    @Body(new ZodValidationPipe(PublishLegalDocumentRequest))
    body: z.output<typeof PublishLegalDocumentRequest>,
  ): Promise<LegalDocument> {
    return this.settings.publishLegal(tenant.businessId, kind, body.body, auth.userId);
  }
}

@Module({
  imports: [FieldEncryptionModule],
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
