import { Module } from '@nestjs/common';
import { CommunicationsController } from './communications.controller.js';
import { CommunicationAudienceService } from './communications-audience.service.js';
import { CommunicationsService } from './communications.service.js';
import { CommunicationSegmentsService } from './communications-segments.service.js';

/**
 * The Communications module (R55; contract in packages/types/src/communications): segments and
 * lists, consent, and (in the next steps) the composer, audience, review and send, and results.
 */
@Module({
  controllers: [CommunicationsController],
  providers: [CommunicationSegmentsService, CommunicationAudienceService, CommunicationsService],
})
export class CommunicationsModule {}
