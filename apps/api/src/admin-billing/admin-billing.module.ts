import { Module } from '@nestjs/common';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { AdminBillingController } from './admin-billing.controller.js';
import { BillingSettingsService } from './billing-settings.service.js';
import { BillingService } from './billing.service.js';

/**
 * Super Admin Billing (R60 on R0's B3): Firmivra bills firms. Invoices, payments and refunds,
 * credit notes, estimates, recurring schedules, the firms' billing profiles and Billing Settings,
 * under /api/v1/admin/billing, in the Super Admin's admin scope.
 */
@Module({
  controllers: [AdminBillingController],
  providers: [AdminPrisma, BillingService, BillingSettingsService],
})
export class AdminBillingModule {}
