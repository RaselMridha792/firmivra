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
import type { z } from 'zod';
import {
  AddLeadNoteRequest,
  BulkConvertLeadsRequest,
  type BulkConvertLeadsResult,
  CompleteFollowUpRequest,
  ConfirmUploadRequest,
  ConvertLeadToClientRequest,
  type ConvertLeadToClientResult,
  CreateLeadFileRequest,
  CreateLeadTaskRequest,
  type LeadDocument,
  type OkResponse,
  type UploadTicket,
  type LeadActivity,
  LeadActivityQuery,
  type LeadActivityPage,
  type LeadAppointment,
  type LeadDocumentsAndForms,
  LeadId,
  type LeadNote,
  type LeadProfile,
  type LeadTask,
  LogLeadActivityRequest,
  SetFollowUpRequest,
  UpdateLeadTaskRequest,
} from '@firmivra/types';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import { type AuthContext, legacyFirmRole, type TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { LeadConvertService } from './lead-convert.service.js';
import { LeadFilesService } from './lead-files.service.js';
import { pipelineActor } from './lead-pipeline.controller.js';
import { LeadPipelineTabsService } from './lead-pipeline-tabs.service.js';

const idPipe = new ZodValidationPipe(LeadId);

/** The Lead Profile's tabs, follow-ups and Convert Lead to Client (R57 part 2). */
@Controller('business/leads')
@Access('LEADS')
@Roles(...FIRM_STAFF)
export class LeadPipelineTabsController {
  constructor(
    private readonly tabs: LeadPipelineTabsService,
    private readonly converts: LeadConvertService,
    private readonly files: LeadFilesService,
  ) {}

  /** R2 4: step 1 of adding a file to the lead. */
  @Post(':id/files')
  @HttpCode(200)
  createFile(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(CreateLeadFileRequest))
    body: z.output<typeof CreateLeadFileRequest>,
  ): Promise<UploadTicket> {
    return this.files.ticket(tenant.businessId, pipelineActor(auth, tenant), id, body);
  }

  /** R2 4: step 3, after the browser's PUT. */
  @Post(':id/files/confirm')
  @HttpCode(200)
  confirmFile(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ConfirmUploadRequest)) body: z.output<typeof ConfirmUploadRequest>,
  ): Promise<LeadDocument> {
    return this.files.confirm(tenant.businessId, pipelineActor(auth, tenant), id, body.uploadToken);
  }

  @Delete(':id/files/:fileId')
  removeFile(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('fileId', idPipe) fileId: string,
  ): Promise<OkResponse> {
    return this.files.remove(tenant.businessId, pipelineActor(auth, tenant), id, fileId);
  }

  @Put(':id/follow-up')
  setFollowUp(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(SetFollowUpRequest)) body: z.output<typeof SetFollowUpRequest>,
  ): Promise<LeadProfile> {
    return this.tabs.setFollowUp(tenant.businessId, pipelineActor(auth, tenant), id, body);
  }

  @Post(':id/follow-up/complete')
  @HttpCode(200)
  completeFollowUp(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(CompleteFollowUpRequest))
    body: z.output<typeof CompleteFollowUpRequest>,
  ): Promise<LeadProfile> {
    return this.tabs.completeFollowUp(tenant.businessId, pipelineActor(auth, tenant), id, body);
  }

  @Get(':id/activity')
  activity(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Query(new ZodValidationPipe(LeadActivityQuery)) q: z.output<typeof LeadActivityQuery>,
  ): Promise<LeadActivityPage> {
    return this.tabs.activity(tenant.businessId, pipelineActor(auth, tenant), id, q);
  }

  @Post(':id/activity')
  logActivity(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(LogLeadActivityRequest))
    body: z.output<typeof LogLeadActivityRequest>,
  ): Promise<LeadActivity> {
    return this.tabs.logActivity(tenant.businessId, pipelineActor(auth, tenant), id, body);
  }

  @Get(':id/notes')
  async notes(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<{ items: LeadNote[] }> {
    return { items: await this.tabs.notes(tenant.businessId, pipelineActor(auth, tenant), id) };
  }

  @Post(':id/notes')
  addNote(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(AddLeadNoteRequest)) body: z.output<typeof AddLeadNoteRequest>,
  ): Promise<LeadNote> {
    return this.tabs.addNote(tenant.businessId, pipelineActor(auth, tenant), id, body);
  }

  @Get(':id/tasks')
  async tasks(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<{ items: LeadTask[] }> {
    return { items: await this.tabs.tasks(tenant.businessId, pipelineActor(auth, tenant), id) };
  }

  @Post(':id/tasks')
  createTask(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(CreateLeadTaskRequest))
    body: z.output<typeof CreateLeadTaskRequest>,
  ): Promise<LeadTask> {
    return this.tabs.createTask(tenant.businessId, pipelineActor(auth, tenant), id, body);
  }

  @Patch(':id/tasks/:taskId')
  updateTask(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('taskId', idPipe) taskId: string,
    @Body(new ZodValidationPipe(UpdateLeadTaskRequest))
    body: z.output<typeof UpdateLeadTaskRequest>,
  ): Promise<LeadTask> {
    return this.tabs.updateTask(tenant.businessId, pipelineActor(auth, tenant), id, taskId, body);
  }

  @Get(':id/appointments')
  async appointments(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<{ items: LeadAppointment[] }> {
    return {
      items: await this.tabs.appointments(tenant.businessId, pipelineActor(auth, tenant), id),
    };
  }

  @Get(':id/documents-and-forms')
  documentsAndForms(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<LeadDocumentsAndForms> {
    return this.tabs.documentsAndForms(tenant.businessId, pipelineActor(auth, tenant), id);
  }

  /** Convert to Client from the bulk bar (L12): each lead converted or skipped with the reason. */
  @Post('bulk-convert')
  @HttpCode(200)
  bulkConvert(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(BulkConvertLeadsRequest))
    body: z.output<typeof BulkConvertLeadsRequest>,
  ): Promise<BulkConvertLeadsResult> {
    return this.converts.convertMany(tenant.businessId, pipelineActor(auth, tenant), body);
  }

  @Post(':id/convert-to-client')
  @HttpCode(200)
  convertToClient(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ConvertLeadToClientRequest))
    body: z.output<typeof ConvertLeadToClientRequest>,
  ): Promise<ConvertLeadToClientResult> {
    const actor = pipelineActor(auth, tenant);
    return this.converts.convertToClient(
      tenant.businessId,
      { userId: actor.userId, role: legacyFirmRole(actor.role) },
      id,
      body,
    );
  }
}
