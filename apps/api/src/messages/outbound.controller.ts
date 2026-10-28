import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  CancelOutboundRequest,
  CheckOutboundRequest,
  ListOutboundQuery,
  MessageThreadId,
  type OutboundCheck,
  type OutboundMessage,
  type OutboundMessageList,
  SaveOutboundRequest,
  ScheduleOutboundRequest,
  SendOutboundRequest,
  UpdateOutboundRequest,
} from '@firmivra/types';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { actorOf } from './messages.controller.js';
import { OutboundMessagesService } from './outbound.service.js';

const idPipe = new ZodValidationPipe(MessageThreadId);

/** New Message (MSG-F09, F10, F14): drafts, schedules and sends. The firm from TenantGuard. */
@Controller('business/outbound-messages')
@Access('MESSAGES')
@Roles(...FIRM_STAFF)
export class OutboundMessagesController {
  constructor(private readonly outbound: OutboundMessagesService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(ListOutboundQuery)) q: z.output<typeof ListOutboundQuery>,
  ): Promise<OutboundMessageList> {
    return this.outbound.list(tenant.businessId, actorOf(auth, tenant), q);
  }

  // Before ':id', so the literal path wins.
  @Post('check')
  @HttpCode(200)
  check(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CheckOutboundRequest)) body: z.output<typeof CheckOutboundRequest>,
  ): Promise<OutboundCheck> {
    return this.outbound.check(tenant.businessId, actorOf(auth, tenant), body);
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(SaveOutboundRequest)) body: z.output<typeof SaveOutboundRequest>,
  ): Promise<OutboundMessage> {
    return this.outbound.create(tenant.businessId, actorOf(auth, tenant), body);
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<OutboundMessage> {
    return this.outbound.get(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Put(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateOutboundRequest))
    body: z.output<typeof UpdateOutboundRequest>,
  ): Promise<OutboundMessage> {
    return this.outbound.update(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post(':id/send')
  @HttpCode(200)
  send(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(SendOutboundRequest)) body: z.output<typeof SendOutboundRequest>,
  ): Promise<OutboundMessage> {
    return this.outbound.send(tenant.businessId, actorOf(auth, tenant), id, body.version);
  }

  @Post(':id/schedule')
  @HttpCode(200)
  schedule(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ScheduleOutboundRequest))
    body: z.output<typeof ScheduleOutboundRequest>,
  ): Promise<OutboundMessage> {
    return this.outbound.schedule(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(CancelOutboundRequest))
    body: z.output<typeof CancelOutboundRequest>,
  ): Promise<OutboundMessage> {
    return this.outbound.cancel(tenant.businessId, actorOf(auth, tenant), id, body.version);
  }
}
