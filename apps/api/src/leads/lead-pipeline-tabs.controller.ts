import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  AddLeadNoteRequest,
  CompleteFollowUpRequest,
  ConvertLeadToClientRequest,
  type ConvertLeadToClientResult,
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
} from '@firmivra/types';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import { type AuthContext, legacyFirmRole, type TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { LeadConvertService } from './lead-convert.service.js';
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
  ) {}

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
