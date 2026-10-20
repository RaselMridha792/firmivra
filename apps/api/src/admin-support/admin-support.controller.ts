import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  AddSupportAttachmentsRequest,
  AddSupportHolidayRequest,
  AssignSupportTicketRequest,
  CreateSupportTicketRequest,
  CreateSupportUploadRequest,
  DeleteSupportTicketQuery,
  EscalateSupportTicketRequest,
  MergeSupportTicketRequest,
  ReplySupportTicketRequest,
  SaveSupportBusinessHoursRequest,
  SaveSupportCannedResponseRequest,
  SaveSupportCategoryRequest,
  SaveSupportPriorityRequest,
  SetSupportActiveRequest,
  SupportAssignmentRules,
  type SupportAttachmentLink,
  SupportAttachmentId,
  type SupportBusinessHours,
  type SupportCannedResponse,
  SupportCannedResponseId,
  type SupportCategory,
  SupportCategoryId,
  type SupportDirectory,
  SupportEscalationRules,
  type SupportHoliday,
  SupportHolidayId,
  type SupportMe,
  SupportNotificationSettings,
  type SupportOk,
  SupportPermissionGrid,
  type SupportPriority,
  SupportPriorityId,
  type SupportSettings,
  type SupportSummary,
  type SupportTicket,
  type SupportTicketDetail,
  SupportTicketId,
  type SupportTicketPage,
  SupportTicketsQuery,
  type UploadTicket,
  UpdateSupportTicketRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SupportFilesService } from './support-files.service.js';
import { SupportSettingsService } from './support-settings.service.js';
import { SupportTicketsService } from './support-tickets.service.js';

type Out<S extends z.ZodType> = z.output<S>;
const id = (schema: z.ZodType = SupportTicketId) => new ZodValidationPipe(schema);

/**
 * Super Admin Support (R60 on R0's B2; contract `packages/types/src/admin-support`), under
 * /api/v1/admin/support: the dashboard (summary, tabs, list, New Ticket), Ticket Detail and
 * Support Settings. Super Admins only; which member may do what is the support permission grid
 * (403 FORBIDDEN). Fixed paths come before `:id`.
 */
@Controller('admin/support')
@Roles('SUPER_ADMIN')
export class AdminSupportController {
  constructor(
    private readonly tickets: SupportTicketsService,
    private readonly settings: SupportSettingsService,
    private readonly files: SupportFilesService,
  ) {}

  @Get('me')
  me(): Promise<SupportMe> {
    return this.tickets.me();
  }

  @Get('directory')
  directory(): Promise<SupportDirectory> {
    return this.tickets.directory();
  }

  @Get('summary')
  summary(): Promise<SupportSummary> {
    return this.tickets.summary();
  }

  @Get('settings')
  readSettings(): Promise<SupportSettings> {
    return this.settings.settings();
  }

  @Post('uploads')
  @HttpCode(200)
  upload(
    @Body(new ZodValidationPipe(CreateSupportUploadRequest))
    body: Out<typeof CreateSupportUploadRequest>,
  ): Promise<UploadTicket> {
    return this.files.ticket(body);
  }

  // ---------- Tickets ----------

  @Get('tickets')
  list(
    @Query(new ZodValidationPipe(SupportTicketsQuery)) query: Out<typeof SupportTicketsQuery>,
  ): Promise<SupportTicketPage> {
    return this.tickets.tickets(query);
  }

  @Post('tickets')
  create(
    @Body(new ZodValidationPipe(CreateSupportTicketRequest))
    body: Out<typeof CreateSupportTicketRequest>,
  ): Promise<SupportTicket> {
    return this.tickets.create(body);
  }

  @Get('tickets/:id')
  get(@Param('id', id()) ticketId: string): Promise<SupportTicketDetail> {
    return this.tickets.ticket(ticketId);
  }

