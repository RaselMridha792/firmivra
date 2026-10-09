import { Module } from '@nestjs/common';
import { ModulesModule } from '../common/modules/requires-module.js';
import {
  CODE_HASHER,
  type CodeHasher,
  ESIGN_RULES,
  ESIGN_STORE,
  type EsignStore,
  PDF_ENGINE,
  type PdfEngine,
} from './engine/engine.types.js';
import { esignRules } from './engine/esign-rules.js';
import { EsignDocumentsController } from './requests/documents.controller.js';
import { EsignDocumentsService } from './requests/documents.service.js';
import { ESIGN_DIRECTORY, PrismaEsignDirectory } from './requests/esign-directory.js';
import {
  ESIGN_REPOSITORY,
  type EsignRepository,
  notMigrated,
} from './requests/esign.repository.js';
import { EsignRequestsController, EsignStatusController } from './requests/requests.controller.js';
import { EsignPrepareService } from './requests/prepare.service.js';
import { EsignRequestsService } from './requests/requests.service.js';

/**
 * Firm Sign (R13). Behind the firm's 'esign' module (ModulesModule), which is off for every firm
 * until migration r0_esign: then the stand-ins below give way to the Prisma EsignRepository, and
 * CODE_HASHER, ESIGN_STORE and PDF_ENGINE come from R18's EsignEngineModule.
 */
@Module({
  imports: [ModulesModule],
  controllers: [EsignStatusController, EsignRequestsController, EsignDocumentsController],
  providers: [
    EsignRequestsService,
    EsignDocumentsService,
    EsignPrepareService,
    // R18's pure rules (no clock, no database).
    { provide: ESIGN_RULES, useValue: esignRules },
    { provide: ESIGN_DIRECTORY, useClass: PrismaEsignDirectory },
    { provide: ESIGN_REPOSITORY, useValue: notMigrated<EsignRepository>('EsignRepository') },
    { provide: CODE_HASHER, useValue: notMigrated<CodeHasher>('CodeHasher') },
    { provide: ESIGN_STORE, useValue: notMigrated<EsignStore>('EsignStore') },
    { provide: PDF_ENGINE, useValue: notMigrated<PdfEngine>('PdfEngine') },
  ],
})
export class EsignModule {}
