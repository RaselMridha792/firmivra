import { Module } from '@nestjs/common';
import { AppointmentHistory } from './appointment-history.service.js';
import { AppointmentNotices } from './appointment-notices.js';
import { AppointmentTypesController } from './appointment-types.controller.js';
import { AppointmentTypesService } from './appointment-types.service.js';
import { AppointmentsController } from './appointments.controller.js';
import { AppointmentsService } from './appointments.service.js';
import { AvailabilityController, BlockedTimesController } from './availability.controller.js';
import { AvailabilityService } from './availability.service.js';
import { MEETING_LINKS, PrismaMeetingLinks } from './meeting-links.js';
import { MyAppointmentsController } from './my-appointments.controller.js';
import { MyAppointmentsService } from './my-appointments.service.js';

/**
 * Appointments (R12 step 2; contract in packages/types/src/appointments): appointment types,
 * working hours, meeting links (R14) and blocked time, the firm's calendar and the client's own
 * appointments.
 */
@Module({
  controllers: [
    AppointmentTypesController,
    AvailabilityController,
    BlockedTimesController,
    AppointmentsController,
    MyAppointmentsController,
  ],
  providers: [
    AppointmentTypesService,
    AvailabilityService,
    AppointmentsService,
    MyAppointmentsService,
    AppointmentHistory,
    AppointmentNotices,
    { provide: MEETING_LINKS, useClass: PrismaMeetingLinks },
  ],
})
export class AppointmentsModule {}
