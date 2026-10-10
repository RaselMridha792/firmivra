import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PortalInfoModule } from '../client-auth/portal-info.controller.js';
import { FieldEncryptionModule } from '../field-encryption/field-encryption.service.js';
import { ModulesModule } from '../common/modules/requires-module.js';
import { EsignBulkController } from './bulk/bulk.controller.js';
import { EsignBulkJob } from './bulk/bulk.job.js';
import { BULK_REPOSITORY } from './bulk/bulk.repository.js';
import { PrismaBulkRepository } from './bulk/prisma-bulk.repository.js';
import { EsignBulkService } from './bulk/bulk.service.js';
import { EsignCenterController } from './center/center.controller.js';
import { CENTER_REPOSITORY } from './center/center.repository.js';
import { PrismaCenterRepository } from './center/prisma-center.repository.js';
import { EsignCenterService } from './center/center.service.js';
import { COMPLETION_REPOSITORY } from './completion/completion.repository.js';
import { PrismaCompletionRepository } from './completion/prisma-completion.repository.js';
import { EsignCompletionJob } from './completion/completion.job.js';
import { EsignCompletionService } from './completion/completion.service.js';
import { EsignEngineModule } from './engine/engine.module.js';
import { EsignApprovalsService } from './extras/approvals.service.js';
import { EsignExtrasController } from './extras/extras.controller.js';
import { EXTRAS_REPOSITORY } from './extras/extras.repository.js';
import { PrismaExtrasRepository } from './extras/prisma-extras.repository.js';
import { EsignInPersonService } from './extras/in-person.service.js';
import {
  EsignKioskInterceptor,
  IdentityKioskAuth,
  KIOSK_AUTH,
  KIOSK_ENDER,
} from './extras/kiosk.js';
import { EsignReportsService } from './extras/reports.service.js';
import { EsignRolesService } from './extras/roles.service.js';
import { EsignLifecycleController } from './lifecycle/lifecycle.controller.js';
import { EsignLifecycleJob } from './lifecycle/lifecycle.job.js';
import { LIFECYCLE_REPOSITORY } from './lifecycle/lifecycle.repository.js';
import { PrismaLifecycleRepository } from './lifecycle/prisma-lifecycle.repository.js';
import { EsignLifecycleService } from './lifecycle/lifecycle.service.js';
import { EsignDocumentsController } from './requests/documents.controller.js';
import { EsignDocumentsService } from './requests/documents.service.js';
import { ESIGN_DIRECTORY, PrismaEsignDirectory } from './requests/esign-directory.js';
import { ESIGN_REPOSITORY } from './requests/esign.repository.js';
import { EsignFieldValues } from './requests/esign-prisma.js';
import { PrismaEsignRepository } from './requests/prisma-esign.repository.js';
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
import { PrismaTemplateRepository } from './templates/prisma-templates.repository.js';
import { EsignTemplatesService } from './templates/templates.service.js';
import { EsignSettingsController } from './settings/settings.controller.js';
import { SETTINGS_REPOSITORY } from './settings/settings.repository.js';
import { PrismaSettingsRepository } from './settings/prisma-settings.repository.js';
import { EsignSettingsService } from './settings/settings.service.js';
import { EsignSignerController } from './signer/signer.controller.js';
import { EsignSignerFilesService } from './signer/signer-files.service.js';
import { SIGNER_REPOSITORY } from './signer/signer.repository.js';
import { PrismaSignerRepository } from './signer/prisma-signer.repository.js';
import { EsignSignerService } from './signer/signer.service.js';

/**
 * Firm Sign (R13). Behind the firm's 'esign' module (ModulesModule): off for a firm until
 * `business_settings.enabled_modules` lists 'esign'. The engine's CODE_HASHER, ESIGN_STORE,
 * ESIGN_RULES and PDF_ENGINE come from R18's EsignEngineModule; the repositories are the Prisma
 * ones over r0_esign's tables, each in the firm's own scope.
 */
@Module({
  imports: [ModulesModule, EsignEngineModule, PortalInfoModule, FieldEncryptionModule],
  controllers: [
    EsignStatusController,
    EsignRequestsController,
    EsignDocumentsController,
    EsignSignerController,
    EsignSettingsController,
    EsignCenterController,
    EsignLifecycleController,
    EsignTemplatesController,
    EsignTemplateSaveController,
    EsignTemplateVersionsController,
    EsignTemplateVersionSaveController,
    EsignBulkController,
    EsignExtrasController,
  ],
  providers: [
    EsignRequestsService,
    EsignDocumentsService,
    EsignPrepareService,
    EsignListService,
    EsignSendService,
    EsignTemplatesService,
    EsignTemplateCopyService,
    EsignTemplateUseService,
    EsignTemplateVersionsService,
    EsignBulkService,
    EsignBulkJob,
    EsignSignerService,
    EsignSignerFilesService,
    EsignCompletionService,
    EsignCompletionJob,
    EsignSettingsService,
    EsignCenterService,
    EsignApprovalsService,
    EsignRolesService,
    EsignReportsService,
    EsignInPersonService,
    { provide: KIOSK_ENDER, useExisting: EsignInPersonService },
    { provide: KIOSK_AUTH, useClass: IdentityKioskAuth },
    // Every staff request: 403 KIOSK_LOCKED while an in-person signing holds the caller's session.
    { provide: APP_INTERCEPTOR, useClass: EsignKioskInterceptor },
    { provide: ESIGN_DIRECTORY, useClass: PrismaEsignDirectory },
    EsignFieldValues,
    { provide: ESIGN_REPOSITORY, useClass: PrismaEsignRepository },
    { provide: SIGNER_REPOSITORY, useClass: PrismaSignerRepository },
    { provide: COMPLETION_REPOSITORY, useClass: PrismaCompletionRepository },
    { provide: SETTINGS_REPOSITORY, useClass: PrismaSettingsRepository },
    { provide: CENTER_REPOSITORY, useClass: PrismaCenterRepository },
    EsignLifecycleService,
    EsignLifecycleJob,
    { provide: LIFECYCLE_REPOSITORY, useClass: PrismaLifecycleRepository },
    { provide: TEMPLATE_REPOSITORY, useClass: PrismaTemplateRepository },
    { provide: BULK_REPOSITORY, useClass: PrismaBulkRepository },
    { provide: EXTRAS_REPOSITORY, useClass: PrismaExtrasRepository },
  ],
})
export class EsignModule {}
