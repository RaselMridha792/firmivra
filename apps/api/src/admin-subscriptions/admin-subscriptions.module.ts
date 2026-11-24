import { Module } from '@nestjs/common';
import { AdminBillingModule } from '../admin-billing/admin-billing.module.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { AdminSubscriptionsController } from './admin-subscriptions.controller.js';
import { SubscriptionsChangeService } from './subscriptions-changes.service.js';
import { SubscriptionsReadService } from './subscriptions-reads.service.js';

/**
 * Super Admin Subscriptions (R60 on R0's stage A, B3 and the MRR rollup): Firmivra's plans for
 * firms. The KPI row, the table, the detail panel and its changes, under
 * /api/v1/admin/subscriptions, in the Super Admin's admin scope. A subscription is billed through
 * Billing (its service: invoices, credit notes and the recurring schedule).
 */
@Module({
  imports: [AdminBillingModule],
  controllers: [AdminSubscriptionsController],
  providers: [AdminPrisma, SubscriptionsReadService, SubscriptionsChangeService],
})
export class AdminSubscriptionsModule {}
