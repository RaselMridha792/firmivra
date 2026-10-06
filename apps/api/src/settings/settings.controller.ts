import { Body, Controller, Get, HttpCode, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  UpdateBusinessSettingsRequest,
  SaveBusinessSetupRequest,
  PublishFirmLegalVersionRequest,
  GetFirmLegalVersionQuery,
} from '@firmivra/types';
import { Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PendingSettingsAssets, SettingsAssets } from './settings.assets.js';
import { SettingsService } from './settings.service.js';
const legalKind = new ZodValidationPipe(z.enum(['TERMS', 'PRIVACY']));
@Controller('business')
@Roles('OWNER', 'ADMIN')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}
  @Get('settings') get() {
    return this.settings.get();
  }
  @Patch('settings') update(
    @Body(new ZodValidationPipe(UpdateBusinessSettingsRequest))
    body: z.output<typeof UpdateBusinessSettingsRequest>,
  ) {
    return this.settings.update(body);
  }
  @Get('setup') setup() {
    return this.settings.setup();
  }
  @Patch('setup') save(
    @Body(new ZodValidationPipe(SaveBusinessSetupRequest))
    body: z.output<typeof SaveBusinessSetupRequest>,
  ) {
    return this.settings.saveSetup(body);
  }
  @Post('setup/complete') @HttpCode(200) complete() {
    return this.settings.complete();
  }
  @Get('legal/:kind') legal(
    @Param('kind', legalKind) kind: 'TERMS' | 'PRIVACY',
    @Query(new ZodValidationPipe(GetFirmLegalVersionQuery))
    query: z.output<typeof GetFirmLegalVersionQuery>,
  ) {
    return this.settings.legal(kind, query.version);
  }
  @Post('legal/:kind') publish(
    @Param('kind', legalKind) kind: 'TERMS' | 'PRIVACY',
    @Body(new ZodValidationPipe(PublishFirmLegalVersionRequest))
    body: z.output<typeof PublishFirmLegalVersionRequest>,
  ) {
    return this.settings.publish(kind, body.bodyMarkdown);
  }
}
@Controller('portal/:slug')
@Roles('CLIENT')
export class PortalSettingsController {
  constructor(private readonly settings: SettingsService) {}
  @Get('settings') get() {
    return this.settings.portal();
  }
  @Get('legal/:kind') legal(
    @Param('kind', legalKind) kind: 'TERMS' | 'PRIVACY',
    @Query(new ZodValidationPipe(GetFirmLegalVersionQuery))
    query: z.output<typeof GetFirmLegalVersionQuery>,
  ) {
    return this.settings.legal(kind, query.version);
  }
}
@Module({
  controllers: [SettingsController, PortalSettingsController],
  providers: [SettingsService, { provide: SettingsAssets, useClass: PendingSettingsAssets }],
  exports: [SettingsService],
})
export class SettingsModule {}
