import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ModulesModule } from '../common/modules/requires-module.js';
import { EsignEngineModule } from './engine/engine.module.js';
import { EsignApprovalsService } from './extras/approvals.service.js';
import { EsignExtrasController } from './extras/extras.controller.js';
import { type EsignExtrasRepository, EXTRAS_REPOSITORY } from './extras/extras.repository.js';
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

/**
 * Until r0_esign the extras fail like the other ports, but for the kiosk lock read that every
 * staff request makes: no lock can exist before the tables do, so it answers none.
 */
function extrasStandIn(): EsignExtrasRepository {
  const failing = notMigrated<EsignExtrasRepository>('EsignExtrasRepository');
  return new Proxy(failing, {
    get: (target, method, receiver) =>
      method === 'kioskLock' ? () => Promise.resolve(null) : Reflect.get(target, method, receiver),
  });
}

/**
 * Firm Sign (R13). Behind the firm's 'esign' module (ModulesModule): off for a firm until
 * `business_settings.enabled_modules` lists 'esign'. The engine's CODE_HASHER, ESIGN_STORE,
 * ESIGN_RULES and PDF_ENGINE come from R18's EsignEngineModule; the EsignRepository is a failing
 * stand-in until migration r0_esign adds its tables.
 */
@Module({
  imports: [ModulesModule, EsignEngineModule],
  controllers: [
    EsignStatusController,
    EsignRequestsController,
    EsignDocumentsController,
    EsignLifecycleController,
    EsignExtrasController,
  ],
  providers: [
    EsignRequestsService,
    EsignDocumentsService,
    EsignPrepareService,
    EsignListService,
    EsignSendService,
    EsignLifecycleService,
    EsignLifecycleJob,
    EsignApprovalsService,
    EsignRolesService,
    EsignReportsService,
    EsignInPersonService,
    { provide: KIOSK_ENDER, useExisting: EsignInPersonService },
    { provide: KIOSK_AUTH, useClass: IdentityKioskAuth },
    // Every staff request: 403 KIOSK_LOCKED while an in-person signing holds the caller's session.
    { provide: APP_INTERCEPTOR, useClass: EsignKioskInterceptor },
    { provide: ESIGN_DIRECTORY, useClass: PrismaEsignDirectory },
    { provide: ESIGN_REPOSITORY, useValue: notMigrated<EsignRepository>('EsignRepository') },
    { provide: LIFECYCLE_REPOSITORY, useValue: notMigrated('EsignLifecycleRepository') },
    { provide: EXTRAS_REPOSITORY, useValue: extrasStandIn() },
  ],
})
export class EsignModule {}
