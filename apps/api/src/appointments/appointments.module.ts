import { Module } from '@nestjs/common';
import { AppointmentHistory } from './appointment-history.service.js';
import { AppointmentNotices } from './appointment-notices.js';
import { AppointmentTypesController } from './appointment-types.controller.js';
import { AppointmentTypesService } from './appointment-types.service.js';
import { AppointmentsController } from './appointments.controller.js';
import { AppointmentsService } from './appointments.service.js';
import { AvailabilityController, BlockedTimesController } from './availability.controller.js';
import { AvailabilityService } from './availability.service.js';

/**
 * Appointments (R12 step 2; contract in packages/types/src/appointments): appointment types,
 * working hours and blocked time, and the firm's calendar with free slots, booking and changes.
 * The client's own appointments follow in the next PR.
 */
@Module({
  controllers: [
    AppointmentTypesController,
    AvailabilityController,
    BlockedTimesController,
    AppointmentsController,
  ],
  providers: [
    AppointmentTypesService,
    AvailabilityService,
    AppointmentsService,
    AppointmentHistory,
    AppointmentNotices,
  ],
})
export class AppointmentsModule {}
