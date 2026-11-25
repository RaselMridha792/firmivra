import { Module } from '@nestjs/common';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { CrmNurtureSender } from './crm-nurture.job.js';
import { CrmController } from './crm.controller.js';
import { CrmService } from './crm.service.js';

/**
 * Super Admin Leads & CRM (Q35): consent and suppression, nurture journeys and demos on the Sales
 * contacts, under /api/v1/admin/crm in the Super Admin's admin scope, and the sender job that
 * sends due journey steps (platform scope).
 */
@Module({
  controllers: [CrmController],
  providers: [AdminPrisma, CrmService, CrmNurtureSender],
})
export class CrmModule {}
