import { Module } from '@nestjs/common';
import { DOCUMENTS_CONFIG, type DocumentsConfig, loadDocumentsConfig } from '../storage/config.js';
import {
  createS3Client,
  DOCUMENT_STORAGE,
  type DocumentStorage,
  S3DocumentStorage,
} from '../storage/document-storage.js';
import { REPORT_FILES, S3ReportFiles } from './report-files.js';
import { ReportsController } from './reports.controller.js';
import { ReportsExportService } from './reports-export.service.js';
import { ReportsSavedService } from './reports-saved.service.js';
import { ReportsSchedulesService } from './reports-schedules.service.js';
import { ReportsService } from './reports.service.js';

/**
 * The Reports module (R55; contract in packages/types/src/reports): the dashboard, one run path
 * for quick reports, saved reports and the builder, saved reports, CSV exports as runs with a
 * download link, scheduled reports and the firm's metric settings. Report files live under
 * tenant/<business>/reports/ in the documents bucket.
 */
@Module({
  controllers: [ReportsController],
  providers: [
    ReportsService,
    ReportsSavedService,
    ReportsSchedulesService,
    ReportsExportService,
    // The documents bucket and settings, as DocumentsModule builds them (that module exports none).
    { provide: DOCUMENTS_CONFIG, useFactory: () => loadDocumentsConfig() },
    {
      provide: DOCUMENT_STORAGE,
      inject: [DOCUMENTS_CONFIG],
      useFactory: (config: DocumentsConfig) =>
        new S3DocumentStorage(createS3Client(config), config.bucket),
    },
    {
      provide: REPORT_FILES,
      inject: [DOCUMENTS_CONFIG, DOCUMENT_STORAGE],
      useFactory: (config: DocumentsConfig, storage: DocumentStorage) =>
        new S3ReportFiles(createS3Client(config), config.bucket, storage),
    },
  ],
  exports: [ReportsService],
})
export class ReportsModule {}
