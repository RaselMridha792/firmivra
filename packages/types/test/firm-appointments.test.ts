import { it, expect } from 'vitest';
import {
  BookPortalAppointmentRequest,
  UpdateFirmAppointmentDetailsRequest,
  FirmAppointmentTypeInput,
} from '../src/firm-appointments.js';
it('rejects canonical-client injection and empty detail patches', () => {
  expect(BookPortalAppointmentRequest.safeParse({ clientId: 'forged' }).success).toBe(false);
  expect(UpdateFirmAppointmentDetailsRequest.safeParse({ expectedVersion: 1 }).success).toBe(false);
  expect(
    FirmAppointmentTypeInput.parse({
      name: 'Synthetic',
      durationMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      allowedMethods: ['PHONE'],
      clientBookingEnabled: true,
      active: true,
    }).isIntroCall,
  ).toBe(false);
});