  @Patch('tickets/:id')
  update(
    @Param('id', id()) ticketId: string,
    @Body(new ZodValidationPipe(UpdateSupportTicketRequest))
    body: Out<typeof UpdateSupportTicketRequest>,
  ): Promise<SupportTicket> {
    return this.tickets.update(ticketId, body);
  }

  @Delete('tickets/:id')
  remove(
    @Param('id', id()) ticketId: string,
    @Query(new ZodValidationPipe(DeleteSupportTicketQuery))
    query: Out<typeof DeleteSupportTicketQuery>,
  ): Promise<SupportOk> {
    return this.tickets.remove(ticketId, query.version);
  }

  @Post('tickets/:id/assign')
  @HttpCode(200)
  assign(
    @Param('id', id()) ticketId: string,
    @Body(new ZodValidationPipe(AssignSupportTicketRequest))
    body: Out<typeof AssignSupportTicketRequest>,
  ): Promise<SupportTicket> {
    return this.tickets.assign(ticketId, body);
  }

  @Post('tickets/:id/escalate')
  @HttpCode(200)
  escalate(
    @Param('id', id()) ticketId: string,
    @Body(new ZodValidationPipe(EscalateSupportTicketRequest))
    body: Out<typeof EscalateSupportTicketRequest>,
  ): Promise<SupportTicket> {
    return this.tickets.escalate(ticketId, body);
  }

  @Post('tickets/:id/merge')
  @HttpCode(200)
  merge(
    @Param('id', id()) ticketId: string,
    @Body(new ZodValidationPipe(MergeSupportTicketRequest))
    body: Out<typeof MergeSupportTicketRequest>,
  ): Promise<SupportTicket> {
    return this.tickets.merge(ticketId, body);
  }

  @Post('tickets/:id/replies')
  @HttpCode(200)
  reply(
    @Param('id', id()) ticketId: string,
    @Body(new ZodValidationPipe(ReplySupportTicketRequest))
    body: Out<typeof ReplySupportTicketRequest>,
  ): Promise<SupportTicket> {
    return this.tickets.reply(ticketId, body);
  }

  @Post('tickets/:id/attachments')
  @HttpCode(200)
  attach(
    @Param('id', id()) ticketId: string,
    @Body(new ZodValidationPipe(AddSupportAttachmentsRequest))
    body: Out<typeof AddSupportAttachmentsRequest>,
  ): Promise<SupportTicket> {
    return this.tickets.addAttachments(ticketId, body);
  }

  @Get('tickets/:id/attachments/:attachmentId/download')
  download(
    @Param('id', id()) ticketId: string,
    @Param('attachmentId', id(SupportAttachmentId)) attachmentId: string,
  ): Promise<SupportAttachmentLink> {
    return this.tickets.attachmentLink(ticketId, attachmentId);
  }

  // ---------- Settings ----------

  @Post('settings/categories')
  createCategory(
    @Body(new ZodValidationPipe(SaveSupportCategoryRequest))
    body: Out<typeof SaveSupportCategoryRequest>,
  ): Promise<SupportCategory> {
    return this.settings.saveCategory(undefined, body);
  }

  @Patch('settings/categories/:id')
  updateCategory(
    @Param('id', id(SupportCategoryId)) categoryId: string,
    @Body(new ZodValidationPipe(SaveSupportCategoryRequest))
    body: Out<typeof SaveSupportCategoryRequest>,
  ): Promise<SupportCategory> {
    return this.settings.saveCategory(categoryId, body);
  }

  @Put('settings/categories/:id/active')
  categoryActive(
    @Param('id', id(SupportCategoryId)) categoryId: string,
    @Body(new ZodValidationPipe(SetSupportActiveRequest)) body: Out<typeof SetSupportActiveRequest>,
  ): Promise<SupportCategory> {
    return this.settings.setCategoryActive(categoryId, body.active);
  }

