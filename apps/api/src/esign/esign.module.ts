import { Module } from '@nestjs/common';
import { ModulesModule } from '../common/modules/requires-module.js';
import { EsignStatusController } from './requests/requests.controller.js';
import { EsignRequestsService } from './requests/requests.service.js';

/**
 * Firm Sign (R13). Behind the firm's 'esign' module (ModulesModule): off for a firm until
 * `business_settings.enabled_modules` lists 'esign'. Drafts, recipients and the page plan come
 * in part 1b, with R18's EsignEngineModule.
 */
@Module({
  imports: [ModulesModule],
  controllers: [EsignStatusController],
  providers: [EsignRequestsService],
})
export class EsignModule {}
