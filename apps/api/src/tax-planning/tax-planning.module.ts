import { Module } from '@nestjs/common';
import { MessagesModule } from '../messages/messages.module.js';
import { NotificationsModule } from '../notifications/notifications.controller.js';
import { TaxCalculatorService } from './calculator.service.js';
import { MyTaxPlansController } from './my-tax-plans.controller.js';
import { MyTaxPlansService } from './my-tax-plans.service.js';
import { TaxOpportunitiesService } from './opportunities.service.js';
import { TaxOverviewService } from './overview.service.js';
import { TaxPlanReadService } from './plan-read.service.js';
import { ProjectDeadlinesController } from './project-deadlines.controller.js';
import { ProjectDeadlinesService } from './project-deadlines.service.js';
import { TaxPlansService } from './plans.service.js';
import { TaxScreeningService } from './screening.service.js';
import { PlanningStrategiesService } from './strategies.service.js';
import { TaxPlanningController } from './tax-planning.controller.js';

/**
 * The Tax Planning & Strategy module (R55; contract in packages/types/src/tax-planning): the
 * overview and Clients tab, plans with figures, strategies, documents, versions and delivery,
 * the strategy library, the opportunity queue with its review actions and the screening run, the
 * Tax Savings Calculator with saved scenarios, the Tax Calendar and Resources. The tax tables,
 * screening rules and resource catalog live in code (docs/work/R55-tax-planning.md).
 */
@Module({
  imports: [MessagesModule, NotificationsModule],
  // P4-8: the client's own plans in the portal.
  controllers: [TaxPlanningController, ProjectDeadlinesController, MyTaxPlansController],
  providers: [
    TaxPlanReadService,
    TaxPlansService,
    PlanningStrategiesService,
    TaxOpportunitiesService,
    TaxScreeningService,
    TaxCalculatorService,
    TaxOverviewService,
    ProjectDeadlinesService,
    MyTaxPlansService,
  ],
})
export class TaxPlanningModule {}
