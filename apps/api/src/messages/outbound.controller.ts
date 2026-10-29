import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  CancelOutboundRequest,
  CheckOutboundRequest,
  ConfirmUploadRequest,
  type DownloadLink,
  type OkResponse,
  type OutboundAssigneeList,
  type OutboundFile,
  type OutboundRelatedOptions,
  OutboundRelatedOptionsQuery,
  StartOutboundFileRequest,
  type UploadTicket,
  ListOutboundQuery,
  MessageThreadId,
  type OutboundCheck,
  type OutboundMessage,
  type OutboundMessageList,
  type OutboundReview,
  SaveOutboundRequest,
  ScheduleOutboundRequest,
  SendOutboundRequest,
  UpdateOutboundRequest,
} from '@firmivra/types';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { actorOf } from './messages.controller.js';
import { OutboundFilesService } from './outbound-files.service.js';
import { OutboundMessagesService } from './outbound.service.js';

const idPipe = new ZodValidationPipe(MessageThreadId);

/** New Message (MSG-F09, F10, F14): drafts, schedules and sends. The firm from TenantGuard. */
@Controller('business/outbound-messages')
@Access('MESSAGES')
@Roles(...FIRM_STAFF)
export class OutboundMessagesController {
  constructor(
    private readonly outbound: OutboundMessagesService,
    private readonly files: OutboundFilesService,
  ) {}

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

  /** MSG-F13: the client's records a message can be about. Before ':id'. */
  @Get('related-options')
  relatedOptions(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(OutboundRelatedOptionsQuery))
    q: z.output<typeof OutboundRelatedOptionsQuery>,
  ): Promise<OutboundRelatedOptions> {
    return this.outbound.relatedOptions(tenant.businessId, actorOf(auth, tenant), q.clientId);
  }

  /** MSG-F16: the members who can own the conversations. Before ':id'. */
  @Get('assignees')
  assignees(@CurrentTenant() tenant: TenantContext): Promise<OutboundAssigneeList> {
    return this.outbound.assignees(tenant.businessId);
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

  @Get(':id/review')
  review(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<OutboundReview> {
    return this.outbound.review(tenant.businessId, actorOf(auth, tenant), id);
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
    return this.outbound.send(
      tenant.businessId,
      actorOf(auth, tenant),
      id,
      body.version,
      body.confirmUnresolved === true,
    );
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

  /** MSG-F12: a file for a draft or a scheduled message, step 1. */
  @Post(':id/files/uploads')
  startFile(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(StartOutboundFileRequest))
    body: z.output<typeof StartOutboundFileRequest>,
  ): Promise<UploadTicket> {
    return this.files.ticket(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post(':id/files/uploads/confirm')
  confirmFile(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ConfirmUploadRequest)) body: z.output<typeof ConfirmUploadRequest>,
  ): Promise<OutboundFile> {
    return this.files.confirm(tenant.businessId, actorOf(auth, tenant), id, body.uploadToken);
  }

  @Delete(':id/files/:fileId')
  removeFile(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('fileId', idPipe) fileId: string,
  ): Promise<OkResponse> {
    return this.files.remove(tenant.businessId, actorOf(auth, tenant), id, fileId);
  }
}

/** MSG-F12: a file New Message sent, opened from a conversation or the message. */
@Controller('business/message-files')
@Access('MESSAGES')
@Roles(...FIRM_STAFF)
export class MessageFilesController {
  constructor(private readonly files: OutboundFilesService) {}

  @Get(':id/download')
  download(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<DownloadLink> {
    return this.files.firmDownload(tenant.businessId, actorOf(auth, tenant), id);
  }
}
