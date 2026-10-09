import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  AppointmentId,
  type BookableTypeList,
  type MyAppointment,
  type MyAppointmentList,
  MyAppointmentsQuery,
  type MySlotList,
} from '@firmivra/types';
import { CurrentTenant, Roles } from '../auth/decorators.js';
import type { TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  BookMineBody,
  CancelMineBody,
  idParam,
  MineSlotsQuery,
  RescheduleMineBody,
} from './appointments.input.js';
import { MyAppointmentsService } from './my-appointments.service.js';
import { optionalBody, portalLogin } from './request-actors.js';

const idPipe = new ZodValidationPipe(idParam(AppointmentId));

/**
 * The signed-in client's appointments at one firm (portal, R12 step 2). The firm comes from the
 * slug and the client from the session (TenantGuard), never from the URL.
 */
@Controller('portal/:firmSlug/me/appointments')
@Roles('CLIENT')
export class MyAppointmentsController {
  constructor(private readonly mine: MyAppointmentsService) {}

  @Get()
  async list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(MyAppointmentsQuery)) q: z.output<typeof MyAppointmentsQuery>,
  ): Promise<MyAppointmentList> {
    const me = portalLogin(tenant);
    return { items: await this.mine.list(me.businessId, me.clientAccountId, q) };
  }

  @Get('types')
  async types(@CurrentTenant() tenant: TenantContext): Promise<BookableTypeList> {
    return { items: await this.mine.types(portalLogin(tenant).businessId) };
  }

  @Get('slots')
  slots(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(MineSlotsQuery)) q: z.output<typeof MineSlotsQuery>,
  ): Promise<MySlotList> {
    const me = portalLogin(tenant);
    return this.mine.slots(me.businessId, me.clientAccountId, q);
  }

  @Post()
  book(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(BookMineBody)) body: z.output<typeof BookMineBody>,
  ): Promise<MyAppointment> {
    const me = portalLogin(tenant);
    return this.mine.book(me.businessId, me.clientAccountId, body);
  }

  @Post(':id/reschedule')
  @HttpCode(200)
  reschedule(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(RescheduleMineBody)) body: z.output<typeof RescheduleMineBody>,
  ): Promise<MyAppointment> {
    const me = portalLogin(tenant);
    return this.mine.reschedule(me.businessId, me.clientAccountId, id, body);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(optionalBody(CancelMineBody)) body: z.output<typeof CancelMineBody>,
  ): Promise<MyAppointment> {
    const me = portalLogin(tenant);
    return this.mine.cancel(me.businessId, me.clientAccountId, id, body.reason);
  }
}
