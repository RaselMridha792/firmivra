import { Module } from '@nestjs/common';
import { MessagesModule } from '../messages/messages.module.js';
import { AdvisoryActionsService } from './advisory-actions.service.js';
import { AdvisoryClientsService } from './advisory-clients.service.js';
import { AdvisoryFinancialsService } from './advisory-financials.service.js';
import { AdvisoryGoalsService } from './advisory-goals.service.js';
import { AdvisoryOverviewService } from './advisory-overview.service.js';
import { AdvisoryPlansService } from './advisory-plans.service.js';
import { AdvisoryReadService } from './advisory-read.service.js';
import { AdvisoryReportsService } from './advisory-reports.service.js';
import { AdvisoryController } from './advisory.controller.js';

/**
 * The Business Advisory & Development module (R55; contract in packages/types/src/advisory): the
 * overview and Advisory Clients tab, client detail with the Business Health Score, services,
 * business plans in five stages with immutable versions and delivery, financial snapshots, goals
 * and milestones, recommendations and action items, meetings, the resource library, settings and
 * the Reports tab's counts.
 */
@Module({
  imports: [MessagesModule],
  controllers: [AdvisoryController],
  providers: [
    AdvisoryReadService,
    AdvisoryClientsService,
    AdvisoryPlansService,
    AdvisoryFinancialsService,
    AdvisoryGoalsService,
    AdvisoryActionsService,
    AdvisoryOverviewService,
    AdvisoryReportsService,
  ],
})
export class AdvisoryModule {}
