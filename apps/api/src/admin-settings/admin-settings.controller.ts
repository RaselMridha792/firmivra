import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  AdminFeatureEmergencyRequest,
  AdminFeatureKey,
  AdminFeatureQuery,
  AdminJobKey,
  AdminSecretKey,
  AdminTestEmailRequest,
  ConfirmAdminBrandAssetRequest,
  CreateAdminBrandAssetUploadRequest,
  CreateAdminFeatureRequest,
  CreateAdminLegalHoldRequest,
  CreateAdminMaintenanceRequest,
  CreateAdminRetentionRunRequest,
  PauseAdminJobRequest,
  PlatformBrandAssetKind,
  ReleaseAdminLegalHoldRequest,
  SaveAdminBrandingRequest,
  SaveAdminEmailRequest,
  SaveAdminFirmDefaultsRequest,
  SaveAdminGeneralRequest,
  SaveAdminUserDefaultsRequest,
  SetAdminBrandAssetRequest,
  SetAdminFeatureOverrideRequest,
  SetAdminSecretRefRequest,
  UpdateAdminFeatureRequest,
  UpdateAdminMaintenanceRequest,
  UpdateAdminRetentionPolicyRequest,
} from '@firmivra/types';
import { z } from 'zod';
import { poolSecrets } from '../auth/sealed.js';
import { Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { NotifyModule } from '../notify/notify.module.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig, loadDocumentsConfig } from '../storage/config.js';
import {
  createS3Client,
  DOCUMENT_STORAGE,
  S3DocumentStorage,
} from '../storage/document-storage.js';
import { AdminBrandingService, BrandUploadTokens } from './admin-branding.service.js';
import { AdminFeaturesService } from './admin-features.service.js';
import { AdminOperationsService } from './admin-operations.service.js';
import { AdminSettingsService } from './admin-settings.service.js';
import { AdminHealthService } from './admin-health.service.js';

type Out<S extends z.ZodType> = z.output<S>;
const pipe = <S extends z.ZodType>(schema: S) => new ZodValidationPipe(schema);
const uuid = pipe(z.uuid());
const featureKey = pipe(AdminFeatureKey);
const category = pipe(z.string().regex(/^[a-z][a-z0-9_]{0,59}$/));
const kindPipe = pipe(PlatformBrandAssetKind);
type Kind = z.infer<typeof PlatformBrandAssetKind>;

/**
 * Super Admin System Settings (R55; contract in packages/types/src/admin-settings). Super Admin
 * only; admin scope. Static paths come before ':param' ones.
 */
@Controller('admin/system-settings')
@Roles('SUPER_ADMIN')
export class AdminSettingsController {
  constructor(
    private readonly settings: AdminSettingsService,
    private readonly health: AdminHealthService,
    private readonly branding: AdminBrandingService,
    private readonly features: AdminFeaturesService,
    private readonly ops: AdminOperationsService,
  ) {}

  @Get()
  overview() {
    return this.settings.overview();
  }

  // ---------- Sections ----------

  @Get('general')
  general() {
    return this.settings.general();
  }

  @Put('general')
  saveGeneral(@Body(pipe(SaveAdminGeneralRequest)) body: Out<typeof SaveAdminGeneralRequest>) {
    return this.settings.saveGeneral(body);
  }

  @Get('branding')
  getBranding() {
    return this.branding.branding();
  }

  @Put('branding')
  saveBranding(@Body(pipe(SaveAdminBrandingRequest)) body: Out<typeof SaveAdminBrandingRequest>) {
    return this.branding.saveBranding(body);
  }

  @Get('branding/assets')
  assets(@Query('kind', pipe(PlatformBrandAssetKind.optional())) kind?: Kind) {
    return this.branding.assets(kind);
  }

  @Post('branding/assets/uploads')
  ticket(
    @Body(pipe(CreateAdminBrandAssetUploadRequest))
    body: Out<typeof CreateAdminBrandAssetUploadRequest>,
  ) {
    return this.branding.ticket(body);
  }

  @Post('branding/assets/uploads/confirm')
  confirm(
    @Body(pipe(ConfirmAdminBrandAssetRequest)) body: Out<typeof ConfirmAdminBrandAssetRequest>,
  ) {
    return this.branding.confirm(body.uploadToken);
  }

  @Put('branding/current/:kind')
  setAsset(
    @Param('kind', kindPipe) kind: Kind,
    @Body(pipe(SetAdminBrandAssetRequest)) body: Out<typeof SetAdminBrandAssetRequest>,
  ) {
    return this.branding.setCurrent(kind, body.assetId);
  }

  @Delete('branding/current/:kind')
  resetAsset(@Param('kind', kindPipe) kind: Kind) {
    return this.branding.reset(kind);
  }

  // Before email/:anything would ever match (static paths first).
  @Get('email/status')
  emailStatus() {
    return this.health.emailStatus();
  }

  @Get('health')
  systemHealth() {
    return this.health.health();
  }

  @Get('email')
  email() {
    return this.settings.email();
  }

  @Put('email')
  saveEmail(@Body(pipe(SaveAdminEmailRequest)) body: Out<typeof SaveAdminEmailRequest>) {
    return this.settings.saveEmail(body);
  }

  @Post('email/test')
  @HttpCode(200)
  testEmail(@Body(pipe(AdminTestEmailRequest)) body: Out<typeof AdminTestEmailRequest>) {
    return this.settings.testEmail(body.to);
  }

  // ---------- Secrets ----------

  @Get('secrets')
  secrets() {
    return this.settings.secrets();
  }

  @Put('secrets/:key')
  setSecret(
    @Param('key', pipe(AdminSecretKey)) key: string,
    @Body(pipe(SetAdminSecretRefRequest)) body: Out<typeof SetAdminSecretRefRequest>,
  ) {
    return this.settings.setSecret(key, body);
  }

  @Delete('secrets/:key')
  removeSecret(@Param('key', pipe(AdminSecretKey)) key: string) {
    return this.settings.removeSecret(key);
  }

  // ---------- Features ----------

  @Get('features')
  featureList(@Query(pipe(AdminFeatureQuery)) q: Out<typeof AdminFeatureQuery>) {
    return this.features.list(q);
  }

  @Post('features')
  createFeature(
    @Body(pipe(CreateAdminFeatureRequest)) body: Out<typeof CreateAdminFeatureRequest>,
  ) {
    return this.features.create(body);
  }

  @Patch('features/:key')
  updateFeature(
    @Param('key', featureKey) key: string,
    @Body(pipe(UpdateAdminFeatureRequest)) body: Out<typeof UpdateAdminFeatureRequest>,
  ) {
    return this.features.update(key, body);
  }

  @Post('features/:key/emergency')
  @HttpCode(200)
  emergency(
    @Param('key', featureKey) key: string,
    @Body(pipe(AdminFeatureEmergencyRequest)) body: Out<typeof AdminFeatureEmergencyRequest>,
  ) {
    return this.features.emergency(key, body);
  }

  @Get('features/:key/firms')
  overrides(@Param('key', featureKey) key: string) {
    return this.features.overrides(key);
  }

  @Put('features/:key/firms/:businessId')
  setOverride(
    @Param('key', featureKey) key: string,
    @Param('businessId', uuid) businessId: string,
    @Body(pipe(SetAdminFeatureOverrideRequest)) body: Out<typeof SetAdminFeatureOverrideRequest>,
  ) {
    return this.features.setOverride(key, businessId, body);
  }

  @Delete('features/:key/firms/:businessId')
  removeOverride(
    @Param('key', featureKey) key: string,
    @Param('businessId', uuid) businessId: string,
  ) {
    return this.features.removeOverride(key, businessId);
  }

  // ---------- Retention ----------

  @Get('retention')
  retention() {
    return this.ops.retention();
  }

  @Get('retention/runs')
  runs() {
    return this.ops.runs();
  }

  @Post('retention/runs/:id/cancel')
  @HttpCode(200)
  cancelRun(@Param('id', uuid) id: string) {
    return this.ops.cancelRun(id);
  }

  @Patch('retention/:category')
  updateRetention(
    @Param('category', category) cat: string,
    @Body(pipe(UpdateAdminRetentionPolicyRequest))
    body: Out<typeof UpdateAdminRetentionPolicyRequest>,
  ) {
    return this.ops.updateRetention(cat, body);
  }

  @Post('retention/:category/runs')
  createRun(
    @Param('category', category) cat: string,
    @Body(pipe(CreateAdminRetentionRunRequest)) body: Out<typeof CreateAdminRetentionRunRequest>,
  ) {
    return this.ops.createRun(cat, body.dryRun);
  }

  @Get('holds')
  holds() {
    return this.ops.holds();
  }

  @Post('holds')
  createHold(
    @Body(pipe(CreateAdminLegalHoldRequest)) body: Out<typeof CreateAdminLegalHoldRequest>,
  ) {
    return this.ops.createHold(body);
  }

  @Post('holds/:id/release')
  @HttpCode(200)
  releaseHold(
    @Param('id', uuid) id: string,
    @Body(pipe(ReleaseAdminLegalHoldRequest)) body: Out<typeof ReleaseAdminLegalHoldRequest>,
  ) {
    return this.ops.releaseHold(id, body.reason);
  }

  // ---------- Maintenance and jobs ----------

  @Get('maintenance')
  maintenance() {
    return this.ops.maintenance();
  }

  @Post('maintenance')
  schedule(
    @Body(pipe(CreateAdminMaintenanceRequest)) body: Out<typeof CreateAdminMaintenanceRequest>,
  ) {
    return this.ops.schedule(body);
  }

  @Patch('maintenance/:id')
  updateWindow(
    @Param('id', uuid) id: string,
    @Body(pipe(UpdateAdminMaintenanceRequest)) body: Out<typeof UpdateAdminMaintenanceRequest>,
  ) {
    return this.ops.updateWindow(id, body);
  }

  @Post('maintenance/:id/start')
  @HttpCode(200)
  start(@Param('id', uuid) id: string) {
    return this.ops.moveWindow(id, 'ACTIVE');
  }

  @Post('maintenance/:id/complete')
  @HttpCode(200)
  complete(@Param('id', uuid) id: string) {
    return this.ops.moveWindow(id, 'COMPLETED');
  }

  @Post('maintenance/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id', uuid) id: string) {
    return this.ops.moveWindow(id, 'CANCELLED');
  }

  @Get('jobs')
  jobs() {
    return this.ops.jobs();
  }

  @Post('jobs/:key/pause')
  @HttpCode(200)
  pause(
    @Param('key', pipe(AdminJobKey)) key: string,
    @Body(pipe(PauseAdminJobRequest)) body: Out<typeof PauseAdminJobRequest>,
  ) {
    return this.ops.setJob(key, false, body.reason);
  }

  @Post('jobs/:key/resume')
  @HttpCode(200)
  resume(@Param('key', pipe(AdminJobKey)) key: string) {
    return this.ops.setJob(key, true);
  }

  // ---------- Defaults ----------

  @Get('defaults/firm')
  firmDefaults() {
    return this.ops.firmDefaults();
  }

  @Post('defaults/firm')
  async saveFirmDefaults(
    @Body(pipe(SaveAdminFirmDefaultsRequest)) body: Out<typeof SaveAdminFirmDefaultsRequest>,
  ) {
    await this.ops.saveDefaults('FIRM', body);
    return this.ops.firmDefaults();
  }

  @Get('defaults/user')
  userDefaults() {
    return this.ops.userDefaults();
  }

  @Post('defaults/user')
  async saveUserDefaults(
    @Body(pipe(SaveAdminUserDefaultsRequest)) body: Out<typeof SaveAdminUserDefaultsRequest>,
  ) {
    await this.ops.saveDefaults('USER', body);
    return this.ops.userDefaults();
  }

  @Get('defaults/:kind/versions')
  versions(@Param('kind', pipe(z.enum(['firm', 'user']))) kind: 'firm' | 'user') {
    return this.ops.versions(kind === 'firm' ? 'FIRM' : 'USER');
  }
}

@Module({
  imports: [NotifyModule],
  controllers: [AdminSettingsController],
  providers: [
    AdminPrisma,
    AdminSettingsService,
    AdminHealthService,
    AdminBrandingService,
    AdminFeaturesService,
    AdminOperationsService,
    // The documents bucket and settings, as DocumentsModule builds them (that module exports none).
    { provide: DOCUMENTS_CONFIG, useFactory: () => loadDocumentsConfig() },
    {
      provide: DOCUMENT_STORAGE,
      inject: [DOCUMENTS_CONFIG],
      useFactory: (config: DocumentsConfig) =>
        new S3DocumentStorage(createS3Client(config), config.bucket),
    },
    {
      provide: BrandUploadTokens,
      inject: [ENV],
      useFactory: (env: Env) => new BrandUploadTokens(poolSecrets(env)),
    },
  ],
})
export class AdminSettingsModule {}
