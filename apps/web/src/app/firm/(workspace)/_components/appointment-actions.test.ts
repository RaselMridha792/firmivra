import { describe, expect, it } from 'vitest';
import { rowActions } from './appointment-actions';

// Octavia's A3: the appointment row menu by permission (Dashboard Review Two).
const client = { client: { id: 'c' }, lead: null };
const lead = { client: null, lead: { id: 'l' } };

describe('the Upcoming Appointments row menu (A3)', () => {
  it('gives the Owner and Staff every action and Open Client', () => {
    for (const role of ['OWNER', 'STAFF'] as const)
      expect(rowActions(role, client)).toEqual([
        'view',
        'edit',
        'reschedule',
        'remind',
        'complete',
        'cancel',
        'client',
      ]);
  });

  it('gives a role that may not edit appointments only View Details (and the record it may view)', () => {
    expect(rowActions('READ_ONLY', client)).toEqual(['view', 'client']);
    // Read Only does not view leads: a lead's appointment offers View Details alone.
    expect(rowActions('READ_ONLY', lead)).toEqual(['view']);
    expect(rowActions(undefined, client)).toEqual(['view']);
  });
});
