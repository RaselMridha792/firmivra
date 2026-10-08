import { Module } from '@nestjs/common';
import { AppointmentTypesController } from './appointment-types.controller.js';
import { AppointmentTypesService } from './appointment-types.service.js';
import { AvailabilityController, BlockedTimesController } from './availability.controller.js';
import { AvailabilityService } from './availability.service.js';

/**
 * Appointments (R12 step 2; contract in packages/types/src/appointments): appointment types,
 * working hours and blocked time. The firm's calendar with free slots and booking, and the
 * client's own appointments, follow in the next two PRs.
 */
@Module({
  controllers: [AppointmentTypesController, AvailabilityController, BlockedTimesController],
  providers: [AppointmentTypesService, AvailabilityService],
})
export class AppointmentsModule {}
