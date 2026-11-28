import { Module } from '@nestjs/common';
import { poolSecrets } from '../auth/sealed.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig, loadDocumentsConfig } from '../storage/config.js';
import {
  createS3Client,
  DOCUMENT_STORAGE,
  S3DocumentStorage,
} from '../storage/document-storage.js';
import { MessagesModule } from '../messages/messages.module.js';
import { NotificationsModule } from '../notifications/notifications.controller.js';
import { ReportsModule } from '../reports/reports.module.js';
import { AdvisoryActionsService } from './advisory-actions.service.js';
import { AdvisoryClientsService } from './advisory-clients.service.js';
import { AdvisoryFinancialsService } from './advisory-financials.service.js';
import { AdvisoryGoalsService } from './advisory-goals.service.js';
import { AdvisoryOverviewService } from './advisory-overview.service.js';
import { AdvisoryPlansService } from './advisory-plans.service.js';
import { AdvisoryReadService } from './advisory-read.service.js';
import { AdvisoryReportsService } from './advisory-reports.service.js';
import {
  AdvisoryResourcesService,
  AdvisoryResourceUploadTokens,
} from './advisory-resources.service.js';
import { AdvisoryController } from './advisory.controller.js';
import { MyAdvisoryController } from './my-advisory.controller.js';
import { MyAdvisoryService } from './my-advisory.service.js';

/**
 * The Business Advisory & Development module (R55; contract in packages/types/src/advisory): the
 * overview and Advisory Clients tab, client detail with the Business Health Score, services,
 * business plans in five stages with immutable versions and delivery, financial snapshots, goals
 * and milestones, recommendations and action items, meetings, the resource library, settings and
 * the Reports tab's counts. BA-CP: the client's own read-only view in the portal (My Services),
 * where the client approves a plan sent for approval (B10).
 */
@Module({
  imports: [MessagesModule, NotificationsModule, ReportsModule],
  controllers: [AdvisoryController, MyAdvisoryController],
  providers: [
    AdvisoryReadService,
    AdvisoryClientsService,
    AdvisoryPlansService,
    AdvisoryFinancialsService,
    AdvisoryGoalsService,
    AdvisoryActionsService,
    AdvisoryOverviewService,
    AdvisoryReportsService,
    MyAdvisoryService,
    // A-X10 (Q28): the firm's own resources and their files (the advisory-resources prefix).
    AdvisoryResourcesService,
    { provide: DOCUMENTS_CONFIG, useFactory: () => loadDocumentsConfig() },
    {
      provide: DOCUMENT_STORAGE,
      inject: [DOCUMENTS_CONFIG],
      useFactory: (config: DocumentsConfig) =>
        new S3DocumentStorage(createS3Client(config), config.bucket),
    },
    {
      provide: AdvisoryResourceUploadTokens,
      inject: [ENV],
      useFactory: (env: Env) => new AdvisoryResourceUploadTokens(poolSecrets(env)),
    },
  ],
})
export class AdvisoryModule {}
