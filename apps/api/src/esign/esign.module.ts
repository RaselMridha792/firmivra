import { Module } from '@nestjs/common';
import { PortalInfoModule } from '../client-auth/portal-info.controller.js';
import { ModulesModule } from '../common/modules/requires-module.js';
import { EsignCenterController } from './center/center.controller.js';
import { CENTER_REPOSITORY } from './center/center.repository.js';
import { EsignCenterService } from './center/center.service.js';
import { COMPLETION_REPOSITORY } from './completion/completion.repository.js';
import { EsignCompletionJob } from './completion/completion.job.js';
import { EsignCompletionService } from './completion/completion.service.js';
import { EsignEngineModule } from './engine/engine.module.js';
import { EsignLifecycleController } from './lifecycle/lifecycle.controller.js';
import { EsignLifecycleJob } from './lifecycle/lifecycle.job.js';
import { LIFECYCLE_REPOSITORY } from './lifecycle/lifecycle.repository.js';
import { EsignLifecycleService } from './lifecycle/lifecycle.service.js';
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
import { EsignSendService } from './requests/send.service.js';
import { EsignSettingsController } from './settings/settings.controller.js';
import { SETTINGS_REPOSITORY } from './settings/settings.repository.js';
import { EsignSettingsService } from './settings/settings.service.js';
import { EsignSignerController } from './signer/signer.controller.js';
import { EsignSignerFilesService } from './signer/signer-files.service.js';
import { SIGNER_REPOSITORY } from './signer/signer.repository.js';
import { EsignSignerService } from './signer/signer.service.js';

/**
 * Firm Sign (R13). Behind the firm's 'esign' module (ModulesModule): off for a firm until
 * `business_settings.enabled_modules` lists 'esign'. The engine's CODE_HASHER, ESIGN_STORE,
 * ESIGN_RULES and PDF_ENGINE come from R18's EsignEngineModule; the EsignRepository is a failing
 * stand-in until migration r0_esign adds its tables.
 */
@Module({
  imports: [ModulesModule, EsignEngineModule, PortalInfoModule],
  controllers: [
    EsignStatusController,
    EsignRequestsController,
    EsignDocumentsController,
    EsignSignerController,
    EsignSettingsController,
    EsignCenterController,
    EsignLifecycleController,
  ],
  providers: [
    EsignRequestsService,
    EsignDocumentsService,
    EsignPrepareService,
    EsignListService,
    EsignSendService,
    EsignSignerService,
    EsignSignerFilesService,
    EsignCompletionService,
    EsignCompletionJob,
    EsignSettingsService,
    EsignCenterService,
    { provide: ESIGN_DIRECTORY, useClass: PrismaEsignDirectory },
    { provide: ESIGN_REPOSITORY, useValue: notMigrated<EsignRepository>('EsignRepository') },
    { provide: SIGNER_REPOSITORY, useValue: notMigrated('EsignSignerRepository') },
    { provide: COMPLETION_REPOSITORY, useValue: notMigrated('EsignCompletionRepository') },
    { provide: SETTINGS_REPOSITORY, useValue: notMigrated('EsignSettingsRepository') },
    { provide: CENTER_REPOSITORY, useValue: notMigrated('EsignCenterRepository') },
    EsignLifecycleService,
    EsignLifecycleJob,
    { provide: LIFECYCLE_REPOSITORY, useValue: notMigrated('EsignLifecycleRepository') },
  ],
})
export class EsignModule {}
