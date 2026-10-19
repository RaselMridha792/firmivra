import { Module } from '@nestjs/common';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { AdminSalesController } from './admin-sales.controller.js';
import { SalesAnalyticsService } from './sales-analytics.service.js';
import { SalesRecordsService } from './sales-records.service.js';
import { SalesSetupService } from './sales-setup.service.js';
import { SalesTargetsService } from './sales-targets.service.js';

/**
 * Super Admin Sales (R60 on R0's B5 and D1): Firmivra selling to prospective firms. The Sales
 * Center, the Sales Pipeline, the opportunity record, the pipeline builder and targets, under
 * /api/v1/admin/sales, in the Super Admin's admin scope.
 */
@Module({
  controllers: [AdminSalesController],
  providers: [
    AdminPrisma,
    SalesRecordsService,
    SalesAnalyticsService,
    SalesSetupService,
    SalesTargetsService,
  ],
})
export class AdminSalesModule {}
