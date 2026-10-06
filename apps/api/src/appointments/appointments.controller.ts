import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Param,
  Query,
  Body,
  HttpCode,
  Module,
} from '@nestjs/common';
import { z } from 'zod';
import * as DTO from '@firmivra/types';
import { Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AppointmentsService } from './appointments.service.js';
import { AppointmentJobs } from './appointment-jobs.service.js';
import { AppointmentNotifier, PendingAppointmentNotifier } from './appointment.ports.js';
const idPipe = () => new ZodValidationPipe(z.uuid());
@Controller('business')
@Roles('OWNER', 'ADMIN', 'STAFF')
export class FirmAppointmentsController {
  constructor(private readonly calendar: AppointmentsService) {}
  @Get('appointment-types') types() {
    return this.calendar.types();
  }
  @Post('appointment-types') @Roles('OWNER', 'ADMIN') createType(
    @Body(new ZodValidationPipe(DTO.CreateAppointmentTypeRequest))
    body: z.output<typeof DTO.CreateAppointmentTypeRequest>,
  ) {
    return this.calendar.createType(body);
  }
  @Patch('appointment-types/:id') @Roles('OWNER', 'ADMIN') updateType(
    @Param('id', idPipe()) id: string,
    @Body(new ZodValidationPipe(DTO.UpdateAppointmentTypeRequest))
    body: z.output<typeof DTO.UpdateAppointmentTypeRequest>,
  ) {
    return this.calendar.updateType(id, body);
  }
  @Get('working-hours/:providerId') hours(@Param('providerId', idPipe()) id: string) {
    return this.calendar.workingHours(id);
  }
  @Put('working-hours/:providerId') saveHours(
    @Param('providerId', idPipe()) id: string,
    @Body(new ZodValidationPipe(DTO.ReplaceProviderWorkingHoursRequest))
    body: z.output<typeof DTO.ReplaceProviderWorkingHoursRequest>,
  ) {
    return this.calendar.saveHours(id, body.items);
  }
  @Get('blocked-time') blocks(
    @Query(new ZodValidationPipe(DTO.ListProviderBlockedTimeQuery))
    query: z.output<typeof DTO.ListProviderBlockedTimeQuery>,
  ) {
    return this.calendar.blocked(query);
  }
  @Post('blocked-time') createBlock(
    @Body(new ZodValidationPipe(DTO.CreateProviderBlockedTimeRequest))
    body: z.output<typeof DTO.CreateProviderBlockedTimeRequest>,
  ) {
    return this.calendar.createBlock(body);
  }
  @Delete('blocked-time/:id') removeBlock(@Param('id', idPipe()) id: string) {
    return this.calendar.removeBlock(id);
  }
  @Get('appointment-providers') providers(
    @Query(new ZodValidationPipe(DTO.ListFirmAppointmentProvidersQuery))
    query: z.output<typeof DTO.ListFirmAppointmentProvidersQuery>,
  ) {
    return this.calendar.providers(query);
  }
  @Get('appointments/availability') availability(
    @Query(new ZodValidationPipe(DTO.ListFirmAvailableSlotsQuery))
    query: z.output<typeof DTO.ListFirmAvailableSlotsQuery>,
  ) {
    return this.calendar.availability(query);
  }
  @Get('appointments') list(
    @Query(new ZodValidationPipe(DTO.ListFirmAppointmentsQuery))
    query: z.output<typeof DTO.ListFirmAppointmentsQuery>,
  ) {
    return this.calendar.list(query);
  }
  @Post('appointments') book(
    @Body(new ZodValidationPipe(DTO.BookFirmAppointmentRequest))
    body: z.output<typeof DTO.BookFirmAppointmentRequest>,
  ) {
    return this.calendar.book(body);
  }
  @Get('appointments/:id') detail(@Param('id', idPipe()) id: string) {
    return this.calendar.detail(id);
  }
  @Patch('appointments/:id') details(
    @Param('id', idPipe()) id: string,
    @Body(new ZodValidationPipe(DTO.UpdateFirmAppointmentDetailsRequest))
    body: z.output<typeof DTO.UpdateFirmAppointmentDetailsRequest>,
  ) {
    return this.calendar.change(id, body, 'DETAILS_UPDATED');
  }
  @Post('appointments/:id/reschedule') @HttpCode(200) reschedule(
    @Param('id', idPipe()) id: string,
    @Body(new ZodValidationPipe(DTO.RescheduleFirmAppointmentRequest))
    body: z.output<typeof DTO.RescheduleFirmAppointmentRequest>,
  ) {
    return this.calendar.change(id, body, 'RESCHEDULED');
  }
  @Post('appointments/:id/cancel') @HttpCode(200) cancel(
    @Param('id', idPipe()) id: string,
    @Body(new ZodValidationPipe(DTO.CancelFirmAppointmentRequest))
    body: z.output<typeof DTO.CancelFirmAppointmentRequest>,
  ) {
    return this.calendar.change(id, body, 'CANCELLED');
  }
  @Get('appointments/:id/history') history(
    @Param('id', idPipe()) id: string,
    @Query(new ZodValidationPipe(DTO.ListFirmAppointmentHistoryQuery))
    query: z.output<typeof DTO.ListFirmAppointmentHistoryQuery>,
  ) {
    return this.calendar.history(id, query);
  }
}
@Controller('portal/:slug')
@Roles('CLIENT')
export class PortalAppointmentsController {
  constructor(private readonly calendar: AppointmentsService) {}
  @Get('appointment-types') types() {
    return this.calendar.types();
  }
  @Get('appointment-providers') providers(
    @Query(new ZodValidationPipe(DTO.ListPortalAppointmentProvidersQuery))
    query: z.output<typeof DTO.ListPortalAppointmentProvidersQuery>,
  ) {
    return this.calendar.providers(query);
  }
  @Get('appointments/availability') availability(
    @Query(new ZodValidationPipe(DTO.ListPortalAvailableSlotsQuery))
    query: z.output<typeof DTO.ListPortalAvailableSlotsQuery>,
  ) {
    return this.calendar.availability(query);
  }
  @Get('appointments') list(
    @Query(new ZodValidationPipe(DTO.ListPortalAppointmentsQuery))
    query: z.output<typeof DTO.ListPortalAppointmentsQuery>,
  ) {
    return this.calendar.list(query);
  }
  @Post('appointments') book(
    @Body(new ZodValidationPipe(DTO.BookPortalAppointmentRequest))
    body: z.output<typeof DTO.BookPortalAppointmentRequest>,
  ) {
    return this.calendar.book(body);
  }
  @Get('appointments/:id') detail(@Param('id', idPipe()) id: string) {
    return this.calendar.detail(id);
  }
  @Post('appointments/:id/reschedule') @HttpCode(200) reschedule(
    @Param('id', idPipe()) id: string,
    @Body(new ZodValidationPipe(DTO.ReschedulePortalAppointmentRequest))
    body: z.output<typeof DTO.ReschedulePortalAppointmentRequest>,
  ) {
    return this.calendar.change(id, body, 'RESCHEDULED');
  }
  @Post('appointments/:id/cancel') @HttpCode(200) cancel(
    @Param('id', idPipe()) id: string,
    @Body(new ZodValidationPipe(DTO.CancelPortalAppointmentRequest))
    body: z.output<typeof DTO.CancelPortalAppointmentRequest>,
  ) {
    return this.calendar.change(id, body, 'CANCELLED');
  }
  @Get('appointments/:id/history') history(
    @Param('id', idPipe()) id: string,
    @Query(new ZodValidationPipe(DTO.ListPortalAppointmentHistoryQuery))
    query: z.output<typeof DTO.ListPortalAppointmentHistoryQuery>,
  ) {
    return this.calendar.history(id, query);
  }
}
@Module({
  controllers: [FirmAppointmentsController, PortalAppointmentsController],
  providers: [
    AppointmentsService,
    AppointmentJobs,
    { provide: AppointmentNotifier, useClass: PendingAppointmentNotifier },
  ],
  exports: [AppointmentJobs],
})
export class AppointmentsModule {}