  @Post('settings/priorities')
  createPriority(
    @Body(new ZodValidationPipe(SaveSupportPriorityRequest))
    body: Out<typeof SaveSupportPriorityRequest>,
  ): Promise<SupportPriority> {
    return this.settings.savePriority(undefined, body);
  }

  @Patch('settings/priorities/:id')
  updatePriority(
    @Param('id', id(SupportPriorityId)) priorityId: string,
    @Body(new ZodValidationPipe(SaveSupportPriorityRequest))
    body: Out<typeof SaveSupportPriorityRequest>,
  ): Promise<SupportPriority> {
    return this.settings.savePriority(priorityId, body);
  }

  @Put('settings/priorities/:id/active')
  priorityActive(
    @Param('id', id(SupportPriorityId)) priorityId: string,
    @Body(new ZodValidationPipe(SetSupportActiveRequest)) body: Out<typeof SetSupportActiveRequest>,
  ): Promise<SupportPriority> {
    return this.settings.setPriorityActive(priorityId, body.active);
  }

  @Put('settings/business-hours')
  businessHours(
    @Body(new ZodValidationPipe(SaveSupportBusinessHoursRequest))
    body: Out<typeof SaveSupportBusinessHoursRequest>,
  ): Promise<SupportBusinessHours> {
    return this.settings.saveBusinessHours(body);
  }

  @Post('settings/holidays')
  addHoliday(
    @Body(new ZodValidationPipe(AddSupportHolidayRequest))
    body: Out<typeof AddSupportHolidayRequest>,
  ): Promise<SupportHoliday> {
    return this.settings.addHoliday(body);
  }

  @Delete('settings/holidays/:id')
  removeHoliday(@Param('id', id(SupportHolidayId)) holidayId: string): Promise<SupportOk> {
    return this.settings.removeHoliday(holidayId);
  }

  @Put('settings/assignment')
  assignment(
    @Body(new ZodValidationPipe(SupportAssignmentRules)) body: Out<typeof SupportAssignmentRules>,
  ): Promise<SupportAssignmentRules> {
    return this.settings.saveAssignment(body);
  }

  @Put('settings/escalation')
  escalation(
    @Body(new ZodValidationPipe(SupportEscalationRules)) body: Out<typeof SupportEscalationRules>,
  ): Promise<SupportEscalationRules> {
    return this.settings.saveEscalation(body);
  }

  @Post('settings/canned-responses')
  createCanned(
    @Body(new ZodValidationPipe(SaveSupportCannedResponseRequest))
    body: Out<typeof SaveSupportCannedResponseRequest>,
  ): Promise<SupportCannedResponse> {
    return this.settings.saveCanned(undefined, body);
  }

  @Patch('settings/canned-responses/:id')
  updateCanned(
    @Param('id', id(SupportCannedResponseId)) cannedId: string,
    @Body(new ZodValidationPipe(SaveSupportCannedResponseRequest))
    body: Out<typeof SaveSupportCannedResponseRequest>,
  ): Promise<SupportCannedResponse> {
    return this.settings.saveCanned(cannedId, body);
  }

  @Put('settings/canned-responses/:id/active')
  cannedActive(
    @Param('id', id(SupportCannedResponseId)) cannedId: string,
    @Body(new ZodValidationPipe(SetSupportActiveRequest)) body: Out<typeof SetSupportActiveRequest>,
  ): Promise<SupportCannedResponse> {
    return this.settings.setCannedActive(cannedId, body.active);
  }

  @Put('settings/notifications')
  notifications(
    @Body(new ZodValidationPipe(SupportNotificationSettings))
    body: Out<typeof SupportNotificationSettings>,
  ): Promise<SupportNotificationSettings> {
    return this.settings.saveNotifications(body);
  }

  @Put('settings/permissions')
  permissions(
    @Body(new ZodValidationPipe(SupportPermissionGrid)) body: Out<typeof SupportPermissionGrid>,
  ): Promise<SupportPermissionGrid> {
    return this.settings.savePermissions(body);
  }
}
