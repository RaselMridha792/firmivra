import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { StaffWorkSchedule, StaffWorkScheduleList } from '@firmivra/types';
import type { z } from 'zod';
import { Access, CurrentAuth, CurrentTenant, FIRM_MANAGERS, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  SaveStaffWorkScheduleBody,
  StaffWorkScheduleIdParam,
  StaffWorkScheduleListQ,
} from './staff-input.js';
import { StaffWorkSchedulesService } from './staff-work-schedules.service.js';
import { staffActorOf } from './staff.common.js';

type Out<S extends z.ZodType> = z.output<S>;
const idPipe = new ZodValidationPipe(StaffWorkScheduleIdParam);

/** Staff Settings > Offices & Job Titles: the firm's saved work schedules. Owner and Admin. */
@Controller('business/staff-work-schedules')
@Access('STAFF_MANAGEMENT')
@Roles(...FIRM_MANAGERS)
export class StaffWorkSchedulesController {
  constructor(private readonly schedules: StaffWorkSchedulesService) {}

  @Get()
  async list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(StaffWorkScheduleListQ)) q: Out<typeof StaffWorkScheduleListQ>,
  ): Promise<StaffWorkScheduleList> {
    return { items: await this.schedules.list(staffActorOf(auth, tenant), q.includeArchived) };
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(SaveStaffWorkScheduleBody))
    body: Out<typeof SaveStaffWorkScheduleBody>,
  ): Promise<StaffWorkSchedule> {
    return this.schedules.create(staffActorOf(auth, tenant), body);
  }

  @Patch(':id')
  rename(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(SaveStaffWorkScheduleBody))
    body: Out<typeof SaveStaffWorkScheduleBody>,
  ): Promise<StaffWorkSchedule> {
    return this.schedules.rename(staffActorOf(auth, tenant), id, body);
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<StaffWorkSchedule> {
    return this.schedules.archive(staffActorOf(auth, tenant), id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  restore(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<StaffWorkSchedule> {
    return this.schedules.restore(staffActorOf(auth, tenant), id);
  }
}
