import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  type AgendaPage,
  type Appointment,
  type AppointmentContact,
  type AppointmentDraft,
  type AppointmentNoticeSettings,
  type ConflictResult,
  type RemindersSent,
  type AppointmentDetail,
  AppointmentId,
  type AppointmentList,
  type AppointmentRecord,
  type AppointmentsSummary,
  type SchedulingOptions,
  type SlotList,
} from '@firmivra/types';
import {
  Access,
  CurrentAuth,
  CurrentTenant,
  FIRM_MANAGERS,
  FIRM_STAFF,
  Roles,
} from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  BookBody,
  CalendarQuery,
  CancelBody,
  FirmSlotsQuery,
  idParam,
  RescheduleBody,
  UpdateBody,
} from './appointments.input.js';
import { AppointmentsService } from './appointments.service.js';
import { firmActor, optionalBody } from './request-actors.js';
import { SchedulingActionsService } from './scheduling-actions.service.js';
import { SchedulingAvailabilityService } from './scheduling-availability.service.js';
import { SchedulingConfigService } from './scheduling-config.service.js';
import { SchedulingReadService } from './scheduling-read.service.js';
import { SchedulingWriteService } from './scheduling-write.service.js';
import {
  AgendaQ,
  ConflictsBody,
  ContactsQuery,
  DetailsBody,
  NoteBody,
  NoticeSettingsBody,
  ReminderBody,
  RemindersBody,
  ScheduleBody,
  SummaryQuery,
} from './scheduling.input.js';

const idPipe = new ZodValidationPipe(idParam(AppointmentId));

/**
 * The firm's calendar (R12 step 2): Owner, Admin and Staff, with the Staff calendar rule (in
 * full only their own and their assigned clients' appointments; Busy entries otherwise, and 404
 * for anything else about those). The firm comes from TenantGuard.
 */
@Controller('business/appointments')
@Access('APPOINTMENTS')
@Roles(...FIRM_STAFF)
export class AppointmentsController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly reads: SchedulingReadService,
    private readonly writes: SchedulingWriteService,
    private readonly actions: SchedulingActionsService,
    private readonly availability: SchedulingAvailabilityService,
    private readonly config: SchedulingConfigService,
  ) {}

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

  // The Appointments workspace (R58; contract in packages/types/src/appointments/scheduling.ts).
  // These static GETs come before ':id' too, or "summary" would be read as an id (400).
  @Get('summary')
  summary(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(SummaryQuery)) q: z.output<typeof SummaryQuery>,
  ): Promise<AppointmentsSummary> {
    return this.reads.summary(tenant.businessId, firmActor(auth, tenant), q);
  }

  @Get('agenda')
  agenda(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(AgendaQ)) q: z.output<typeof AgendaQ>,
  ): Promise<AgendaPage> {
    return this.reads.agenda(tenant.businessId, firmActor(auth, tenant), q);
  }

  @Get('options')
  options(@CurrentTenant() tenant: TenantContext): Promise<SchedulingOptions> {
    return this.reads.options(tenant.businessId);
  }

  @Get('contacts')
  contacts(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(ContactsQuery)) q: z.output<typeof ContactsQuery>,
  ): Promise<{ items: AppointmentContact[] }> {
    return this.reads.contacts(tenant.businessId, firmActor(auth, tenant), q);
  }

  @Get('settings')
  @Roles(...FIRM_MANAGERS)
  settings(@CurrentTenant() tenant: TenantContext): Promise<AppointmentNoticeSettings> {
    return this.config.noticeSettings(tenant.businessId);
  }

  @Put('settings')
  @Roles(...FIRM_MANAGERS)
  setSettings(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(NoticeSettingsBody)) body: z.output<typeof NoticeSettingsBody>,
  ): Promise<AppointmentNoticeSettings> {
    return this.config.setNoticeSettings(tenant.businessId, body);
  }

  @Post('conflicts')
  @HttpCode(200)
  conflicts(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(ConflictsBody)) body: z.output<typeof ConflictsBody>,
  ): Promise<ConflictResult> {
    return this.availability.conflicts(tenant.businessId, firmActor(auth, tenant), body);
  }

  @Post('reminders/send')
  @HttpCode(200)
  sendReminders(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(RemindersBody)) body: z.output<typeof RemindersBody>,
  ): Promise<RemindersSent> {
    return this.actions.sendReminders(tenant.businessId, firmActor(auth, tenant), body);
  }

  @Post('schedule')
  @HttpCode(200)
  schedule(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(ScheduleBody)) body: z.output<typeof ScheduleBody>,
  ): Promise<AppointmentRecord> {
    return this.writes.schedule(tenant.businessId, firmActor(auth, tenant), body);
  }

  @Post(':id/send-reminder')
  @HttpCode(200)
  sendReminder(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(optionalBody(ReminderBody)) body: z.output<typeof ReminderBody>,
  ): Promise<RemindersSent> {
    return this.actions.sendReminder(tenant.businessId, firmActor(auth, tenant), id, body);
  }

  @Post(':id/notes')
  @HttpCode(200)
  addNote(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(NoteBody)) body: z.output<typeof NoteBody>,
  ): Promise<AppointmentRecord> {
    return this.actions.addNote(tenant.businessId, firmActor(auth, tenant), id, body);
  }

  @Post(':id/duplicate')
  @HttpCode(200)
  duplicate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<AppointmentDraft> {
    return this.actions.duplicate(tenant.businessId, firmActor(auth, tenant), id);
  }

  @Get(':id/record')
  record(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<AppointmentRecord> {
    return this.reads.record(tenant.businessId, firmActor(auth, tenant), id);
  }

  @Patch(':id/details')
  details(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(DetailsBody)) body: z.output<typeof DetailsBody>,
  ): Promise<AppointmentRecord> {
    return this.writes.updateDetails(tenant.businessId, firmActor(auth, tenant), id, body);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  confirm(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<AppointmentRecord> {
    return this.writes.confirm(tenant.businessId, firmActor(auth, tenant), id);
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

  /** Edit location (R14): kind and details only. */
  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateBody)) body: z.output<typeof UpdateBody>,
  ): Promise<Appointment> {
    return this.appointments.update(tenant.businessId, firmActor(auth, tenant), id, body);
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
