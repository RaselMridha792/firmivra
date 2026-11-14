import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import type { AppointmentDraft, AppointmentDraftList } from '@firmivra/types';
import type { z } from 'zod';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AppointmentDraftsService } from './appointment-drafts.service.js';
import { firmActor } from './request-actors.js';
import { DraftBody, DraftId } from './scheduling.input.js';

/**
 * Save as Draft (R58; Appointments Review 2): each member's own Schedule Appointment drafts, kept
 * in appointment_drafts. Anyone else's draft is 404; scheduling one deletes it
 * (POST /business/appointments/schedule with `draftId`).
 */
@Controller('business/appointment-drafts')
@Access('APPOINTMENTS')
@Roles(...FIRM_STAFF)
export class AppointmentDraftsController {
  constructor(private readonly drafts: AppointmentDraftsService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<AppointmentDraftList> {
    return this.drafts.list(tenant.businessId, firmActor(auth, tenant));
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(DraftId)) id: string,
  ): Promise<AppointmentDraft> {
    return this.drafts.get(tenant.businessId, firmActor(auth, tenant), id);
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(DraftBody)) body: z.output<typeof DraftBody>,
  ): Promise<AppointmentDraft> {
    return this.drafts.create(tenant.businessId, firmActor(auth, tenant), body);
  }

  @Put(':id')
  save(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(DraftId)) id: string,
    @Body(new ZodValidationPipe(DraftBody)) body: z.output<typeof DraftBody>,
  ): Promise<AppointmentDraft> {
    return this.drafts.save(tenant.businessId, firmActor(auth, tenant), id, body);
  }

  @Delete(':id')
  remove(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(DraftId)) id: string,
  ): Promise<{ ok: true }> {
    return this.drafts.remove(tenant.businessId, firmActor(auth, tenant), id);
  }
}
