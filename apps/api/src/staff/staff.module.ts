import { Module } from '@nestjs/common';
import { poolSecrets } from '../auth/sealed.js';
import { SignInModule } from '../auth/sign-in.controller.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig, loadDocumentsConfig } from '../storage/config.js';
import {
  createS3Client,
  DOCUMENT_STORAGE,
  S3DocumentStorage,
} from '../storage/document-storage.js';
import { ScanRouterModule } from '../storage/scan-queue/scan-router.js';
import { StaffActionsService } from './staff-actions.service.js';
import { StaffDocumentsController } from './staff-documents.controller.js';
import { StaffDocumentsService, StaffUploadTokens } from './staff-documents.service.js';
import { StaffDraftsController } from './staff-drafts.controller.js';
import { StaffImportService } from './staff-import.service.js';
import { StaffPermissionsService } from './staff-permissions.service.js';
import { StaffReadService } from './staff-read.service.js';
import { StaffRecordsService } from './staff-records.service.js';
import { StaffScanHandler } from './staff-scan-handler.js';
import { StaffSecurityController } from './staff-security.controller.js';
import { StaffSecurityService } from './staff-security.service.js';
import { StaffWriteController } from './staff-write.controller.js';
import { StaffWriteService } from './staff-write.service.js';
import { StaffController } from './staff.controller.js';

/**
 * Staff Management (R55; contract in packages/types/src/staff): the directory and one member
 * (read), Create and Edit Staff, the account actions, a member's permissions, notes, pay and
 * drafts, Account Access & Security, staff documents and Bulk Upload Staff. Invites and resets go
 * through R2's InvitesService and identity adapter (SignInModule). The documents controller comes
 * first: its static import routes must never meet an ':id' route.
 */
@Module({
  imports: [SignInModule, ScanRouterModule],
  controllers: [
    StaffDocumentsController,
    StaffController,
    StaffWriteController,
    StaffSecurityController,
    StaffDraftsController,
  ],
  providers: [
    StaffReadService,
    StaffWriteService,
    StaffActionsService,
    StaffPermissionsService,
    StaffRecordsService,
    StaffSecurityService,
    StaffDocumentsService,
    StaffScanHandler,
    StaffImportService,
    // The documents bucket and settings, as DocumentsModule builds them (that module exports none).
    { provide: DOCUMENTS_CONFIG, useFactory: () => loadDocumentsConfig() },
    {
      provide: DOCUMENT_STORAGE,
      inject: [DOCUMENTS_CONFIG],
      useFactory: (config: DocumentsConfig) =>
        new S3DocumentStorage(createS3Client(config), config.bucket),
    },
    {
      provide: StaffUploadTokens,
      inject: [ENV],
      useFactory: (env: Env) => new StaffUploadTokens(poolSecrets(env)),
    },
  ],
})
export class StaffModule {}
