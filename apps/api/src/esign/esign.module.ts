import { Module } from '@nestjs/common';
import { ModulesModule } from '../common/modules/requires-module.js';
import {
  CODE_HASHER,
  type CodeHasher,
  ESIGN_STORE,
  type EsignStore,
} from './engine/engine.types.js';
import { ESIGN_DIRECTORY, PrismaEsignDirectory } from './requests/esign-directory.js';
import {
  ESIGN_REPOSITORY,
  type EsignRepository,
  notMigrated,
} from './requests/esign.repository.js';
import { EsignRequestsController, EsignStatusController } from './requests/requests.controller.js';
import { EsignRequestsService } from './requests/requests.service.js';

/**
 * Firm Sign (R13). Behind the firm's 'esign' module (ModulesModule), which is off for every firm
 * until migration r0_esign: then the stand-ins below give way to the Prisma EsignRepository, and
 * CODE_HASHER and ESIGN_STORE come from R18's EsignEngineModule.
 */
@Module({
  imports: [ModulesModule],
  controllers: [EsignStatusController, EsignRequestsController],
  providers: [
    EsignRequestsService,
    { provide: ESIGN_DIRECTORY, useClass: PrismaEsignDirectory },
    { provide: ESIGN_REPOSITORY, useValue: notMigrated<EsignRepository>('EsignRepository') },
    { provide: CODE_HASHER, useValue: notMigrated<CodeHasher>('CodeHasher') },
    { provide: ESIGN_STORE, useValue: notMigrated<EsignStore>('EsignStore') },
  ],
})
export class EsignModule {}
