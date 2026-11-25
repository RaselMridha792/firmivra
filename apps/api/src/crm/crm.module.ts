import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller.js';
import { CrmService } from './crm.service.js';

/**
 * Super Admin CRM (Q35): platform acquisition CRM for leads, nurture journeys
 * and demos. Reuses existing SalesContact/SalesOpportunity records.
 * Under /api/v1/admin/crm, in the Super Admin's admin scope.
 */
@Module({
  controllers: [CrmController],
  providers: [CrmService],
})
export class CrmModule {}
