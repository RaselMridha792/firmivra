import { Module } from '@nestjs/common';
import { poolSecrets } from '../auth/sealed.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig, loadDocumentsConfig } from '../storage/config.js';
import {
  createS3Client,
  DOCUMENT_STORAGE,
  S3DocumentStorage,
} from '../storage/document-storage.js';
import { ScanRouterModule } from '../storage/scan-queue/scan-router.js';
import { AdminSupportController } from './admin-support.controller.js';
import { SupportFilesService, SupportUploadTokens } from './support-files.service.js';
import { SupportSettingsService } from './support-settings.service.js';
import { SupportTicketsService } from './support-tickets.service.js';

/**
 * Super Admin Support (R60 on R0's B2): tickets from firms, Ticket Detail and Support Settings,
 * under /api/v1/admin/support, in the Super Admin's admin scope. Files go to the documents
 * bucket under tenant/{businessId}/support/, scanned through the `support` prefix.
 */
@Module({
  imports: [ScanRouterModule],
  controllers: [AdminSupportController],
  providers: [
    AdminPrisma,
    SupportTicketsService,
    SupportSettingsService,
    SupportFilesService,
    // The documents bucket and settings, as DocumentsModule builds them (that module exports none).
    { provide: DOCUMENTS_CONFIG, useFactory: () => loadDocumentsConfig() },
    {
      provide: DOCUMENT_STORAGE,
      inject: [DOCUMENTS_CONFIG],
      useFactory: (config: DocumentsConfig) =>
        new S3DocumentStorage(createS3Client(config), config.bucket),
    },
    {
      provide: SupportUploadTokens,
      inject: [ENV],
      useFactory: (env: Env) => new SupportUploadTokens(poolSecrets(env)),
    },
  ],
})
export class AdminSupportModule {}
