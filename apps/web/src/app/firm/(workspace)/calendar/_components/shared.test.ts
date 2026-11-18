// Appointments live check P4 (Nov 17): Mark Completed before the start read "Something went
// wrong" because APPOINTMENT_NOT_STARTED had no words. Every appointment and scheduling code the
// API sends has plain words here, so no appointment screen falls back to the generic message.
import { AppointmentErrorCode, SchedulingErrorCode } from '@firmivra/types';
import { describe, expect, it } from 'vitest';
import { CALENDAR_ERRORS } from './shared';

describe('CALENDAR_ERRORS', () => {
  it('has words for every appointment and scheduling error code', () => {
    const codes = [...AppointmentErrorCode.options, ...SchedulingErrorCode.options];
    expect(codes.filter((code) => !CALENDAR_ERRORS[code])).toEqual([]);
  });

  it('says why Mark Completed waits for the start', () => {
    expect(CALENDAR_ERRORS['APPOINTMENT_NOT_STARTED']).toBe(
      "This appointment hasn't started yet. You can mark it completed once it starts.",
    );
  });
});
