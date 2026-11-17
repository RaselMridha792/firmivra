// P4-1 (R55, Nov 17): who an appointment is with, now that it may be a lead's own (no client).
// The name falls back to the lead's; a path that needs a client refuses a lead-only one with 409
// LEAD_APPOINTMENT instead of skipping it.
import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { clientOrLeadName, withClient } from '../../src/appointments/appointment-party.js';

describe('clientOrLeadName', () => {
  it("names the client, else the lead, else says it is a lead's", () => {
    expect(clientOrLeadName({ client: { displayName: 'Acme (fake)' } })).toBe('Acme (fake)');
    expect(
      clientOrLeadName({
        client: { displayName: 'Acme (fake)' },
        lead: { firstName: 'Lena', lastName: 'Lead' },
      }),
    ).toBe('Acme (fake)');
    expect(clientOrLeadName({ client: null, lead: { firstName: 'Lena', lastName: 'Lead' } })).toBe(
      'Lena Lead',
    );
    expect(clientOrLeadName({ client: null })).toBe('Lead');
  });
});

describe('withClient', () => {
  it('passes an appointment with a client through unchanged', () => {
    const row = { id: 'a', clientId: 'c', client: { displayName: 'Acme (fake)' } };
    expect(withClient(row)).toBe(row);
    expect(withClient({ id: 'b', clientId: 'c' }).clientId).toBe('c');
  });

  it("refuses a lead's own appointment with 409 LEAD_APPOINTMENT", () => {
    for (const row of [
      { id: 'a', clientId: null },
      { id: 'a', clientId: 'c', client: null },
    ]) {
      let thrown: unknown;
      try {
        withClient(row);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ConflictException);
      expect((thrown as ConflictException).getResponse()).toMatchObject({
        code: 'LEAD_APPOINTMENT',
        message: 'This appointment is for a lead. Convert the lead to a client first.',
      });
    }
  });
});
