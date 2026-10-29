import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  type LeadMessage,
  type LeadMessageThreadDetail,
  type LeadMessageThreadList,
  ListLeadMessageThreadsQuery,
  MessageThreadId,
  SendLeadMessageRequest,
} from '@firmivra/types';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { LeadThreadsService } from './lead-threads.service.js';
import { actorOf } from './messages.controller.js';

const idPipe = new ZodValidationPipe(MessageThreadId);

/** Conversations with leads (MSG-F03's Leads tab). The firm comes from TenantGuard. */
@Controller('business/lead-message-threads')
@Access('MESSAGES')
@Roles(...FIRM_STAFF)
export class LeadMessageThreadsController {
  constructor(private readonly threads: LeadThreadsService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(ListLeadMessageThreadsQuery))
    q: z.output<typeof ListLeadMessageThreadsQuery>,
  ): Promise<LeadMessageThreadList> {
    return this.threads.list(tenant.businessId, actorOf(auth, tenant), q);
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<LeadMessageThreadDetail> {
    return this.threads.get(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post(':id/messages')
  send(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(SendLeadMessageRequest))
    body: z.output<typeof SendLeadMessageRequest>,
  ): Promise<LeadMessage> {
    return this.threads.send(tenant.businessId, actorOf(auth, tenant), id, body);
  }
}
