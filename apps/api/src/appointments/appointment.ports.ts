import { Injectable, ServiceUnavailableException } from '@nestjs/common';
export interface AppointmentNotice {
  businessId: string;
  appointmentId: string;
  appointmentVersion: number;
  recipientUserId: string;
  eventKey: string;
  kind: 'BOOKED' | 'RESCHEDULED' | 'CANCELLED' | 'DETAILS_UPDATED' | 'REMINDER';
  template: 'appointment-update';
}
export abstract class AppointmentNotifier {
  /** R6 durably enqueues idempotently; rechecks membership, consent and appointment/version before sending. */
  abstract enqueue(notice: AppointmentNotice): Promise<void>;
}
@Injectable()
export class PendingAppointmentNotifier extends AppointmentNotifier {
  async enqueue(): Promise<void> {
    throw new ServiceUnavailableException({
      code: 'NOTIFY_NOT_READY',
      message: 'Appointment notification service is unavailable',
    });
  }
}
