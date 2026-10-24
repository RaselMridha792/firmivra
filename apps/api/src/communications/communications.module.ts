import { Module } from '@nestjs/common';
import { poolSecrets } from '../auth/sealed.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { ReportsModule } from '../reports/reports.module.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig, loadDocumentsConfig } from '../storage/config.js';
import {
  createS3Client,
  DOCUMENT_STORAGE,
  S3DocumentStorage,
} from '../storage/document-storage.js';
import { TemplatesModule } from '../templates/templates.module.js';
import {
  CommunicationExtrasService,
  CommunicationUploadTokens,
} from './communications-extras.service.js';
import {
  COMMUNICATION_PROVIDERS,
  CommunicationProviders,
  LocalLogProvider,
} from './communications-provider.js';
import { CommunicationAudienceService } from './communications-audience.service.js';
import { CommunicationDelivery } from './communications-delivery.service.js';
import { CommunicationResultsService } from './communications-results.service.js';
import { CommunicationSegmentsService } from './communications-segments.service.js';
import { CommunicationsController } from './communications.controller.js';
import { CommunicationsService } from './communications.service.js';

/**
 * The Communications module (R55; contract in packages/types/src/communications): segments and
 * lists, consent, the composer's drafts, the audience, review, send and schedule, results, and the
 * delivery job with the provider events. Results are exported as CSV through the Reports module's
 * file store (tenant/<business>/reports/).
 */
@Module({
  imports: [ReportsModule, TemplatesModule],
  controllers: [CommunicationsController],
  providers: [
    CommunicationSegmentsService,
    CommunicationAudienceService,
    CommunicationsService,
    CommunicationResultsService,
    CommunicationExtrasService,
    CommunicationDelivery,
    // The documents bucket and settings, as DocumentsModule builds them (that module exports none).
    { provide: DOCUMENTS_CONFIG, useFactory: () => loadDocumentsConfig() },
    {
      provide: DOCUMENT_STORAGE,
      inject: [DOCUMENTS_CONFIG],
      useFactory: (config: DocumentsConfig) =>
        new S3DocumentStorage(createS3Client(config), config.bucket),
    },
    {
      provide: CommunicationUploadTokens,
      inject: [ENV],
      useFactory: (env: Env) => new CommunicationUploadTokens(poolSecrets(env)),
    },
    CommunicationProviders,
    {
      // No adapter ships yet for Gmail, Outlook or Textmagic: until one is registered here, those
      // channels answer "not available yet". In local development a stand-in accepts everything.
      provide: COMMUNICATION_PROVIDERS,
      useFactory: () =>
        process.env.AUTH_MODE === 'local' && process.env.NODE_ENV === 'development'
          ? [
              new LocalLogProvider('gmail', 'EMAIL'),
              new LocalLogProvider('outlook', 'EMAIL'),
              new LocalLogProvider('textmagic', 'SMS'),
            ]
          : [],
    },
  ],
  // CommunicationsService: the Leads page's campaigns (L7).
  exports: [CommunicationDelivery, CommunicationsService],
})
export class CommunicationsModule {}
