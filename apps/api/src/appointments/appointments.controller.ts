import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  type Appointment,
  type AppointmentDetail,
  AppointmentId,
  type AppointmentList,
  type SlotList,
} from '@firmivra/types';
import { CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  BookBody,
  CalendarQuery,
  CancelBody,
  FirmSlotsQuery,
  RescheduleBody,
} from './appointments.input.js';
import { AppointmentsService } from './appointments.service.js';
import { firmActor, optionalBody } from './request-actors.js';

const idPipe = new ZodValidationPipe(AppointmentId);

/**
 * The firm's calendar (R12 step 2): Owner, Admin and Staff, with the Staff calendar rule (in
 * full only their own and their assigned clients' appointments; Busy entries otherwise, and 404
 * for anything else about those). The firm comes from TenantGuard.
 */
@Controller('business/appointments')
@Roles(...FIRM_STAFF)
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get()
  async list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(CalendarQuery)) q: z.output<typeof CalendarQuery>,
  ): Promise<AppointmentList> {
    return {
      items: await this.appointments.list(tenant.businessId, firmActor(auth, tenant), q),
    };
  }

  // Before ':id', so "slots" is never read as an id.
  @Get('slots')
  slots(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(FirmSlotsQuery)) q: z.output<typeof FirmSlotsQuery>,
  ): Promise<SlotList> {
    return this.appointments.slots(tenant.businessId, firmActor(auth, tenant), q);
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<AppointmentDetail> {
    return this.appointments.get(tenant.businessId, firmActor(auth, tenant), id);
  }

  @Post()
  book(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(BookBody)) body: z.output<typeof BookBody>,
  ): Promise<Appointment> {
    return this.appointments.book(tenant.businessId, firmActor(auth, tenant), body);
  }

  @Post(':id/reschedule')
  @HttpCode(200)
  reschedule(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(RescheduleBody)) body: z.output<typeof RescheduleBody>,
  ): Promise<Appointment> {
    return this.appointments.reschedule(tenant.businessId, firmActor(auth, tenant), id, body);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(optionalBody(CancelBody)) body: z.output<typeof CancelBody>,
  ): Promise<Appointment> {
    return this.appointments.cancel(tenant.businessId, firmActor(auth, tenant), id, body.reason);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<Appointment> {
    return this.appointments.finish(tenant.businessId, firmActor(auth, tenant), id, 'COMPLETED');
  }

  @Post(':id/no-show')
  @HttpCode(200)
  noShow(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<Appointment> {
    return this.appointments.finish(tenant.businessId, firmActor(auth, tenant), id, 'NO_SHOW');
  }
}
