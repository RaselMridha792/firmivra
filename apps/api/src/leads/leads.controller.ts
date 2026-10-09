import { Body, Controller, Get, HttpCode, Module, Param, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  DeclineLeadRequest,
  type LeadCounts,
  type LeadDetail,
  LeadId,
  type LeadList,
  ListLeadsQuery,
} from '@firmivra/types';
import { CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { ClientsActor } from '../clients/clients.service.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { LeadsService } from './leads.service.js';

const idPipe = new ZodValidationPipe(LeadId);

function actorOf(auth: AuthContext, tenant: TenantContext): ClientsActor {
  if (tenant.kind !== 'staff') throw new Error('firm routes are for firm members');
  return { userId: auth.userId, role: tenant.role };
}

/** The firm's Begin Online leads (R11 step 4): Owner, Admin and Staff. */
@Controller('business/leads')
@Roles(...FIRM_STAFF)
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(ListLeadsQuery)) q: z.output<typeof ListLeadsQuery>,
  ): Promise<LeadList> {
    return this.leads.list(tenant.businessId, q);
  }

  @Get('count')
  counts(@CurrentTenant() tenant: TenantContext): Promise<LeadCounts> {
    return this.leads.counts(tenant.businessId);
  }

  @Get(':id')
  get(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<LeadDetail> {
    return this.leads.get(tenant.businessId, id);
  }

  @Post(':id/review')
  @HttpCode(200)
  startReview(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<LeadDetail> {
    return this.leads.startReview(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post(':id/decline')
  @HttpCode(200)
  decline(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(DeclineLeadRequest)) body: z.output<typeof DeclineLeadRequest>,
  ): Promise<LeadDetail> {
    return this.leads.decline(tenant.businessId, actorOf(auth, tenant), id, body.reason);
  }
}

@Module({
  controllers: [LeadsController],
  providers: [LeadsService],
})
export class LeadsModule {}
