import { Module } from '@nestjs/common';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig, loadDocumentsConfig } from '../storage/config.js';
import {
  createS3Client,
  DOCUMENT_STORAGE,
  S3DocumentStorage,
} from '../storage/document-storage.js';
import {
  AdminFirmDataDownloadsController,
  ClosedFirmDownloadController,
} from './firm-data-downloads.controller.js';
import { FirmDataDownloadsService } from './firm-data-downloads.service.js';

@Module({
  controllers: [AdminFirmDataDownloadsController, ClosedFirmDownloadController],
  providers: [
    AdminPrisma,
    FirmDataDownloadsService,
    { provide: DOCUMENTS_CONFIG, useFactory: () => loadDocumentsConfig() },
    {
      provide: DOCUMENT_STORAGE,
      inject: [DOCUMENTS_CONFIG],
      useFactory: (config: DocumentsConfig) =>
        new S3DocumentStorage(createS3Client(config), config.bucket),
    },
  ],
  exports: [FirmDataDownloadsService],
})
export class FirmDataDownloadsModule {}
