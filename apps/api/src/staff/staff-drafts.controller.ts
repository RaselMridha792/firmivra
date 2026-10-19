import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import type { OkResponse, StaffDraft, StaffDraftList } from '@firmivra/types';
import type { z } from 'zod';
import { Access, CurrentAuth, CurrentTenant, FIRM_MANAGERS, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SaveStaffDraftBody, StaffDraftIdParam } from './staff-input.js';
import { StaffRecordsService } from './staff-records.service.js';
import { staffActorOf } from './staff.common.js';

type Out<S extends z.ZodType> = z.output<S>;
const idPipe = new ZodValidationPipe(StaffDraftIdParam);

/** Create Staff's Save as Draft (R55): no account, no invite, never pay. Owner and Admin. */
@Controller('business/staff-drafts')
@Access('STAFF_MANAGEMENT')
@Roles(...FIRM_MANAGERS)
export class StaffDraftsController {
  constructor(private readonly records: StaffRecordsService) {}

  @Get()
  async list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<StaffDraftList> {
    return { items: await this.records.drafts(staffActorOf(auth, tenant)) };
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<StaffDraft> {
    return this.records.draft(staffActorOf(auth, tenant), id);
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(SaveStaffDraftBody)) body: Out<typeof SaveStaffDraftBody>,
  ): Promise<StaffDraft> {
    return this.records.saveDraft(staffActorOf(auth, tenant), body);
  }

  @Put(':id')
  save(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(SaveStaffDraftBody)) body: Out<typeof SaveStaffDraftBody>,
  ): Promise<StaffDraft> {
    return this.records.saveDraft(staffActorOf(auth, tenant), body, id);
  }

  @Delete(':id')
  remove(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<OkResponse> {
    return this.records.deleteDraft(staffActorOf(auth, tenant), id);
  }
}
