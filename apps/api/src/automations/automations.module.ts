import { Module } from '@nestjs/common';
import { MessagesModule } from '../messages/messages.module.js';
import { NotesService } from '../messages/notes.service.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig, loadDocumentsConfig } from '../storage/config.js';
import {
  createS3Client,
  DOCUMENT_STORAGE,
  type DocumentStorage,
  S3DocumentStorage,
} from '../storage/document-storage.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { AUTOMATION_FILES, S3AutomationFiles } from './automation-files.js';
import { AutomationJob } from './automation.job.js';
import { AutomationsController } from './automations.controller.js';
import { AutomationsReadService } from './automations-read.service.js';
import { AutomationEngine } from './engine.service.js';
import { AutomationsOverviewService } from './overview.service.js';
import { RulesService } from './rules.service.js';
import { RunsService } from './runs.service.js';
import { TemplatesService } from './templates.service.js';

/**
 * The Automations module (R55; contract in packages/types/src/automations): the catalog, rules
 * with immutable versions, dry runs, templates, the run engine and its job, the logs with re-run
 * and export, and the settings. A rule acts through the Tasks, Messages and Notes services.
 * Log exports live under tenant/<business>/automations/ in the documents bucket.
 */
@Module({
  imports: [MessagesModule, TasksModule],
  controllers: [AutomationsController],
  providers: [
    AutomationsReadService,
    AutomationEngine,
    AutomationJob,
    RulesService,
    TemplatesService,
    RunsService,
    AutomationsOverviewService,
    NotesService,
    // The documents bucket and settings, as DocumentsModule builds them (that module exports none).
    { provide: DOCUMENTS_CONFIG, useFactory: () => loadDocumentsConfig() },
    {
      provide: DOCUMENT_STORAGE,
      inject: [DOCUMENTS_CONFIG],
      useFactory: (config: DocumentsConfig) =>
        new S3DocumentStorage(createS3Client(config), config.bucket),
    },
    {
      provide: AUTOMATION_FILES,
      inject: [DOCUMENTS_CONFIG, DOCUMENT_STORAGE],
      useFactory: (config: DocumentsConfig, storage: DocumentStorage) =>
        new S3AutomationFiles(createS3Client(config), config.bucket, storage),
    },
  ],
  exports: [AutomationEngine, AutomationJob],
})
export class AutomationsModule {}
