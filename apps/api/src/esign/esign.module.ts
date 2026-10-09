import { Module } from '@nestjs/common';
import { ModulesModule } from '../common/modules/requires-module.js';
import { EsignBulkController } from './bulk/bulk.controller.js';
import { EsignBulkJob } from './bulk/bulk.job.js';
import { BULK_REPOSITORY } from './bulk/bulk.repository.js';
import { EsignBulkService } from './bulk/bulk.service.js';
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
import { EsignTemplateCopyService } from './templates/template-copy.service.js';
import { EsignTemplateUseService } from './templates/template-use.service.js';
import {
  EsignTemplateVersionSaveController,
  EsignTemplateVersionsController,
} from './templates/template-versions.controller.js';
import { EsignTemplateVersionsService } from './templates/template-versions.service.js';
import {
  EsignTemplateSaveController,
  EsignTemplatesController,
} from './templates/templates.controller.js';
import { TEMPLATE_REPOSITORY } from './templates/templates.repository.js';
import { EsignTemplatesService } from './templates/templates.service.js';

/**
 * Firm Sign (R13). Behind the firm's 'esign' module (ModulesModule): off for a firm until
 * `business_settings.enabled_modules` lists 'esign'. The engine's CODE_HASHER, ESIGN_STORE,
 * ESIGN_RULES and PDF_ENGINE come from R18's EsignEngineModule; the esign repositories are failing
 * stand-ins until migration r0_esign adds their tables.
 */
@Module({
  imports: [ModulesModule, EsignEngineModule],
  controllers: [
    EsignStatusController,
    EsignRequestsController,
    EsignDocumentsController,
    EsignLifecycleController,
    EsignTemplatesController,
    EsignTemplateSaveController,
    EsignTemplateVersionsController,
    EsignTemplateVersionSaveController,
    EsignBulkController,
  ],
  providers: [
    EsignRequestsService,
    EsignDocumentsService,
    EsignPrepareService,
    EsignListService,
    EsignSendService,
    EsignLifecycleService,
    EsignLifecycleJob,
    EsignTemplatesService,
    EsignTemplateCopyService,
    EsignTemplateUseService,
    EsignTemplateVersionsService,
    EsignBulkService,
    EsignBulkJob,
    { provide: ESIGN_DIRECTORY, useClass: PrismaEsignDirectory },
    { provide: ESIGN_REPOSITORY, useValue: notMigrated<EsignRepository>('EsignRepository') },
    { provide: LIFECYCLE_REPOSITORY, useValue: notMigrated('EsignLifecycleRepository') },
    { provide: TEMPLATE_REPOSITORY, useValue: notMigrated('EsignTemplateRepository') },
    { provide: BULK_REPOSITORY, useValue: notMigrated('EsignBulkRepository') },
  ],
})
export class EsignModule {}
