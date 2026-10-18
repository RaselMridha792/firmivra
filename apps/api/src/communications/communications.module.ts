import { Module } from '@nestjs/common';
import { ReportsModule } from '../reports/reports.module.js';
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
  imports: [ReportsModule],
  controllers: [CommunicationsController],
  providers: [
    CommunicationSegmentsService,
    CommunicationAudienceService,
    CommunicationsService,
    CommunicationResultsService,
    CommunicationDelivery,
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
  exports: [CommunicationDelivery],
})
export class CommunicationsModule {}
