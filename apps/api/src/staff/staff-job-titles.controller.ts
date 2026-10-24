import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { StaffJobTitle, StaffJobTitleList } from '@firmivra/types';
import type { z } from 'zod';
import { Access, CurrentAuth, CurrentTenant, FIRM_MANAGERS, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SaveStaffJobTitleBody, StaffJobTitleIdParam, StaffJobTitleListQ } from './staff-input.js';
import { StaffJobTitlesService } from './staff-job-titles.service.js';
import { staffActorOf } from './staff.common.js';

type Out<S extends z.ZodType> = z.output<S>;
const idPipe = new ZodValidationPipe(StaffJobTitleIdParam);

/** Staff Settings > Offices & Job Titles: the firm's saved job titles. Owner and Admin. */
@Controller('business/staff-job-titles')
@Access('STAFF_MANAGEMENT')
@Roles(...FIRM_MANAGERS)
export class StaffJobTitlesController {
  constructor(private readonly titles: StaffJobTitlesService) {}

  @Get()
  async list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(StaffJobTitleListQ)) q: Out<typeof StaffJobTitleListQ>,
  ): Promise<StaffJobTitleList> {
    return { items: await this.titles.list(staffActorOf(auth, tenant), q.includeArchived) };
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(SaveStaffJobTitleBody)) body: Out<typeof SaveStaffJobTitleBody>,
  ): Promise<StaffJobTitle> {
    return this.titles.create(staffActorOf(auth, tenant), body);
  }

  @Patch(':id')
  rename(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(SaveStaffJobTitleBody)) body: Out<typeof SaveStaffJobTitleBody>,
  ): Promise<StaffJobTitle> {
    return this.titles.rename(staffActorOf(auth, tenant), id, body);
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<StaffJobTitle> {
    return this.titles.archive(staffActorOf(auth, tenant), id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  restore(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<StaffJobTitle> {
    return this.titles.restore(staffActorOf(auth, tenant), id);
  }
}
