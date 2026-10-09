import { Module } from '@nestjs/common';
import { ModulesModule } from '../common/modules/requires-module.js';
import { EsignEngineModule } from './engine/engine.module.js';
import { EsignDocumentsController } from './requests/documents.controller.js';
import { EsignDocumentsService } from './requests/documents.service.js';
import { ESIGN_DIRECTORY, PrismaEsignDirectory } from './requests/esign-directory.js';
import {
  ESIGN_REPOSITORY,
  type EsignRepository,
  notMigrated,
} from './requests/esign.repository.js';
import { EsignRequestsController, EsignStatusController } from './requests/requests.controller.js';
import { EsignListService } from './requests/list.service.js';
import { EsignPrepareService } from './requests/prepare.service.js';
import { EsignRequestsService } from './requests/requests.service.js';

/**
 * Firm Sign (R13). Behind the firm's 'esign' module (ModulesModule): off for a firm until
 * `business_settings.enabled_modules` lists 'esign'. The engine's CODE_HASHER, ESIGN_STORE,
 * ESIGN_RULES and PDF_ENGINE come from R18's EsignEngineModule; the EsignRepository is a failing
 * stand-in until migration r0_esign adds its tables.
 */
@Module({
  imports: [ModulesModule, EsignEngineModule],
  controllers: [EsignStatusController, EsignRequestsController, EsignDocumentsController],
  providers: [
    EsignRequestsService,
    EsignDocumentsService,
    EsignPrepareService,
    EsignListService,
    { provide: ESIGN_DIRECTORY, useClass: PrismaEsignDirectory },
    { provide: ESIGN_REPOSITORY, useValue: notMigrated<EsignRepository>('EsignRepository') },
  ],
})
export class EsignModule {}
