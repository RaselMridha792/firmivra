import { ApiRequestError } from '@firmivra/types';
import { describe, expect, it } from 'vitest';
import { errorMessage } from '../../../../../lib/errors';
import { scheduleErrorText } from './lead-appointment';

// Octavia's Leads review, L12: Schedule Appointment says why a booking was refused.
describe('scheduleErrorText', () => {
  it("gives the server's reason when no field is at fault", () => {
    const refused = new ApiRequestError(
      400,
      'VALIDATION_FAILED',
      'Appointments for leads are not available yet. Convert the lead to a client first.',
    );
    expect(scheduleErrorText(refused)).toBe(
      'Appointments for leads are not available yet. Convert the lead to a client first.',
    );
  });

  it('keeps the usual message for field errors and other codes', () => {
    const fields = new ApiRequestError(
      400,
      'VALIDATION_FAILED',
      'The request is not valid',
      'r',
      undefined,
      [{ path: 'startsAt', message: 'Choose a time' }],
    );
    expect(scheduleErrorText(fields)).toBe(errorMessage(fields));
    const conflict = new ApiRequestError(409, 'SCHEDULING_CONFLICT', 'This time is taken');
    expect(scheduleErrorText(conflict)).toBe(errorMessage(conflict));
  });
});
