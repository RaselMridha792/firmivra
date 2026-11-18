import { Module } from '@nestjs/common';
import { PortalInfoModule } from '../client-auth/portal-info.controller.js';
import { IntakeWorkspaceModule } from '../intake-workspace/intake-workspace.module.js';
import { LeadsModule } from '../leads/leads.controller.js';
import { NotificationsModule } from '../notifications/notifications.controller.js';
import { PortalTabsModule } from '../client-portal/portal-tabs.js';
import { AppointmentHistory } from './appointment-history.service.js';
import { AppointmentNotices } from './appointment-notices.js';
import { AppointmentDraftsController } from './appointment-drafts.controller.js';
import { AppointmentDraftsService } from './appointment-drafts.service.js';
import { AppointmentResourcesController } from './appointment-resources.controller.js';
import { AppointmentResourcesService } from './appointment-resources.service.js';
import { AppointmentTypesController } from './appointment-types.controller.js';
import { AppointmentTypesService } from './appointment-types.service.js';
import { AppointmentsController } from './appointments.controller.js';
import { AppointmentsService } from './appointments.service.js';
import { AvailabilityController, BlockedTimesController } from './availability.controller.js';
import { AvailabilityService } from './availability.service.js';
import { MEETING_LINKS, PrismaMeetingLinks } from './meeting-links.js';
import { MyAppointmentsController } from './my-appointments.controller.js';
import { MyAppointmentsService } from './my-appointments.service.js';
import { PublicBookingController } from './public-booking.controller.js';
import { SchedulingActionsService } from './scheduling-actions.service.js';
import { SchedulingAvailabilityService } from './scheduling-availability.service.js';
import { SchedulingConfigService } from './scheduling-config.service.js';
import { SchedulingReadService } from './scheduling-read.service.js';
import { SchedulingWriteService } from './scheduling-write.service.js';
import { AppointmentWaitlistController, MyWaitlistController } from './waitlist.controller.js';
import { WaitlistJob } from './waitlist.job.js';
import { AppointmentWaitlistService } from './waitlist.service.js';

/**
 * Appointments (R12 step 2; contract in packages/types/src/appointments): appointment types,
 * working hours, meeting links (R14) and blocked time, the firm's calendar and the client's own
 * appointments.
 */
@Module({
  // LeadsModule: P4-2's Keep as Lead and Follow Up uses Leads' own follow-up service.
  // IntakeWorkspaceModule: A9's intake form sent on booking (IntakeSendService).
  imports: [
    PortalTabsModule,
    PortalInfoModule,
    NotificationsModule,
    LeadsModule,
    IntakeWorkspaceModule,
  ],
  controllers: [
    AppointmentTypesController,
    AvailabilityController,
    BlockedTimesController,
    AppointmentsController,
    AppointmentDraftsController,
    AppointmentResourcesController,
    MyAppointmentsController,
    PublicBookingController,
    // Appointments A3 (R55): the waitlist for an earlier time.
    AppointmentWaitlistController,
    MyWaitlistController,
  ],
  providers: [
    AppointmentDraftsService,
    AppointmentResourcesService,
    AppointmentTypesService,
    AvailabilityService,
    AppointmentsService,
    MyAppointmentsService,
    SchedulingReadService,
    SchedulingWriteService,
    SchedulingActionsService,
    SchedulingAvailabilityService,
    SchedulingConfigService,
    AppointmentHistory,
    AppointmentNotices,
    AppointmentWaitlistService,
    WaitlistJob,
    { provide: MEETING_LINKS, useClass: PrismaMeetingLinks },
  ],
})
export class AppointmentsModule {}
